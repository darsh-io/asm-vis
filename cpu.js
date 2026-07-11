/* ============================================================
   cpu.js — The simulated CPU + stack machine.
   Pure logic, no DOM here. ui.js reads Simulator state to render.
   ============================================================ */

// Registers we track and display, in display order.
const REGISTER_NAMES = ["RIP", "RSP", "RBP", "RAX", "RBX", "RCX", "RDX", "RSI", "RDI"];

function hex(n, pad = 12) {
  if (n === null || n === undefined) return "—";
  const neg = n < 0;
  const s = Math.abs(n).toString(16).toUpperCase().padStart(pad, "0");
  return (neg ? "-0x" : "0x") + s;
}

// Deep clone helper for state snapshots (small objects, JSON is fine).
function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

/**
 * Simulator drives a linear "program" (array of instruction objects)
 * against a small machine model: registers, a stack (array of slots
 * from HIGH address at index 0 to LOW address / RSP at the end), and
 * flags. It executes ONE instruction per step() call and keeps a
 * history stack so prev() can rewind by replaying from scratch.
 */
class Simulator {
  constructor(program, opts = {}) {
    this.program = program; // array of {text, type, args, explain, label}
    this.labels = {};
    program.forEach((ins, i) => {
      if (ins.label) this.labels[ins.label] = i;
    });

    const baseRSP = opts.baseRSP ?? 0x7ffe0000;
    this.initial = {
      regs: Object.fromEntries(REGISTER_NAMES.map((r) => [r, 0])),
      stack: opts.initialStack ? cloneState(opts.initialStack) : [],
      flags: { ZF: 0, SF: 0 },
      pc: 0,
      halted: false,
      output: [],
    };
    this.initial.regs.RSP = baseRSP;
    this.initial.regs.RBP = baseRSP;
    this.initial.regs.RIP = 0;
    if (opts.regs) Object.assign(this.initial.regs, opts.regs);

    this.history = [cloneState(this.initial)];
    this.lastDiff = null; // describes what just happened, for animation
  }

  get state() {
    return this.history[this.history.length - 1];
  }

  atEnd() {
    const s = this.state;
    return s.halted || s.pc >= this.program.length;
  }

  atStart() {
    return this.history.length <= 1;
  }

  restart() {
    this.history = [cloneState(this.initial)];
    this.lastDiff = null;
  }

  prev() {
    if (this.atStart()) return null;
    this.history.pop();
    this.lastDiff = { type: "rewind" };
    return this.state;
  }

  // --- stack helpers -------------------------------------------------
  pushSlot(state, slot) {
    state.regs.RSP -= 8;
    slot.addr = state.regs.RSP;
    state.stack.push(slot);
  }

  popSlot(state) {
    const slot = state.stack.pop();
    state.regs.RSP += 8;
    return slot;
  }

  findSlotByAddr(state, addr) {
    return state.stack.find((s) => s.addr === addr);
  }

  // Turn a ROP-chain token into a concrete stack value. A token that
  // names a program label resolves to that instruction's index (a
  // "code address" the RIP arrow can jump to); anything else is a
  // plain data value (hex string, number, or omitted -> raw filler).
  resolveChainValue(token, fallback) {
    if (token === undefined) return { value: fallback, isCode: false };
    if (typeof token === "string" && this.labels[token] !== undefined) {
      return { value: this.labels[token], isCode: true };
    }
    if (typeof token === "number") return { value: token, isCode: false };
    if (typeof token === "string" && token.startsWith("0x")) {
      return { value: parseInt(token, 16), isCode: false };
    }
    return { value: fallback, isCode: false };
  }

  // Resolve an operand (register name, immediate, or memory ref like "rbp-8")
  readOperand(state, op) {
    if (typeof op === "number") return op;
    if (REGISTER_NAMES.includes(op.toUpperCase())) return state.regs[op.toUpperCase()];
    const mem = /^\[?(rbp|rsp)([+-]\d+)?\]?$/i.exec(op);
    if (mem) {
      const base = state.regs[mem[1].toUpperCase()];
      const off = mem[2] ? parseInt(mem[2], 10) : 0;
      const slot = this.findSlotByAddr(state, base + off);
      return slot ? slot.value : 0;
    }
    if (op.startsWith("0x")) return parseInt(op, 16);
    return parseInt(op, 10) || 0;
  }

  writeOperand(state, op, value) {
    if (REGISTER_NAMES.includes(op.toUpperCase())) {
      state.regs[op.toUpperCase()] = value;
      return;
    }
    const mem = /^\[?(rbp|rsp)([+-]\d+)?\]?$/i.exec(op);
    if (mem) {
      const base = state.regs[mem[1].toUpperCase()];
      const off = mem[2] ? parseInt(mem[2], 10) : 0;
      let slot = this.findSlotByAddr(state, base + off);
      if (slot) slot.value = value;
    }
  }

  // Read-only lookahead used by "predict what happens next" UI.
  // Returns the program index execution will jump to for branch-like
  // instructions (call/jmp/je/jne/ret), or null if it's not a branch.
  peekBranchTarget() {
    const state = this.state;
    const ins = this.program[state.pc];
    if (!ins) return null;
    switch (ins.type) {
      case "call":
      case "jmp":
        return this.labels[ins.args[0]];
      case "je":
        return state.flags.ZF === 1 ? this.labels[ins.args[0]] : state.pc + 1;
      case "jne":
        return state.flags.ZF === 0 ? this.labels[ins.args[0]] : state.pc + 1;
      case "ret": {
        const top = state.stack[state.stack.length - 1];
        return top ? top.value : null;
      }
      default:
        return null;
    }
  }

  // Execute the instruction at pc, return a diff object describing
  // what changed (used to drive animations in ui.js/animations.js).
  step() {
    if (this.atEnd()) return null;
    const state = cloneState(this.state);
    const ins = this.program[state.pc];
    const diff = { type: ins.type, ins, before: cloneState(state) };
    let nextPc = state.pc + 1;

    switch (ins.type) {
      case "mov": {
        const v = this.readOperand(state, ins.args[1]);
        this.writeOperand(state, ins.args[0], v);
        diff.dest = ins.args[0];
        diff.value = v;
        break;
      }
      case "lea": {
        // lea dest, [rbp-N] -> dest = address (rbp - N)
        const mem = /^\[?(rbp|rsp)([+-]\d+)?\]?$/i.exec(ins.args[1]);
        let addr = 0;
        if (mem) {
          const base = state.regs[mem[1].toUpperCase()];
          const off = mem[2] ? parseInt(mem[2], 10) : 0;
          addr = base + off;
        }
        this.writeOperand(state, ins.args[0], addr);
        diff.dest = ins.args[0];
        diff.value = addr;
        break;
      }
      case "push": {
        const v = this.readOperand(state, ins.args[0]);
        const isRbp = String(ins.args[0]).toLowerCase() === "rbp";
        this.pushSlot(state, {
          label: isRbp ? "Saved RBP" : ins.args[0],
          value: v,
          kind: isRbp ? "savedrbp" : "value",
        });
        diff.value = v;
        break;
      }
      case "pop": {
        const slot = this.popSlot(state);
        this.writeOperand(state, ins.args[0], slot.value);
        diff.dest = ins.args[0];
        diff.value = slot.value;
        diff.slot = slot;
        break;
      }
      case "sub": {
        const v = this.readOperand(state, ins.args[1]);
        if (ins.args[0].toUpperCase() === "RSP") {
          // reserve local stack space as labeled 8-byte slots
          const n = Math.ceil(v / 8);
          for (let i = 0; i < n; i++) {
            this.pushSlot(state, {
              label: ins.reserveLabel || "Local Variable",
              value: 0,
              kind: ins.reserveKind || "local",
            });
          }
          diff.reserved = n;
        } else {
          const cur = this.readOperand(state, ins.args[0]);
          this.writeOperand(state, ins.args[0], cur - v);
        }
        break;
      }
      case "add": {
        if (ins.args[0].toUpperCase() === "RSP") {
          const v = this.readOperand(state, ins.args[1]);
          const n = Math.ceil(v / 8);
          for (let i = 0; i < n; i++) this.popSlot(state);
        } else {
          const cur = this.readOperand(state, ins.args[0]);
          const v = this.readOperand(state, ins.args[1]);
          this.writeOperand(state, ins.args[0], cur + v);
        }
        break;
      }
      case "call": {
        const retAddr = state.pc + 1;
        this.pushSlot(state, { label: "Return Address", value: retAddr, kind: "retaddr", isCodeAddr: true });
        diff.retAddr = retAddr;
        const target = this.labels[ins.args[0]];
        diff.target = target;
        state.pc = target;
        nextPc = target;
        break;
      }
      case "ret": {
        const slot = this.popSlot(state);
        diff.slot = slot;
        diff.target = slot.value;
        state.pc = slot.value;
        nextPc = slot.value;
        break;
      }
      case "leave": {
        // rsp = rbp ; pop rbp  (shown as two sub-steps in the UI via diff.subSteps)
        state.regs.RSP = state.regs.RBP;
        while (state.stack.length && state.stack[state.stack.length - 1].addr < state.regs.RBP) {
          state.stack.pop();
        }
        const slot = this.popSlot(state);
        state.regs.RBP = slot.value;
        diff.slot = slot;
        break;
      }
      case "cmp": {
        const a = this.readOperand(state, ins.args[0]);
        const b = this.readOperand(state, ins.args[1]);
        state.flags.ZF = a === b ? 1 : 0;
        state.flags.SF = a - b < 0 ? 1 : 0;
        diff.a = a;
        diff.b = b;
        break;
      }
      case "jmp": {
        const target = this.labels[ins.args[0]];
        diff.target = target;
        state.pc = target;
        nextPc = target;
        break;
      }
      case "je": {
        const taken = state.flags.ZF === 1;
        diff.taken = taken;
        if (taken) {
          const target = this.labels[ins.args[0]];
          diff.target = target;
          state.pc = target;
          nextPc = target;
        }
        break;
      }
      case "jne": {
        const taken = state.flags.ZF === 0;
        diff.taken = taken;
        if (taken) {
          const target = this.labels[ins.args[0]];
          diff.target = target;
          state.pc = target;
          nextPc = target;
        }
        break;
      }
      case "overflow": {
        // Scripted stack-smash: fills buffer/local slots with `fill`,
        // then (if the overflow reaches far enough) corrupts Saved RBP
        // and finally the Return Address. `chain` optionally supplies
        // what the return address (and any further injected slots,
        // for a ROP chain) should become instead of raw filler.
        const AAAA = ins.args.fill ?? 0x4141414141414141;
        const chain = ins.args.chain || [];
        const corrupted = [];
        let i = state.stack.length - 1;
        while (i >= 0 && (state.stack[i].kind === "local" || state.stack[i].kind === "buffer")) {
          state.stack[i].value = AAAA;
          state.stack[i].corrupted = true;
          corrupted.push(i);
          i--;
        }
        if (i >= 0 && state.stack[i].kind === "savedrbp") {
          state.stack[i].value = AAAA;
          state.stack[i].corrupted = true;
          corrupted.push(i);
          i--;
        }
        if (i >= 0 && state.stack[i].kind === "retaddr") {
          const retSlot = state.stack[i];
          const first = this.resolveChainValue(chain[0], AAAA);
          retSlot.value = first.value;
          retSlot.corrupted = true;
          retSlot.isCodeAddr = first.isCode;
          corrupted.push(i);
          // Any further chain entries (a ROP chain) get injected as new
          // slots sitting just past the return address, at addresses the
          // overflow would have continued writing into.
          let insertAddr = retSlot.addr + 8;
          const newSlots = [];
          for (let k = 1; k < chain.length; k++) {
            const cv = this.resolveChainValue(chain[k], AAAA);
            newSlots.push({
              addr: insertAddr,
              label: cv.isCode ? "Return Address" : "ROP Value",
              value: cv.value,
              kind: "value",
              corrupted: true,
              isCodeAddr: cv.isCode,
            });
            insertAddr += 8;
          }
          newSlots.reverse();
          state.stack.splice(i, 0, ...newSlots);
        }
        diff.corrupted = corrupted;
        diff.chain = chain;
        break;
      }
      case "nop":
      default:
        break;
    }

    if (ins.type !== "call" && ins.type !== "ret" && ins.type !== "jmp" && !(ins.type === "je" && diff.taken) && !(ins.type === "jne" && diff.taken)) {
      state.pc = nextPc;
    }
    if (state.pc >= this.program.length) state.halted = true;
    if (ins.type === "haltmarker") state.halted = true;

    diff.after = cloneState(state);
    this.history.push(state);
    this.lastDiff = diff;
    return diff;
  }
}

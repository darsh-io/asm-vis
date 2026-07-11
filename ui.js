/* ============================================================
   ui.js — Renders a Simulator (cpu.js) onto the shared "debugger"
   layout: instruction list, register cards, animated stack, flags,
   memory map, and the beginner explanation panel.

   This file only READS Simulator state and DOM; script.js owns
   wiring buttons and switching lessons.
   ============================================================ */

class SimulatorView {
  constructor(sim, lesson) {
    this.sim = sim;
    this.lesson = lesson;
    this.stackNodes = new Map(); // addr -> DOM node, so re-renders reuse elements
    this.predictMode = false;
    this.onPredictionResolved = null;

    this.el = {
      instrList: document.getElementById("instrList"),
      regGrid: document.getElementById("regGrid"),
      stackTrack: document.getElementById("stackTrack"),
      stackWrap: document.getElementById("stackWrap"),
      rspArrow: document.getElementById("rspArrow"),
      rbpArrow: document.getElementById("rbpArrow"),
      flagsRow: document.getElementById("flagsRow"),
      explainTitle: document.getElementById("explainTitle"),
      explainText: document.getElementById("explainText"),
      explainStory: document.getElementById("explainStory"),
      memStack: document.getElementById("memSegStack"),
      memCode: document.getElementById("memSegCode"),
      gadgetPanel: document.getElementById("gadgetPanel"),
      gadgetList: document.getElementById("gadgetList"),
      predictBanner: document.getElementById("predictBanner"),
    };

    this.buildRegisterCards();
    this.buildInstructionList();
    this.buildGadgetPanel();
    this.stackNodes.clear();
    this.el.stackTrack.innerHTML = "";
    this.syncAll({ animateFlags: false });
  }

  // ---------------------------------------------------------- registers
  buildRegisterCards() {
    this.el.regGrid.innerHTML = "";
    REGISTER_NAMES.forEach((name) => {
      const card = document.createElement("div");
      card.className = "reg-card";
      card.id = "reg-" + name;
      card.innerHTML = `
        <div class="reg-name">${name}</div>
        <div class="reg-value">0x0</div>
        <div class="reg-tag">${REGISTER_TAGS[name] || ""}</div>`;
      this.el.regGrid.appendChild(card);
    });
  }

  renderRegisters(prevState, state, flashSet) {
    REGISTER_NAMES.forEach((name) => {
      const card = document.getElementById("reg-" + name);
      const valueEl = card.querySelector(".reg-value");
      let display;
      if (name === "RIP") {
        const ins = this.sim.program[state.regs.RIP] || this.sim.program[state.pc];
        display = ins ? ins.text : "—";
      } else {
        display = hex(state.regs[name], 8);
      }
      const changed = !prevState || prevState.regs[name] !== state.regs[name];
      valueEl.textContent = display;
      card.classList.toggle("is-rip", name === "RIP");
      card.classList.toggle("is-rsp", name === "RSP");
      card.classList.toggle("is-rbp", name === "RBP");
      if (changed && (flashSet ? flashSet.has(name) : true)) {
        Anim.flash(card, "flash");
      }
    });
  }

  // ---------------------------------------------------------- instructions
  buildInstructionList() {
    this.el.instrList.innerHTML = "";
    this.sim.program.forEach((ins, i) => {
      const li = document.createElement("li");
      li.className = "instr-line";
      li.dataset.index = i;
      if (ins.gadget) li.classList.add("is-gadget");
      li.innerHTML = `
        <span class="instr-no">${i}</span>
        <span class="instr-text">${escapeHtml(ins.text)}</span>
        ${ins.label ? `<span class="instr-label">${ins.label}:</span>` : ""}`;
      this.el.instrList.appendChild(li);
    });
  }

  renderInstructionPointer(state) {
    const items = this.el.instrList.querySelectorAll(".instr-line");
    items.forEach((li) => li.classList.remove("active", "done"));
    items.forEach((li) => {
      const idx = Number(li.dataset.index);
      if (idx < state.pc) li.classList.add("done");
    });
    const activeLi = this.el.instrList.querySelector(`[data-index="${state.pc}"]`);
    if (activeLi) {
      activeLi.classList.add("active");
      activeLi.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    return activeLi;
  }

  // ---------------------------------------------------------- gadgets (ROP)
  buildGadgetPanel() {
    const gadgetInstrs = this.sim.program.filter((i) => i.gadget);
    this.gadgetCards = new Map(); // gadget-tag -> card element, for live highlighting
    if (!gadgetInstrs.length) {
      this.el.gadgetPanel.classList.add("hidden");
      return;
    }
    this.el.gadgetPanel.classList.remove("hidden");
    const seen = new Set();
    this.el.gadgetList.innerHTML = "";
    // Sort by gadgetOrder so the panel always reads top-to-bottom as the
    // chain actually executes, even if instructions were interleaved.
    const ordered = gadgetInstrs
      .filter((ins) => !seen.has(ins.gadget) && seen.add(ins.gadget))
      .sort((a, b) => (a.gadgetOrder || 0) - (b.gadgetOrder || 0));

    ordered.forEach((ins, i) => {
      const card = document.createElement("div");
      card.className = "gadget-card";
      card.innerHTML = `
        <div class="gadget-card-head">
          <span class="gadget-step">#${ins.gadgetOrder || i + 1}</span>
          <code>${escapeHtml(ins.gadget)}</code>
          ${ins.gadgetEffect ? `<span class="gadget-effect">${escapeHtml(ins.gadgetEffect)}</span>` : ""}
        </div>
        <p>${escapeHtml(ins.gadgetPurpose || ins.explain)}</p>`;
      this.el.gadgetList.appendChild(card);
      this.gadgetCards.set(ins.gadget, card);
      if (i < ordered.length - 1) {
        const arrow = document.createElement("div");
        arrow.className = "gadget-arrow";
        arrow.textContent = "↓ ret jumps here";
        this.el.gadgetList.appendChild(arrow);
      }
    });
  }

  /** Glow whichever gadget card RIP is currently executing inside. */
  highlightActiveGadget(state) {
    if (!this.gadgetCards || !this.gadgetCards.size) return;
    const ins = this.sim.program[state.pc];
    this.gadgetCards.forEach((card) => card.classList.remove("active"));
    if (ins && ins.gadget) {
      const card = this.gadgetCards.get(ins.gadget);
      if (card) {
        card.classList.add("active");
        card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }

  // ---------------------------------------------------------- stack
  slotColor(kind) {
    return (
      {
        retaddr: "slot-retaddr",
        savedrbp: "slot-savedrbp",
        local: "slot-local",
        buffer: "slot-buffer",
        value: "slot-value",
      }[kind] || "slot-value"
    );
  }

  slotLabel(slot) {
    if (slot.kind === "retaddr") return "Return Address";
    if (slot.kind === "savedrbp") return "Saved RBP";
    if (slot.label) return String(slot.label).toUpperCase().startsWith("RBP") ? "Saved RBP" : String(slot.label);
    return SLOT_LABELS[slot.kind] || "Value";
  }

  slotValueText(slot) {
    if (slot.isCodeAddr) {
      const ins = this.sim.program[slot.value];
      return ins ? `→ ${ins.label || "line " + slot.value}` : hex(slot.value);
    }
    return hex(slot.value, 8);
  }

  /** Rebuild stack DOM to match state.stack, reusing nodes by address. */
  renderStack(state, { newAddrs = new Set(), corruptedAddrs = new Set() } = {}) {
    const liveAddrs = new Set(state.stack.map((s) => s.addr));
    // remove nodes no longer present
    for (const [addr, node] of this.stackNodes) {
      if (!liveAddrs.has(addr)) {
        node.classList.add("slot-exit");
        setTimeout(() => node.remove(), 280);
        this.stackNodes.delete(addr);
      }
    }
    // state.stack is already ordered high-address(index0, oldest/caller
    // frames) -> low-address(last, RSP/top-of-stack). Rendering it in
    // that same order means the column grows DOWNWARD on screen as you
    // push, with RSP always tracking the bottom-most box — the classic
    // "stack grows down" mental model.
    state.stack.forEach((slot) => {
      let node = this.stackNodes.get(slot.addr);
      if (!node) {
        node = document.createElement("div");
        node.className = "stack-slot";
        if (newAddrs.has(slot.addr)) node.classList.add("slot-enter");
        this.stackNodes.set(slot.addr, node);
      }
      node.className = "stack-slot " + this.slotColor(slot.kind) + (slot.corrupted ? " corrupted" : "");
      node.dataset.addr = slot.addr;
      node.innerHTML = `
        <div class="slot-label">${escapeHtml(this.slotLabel(slot))}</div>
        <div class="slot-value">${escapeHtml(this.slotValueText(slot))}</div>
        <div class="slot-addr">${hex(slot.addr, 8)}</div>`;
      if (corruptedAddrs.has(slot.addr)) Anim.flash(node, "flash-red");
      this.el.stackTrack.appendChild(node); // re-append = correct order
    });

    requestAnimationFrame(() => {
      this.stackNodes.forEach((node) => node.classList.remove("slot-enter"));
    });

    this.positionArrows(state);
  }

  positionArrows(state) {
    const rspNode = this.stackNodes.get(state.regs.RSP);
    const rbpNode = this.stackNodes.get(state.regs.RBP);
    if (rspNode) Anim.moveArrowTo(this.el.rspArrow, rspNode, this.el.stackTrack);
    else this.el.rspArrow.classList.add("hidden");
    if (rbpNode) Anim.moveArrowTo(this.el.rbpArrow, rbpNode, this.el.stackTrack);
    else this.el.rbpArrow.classList.add("hidden");
  }

  // ---------------------------------------------------------- flags / memory
  renderFlags(state, changed) {
    this.el.flagsRow.querySelectorAll(".flag-chip").forEach((chip) => {
      const name = chip.dataset.flag;
      chip.classList.toggle("set", state.flags[name] === 1);
      if (changed) Anim.flash(chip, "flash");
    });
  }

  renderMemoryMap(state) {
    this.el.memStack.classList.toggle("active", state.stack.length > 0);
    this.el.memCode.classList.add("active");
  }

  // ---------------------------------------------------------- explanation panel
  renderExplain(ins) {
    this.el.explainTitle.textContent = ins.text;
    this.el.explainText.textContent = ins.explain || INSTRUCTION_BLURBS[ins.type] || "";
    this.el.explainStory.textContent = ins.story || "";
    this.el.explainStory.classList.toggle("hidden", !ins.story);
  }

  // ---------------------------------------------------------- prediction ("guess where RET goes")
  /**
   * If predict mode is on and the CURRENT instruction is a branch
   * (call/ret/jmp/je/jne), ask the user to click which line runs next
   * before we actually execute it. Resolves once they've answered (or
   * immediately if prediction doesn't apply / is disabled).
   */
  async maybePrompt() {
    const state = this.sim.state;
    const ins = this.sim.program[state.pc];
    const target = this.sim.peekBranchTarget();
    if (!this.predictMode || target === null || target === undefined) return;

    const banner = this.el.predictBanner;
    const verb = ins.type === "ret" ? "Guess where RET returns to" : "Guess which line runs next";
    banner.textContent = `🎯 ${verb} — click a line in the assembly list.`;
    banner.classList.remove("hidden");

    const lines = [...this.el.instrList.querySelectorAll(".instr-line")];
    lines.forEach((li) => li.classList.add("predict-pickable"));

    await new Promise((resolve) => {
      const onClick = (e) => {
        const li = e.target.closest(".instr-line");
        if (!li) return;
        const picked = Number(li.dataset.index);
        lines.forEach((l) => l.removeEventListener("click", onClick));
        lines.forEach((l) => l.classList.remove("predict-pickable"));
        const correct = picked === target;
        li.classList.add(correct ? "predict-correct" : "predict-wrong");
        if (!correct) {
          const correctLi = this.el.instrList.querySelector(`[data-index="${target}"]`);
          if (correctLi) correctLi.classList.add("predict-correct");
        }
        banner.textContent = correct ? "✅ Correct!" : "❌ Not quite — watch what actually happens.";
        setTimeout(() => {
          banner.classList.add("hidden");
          li.classList.remove("predict-correct", "predict-wrong");
          resolve();
        }, 900);
      };
      lines.forEach((li) => li.addEventListener("click", onClick));
    });
  }

  // ---------------------------------------------------------- operand -> DOM element
  /** Find the on-screen element representing a register or `[rbp±N]` operand
   *  using a *pre-step* state (so stack slots still exist where expected). */
  operandEl(state, op) {
    if (typeof op !== "string") return null;
    if (REGISTER_NAMES.includes(op.toUpperCase())) return document.getElementById("reg-" + op.toUpperCase());
    const mem = /^\[?(rbp|rsp)([+-]\d+)?\]?$/i.exec(op);
    if (mem) {
      const base = state.regs[mem[1].toUpperCase()];
      const off = mem[2] ? parseInt(mem[2], 10) : 0;
      return this.stackNodes.get(base + off) || null;
    }
    return null;
  }

  topStackEl() {
    return this.el.stackTrack.lastElementChild; // most recently pushed renders last (bottom = top-of-stack)
  }

  /** Run the custom per-instruction-type animation, THEN settle the DOM
   *  into the post-step state via syncAll. This is the heart of "every
   *  instruction gets a distinct animation." */
  async playDiff(diff) {
    const { ins, before } = diff;
    const activeLine = this.el.instrList.querySelector(`[data-index="${before.pc}"]`);
    Anim.pulse(activeLine, "instr-firing", 500);
    this.renderExplain(ins);

    switch (ins.type) {
      case "mov":
      case "lea": {
        const src = this.operandEl(before, ins.args[1]);
        const dst = this.operandEl(before, ins.args[0]);
        if (src && dst) await Anim.fly(src, dst, { text: hex(diff.value, 4), className: "ghost-value" });
        break;
      }
      case "push": {
        const src = this.operandEl(before, ins.args[0]) || activeLine;
        if (src && this.el.stackWrap) {
          await Anim.fly(src, this.el.stackWrap, { text: hex(diff.value, 4), className: "ghost-value ghost-down" });
        }
        break;
      }
      case "pop": {
        const src = this.topStackEl();
        const dst = this.operandEl(before, ins.args[0]);
        if (src && dst) await Anim.fly(src, dst, { text: hex(diff.value, 4), className: "ghost-value ghost-up" });
        break;
      }
      case "call": {
        const nextLine = this.el.instrList.querySelector(`[data-index="${before.pc + 1}"]`);
        if (nextLine) {
          Anim.pulse(nextLine, "instr-retaddr", 900);
          await Anim.wait(350);
          await Anim.fly(nextLine, this.el.stackWrap, { text: "return→", className: "ghost-value ghost-down ghost-code" });
        }
        Anim.flash(document.getElementById("reg-RIP"), "flash-jump");
        break;
      }
      case "ret": {
        const src = this.topStackEl();
        const dst = document.getElementById("reg-RIP");
        if (src) {
          Anim.pulse(src, "instr-retaddr", 700);
          await Anim.wait(250);
          await Anim.fly(src, dst, { text: "→ RIP", className: "ghost-value ghost-up ghost-code" });
        }
        break;
      }
      case "leave": {
        Anim.flash(this.el.rspArrow.parentElement, "flash");
        await Anim.wait(300);
        const src = this.topStackEl();
        const dst = document.getElementById("reg-RBP");
        if (src && dst) await Anim.fly(src, dst, { text: "old RBP", className: "ghost-value ghost-up" });
        break;
      }
      case "cmp": {
        const a = this.operandEl(before, ins.args[0]);
        const b = this.operandEl(before, ins.args[1]);
        Anim.flash(a, "flash");
        Anim.flash(b, "flash");
        await Anim.wait(300);
        break;
      }
      case "jmp":
      case "je":
      case "jne": {
        Anim.flash(document.getElementById("reg-RIP"), diff.taken === false ? "flash-red" : "flash-jump");
        await Anim.wait(250);
        break;
      }
      case "overflow": {
        await this.playOverflowAnimation(diff);
        break;
      }
      default:
        break;
    }
  }

  /** "Typing" style animation: corrupted slots light up red in order,
   *  from the buffer outward through Saved RBP and the Return Address. */
  async playOverflowAnimation(diff) {
    const touched = [...(diff.after.stack || [])].filter((s) => s.corrupted);
    // Render structural change first so nodes exist, then flash in sequence.
    this.renderStack(diff.after, { corruptedAddrs: new Set() });
    const nodesInWriteOrder = touched.slice().reverse(); // buffer -> savedrbp -> retaddr -> chain
    for (const slot of nodesInWriteOrder) {
      const node = this.stackNodes.get(slot.addr);
      if (node) {
        Anim.flash(node, "flash-red");
        node.classList.add("corrupted");
      }
      await Anim.wait(120);
    }
  }

  // ---------------------------------------------------------- full sync (no custom fly anim)
  syncAll({ prevState = null, flashRegs = null, animateFlags = false } = {}) {
    const state = this.sim.state;
    this.renderRegisters(prevState, state, flashRegs);
    this.renderInstructionPointer(state);
    this.renderStack(state);
    this.renderFlags(state, animateFlags);
    this.renderMemoryMap(state);
    this.highlightActiveGadget(state);
    const currentIns = this.sim.program[state.pc];
    if (currentIns) this.renderExplain(currentIns);
  }
}

// Small helpers -------------------------------------------------
const REGISTER_TAGS = {
  RIP: "next instruction",
  RSP: "stack top",
  RBP: "frame base",
  RAX: "return value",
  RBX: "general",
  RCX: "general",
  RDX: "general",
  RSI: "general",
  RDI: "1st argument",
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

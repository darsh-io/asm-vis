/* ============================================================
   lessons.js — Lesson content: VM programs + beginner blurbs.
   No DOM/rendering logic lives here — just data. ui.js/script.js
   turn this into pixels.
   ============================================================ */

// One short (<10 word) beginner sentence per instruction type.
// Shown under the current instruction no matter which lesson runs.
const INSTRUCTION_BLURBS = {
  mov: "Copies a value from one place to another.",
  lea: "Calculates an address — doesn't read memory.",
  push: "Adds a value to the top of the stack.",
  pop: "Removes the top value from the stack.",
  sub: "Subtracts a value — often reserves stack space.",
  add: "Adds a value — often frees stack space.",
  call: "Stores where to return, then jumps.",
  ret: "Returns to the stored return address.",
  leave: "Restores the caller's stack frame.",
  cmp: "Compares two values and sets flags.",
  jmp: "Jumps to another instruction, always.",
  je: "Jumps only if the values were equal.",
  jne: "Jumps only if the values were not equal.",
  overflow: "Your input overwrites nearby stack memory.",
  nop: "Does nothing. Moves to the next line.",
  haltmarker: "Program finished. Nothing left to run.",
};

// Human titles for instruction "kind" tags shown on stack slots.
const SLOT_LABELS = {
  retaddr: "Return Address",
  savedrbp: "Saved RBP",
  local: "Local Variable",
  buffer: "Buffer",
  value: "Value",
};

/* Helper to build instruction objects tersely.
   type: mnemonic key (see cpu.js switch)
   args: operand list
   text: assembly text shown in the instruction list
   extra: any extra fields (label, explain, reserveLabel, reserveKind...) */
function I(type, args, text, extra = {}) {
  return { type, args, text, ...extra };
}

/* ================= LESSON 1 — Registers 101 ================= */
const PROGRAM_REGISTERS = [
  I("mov", ["rax", 5], "mov rax, 5", { explain: "RAX now holds the number 5." }),
  I("mov", ["rbx", 10], "mov rbx, 10", { explain: "RBX now holds the number 10." }),
  I("mov", ["rcx", "rax"], "mov rcx, rax", { explain: "Copy RAX's value into RCX." }),
  I("add", ["rax", "rbx"], "add rax, rbx", { explain: "RAX becomes RAX + RBX = 15." }),
  I("mov", ["rdx", 0x1000], "mov rdx, 0x1000", { explain: "RDX now holds a memory-looking address." }),
  I("mov", ["rsi", "rdx"], "mov rsi, rdx", { explain: "Copy that address into RSI too." }),
];

/* ================= LESSON 2 — Stack Basics ================= */
const PROGRAM_STACK = [
  I("push", [5], "push 5", { explain: "5 lands on top of the stack. RSP moves down." }),
  I("push", [10], "push 10", { explain: "10 lands on top. RSP moves down again." }),
  I("push", [15], "push 15", { explain: "15 is now on top of everything." }),
  I("pop", ["rax"], "pop rax", { explain: "Top value (15) leaves the stack into RAX." }),
  I("pop", ["rbx"], "pop rbx", { explain: "Next value (10) leaves the stack into RBX." }),
  I("pop", ["rcx"], "pop rcx", { explain: "Last value (5) leaves the stack into RCX." }),
];

/* ================= LESSON 3 — Function Calls & Stack Frames ================= */
const PROGRAM_FRAME = [
  I("mov", ["rdi", 7], "mov rdi, 7", { explain: "Put the argument (7) into RDI." }),
  I("call", ["add_one"], "call add_one", { explain: "Save a return address, then jump in." }),
  I("mov", ["rbx", "rax"], "mov rbx, rax", { explain: "Back in main — grab the result." }),
  I("haltmarker", [], "; end of main()", { explain: "main() is finished.", label: "end_main" }),
  I("push", ["rbp"], "push rbp", { explain: "Save the caller's base pointer.", label: "add_one" }),
  I("mov", ["rbp", "rsp"], "mov rbp, rsp", { explain: "This frame's base is set — RBP = RSP." }),
  I("sub", ["rsp", 0x10], "sub rsp, 0x10", {
    explain: "Reserve room for two local variables.",
    reserveLabel: "Local Variable",
  }),
  I("mov", ["[rbp-8]", "rdi"], "mov [rbp-8], rdi", { explain: "Store the argument into a local slot." }),
  I("mov", ["rax", "[rbp-8]"], "mov rax, [rbp-8]", { explain: "Load it back for the return value." }),
  I("add", ["rax", 1], "add rax, 1", { explain: "RAX = argument + 1." }),
  I("leave", [], "leave", { explain: "RSP = RBP, then pop the saved RBP back." }),
  I("ret", [], "ret", { explain: "Pop the return address straight into RIP." }),
];

/* ================= LESSON 4 — Ret2Win ================= */
const PROGRAM_RET2WIN = [
  I("call", ["main_vuln"], "call vuln()", { explain: "main() calls the vulnerable function." }),
  I("haltmarker", [], "; end of main()", { explain: "main() would resume here — but it never will.", label: "end_main" }),
  I("push", ["rbp"], "push rbp", { explain: "Standard prologue: save old RBP.", label: "main_vuln" }),
  I("mov", ["rbp", "rsp"], "mov rbp, rsp", { explain: "New frame begins." }),
  I("sub", ["rsp", 0x20], "sub rsp, 0x20", {
    explain: "char buffer[32]; — 32 bytes reserved.",
    reserveLabel: "Buffer",
    reserveKind: "buffer",
  }),
  I("overflow", { fill: 0x4141414141414141, chain: ["win"] }, "gets(buffer)  // ← attacker input!", {
    explain: "The input is longer than the buffer. It spills upward.",
    story:
      "Your bytes fill the buffer, then Saved RBP, then the Return Address — overwriting it with win()'s address.",
  }),
  I("leave", [], "leave", { explain: "The frame is torn down — but the return address is already poisoned." }),
  I("ret", [], "ret", { explain: "RIP is loaded from a value YOU control." }),
  I("nop", [], "nop", { explain: "🏆 win() — you redirected execution here!", label: "win" }),
];

/* ================= LESSON 5 — ROP Chain ================= */
const PROGRAM_ROP = [
  I("call", ["rop_vuln"], "call vuln()", { explain: "main() calls the vulnerable function." }),
  I("haltmarker", [], "; end of main()", { explain: "Never reached.", label: "rop_end_main" }),
  I("push", ["rbp"], "push rbp", { explain: "Standard prologue.", label: "rop_vuln" }),
  I("mov", ["rbp", "rsp"], "mov rbp, rsp", { explain: "New frame begins." }),
  I("sub", ["rsp", 0x10], "sub rsp, 0x10", {
    explain: "char buffer[16]; — smaller buffer this time.",
    reserveLabel: "Buffer",
    reserveKind: "buffer",
  }),
  I(
    "overflow",
    { fill: 0x4141414141414141, chain: ["pop_rdi", "0x1337", "rop_win"] },
    "gets(buffer)  // ← builds a ROP chain!",
    {
      explain: "The overflow plants a chain of fake return addresses.",
      story: "Return Address → pop_rdi gadget. Next slot → the value for RDI. Next slot → win().",
    }
  ),
  I("leave", [], "leave", { explain: "Frame torn down; return address is the first gadget." }),
  I("ret", [], "ret", { explain: "Jump into the first gadget instead of the caller." }),
  I("pop", ["rdi"], "pop rdi", {
    explain: "This gadget loads the next stack value into RDI.",
    label: "pop_rdi",
    gadget: "pop rdi ; ret",
  }),
  I("ret", [], "ret", { explain: "Gadget's own ret — jump to the NEXT chained address.", gadget: "pop rdi ; ret" }),
  I("nop", [], "nop", { explain: "🏆 win(rdi) — called with a fully controlled argument!", label: "rop_win" }),
];

/* ------------------------------------------------------------
   Lesson catalog. `kind: 'vm'` lessons are driven by Simulator +
   the shared step/animate UI. Other kinds render their own
   dedicated widgets (see bufferlab.js / pointerlab.js / pielab.js).
   ------------------------------------------------------------ */
const LESSONS = [
  {
    id: "registers",
    kind: "vm",
    icon: "🧩",
    title: "Registers 101",
    subtitle: "Meet the CPU's tiny scratchpads",
    intro: "Registers are small boxes inside the CPU that hold numbers. Watch them light up as they change.",
    program: PROGRAM_REGISTERS,
  },
  {
    id: "stack",
    kind: "vm",
    icon: "📚",
    title: "Stack Basics",
    subtitle: "Push and pop, hands-on",
    intro: "The stack is a pile of values. PUSH adds to the top. POP removes from the top. RSP always points at the top.",
    program: PROGRAM_STACK,
  },
  {
    id: "frames",
    kind: "vm",
    icon: "🏗️",
    title: "Function Calls & Stack Frames",
    subtitle: "CALL, RET, and what a frame really is",
    intro:
      "Every function call builds a little house on the stack: a return address, the caller's RBP, and local variables.",
    program: PROGRAM_FRAME,
  },
  {
    id: "overflow",
    kind: "overflow",
    icon: "💥",
    title: "Buffer Overflow",
    subtitle: "Type past the end of char buffer[32]",
    intro: "Type into the buffer. Keep going past 32 bytes and watch it eat Saved RBP, then the Return Address.",
  },
  {
    id: "ret2win",
    kind: "vm",
    icon: "🏆",
    title: "Ret2Win",
    subtitle: "Hijack RIP on purpose",
    intro: "main() → vuln() → overflow → the return address becomes win()'s address → RET jumps there.",
    program: PROGRAM_RET2WIN,
  },
  {
    id: "pie",
    kind: "pie",
    icon: "🧭",
    title: "PIE & Leaked Addresses",
    subtitle: "Base + offset = anything you want",
    intro: "Modern binaries load at a random base address. Leak one address, subtract its known offset, get the base.",
  },
  {
    id: "rop",
    kind: "vm",
    icon: "🔗",
    title: "ROP Chains",
    subtitle: "Chaining tiny gadgets into a program",
    intro: "A gadget is a couple of instructions ending in RET. Chain gadgets together to control registers, then call win().",
    program: PROGRAM_ROP,
  },
  {
    id: "pointers",
    kind: "pointer",
    icon: "👉",
    title: "Pointer Visualizer",
    subtitle: "A pointer stores an ADDRESS, not a value",
    intro: "int x = 5; int *p = &x; — p doesn't hold 5. It holds the ADDRESS of the box that holds 5.",
  },
];

/* ============================================================
   assembler.js — Turns hand-typed assembly text into the same
   instruction objects cpu.js's Simulator already knows how to run
   (see lessons.js's `I()` helper for the shape). Pure parsing, no
   DOM, so it's easy to unit-test.
   ============================================================ */

// Mnemonic text -> cpu.js instruction "type". A few common aliases
// (jz/jnz) map onto je/jne so beginners' muscle memory still works.
const MNEMONIC_MAP = {
  mov: "mov",
  lea: "lea",
  push: "push",
  pop: "pop",
  sub: "sub",
  add: "add",
  call: "call",
  ret: "ret",
  leave: "leave",
  cmp: "cmp",
  jmp: "jmp",
  je: "je",
  jz: "je",
  jne: "jne",
  jnz: "jne",
  nop: "nop",
};

const BRANCH_TYPES = new Set(["call", "jmp", "je", "jne"]);

/** Split "a, b" into ["a","b"], trimming whitespace. Operands never
 *  contain commas in our tiny language, so a plain split is enough. */
function splitArgs(rest) {
  if (!rest) return [];
  return rest
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse hand-written assembly into a Simulator-ready program.
 * Returns { program, errors }. `errors` is a list of {line, message};
 * when non-empty the caller should refuse to run and show them.
 */
function parseAssembly(text) {
  const rawLines = text.split("\n");
  const program = [];
  const errors = [];
  let pendingLabel = null;

  rawLines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    // Strip ; or # comments.
    let line = raw.split(";")[0].split("#")[0].trim();
    if (!line) return;

    // Optional "label:" prefix, possibly alone on its own line.
    const labelMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    let label = pendingLabel;
    pendingLabel = null;
    if (labelMatch) {
      label = label || labelMatch[1];
      line = labelMatch[2].trim();
      if (!line) {
        pendingLabel = labelMatch[1];
        return; // label-only line — attaches to the next real instruction
      }
    }

    const m = /^(\S+)\s*(.*)$/.exec(line);
    if (!m) {
      errors.push({ line: lineNo, message: `Couldn't parse "${raw.trim()}"` });
      return;
    }
    const mnemonic = m[1].toLowerCase();
    const type = MNEMONIC_MAP[mnemonic];
    if (!type) {
      errors.push({ line: lineNo, message: `Unknown instruction "${m[1]}"` });
      return;
    }
    const args = splitArgs(m[2]);

    const expected = {
      mov: 2, lea: 2, push: 1, pop: 1, sub: 2, add: 2,
      call: 1, ret: 0, leave: 0, cmp: 2, jmp: 1, je: 1, jne: 1, nop: 0,
    }[type];
    if (args.length !== expected) {
      errors.push({
        line: lineNo,
        message: `"${mnemonic}" needs ${expected} operand${expected === 1 ? "" : "s"}, got ${args.length}`,
      });
      return;
    }

    // Buffer/local reservations: `sub rsp, 0x20 ; buffer[32]` tags the
    // reserved slots as a highlighted Buffer instead of plain locals.
    const comment = raw.split(";")[1] || "";
    const reserveKind = /buffer/i.test(comment) ? "buffer" : "local";
    const reserveLabel = /buffer/i.test(comment) ? "Buffer" : "Local Variable";

    program.push({
      type,
      args,
      text: raw.trim() || line,
      label: label || undefined,
      reserveLabel,
      reserveKind,
      lineNo,
    });
  });

  // Validate branch/call targets now that every label has been collected.
  const defined = new Set(program.map((i) => i.label).filter(Boolean));
  program.forEach((ins) => {
    if (BRANCH_TYPES.has(ins.type) && !defined.has(ins.args[0])) {
      errors.push({ line: ins.lineNo, message: `Unknown label "${ins.args[0]}"` });
    }
  });

  return { program, errors };
}

const SANDBOX_TEMPLATE = `; Write your own assembly, then hit Assemble ▶
; Supported: mov, push, pop, lea, sub, add, call, ret, leave, cmp, jmp, je/jz, jne/jnz, nop
; Tip: "sub rsp, 0x20 ; buffer[32]" reserves a highlighted Buffer.
; Labels: "myLabel:" on its own line, or "myLabel: mov rax, 1"

mov rax, 5
mov rbx, 10
push rax
push rbx
pop rcx
pop rdx
add rcx, rdx

call add_one
jmp done

add_one:
  push rbp
  mov rbp, rsp
  mov rax, rcx
  add rax, 1
  leave
  ret

done:
  nop
`;

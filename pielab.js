/* ============================================================
   pielab.js — PIE / ASLR lesson.
   The binary loads at a random base each run. Leak one address,
   subtract its known offset to recover the base, then add another
   known offset to compute win()'s real address.
   ============================================================ */

class PieLab {
  constructor(root) {
    this.root = root;
    this.LEAK_OFFSET = 0x2500; // offset of the leaked function inside the binary
    this.WIN_OFFSET = 0x1189; // offset of win() inside the binary
    this.step = 0;
    this.reset();
  }

  reset() {
    // A "random" base, page-aligned, like a real PIE load address.
    this.base = (0x555555554000 + Math.floor(Math.random() * 0x100) * 0x1000) & ~0xfff;
    this.step = 0;
    this.render();
  }

  next() {
    if (this.step >= 4) return;
    this.step++;
    this.render(true);
  }

  row(id, label, value, sub) {
    return `<div class="pie-row" id="${id}">
      <div class="pie-label">${label}</div>
      <div class="pie-val">${value}</div>
      ${sub ? `<div class="pie-sub">${sub}</div>` : ""}
    </div>`;
  }

  render(animate) {
    const wrap = this.root.querySelector("#pieBody");
    const known = this.step >= 1;
    const baseKnown = this.step >= 2;
    const winKnown = this.step >= 3;

    const leaked = this.base + this.LEAK_OFFSET;
    const win = this.base + this.WIN_OFFSET;

    wrap.innerHTML =
      this.row("pieBase", "Binary Base Address", baseKnown ? hex(this.base, 12) : "0x????????????", "Randomized every run by ASLR/PIE.") +
      this.row(
        "pieLeak",
        "Leaked Address",
        known ? hex(leaked, 12) : "— not leaked yet —",
        known ? `base + 0x${this.LEAK_OFFSET.toString(16)} (a known offset)` : "Click \"Leak an address\" below."
      ) +
      this.row(
        "pieCalc",
        "base = leaked − 0x" + this.LEAK_OFFSET.toString(16),
        baseKnown ? hex(this.base, 12) : "…",
        baseKnown ? "Now we know exactly where the binary lives." : ""
      ) +
      this.row(
        "pieWin",
        "win() = base + 0x" + this.WIN_OFFSET.toString(16),
        winKnown ? hex(win, 12) : "…",
        winKnown ? "Use this as your Return Address — just like ret2win." : ""
      );

    if (animate) {
      const justRevealed = ["pieLeak", "pieCalc", "pieWin"][this.step - 1];
      const el = wrap.querySelector("#" + justRevealed);
      if (el) Anim.flash(el, "flash");
    }

    const btn = this.root.querySelector("#pieNextBtn");
    const labels = ["Leak an address", "Calculate the base", "Calculate win()", "Done ✓"];
    btn.textContent = labels[Math.min(this.step, 3)];
    btn.disabled = this.step >= 4;

    const status = this.root.querySelector("#pieStatus");
    const statuses = [
      "The base address is completely unknown at start — ASLR randomizes it.",
      "The program leaked one real address. It always sits base + 0x2500 away.",
      "Subtract the known offset from the leak to recover the exact base.",
      "🏆 Add win()'s offset to the base — you now have a real, working address.",
    ];
    status.textContent = statuses[Math.min(this.step, 3)];
  }
}

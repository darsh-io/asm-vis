/* ============================================================
   pointerlab.js — Pointer Visualizer.
   int x = 5; int *p = &x;  — boxes + a physical arrow that always
   points at whatever address the pointer currently holds.
   ============================================================ */

class PointerLab {
  constructor(root) {
    this.root = root;
    this.vars = [
      { name: "x", addr: 0x7ffe1000, value: 5, isPointer: false },
      { name: "y", addr: 0x7ffe1008, value: 99, isPointer: false },
      { name: "p", addr: 0x7ffe1010, value: 0x7ffe1000, isPointer: true, pointsTo: "x" },
    ];
    this.build();
    this.renderValues();
    requestAnimationFrame(() => this.drawArrow(true));
    window.addEventListener("resize", () => this.drawArrow(false));
  }

  varByName(name) {
    return this.vars.find((v) => v.name === name);
  }

  build() {
    const row = this.root.querySelector("#ptrRow");
    row.innerHTML = "";
    this.vars.forEach((v) => {
      const box = document.createElement("div");
      box.className = "ptr-box" + (v.isPointer ? " is-pointer" : "");
      box.id = "ptrbox-" + v.name;
      box.innerHTML = `
        <div class="ptr-decl">${v.isPointer ? "int *" : "int "}${v.name}</div>
        <div class="ptr-value" data-role="value"></div>
        <div class="ptr-addr">@ ${hex(v.addr, 8)}</div>`;
      row.appendChild(box);
    });
  }

  renderValues() {
    this.vars.forEach((v) => {
      const box = document.getElementById("ptrbox-" + v.name);
      const valEl = box.querySelector('[data-role="value"]');
      if (v.isPointer) {
        valEl.textContent = hex(v.value, 8);
      } else {
        // editable value for plain variables
        valEl.innerHTML = "";
        const input = document.createElement("input");
        input.type = "number";
        input.value = v.value;
        input.className = "ptr-input";
        input.addEventListener("input", () => {
          v.value = Number(input.value) || 0;
          Anim.flash(box, "flash");
        });
        valEl.appendChild(input);
      }
    });
  }

  /** Redraw the physical arrow from p's box to whatever it points at. */
  drawArrow(instant) {
    const p = this.varByName("p");
    const arrow = this.root.querySelector("#ptrArrow");
    const container = this.root.querySelector("#ptrStage");
    const fromEl = document.getElementById("ptrbox-p");
    const toEl = document.getElementById("ptrbox-" + p.pointsTo);
    if (!fromEl || !toEl || !container) return;
    const cRect = container.getBoundingClientRect();
    const fRect = fromEl.getBoundingClientRect();
    const tRect = toEl.getBoundingClientRect();

    const x1 = fRect.left + fRect.width / 2 - cRect.left;
    const y1 = fRect.top - cRect.top; // exit from top of the pointer box
    const x2 = tRect.left + tRect.width / 2 - cRect.left;
    const y2 = tRect.bottom - cRect.top; // arrive at bottom of the target box

    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

    if (instant) arrow.style.transition = "none";
    arrow.style.left = x1 + "px";
    arrow.style.top = y1 + "px";
    arrow.style.width = length + "px";
    arrow.style.transform = `rotate(${angle}deg)`;
    if (instant) {
      void arrow.offsetWidth;
      arrow.style.transition = "";
    }
  }

  retarget(name) {
    const p = this.varByName("p");
    const target = this.varByName(name);
    if (!target || p.pointsTo === name) return;
    p.pointsTo = name;
    p.value = target.addr;
    this.renderValues();
    this.drawArrow(false);
    Anim.flash(document.getElementById("ptrbox-p"), "flash");
  }

  reset() {
    this.varByName("x").value = 5;
    this.varByName("y").value = 99;
    this.retarget("x");
    this.renderValues();
    this.drawArrow(true);
  }
}

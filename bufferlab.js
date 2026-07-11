/* ============================================================
   bufferlab.js — Interactive "Buffer Overflow" lesson.
   Not driven by cpu.js: this is a focused byte-by-byte typing lab
   showing char buffer[32] overflow into Saved RBP and the Return
   Address, one keystroke at a time.
   ============================================================ */

const BUFFER_SIZE = 32;
const SAVEDRBP_SIZE = 8;
const RETADDR_SIZE = 8;
const BEYOND_SIZE = 8; // a few extra cells so overflow can keep going visibly
const TOTAL_CELLS = BUFFER_SIZE + SAVEDRBP_SIZE + RETADDR_SIZE + BEYOND_SIZE;

class BufferOverflowLab {
  constructor(root) {
    this.root = root;
    this.bytes = []; // array of single-char strings, index 0 = first typed
    this.render();
  }

  zoneFor(index) {
    if (index < BUFFER_SIZE) return { kind: "buffer", label: "Buffer (32 bytes)" };
    if (index < BUFFER_SIZE + SAVEDRBP_SIZE) return { kind: "savedrbp", label: "Saved RBP" };
    if (index < BUFFER_SIZE + SAVEDRBP_SIZE + RETADDR_SIZE) return { kind: "retaddr", label: "Return Address" };
    return { kind: "beyond", label: "Caller's Stack" };
  }

  addChar(ch) {
    if (this.bytes.length >= TOTAL_CELLS) return;
    const wasSafe = this.bytes.length <= BUFFER_SIZE;
    this.bytes.push(ch);
    this.render({ justAdded: true });
    const zone = this.zoneFor(this.bytes.length - 1);
    if (wasSafe && zone.kind === "savedrbp") this.flashWarning("⚠️ You've filled the buffer — now overwriting Saved RBP!");
    if (zone.kind === "retaddr" && this.bytes.length - 1 === BUFFER_SIZE + SAVEDRBP_SIZE) {
      this.flashWarning("🎯 Now overwriting the Return Address itself!");
    }
  }

  backspace() {
    if (!this.bytes.length) return;
    this.bytes.pop();
    this.render();
  }

  fillWith(char, count) {
    for (let i = 0; i < count && this.bytes.length < TOTAL_CELLS; i++) this.bytes.push(char);
    this.render({ justAdded: true });
  }

  reset() {
    this.bytes = [];
    this.render();
    this.setStatus("");
  }

  flashWarning(msg) {
    this.setStatus(msg, "warn");
  }

  setStatus(msg, cls = "") {
    const el = this.root.querySelector("#ofStatus");
    el.textContent = msg;
    el.className = "of-status " + cls;
    if (msg) Anim.flash(el, "flash");
  }

  bytesToHex(startIdx, len) {
    // Reconstruct len bytes starting at startIdx as one hex number.
    // Unfilled bytes render as 00. Shown big-endian (left→right = how
    // you typed it) since that reads intuitively for beginners.
    let out = "";
    for (let i = 0; i < len; i++) {
      const ch = this.bytes[startIdx + i];
      out += ch ? ch.charCodeAt(0).toString(16).padStart(2, "0") : "00";
    }
    return out.toUpperCase();
  }

  async triggerReturn() {
    const btn = this.root.querySelector("#ofRetBtn");
    btn.disabled = true;
    const retHex = this.bytesToHex(BUFFER_SIZE + SAVEDRBP_SIZE, RETADDR_SIZE);
    const retTouched = this.bytes.length > BUFFER_SIZE + SAVEDRBP_SIZE;
    const rbpTouched = this.bytes.length > BUFFER_SIZE;

    const retCell = this.root.querySelector('[data-idx="' + (BUFFER_SIZE + SAVEDRBP_SIZE) + '"]');
    const ripBox = this.root.querySelector("#ofRip");
    this.setStatus("RET pops the return address into RIP…", "");
    if (retCell) {
      Anim.pulse(retCell, "instr-retaddr", 700);
      await Anim.wait(300);
      await Anim.fly(retCell, ripBox, { text: "0x" + retHex, className: "ghost-value ghost-code" });
    }
    ripBox.querySelector(".rip-value").textContent = "0x" + retHex.padStart(16, "0");

    if (retTouched) {
      ripBox.classList.add("crashed");
      Anim.shake(ripBox);
      this.setStatus(
        "💥 RIP = 0x" + retHex.padStart(16, "0") + " — invalid address. You now control execution.",
        "danger"
      );
    } else if (rbpTouched) {
      this.setStatus("RBP was corrupted, but the return address survived — this time.", "warn");
    } else {
      ripBox.classList.remove("crashed");
      this.setStatus("✅ Return address was untouched. The function returns safely.", "ok");
    }
    btn.disabled = false;
  }

  render({ justAdded = false } = {}) {
    const grid = this.root.querySelector("#ofGrid");
    if (!grid.dataset.built) {
      grid.innerHTML = "";
      for (let i = 0; i < TOTAL_CELLS; i++) {
        const cell = document.createElement("div");
        cell.className = "of-cell";
        cell.dataset.idx = i;
        grid.appendChild(cell);
      }
      grid.dataset.built = "1";
      // zone divider labels
      this.buildZoneLabels();
    }
    const cells = grid.children;
    for (let i = 0; i < TOTAL_CELLS; i++) {
      const cell = cells[i];
      const zone = this.zoneFor(i);
      cell.className = "of-cell zone-" + zone.kind + (this.bytes[i] !== undefined ? " filled" : "");
      cell.textContent = this.bytes[i] !== undefined ? this.bytes[i] : "";
      if (i >= BUFFER_SIZE && this.bytes[i] !== undefined) cell.classList.add("corrupted");
    }
    if (justAdded) {
      const lastCell = cells[this.bytes.length - 1];
      if (lastCell) Anim.flash(lastCell, "slot-pop-in");
    }
    this.root.querySelector("#ofCount").textContent = `${Math.min(this.bytes.length, BUFFER_SIZE)}/${BUFFER_SIZE} bytes in buffer` +
      (this.bytes.length > BUFFER_SIZE ? `  •  ${this.bytes.length - BUFFER_SIZE} bytes past it` : "");
  }

  buildZoneLabels() {
    const wrap = this.root.querySelector("#ofZoneLabels");
    wrap.innerHTML = "";
    const zones = [
      ["buffer", "char buffer[32]", BUFFER_SIZE],
      ["savedrbp", "Saved RBP", SAVEDRBP_SIZE],
      ["retaddr", "Return Address", RETADDR_SIZE],
      ["beyond", "Caller's Stack", BEYOND_SIZE],
    ];
    zones.forEach(([kind, label, count]) => {
      const tag = document.createElement("div");
      tag.className = "of-zone-tag zone-" + kind;
      tag.style.flexBasis = (count / TOTAL_CELLS) * 100 + "%";
      tag.textContent = label;
      wrap.appendChild(tag);
    });
  }
}

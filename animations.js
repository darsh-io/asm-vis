/* ============================================================
   animations.js — Small reusable DOM animation helpers.
   Nothing here knows about the simulator; it just moves pixels.
   ============================================================ */

const Anim = {
  /** Briefly flash an element (register/stack slot) to show it changed. */
  flash(el, cls = "flash") {
    if (!el) return;
    el.classList.remove(cls);
    // Force reflow so the animation restarts even if triggered twice fast.
    void el.offsetWidth;
    el.classList.add(cls);
    el.addEventListener(
      "animationend",
      () => el.classList.remove(cls),
      { once: true }
    );
  },

  /** Add a class for `duration` ms then remove it. */
  pulse(el, cls, duration = 600) {
    if (!el) return;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), duration);
  },

  /**
   * Fly a ghost clone of `label` text from the rect of `fromEl` to the
   * rect of `toEl`, then resolve. Used for PUSH/POP/CALL/RET/ROP-gadget
   * "value physically moves" animations.
   */
  fly(fromEl, toEl, { text = "", duration = 550, className = "" } = {}) {
    return new Promise((resolve) => {
      if (!fromEl || !toEl) return resolve();
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      const ghost = document.createElement("div");
      ghost.className = "fly-ghost " + className;
      ghost.textContent = text;
      ghost.style.left = fromRect.left + "px";
      ghost.style.top = fromRect.top + "px";
      ghost.style.width = fromRect.width + "px";
      ghost.style.height = fromRect.height + "px";
      document.body.appendChild(ghost);

      requestAnimationFrame(() => {
        ghost.style.transition = `transform ${duration}ms cubic-bezier(.4,0,.2,1), opacity ${duration}ms`;
        const dx = toRect.left - fromRect.left;
        const dy = toRect.top - fromRect.top;
        ghost.style.transform = `translate(${dx}px, ${dy}px) scale(1.05)`;
      });

      setTimeout(() => {
        ghost.style.opacity = "0";
        setTimeout(() => {
          ghost.remove();
          resolve();
        }, 150);
      }, duration);
    });
  },

  /** Move an arrow element (RSP/RBP pointer) to sit beside `targetEl`. */
  moveArrowTo(arrowEl, targetEl, containerEl) {
    if (!arrowEl || !targetEl || !containerEl) return;
    const cRect = containerEl.getBoundingClientRect();
    const tRect = targetEl.getBoundingClientRect();
    const y = tRect.top - cRect.top + tRect.height / 2 + containerEl.scrollTop;
    arrowEl.style.transform = `translateY(${y}px)`;
    arrowEl.classList.remove("hidden");
  },

  /** Type text into an element one character at a time. */
  typewriter(el, text, speed = 18) {
    return new Promise((resolve) => {
      el.textContent = "";
      let i = 0;
      const tick = () => {
        if (i >= text.length) return resolve();
        el.textContent += text[i++];
        setTimeout(tick, speed);
      };
      tick();
    });
  },

  /** Simple promise-based delay. */
  wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  },

  /** Shake an element to indicate an invalid/crash state. */
  shake(el) {
    this.pulse(el, "shake", 500);
  },
};

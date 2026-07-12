/* ============================================================
   script.js — App bootstrap: lesson navigation, control wiring,
   play/pause loop, and instantiating the right view per lesson.
   ============================================================ */

(function () {
  "use strict";

  let currentLesson = null;
  let sim = null;
  let view = null;
  let isAnimating = false;
  let playTimer = null;
  let activeLab = null; // BufferOverflowLab | PieLab | PointerLab
  let sandboxSavedText = null; // remembers what you typed across Edit/Assemble toggles

  const views = {
    vm: document.getElementById("simView"),
    overflow: document.getElementById("overflowView"),
    pie: document.getElementById("pieView"),
    pointer: document.getElementById("pointerView"),
  };

  // -------------------------------------------------- lesson nav
  function buildNav() {
    const nav = document.getElementById("lessonNav");
    nav.innerHTML = "";
    LESSONS.forEach((lesson) => {
      const btn = document.createElement("button");
      btn.className = "nav-btn";
      btn.dataset.id = lesson.id;
      btn.innerHTML = `<span class="nav-icon">${lesson.icon}</span><span class="nav-label">${lesson.title}</span>`;
      btn.addEventListener("click", () => selectLesson(lesson.id));
      nav.appendChild(btn);
    });
  }

  function selectLesson(id) {
    stopPlaying();
    const lesson = LESSONS.find((l) => l.id === id);
    if (!lesson) return;
    currentLesson = lesson;

    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.id === id));
    Object.values(views).forEach((v) => v.classList.add("hidden"));
    document.getElementById("lessonIntro").textContent = lesson.intro;

    if (lesson.kind === "vm") {
      views.vm.classList.remove("hidden");
      leaveSandboxUI(); // in case Sandbox left the editor showing / instrList hidden
      sim = new Simulator(lesson.program);
      view = new SimulatorView(sim, lesson);
      view.predictMode = document.getElementById("predictToggle").checked;
      updateControlStates();
    } else if (lesson.kind === "sandbox") {
      views.vm.classList.remove("hidden");
      enterSandboxEditMode();
    } else {
      views[lesson.kind].classList.remove("hidden");
      if (lesson.kind === "overflow") activeLab = setupOverflowLab();
      if (lesson.kind === "pie") activeLab = setupPieLab();
      if (lesson.kind === "pointer") activeLab = setupPointerLab();
    }
  }

  // -------------------------------------------------- VM lesson controls
  async function doNext(interactive = true) {
    if (!sim || isAnimating || sim.atEnd()) return;
    isAnimating = true;
    updateControlStates();
    if (interactive) await view.maybePrompt();
    const diff = sim.step();
    await view.playDiff(diff);
    view.syncAll({ prevState: diff.before, animateFlags: diff.type === "cmp" });
    isAnimating = false;
    updateControlStates();
  }

  function doPrev() {
    if (!sim || isAnimating || sim.atStart()) return;
    stopPlaying();
    sim.prev();
    view.syncAll();
    updateControlStates();
  }

  function doRestart() {
    if (!sim) return;
    stopPlaying();
    sim.restart();
    view.stackNodes.clear();
    view.el.stackTrack.innerHTML = "";
    view.syncAll();
    updateControlStates();
  }

  function togglePlay() {
    if (playTimer) {
      stopPlaying();
      return;
    }
    document.getElementById("btnPlay").classList.add("hidden");
    document.getElementById("btnPause").classList.remove("hidden");
    const tick = async () => {
      if (!sim || sim.atEnd()) return stopPlaying();
      await doNext(false);
      if (sim && !sim.atEnd()) {
        playTimer = setTimeout(tick, Number(document.getElementById("speedRange").value));
      } else {
        stopPlaying();
      }
    };
    playTimer = setTimeout(tick, Number(document.getElementById("speedRange").value));
  }

  function stopPlaying() {
    clearTimeout(playTimer);
    playTimer = null;
    document.getElementById("btnPlay").classList.remove("hidden");
    document.getElementById("btnPause").classList.add("hidden");
  }

  function updateControlStates() {
    document.getElementById("btnNext").disabled = !sim || isAnimating || sim.atEnd();
    document.getElementById("btnPrev").disabled = !sim || isAnimating || sim.atStart();
    document.getElementById("btnPlay").disabled = !sim || sim.atEnd();
  }

  // -------------------------------------------------- Buffer Overflow lab
  function setupOverflowLab() {
    const root = document.getElementById("overflowView");
    const lab = new BufferOverflowLab(root);
    const input = root.querySelector("#ofInput");
    input.maxLength = TOTAL_CELLS;
    input.value = "";
    let lastValue = "";
    input.oninput = () => {
      const val = input.value;
      if (val.length > lastValue.length) {
        for (const ch of val.slice(lastValue.length)) lab.addChar(ch);
      } else if (val.length < lastValue.length) {
        for (let i = 0; i < lastValue.length - val.length; i++) lab.backspace();
      }
      lastValue = val;
    };
    root.querySelector("#ofFillBtn").onclick = () => {
      const remaining = TOTAL_CELLS - lab.bytes.length;
      lab.fillWith("A", Math.min(56, remaining));
      input.value = lab.bytes.join("");
      lastValue = input.value;
    };
    root.querySelector("#ofResetBtn").onclick = () => {
      lab.reset();
      input.value = "";
      lastValue = "";
      root.querySelector("#ofRip").classList.remove("crashed");
      root.querySelector("#ofRip .rip-value").textContent = "0x0000000000000000";
    };
    root.querySelector("#ofRetBtn").onclick = () => lab.triggerReturn();
    input.focus();
    return lab;
  }

  // -------------------------------------------------- PIE lab
  function setupPieLab() {
    const root = document.getElementById("pieView");
    const lab = new PieLab(root);
    root.querySelector("#pieNextBtn").onclick = () => lab.next();
    root.querySelector("#pieResetBtn").onclick = () => lab.reset();
    return lab;
  }

  // -------------------------------------------------- Pointer lab
  function setupPointerLab() {
    const root = document.getElementById("pointerView");
    const lab = new PointerLab(root);
    root.querySelector("#ptrToX").onclick = () => lab.retarget("x");
    root.querySelector("#ptrToY").onclick = () => lab.retarget("y");
    root.querySelector("#ptrResetBtn").onclick = () => lab.reset();
    return lab;
  }

  // -------------------------------------------------- Sandbox (write-your-own-asm)
  function buildCheatSheet() {
    const el = document.getElementById("asmCheatList");
    if (el.dataset.built) return;
    const mnemonics = ["mov", "push", "pop", "lea", "sub", "add", "call", "ret", "leave", "cmp", "jmp", "je", "jne", "nop"];
    el.innerHTML = mnemonics
      .map((m) => {
        const blurb = INSTRUCTION_BLURBS[MNEMONIC_MAP[m]] || "";
        return `<div class="asm-cheat-row"><span class="asm-cheat-mnem">${m}</span><span>${blurb}</span></div>`;
      })
      .join("");
    el.dataset.built = "1";
  }

  /** Restore panel-instr to its normal (non-sandbox) look. Shared markup
   *  lives inside #simView, so any lesson that reuses that view must
   *  undo whatever edit/run state Sandbox left behind. */
  function leaveSandboxUI() {
    document.getElementById("simView").classList.remove("sandbox-idle");
    document.getElementById("asmEditorPanel").classList.add("hidden");
    document.getElementById("instrList").classList.remove("hidden");
    document.getElementById("asmEditBtn").classList.add("hidden");
    document.querySelector(".controls").classList.remove("hidden");
    document.querySelector(".speed-row").classList.remove("hidden");
  }

  function enterSandboxEditMode() {
    buildCheatSheet();
    sim = null;
    view = null;
    document.getElementById("simView").classList.add("sandbox-idle");
    document.getElementById("asmEditorPanel").classList.remove("hidden");
    document.getElementById("instrList").classList.add("hidden");
    document.getElementById("gadgetPanel").classList.add("hidden");
    document.getElementById("asmEditBtn").classList.add("hidden");
    document.querySelector(".controls").classList.add("hidden");
    document.querySelector(".speed-row").classList.add("hidden");
    document.getElementById("asmErrors").classList.add("hidden");
    const editor = document.getElementById("asmEditor");
    editor.value = sandboxSavedText !== null ? sandboxSavedText : SANDBOX_TEMPLATE;
    updateControlStates();
  }

  function assembleSandbox() {
    const editor = document.getElementById("asmEditor");
    sandboxSavedText = editor.value;
    const { program, errors } = parseAssembly(editor.value);
    const errBox = document.getElementById("asmErrors");

    if (!program.length) errors.push({ line: 1, message: "Write at least one instruction first." });
    if (errors.length) {
      errBox.classList.remove("hidden");
      errBox.innerHTML = errors.map((e) => `<div>Line ${e.line}: ${escapeHtml(e.message)}</div>`).join("");
      return;
    }
    errBox.classList.add("hidden");
    stopPlaying();

    sim = new Simulator(program);
    view = new SimulatorView(sim, { id: "sandbox", title: "Sandbox" });
    view.predictMode = document.getElementById("predictToggle").checked;

    document.getElementById("simView").classList.remove("sandbox-idle");
    document.getElementById("asmEditorPanel").classList.add("hidden");
    document.getElementById("instrList").classList.remove("hidden");
    document.getElementById("asmEditBtn").classList.remove("hidden");
    document.querySelector(".controls").classList.remove("hidden");
    document.querySelector(".speed-row").classList.remove("hidden");
    updateControlStates();
  }

  function wireSandbox() {
    document.getElementById("asmAssembleBtn").addEventListener("click", assembleSandbox);
    document.getElementById("asmResetBtn").addEventListener("click", () => {
      sandboxSavedText = SANDBOX_TEMPLATE;
      document.getElementById("asmEditor").value = SANDBOX_TEMPLATE;
    });
    document.getElementById("asmEditBtn").addEventListener("click", () => {
      stopPlaying();
      enterSandboxEditMode();
    });
  }

  // -------------------------------------------------- global control wiring
  function wireControls() {
    document.getElementById("btnNext").addEventListener("click", doNext);
    document.getElementById("btnPrev").addEventListener("click", doPrev);
    document.getElementById("btnRestart").addEventListener("click", doRestart);
    document.getElementById("btnPlay").addEventListener("click", togglePlay);
    document.getElementById("btnPause").addEventListener("click", stopPlaying);
    document.getElementById("predictToggle").addEventListener("change", (e) => {
      if (view) view.predictMode = e.target.checked;
    });
    wireSandbox();

    document.addEventListener("keydown", (e) => {
      if (!currentLesson || (currentLesson.kind !== "vm" && currentLesson.kind !== "sandbox")) return;
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "ArrowRight") doNext();
      if (e.key === "ArrowLeft") doPrev();
      if (e.key === "r" || e.key === "R") doRestart();
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      }
    });
  }

  // -------------------------------------------------- boot
  document.addEventListener("DOMContentLoaded", () => {
    buildNav();
    wireControls();
    selectLesson(LESSONS[0].id);
  });
})();

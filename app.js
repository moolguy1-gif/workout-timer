/* ============================================================
   운동 타이머 - app.js
   ============================================================ */

const RING_R = 140;
const RING_C = 2 * Math.PI * RING_R;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function setRing(el, remaining, total) {
  const ratio = total > 0 ? clamp(remaining / total, 0, 1) : 0;
  const offset = RING_C * (1 - ratio);
  el.style.strokeDasharray = `${RING_C}`;
  el.style.strokeDashoffset = `${offset}`;
}

/* ------------------------------------------------------------
   Storage
   ------------------------------------------------------------ */
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
};

/* ------------------------------------------------------------
   Sound + Vibration
   ------------------------------------------------------------ */
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
}

function beep(freq, startTime, duration, gain) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, startTime);
  g.gain.linearRampToValueAtTime(gain, startTime + 0.01);
  g.gain.linearRampToValueAtTime(0, startTime + duration);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

function playChime(kind) {
  ensureAudio();
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  if (kind === "tick") {
    beep(880, now, 0.12, 0.25);
    beep(880, now + 0.16, 0.12, 0.25);
  } else if (kind === "final") {
    beep(660, now, 0.15, 0.3);
    beep(880, now + 0.18, 0.15, 0.3);
    beep(1100, now + 0.36, 0.28, 0.32);
  }
}

function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function alertFinal() { playChime("final"); vibrate([250, 120, 250, 120, 250]); }
function alertTick()  { playChime("tick");  vibrate([150, 80, 150]); }

/* ------------------------------------------------------------
   Wake Lock
   ------------------------------------------------------------ */
let wakeLock = null;
async function refreshWakeLock() {
  const shouldHold = rest.running || interval.running || sw.running || (routine.started && !routine.finished);
  try {
    if (shouldHold && !wakeLock && "wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!shouldHold && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (e) { /* ignore - not fatal */ }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshWakeLock();
});

/* ============================================================
   TAB SWITCHING
   ============================================================ */
$$(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach(t => { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
    tab.classList.add("active"); tab.setAttribute("aria-selected", "true");
    $$(".view").forEach(v => v.classList.remove("active"));
    $(`#view-${tab.dataset.mode}`).classList.add("active");
  });
});

/* ============================================================
   REST TIMER
   ============================================================ */
const rest = {
  duration: store.get("wt_restDuration", 90),
  remaining: 0,
  running: false,
  paused: false,
  started: false,
  endAt: 0,
  pausedRemaining: 0,
  rounds: store.get("wt_restRounds", 0)
};
rest.remaining = rest.duration;

const restRing = $("#rest-ring");
const restTimeEl = $("#rest-time");
const restStatusEl = $("#rest-status");
const restRoundsEl = $("#rest-rounds");
const restMainBtn = $("#rest-main");
const restPauseBtn = $("#rest-pause");
const restWrap = restRing.closest(".ring-wrap");

function syncRestChipSelection() {
  $$("#rest-presets .chip").forEach(c => {
    c.classList.toggle("selected", Number(c.dataset.sec) === rest.duration);
  });
}

function renderRest() {
  restTimeEl.textContent = formatTime(rest.remaining);
  setRing(restRing, rest.remaining, rest.duration);
  restRoundsEl.textContent = `완료한 세트 ${rest.rounds}회`;

  if (!rest.started) {
    restStatusEl.textContent = "쉬는 시간";
    restMainBtn.textContent = "시작";
    restMainBtn.classList.remove("running");
    restPauseBtn.disabled = true;
    restPauseBtn.textContent = "일시정지";
    restWrap.classList.remove("pulse");
    $("#rest-setter").style.opacity = "1";
    $("#rest-presets").style.opacity = "1";
  } else {
    restStatusEl.textContent = rest.paused ? "일시정지됨" : (rest.remaining <= 0 ? "완료!" : "휴식 중");
    restMainBtn.textContent = "리셋";
    restMainBtn.classList.add("running");
    restPauseBtn.disabled = false;
    restPauseBtn.textContent = rest.paused ? "재개" : "일시정지";
    restWrap.classList.toggle("pulse", rest.remaining <= 0);
    $("#rest-setter").style.opacity = ".35";
    $("#rest-presets").style.opacity = ".35";
  }
}

function tickRest() {
  if (!rest.running || rest.paused) return;
  const remaining = (rest.endAt - Date.now()) / 1000;
  if (remaining <= 0) {
    rest.remaining = 0;
    rest.running = false;
    rest.rounds += 1;
    store.set("wt_restRounds", rest.rounds);
    alertFinal();
    renderRest();
    refreshWakeLock();
    return;
  }
  rest.remaining = remaining;
  renderRest();
}

function startRest() {
  ensureAudio();
  rest.running = true;
  rest.paused = false;
  rest.started = true;
  rest.remaining = rest.duration;
  rest.endAt = Date.now() + rest.duration * 1000;
  renderRest();
  refreshWakeLock();
}

function resetRest() {
  rest.running = false;
  rest.paused = false;
  rest.started = false;
  rest.remaining = rest.duration;
  renderRest();
  refreshWakeLock();
}

function togglePauseRest() {
  if (!rest.running) return;
  if (rest.paused) {
    rest.paused = false;
    rest.endAt = Date.now() + rest.remaining * 1000;
  } else {
    rest.paused = true;
    rest.pausedRemaining = rest.remaining;
  }
  renderRest();
}

restMainBtn.addEventListener("click", () => {
  if (!rest.started) {
    startRest();
  } else {
    resetRest();
  }
});
restPauseBtn.addEventListener("click", togglePauseRest);

$$("#rest-setter .stepper").forEach(btn => {
  btn.addEventListener("click", () => {
    if (rest.running) return;
    const delta = Number(btn.dataset.delta);
    rest.duration = clamp(rest.duration + delta, 5, 3600);
    rest.remaining = rest.duration;
    store.set("wt_restDuration", rest.duration);
    syncRestChipSelection();
    renderRest();
  });
});

$$("#rest-presets .chip").forEach(chip => {
  chip.addEventListener("click", () => {
    if (rest.running) return;
    rest.duration = Number(chip.dataset.sec);
    rest.remaining = rest.duration;
    store.set("wt_restDuration", rest.duration);
    syncRestChipSelection();
    renderRest();
  });
});

syncRestChipSelection();
renderRest();

/* ============================================================
   INTERVAL TIMER
   ============================================================ */
const DEFAULT_STAGES = [
  { id: "s1", intensity: "high", label: "고강도", duration: 40 },
  { id: "s2", intensity: "low",  label: "휴식",   duration: 20 }
];

const interval = {
  stages: store.get("wt_intervalStages", DEFAULT_STAGES),
  repeat: store.get("wt_intervalRepeat", 3),
  stageIdx: 0,
  rep: 1,
  remaining: 0,
  running: false,
  paused: false,
  started: false,
  endAt: 0
};
if (!interval.stages.length) interval.stages = DEFAULT_STAGES.slice();
interval.remaining = interval.stages[0].duration;

const intervalRing = $("#interval-ring");
const intervalTimeEl = $("#interval-time");
const intervalStageLabelEl = $("#interval-stage-label");
const intervalRoundsEl = $("#interval-rounds");
const intervalMainBtn = $("#interval-main");
const intervalResetBtn = $("#interval-reset");
const intervalSkipBtn = $("#interval-skip");
const intervalTimelineEl = $("#interval-timeline");
const intervalWrap = intervalRing.closest(".ring-wrap");

function currentStage() { return interval.stages[interval.stageIdx]; }

function renderIntervalTimeline() {
  intervalTimelineEl.innerHTML = "";
  const totalDur = interval.stages.reduce((a, s) => a + s.duration, 0) || 1;
  interval.stages.forEach((s, i) => {
    const seg = document.createElement("div");
    seg.className = `timeline-seg ${s.intensity}`;
    seg.style.width = `${(s.duration / totalDur) * 100}%`;
    seg.dataset.idx = i;
    intervalTimelineEl.appendChild(seg);
  });
  updateIntervalTimelineState();
}

function updateIntervalTimelineState() {
  $$(".timeline-seg", intervalTimelineEl).forEach(seg => {
    const i = Number(seg.dataset.idx);
    seg.classList.toggle("active", i === interval.stageIdx && (interval.running || interval.paused));
    seg.classList.toggle("done", i < interval.stageIdx);
  });
}

function renderInterval() {
  const stage = currentStage();
  intervalTimeEl.textContent = formatTime(interval.remaining);
  setRing(intervalRing, interval.remaining, stage.duration);
  intervalRing.classList.remove("high", "mid", "low");
  intervalRing.classList.add(stage.intensity);
  intervalRoundsEl.textContent = `${interval.rep} / ${interval.repeat}라운드 · ${interval.stageIdx + 1}단계`;
  updateIntervalTimelineState();

  if (!interval.started) {
    intervalStageLabelEl.textContent = "대기 중";
    intervalMainBtn.textContent = "시작";
    intervalMainBtn.classList.remove("running");
    intervalResetBtn.disabled = false;
    intervalSkipBtn.disabled = true;
    intervalWrap.classList.remove("pulse");
  } else {
    intervalStageLabelEl.textContent = interval.paused ? "일시정지됨" : stage.label;
    intervalMainBtn.textContent = interval.paused ? "재개" : "일시정지";
    intervalMainBtn.classList.toggle("running", !interval.paused);
    intervalResetBtn.disabled = false;
    intervalSkipBtn.disabled = false;
    intervalWrap.classList.toggle("pulse", interval.remaining <= 1 && !interval.paused);
  }
}

function goToStage(stageIdx, rep) {
  interval.stageIdx = stageIdx;
  interval.rep = rep;
  interval.remaining = interval.stages[stageIdx].duration;
  interval.endAt = Date.now() + interval.remaining * 1000;
}

function advanceInterval() {
  const isLastStage = interval.stageIdx >= interval.stages.length - 1;
  if (!isLastStage) {
    goToStage(interval.stageIdx + 1, interval.rep);
    alertTick();
    renderInterval();
    return;
  }
  if (interval.rep < interval.repeat) {
    goToStage(0, interval.rep + 1);
    alertTick();
    renderInterval();
    return;
  }
  // fully complete
  interval.running = false;
  interval.paused = false;
  interval.started = true;
  alertFinal();
  intervalStageLabelEl.textContent = "운동 완료!";
  renderInterval();
  refreshWakeLock();
  setTimeout(() => {
    if (!interval.running) resetInterval();
  }, 2500);
}

function tickInterval() {
  if (!interval.running || interval.paused) return;
  const remaining = (interval.endAt - Date.now()) / 1000;
  if (remaining <= 0) {
    advanceInterval();
    return;
  }
  interval.remaining = remaining;
  renderInterval();
}

function startInterval() {
  ensureAudio();
  if (!interval.started) {
    goToStage(0, 1);
  }
  interval.running = true;
  interval.paused = false;
  interval.started = true;
  renderInterval();
  refreshWakeLock();
}

function resetInterval() {
  interval.running = false;
  interval.paused = false;
  interval.started = false;
  interval.stageIdx = 0;
  interval.rep = 1;
  interval.remaining = interval.stages[0].duration;
  renderInterval();
  refreshWakeLock();
}

function togglePauseOrStartInterval() {
  if (!interval.started) {
    startInterval();
  } else if (interval.paused) {
    interval.paused = false;
    interval.endAt = Date.now() + interval.remaining * 1000;
    renderInterval();
  } else {
    interval.paused = true;
    renderInterval();
  }
}

intervalMainBtn.addEventListener("click", togglePauseOrStartInterval);
intervalResetBtn.addEventListener("click", resetInterval);
intervalSkipBtn.addEventListener("click", () => {
  if (!interval.started) return;
  advanceInterval();
});

renderIntervalTimeline();
renderInterval();

/* ---------------- Interval edit modal ---------------- */
const editModal = $("#edit-modal");
const stageListEl = $("#stage-list");
const stageRowTpl = $("#stage-row-template");
const repeatLabelEl = $("#repeat-count-label");

let workingStages = [];
let workingRepeat = 3;

function intensityLabel(intensity) {
  return intensity === "high" ? "고강도" : intensity === "mid" ? "중강도" : "저강도";
}

function buildStageRow(stage) {
  const node = stageRowTpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = stage.id;
  node.dataset.intensity = stage.intensity;

  const intensitySel = $(".stage-intensity", node);
  intensitySel.value = stage.intensity;

  const labelInput = $(".stage-label", node);
  labelInput.value = stage.label;
  labelInput.placeholder = intensityLabel(stage.intensity);

  const durLabel = $(".stage-duration-label", node);
  durLabel.textContent = formatTime(stage.duration);
  node.dataset.duration = stage.duration;

  intensitySel.addEventListener("change", () => {
    node.dataset.intensity = intensitySel.value;
    if (!labelInput.value || labelInput.value === intensityLabel(stage.intensity)) {
      labelInput.value = intensityLabel(intensitySel.value);
    }
    labelInput.placeholder = intensityLabel(intensitySel.value);
    stage.intensity = intensitySel.value;
  });

  $$(".mini-stepper", node).forEach(btn => {
    btn.addEventListener("click", () => {
      let d = Number(node.dataset.duration) + Number(btn.dataset.miniDelta);
      d = clamp(d, 5, 3600);
      node.dataset.duration = d;
      durLabel.textContent = formatTime(d);
    });
  });

  $(".move-up", node).addEventListener("click", () => {
    const prev = node.previousElementSibling;
    if (prev) stageListEl.insertBefore(node, prev);
  });
  $(".move-down", node).addEventListener("click", () => {
    const next = node.nextElementSibling;
    if (next) stageListEl.insertBefore(next, node);
  });
  $(".delete-stage", node).addEventListener("click", () => {
    if (stageListEl.children.length <= 1) return;
    node.remove();
  });

  return node;
}

function openEditModal() {
  stageListEl.innerHTML = "";
  workingRepeat = interval.repeat;
  repeatLabelEl.textContent = workingRepeat;
  interval.stages.forEach(s => stageListEl.appendChild(buildStageRow({ ...s })));
  editModal.classList.add("open");
}

function closeEditModal() { editModal.classList.remove("open"); }

$("#interval-edit-open").addEventListener("click", openEditModal);
$("#edit-cancel").addEventListener("click", closeEditModal);

$$("[data-repeat-delta]").forEach(btn => {
  btn.addEventListener("click", () => {
    workingRepeat = clamp(workingRepeat + Number(btn.dataset.repeatDelta), 1, 50);
    repeatLabelEl.textContent = workingRepeat;
  });
});

$("#stage-add").addEventListener("click", () => {
  const newStage = {
    id: "s" + Date.now(),
    intensity: "mid",
    label: intensityLabel("mid"),
    duration: 30
  };
  stageListEl.appendChild(buildStageRow(newStage));
  stageListEl.scrollTop = stageListEl.scrollHeight;
});

$("#edit-save").addEventListener("click", () => {
  const rows = $$(".stage-row", stageListEl);
  const newStages = rows.map((row, i) => {
    const intensity = row.dataset.intensity;
    const labelInput = $(".stage-label", row);
    return {
      id: row.dataset.id || ("s" + i),
      intensity,
      label: labelInput.value.trim() || intensityLabel(intensity),
      duration: Number(row.dataset.duration)
    };
  });
  if (!newStages.length) { closeEditModal(); return; }

  interval.stages = newStages;
  interval.repeat = workingRepeat;
  store.set("wt_intervalStages", interval.stages);
  store.set("wt_intervalRepeat", interval.repeat);

  resetInterval();
  renderIntervalTimeline();
  closeEditModal();
});

editModal.addEventListener("click", (e) => {
  if (e.target === editModal) closeEditModal();
});

/* ============================================================
   STOPWATCH
   ============================================================ */
const sw = {
  running: false,
  baseMs: 0,
  startedAt: 0,
  laps: []
};

const swTimeEl = $("#sw-time");
const swMainBtn = $("#sw-main");
const swLapBtn = $("#sw-lap");
const swResetBtn = $("#sw-reset");
const swLapsEl = $("#sw-laps");

function formatSw(ms) {
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const cs = Math.floor((total % 1000) / 10);
  return { main: `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`, cs: String(cs).padStart(2, "0") };
}

function swElapsed() {
  return sw.baseMs + (sw.running ? Date.now() - sw.startedAt : 0);
}

function renderSw() {
  const t = formatSw(swElapsed());
  swTimeEl.innerHTML = `${t.main}<small>.${t.cs}</small>`;
  swMainBtn.textContent = sw.running ? "정지" : (sw.baseMs > 0 ? "재개" : "시작");
  swMainBtn.classList.toggle("running", sw.running);
  swLapBtn.disabled = !sw.running;
  swResetBtn.disabled = sw.running === false && sw.baseMs === 0;
}

function toggleSw() {
  ensureAudio();
  if (sw.running) {
    sw.baseMs = swElapsed();
    sw.running = false;
  } else {
    sw.startedAt = Date.now();
    sw.running = true;
  }
  renderSw();
  refreshWakeLock();
}

function resetSw() {
  sw.running = false;
  sw.baseMs = 0;
  sw.laps = [];
  swLapsEl.innerHTML = "";
  renderSw();
  refreshWakeLock();
}

function lapSw() {
  if (!sw.running) return;
  const elapsed = swElapsed();
  const prevTotal = sw.laps.length ? sw.laps[sw.laps.length - 1].total : 0;
  const lapTime = elapsed - prevTotal;
  sw.laps.push({ total: elapsed, lap: lapTime });
  const li = document.createElement("li");
  const t1 = formatSw(lapTime);
  const t2 = formatSw(elapsed);
  li.innerHTML = `<span>${sw.laps.length}랩 · ${t1.main}.${t1.cs}</span><span>${t2.main}.${t2.cs}</span>`;
  swLapsEl.prepend(li);
}

swMainBtn.addEventListener("click", toggleSw);
swResetBtn.addEventListener("click", resetSw);
swLapBtn.addEventListener("click", lapSw);

renderSw();

/* ============================================================
   ROUTINE (전체 운동 세션: 여러 운동 × 세트 × 휴식)
   ============================================================ */
const DEFAULT_ROUTINE_PLAN = [
  { id: "e1", name: "", targetSets: 4, restSeconds: 90 }
];

const routine = {
  plan: store.get("wt_routinePlan", DEFAULT_ROUTINE_PLAN),
  started: false,
  finished: false,
  sessionStartAt: 0,
  exerciseIdx: 0,
  currentSets: 0,
  restRunning: false,
  restDuration: 0,
  restRemaining: 0,
  restEndAt: 0,
  log: []
};
if (!routine.plan.length) routine.plan = DEFAULT_ROUTINE_PLAN.slice();

const routineSetupEl = $("#routine-setup");
const routineActiveEl = $("#routine-active");
const routineSummaryEl = $("#routine-summary");
const routineExerciseListEl = $("#routine-exercise-list");
const routineExerciseRowTpl = $("#routine-exercise-row-template");

const routineElapsedEl = $("#routine-elapsed");
const routineRing = $("#routine-ring");
const routineTimeEl = $("#routine-time");
const routineStatusEl = $("#routine-status");
const routineProgressLabelEl = $("#routine-progress-label");
const routineMainBtn = $("#routine-main");
const routineResetSetsBtn = $("#routine-reset-sets");
const routineFinishExerciseBtn = $("#routine-finish-exercise");
const routineQuitBtn = $("#routine-quit");
const routineWrap = routineRing.closest(".ring-wrap");

function formatElapsed(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function saveRoutinePlan() { store.set("wt_routinePlan", routine.plan); }

/* ---------------- setup screen ---------------- */
function buildExerciseRow(ex) {
  const node = routineExerciseRowTpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = ex.id;

  const nameInput = $(".exercise-name", node);
  nameInput.value = ex.name;
  nameInput.addEventListener("input", () => { ex.name = nameInput.value; saveRoutinePlan(); });

  const setsLabel = $(".exercise-sets-label", node);
  setsLabel.textContent = ex.targetSets;
  $$(".mini-stepper[data-sets-delta]", node).forEach(btn => {
    btn.addEventListener("click", () => {
      ex.targetSets = clamp(ex.targetSets + Number(btn.dataset.setsDelta), 1, 30);
      setsLabel.textContent = ex.targetSets;
      saveRoutinePlan();
    });
  });

  const restLabel = $(".exercise-rest-label", node);
  restLabel.textContent = formatTime(ex.restSeconds);
  $$(".mini-stepper[data-rest-delta]", node).forEach(btn => {
    btn.addEventListener("click", () => {
      ex.restSeconds = clamp(ex.restSeconds + Number(btn.dataset.restDelta), 5, 3600);
      restLabel.textContent = formatTime(ex.restSeconds);
      saveRoutinePlan();
    });
  });

  $(".move-up", node).addEventListener("click", () => {
    const prev = node.previousElementSibling;
    if (prev) { routineExerciseListEl.insertBefore(node, prev); syncPlanOrderFromDom(); }
  });
  $(".move-down", node).addEventListener("click", () => {
    const next = node.nextElementSibling;
    if (next) { routineExerciseListEl.insertBefore(next, node); syncPlanOrderFromDom(); }
  });
  $(".delete-exercise", node).addEventListener("click", () => {
    if (routineExerciseListEl.children.length <= 1) return;
    node.remove();
    syncPlanOrderFromDom();
  });

  return node;
}

function syncPlanOrderFromDom() {
  const rows = $$(".exercise-row", routineExerciseListEl);
  const byId = new Map(routine.plan.map(e => [e.id, e]));
  routine.plan = rows.map(r => byId.get(r.dataset.id)).filter(Boolean);
  saveRoutinePlan();
}

function renderRoutineSetup() {
  routineExerciseListEl.innerHTML = "";
  routine.plan.forEach(ex => routineExerciseListEl.appendChild(buildExerciseRow(ex)));
}

$("#routine-exercise-add").addEventListener("click", () => {
  const ex = { id: "e" + Date.now(), name: "", targetSets: 4, restSeconds: 90 };
  routine.plan.push(ex);
  routineExerciseListEl.appendChild(buildExerciseRow(ex));
  saveRoutinePlan();
  routineExerciseListEl.scrollTop = routineExerciseListEl.scrollHeight;
});

$("#routine-start-btn").addEventListener("click", () => {
  routine.plan.forEach((ex, i) => { if (!ex.name.trim()) ex.name = `운동 ${i + 1}`; });
  saveRoutinePlan();
  renderRoutineSetup();
  startRoutine();
});

/* ---------------- active session ---------------- */
function currentExercise() { return routine.plan[routine.exerciseIdx]; }

function initExerciseRest() {
  const ex = currentExercise();
  routine.restDuration = ex.restSeconds;
  routine.restRemaining = ex.restSeconds;
  routine.restRunning = false;
}

function startRoutine() {
  ensureAudio();
  routine.started = true;
  routine.finished = false;
  routine.sessionStartAt = Date.now();
  routine.exerciseIdx = 0;
  routine.currentSets = 0;
  routine.log = [];
  initExerciseRest();

  routineSetupEl.classList.add("hidden");
  routineSummaryEl.classList.add("hidden");
  routineActiveEl.classList.remove("hidden");

  renderRoutineActive();
  refreshWakeLock();
}

function renderRoutineActive() {
  const ex = currentExercise();
  const shownRemaining = routine.restRunning ? routine.restRemaining : routine.restDuration;
  routineTimeEl.textContent = formatTime(shownRemaining);
  setRing(routineRing, shownRemaining, routine.restDuration || 1);
  routineProgressLabelEl.textContent = `${ex.name} · ${routine.currentSets}/${ex.targetSets}세트`;

  const isLast = routine.exerciseIdx >= routine.plan.length - 1;
  routineFinishExerciseBtn.textContent = isLast ? "운동 종료" : "다음 운동으로";

  if (routine.restRunning) {
    routineStatusEl.textContent = routine.restRemaining <= 0 ? "휴식 종료!" : "휴식 중";
    routineMainBtn.textContent = "휴식 건너뛰기";
    routineMainBtn.classList.add("running");
    routineWrap.classList.toggle("pulse", routine.restRemaining <= 0);
  } else {
    routineStatusEl.textContent = "세트 준비";
    routineMainBtn.textContent = "세트 완료";
    routineMainBtn.classList.remove("running");
    routineWrap.classList.remove("pulse");
  }
}

function tickRoutineElapsed() {
  if (!routine.started || routine.finished) return;
  routineElapsedEl.textContent = formatElapsed(Date.now() - routine.sessionStartAt);
}

function tickRoutineRest() {
  if (!routine.started || routine.finished || !routine.restRunning) return;
  const remaining = (routine.restEndAt - Date.now()) / 1000;
  if (remaining <= 0) {
    routine.restRunning = false;
    routine.restRemaining = routine.restDuration;
    alertTick();
    renderRoutineActive();
    return;
  }
  routine.restRemaining = remaining;
  renderRoutineActive();
}

function routineMainAction() {
  ensureAudio();
  if (!routine.restRunning) {
    routine.currentSets += 1;
    routine.restRunning = true;
    routine.restRemaining = routine.restDuration;
    routine.restEndAt = Date.now() + routine.restDuration * 1000;
  } else {
    routine.restRunning = false;
    routine.restRemaining = routine.restDuration;
  }
  renderRoutineActive();
}

function adjustRoutineRest(delta) {
  const ex = currentExercise();
  ex.restSeconds = clamp(ex.restSeconds + delta, 5, 3600);
  routine.restDuration = ex.restSeconds;
  if (routine.restRunning) {
    routine.restEndAt += delta * 1000;
    routine.restRemaining = Math.max(0, (routine.restEndAt - Date.now()) / 1000);
  } else {
    routine.restRemaining = routine.restDuration;
  }
  saveRoutinePlan();
  renderRoutineActive();
}

function resetCurrentExerciseSets() {
  if (routine.currentSets === 0 && !routine.restRunning) return;
  if (!confirm(`${currentExercise().name}의 세트 기록을 처음부터 다시 시작할까요?`)) return;
  routine.currentSets = 0;
  routine.restRunning = false;
  routine.restRemaining = routine.restDuration;
  renderRoutineActive();
}

/* ---------------- next-exercise modal ---------------- */
const nextExerciseModal = $("#next-exercise-modal");
let nextExerciseDraft = null;

function openNextExerciseModal() {
  const next = routine.plan[routine.exerciseIdx + 1];
  nextExerciseDraft = { ...next };
  $("#next-exercise-title").textContent = `다음 운동: ${next.name}`;
  $("#next-exercise-sets-label").textContent = nextExerciseDraft.targetSets;
  $("#next-exercise-rest-label").textContent = formatTime(nextExerciseDraft.restSeconds);
  nextExerciseModal.classList.add("open");
}

$$("[data-nsets-delta]").forEach(btn => {
  btn.addEventListener("click", () => {
    nextExerciseDraft.targetSets = clamp(nextExerciseDraft.targetSets + Number(btn.dataset.nsetsDelta), 1, 30);
    $("#next-exercise-sets-label").textContent = nextExerciseDraft.targetSets;
  });
});
$$("[data-nrest-delta]").forEach(btn => {
  btn.addEventListener("click", () => {
    nextExerciseDraft.restSeconds = clamp(nextExerciseDraft.restSeconds + Number(btn.dataset.nrestDelta), 5, 3600);
    $("#next-exercise-rest-label").textContent = formatTime(nextExerciseDraft.restSeconds);
  });
});

$("#next-exercise-confirm").addEventListener("click", () => {
  const next = routine.plan[routine.exerciseIdx + 1];
  next.targetSets = nextExerciseDraft.targetSets;
  next.restSeconds = nextExerciseDraft.restSeconds;
  saveRoutinePlan();

  routine.exerciseIdx += 1;
  routine.currentSets = 0;
  initExerciseRest();

  nextExerciseModal.classList.remove("open");
  renderRoutineActive();
});

nextExerciseModal.addEventListener("click", (e) => {
  if (e.target === nextExerciseModal) { /* require explicit choice - do nothing on backdrop tap */ }
});

/* ---------------- finish / summary ---------------- */
function finishRoutine() {
  routine.finished = true;
  routineActiveEl.classList.add("hidden");
  routineSummaryEl.classList.remove("hidden");

  const totalMs = Date.now() - routine.sessionStartAt;
  $("#routine-total-time").textContent = `총 운동 시간 ${formatElapsed(totalMs)}`;

  const listEl = $("#routine-summary-list");
  listEl.innerHTML = "";
  routine.log.forEach(item => {
    const li = document.createElement("li");
    const nameSpan = document.createElement("span");
    nameSpan.textContent = item.name;
    const setSpan = document.createElement("span");
    setSpan.textContent = `${item.setsCompleted}세트`;
    li.appendChild(nameSpan);
    li.appendChild(setSpan);
    listEl.appendChild(li);
  });

  refreshWakeLock();
}

routineFinishExerciseBtn.addEventListener("click", () => {
  const ex = currentExercise();
  routine.log.push({ name: ex.name, setsCompleted: routine.currentSets });

  const isLast = routine.exerciseIdx >= routine.plan.length - 1;
  if (isLast) {
    finishRoutine();
  } else {
    openNextExerciseModal();
  }
});

routineQuitBtn.addEventListener("click", () => {
  if (!confirm("지금까지 기록을 저장하고 전체 운동을 종료할까요? (남은 운동은 생략됩니다)")) return;
  const ex = currentExercise();
  routine.log.push({ name: ex.name, setsCompleted: routine.currentSets });
  finishRoutine();
});

routineMainBtn.addEventListener("click", routineMainAction);
routineResetSetsBtn.addEventListener("click", resetCurrentExerciseSets);

$$("#routine-rest-setter .stepper").forEach(btn => {
  btn.addEventListener("click", () => adjustRoutineRest(Number(btn.dataset.routineDelta)));
});

$("#routine-restart").addEventListener("click", () => {
  routine.started = false;
  routine.finished = false;
  routine.exerciseIdx = 0;
  routine.currentSets = 0;
  routine.log = [];
  routineSummaryEl.classList.add("hidden");
  routineActiveEl.classList.add("hidden");
  routineSetupEl.classList.remove("hidden");
  renderRoutineSetup();
});

renderRoutineSetup();

/* ============================================================
   MASTER TICK LOOP
   ============================================================ */
setInterval(() => {
  tickRest();
  tickInterval();
  if (sw.running) renderSw();
  tickRoutineRest();
  tickRoutineElapsed();
}, 100);

/* ============================================================
   URL SHORTCUT SUPPORT (?mode=rest / ?mode=interval / ?mode=stopwatch)
   ============================================================ */
(function applyModeFromUrl() {
  const mode = new URLSearchParams(location.search).get("mode");
  if (!mode) return;
  const tab = $(`.tab[data-mode="${mode}"]`);
  if (tab) tab.click();
})();

/* ============================================================
   SERVICE WORKER
   ============================================================ */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

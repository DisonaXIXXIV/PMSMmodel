// Игра «Ручной инвертор»: экраны, управление и рисование. Расчёт — в
// InverterGame.js, здесь только состояние интерфейса.
//
// Полотно разбито на четыре области (inverterLayout): машина в разрезе,
// шестиугольник векторов напряжения, осциллограммы и органы управления —
// схема инвертора или пила с уставками, смотря по режиму уровня. Меню,
// брифинг и итог — обычная разметка поверх полотна.

const PROGRESS_STORAGE_KEY = "inverterGame.progress";
const DUTY_KEY_STEP = 0.02;
// Шкалы: вектор тока на картинке машины и осциллограмма токов.
const CURRENT_DISPLAY_MAXIMUM = 12;
const SCOPE_CURRENT_RANGE = 16;

const game = {
  level: null,
  state: null,
  screen: "menu",
  paused: false,
  tempo: INVERTER_DEFAULT_TEMPO,
  // Остаток модельного времени меньше шага: без него темп «плыл» бы от
  // округления числа шагов в кадре.
  carry: 0,
  // Области полотна, на которые можно нажать; пересобираются каждый кадр.
  hits: [],
  drag: null,
  activeEventKey: "",
  toastTimer: null,
};

const ui = {};
let canvasElement = null;

function setup() {
  let stage = document.getElementById("stage");
  let canvas = createCanvas(stage.clientWidth, stage.clientHeight);
  canvas.parent(stage);
  canvasElement = canvas.elt;
  pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
  // Шапка переносится на несколько строк, когда в неё заходят длинная цель и
  // кнопки, и полотну остаётся меньше места, а окно при этом не меняется:
  // поэтому следим за размером самой области, а не только окна.
  if (typeof ResizeObserver === "function") new ResizeObserver(windowResized).observe(stage);
  bindInterface();
  bindPointer();
  buildMenu();
  // Под меню — первый уровень, стоящий на месте: полотно не пустое и сразу
  // показывает, во что предстоит играть.
  game.level = INVERTER_LEVELS[0];
  game.state = createInverterState(game.level);
  updateHud();
  openOverlay("menu");
  showVersion();
}

function windowResized() {
  let stage = document.getElementById("stage");
  if (stage.clientWidth !== width || stage.clientHeight !== height) resizeCanvas(stage.clientWidth, stage.clientHeight);
}

function draw() {
  advanceModel();
  backgroundTheme(theme().motorBackground);
  game.hits = [];
  let layout = inverterLayout(width, height);
  drawMotor(layout.motor);
  drawHexagon(layout.hexagon);
  drawScopes(layout.scopes);
  if (game.level.mode === INVERTER_MODE_DUTY) drawDutyControl(layout.control);
  else drawLegControl(layout.control);
  updateHud();
}

function advanceModel() {
  let state = game.state;
  if (game.screen !== "play" || game.paused || state.status !== "running") return;
  let dtReal = Math.min(deltaTime / 1000, 0.1);
  game.carry += dtReal / INVERTER_REAL_PERIOD * INVERTER_PWM_PERIOD * game.tempo;
  let steps = Math.floor(game.carry / INVERTER_STEP);
  game.carry -= steps * INVERTER_STEP;
  for (let k = 0; k < steps && state.status === "running"; k++) inverterStep(state, game.level, INVERTER_STEP);
  watchEvents();
  if (state.status !== "running") finishLevel();
}

// -- экраны -----------------------------------------------------------------

function bindInterface() {
  for (const id of ["menu", "brief", "result", "rules", "levels-legs", "levels-duty", "resume", "open-rules",
    "brief-kicker", "brief-title", "brief-text", "brief-goal", "brief-controls", "brief-menu", "brief-start",
    "result-kicker", "result-title", "result-text", "result-stats", "result-menu", "result-retry", "result-next",
    "rules-close", "hud-menu", "hud-mode", "hud-level", "hud-goal", "hud-progress", "hud-progress-bar",
    "hud-pause", "hud-restart", "tempo", "toast", "version"]) {
    ui[id] = document.getElementById(id);
  }
  for (const button of document.querySelectorAll(".theme-button")) button.addEventListener("click", toggleTheme);
  ui["hud-menu"].addEventListener("click", showMenu);
  ui["hud-pause"].addEventListener("click", togglePause);
  ui["hud-restart"].addEventListener("click", restartLevel);
  ui["resume"].addEventListener("click", resumeLevel);
  ui["open-rules"].addEventListener("click", () => openOverlay("rules"));
  ui["rules-close"].addEventListener("click", () => openOverlay("menu"));
  ui["brief-menu"].addEventListener("click", showMenu);
  ui["brief-start"].addEventListener("click", () => startLevel(game.level));
  ui["result-menu"].addEventListener("click", showMenu);
  ui["result-retry"].addEventListener("click", restartLevel);
  ui["result-next"].addEventListener("click", () => {
    let next = inverterNextLevel(game.level);
    if (next) openBrief(next);
  });

  INVERTER_TEMPOS.forEach((tempo) => {
    let button = document.createElement("button");
    button.type = "button";
    button.dataset.tempo = String(tempo);
    button.textContent = "×" + formatTempo(tempo);
    button.title = "Период ШИМ за " + formatNumber(INVERTER_REAL_PERIOD / tempo, 2) + " с";
    button.addEventListener("click", () => setTempo(tempo));
    ui["tempo"].append(button);
  });
  setTempo(game.tempo);
  document.addEventListener("keydown", onKeyDown);
}

function formatTempo(tempo) {
  if (tempo === 0.25) return "¼";
  if (tempo === 0.5) return "½";
  return String(tempo);
}

function setTempo(tempo) {
  game.tempo = tempo;
  for (const button of ui["tempo"].children) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.tempo) === tempo));
  }
}

function shiftTempo(direction) {
  let index = INVERTER_TEMPOS.indexOf(game.tempo) + direction;
  if (index >= 0 && index < INVERTER_TEMPOS.length) setTempo(INVERTER_TEMPOS[index]);
}

function openOverlay(name) {
  for (const id of ["menu", "brief", "result", "rules"]) ui[id].classList.toggle("open", id === name);
  game.screen = name === null ? "play" : name;
  if (name === "menu") {
    ui["resume"].hidden = !(game.state && game.state.status === "running" && game.state.time > 0);
    refreshMenu();
  }
  let focus = { brief: "brief-start", result: "result-next", rules: "rules-close" }[name];
  if (focus) {
    let target = ui[focus].hidden ? ui["result-retry"] : ui[focus];
    setTimeout(() => target.focus(), 0);
  }
}

function showMenu() {
  openOverlay("menu");
}

function buildMenu() {
  for (const mode of [INVERTER_MODE_LEGS, INVERTER_MODE_DUTY]) {
    let list = ui[mode === INVERTER_MODE_LEGS ? "levels-legs" : "levels-duty"];
    inverterLevelsOfMode(mode).forEach((level, index) => {
      let item = document.createElement("li");
      let button = document.createElement("button");
      button.type = "button";
      button.className = "level-card";
      button.dataset.level = level.id;
      button.innerHTML = '<span class="level-number"></span>'
        + '<span><span class="level-name"></span><span class="level-summary"></span></span>'
        + '<span class="level-best"></span>';
      button.querySelector(".level-number").textContent = String(index + 1);
      button.querySelector(".level-name").textContent = level.title;
      button.querySelector(".level-summary").textContent = level.summary;
      button.addEventListener("click", () => openBrief(level));
      item.append(button);
      list.append(item);
    });
  }
}

function refreshMenu() {
  let progress = loadProgress();
  for (const card of document.querySelectorAll(".level-card")) {
    let record = progress[card.dataset.level];
    card.classList.toggle("done", Boolean(record));
    card.querySelector(".level-best").textContent = record ? "✓ " + record.periods + " пер." : "";
  }
}

function modeTitle(mode) {
  return mode === INVERTER_MODE_DUTY ? "Уставки" : "Ключи";
}

function levelNumber(level) {
  return inverterLevelsOfMode(level.mode).indexOf(level) + 1;
}

function openBrief(level) {
  game.level = level;
  game.state = createInverterState(level);
  ui["brief-kicker"].textContent = modeTitle(level.mode) + " · уровень " + levelNumber(level);
  ui["brief-title"].textContent = level.title;
  ui["brief-text"].textContent = level.brief;
  ui["brief-goal"].textContent = inverterGoalText(level) + " · на всё " + level.limitPeriods + " периодов";
  let controls = level.mode === INVERTER_MODE_DUTY
    ? ["Тяните линию уставки мышью или пальцем, или Q/A, W/S, E/D.", "B — тормозной ключ."]
    : ["Нажмите на стойку или 1, 2, 3 — она переключится.", "B — тормозной ключ."];
  controls.push("Пробел — пауза, R — заново, +/− — темп.");
  ui["brief-controls"].replaceChildren(...controls.map((text) => {
    let li = document.createElement("li");
    li.textContent = text;
    return li;
  }));
  updateHud();
  openOverlay("brief");
}

function startLevel(level) {
  game.level = level;
  game.state = createInverterState(level);
  game.carry = 0;
  game.paused = false;
  game.activeEventKey = "";
  ui["hud-pause"].setAttribute("aria-pressed", "false");
  hideToast();
  openOverlay(null);
}

function restartLevel() {
  startLevel(game.level);
}

function resumeLevel() {
  openOverlay(null);
}

function togglePause() {
  game.paused = !game.paused;
  ui["hud-pause"].setAttribute("aria-pressed", String(game.paused));
}

function finishLevel() {
  let state = game.state;
  let level = game.level;
  let won = state.status === "won";
  if (won) saveProgress(level, state.periodIndex);
  let dialog = ui["result"].querySelector(".dialog");
  dialog.classList.toggle("won", won);
  dialog.classList.toggle("lost", !won);
  ui["result-kicker"].textContent = modeTitle(level.mode) + " · уровень " + levelNumber(level);
  ui["result-title"].textContent = won ? "Получилось!" : "Не вышло";
  ui["result-text"].textContent = state.reason;
  let stats = [
    ["Периодов", String(state.periodIndex)],
    ["Пик тока", formatNumber(state.peakCurrent, 1) + " А"],
    ["Пик звена", formatNumber(state.peakVoltage, 1) + " В"],
  ];
  ui["result-stats"].replaceChildren(...stats.map(([name, value]) => {
    let div = document.createElement("div");
    let dt = document.createElement("dt");
    let dd = document.createElement("dd");
    dt.textContent = name;
    dd.textContent = value;
    div.append(dt, dd);
    return div;
  }));
  ui["result-next"].hidden = !(won && inverterNextLevel(level));
  hideToast();
  openOverlay("result");
}

// Прогресс: пройденные уровни и лучшее число периодов. localStorage бывает
// недоступен (приватный режим, файл с диска) — тогда прогресс просто не
// переживёт перезагрузку.
function loadProgress() {
  try {
    let parsed = JSON.parse(window.localStorage.getItem(PROGRESS_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function saveProgress(level, periods) {
  let progress = loadProgress();
  let previous = progress[level.id];
  if (!previous || periods < previous.periods) progress[level.id] = { periods };
  try {
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
  } catch (error) {
    // Без хранилища прогресс живёт до перезагрузки.
  }
}

// Шапка: уровень, цель и прогресс. Текст меняется только при изменении, чтобы
// не дёргать разметку каждый кадр.
function updateHud() {
  let level = game.level;
  let state = game.state;
  if (!level || !state) return;
  let progress = inverterGoalProgress(state, level);
  setText(ui["hud-mode"], modeTitle(level.mode) + " · " + levelNumber(level));
  setText(ui["hud-level"], level.title);
  setText(ui["hud-goal"], inverterGoalText(level));
  // У «смены» прогресс — это и есть номер периода, повторять его незачем.
  setText(ui["hud-progress"], level.goal.type === "survive" ? progress.text
    : progress.text + " · период " + state.periodIndex + "/" + level.limitPeriods);
  let percent = (Math.min(1, Math.max(0, progress.fraction)) * 100).toFixed(1) + "%";
  if (ui["hud-progress-bar"].style.width !== percent) ui["hud-progress-bar"].style.width = percent;
}

function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

// Объявления о событиях уровня: начало — красным, конец — спокойным цветом.
function watchEvents() {
  let active = inverterActiveEvents(game.state);
  let key = active.map((event) => event.title).join("|");
  if (key === game.activeEventKey) return;
  if (active.length > 0) showToast(active[active.length - 1].title + "!", false);
  else if (game.activeEventKey) showToast("Отбой: всё как было", true);
  game.activeEventKey = key;
}

function showToast(text, calm) {
  let toast = ui["toast"];
  toast.textContent = text;
  toast.classList.toggle("calm", calm);
  toast.classList.add("visible");
  clearTimeout(game.toastTimer);
  game.toastTimer = setTimeout(hideToast, 3500);
}

function hideToast() {
  ui["toast"].classList.remove("visible");
}

// Версия и обновление — как на остальных страницах (Updater.js).
function showVersion() {
  let line = ui["version"];
  if (typeof PMSM_VERSION !== "string") return;
  line.textContent = PMSM_VERSION;
  let button = null;
  startVersionWatch((version, reload) => {
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "update";
      line.append(" ", button);
    }
    button.textContent = "обновить до " + version;
    button.onclick = () => {
      button.disabled = true;
      button.textContent = "обновляется…";
      reload();
    };
  });
}

// -- ввод -------------------------------------------------------------------

// Клавиши берутся по event.code — по месту на клавиатуре, поэтому русская
// раскладка работает так же, как латиница.
const DUTY_KEYS = { KeyQ: [0, 1], KeyA: [0, -1], KeyW: [1, 1], KeyS: [1, -1], KeyE: [2, 1], KeyD: [2, -1] };

function onKeyDown(event) {
  let code = event.code;
  let active = document.activeElement;
  let onButton = active && active.tagName === "BUTTON";
  if (code === "KeyT") {
    toggleTheme();
    return;
  }
  if (game.screen === "rules") {
    if (code === "Escape") openOverlay("menu");
    return;
  }
  if (game.screen === "menu") {
    if (code === "Escape" && !ui["resume"].hidden) resumeLevel();
    return;
  }
  if (game.screen === "brief") {
    if (code === "Escape") showMenu();
    else if (code === "Enter" && !onButton) startLevel(game.level);
    return;
  }
  if (game.screen === "result") {
    if (code === "Escape") showMenu();
    else if (code === "KeyR") restartLevel();
    return;
  }

  let state = game.state;
  if (code === "Escape") {
    showMenu();
  } else if (code === "Space") {
    if (onButton) return;
    togglePause();
  } else if (code === "KeyR") {
    restartLevel();
  } else if (code === "KeyB") {
    toggleBrake();
  } else if (code === "Equal" || code === "NumpadAdd") {
    shiftTempo(1);
  } else if (code === "Minus" || code === "NumpadSubtract") {
    shiftTempo(-1);
  } else if (game.level.mode === INVERTER_MODE_LEGS && /^(Digit|Numpad)[123]$/.test(code)) {
    inverterToggleLeg(state, Number(code.slice(-1)) - 1);
  } else if (game.level.mode === INVERTER_MODE_DUTY && DUTY_KEYS[code]) {
    let [index, direction] = DUTY_KEYS[code];
    if (state.status === "running") inverterSetDuty(state, index, state.duty[index] + direction * DUTY_KEY_STEP);
  } else {
    return;
  }
  event.preventDefault();
}

function toggleBrake() {
  if (game.state.status === "running") game.state.brake = !game.state.brake;
}

// Нажатия по полотну — свои обработчики на самом полотне, а не mousePressed
// p5: тот срабатывает и на нажатия по разметке поверх полотна.
function bindPointer() {
  let position = (event) => {
    let rect = canvasElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  let hitAt = (p) => {
    for (let k = game.hits.length - 1; k >= 0; k--) {
      let r = game.hits[k].rect;
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return game.hits[k];
    }
    return null;
  };
  canvasElement.addEventListener("pointerdown", (event) => {
    if (game.screen !== "play") return;
    let p = position(event);
    let hit = hitAt(p);
    if (!hit) return;
    event.preventDefault();
    if (hit.drag) {
      game.drag = { hit, data: hit.start ? hit.start(p) : null };
      canvasElement.setPointerCapture(event.pointerId);
      hit.drag(p, game.drag.data);
    } else {
      hit.action();
    }
  });
  canvasElement.addEventListener("pointermove", (event) => {
    let p = position(event);
    if (game.drag) {
      game.drag.hit.drag(p, game.drag.data);
      return;
    }
    let hit = game.screen === "play" ? hitAt(p) : null;
    canvasElement.style.cursor = hit ? (hit.cursor || "pointer") : "default";
  });
  let release = () => {
    game.drag = null;
  };
  canvasElement.addEventListener("pointerup", release);
  canvasElement.addEventListener("pointercancel", release);
}

function addHit(rect, options) {
  game.hits.push(Object.assign({ rect }, options));
}

// -- рисование: общее -------------------------------------------------------

function drawCard(area, title) {
  let palette = theme();
  fillTheme(palette.cardSurface);
  strokeTheme(palette.cardBorder);
  strokeWeight(1);
  rect(area.x, area.y, area.w, area.h, 10);
  if (!title) return;
  noStroke();
  fillTheme(palette.panelSection);
  textAlign(LEFT, TOP);
  textSize(11);
  textStyle(BOLD);
  text(title, area.x + 12, area.y + 10);
  textStyle(NORMAL);
}

function drawArrow(x0, y0, x1, y1, entry, weight, alpha) {
  let length = Math.hypot(x1 - x0, y1 - y0);
  if (length < 2) return;
  let size = Math.min(6 + weight * 2.2, length);
  let shorten = size * 0.8 / length;
  strokeTheme(entry, alpha);
  strokeWeight(weight);
  line(x0, y0, x1 - (x1 - x0) * shorten, y1 - (y1 - y0) * shorten);
  let angle = Math.atan2(y1 - y0, x1 - x0);
  noStroke();
  fillTheme(entry, alpha);
  triangle(x1, y1,
    x1 - size * Math.cos(angle - 0.4), y1 - size * Math.sin(angle - 0.4),
    x1 - size * Math.cos(angle + 0.4), y1 - size * Math.sin(angle + 0.4));
}

function dashed(pattern) {
  drawingContext.setLineDash(pattern || []);
}

function formatNumber(value, digits) {
  let text = Math.abs(value) < 0.5 * Math.pow(10, -digits) ? (0).toFixed(digits) : value.toFixed(digits);
  return text.replace("-", "−");
}

function phaseEntry(index) {
  let palette = theme();
  return [palette.phaseA, palette.phaseB, palette.phaseC][index];
}

const PHASE_NAMES = ["A", "B", "C"];

// -- машина -----------------------------------------------------------------

function drawMotor(area) {
  let palette = theme();
  let state = game.state;
  drawCard(area, "МАШИНА");
  let cx = area.x + area.w * 0.4;
  let cy = area.y + area.h / 2 + 8;
  let radius = Math.max(20, Math.min(area.w * 0.36, (area.h - 40) / 2));
  let toScreen = (x, y, scale) => [cx + x * scale, cy - y * scale];

  // Статор: ярмо, расточка и оси фаз.
  noStroke();
  fillTheme(palette.statorYoke);
  circle(cx, cy, radius * 2);
  fillTheme(palette.statorBore);
  circle(cx, cy, radius * 1.56);
  let phases = inverterPhaseCurrents(state.iAlpha, state.iBeta);
  let phaseValues = [phases.a, phases.b, phases.c];
  for (let k = 0; k < 3; k++) {
    let angle = k * 2 * Math.PI / 3;
    let [x0, y0] = toScreen(Math.cos(angle), Math.sin(angle), radius * 0.8);
    let [x1, y1] = toScreen(Math.cos(angle), Math.sin(angle), radius * 0.98);
    strokeTheme(phaseEntry(k));
    strokeWeight(3 + 5 * Math.min(1, Math.abs(phaseValues[k]) / INVERTER_CURRENT_LIMIT));
    line(x0, y0, x1, y1);
    let [lx, ly] = toScreen(Math.cos(angle), Math.sin(angle), radius * 1.12);
    noStroke();
    fillTheme(phaseEntry(k));
    textAlign(CENTER, CENTER);
    textSize(14);
    textStyle(BOLD);
    text(PHASE_NAMES[k], lx, ly);
  }
  textStyle(NORMAL);

  // Ротор: северная половина по оси d. На экране y вниз, поэтому угол со знаком минус.
  let rotorRadius = radius * 0.7;
  let screenAngle = -state.angle;
  fillTheme(palette.rotorNorth);
  arc(cx, cy, rotorRadius * 2, rotorRadius * 2, screenAngle - Math.PI / 2, screenAngle + Math.PI / 2, PIE);
  fillTheme(palette.rotorSouth);
  arc(cx, cy, rotorRadius * 2, rotorRadius * 2, screenAngle + Math.PI / 2, screenAngle + 3 * Math.PI / 2, PIE);
  noFill();
  strokeTheme(palette.rotorOutline);
  strokeWeight(1.5);
  circle(cx, cy, rotorRadius * 2);
  noStroke();
  fillTheme(palette.rotorPoleLabel);
  textSize(Math.max(11, rotorRadius * 0.22));
  textStyle(BOLD);
  let [nx, ny] = toScreen(Math.cos(state.angle), Math.sin(state.angle), rotorRadius * 0.62);
  let [sx, sy] = toScreen(-Math.cos(state.angle), -Math.sin(state.angle), rotorRadius * 0.62);
  text("N", nx, ny);
  text("S", sx, sy);
  textStyle(NORMAL);
  fillTheme(palette.shaftOuter);
  circle(cx, cy, rotorRadius * 0.24);

  // Оси d и q.
  drawAxisLine(toScreen, state.angle, radius * 1.0, palette.axisD, "d");
  drawAxisLine(toScreen, state.angle + Math.PI / 2, radius * 1.0, palette.axisQ, "q");

  // Задание тока и допуск — кружок вокруг конца i*.
  let scale = radius * 0.95 / CURRENT_DISPLAY_MAXIMUM;
  let goal = game.level.goal;
  if (goal.type === "hold") {
    let c = Math.cos(state.angle);
    let s = Math.sin(state.angle);
    let ra = goal.id * c - goal.iq * s;
    let rb = goal.id * s + goal.iq * c;
    let [tx, ty] = toScreen(ra, rb, scale);
    fillTheme(palette.gameTargetBand);
    strokeTheme(palette.gameSuccess, 160);
    strokeWeight(1.2);
    dashed([4, 4]);
    circle(tx, ty, goal.tolerance * scale * 2);
    dashed();
    drawArrow(cx, cy, tx, ty, palette.vectorCurrentReference, 3);
  }

  // Ток: обводка цветом фона, чтобы стрелка читалась поверх ротора.
  let [ix, iy] = toScreen(state.iAlpha, state.iBeta, scale);
  drawArrow(cx, cy, ix, iy, palette.componentHalo, 7);
  drawArrow(cx, cy, ix, iy, palette.vectorCurrent, 3.5);

  drawMotorReadouts(area, cx + radius * 1.25);
}

function drawAxisLine(toScreen, angle, length, entry, label) {
  let c = Math.cos(angle);
  let s = Math.sin(angle);
  let [x0, y0] = toScreen(-c, -s, length * 0.75);
  let [x1, y1] = toScreen(c, s, length);
  dashed([6, 5]);
  strokeTheme(entry);
  strokeWeight(1.5);
  line(x0, y0, x1, y1);
  dashed();
  let [lx, ly] = toScreen(c, s, length + 12);
  noStroke();
  fillTheme(entry, 255);
  textAlign(CENTER, CENTER);
  textSize(14);
  textStyle(BOLD);
  text(label, lx, ly);
  textStyle(NORMAL);
}

// Показания справа от машины: средние за прошлый период и текущие значения.
function drawMotorReadouts(area, left) {
  let palette = theme();
  let state = game.state;
  let dq = inverterPark(state.iAlpha, state.iBeta, state.angle);
  let last = state.history[state.history.length - 1];
  let rows = [
    ["n", formatNumber(state.speed * 30 / Math.PI, 0) + " об/мин", palette.statusValue],
    ["M", formatNumber(1.5 * INVERTER_MOTOR.polePairs * INVERTER_MOTOR.magnetFlux * dq.q, 3) + " Н·м",
      palette.statusValue],
    ["id", formatNumber(dq.d, 2) + " А", palette.componentD],
    ["iq", formatNumber(dq.q, 2) + " А", palette.componentQ],
    ["id ср", last ? formatNumber(last.id, 2) + " А" : "—", palette.componentD],
    ["iq ср", last ? formatNumber(last.iq, 2) + " А" : "—", palette.componentQ],
    ["Udc", formatNumber(state.udc, 1) + " В", linkVoltageEntry(state.udc)],
    ["Mнагр", formatNumber(game.level.rotor.fixed ? 0 : inverterLoadTorque(state, game.level), 2) + " Н·м",
      palette.statusValue],
  ];
  let right = area.x + area.w - 14;
  let x = Math.max(left, right - 170);
  if (right - x < 120) return;
  let lineHeight = Math.min(22, (area.h - 40) / rows.length);
  let y = area.y + 34;
  textSize(Math.min(14, lineHeight * 0.7));
  for (const [name, value, entry] of rows) {
    noStroke();
    fillTheme(palette.statusCaption);
    textAlign(LEFT, CENTER);
    text(name, x, y);
    fillTheme(entry, 255);
    textAlign(RIGHT, CENTER);
    text(value, right, y);
    y += lineHeight;
  }
  if (game.level.rotor.fixed) {
    fillTheme(palette.motorNote);
    textAlign(RIGHT, CENTER);
    textSize(11);
    text(state.speed === 0 ? "ротор заторможен" : "скорость держит внешний привод", right, y + 4);
  }
}

function linkVoltageEntry(udc) {
  let palette = theme();
  if (udc > INVERTER_LINK.warningVoltage) return palette.gameDanger;
  if (udc < 40) return palette.pausedMark;
  return palette.statusValue;
}

// -- шестиугольник векторов -------------------------------------------------

const HEX_LEGS = [[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1], [1, 0, 1]];

function drawHexagon(area) {
  let palette = theme();
  let state = game.state;
  drawCard(area, "НАПРЯЖЕНИЕ");
  let cx = area.x + area.w / 2;
  let cy = area.y + area.h / 2 + 8;
  let radius = Math.max(20, Math.min(area.w, area.h - 50) * 0.36);
  // Шкала — по номинальному звену: при провале шестиугольник заметно сжимается.
  let scale = radius / (INVERTER_LINK.sourceVoltage * 2 / 3);
  let toScreen = (x, y) => [cx + x * scale, cy - y * scale];

  strokeTheme(palette.axisAlphaBeta, 90);
  strokeWeight(1);
  line(cx - radius * 1.2, cy, cx + radius * 1.2, cy);
  line(cx, cy - radius * 1.2, cx, cy + radius * 1.2);

  let length = state.udc * 2 / 3;
  let corners = HEX_LEGS.map((legs, k) => toScreen(length * Math.cos(k * Math.PI / 3), length * Math.sin(k * Math.PI / 3)));
  fillTheme(palette.statorBore);
  strokeTheme(palette.gameBus);
  strokeWeight(1.5);
  beginShape();
  for (const [x, y] of corners) vertex(x, y);
  endShape(CLOSE);
  // Вписанная окружность — предел синусоидальной модуляции без искажений.
  noFill();
  strokeTheme(palette.gameBus, 90);
  dashed([3, 4]);
  circle(cx, cy, 2 * state.udc / SQRT3 * scale);
  dashed();

  let current = inverterVectorLabel(state.legs);
  HEX_LEGS.forEach((legs, k) => {
    let [x, y] = corners[k];
    let on = legs.join("") === current;
    noStroke();
    fillTheme(on ? palette.gameSwitchOn : palette.gameBus);
    circle(x, y, on ? 12 : 7);
    let [lx, ly] = toScreen(length * 1.24 * Math.cos(k * Math.PI / 3), length * 1.24 * Math.sin(k * Math.PI / 3));
    fillTheme(on ? palette.gameSwitchOn : palette.legendLabel);
    textAlign(CENTER, CENTER);
    textSize(12);
    textStyle(on ? BOLD : NORMAL);
    text(legs.join(""), lx, ly);
  });
  let zero = current === "000" || current === "111";
  noStroke();
  fillTheme(zero ? palette.gameSwitchOn : palette.gameBus);
  circle(cx, cy, zero ? 12 : 6);
  fillTheme(zero ? palette.gameSwitchOn : palette.legendLabel);
  textStyle(zero ? BOLD : NORMAL);
  textAlign(LEFT, TOP);
  textSize(11);
  text("000 / 111", cx + 8, cy + 6);
  textStyle(NORMAL);

  // ЭДС вращения, среднее напряжение прошлого периода и мгновенное.
  let omega = state.speed * INVERTER_MOTOR.polePairs;
  let emf = omega * INVERTER_MOTOR.magnetFlux;
  if (Math.abs(emf) > 0.05) {
    let [ex, ey] = toScreen(-emf * Math.sin(state.angle), emf * Math.cos(state.angle));
    drawArrow(cx, cy, ex, ey, palette.vectorEmf, 2.5);
  }
  let last = state.history[state.history.length - 1];
  if (last) {
    let [ax, ay] = toScreen(last.uAlpha, last.uBeta);
    drawArrow(cx, cy, ax, ay, palette.vectorVoltageReference, 3);
  }
  let u = inverterVoltages(state.legs, state.udc);
  let [ux, uy] = toScreen(u.alpha, u.beta);
  drawArrow(cx, cy, ux, uy, palette.vectorVoltage, 3.5);

  // Легенда внизу карточки.
  let legend = [["u", palette.vectorVoltage], ["ū за период", palette.vectorVoltageReference], ["e", palette.vectorEmf]];
  let x = area.x + 12;
  let y = area.y + area.h - 14;
  textSize(11);
  for (const [label, entry] of legend) {
    fillTheme(entry, 255);
    rect(x, y - 4, 10, 4, 2);
    fillTheme(palette.legendLabel);
    textAlign(LEFT, CENTER);
    text(label, x + 14, y - 2);
    x += textWidth(label) + 30;
  }
}

// -- осциллограммы ----------------------------------------------------------

function drawScopes(area) {
  drawCard(area, "ОСЦИЛЛОГРАММЫ");
  let inner = { x: area.x + 8, y: area.y + 28, w: area.w - 16, h: area.h - 36 };
  let currentH = Math.round(inner.h * 0.58);
  drawCurrentScope({ x: inner.x, y: inner.y, w: inner.w, h: currentH });
  let lowerY = inner.y + currentH + 8;
  let lowerH = inner.h - currentH - 8;
  let half = Math.floor((inner.w - 8) / 2);
  drawHistoryScope({ x: inner.x, y: lowerY, w: half, h: lowerH }, "Udc, В", "udc", linkScopeRange(),
    [[INVERTER_LINK.overVoltage, theme().gameDanger], [INVERTER_LINK.warningVoltage, theme().pausedMark]],
    theme().vectorVoltage, game.state.udc);
  drawHistoryScope({ x: inner.x + half + 8, y: lowerY, w: inner.w - half - 8, h: lowerH }, "n, об/мин", "rpm",
    speedScopeRange(), speedGoalLines(), theme().torqueMotor, game.state.speed * 30 / Math.PI);
}

function linkScopeRange() {
  return [30, 64];
}

function speedScopeRange() {
  let goal = game.level.goal;
  let top = Math.max(Math.abs(game.level.rotor.rpm), goal.rpm || 0, goal.maxRpm || 0, 100) * 1.15;
  return [-top * 0.15, top];
}

function speedGoalLines() {
  let goal = game.level.goal;
  let palette = theme();
  if (goal.type === "speed" || goal.type === "stop") return [[goal.rpm, palette.gameSuccess]];
  if (goal.type === "survive") return [[goal.minRpm, palette.gameDanger], [goal.maxRpm, palette.gameDanger]];
  return [];
}

function plotFrame(area) {
  let palette = theme();
  let plot = { x: area.x + 34, y: area.y + 16, w: Math.max(area.w - 40, 10), h: Math.max(area.h - 20, 10) };
  noFill();
  strokeTheme(palette.axisAlphaBeta, 70);
  strokeWeight(1);
  rect(plot.x, plot.y, plot.w, plot.h);
  return plot;
}

// Токи d, q за последние периоды: тонко — мгновенные, толсто — средние за
// период, полосы — допуск цели.
function drawCurrentScope(area) {
  let palette = theme();
  let state = game.state;
  let plot = plotFrame(area);
  let windowTime = INVERTER_FINE_PERIODS * INVERTER_PWM_PERIOD;
  let tEnd = Math.max(state.time, windowTime);
  let toX = (t) => plot.x + plot.w * (1 - (tEnd - t) / windowTime);
  let toY = (value) => plot.y + plot.h / 2 - value / SCOPE_CURRENT_RANGE * plot.h / 2;

  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.rect(plot.x, plot.y, plot.w, plot.h);
  drawingContext.clip();

  let goal = game.level.goal;
  if (goal.type === "hold") {
    noStroke();
    for (const [value, entry] of [[goal.id, palette.componentD], [goal.iq, palette.componentQ]]) {
      fillTheme(entry, 40);
      let top = toY(value + goal.tolerance);
      rect(plot.x, top, plot.w, toY(value - goal.tolerance) - top);
    }
  }
  strokeTheme(palette.axisAlphaBeta, 120);
  strokeWeight(1);
  line(plot.x, toY(0), plot.x + plot.w, toY(0));

  // Границы периодов с номерами.
  textSize(10);
  let firstPeriod = Math.ceil((tEnd - windowTime) / INVERTER_PWM_PERIOD);
  for (let k = firstPeriod; k * INVERTER_PWM_PERIOD <= tEnd; k++) {
    let x = toX(k * INVERTER_PWM_PERIOD);
    strokeTheme(palette.axisAlphaBeta, 60);
    line(x, plot.y, x, plot.y + plot.h);
    noStroke();
    fillTheme(palette.legendLabel);
    textAlign(LEFT, TOP);
    text(String(k + 1), x + 3, plot.y + 2);
  }

  noFill();
  strokeWeight(1.3);
  for (const [key, entry] of [["id", palette.componentD], ["iq", palette.componentQ]]) {
    strokeTheme(entry, 150);
    beginShape();
    for (const sample of state.fine) vertex(toX(sample.t), toY(sample[key]));
    endShape();
  }
  // Средние за период — ступеньки; текущий период — среднее на сейчас, штрихом.
  strokeWeight(3);
  for (const [key, entry] of [["id", palette.componentD], ["iq", palette.componentQ]]) {
    strokeTheme(entry, 255);
    for (const entryRow of state.history) {
      let x0 = toX(entryRow.period * INVERTER_PWM_PERIOD);
      let x1 = toX((entryRow.period + 1) * INVERTER_PWM_PERIOD);
      if (x1 < plot.x) continue;
      line(x0, toY(entryRow[key]), x1, toY(entryRow[key]));
    }
    if (state.sum.duration > 0) {
      let value = state.sum[key] / state.sum.duration;
      dashed([5, 4]);
      line(toX(state.periodIndex * INVERTER_PWM_PERIOD), toY(value), toX(state.time), toY(value));
      dashed();
    }
  }
  drawingContext.restore();

  noStroke();
  fillTheme(palette.legendLabel);
  textSize(10);
  textAlign(RIGHT, CENTER);
  for (const value of [-10, 0, 10]) text(String(value).replace("-", "−"), plot.x - 5, toY(value));
  textAlign(LEFT, BOTTOM);
  textSize(12);
  textStyle(BOLD);
  fillTheme(palette.componentD, 255);
  text("id", plot.x, plot.y - 2);
  fillTheme(palette.componentQ, 255);
  text("iq, А", plot.x + 22, plot.y - 2);
  textStyle(NORMAL);
  fillTheme(palette.legendLabel);
  textSize(10);
  textAlign(RIGHT, BOTTOM);
  text("тонко — мгновенные, толсто — средние за период", plot.x + plot.w, plot.y - 2);
}

// Величина по периодам за последние INVERTER_HISTORY_PERIODS периодов.
function drawHistoryScope(area, title, key, range, levels, entry, nowValue) {
  let palette = theme();
  let state = game.state;
  let plot = plotFrame(area);
  let [low, high] = range;
  let toY = (value) => plot.y + plot.h * (1 - (Math.min(Math.max(value, low), high) - low) / (high - low));
  let start = Math.max(0, state.periodIndex - INVERTER_HISTORY_PERIODS);
  let toX = (period) => plot.x + plot.w * (period - start) / INVERTER_HISTORY_PERIODS;

  for (const [value, levelEntry] of levels) {
    if (value < low || value > high) continue;
    strokeTheme(levelEntry, 200);
    strokeWeight(1);
    dashed([4, 4]);
    line(plot.x, toY(value), plot.x + plot.w, toY(value));
    dashed();
  }
  noFill();
  strokeTheme(entry, 255);
  strokeWeight(2);
  beginShape();
  for (const row of state.history) {
    if (row.period + 1 >= start) vertex(toX(row.period + 1), toY(row[key]));
  }
  vertex(toX(state.periodIndex + inverterPeriodPhase(state)), toY(nowValue));
  endShape();

  noStroke();
  fillTheme(palette.legendLabel);
  textSize(10);
  textAlign(RIGHT, CENTER);
  text(formatNumber(high, 0), plot.x - 4, plot.y + 4);
  text(formatNumber(low, 0), plot.x - 4, plot.y + plot.h - 4);
  textAlign(LEFT, BOTTOM);
  textSize(12);
  textStyle(BOLD);
  fillTheme(entry, 255);
  text(title, plot.x, plot.y - 2);
  textStyle(NORMAL);
  textAlign(RIGHT, BOTTOM);
  fillTheme(palette.statusValue);
  text(formatNumber(nowValue, key === "udc" ? 1 : 0), plot.x + plot.w, plot.y - 2);
}

// -- инвертор: режим ключей -------------------------------------------------

function drawLegControl(area) {
  let palette = theme();
  let state = game.state;
  drawCard(area, "ИНВЕРТОР — НАЖИМАЙТЕ НА СТОЙКИ");
  let timelineH = Math.min(80, area.h * 0.28);
  let schematicW = area.w - 20;
  let linkW = Math.min(schematicW * 0.34, 260);
  let spacing = (schematicW - linkW - 40) / 3;
  let compact = spacing < 130;
  // В узкой схеме подписи фаз стоят под стойками — под них нужна строка.
  let schematic = { x: area.x + 10, y: area.y + 30, w: schematicW, h: area.h - timelineH - 44 - (compact ? 24 : 0) };
  let timeline = { x: area.x + 10, y: area.y + area.h - timelineH - 8, w: area.w - 20, h: timelineH };

  let top = schematic.y + 14;
  let bottom = schematic.y + schematic.h - 6;
  let legsX = schematic.x + linkW;

  drawLinkSide({ x: schematic.x, y: top, w: linkW, h: bottom - top }, top, bottom);

  // Шины звена через все стойки.
  strokeTheme(palette.gameBus);
  strokeWeight(2);
  line(schematic.x + 16, top, legsX + spacing * 2.5 + 2, top);
  line(schematic.x + 16, bottom, legsX + spacing * 2.5 + 2, bottom);

  let phases = inverterPhaseCurrents(state.iAlpha, state.iBeta);
  let values = [phases.a, phases.b, phases.c];
  for (let k = 0; k < 3; k++) {
    let x = legsX + spacing * (k + 0.5);
    drawLeg(x, top, bottom, Math.min(78, spacing * 0.5), k, values[k], compact);
    addHit({ x: x - spacing / 2 + 4, y: top - 10, w: spacing - 8, h: bottom - top + 20 },
      { action: () => inverterToggleLeg(game.state, k) });
  }

  drawTimeline(timeline);
}

// Левая часть схемы: выпрямитель, конденсатор и тормозной ключ.
function drawLinkSide(area, top, bottom) {
  let palette = theme();
  let state = game.state;
  let mid = (top + bottom) / 2;
  let step = area.w / 3;

  // Источник: кружок с «~», диод на плюсовой ветви.
  let sx = area.x + step * 0.5;
  strokeTheme(palette.gameBus);
  strokeWeight(2);
  line(sx, top, sx, bottom);
  let r = Math.min(22, step * 0.35);
  fillTheme(palette.cardSurface);
  circle(sx, mid, r * 2);
  noStroke();
  fillTheme(palette.gameBus);
  triangle(sx - 7, top + 18, sx + 7, top + 18, sx, top + 8);
  rect(sx - 7, top + 6, 14, 2);
  let source = inverterSourceVoltage(state);
  fillTheme(source < INVERTER_LINK.sourceVoltage ? palette.gameDanger : palette.legendLabel);
  textAlign(CENTER, CENTER);
  textSize(16);
  text("~", sx, mid - 1);
  textSize(11);
  text(formatNumber(source, 0) + " В", sx, mid + r + 12);

  // Конденсатор и шкала напряжения рядом.
  let cx = area.x + step * 1.5;
  strokeTheme(palette.gameBus);
  strokeWeight(2);
  line(cx, top, cx, mid - 5);
  line(cx, mid + 5, cx, bottom);
  strokeWeight(3);
  line(cx - 16, mid - 5, cx + 16, mid - 5);
  line(cx - 16, mid + 5, cx + 16, mid + 5);
  let gaugeX = cx + 24;
  let gaugeTop = top + 16;
  let gaugeH = bottom - top - 32;
  noStroke();
  fillTheme(palette.sliderTrack);
  rect(gaugeX, gaugeTop, 6, gaugeH, 3);
  let fraction = Math.min(1, state.udc / 64);
  fillTheme(linkVoltageEntry(state.udc), 255);
  rect(gaugeX, gaugeTop + gaugeH * (1 - fraction), 6, gaugeH * fraction, 3);
  fillTheme(palette.gameDanger);
  rect(gaugeX - 3, gaugeTop + gaugeH * (1 - INVERTER_LINK.overVoltage / 64) - 1, 12, 2);
  fillTheme(linkVoltageEntry(state.udc), 255);
  textAlign(CENTER, TOP);
  textSize(13);
  textStyle(BOLD);
  text(formatNumber(state.udc, 1) + " В", cx, mid + 14);
  textStyle(NORMAL);

  // Тормозной ключ: резистор сверху, ключ снизу.
  let bx = area.x + step * 2.5;
  strokeTheme(palette.gameBus);
  strokeWeight(2);
  line(bx, top, bx, bottom);
  let w = Math.min(34, step * 0.55);
  let resistorH = (bottom - top) * 0.3;
  fillTheme(palette.cardSurface);
  rect(bx - w / 4, top + 10, w / 2, resistorH, 3);
  let switchH = (bottom - top) * 0.36;
  let on = state.brake;
  fillTheme(on ? palette.gameSwitchOn : palette.gameSwitchOff);
  noStroke();
  rect(bx - w / 2, bottom - switchH - 8, w, switchH, 6);
  fillTheme(on ? palette.panelBackground : palette.legendLabel);
  textAlign(CENTER, CENTER);
  textSize(11);
  textStyle(BOLD);
  text("B", bx, bottom - switchH / 2 - 8);
  textStyle(NORMAL);
  if (step >= 70) {
    fillTheme(palette.legendLabel);
    textSize(10);
    text("тормоз", bx, top + resistorH + 22);
  }
  addHit({ x: bx - step / 2 + 2, y: top, w: step - 4, h: bottom - top }, { action: toggleBrake });
}

// Стойка: верхний и нижний ключ, выход фазы и её ток.
// compact — узкая схема: подпись фазы и ток уходят под стойку, справа от ключа
// им места нет.
function drawLeg(x, top, bottom, width, index, current, compact) {
  let palette = theme();
  let state = game.state;
  let on = state.legs[index] === 1;
  let mid = (top + bottom) / 2;
  let gap = 10;
  let switchH = mid - top - gap * 1.5;

  strokeTheme(palette.gameBus);
  strokeWeight(2);
  line(x, top, x, bottom);
  // Выход фазы — от середины стойки вправо.
  strokeTheme(phaseEntry(index));
  strokeWeight(3);
  line(x, mid, x + width / 2 + 40, mid);
  noStroke();
  fillTheme(phaseEntry(index));
  circle(x, mid, 8);

  for (const upper of [true, false]) {
    let closed = upper ? on : !on;
    let y = upper ? top + gap : mid + gap / 2;
    if (closed) {
      // Мягкое свечение включённого ключа.
      fillTheme(palette.gameSwitchOn, 50);
      rect(x - width / 2 - 5, y - 5, width + 10, switchH + 10, 10);
    }
    fillTheme(closed ? palette.gameSwitchOn : palette.gameSwitchOff);
    rect(x - width / 2, y, width, switchH, 7);
    fillTheme(closed ? palette.panelBackground : palette.legendLabel);
    textAlign(CENTER, CENTER);
    textSize(Math.min(13, switchH * 0.3));
    textStyle(BOLD);
    text(closed ? "ВКЛ" : "выкл", x, y + switchH / 2);
    textStyle(NORMAL);
  }

  let currentEntry = Math.abs(current) > INVERTER_CURRENT_LIMIT * 0.8 ? palette.gameDanger : palette.legendLabel;
  if (compact) {
    textAlign(CENTER, TOP);
    textSize(11);
    textStyle(BOLD);
    fillTheme(phaseEntry(index), 255);
    text(PHASE_NAMES[index] + " · " + (index + 1), x, bottom + 4);
    textStyle(NORMAL);
    fillTheme(currentEntry);
    text(formatNumber(current, 1) + " А", x, bottom + 17);
    return;
  }
  // Подпись фазы и ток справа от выхода.
  fillTheme(phaseEntry(index), 255);
  textAlign(LEFT, BOTTOM);
  textSize(15);
  textStyle(BOLD);
  text(PHASE_NAMES[index], x + width / 2 + 10, mid - 4);
  textStyle(NORMAL);
  textAlign(LEFT, TOP);
  textSize(11);
  fillTheme(currentEntry);
  text(formatNumber(current, 1) + " А", x + width / 2 + 10, mid + 4);
  // Клавиша стойки.
  fillTheme(palette.motorNote);
  textAlign(CENTER, TOP);
  textSize(10);
  text("клавиша " + (index + 1), x, bottom + 4);
}

// Полоса текущего периода: импульсы стоек, уже наигранные в этом периоде, и
// бледно — прошлый период, чтобы было с чем сравнить.
function drawTimeline(area) {
  let palette = theme();
  let state = game.state;
  let label = 28;
  let bar = { x: area.x + label, y: area.y + 14, w: area.w - label - 4, h: area.h - 18 };
  let rowH = bar.h / 3;
  let phase = inverterPeriodPhase(state);

  noStroke();
  fillTheme(palette.legendLabel);
  textSize(10);
  textAlign(LEFT, BOTTOM);
  text("Период " + (state.periodIndex + 1) + " · " + formatNumber(phase * 100, 0) + " %", bar.x, bar.y - 2);
  textAlign(RIGHT, BOTTOM);
  text("бледно — прошлый период", bar.x + bar.w, bar.y - 2);

  for (let k = 0; k < 3; k++) {
    let y = bar.y + rowH * k;
    fillTheme(palette.statorBore);
    rect(bar.x, y + 2, bar.w, rowH - 4, 3);
    fillTheme(phaseEntry(k), 255);
    textAlign(RIGHT, CENTER);
    textSize(11);
    textStyle(BOLD);
    text(PHASE_NAMES[k], bar.x - 8, y + rowH / 2);
    textStyle(NORMAL);
    if (state.lastPeriodSwitching) drawPulses(state.lastPeriodSwitching, k, 1, bar, y, rowH, 55);
    drawPulses(state.switching, k, phase, bar, y, rowH, 255);
  }
  let cursor = bar.x + bar.w * phase;
  strokeTheme(palette.pausedMark);
  strokeWeight(2);
  line(cursor, bar.y, cursor, bar.y + bar.h);
}

function drawPulses(switching, leg, until, bar, y, rowH, alpha) {
  for (let k = 0; k < switching.length; k++) {
    let from = switching[k].t;
    let to = k + 1 < switching.length ? switching[k + 1].t : until;
    if (alpha < 255) from = Math.max(from, inverterPeriodPhase(game.state));
    if (to <= from || !switching[k].legs[leg]) continue;
    noStroke();
    fillTheme(phaseEntry(leg), alpha);
    rect(bar.x + bar.w * from, y + 3, bar.w * (to - from), rowH - 6, 2);
  }
}

// -- инвертор: режим уставок ------------------------------------------------

function drawDutyControl(area) {
  let palette = theme();
  let state = game.state;
  drawCard(area, "МОДУЛЯТОР — ТЯНИТЕ УСТАВКИ");
  let brakeW = Math.min(92, area.w * 0.18);
  let chart = { x: area.x + 58, y: area.y + 34, w: area.w - brakeW - 90, h: (area.h - 50) * 0.64 };
  let pulses = { x: chart.x, y: chart.y + chart.h + 10, w: chart.w, h: area.h - 50 - chart.h - 14 };
  let phase = inverterPeriodPhase(state);
  let toX = (t) => chart.x + chart.w * t;
  let toY = (value) => chart.y + chart.h * (1 - value);

  noStroke();
  fillTheme(palette.statorBore);
  rect(chart.x, chart.y, chart.w, chart.h, 4);
  // Пила.
  noFill();
  strokeTheme(palette.gameCarrier);
  strokeWeight(2);
  line(toX(0), toY(1), toX(0.5), toY(0));
  line(toX(0.5), toY(0), toX(1), toY(1));
  // Уставки: линия во всю ширину и ручка справа.
  for (let k = 0; k < 3; k++) {
    let y = toY(state.duty[k]);
    let dragging = game.drag && game.drag.data && game.drag.data.index === k;
    strokeTheme(phaseEntry(k));
    strokeWeight(dragging ? 4 : 2.5);
    line(chart.x, y, chart.x + chart.w, y);
    noStroke();
    fillTheme(phaseEntry(k));
    circle(chart.x + chart.w + 12, y, dragging ? 20 : 16);
    fillTheme(phaseEntry(k), 255);
    textAlign(RIGHT, CENTER);
    textSize(11);
    textStyle(BOLD);
    text(PHASE_NAMES[k] + " " + formatNumber(state.duty[k], 2), chart.x - 4, y);
    textStyle(NORMAL);
  }
  // Курсор времени и точка пилы на нём.
  strokeTheme(palette.pausedMark);
  strokeWeight(2);
  line(toX(phase), chart.y, toX(phase), pulses.y + pulses.h);
  noStroke();
  fillTheme(palette.pausedMark);
  circle(toX(phase), toY(inverterCarrier(phase)), 9);

  // Импульсы: ожидаемые на весь период — бледно, наигранные — ярко.
  let rowH = pulses.h / 3;
  for (let k = 0; k < 3; k++) {
    let y = pulses.y + rowH * k;
    noStroke();
    fillTheme(palette.statorBore);
    rect(pulses.x, y + 2, pulses.w, rowH - 4, 3);
    let d = state.duty[k];
    if (d > 0) {
      fillTheme(phaseEntry(k), 55);
      let from = (1 - d) / 2;
      rect(toX(Math.max(from, phase)), y + 3, Math.max(0, chart.w * ((1 + d) / 2 - Math.max(from, phase))), rowH - 6, 2);
    }
    drawPulses(state.switching, k, phase, pulses, y, rowH, 255);
    fillTheme(phaseEntry(k), 255);
    textAlign(RIGHT, CENTER);
    textSize(11);
    textStyle(BOLD);
    text(PHASE_NAMES[k], pulses.x - 6, y + rowH / 2);
    textStyle(NORMAL);
  }

  addHit({ x: chart.x - 48, y: chart.y - 12, w: chart.w + 72, h: chart.h + 24 }, {
    cursor: "ns-resize",
    start: (p) => {
      let value = 1 - (p.y - chart.y) / chart.h;
      let index = 0;
      for (let k = 1; k < 3; k++) {
        if (Math.abs(state.duty[k] - value) < Math.abs(state.duty[index] - value)) index = k;
      }
      return { index };
    },
    drag: (p, data) => {
      if (game.state.status !== "running") return;
      inverterSetDuty(game.state, data.index, 1 - (p.y - chart.y) / chart.h);
    },
  });

  drawBrakeButton({ x: area.x + area.w - brakeW - 10, y: chart.y, w: brakeW, h: chart.h + pulses.h + 10 });
}

function drawBrakeButton(area) {
  let palette = theme();
  let state = game.state;
  let on = state.brake;
  noStroke();
  fillTheme(on ? palette.gameSwitchOn : palette.gameSwitchOff);
  rect(area.x, area.y, area.w, area.h * 0.45, 8);
  fillTheme(on ? palette.panelBackground : palette.legendLabel);
  textAlign(CENTER, CENTER);
  textSize(12);
  textStyle(BOLD);
  text(on ? "ТОРМОЗ\nВКЛ" : "тормоз\n(B)", area.x + area.w / 2, area.y + area.h * 0.225);
  textStyle(NORMAL);
  addHit({ x: area.x, y: area.y, w: area.w, h: area.h * 0.45 }, { action: toggleBrake });

  // Шкала звена под кнопкой.
  let gauge = { x: area.x + area.w / 2 - 5, y: area.y + area.h * 0.45 + 26, w: 10, h: area.h * 0.55 - 30 };
  fillTheme(palette.sliderTrack);
  rect(gauge.x, gauge.y, gauge.w, gauge.h, 4);
  let fraction = Math.min(1, state.udc / 64);
  fillTheme(linkVoltageEntry(state.udc), 255);
  rect(gauge.x, gauge.y + gauge.h * (1 - fraction), gauge.w, gauge.h * fraction, 4);
  fillTheme(palette.gameDanger);
  rect(gauge.x - 4, gauge.y + gauge.h * (1 - INVERTER_LINK.overVoltage / 64) - 1, gauge.w + 8, 2);
  fillTheme(linkVoltageEntry(state.udc), 255);
  textSize(12);
  textStyle(BOLD);
  text(formatNumber(state.udc, 1) + " В", area.x + area.w / 2, area.y + area.h * 0.45 + 13);
  textStyle(NORMAL);
}

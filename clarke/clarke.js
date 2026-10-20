// Страница преобразования Кларк: пошаговый рассказ о том, как три фазные
// величины abc превращаются в вектор и две его проекции α–β. Тексты сцен — в
// scenes.js, расчёт, состояние сцен и раскладка — в ClarkeTransform.js; здесь
// только панель и рисование.

const clarke = {
  scene: 0,
  // Угол θ = ωt. Время общее для всех сцен: при переключении сцены оно не
  // сбрасывается, а на паузе стоит.
  theta: 0.0,
  paused: false,
  morph: {},
  layers: Object.assign({}, CLARKE_DEFAULT_LAYERS),
  trail: new Array(CLARKE_TRAIL_BINS).fill(false),
  // Ползунок времени, который держат пальцем, кадр не двигает.
  scrubbing: false,
};

const controls = {};

function setup() {
  let stage = document.getElementById("stage");
  let canvas = createCanvas(stage.clientWidth, stage.clientHeight);
  canvas.parent(stage);
  pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
  // Первая сцена открывается сразу в своём виде, без перехода из пустоты.
  clarke.morph = clarkeMorphTargets(currentSceneState());
  bindControls();
  showScene();
  showVersion();
}

// Версия и обновление — как в модели и park/ (Updater.js).
function showVersion() {
  let line = document.getElementById("version");
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

function windowResized() {
  let stage = document.getElementById("stage");
  resizeCanvas(stage.clientWidth, stage.clientHeight);
}

function currentSceneState() {
  return clarkeSceneState(clarke.scene, clarke.layers);
}

function draw() {
  // Шаг по реальному времени, но не больше 0,1 с: после возврата на вкладку
  // вектор не перепрыгивает. Переходы идут и на паузе — они про сцену, а не
  // про время.
  let frame = Math.min(deltaTime / 1000.0, 0.1);
  let state = currentSceneState();
  let targets = clarkeMorphTargets(state);
  for (const key of CLARKE_MORPH_KEYS) {
    clarke.morph[key] = clarkeApproach(clarke.morph[key], targets[key], frame);
  }

  if (!clarke.paused && !clarke.scrubbing) {
    let previous = clarke.theta;
    clarke.theta = clarkeWrapAngle(clarke.theta + 2 * Math.PI * CLARKE_FREQUENCY * frame);
    if (clarke.morph.trail > 0) clarkeMarkTrail(clarke.trail, previous, clarke.theta);
    controls["time"].value = Math.round(clarke.theta * 180 / Math.PI) % 360;
  }
  controls["time-value"].textContent = Math.round(clarke.theta * 180 / Math.PI) % 360 + "°";

  backgroundTheme(theme().motorBackground);
  let layout = clarkeLayout(width, height, state.layout);
  let phases = clarkePhases(clarke.theta);
  let ab = clarkeTransform(phases.a, phases.b, phases.c);
  let view = { layout, phases, ab, plane: null };
  if (layout.plane) view.plane = planeGeometry(layout.plane);
  for (const graph of layout.graphs) drawGraph(graph, view);
  if (view.plane) drawPlane(view);
}

// -- панель ------------------------------------------------------------------

function bindControls() {
  for (const id of ["prev", "next", "scene-number", "scene-title", "scene-text", "time",
    "time-value", "pause", "theme", "layers", "layer-phase-graph", "layer-ab-graph",
    "layer-phase-vectors", "layer-resultant", "layer-projections"]) {
    controls[id] = document.getElementById(id);
  }
  controls["prev"].addEventListener("click", () => goToScene(clarke.scene - 1));
  controls["next"].addEventListener("click", () => goToScene(clarke.scene + 1));
  controls["pause"].addEventListener("click", togglePause);
  controls["theme"].addEventListener("click", toggleTheme);

  let time = controls["time"];
  time.min = 0;
  time.max = 359;
  time.step = 1;
  time.value = 0;
  time.addEventListener("pointerdown", () => { clarke.scrubbing = true; });
  for (const name of ["pointerup", "pointercancel", "change"]) {
    time.addEventListener(name, () => { clarke.scrubbing = false; });
  }
  time.addEventListener("input", () => {
    let previous = clarke.theta;
    clarke.theta = clarkeWrapAngle(Number(time.value) * Math.PI / 180);
    if (clarke.morph.trail > 0) clarkeMarkTrail(clarke.trail, previous, clarke.theta);
  });

  // Флажки слоёв общего вида: положение — из состояния, а не из разметки.
  let layerInputs = {
    "layer-phase-graph": "phaseGraph",
    "layer-ab-graph": "abGraph",
    "layer-phase-vectors": "phaseVectors",
    "layer-resultant": "resultant",
    "layer-projections": "projections",
  };
  for (const [id, field] of Object.entries(layerInputs)) {
    controls[id].checked = clarke.layers[field];
    controls[id].addEventListener("change", (event) => {
      clarke.layers[field] = event.target.checked;
    });
  }
}

function goToScene(index) {
  if (index < 0 || index >= CLARKE_SCENES.length || index === clarke.scene) return;
  let before = currentSceneState();
  clarke.scene = index;
  // След начинается заново, когда он появляется, а не когда уже виден:
  // переход от суммы к масштабу 2/3 продолжает тот же след.
  if (!before.trail && currentSceneState().trail) clarke.trail.fill(false);
  showScene();
}

function showScene() {
  let scene = CLARKE_SCENES[clarke.scene];
  controls["scene-number"].textContent = (clarke.scene + 1) + " / " + CLARKE_SCENES.length;
  controls["scene-title"].textContent = scene.title;
  controls["scene-text"].textContent = scene.text;
  controls["prev"].disabled = clarke.scene === 0;
  controls["next"].disabled = clarke.scene === CLARKE_SCENES.length - 1;
  controls["layers"].hidden = CLARKE_SCENE_STATES[clarke.scene] !== null;
}

function togglePause() {
  clarke.paused = !clarke.paused;
  controls["pause"].setAttribute("aria-pressed", String(clarke.paused));
  controls["pause"].textContent = clarke.paused ? "Пуск" : "Пауза";
}

function keyPressed() {
  // Стрелки сравниваются по имени клавиши: в p5 2 LEFT_ARROW — это строка
  // "ArrowLeft", и keyCode с ней не совпадает. Пробел и стрелки на кнопке или
  // ползунке принадлежат им самим: стрелки двигают ползунок времени, пробел
  // нажимает кнопку.
  let active = document.activeElement;
  let inControl = active && /^(BUTTON|INPUT)$/.test(active.tagName);
  let onSlider = active && active.type === "range";
  if (key === " " && !inControl) {
    togglePause();
    return false;
  }
  if (!onSlider && key === "ArrowLeft") {
    goToScene(clarke.scene - 1);
    return false;
  }
  if (!onSlider && key === "ArrowRight") {
    goToScene(clarke.scene + 1);
    return false;
  }
  let lower = String(key).toLowerCase();
  if (lower === "t" || lower === "е") toggleTheme();
}

// -- общие мелочи рисования --------------------------------------------------

function phaseEntries() {
  let palette = theme();
  return [palette.phaseA, palette.phaseB, palette.phaseC];
}

function baseTextSize() {
  return Math.max(11, Math.min(15, Math.min(width, height) / 40));
}

// Число со знаком и запятой: −0,00 при мелкой отрицательной величине выглядит
// как ошибка.
function formatValue(value) {
  let text = Math.abs(value) < 0.005 ? "0.00" : Math.abs(value).toFixed(2);
  let sign = Math.abs(value) < 0.005 ? " " : value > 0 ? "+" : "−";
  return sign + text.replace(".", ",");
}

function drawArrow(x0, y0, x1, y1, entry, weight, alpha) {
  let length = Math.hypot(x1 - x0, y1 - y0);
  if (length < 2 || alpha <= 0) return;
  strokeTheme(entry, alpha);
  strokeWeight(weight);
  // Линия кончается у основания наконечника, иначе толстый конец торчит из-под
  // острия.
  let size = Math.min(6 + weight * 2, length);
  let shorten = size * 0.8 / length;
  line(x0, y0, x1 - (x1 - x0) * shorten, y1 - (y1 - y0) * shorten);
  drawHead(x0, y0, x1, y1, entry, size, alpha);
}

function drawHead(x0, y0, x1, y1, entry, size, alpha) {
  let angle = Math.atan2(y1 - y0, x1 - x0);
  noStroke();
  fillTheme(entry, alpha);
  triangle(x1, y1,
    x1 - size * Math.cos(angle - 0.4), y1 - size * Math.sin(angle - 0.4),
    x1 - size * Math.cos(angle + 0.4), y1 - size * Math.sin(angle + 0.4));
}

function dashedLine(x0, y0, x1, y1, entry, alpha, weight = 1.2) {
  if (alpha <= 0) return;
  drawingContext.setLineDash([5, 5]);
  strokeTheme(entry, alpha);
  strokeWeight(weight);
  line(x0, y0, x1, y1);
  drawingContext.setLineDash([]);
}

// Строки текста на подложке цвета фона: надпись поверх осей и следа читается.
function textBox(lines, x, y, alignRight) {
  let size = baseTextSize() * 0.9;
  textSize(size);
  textStyle(NORMAL);
  let lead = size * 1.35;
  let widest = 0;
  for (const item of lines) widest = Math.max(widest, textWidth(item.text));
  let pad = 6;
  let boxX = alignRight ? x - widest - 2 * pad : x;
  noStroke();
  fillTheme(theme().motorBackground, 215);
  rect(boxX, y, widest + 2 * pad, lines.length * lead + pad, 4);
  textAlign(LEFT, TOP);
  lines.forEach((item, i) => {
    fillTheme(item.entry, item.alpha);
    text(item.text, boxX + pad, y + pad * 0.7 + i * lead);
  });
}

// -- графики -----------------------------------------------------------------

// График по одному периоду: θ = ωt от 0 до 360°, вертикальный курсор —
// текущий момент, точки на нём — мгновенные значения. Если график один и
// стоит рядом с плоскостью, его ноль и масштаб совпадают с плоскостью: точка
// на графике и конец вектора на одной высоте.
function drawGraph(area, view) {
  let palette = theme();
  let signals;
  if (area.name === "phase") {
    let entries = phaseEntries();
    signals = [
      { label: "a", value: (t) => clarkePhases(t).a, entry: entries[0] },
      { label: "b", value: (t) => clarkePhases(t).b, entry: entries[1] },
      { label: "c", value: (t) => clarkePhases(t).c, entry: entries[2] },
    ];
  } else {
    signals = [
      { label: "α", value: (t) => clarkeTransform(clarkePhases(t).a, clarkePhases(t).b, clarkePhases(t).c).alpha,
        entry: palette.clarkeAlpha },
      { label: "β", value: (t) => clarkeTransform(clarkePhases(t).a, clarkePhases(t).b, clarkePhases(t).c).beta,
        entry: palette.clarkeBeta },
    ];
  }

  let pad = { left: 34, right: 12, top: 26, bottom: 22 };
  let plot = {
    x: area.x + pad.left,
    y: area.y + pad.top,
    w: Math.max(area.w - pad.left - pad.right, 10),
    h: Math.max(area.h - pad.top - pad.bottom, 10),
  };
  let midY = plot.y + plot.h / 2;
  let yScale = plot.h / 2 / 1.2;
  let aligned = view.plane && !view.layout.stacked && view.layout.graphs.length === 1;
  if (aligned) {
    midY = view.plane.cy;
    yScale = view.plane.scale;
  }
  let toX = (theta) => plot.x + plot.w * theta / (2 * Math.PI);
  let toY = (value) => midY - value * yScale;
  let top = toY(1.2);
  let bottom = toY(-1.2);

  // Сетка: каждые 90° по времени, ±Um по значению.
  strokeWeight(1);
  for (let k = 0; k <= 4; k++) {
    strokeTheme(palette.axisAlphaBeta, k === 0 || k === 4 ? 70 : 35);
    line(toX(k * Math.PI / 2), top, toX(k * Math.PI / 2), bottom);
  }
  for (const level of [-1, 1]) {
    strokeTheme(palette.axisAlphaBeta, 35);
    line(plot.x, toY(level), plot.x + plot.w, toY(level));
  }
  strokeTheme(palette.axisAlphaBeta, 120);
  line(plot.x, midY, plot.x + plot.w, midY);

  let size = baseTextSize() * 0.8;
  noStroke();
  fillTheme(palette.legendLabel);
  textSize(size);
  textStyle(NORMAL);
  textAlign(RIGHT, CENTER);
  text("Um", plot.x - 6, toY(1));
  text("0", plot.x - 6, midY);
  text("−Um", plot.x - 6, toY(-1));
  textAlign(CENTER, TOP);
  for (let k = 0; k <= 4; k++) text(k * 90 + "°", toX(k * Math.PI / 2), bottom + 4);
  textAlign(RIGHT, BOTTOM);
  text("ωt", plot.x + plot.w, bottom - 2);

  noFill();
  strokeWeight(2);
  for (const signal of signals) {
    strokeTheme(signal.entry);
    beginShape();
    for (let i = 0; i <= 180; i++) {
      let theta = 2 * Math.PI * i / 180;
      vertex(toX(theta), toY(signal.value(theta)));
    }
    endShape();
  }

  // Курсор текущего момента и мгновенные значения.
  let cursorX = toX(clarke.theta);
  strokeTheme(palette.legendLabel, 200);
  strokeWeight(1.5);
  line(cursorX, top, cursorX, bottom);
  noStroke();
  for (const signal of signals) {
    fillTheme(signal.entry);
    circle(cursorX, toY(signal.value(clarke.theta)), 8);
  }

  // Легенда с мгновенными значениями — над графиком, в цвет кривой.
  textSize(baseTextSize());
  textStyle(BOLD);
  textAlign(LEFT, BOTTOM);
  let x = plot.x;
  for (const signal of signals) {
    let label = signal.label + " " + formatValue(signal.value(clarke.theta));
    fillTheme(signal.entry);
    text(label, x, top - 6);
    x += textWidth(label) + 16;
  }

  if (area.name === "ab" && clarke.morph.projAB > 0) {
    // Формулы прямого преобразования — у графика α и β, который они дают, но
    // не поверх кривых: под графиком, если там есть место, иначе в строке
    // легенды справа, насколько она позволяет.
    let alpha = 255 * clarkeEase(clarke.morph.projAB);
    if (area.y + area.h - (bottom + 24) > baseTextSize() * 4) {
      textBox([
        { text: "α = 2/3·(a − b/2 − c/2)", entry: palette.clarkeAlpha, alpha },
        { text: "β = (b − c)/√3", entry: palette.clarkeBeta, alpha },
        { text: "амплитудно-инвариантная форма, k = 2/3", entry: palette.legendLabel, alpha },
      ], plot.x, bottom + 24, false);
    } else {
      let formula = "α = 2/3·(a − b/2 − c/2),  β = (b − c)/√3";
      let room = plot.x + plot.w - x;
      let fit = baseTextSize() * 0.85;
      textStyle(NORMAL);
      textSize(fit);
      while (fit > 8 && textWidth(formula) > room) textSize(--fit);
      if (textWidth(formula) <= room) {
        fillTheme(palette.legendLabel, alpha);
        textAlign(RIGHT, BOTTOM);
        text(formula, plot.x + plot.w, top - 6);
      }
    }
  }

  // Сцена 3: связь точки на графике с концом вектора — пунктир на одной высоте.
  if (aligned && area.name === "phase") {
    let link = (1 - clarkeEase(clarke.morph.rotate)) * clarkeEase(clarke.morph.phase) * 140;
    let tips = phaseVectorScreen(view).tips;
    signals.forEach((signal, k) => {
      dashedLine(cursorX, toY(signal.value(clarke.theta)), tips[k][0], tips[k][1], signal.entry, link, 1);
    });
  }
}

// -- векторная плоскость -----------------------------------------------------

function planeGeometry(area) {
  return { cx: area.x + area.w / 2, cy: area.y + area.h / 2, scale: clarkePlaneScale(area), area };
}

// Положение фазных векторов на экране с учётом переходов: поворот с вертикали
// на свои оси и сдвиг в цепочку.
function phaseVectorScreen(view) {
  let { cx, cy, scale } = view.plane;
  let m = clarke.morph;
  let rotate = clarkeEase(m.rotate);
  let chain = clarkeEase(m.chain);
  let values = [view.phases.a, view.phases.b, view.phases.c];
  // На вертикали три вектора стоят рядом, а не друг на друге.
  let offsets = [-0.22, 0, 0.22];
  let starts = [];
  let tips = [];
  let along = [0, 0];
  for (let k = 0; k < 3; k++) {
    let angle = Math.PI / 2 + (CLARKE_PHASE_ANGLES[k] - Math.PI / 2) * rotate;
    let base = [offsets[k] * (1 - rotate) + along[0] * chain, along[1] * chain];
    let dx = values[k] * Math.cos(angle);
    let dy = values[k] * Math.sin(angle);
    starts.push([cx + base[0] * scale, cy - base[1] * scale]);
    tips.push([cx + (base[0] + dx) * scale, cy - (base[1] + dy) * scale]);
    along = [along[0] + values[k] * Math.cos(CLARKE_PHASE_ANGLES[k]),
      along[1] + values[k] * Math.sin(CLARKE_PHASE_ANGLES[k])];
  }
  return { starts, tips };
}

function drawPlane(view) {
  let palette = theme();
  let { cx, cy, scale } = view.plane;
  let m = clarke.morph;
  let toScreen = (x, y) => [cx + x * scale, cy - y * scale];
  let entries = phaseEntries();
  let shrinkNow = 1 - clarkeEase(m.shrink) * (1 - CLARKE_GAIN);
  let { sum } = clarkePhaseVectors(view.phases);
  let size = baseTextSize();

  if (m.stator > 0) drawStator(view, clarkeEase(m.stator));

  // Оси обмоток: положительная половина сплошная и подписана, отрицательная —
  // пунктиром. Со статором оси короче — внутри расточки.
  let axisLength = 1.65 - 0.3 * clarkeEase(m.stator);
  let axesAlpha = clarkeEase(m.axesABC);
  let abAlpha = clarkeEase(m.axesAB);
  if (axesAlpha > 0) {
    for (let k = 0; k < 3; k++) {
      let c = Math.cos(CLARKE_PHASE_ANGLES[k]);
      let s = Math.sin(CLARKE_PHASE_ANGLES[k]);
      let [x1, y1] = toScreen(c * axisLength, s * axisLength);
      let [x0, y0] = toScreen(-c * axisLength, -s * axisLength);
      dashedLine(cx, cy, x0, y0, entries[k], 70 * axesAlpha, 1);
      strokeTheme(entries[k], 150 * axesAlpha);
      strokeWeight(1.3);
      line(cx, cy, x1, y1);
      drawHead(cx, cy, x1, y1, entries[k], 9, 150 * axesAlpha);
      // Ось A совпадает с α: подпись A уходит под ось, α — над ней.
      let lift = k === 0 ? -0.14 * abAlpha : 0;
      let [lx, ly] = toScreen(c * (axisLength + 0.13), s * (axisLength + 0.13) + lift);
      noStroke();
      fillTheme(entries[k], 255 * axesAlpha);
      textAlign(CENTER, CENTER);
      textSize(size * 1.15);
      textStyle(BOLD);
      text(["A", "B", "C"][k], lx, ly);
    }
  }

  // Общая вертикаль, вдоль которой стоят векторы до поворота на свои оси.
  let vertical = (1 - clarkeEase(m.rotate)) * clarkeEase(m.phase);
  if (vertical > 0) {
    let [x0, y0] = toScreen(0, -1.3);
    let [x1, y1] = toScreen(0, 1.3);
    strokeTheme(palette.axisAlphaBeta, 160 * vertical);
    strokeWeight(1);
    line(x0, y0, x1, y1);
    strokeTheme(palette.axisAlphaBeta, 60 * vertical);
    for (const level of [-1, 1]) {
      let [xa, ya] = toScreen(-0.45, level);
      let [xb, yb] = toScreen(0.45, level);
      line(xa, ya, xb, yb);
    }
    noStroke();
    fillTheme(palette.legendLabel, 255 * vertical);
    textSize(size * 0.8);
    textStyle(NORMAL);
    textAlign(LEFT, CENTER);
    text("Um", toScreen(0.5, 1)[0], toScreen(0.5, 1)[1]);
    text("−Um", toScreen(0.5, -1)[0], toScreen(0.5, -1)[1]);
  }

  if (abAlpha > 0) {
    drawAxis(toScreen, 0, 1.65, palette.clarkeAlpha, "α", abAlpha, [0, 0.14]);
    drawAxis(toScreen, Math.PI / 2, 1.65, palette.clarkeBeta, "β", abAlpha, [0, 0]);
  }

  // След конца результирующего вектора — по отмеченным градусам угла.
  let trailAlpha = clarkeEase(m.trail) * clarkeEase(m.resultant);
  if (trailAlpha > 0) {
    let radius = 1.5 * CLARKE_AMPLITUDE * shrinkNow;
    strokeTheme(palette.clarkeResultant, 110 * trailAlpha);
    strokeWeight(2);
    for (let i = 0; i < CLARKE_TRAIL_BINS; i++) {
      if (!clarke.trail[i]) continue;
      let a0 = 2 * Math.PI * i / CLARKE_TRAIL_BINS;
      let a1 = 2 * Math.PI * (i + 1) / CLARKE_TRAIL_BINS;
      let [x0, y0] = toScreen(radius * Math.cos(a0), radius * Math.sin(a0));
      let [x1, y1] = toScreen(radius * Math.cos(a1), radius * Math.sin(a1));
      line(x0, y0, x1, y1);
    }
  }

  // Фазные векторы. На сценах с коэффициентом они бледнеют: главный там уже
  // результирующий.
  let phaseAlpha = 255 * clarkeEase(m.phase) * (1 - 0.65 * clarkeEase(m.phaseFaint));
  if (phaseAlpha > 0) {
    let { starts, tips } = phaseVectorScreen(view);
    for (let k = 0; k < 3; k++) {
      drawArrow(starts[k][0], starts[k][1], tips[k][0], tips[k][1], entries[k], 3, phaseAlpha);
      // Подпись у конца — только пока векторы стоят на общей вертикали (сцена
      // 3): там они рядом и одного цвета мало. На своих осях фазу и так
      // видно по оси, и подпись гаснет вместе с поворотом.
      let labelAlpha = phaseAlpha * (1 - clarkeEase(m.rotate));
      let dx = tips[k][0] - starts[k][0];
      let dy = tips[k][1] - starts[k][1];
      let length = Math.hypot(dx, dy);
      if (length > 14 && labelAlpha > 1) {
        noStroke();
        fillTheme(entries[k], labelAlpha);
        textAlign(CENTER, CENTER);
        textSize(size);
        textStyle(BOLD);
        text(["a", "b", "c"][k], tips[k][0] + dx / length * 11, tips[k][1] + dy / length * 11);
      }
    }
  }

  let tip = [sum[0] * shrinkNow, sum[1] * shrinkNow];

  // Проекции на α и β: пунктир от конца вектора и тонкие стрелки на осях.
  let projAB = clarkeEase(m.projAB) * clarkeEase(m.resultant);
  if (projAB > 0) {
    let [tx, ty] = toScreen(tip[0], tip[1]);
    let [ax, ay] = toScreen(tip[0], 0);
    let [bx, by] = toScreen(0, tip[1]);
    dashedLine(tx, ty, ax, ay, palette.clarkeAlpha, 150 * projAB);
    dashedLine(tx, ty, bx, by, palette.clarkeBeta, 150 * projAB);
    drawArrow(cx, cy, ax, ay, palette.clarkeAlpha, 2.5, 255 * projAB);
    drawArrow(cx, cy, bx, by, palette.clarkeBeta, 2.5, 255 * projAB);
  }

  // Проекции на оси фаз — обратное преобразование.
  let projABC = clarkeEase(m.projABC) * clarkeEase(m.resultant);
  let back = clarkeInverse(tip[0], tip[1]);
  if (projABC > 0) {
    let [tx, ty] = toScreen(tip[0], tip[1]);
    [back.a, back.b, back.c].forEach((value, k) => {
      let [fx, fy] = toScreen(value * Math.cos(CLARKE_PHASE_ANGLES[k]),
        value * Math.sin(CLARKE_PHASE_ANGLES[k]));
      dashedLine(tx, ty, fx, fy, entries[k], 150 * projABC);
      drawArrow(cx, cy, fx, fy, entries[k], 2.5, 255 * projABC);
    });
  }

  // Длина суммы до умножения на 2/3 — бледный пунктирный контур.
  let ghost = clarkeEase(m.ghost) * clarkeEase(m.resultant);
  if (ghost > 0) {
    let [gx, gy] = toScreen(sum[0], sum[1]);
    drawingContext.setLineDash([6, 5]);
    drawArrow(cx, cy, gx, gy, palette.clarkeResultant, 1.5, 120 * ghost);
    drawingContext.setLineDash([]);
  }

  let resultant = clarkeEase(m.resultant);
  if (resultant > 0) {
    let [tx, ty] = toScreen(tip[0], tip[1]);
    drawArrow(cx, cy, tx, ty, palette.clarkeResultant, 4, 255 * resultant);
  }

  // Числа — в правом верхнем углу плоскости, там их не закрывают оси.
  let lines = [];
  let lengthAlpha = 255 * resultant * Math.max(1 - clarkeEase(m.shrink), clarkeEase(m.ghost));
  if (lengthAlpha > 1) {
    let full = Math.hypot(sum[0], sum[1]);
    lines.push({ text: "|a + b + c| = " + formatValue(full).slice(1) + "·Um",
      entry: palette.clarkeResultant, alpha: lengthAlpha });
    let shrink = clarkeEase(m.shrink);
    if (shrink > 0) {
      lines.push({ text: "× 2/3 → " + formatValue(full * shrinkNow).slice(1) + "·Um",
        entry: palette.clarkeResultant, alpha: lengthAlpha * shrink });
    }
  }
  if (projABC > 0) {
    let original = [view.phases.a, view.phases.b, view.phases.c];
    [back.a, back.b, back.c].forEach((value, k) => {
      lines.push({ text: "на " + "ABC"[k] + ": " + formatValue(value) + "   " + "abc"[k] + " = "
        + formatValue(original[k]), entry: entries[k], alpha: 255 * projABC });
    });
  }
  if (lines.length > 0) {
    let area = view.plane.area;
    textBox(lines, area.x + area.w - 6, area.y + 6, true);
  }
}

function drawAxis(toScreen, angle, length, entry, label, alpha, labelShift) {
  let c = Math.cos(angle);
  let s = Math.sin(angle);
  let [x0, y0] = toScreen(-c * length, -s * length);
  let [x1, y1] = toScreen(c * length, s * length);
  strokeTheme(entry, 200 * alpha);
  strokeWeight(1.5);
  line(x0, y0, x1, y1);
  drawHead(x0, y0, x1, y1, entry, 9, 200 * alpha);
  let [lx, ly] = toScreen(c * (length + 0.13) + labelShift[0], s * (length + 0.13) + labelShift[1]);
  noStroke();
  fillTheme(entry, 255 * alpha);
  textAlign(CENTER, CENTER);
  textSize(baseTextSize() * 1.25);
  textStyle(BOLD);
  text(label, lx, ly);
}

// Статор схематично: кольцо ярма и по паре пазов на фазу. Сторона катушки,
// на 90° впереди оси, при положительном токе несёт ток к нам (⊙), задняя —
// от нас (⊗): по правилу правой руки МДС такой катушки направлена по её оси.
function drawStator(view, alpha) {
  let palette = theme();
  let { cx, cy, scale } = view.plane;
  let inner = 1.45 * scale;
  let outer = 1.8 * scale;
  noStroke();
  fillTheme(palette.statorYoke, 255 * alpha);
  circle(cx, cy, 2 * outer);
  fillTheme(palette.motorBackground, 255);
  circle(cx, cy, 2 * inner);
  noFill();
  strokeTheme(palette.statorOutline, 200 * alpha);
  strokeWeight(1);
  circle(cx, cy, 2 * outer);
  circle(cx, cy, 2 * inner);

  let values = [view.phases.a, view.phases.b, view.phases.c];
  let entries = phaseEntries();
  let slotRadius = 1.6 * scale;
  let mark = Math.max(7, 0.12 * scale);
  for (let k = 0; k < 3; k++) {
    for (const side of [1, -1]) {
      let angle = CLARKE_PHASE_ANGLES[k] + side * Math.PI / 2;
      let x = cx + slotRadius * Math.cos(angle);
      let y = cy - slotRadius * Math.sin(angle);
      // Ток к нам в передней стороне при положительном значении.
      let towards = (values[k] >= 0) === (side === 1);
      let strength = Math.min(1, Math.abs(values[k]) / CLARKE_AMPLITUDE);
      fillTheme(palette.coilMarkerFill, 255 * alpha);
      strokeTheme(entries[k], 255 * alpha);
      strokeWeight(2);
      circle(x, y, 2 * mark);
      strokeTheme(entries[k], 255 * alpha * (0.25 + 0.75 * strength));
      if (towards) {
        noStroke();
        fillTheme(entries[k], 255 * alpha * (0.25 + 0.75 * strength));
        circle(x, y, mark * 0.6);
      } else {
        let d = mark * 0.5;
        line(x - d, y - d, x + d, y + d);
        line(x - d, y + d, x + d, y - d);
      }
    }
  }
}

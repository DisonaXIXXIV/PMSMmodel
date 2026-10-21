// Тесты расчётной части страницы преобразования Кларк (clarke/ClarkeTransform.js)
// и состава сцен (clarke/scenes.js). Как и park-diagnostics.js, отдельно от
// модели машины: страница самостоятельная. Запускается из npm test.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

for (const name of ["scenes.js", "ClarkeTransform.js"]) {
  let file = path.resolve(__dirname, "..", "clarke", name);
  vm.runInThisContext(fs.readFileSync(file, "utf8"), { filename: "clarke/" + name });
}

let failures = 0;
function check(condition, message) {
  if (!condition) {
    failures++;
    console.log("FAIL: " + message);
  }
}
const close = (a, b) => Math.abs(a - b) < 1e-9;
const angles = [0, 0.3, 1.0, 2.0, Math.PI, 4.2, 5.9];

// Симметричная система: сумма фаз ноль, B отстаёт от A на 120°.
function testClarkePhases() {
  for (const theta of angles) {
    let p = clarkePhases(theta);
    check(close(p.a + p.b + p.c, 0), "phases sum to zero at " + theta);
  }
  let p = clarkePhases(2 * Math.PI / 3);
  check(close(p.b, CLARKE_AMPLITUDE), "phase B peaks 120 degrees after A");
}

// Амплитудно-инвариантная форма: α = Um·cos ωt, β = Um·sin ωt, длина равна Um,
// обратное преобразование возвращает фазы.
function testClarkeTransform() {
  for (const theta of angles) {
    let p = clarkePhases(theta);
    let ab = clarkeTransform(p.a, p.b, p.c);
    check(close(ab.alpha, Math.cos(theta)) && close(ab.beta, Math.sin(theta)),
      "alpha-beta rotate counter-clockwise at " + theta);
    check(close(Math.hypot(ab.alpha, ab.beta), CLARKE_AMPLITUDE), "vector length equals amplitude at " + theta);
    let back = clarkeInverse(ab.alpha, ab.beta);
    check(close(back.a, p.a) && close(back.b, p.b) && close(back.c, p.c),
      "inverse transform restores phases at " + theta);
  }
}

// Сумма фазных векторов на своих осях — 1,5·Um, и после 2/3 это α–β.
function testClarkePhaseVectors() {
  for (const theta of angles) {
    let p = clarkePhases(theta);
    let { sum } = clarkePhaseVectors(p);
    check(close(Math.hypot(sum[0], sum[1]), 1.5 * CLARKE_AMPLITUDE), "phase vector sum is 1.5 Um at " + theta);
    let ab = clarkeTransform(p.a, p.b, p.c);
    check(close(sum[0] * CLARKE_GAIN, ab.alpha) && close(sum[1] * CLARKE_GAIN, ab.beta),
      "scaled sum equals alpha-beta at " + theta);
  }
}

// Сцен столько, сколько состояний, у каждой есть заголовок и текст, а поля
// состояний — известные переходы.
function testClarkeScenes() {
  check(CLARKE_SCENES.length === CLARKE_SCENE_STATES.length, "every scene text has a scene state");
  CLARKE_SCENES.forEach((scene, i) => {
    check(typeof scene.title === "string" && scene.title.length > 0, "scene " + (i + 1) + " has a title");
    check(typeof scene.text === "string" && scene.text.length > 0, "scene " + (i + 1) + " has a text");
    let state = clarkeSceneState(i);
    check(Array.isArray(state.layout) && state.layout.length > 0, "scene " + (i + 1) + " has a layout");
    for (const key of Object.keys(state)) {
      check(key === "layout" || CLARKE_MORPH_KEYS.includes(key),
        "scene " + (i + 1) + " uses known field " + key);
    }
  });
  let none = clarkeLayerState({ phaseGraph: false, abGraph: false, phaseVectors: false,
    resultant: false, projections: false });
  check(none.layout.length === 1 && none.layout[0] === "plane", "overview without graphs keeps the plane");
}

// Скорость по умолчанию попадает в диапазон ползунка и ложится на его шаг.
function testClarkeSpeed() {
  check(CLARKE_SPEED_MINIMUM > 0, "speed slider does not reach zero, pause stops time");
  check(CLARKE_DEFAULT_SPEED >= CLARKE_SPEED_MINIMUM && CLARKE_DEFAULT_SPEED <= CLARKE_SPEED_MAXIMUM,
    "default speed within slider range");
  let steps = (CLARKE_DEFAULT_SPEED - CLARKE_SPEED_MINIMUM) / CLARKE_SPEED_STEP;
  check(Math.abs(steps - Math.round(steps)) < 1e-6, "default speed lies on a slider step");
}

// Переход проходит путь 0 → 1 ровно за свою длительность и не перескакивает.
function testClarkeApproach() {
  let value = 0;
  let steps = 0;
  while (value < 1 && steps < 1000) {
    value = clarkeApproach(value, 1, 0.01);
    steps++;
  }
  check(Math.abs(steps * 0.01 - CLARKE_TRANSITION) < 0.011, "transition takes its duration");
  check(clarkeApproach(0.5, 0, 10) === 0, "transition stops at the target");
  check(clarkeEase(0) === 0 && clarkeEase(1) === 1 && close(clarkeEase(0.5), 0.5), "easing keeps ends");
  check(CLARKE_TRANSITION >= 0.5 && CLARKE_TRANSITION <= 1.0, "transition lasts 0.5 to 1 s");
}

// След: ход времени заполняет путь без дыр, прыжок ползунка — только точку.
function testClarkeTrail() {
  let bins = new Array(CLARKE_TRAIL_BINS).fill(false);
  clarkeMarkTrail(bins, 0.1, 0.3);
  let first = clarkeTrailBin(0.1);
  let last = clarkeTrailBin(0.3);
  let filled = true;
  for (let i = first; i <= last; i++) filled = filled && bins[i];
  check(filled, "short step fills the trail");
  clarkeMarkTrail(bins, 6.2, 0.05);
  check(bins[clarkeTrailBin(6.25)] && bins[0], "step across zero fills both sides");
  bins.fill(false);
  clarkeMarkTrail(bins, 0, 3);
  check(bins.filter(Boolean).length === 1, "jump marks only the end point");
}

// Области лежат внутри полотна и не налезают друг на друга.
function testClarkeLayout() {
  const inside = (r, w, h) => r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= w + 1e-9
    && r.y + r.h <= h + 1e-9 && r.w > 0 && r.h > 0;
  const overlap = (a, b) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9
    && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;
  for (const [w, h] of [[700, 370], [1200, 760], [390, 480], [360, 700]]) {
    for (let i = 0; i < CLARKE_SCENES.length; i++) {
      let state = clarkeSceneState(i);
      let layout = clarkeLayout(w, h, state.layout);
      let rects = layout.graphs.slice();
      if (layout.plane) rects.push(layout.plane);
      check(rects.length === state.layout.length, "every area gets a rectangle at " + w + "x" + h);
      for (const r of rects) check(inside(r, w, h), "scene " + (i + 1) + " area inside canvas at " + w + "x" + h);
      for (let a = 0; a < rects.length; a++) {
        for (let b = a + 1; b < rects.length; b++) {
          check(!overlap(rects[a], rects[b]), "scene " + (i + 1) + " areas do not overlap at " + w + "x" + h);
        }
      }
    }
  }
}

testClarkePhases();
testClarkeTransform();
testClarkePhaseVectors();
testClarkeScenes();
testClarkeSpeed();
testClarkeApproach();
testClarkeTrail();
testClarkeLayout();

if (failures > 0) console.log("Clarke diagnostics failed: " + failures);
else console.log("All Clarke diagnostics passed.");
process.exitCode = failures === 0 ? 0 : 1;

// Расчётная часть страницы преобразования Кларк: фазные величины, само
// преобразование, состояние сцен, плавные переходы и раскладка полотна. Здесь
// нет ни одной функции p5 — файл выполняют и браузер, и тесты в Node
// (tests/clarke-diagnostics.js).
//
// Преобразование — в амплитудно-инвариантной форме (коэффициент 2/3): длина
// вектора равна амплитуде фазы. Порядок фаз ABC, ось A совпадает с α,
// положительное вращение — против часовой стрелки.

// Амплитуда фазы. Значения показываются в долях Um, поэтому она единичная.
const CLARKE_AMPLITUDE = 1.0;
// Скорость вращения вектора (частота фаз) в оборотах в секунду — задаётся
// ползунком. По умолчанию оборот за 10 с: за курсором и проекциями успевают
// следить, пока объясняют. Верхний предел — оборот за 2 с, быстрее глаз не
// успевает; нижний — не ноль: остановить время можно паузой.
const CLARKE_SPEED_MINIMUM = 0.02;
const CLARKE_SPEED_MAXIMUM = 0.5;
const CLARKE_SPEED_STEP = 0.01;
const CLARKE_DEFAULT_SPEED = 0.1;
// Длительность переходов внутри сцен (поворот векторов, сложение, масштаб).
const CLARKE_TRANSITION = 0.8;
// Коэффициент амплитудно-инвариантной формы.
const CLARKE_GAIN = 2 / 3;

// Оси обмоток A, B, C: 0°, 120°, 240°.
const CLARKE_PHASE_ANGLES = [0, 2 * Math.PI / 3, 4 * Math.PI / 3];

// Угол в [0, 2π): ползунок времени и графики идут по одному периоду.
function clarkeWrapAngle(angle) {
  let turn = 2 * Math.PI;
  let wrapped = angle % turn;
  return wrapped < 0 ? wrapped + turn : wrapped;
}

// Мгновенные значения фаз при угле θ = ωt: косинусы со сдвигом на 120°,
// фаза B отстаёт от A, C — от B.
function clarkePhases(theta, amplitude = CLARKE_AMPLITUDE) {
  return {
    a: amplitude * Math.cos(theta),
    b: amplitude * Math.cos(theta - 2 * Math.PI / 3),
    c: amplitude * Math.cos(theta + 2 * Math.PI / 3),
  };
}

// Прямое преобразование Кларк, амплитудно-инвариантная форма.
function clarkeTransform(a, b, c) {
  return {
    alpha: CLARKE_GAIN * (a - b / 2 - c / 2),
    beta: (b - c) / Math.sqrt(3),
  };
}

// Обратное преобразование: проекции вектора α–β на оси A, B, C.
function clarkeInverse(alpha, beta) {
  let k = Math.sqrt(3) / 2;
  return { a: alpha, b: -alpha / 2 + k * beta, c: -alpha / 2 - k * beta };
}

// Векторы фаз на своих осях и их сумма — без коэффициента 2/3: на сцене
// сложения её длина 1,5·Um, и коэффициент вводится отдельной сценой.
function clarkePhaseVectors(phases) {
  let values = [phases.a, phases.b, phases.c];
  let vectors = values.map((value, k) => [
    value * Math.cos(CLARKE_PHASE_ANGLES[k]),
    value * Math.sin(CLARKE_PHASE_ANGLES[k]),
  ]);
  let sum = [0, 0];
  for (const v of vectors) {
    sum[0] += v[0];
    sum[1] += v[1];
  }
  return { vectors, sum };
}

// -- сцены -------------------------------------------------------------------

// Что видно на каждой сцене, по номеру записи CLARKE_SCENES (scenes.js).
// layout — набор областей полотна: "phase" — синусоиды фаз, "ab" — графики
// α(t) и β(t), "plane" — векторная плоскость. Остальные поля — цели
// переходов, от 0 до 1: значение плавно идёт к цели за CLARKE_TRANSITION.
//   stator     — статор с катушками;
//   rotate     — 0: векторы вдоль вертикали, 1: на своих осях;
//   chain      — 0: векторы из начала координат, 1: цепочкой;
//   shrink     — 1: сумма умножена на 2/3;
//   phase      — фазные векторы; phaseFaint — они же бледно, как фон;
//   resultant  — результирующий вектор; ghost — его длина до умножения на 2/3;
//   trail      — след конца вектора; projAB, projABC — проекции на α–β и на A, B, C;
//   axesABC, axesAB — оси.
const CLARKE_SCENE_STATES = [
  { layout: ["phase"] },
  { layout: ["plane"], stator: 1, axesABC: 1, phase: 1, rotate: 1 },
  { layout: ["phase", "plane"], phase: 1 },
  { layout: ["phase", "plane"], phase: 1, rotate: 1, axesABC: 1 },
  { layout: ["phase", "plane"], phase: 1, rotate: 1, axesABC: 1, chain: 1, resultant: 1, trail: 1 },
  { layout: ["phase", "plane"], phase: 1, phaseFaint: 1, rotate: 1, axesABC: 1, chain: 1,
    resultant: 1, trail: 1, shrink: 1, ghost: 1 },
  { layout: ["ab", "plane"], phase: 1, phaseFaint: 1, rotate: 1, axesABC: 1, axesAB: 1,
    resultant: 1, trail: 1, shrink: 1, projAB: 1 },
  { layout: ["phase", "plane"], rotate: 1, axesABC: 1, resultant: 1, trail: 1, shrink: 1,
    projABC: 1 },
  // Последняя сцена собирается из флажков слоёв: clarkeLayerState.
  null,
];

const CLARKE_MORPH_KEYS = ["stator", "rotate", "chain", "shrink", "phase", "phaseFaint",
  "resultant", "ghost", "trail", "projAB", "projABC", "axesABC", "axesAB"];

// Слои общего вида и их положение при открытии.
const CLARKE_DEFAULT_LAYERS = {
  phaseGraph: true,
  abGraph: true,
  phaseVectors: true,
  resultant: true,
  projections: true,
};

// Состояние сцены «всё вместе» по флажкам слоёв.
function clarkeLayerState(layers) {
  let layout = [];
  if (layers.phaseGraph) layout.push("phase");
  if (layers.abGraph) layout.push("ab");
  layout.push("plane");
  return {
    layout,
    rotate: 1,
    axesABC: 1,
    axesAB: 1,
    shrink: 1,
    phase: layers.phaseVectors ? 1 : 0,
    resultant: layers.resultant ? 1 : 0,
    trail: layers.resultant ? 1 : 0,
    projAB: layers.projections ? 1 : 0,
  };
}

function clarkeSceneState(index, layers = CLARKE_DEFAULT_LAYERS) {
  let state = CLARKE_SCENE_STATES[index];
  return state === null ? clarkeLayerState(layers) : state;
}

// Цели переходов сцены: не названное в ней поле — 0.
function clarkeMorphTargets(state) {
  let targets = {};
  for (const key of CLARKE_MORPH_KEYS) targets[key] = state[key] || 0;
  return targets;
}

// Шаг перехода: значение идёт к цели равномерно и за CLARKE_TRANSITION
// проходит весь путь от 0 до 1. Сглаживание — при чтении (clarkeEase), чтобы
// переход, развёрнутый на полпути, продолжался из того же места.
function clarkeApproach(value, target, dt, duration = CLARKE_TRANSITION) {
  let step = dt / duration;
  if (Math.abs(target - value) <= step) return target;
  return value + Math.sign(target - value) * step;
}

function clarkeEase(p) {
  return p * p * (3 - 2 * p);
}

// -- след конца вектора ------------------------------------------------------

// След хранится не точками, а отметками по градусам угла: при прокрутке
// ползунком он дорисовывается там, где побывал вектор, и не копится без конца.
const CLARKE_TRAIL_BINS = 360;

function clarkeTrailBin(theta) {
  return Math.floor(clarkeWrapAngle(theta) / (2 * Math.PI) * CLARKE_TRAIL_BINS) % CLARKE_TRAIL_BINS;
}

// Отмечает путь от прежнего угла к новому. Короткий шаг — это ход времени,
// и он заполняется целиком, иначе на быстром шаге в следе были бы дыры;
// длинный — прыжок ползунка, и отмечается только конечная точка.
function clarkeMarkTrail(bins, previous, current) {
  let delta = clarkeWrapAngle(current - previous + Math.PI) - Math.PI;
  if (Math.abs(delta) <= Math.PI / 6) {
    let steps = Math.ceil(Math.abs(delta) / (2 * Math.PI) * CLARKE_TRAIL_BINS) + 1;
    for (let i = 0; i <= steps; i++) bins[clarkeTrailBin(previous + delta * i / steps)] = true;
  } else {
    bins[clarkeTrailBin(current)] = true;
  }
  return bins;
}

// -- раскладка ---------------------------------------------------------------

// Раскладка полотна по набору областей сцены. Векторная плоскость — квадрат
// справа (на широком полотне) или сверху (на узком портретном), графики
// делят остальное поровну. Плоскость стоит на одном месте во всех сценах с
// графиками, и переходы между ними не дёргают картинку.
function clarkeLayout(width, height, areas) {
  let margin = 10;
  let gap = 8;
  let hasPlane = areas.includes("plane");
  let graphs = areas.filter((name) => name !== "plane");
  let result = { plane: null, graphs: [], stacked: false };
  let full = { x: 0, y: 0, w: width, h: height };

  if (!hasPlane) {
    result.graphs = splitRows({ x: margin, y: margin, w: width - 2 * margin, h: height - 2 * margin },
      graphs, gap);
    return result;
  }
  if (graphs.length === 0) {
    result.plane = full;
    return result;
  }
  // Портретное полотно: плоскость сверху, графики под ней.
  if (height > width * 1.1) {
    let side = Math.min(width, height * 0.55);
    result.stacked = true;
    result.plane = { x: (width - side) / 2, y: 0, w: side, h: side };
    result.graphs = splitRows({ x: margin, y: side, w: width - 2 * margin, h: height - side - margin },
      graphs, gap);
    return result;
  }
  let side = Math.min(height, width * 0.5);
  result.plane = { x: width - side, y: (height - side) / 2, w: side, h: side };
  result.graphs = splitRows({ x: margin, y: margin, w: width - side - margin, h: height - 2 * margin },
    graphs, gap);
  return result;
}

function splitRows(area, names, gap) {
  let each = (area.h - gap * (names.length - 1)) / names.length;
  return names.map((name, i) => ({
    name, x: area.x, y: area.y + i * (each + gap), w: area.w, h: each,
  }));
}

// Масштаб плоскости: пикселей на Um. С запасом под сумму 1,5·Um, подписи осей
// и значки статора.
function clarkePlaneScale(plane) {
  return Math.min(plane.w, plane.h) * 0.25;
}

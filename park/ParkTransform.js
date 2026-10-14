// Расчётная часть страницы преобразования Парка: углы, поворот и «прилипание»
// ползунков скорости. Здесь нет ни одной функции p5 — файл выполняют и
// браузер, и тесты в Node (tests/park-diagnostics.js).

// Скорости вектора и осей u–v — в оборотах в секунду. Диапазон симметричный:
// вращение в обратную сторону показывает, что преобразование от знака не
// зависит. Больше полуоборота в секунду глаз за проекциями уже не успевает.
const PARK_SPEED_MINIMUM = -0.5;
const PARK_SPEED_MAXIMUM = 0.5;
const PARK_SPEED_STEP = 0.01;
// Насколько близко надо отпустить ползунок к скорости соседа, чтобы скорости
// стали равны. 3 % диапазона: пальцем на телефоне ровно в ту же точку не
// попасть, а случайно прилипнуть с такого расстояния нельзя.
const PARK_SPEED_SNAP = 0.03;

const PARK_AMPLITUDE_MAXIMUM = 1.0;

const PARK_DEFAULT_VECTOR_SPEED = 0.25;
const PARK_DEFAULT_FRAME_SPEED = 0.1;
const PARK_DEFAULT_AMPLITUDE = 0.8;

// Угол в [-π, π): накопленный угол растёт без предела, а синус большого числа
// теряет точность — за час показа это было бы заметно.
function parkWrapAngle(angle) {
  let turn = 2 * Math.PI;
  let wrapped = (angle + Math.PI) % turn;
  if (wrapped < 0) wrapped += turn;
  return wrapped - Math.PI;
}

// Вектор в неподвижных осях по амплитуде и углу.
function parkAlphaBeta(amplitude, angle) {
  return { alpha: amplitude * Math.cos(angle), beta: amplitude * Math.sin(angle) };
}

// Само преобразование Парка: те же α и β в осях u–v, повёрнутых на угол
// frameAngle. Это поворот на −frameAngle, поэтому длина вектора сохраняется.
function parkTransform(alpha, beta, frameAngle) {
  let c = Math.cos(frameAngle);
  let s = Math.sin(frameAngle);
  return { u: alpha * c + beta * s, v: -alpha * s + beta * c };
}

// Отпущенный ползунок встаёт на скорость соседа или на ноль, если оказался к
// ним ближе порога. Ноль — потому что неподвижный вектор или неподвижные оси
// u–v (тогда это просто повёрнутые α–β) — такие же важные случаи, как равные
// скорости. Из двух близких целей берётся ближайшая, при равенстве — сосед.
// Сравнение с запасом в полшага: значение ползунка приходит строкой и
// округлено до шага, и ровно на пороге оно не должно зависеть от погрешности.
function parkSnapSpeed(moved, other, threshold = PARK_SPEED_SNAP) {
  let limit = threshold + PARK_SPEED_STEP * 0.5;
  let best = moved;
  let bestDistance = Infinity;
  for (const target of [other, 0]) {
    let distance = Math.abs(moved - target);
    if (distance <= limit && distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}

// -- осциллограммы -----------------------------------------------------------

// Окно осциллограмм в секундах. При самой медленной заметной скорости
// (0,25 об/с) в него помещается период, при предельной (0,5 об/с) — два.
const PARK_SCOPE_WINDOW = 4.0;

// Раскладка полотна: векторная диаграмма и под ней или рядом осциллограммы —
// сверху α и β, снизу u и v. Без осей u–v нижняя осциллограмма не нужна, и
// верхняя занимает всё место. Широкое полотно делится по горизонтали
// (диаграмма слева), узкое и портретное — по вертикали.
function parkLayout(width, height, showFrame) {
  let margin = 12;
  let gap = 10;
  let diagram;
  let scopeArea;
  if (width >= height * 1.25) {
    let side = Math.min(height, width * 0.5);
    diagram = { x: 0, y: 0, w: side, h: height };
    scopeArea = { x: side, y: margin, w: width - side - margin, h: height - 2 * margin };
  } else {
    let side = Math.min(width, height * 0.55);
    diagram = { x: 0, y: 0, w: width, h: side };
    scopeArea = { x: margin, y: side, w: width - 2 * margin, h: height - side - margin };
  }
  let scopes;
  if (showFrame) {
    let each = (scopeArea.h - gap) / 2;
    scopes = [
      { x: scopeArea.x, y: scopeArea.y, w: scopeArea.w, h: each },
      { x: scopeArea.x, y: scopeArea.y + each + gap, w: scopeArea.w, h: each },
    ];
  } else {
    scopes = [scopeArea];
  }
  return { diagram, scopes };
}

// Отбрасывает отсчёты старше окна, но один за левым краем оставляет: иначе
// кривая начиналась бы не от края, а с первого отсчёта внутри окна.
function parkTrimHistory(samples, now, window = PARK_SCOPE_WINDOW) {
  let first = 0;
  while (first + 1 < samples.length && samples[first + 1].t <= now - window) first++;
  if (first > 0) samples.splice(0, first);
  return samples;
}

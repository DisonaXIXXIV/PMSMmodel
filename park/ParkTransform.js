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

// Отпущенный ползунок встаёт на скорость соседа, если оказался к ней ближе
// порога. Сравнение с запасом в полшага: значение ползунка приходит строкой и
// округлено до шага, и ровно на пороге оно не должно зависеть от погрешности.
function parkSnapSpeed(moved, other, threshold = PARK_SPEED_SNAP) {
  return Math.abs(moved - other) <= threshold + PARK_SPEED_STEP * 0.5 ? other : moved;
}

// Страница преобразования Парка: вектор вращается в неподвижных осях α–β, оси
// u–v вращаются со своей скоростью, а проекции показывают, что видит каждая
// система координат. Когда скорости равны, вектор в осях u–v стоит на месте —
// ради этого преобразование Парка и делают.
//
// Расчёт — в ParkTransform.js, здесь только состояние, панель и рисование.

const park = {
  amplitude: PARK_DEFAULT_AMPLITUDE,
  vectorSpeed: PARK_DEFAULT_VECTOR_SPEED,
  frameSpeed: PARK_DEFAULT_FRAME_SPEED,
  vectorAngle: 0.0,
  // Оси u–v стартуют не совпадая с вектором: иначе с первого кадра не видно,
  // что это две разные вещи и что кнопка «Синхронизировать» что-то делает.
  frameAngle: -Math.PI / 4,
  showAlphaBeta: true,
  showUv: true,
  // Оси u–v можно убрать целиком, вместе с проекциями на них: тогда на
  // картинке остаётся только вектор в α–β, с чего объяснение и начинается.
  showFrame: true,
  paused: false,
};

const controls = {};

function setup() {
  let stage = document.getElementById("stage");
  let canvas = createCanvas(stage.clientWidth, stage.clientHeight);
  canvas.parent(stage);
  pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
  bindControls();
  refreshControls();
}

function windowResized() {
  let stage = document.getElementById("stage");
  resizeCanvas(stage.clientWidth, stage.clientHeight);
}

function draw() {
  // Шаг по реальному времени, но не больше 0,1 с: после возврата на вкладку
  // вектор не должен перепрыгивать на полоборота.
  let dt = park.paused ? 0.0 : Math.min(deltaTime / 1000.0, 0.1);
  park.vectorAngle = parkWrapAngle(park.vectorAngle + 2 * Math.PI * park.vectorSpeed * dt);
  park.frameAngle = parkWrapAngle(park.frameAngle + 2 * Math.PI * park.frameSpeed * dt);

  let ab = parkAlphaBeta(park.amplitude, park.vectorAngle);
  let uv = parkTransform(ab.alpha, ab.beta, park.frameAngle);

  backgroundTheme(theme().motorBackground);
  drawScene(ab, uv);
  updateReadouts(ab, uv);
}

// -- панель ------------------------------------------------------------------

function bindControls() {
  for (const id of ["amplitude", "vector-speed", "frame-speed", "sync", "pause", "theme",
    "show-alpha-beta", "show-uv", "show-frame", "vector-speed-mark", "frame-speed-mark",
    "amplitude-value", "vector-speed-value", "frame-speed-value",
    "read-alpha", "read-beta", "read-u", "read-v", "read-slip"]) {
    controls[id] = document.getElementById(id);
  }

  configureSlider(controls["amplitude"], 0, PARK_AMPLITUDE_MAXIMUM, 0.01, park.amplitude);
  configureSlider(controls["vector-speed"], PARK_SPEED_MINIMUM, PARK_SPEED_MAXIMUM,
    PARK_SPEED_STEP, park.vectorSpeed);
  configureSlider(controls["frame-speed"], PARK_SPEED_MINIMUM, PARK_SPEED_MAXIMUM,
    PARK_SPEED_STEP, park.frameSpeed);

  controls["amplitude"].addEventListener("input", (event) => {
    park.amplitude = Number(event.target.value);
    refreshControls();
  });
  bindSpeedSlider(controls["vector-speed"], "vectorSpeed", "frameSpeed");
  bindSpeedSlider(controls["frame-speed"], "frameSpeed", "vectorSpeed");

  controls["sync"].addEventListener("click", synchroniseFrame);
  controls["pause"].addEventListener("click", togglePause);
  controls["theme"].addEventListener("click", toggleTheme);
  controls["show-alpha-beta"].addEventListener("change", (event) => {
    park.showAlphaBeta = event.target.checked;
  });
  controls["show-uv"].addEventListener("change", (event) => {
    park.showUv = event.target.checked;
  });
  controls["show-frame"].addEventListener("change", (event) => {
    park.showFrame = event.target.checked;
    // Без осей проекциям на них не на что ложиться: флажок остаётся в своём
    // положении, но выключен, и при возврате осей проекции вернутся как были.
    controls["show-uv"].disabled = !park.showFrame;
  });
}

function configureSlider(input, minimum, maximum, step, value) {
  input.min = minimum;
  input.max = maximum;
  input.step = step;
  input.value = value;
}

// Ползунок скорости. Прилипание к соседу срабатывает, только когда ползунок
// отпустили после перетаскивания: со стрелками клавиатуры оно не дало бы
// поставить скорость в двух шагах от соседней.
function bindSpeedSlider(input, field, otherField) {
  let dragging = false;
  input.addEventListener("pointerdown", () => { dragging = true; });
  input.addEventListener("input", () => {
    park[field] = Number(input.value);
    refreshControls();
  });
  input.addEventListener("change", () => {
    let value = Number(input.value);
    if (dragging) value = parkSnapSpeed(value, park[otherField]);
    dragging = false;
    park[field] = value;
    input.value = value;
    refreshControls();
  });
}

// Оси u–v встают по вектору и дальше крутятся со своей скоростью.
function synchroniseFrame() {
  park.frameAngle = park.vectorAngle;
  // Короткая подсветка кнопки: при равных скоростях после нажатия на картинке
  // может ничего не поменяться, и без отклика непонятно, сработала ли она.
  controls["sync"].classList.add("flash");
  setTimeout(() => controls["sync"].classList.remove("flash"), 200);
}

function togglePause() {
  park.paused = !park.paused;
  controls["pause"].setAttribute("aria-pressed", String(park.paused));
}

function refreshControls() {
  controls["amplitude-value"].textContent = park.amplitude.toFixed(2);
  controls["vector-speed-value"].textContent = formatSigned(park.vectorSpeed);
  controls["frame-speed-value"].textContent = formatSigned(park.frameSpeed);
  // Каждый ползунок скорости показывает меткой, где стоит сосед.
  controls["vector-speed-mark"].style.setProperty("--at", speedFraction(park.frameSpeed));
  controls["frame-speed-mark"].style.setProperty("--at", speedFraction(park.vectorSpeed));
}

function speedFraction(speed) {
  return (speed - PARK_SPEED_MINIMUM) / (PARK_SPEED_MAXIMUM - PARK_SPEED_MINIMUM);
}

function formatSigned(value) {
  // −0.00 при мелкой отрицательной величине выглядит как ошибка.
  let text = Math.abs(value) < 0.005 ? "0.00" : value.toFixed(2);
  return value > 0.005 ? "+" + text : text.replace("-", "−");
}

function updateReadouts(ab, uv) {
  controls["read-alpha"].textContent = formatSigned(ab.alpha);
  controls["read-beta"].textContent = formatSigned(ab.beta);
  controls["read-u"].textContent = formatSigned(uv.u);
  controls["read-v"].textContent = formatSigned(uv.v);
  controls["read-slip"].textContent = formatSigned(park.vectorSpeed - park.frameSpeed) + " об/с";
}

function keyPressed() {
  // Пробел на кнопке нажимает саму кнопку; перехватывать его там нельзя, иначе
  // пауза включалась бы и тут же выключалась.
  let active = document.activeElement;
  let inControl = active && /^(BUTTON|INPUT)$/.test(active.tagName);
  if (key === " " && !inControl) {
    togglePause();
    return false;
  }
  let lower = String(key).toLowerCase();
  if (lower === "t" || lower === "е") toggleTheme();
  else if (lower === "s" || lower === "ы") synchroniseFrame();
}

// -- рисование ---------------------------------------------------------------

function drawScene(ab, uv) {
  let cx = width / 2;
  let cy = height / 2;
  // Радиус, соответствующий амплитуде 1. Запас по краю — под подписи осей.
  let radius = Math.min(width, height) * 0.38;
  let toScreen = (x, y) => [cx + x * radius, cy - y * radius];
  let palette = theme();

  // Траектория конца вектора.
  noFill();
  strokeTheme(palette.axisAlphaBeta, 60);
  strokeWeight(1);
  circle(cx, cy, 2 * park.amplitude * radius);

  let axisLength = 1.18;
  drawAxis(toScreen, 0.0, axisLength, palette.axisAlphaBeta, "α");
  drawAxis(toScreen, Math.PI / 2, axisLength, palette.axisAlphaBeta, "β");
  if (park.showFrame) {
    drawAxis(toScreen, park.frameAngle, axisLength, palette.axisQ, "u");
    drawAxis(toScreen, park.frameAngle + Math.PI / 2, axisLength, palette.axisQ, "v");
  }

  let tip = [ab.alpha, ab.beta];
  if (park.showAlphaBeta) {
    drawProjection(toScreen, tip, [ab.alpha, 0], palette.componentAlpha);
    drawProjection(toScreen, tip, [0, ab.beta], palette.componentBeta);
  }
  if (park.showFrame && park.showUv) {
    let c = Math.cos(park.frameAngle);
    let s = Math.sin(park.frameAngle);
    drawProjection(toScreen, tip, [uv.u * c, uv.u * s], palette.componentD);
    drawProjection(toScreen, tip, [-uv.v * s, uv.v * c], palette.componentQ);
  }

  drawArrow(toScreen, [0, 0], tip, palette.vectorCurrent, 3.5);
}

// Ось через начало координат: тонкая линия в обе стороны и стрелка с подписью
// на положительном конце.
function drawAxis(toScreen, angle, length, entry, label) {
  let x = Math.cos(angle) * length;
  let y = Math.sin(angle) * length;
  let [x0, y0] = toScreen(-x, -y);
  let [x1, y1] = toScreen(x, y);
  strokeTheme(entry);
  strokeWeight(1.5);
  line(x0, y0, x1, y1);
  drawHead(x0, y0, x1, y1, entry, 9);

  let [lx, ly] = toScreen(Math.cos(angle) * (length + 0.08), Math.sin(angle) * (length + 0.08));
  noStroke();
  fillTheme(entry, 255);
  textAlign(CENTER, CENTER);
  textSize(18);
  textStyle(BOLD);
  text(label, lx, ly);
}

// Проекция: штриховой перпендикуляр от конца вектора к оси и цветная стрелка
// составляющей вдоль оси. Стрелка тонкая: главный здесь сам вектор, а толстые
// составляющие на осях перекрывали бы и оси, и друг друга.
function drawProjection(toScreen, tip, foot, entry) {
  let [tx, ty] = toScreen(tip[0], tip[1]);
  let [fx, fy] = toScreen(foot[0], foot[1]);
  drawingContext.setLineDash([5, 5]);
  strokeTheme(entry, 120);
  strokeWeight(1.2);
  line(tx, ty, fx, fy);
  drawingContext.setLineDash([]);
  drawArrow(toScreen, [0, 0], foot, entry, 1.6);
}

function drawArrow(toScreen, from, to, entry, weight) {
  let [x0, y0] = toScreen(from[0], from[1]);
  let [x1, y1] = toScreen(to[0], to[1]);
  if (Math.hypot(x1 - x0, y1 - y0) < 2) return;
  strokeTheme(entry);
  strokeWeight(weight);
  // Линия кончается у основания наконечника, иначе толстый конец торчит из-под
  // острия.
  let size = 6 + weight * 2;
  let length = Math.hypot(x1 - x0, y1 - y0);
  let shorten = Math.min(size * 0.8, length) / length;
  line(x0, y0, x1 - (x1 - x0) * shorten, y1 - (y1 - y0) * shorten);
  drawHead(x0, y0, x1, y1, entry, size);
}

function drawHead(x0, y0, x1, y1, entry, size) {
  let angle = Math.atan2(y1 - y0, x1 - x0);
  let length = Math.hypot(x1 - x0, y1 - y0);
  size = Math.min(size, length);
  noStroke();
  fillTheme(entry);
  triangle(x1, y1,
    x1 - size * Math.cos(angle - 0.4), y1 - size * Math.sin(angle - 0.4),
    x1 - size * Math.cos(angle + 0.4), y1 - size * Math.sin(angle + 0.4));
}

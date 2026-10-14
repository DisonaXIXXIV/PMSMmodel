// Тесты расчётной части страницы преобразования Парка (park/ParkTransform.js).
// Отдельно от run-diagnostics.js: страница самостоятельная, и её файлы не
// подключаются к модели машины. Запускается из npm test вслед за основными.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const file = path.resolve(__dirname, "..", "park", "ParkTransform.js");
vm.runInThisContext(fs.readFileSync(file, "utf8"), { filename: "park/ParkTransform.js" });

let failures = 0;
function check(condition, message) {
  if (!condition) {
    failures++;
    console.log("FAIL: " + message);
  }
}
const close = (a, b) => Math.abs(a - b) < 1e-9;

// Поворот сохраняет длину; оси u–v, совпавшие с α–β, ничего не меняют; оси,
// повёрнутые на угол вектора, видят его целиком по u.
function testParkTransform() {
  let ab = parkAlphaBeta(0.7, 1.3);
  for (const frame of [0, 0.4, -2.5, 7.0]) {
    let uv = parkTransform(ab.alpha, ab.beta, frame);
    check(close(Math.hypot(uv.u, uv.v), 0.7), "park transform keeps magnitude at frame " + frame);
  }
  let same = parkTransform(ab.alpha, ab.beta, 0);
  check(close(same.u, ab.alpha) && close(same.v, ab.beta), "park transform at zero angle is identity");
  let aligned = parkTransform(ab.alpha, ab.beta, 1.3);
  check(close(aligned.u, 0.7) && close(aligned.v, 0), "park transform aligned with vector gives pure u");
  let ahead = parkTransform(ab.alpha, ab.beta, 1.3 - Math.PI / 2);
  check(close(ahead.u, 0) && close(ahead.v, 0.7), "vector 90 degrees ahead of u lies on v");
}

function testParkAngleWrap() {
  for (const angle of [0, 3, -3, 10, -10, 1000.5]) {
    let wrapped = parkWrapAngle(angle);
    check(wrapped >= -Math.PI && wrapped < Math.PI, "wrapped angle in range for " + angle);
    check(close(Math.cos(wrapped), Math.cos(angle)) && Math.abs(Math.sin(wrapped) - Math.sin(angle)) < 1e-9,
      "wrapping keeps direction for " + angle);
  }
}

function testParkSpeedSnap() {
  check(parkSnapSpeed(0.48, 0.5) === 0.5, "close speed snaps to the other one");
  check(parkSnapSpeed(0.5 - PARK_SPEED_SNAP, 0.5) === 0.5, "speed exactly at threshold snaps");
  check(parkSnapSpeed(0.3, 0.5) === 0.3, "distant speed stays as set");
  check(parkSnapSpeed(-0.48, -0.5) === -0.5, "snap works for negative speeds");
  check(parkSnapSpeed(0.02, 0.4) === 0, "speed near zero snaps to zero");
  check(parkSnapSpeed(-0.02, 0.4) === 0, "negative speed near zero snaps to zero");
  check(parkSnapSpeed(0.025, 0.04) === 0.04, "nearer of neighbour and zero wins");
  check(parkSnapSpeed(0.01, 0.03) === 0, "zero wins when it is nearer");
  check(PARK_DEFAULT_VECTOR_SPEED >= PARK_SPEED_MINIMUM && PARK_DEFAULT_VECTOR_SPEED <= PARK_SPEED_MAXIMUM
    && PARK_DEFAULT_FRAME_SPEED >= PARK_SPEED_MINIMUM && PARK_DEFAULT_FRAME_SPEED <= PARK_SPEED_MAXIMUM,
    "default speeds within slider range");
  check(Math.abs(PARK_DEFAULT_VECTOR_SPEED - PARK_DEFAULT_FRAME_SPEED) > PARK_SPEED_SNAP,
    "default speeds differ by more than the snap distance");
}

// Диаграмма и осциллограммы лежат внутри полотна и не налезают друг на друга
// в обеих раскладках и с осями u–v и без них.
function testParkLayout() {
  const inside = (r, w, h) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w + 1e-9 && r.y + r.h <= h + 1e-9
    && r.w > 0 && r.h > 0;
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const [w, h] of [[940, 760], [390, 490], [1600, 600]]) {
    for (const showFrame of [true, false]) {
      let layout = parkLayout(w, h, showFrame);
      let rects = [layout.diagram, ...layout.scopes];
      check(layout.scopes.length === (showFrame ? 2 : 1),
        "scope count follows u-v axes at " + w + "x" + h);
      for (const r of rects) check(inside(r, w, h), "layout rectangle inside canvas at " + w + "x" + h);
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          check(!overlap(rects[i], rects[j]), "layout rectangles do not overlap at " + w + "x" + h);
        }
      }
    }
  }
}

// Окно истории: старые отсчёты уходят, один за левым краем остаётся.
function testParkHistory() {
  let samples = [];
  for (let t = 0; t <= 10; t += 0.5) samples.push({ t });
  parkTrimHistory(samples, 10, 4);
  check(samples[0].t === 6 && samples[samples.length - 1].t === 10,
    "history keeps window plus one sample at the left edge");
  parkTrimHistory(samples, 10, 4);
  check(samples[0].t === 6, "trimming twice changes nothing");
}

testParkTransform();
testParkLayout();
testParkHistory();
testParkAngleWrap();
testParkSpeedSnap();

if (failures > 0) console.log("Park diagnostics failed: " + failures);
else console.log("All Park diagnostics passed.");
process.exitCode = failures === 0 ? 0 : 1;

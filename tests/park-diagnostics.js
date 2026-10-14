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
  check(parkSnapSpeed(0.45, 0.5) === 0.5, "close speed snaps to the other one");
  check(parkSnapSpeed(0.5 - PARK_SPEED_SNAP, 0.5) === 0.5, "speed exactly at threshold snaps");
  check(parkSnapSpeed(0.3, 0.5) === 0.3, "distant speed stays as set");
  check(parkSnapSpeed(-0.52, -0.5) === -0.5, "snap works for negative speeds");
  check(PARK_DEFAULT_VECTOR_SPEED >= PARK_SPEED_MINIMUM && PARK_DEFAULT_VECTOR_SPEED <= PARK_SPEED_MAXIMUM
    && PARK_DEFAULT_FRAME_SPEED >= PARK_SPEED_MINIMUM && PARK_DEFAULT_FRAME_SPEED <= PARK_SPEED_MAXIMUM,
    "default speeds within slider range");
  check(Math.abs(PARK_DEFAULT_VECTOR_SPEED - PARK_DEFAULT_FRAME_SPEED) > PARK_SPEED_SNAP,
    "default speeds differ by more than the snap distance");
}

testParkTransform();
testParkAngleWrap();
testParkSpeedSnap();

if (failures > 0) console.log("Park diagnostics failed: " + failures);
else console.log("All Park diagnostics passed.");
process.exitCode = failures === 0 ? 0 : 1;

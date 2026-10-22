// Тесты расчётной части игры «Ручной инвертор» (inverter-game/InverterGame.js).
// Как park-diagnostics.js, отдельно от модели машины: страница самостоятельная.
// Запускается из npm test.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

for (const file of [path.join("..", "Theme.js"), path.join("..", "inverter-game", "InverterGame.js")]) {
  let full = path.resolve(__dirname, file);
  vm.runInThisContext(fs.readFileSync(full, "utf8"), { filename: file });
}

let failures = 0;
function check(condition, message) {
  if (!condition) {
    failures++;
    console.log("FAIL: " + message);
  }
}
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

const LOCKED = { mode: INVERTER_MODE_LEGS, rotor: { angle: 0, rpm: 0, fixed: true },
  goal: { type: "hold", id: 99, iq: 0, tolerance: 0, periods: 1000 }, limitPeriods: 1000 };

function levelWith(changes) {
  return Object.assign({}, LOCKED, changes);
}

// Нулевые векторы дают нуль, активные — 2/3·Udc с шагом 60°, и вектор 100
// лежит на оси фазы A (α).
function testInverterVoltages() {
  for (const legs of [[0, 0, 0], [1, 1, 1]]) {
    let u = inverterVoltages(legs, 48);
    check(near(u.alpha, 0, 1e-12) && near(u.beta, 0, 1e-12), "zero vector " + legs.join("") + " gives no voltage");
  }
  let active = [[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1], [1, 0, 1]];
  active.forEach((legs, k) => {
    let u = inverterVoltages(legs, 48);
    check(near(Math.hypot(u.alpha, u.beta), 32, 1e-9), "active vector " + legs.join("") + " has length 2/3 Udc");
    check(near(Math.atan2(u.beta, u.alpha), Math.atan2(Math.sin(k * Math.PI / 3), Math.cos(k * Math.PI / 3)), 1e-9),
      "active vector " + legs.join("") + " points at " + (k * 60) + " degrees");
    check(near(u.a + u.b + u.c, 0, 1e-9), "phase voltages of " + legs.join("") + " sum to zero");
  });
}

// Мощность со стороны звена равна мощности, отданной в фазы: ток звена — это
// сумма токов фаз с включённым верхним ключом.
function testPowerBalance() {
  let currents = [[3, -1], [-2.5, 4], [0.7, 0.2]];
  for (const legs of [[1, 0, 0], [1, 1, 0], [0, 1, 1], [1, 0, 1]]) {
    for (const [ia, ib] of currents) {
      let u = inverterVoltages(legs, 50);
      let p = inverterPhaseCurrents(ia, ib);
      let link = 50 * (legs[0] * p.a + legs[1] * p.b + legs[2] * p.c);
      let phases = u.a * p.a + u.b * p.b + u.c * p.c;
      check(near(link, phases, 1e-9), "link power equals phase power for " + legs.join(""));
      check(near(phases, 1.5 * (u.alpha * ia + u.beta * ib), 1e-9),
        "amplitude-invariant Clarke power has factor 3/2 for " + legs.join(""));
    }
  }
}

// На заторможенном роторе вектор 100 за 100 мкс набирает ≈ 2/3·Udc·t/L по α.
function testCurrentRise() {
  let level = levelWith({});
  let state = createInverterState(level);
  inverterToggleLeg(state, 0);
  inverterAdvance(state, level, 100e-6);
  let expected = 32 * 100e-6 / INVERTER_MOTOR.inductance;
  check(near(state.iAlpha, expected, 0.05), "current rises at 2/3 Udc / L: " + state.iAlpha.toFixed(3));
  check(near(state.iBeta, 0, 1e-9), "vector 100 drives no beta current");
  let dq = inverterPark(state.iAlpha, state.iBeta, state.angle);
  check(near(dq.d, state.iAlpha, 1e-12), "with rotor at zero d coincides with alpha");
}

// Ротор крутят снаружи, все нижние ключи включены — короткое замыкание. В
// установившемся режиме ток задаёт ЭДС вдоль q: id = −ψω·ωL/|Z|², iq = −ψω·R/|Z|².
function testShortCircuitCurrent() {
  let level = levelWith({ rotor: { angle: 0, rpm: 300, fixed: true } });
  let state = createInverterState(level);
  inverterAdvance(state, level, 40e-3);
  let m = INVERTER_MOTOR;
  let omega = 300 * Math.PI / 30;
  let z2 = m.resistance ** 2 + (omega * m.inductance) ** 2;
  let e = m.magnetFlux * omega;
  let dq = inverterPark(state.iAlpha, state.iBeta, state.angle);
  check(state.status === "running", "short circuit at 300 rpm does not trip");
  check(near(dq.d, -e * omega * m.inductance / z2, 0.05), "short circuit id matches impedance: " + dq.d.toFixed(3));
  check(near(dq.q, -e * m.resistance / z2, 0.05), "short circuit iq matches impedance: " + dq.q.toFixed(3));
}

// Пила и уставки: импульс центрирован, 0 и 1 — крайние случаи, а средний
// за период вектор равен Udc·(d − среднее d).
function testDutyModulation() {
  check(inverterCarrier(0) === 1 && inverterCarrier(0.5) === 0 && inverterCarrier(1) === 1, "carrier peaks at period edges");
  check(inverterDutyLegs([0.5, 0, 1], 0.2).join("") === "001", "duty 0.5 is off at 0.2 of period");
  check(inverterDutyLegs([0.5, 0, 1], 0.5).join("") === "101", "duty 0.5 is on in the middle");
  let level = levelWith({ mode: INVERTER_MODE_DUTY });
  let state = createInverterState(level);
  state.duty = [0.8, 0.3, 0.4];
  inverterAdvance(state, level, INVERTER_PWM_PERIOD);
  let entry = state.history[0];
  let mean = (0.8 + 0.3 + 0.4) / 3;
  check(near(entry.uAlpha, 48 * (0.8 - mean), 0.2), "average alpha voltage follows duties: " + entry.uAlpha.toFixed(3));
  check(near(entry.uBeta, 48 * (0.3 - 0.4) / Math.sqrt(3), 0.2), "average beta voltage follows duties");
  check(state.lastPeriodSwitching.length >= 5, "modulator switching is recorded");
}

// Тормозной ключ разряжает звено через резистор с постоянной R·C, пока диод
// выпрямителя закрыт; потом звено садится на делитель Rист–Rторм.
function testBrakeChopper() {
  let level = levelWith({});
  let state = createInverterState(level);
  state.udc = 58;
  state.brake = true;
  inverterAdvance(state, level, 0.3e-3);
  let tau = INVERTER_LINK.brakeResistance * INVERTER_LINK.capacitance;
  check(near(state.udc, 58 * Math.exp(-0.3e-3 / tau), 0.05), "brake discharges the link with R·C: " + state.udc.toFixed(2));
  inverterAdvance(state, level, 10e-3);
  let r = INVERTER_LINK.brakeResistance;
  let divider = INVERTER_LINK.sourceVoltage * r / (r + INVERTER_LINK.sourceResistance);
  check(near(state.udc, divider, 0.05), "braked link settles on the source divider: " + state.udc.toFixed(2));
}

// Защиты: вектор 100 весь период на заторможенном роторе — ток выше предела;
// звено выше 60 В — перенапряжение.
function testProtections() {
  let level = levelWith({});
  let state = createInverterState(level);
  inverterToggleLeg(state, 0);
  inverterAdvance(state, level, INVERTER_PWM_PERIOD * 2);
  check(state.status === "lost" && /ток/.test(state.reason), "overcurrent trips");
  let other = createInverterState(level);
  other.udc = 61;
  inverterAdvance(other, level, INVERTER_STEP * 2);
  check(other.status === "lost" && /Перенапряжение/.test(other.reason), "overvoltage trips");
}

// Каждый уровень проходим: бот, который раз в период выставляет уставки по
// упрощённому токовому регулятору с точностью 0,02 периода (как человек, у
// которого реакция ~0,1 с), должен его пройти. В режиме ключей он нажимает
// стойки в те же моменты, когда их переключил бы модулятор.
function botCurrentReference(state, level) {
  let goal = level.goal;
  let rpm = state.speed * 30 / Math.PI;
  if (goal.type === "hold") return { id: goal.id, iq: goal.iq };
  if (goal.type === "speed") return { id: 0, iq: Math.sign(goal.rpm) * 8 };
  if (goal.type === "stop") return { id: 0, iq: rpm > 0 ? -8 : 0 };
  let target = (goal.minRpm + goal.maxRpm) / 2;
  let kt = 1.5 * INVERTER_MOTOR.polePairs * INVERTER_MOTOR.magnetFlux;
  return { id: 0, iq: Math.max(-8, Math.min(8, 0.005 * (target - rpm) + inverterLoadTorque(state, level) / kt)) };
}

function botDuties(state, level) {
  let m = INVERTER_MOTOR;
  let ref = botCurrentReference(state, level);
  let dq = inverterPark(state.iAlpha, state.iBeta, state.angle);
  let omega = state.speed * m.polePairs;
  let T = INVERTER_PWM_PERIOD;
  let ud = m.resistance * ref.id - omega * m.inductance * ref.iq + 0.6 * m.inductance * (ref.id - dq.d) / T;
  let uq = m.resistance * ref.iq + omega * (m.inductance * ref.id + m.magnetFlux)
    + 0.6 * m.inductance * (ref.iq - dq.q) / T;
  let angle = state.angle + omega * T / 2;
  let ua = ud * Math.cos(angle) - uq * Math.sin(angle);
  let ub = ud * Math.sin(angle) + uq * Math.cos(angle);
  let phases = [ua, -0.5 * ua + Math.sqrt(3) / 2 * ub, -0.5 * ua - Math.sqrt(3) / 2 * ub];
  let middle = (Math.max(...phases) + Math.min(...phases)) / 2;
  return phases.map((v) => Math.round(Math.min(1, Math.max(0, 0.5 + (v - middle) / state.udc)) * 50) / 50);
}

function testLevelsAreWinnable() {
  for (const level of INVERTER_LEVELS) {
    let seed = 1;
    let random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let state = createInverterState(level, random);
    let guard = 0;
    while (state.status === "running" && guard++ < level.limitPeriods + 2) {
      let duties = botDuties(state, level);
      state.brake = false;
      if (level.mode === INVERTER_MODE_DUTY) {
        state.duty = duties;
        let steps = Math.round(INVERTER_PWM_PERIOD / INVERTER_STEP);
        for (let k = 0; k < steps && state.status === "running"; k++) {
          state.brake = state.udc > 55 || (state.brake && state.udc > 50);
          inverterStep(state, level, INVERTER_STEP);
        }
      } else {
        // Моменты переключения стоек за период: включить в (1 − d)/2, выключить в (1 + d)/2.
        let start = state.periodIndex;
        while (state.status === "running" && state.periodIndex === start) {
          let phase = inverterPeriodPhase(state);
          let wanted = inverterDutyLegs(duties, phase);
          for (let k = 0; k < 3; k++) if (wanted[k] !== state.legs[k]) inverterToggleLeg(state, k);
          state.brake = state.udc > 55 || (state.brake && state.udc > 50);
          inverterAdvance(state, level, INVERTER_PWM_PERIOD / 50);
        }
      }
    }
    check(state.status === "won", "level " + level.id + " is winnable by a period-by-period bot: "
      + state.status + " " + state.reason + " (peak " + state.peakCurrent.toFixed(1) + " A, "
      + state.peakVoltage.toFixed(1) + " V)");
  }
}

// Без тормозного ключа рекуперация с 9000 об/мин доводит звено до защиты —
// иначе у уровня нет смысла.
function testRegenerationNeedsBrake() {
  let level = inverterLevelById("duty-4");
  let state = createInverterState(level);
  while (state.status === "running") {
    state.duty = botDuties(state, level);
    inverterAdvance(state, level, INVERTER_PWM_PERIOD);
  }
  check(state.status === "lost" && /Перенапряжение/.test(state.reason),
    "braking from 9000 rpm without chopper trips on overvoltage: " + state.reason);
}

// Подсветка тока: в допуске — inside, у защиты — nearLimit, среднее
// периода — averageInside; без цели по току зелёного не бывает.
function testCurrentStatus() {
  let level = levelWith({ goal: { type: "hold", id: 5, iq: 0, tolerance: 1, periods: 10 } });
  let state = createInverterState(level);
  check(!inverterCurrentStatus(state, level).inside, "zero current is outside the 5 A target");
  state.iAlpha = 5.4;
  let status = inverterCurrentStatus(state, level);
  check(status.inside && !status.nearLimit, "current within tolerance is inside and not near limit");
  check(!status.averageInside, "no average before the period has started");
  inverterAdvance(state, level, 10e-6);
  check(inverterCurrentStatus(state, level).averageInside, "average of a held current is inside");
  state.iAlpha = 13;
  status = inverterCurrentStatus(state, level);
  check(status.nearLimit && !status.inside, "13 A is near the 15 A protection");
  let speedLevel = levelWith({ goal: { type: "speed", rpm: 300 } });
  let other = createInverterState(speedLevel);
  other.iAlpha = 5;
  check(!inverterCurrentStatus(other, speedLevel).inside, "no target band without a current goal");
}

// На ходу нулевой вектор — короткое замыкание на ЭДС: ток сам доходит до
// защиты. Об этом предупреждает брифинг «Ротор крутят», поэтому это и
// проверяется. А реверс одним нулевым вектором не пройти.
function testZeroVectorWhileSpinning() {
  let level = inverterLevelById("legs-3");
  let state = createInverterState(level);
  inverterAdvance(state, level, 30 * INVERTER_PWM_PERIOD);
  check(state.status === "lost" && /ток/.test(state.reason), "zero vector at 6000 rpm trips on overcurrent");
  let reverse = inverterLevelById("legs-reverse");
  let idle = createInverterState(reverse);
  inverterAdvance(idle, reverse, reverse.limitPeriods * INVERTER_PWM_PERIOD + INVERTER_STEP);
  check(idle.status === "lost", "reverse level is not won by doing nothing: " + idle.reason);
}

// Проекции на d, q: не видны на осях и у маленького тока, сильнее всего на
// 45°, и там не плотнее INVERTER_PROJECTION_OPACITY.
function testProjectionOpacity() {
  check(inverterProjectionOpacity(5, 0) === 0 && inverterProjectionOpacity(0, -5) === 0, "no projections on an axis");
  check(near(inverterProjectionOpacity(4, 4), INVERTER_PROJECTION_OPACITY, 1e-12), "full projection opacity at 45 degrees");
  check(inverterProjectionOpacity(5, 1) < inverterProjectionOpacity(5, 3), "projections grow away from the axis");
  check(inverterProjectionOpacity(0.3, 0.3) === 0, "no projections for a tiny current");
  check(inverterProjectionOpacity(0.7, 0.7) > 0 && inverterProjectionOpacity(0.7, 0.7) < INVERTER_PROJECTION_OPACITY,
    "projections fade in with amplitude");
}

function testLevels() {
  let ids = new Set();
  for (const level of INVERTER_LEVELS) {
    check(!ids.has(level.id), "level id " + level.id + " is unique");
    ids.add(level.id);
    check(level.mode === INVERTER_MODE_LEGS || level.mode === INVERTER_MODE_DUTY, "level " + level.id + " has a mode");
    check(typeof level.title === "string" && level.title && level.brief && level.summary, "level " + level.id + " has texts");
    check(["hold", "speed", "stop", "survive"].includes(level.goal.type), "level " + level.id + " has a known goal");
    check(level.limitPeriods > 0, "level " + level.id + " has a time limit");
  }
  for (const mode of [INVERTER_MODE_LEGS, INVERTER_MODE_DUTY]) {
    check(inverterLevelsOfMode(mode).length > 0, "mode " + mode + " has levels");
  }
  let first = inverterLevelsOfMode(INVERTER_MODE_LEGS)[0];
  check(inverterNextLevel(first) === inverterLevelsOfMode(INVERTER_MODE_LEGS)[1], "next level stays in mode");
}

function testEventSchedule() {
  let level = inverterLevelById("duty-5");
  for (let trial = 0; trial < 50; trial++) {
    let events = inverterScheduleEvents(level, Math.random).sort((a, b) => a.from - b.from);
    check(events.length === level.events.length, "all events are scheduled");
    for (let k = 0; k < events.length; k++) {
      check(events[k].from >= 10 && events[k].to <= level.limitPeriods, "event inside level time");
      if (k > 0) check(events[k].from >= events[k - 1].to, "events do not overlap");
    }
  }
}

// Области полотна лежат внутри него и не перекрываются.
function testLayout() {
  const inside = (r, w, h) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w + 1e-9 && r.y + r.h <= h + 1e-9 && r.w > 0 && r.h > 0;
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const [w, h] of [[1280, 720], [1920, 1000], [390, 700], [800, 900], [700, 500]]) {
    let layout = inverterLayout(w, h);
    let rects = [layout.motor, layout.control, layout.hexagon, layout.scopes];
    for (const r of rects) check(inside(r, w, h), "layout rectangle inside canvas at " + w + "x" + h);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        check(!overlap(rects[i], rects[j]), "layout rectangles do not overlap at " + w + "x" + h);
      }
    }
  }
}

// Цвета игры есть в каждой палитре (их сверяет и testThemePalettes, но здесь
// важно, что game.js не обратится к несуществующему ключу).
function testThemeKeys() {
  for (const key of ["gameSwitchOn", "gameSwitchOff", "gameBus", "gameTargetBand", "gameDanger", "gameSuccess", "gameCarrier"]) {
    for (const name of Object.keys(THEME_PALETTES)) {
      check(Array.isArray(THEME_PALETTES[name][key]), "theme " + name + " has " + key);
    }
  }
}

testInverterVoltages();
testPowerBalance();
testCurrentRise();
testShortCircuitCurrent();
testDutyModulation();
testBrakeChopper();
testProtections();
testLevels();
testProjectionOpacity();
testZeroVectorWhileSpinning();
testCurrentStatus();
testEventSchedule();
testLevelsAreWinnable();
testRegenerationNeedsBrake();
testLayout();
testThemeKeys();

if (failures > 0) {
  console.log("Inverter game diagnostics failed: " + failures);
  process.exit(1);
}
console.log("All inverter game diagnostics passed.");

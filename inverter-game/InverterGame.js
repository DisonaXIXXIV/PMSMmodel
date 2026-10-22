// Игра «Ручной инвертор»: расчётная часть — инвертор, звено постоянного тока,
// машина и уровни. Здесь нет ни p5, ни разметки, поэтому всё это проверяется в
// Node (tests/inverter-game-diagnostics.js).
//
// Время в игре замедлено: период ШИМ 500 мкс (2 кГц) идёт на экране 5 с, то
// есть в 10⁴ раз медленнее. Только так стойки можно переключать руками внутри
// периода. Параметры машины подобраны под это замедление, а не взяты из
// паспорта: постоянная времени обмотки L/R = 5 мс — это 10 периодов, разгон —
// десятки периодов. С инерцией настоящего привода разгон шёл бы часами.
//
// Машина неявнополюсная, с одной парой полюсов: электрический угол совпадает с
// механическим, и ось d на картинке — это просто северный полюс ротора.
// Преобразование Кларк амплитудно-инвариантное (коэффициент 2/3): длина
// вектора тока равна амплитуде фазного тока.

const INVERTER_PWM_PERIOD = 500e-6;
const INVERTER_REAL_PERIOD = 5.0;
// Шаг интегрирования: 1000 шагов на период. Самая быстрая постоянная времени —
// заряд конденсатора звена через источник, Rист·C ≈ 0,17 мс, — в 300 раз длиннее.
const INVERTER_STEP = 0.5e-6;
// Темп игры — множитель к «периоду за 5 с».
const INVERTER_TEMPOS = [0.25, 0.5, 1, 2, 4];
const INVERTER_DEFAULT_TEMPO = 1;

const INVERTER_MOTOR = {
  resistance: 0.2,
  inductance: 1e-3,
  magnetFlux: 0.04,
  polePairs: 1,
  inertia: 1e-4,
  viscousFriction: 2e-5,
};

// Звено: выпрямитель (источник с внутренним сопротивлением за диодом — назад
// он ток не принимает), конденсатор и тормозной ключ с резистором. Ёмкость
// маленькая нарочно: энергии торможения с 1200 об/мин хватает, чтобы без
// тормозного ключа дойти до защиты.
const INVERTER_LINK = {
  sourceVoltage: 48,
  sourceResistance: 0.5,
  capacitance: 330e-6,
  brakeResistance: 10,
  warningVoltage: 56,
  overVoltage: 60,
};

const INVERTER_CURRENT_LIMIT = 15;
// Доля защиты, с которой ток на картинке краснеет: предупреждение до того,
// как защита сработает.
const INVERTER_CURRENT_WARNING = 0.8;

// Сколько периодов помнят осциллограммы: мгновенные значения и средние.
const INVERTER_FINE_PERIODS = 4;
const INVERTER_FINE_SAMPLES_PER_PERIOD = 100;
const INVERTER_HISTORY_PERIODS = 40;

const INVERTER_MODE_LEGS = "legs";
const INVERTER_MODE_DUTY = "duty";

const SQRT3 = Math.sqrt(3);
const RPM = Math.PI / 30;

function inverterDegrees(value) {
  return value * Math.PI / 180;
}

// Уровни. Порядок внутри режима — порядок в меню. Цели:
//   hold    — держать средние за период id, iq в допуске periods периодов подряд;
//   speed   — разогнать до rpm (среднее за период);
//   stop    — затормозить до |n| < rpm;
//   survive — продержаться periods периодов, не выпустив скорость из полосы.
// limitPeriods — сколько периодов даётся на всё.
const INVERTER_LEVELS = [
  {
    id: "legs-1", mode: INVERTER_MODE_LEGS, title: "Первый ток",
    summary: "Ротор заторможен. Держите id = 5 А.",
    brief: "Ротор заторможен, ось d смотрит вдоль фазы A. Наберите ток по оси d "
      + "и держите среднее за период в допуске. Активный вектор гонит ток быстро, "
      + "нулевой (000 или 111) — даёт ему медленно спадать через R.",
    rotor: { angle: 0, rpm: 0, fixed: true },
    goal: { type: "hold", id: 5, iq: 0, tolerance: 1, periods: 10 },
    limitPeriods: 80,
  },
  {
    id: "legs-2", mode: INVERTER_MODE_LEGS, title: "Поперёк поля",
    summary: "Ротор под углом 40°. Держите iq = 5 А.",
    brief: "Теперь ток нужен по оси q — поперёк магнитов. Ни один вектор "
      + "инвертора не лежит точно на q: придётся чередовать два соседних.",
    rotor: { angle: inverterDegrees(40), rpm: 0, fixed: true },
    goal: { type: "hold", id: 0, iq: 5, tolerance: 1, periods: 10 },
    limitPeriods: 100,
  },
  {
    id: "legs-3", mode: INVERTER_MODE_LEGS, title: "Ротор крутят",
    summary: "Внешний привод крутит ротор на 300 об/мин. Держите iq = 5 А.",
    brief: "Ротор вращается с постоянной скоростью — его держит внешний привод. "
      + "Ось q уходит, а ЭДС вращения ψf·ω добавляет к нужному напряжению ещё "
      + "≈1,3 В по оси q.",
    rotor: { angle: inverterDegrees(-20), rpm: 300, fixed: true },
    goal: { type: "hold", id: 0, iq: 5, tolerance: 1, periods: 10 },
    limitPeriods: 120,
  },
  {
    id: "legs-4", mode: INVERTER_MODE_LEGS, title: "Разгон",
    summary: "Разгоните свободный ротор до 300 об/мин.",
    brief: "Ротор свободен, на валу небольшая нагрузка 0,05 Н·м. Момент даёт "
      + "только iq, и ось q всё время уходит вперёд — догоняйте её.",
    rotor: { angle: 0, rpm: 0, fixed: false, load: 0.05 },
    goal: { type: "speed", rpm: 300 },
    limitPeriods: 120,
  },
  {
    id: "legs-5", mode: INVERTER_MODE_LEGS, title: "Тормоз",
    summary: "Остановите ротор с 300 об/мин быстрее, чем выбег.",
    brief: "Ротор крутится на 300 об/мин. Сам он остановится через ~130 периодов, "
      + "а у вас 60. Отрицательный iq тормозит — энергия идёт в звено.",
    rotor: { angle: 0, rpm: 300, fixed: false, load: 0.05 },
    goal: { type: "stop", rpm: 30 },
    limitPeriods: 60,
  },
  {
    id: "duty-1", mode: INVERTER_MODE_DUTY, title: "Уставки",
    summary: "Ротор заторможен. Держите iq = 5 А уставками.",
    brief: "Стойки теперь переключает модулятор: стойка включена, пока её уставка "
      + "выше пилы (симметричная, начало и конец периода — вершины). Уставки "
      + "применяются сразу. Одинаковые уставки — нулевой вектор.",
    rotor: { angle: inverterDegrees(70), rpm: 0, fixed: true },
    goal: { type: "hold", id: 0, iq: 5, tolerance: 0.7, periods: 10 },
    limitPeriods: 100,
  },
  {
    id: "duty-2", mode: INVERTER_MODE_DUTY, title: "Вращение",
    summary: "Внешний привод крутит ротор на 600 об/мин. Держите iq = 5 А.",
    brief: "Ось q поворачивается на 1,8° за период, ЭДС — около 2,5 В. "
      + "Уставки придётся двигать постоянно.",
    rotor: { angle: 0, rpm: 600, fixed: true },
    goal: { type: "hold", id: 0, iq: 5, tolerance: 0.7, periods: 30 },
    limitPeriods: 150,
  },
  {
    id: "duty-3", mode: INVERTER_MODE_DUTY, title: "Разгон до 1000",
    summary: "Разгоните свободный ротор до 1000 об/мин.",
    brief: "Свободный ротор, нагрузка 0,05 Н·м. Чем быстрее ротор, тем больше "
      + "ЭДС и тем больше напряжения уходит просто на то, чтобы ток не падал.",
    rotor: { angle: 0, rpm: 0, fixed: false, load: 0.05 },
    goal: { type: "speed", rpm: 1000 },
    limitPeriods: 160,
  },
  {
    id: "duty-4", mode: INVERTER_MODE_DUTY, title: "Рекуперация",
    summary: "Остановите ротор с 1200 об/мин, не перегрев звено.",
    brief: "При торможении энергия ротора уходит в конденсатор звена, а "
      + "выпрямитель назад её не примет. Выше 60 В — защита. Тормозной ключ "
      + "(клавиша B) сливает её в резистор.",
    rotor: { angle: 0, rpm: 1200, fixed: false, load: 0.05 },
    goal: { type: "stop", rpm: 50 },
    limitPeriods: 160,
  },
  {
    id: "duty-5", mode: INVERTER_MODE_DUTY, title: "Смена",
    summary: "Продержите 500–1100 об/мин 120 периодов. Будут сюрпризы.",
    brief: "Ротор крутится на 800 об/мин. За смену случатся наброс нагрузки, "
      + "провал сети и нагрузка, которая сама крутит вал. Скорость должна "
      + "оставаться в полосе, а ток и напряжение звена — в пределах.",
    rotor: { angle: 0, rpm: 800, fixed: false, load: 0.05 },
    goal: { type: "survive", minRpm: 500, maxRpm: 1100, periods: 120 },
    events: [
      { type: "load", torque: 0.3, duration: 25, title: "Наброс нагрузки" },
      { type: "sag", voltage: 36, duration: 25, title: "Провал сети" },
      { type: "load", torque: -0.2, duration: 25, title: "Нагрузка крутит вал" },
    ],
    limitPeriods: 120,
  },
];

function inverterLevelById(id) {
  return INVERTER_LEVELS.find((level) => level.id === id) || null;
}

function inverterLevelsOfMode(mode) {
  return INVERTER_LEVELS.filter((level) => level.mode === mode);
}

// Следующий уровень того же режима или null.
function inverterNextLevel(level) {
  let list = inverterLevelsOfMode(level.mode);
  let index = list.indexOf(level);
  return index >= 0 && index + 1 < list.length ? list[index + 1] : null;
}

// Расписание событий: каждое — в случайный момент, без наложений, не раньше
// 10-го периода и с запасом до конца. random — чтобы тесты могли его задать.
function inverterScheduleEvents(level, random) {
  let events = level.events || [];
  if (events.length === 0) return [];
  let total = level.limitPeriods;
  let start = 10;
  let free = total - start - 5 - events.reduce((sum, event) => sum + event.duration, 0);
  let gaps = events.map(() => random());
  gaps.push(random());
  let gapSum = gaps.reduce((a, b) => a + b, 0) || 1;
  let order = events.map((event, index) => index);
  for (let i = order.length - 1; i > 0; i--) {
    let j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let at = start;
  let scheduled = [];
  for (let k = 0; k < order.length; k++) {
    at += Math.floor(free * gaps[k] / gapSum);
    let event = events[order[k]];
    scheduled.push(Object.assign({}, event, { from: at, to: at + event.duration }));
    at += event.duration;
  }
  return scheduled;
}

function createInverterState(level, random = Math.random) {
  let rotor = level.rotor;
  return {
    time: 0,
    periodIndex: 0,
    iAlpha: 0,
    iBeta: 0,
    angle: rotor.angle,
    speed: rotor.rpm * RPM,
    udc: INVERTER_LINK.sourceVoltage,
    legs: [0, 0, 0],
    duty: [0.5, 0.5, 0.5],
    brake: false,
    events: inverterScheduleEvents(level, random),
    // Накопители среднего за текущий период.
    sum: emptyPeriodSum(),
    history: [],
    fine: [],
    stepCounter: 0,
    // Переключения стоек внутри текущего периода: [{ t, legs }]. Нужны, чтобы
    // нарисовать импульсы, которые игрок уже успел «наиграть».
    switching: [{ t: 0, legs: [0, 0, 0] }],
    lastPeriodSwitching: null,
    streak: 0,
    status: "running",
    reason: "",
    peakCurrent: 0,
    peakVoltage: INVERTER_LINK.sourceVoltage,
  };
}

function emptyPeriodSum() {
  return { id: 0, iq: 0, uAlpha: 0, uBeta: 0, torque: 0, duration: 0 };
}

// -- преобразования ---------------------------------------------------------

function inverterPhaseCurrents(iAlpha, iBeta) {
  return {
    a: iAlpha,
    b: -0.5 * iAlpha + SQRT3 / 2 * iBeta,
    c: -0.5 * iAlpha - SQRT3 / 2 * iBeta,
  };
}

function inverterPark(alpha, beta, angle) {
  let c = Math.cos(angle);
  let s = Math.sin(angle);
  return { d: alpha * c + beta * s, q: -alpha * s + beta * c };
}

// Фазные напряжения звезды с изолированной нейтралью и их вектор. Потенциал
// стойки — Udc или 0; нейтраль сидит на среднем из трёх потенциалов.
function inverterVoltages(legs, udc) {
  let neutral = udc * (legs[0] + legs[1] + legs[2]) / 3;
  let a = udc * legs[0] - neutral;
  let b = udc * legs[1] - neutral;
  let c = udc * legs[2] - neutral;
  return { a, b, c, alpha: a, beta: (b - c) / SQRT3 };
}

// Пила модулятора: 1 в начале периода, 0 в середине, 1 в конце. Стойка
// включена, пока уставка выше пилы, — импульс центрирован в периоде.
function inverterCarrier(phase) {
  return Math.abs(1 - 2 * phase);
}

function inverterDutyLegs(duty, phase) {
  let carrier = inverterCarrier(phase);
  return duty.map((value) => (value > carrier ? 1 : 0));
}

function inverterPeriodPhase(state) {
  let phase = state.time / INVERTER_PWM_PERIOD - state.periodIndex;
  return Math.min(Math.max(phase, 0), 1);
}

// -- текущие внешние условия ------------------------------------------------

function inverterActiveEvents(state) {
  return state.events.filter((event) => state.periodIndex >= event.from && state.periodIndex < event.to);
}

function inverterLoadTorque(state, level) {
  let torque = level.rotor.load || 0;
  for (const event of inverterActiveEvents(state)) {
    if (event.type === "load") torque = event.torque;
  }
  return torque;
}

function inverterSourceVoltage(state) {
  let voltage = INVERTER_LINK.sourceVoltage;
  for (const event of inverterActiveEvents(state)) {
    if (event.type === "sag") voltage = event.voltage;
  }
  return voltage;
}

// -- модель -----------------------------------------------------------------

// Один шаг интегрирования (явный Эйлер, шаг INVERTER_STEP). Уравнения машины
// записаны в α–β, потому что входы — фазные напряжения от ключей:
//   L·di/dt = u − R·i − e,  e = ωэ·ψf·(−sin θ, cos θ)
// Ток звена — сумма токов фаз, чьи верхние ключи включены; через него энергия
// машины доходит до конденсатора, в том числе обратно при торможении.
function inverterStep(state, level, dt) {
  let motor = INVERTER_MOTOR;
  let link = INVERTER_LINK;
  if (level.mode === INVERTER_MODE_DUTY) {
    let legs = inverterDutyLegs(state.duty, inverterPeriodPhase(state));
    if (legs.some((value, k) => value !== state.legs[k])) inverterSetLegs(state, legs);
  }
  let u = inverterVoltages(state.legs, state.udc);
  let omega = motor.polePairs * state.speed;
  let eAlpha = -omega * motor.magnetFlux * Math.sin(state.angle);
  let eBeta = omega * motor.magnetFlux * Math.cos(state.angle);
  let dAlpha = (u.alpha - motor.resistance * state.iAlpha - eAlpha) / motor.inductance;
  let dBeta = (u.beta - motor.resistance * state.iBeta - eBeta) / motor.inductance;

  let phases = inverterPhaseCurrents(state.iAlpha, state.iBeta);
  let linkCurrent = state.legs[0] * phases.a + state.legs[1] * phases.b + state.legs[2] * phases.c;
  let source = Math.max(0, (inverterSourceVoltage(state) - state.udc) / link.sourceResistance);
  let brake = state.brake ? state.udc / link.brakeResistance : 0;
  let dUdc = (source - linkCurrent - brake) / link.capacitance;

  let dq = inverterPark(state.iAlpha, state.iBeta, state.angle);
  let torque = 1.5 * motor.polePairs * motor.magnetFlux * dq.q;
  let dSpeed = 0;
  if (!level.rotor.fixed) {
    dSpeed = (torque - inverterLoadTorque(state, level) - motor.viscousFriction * state.speed) / motor.inertia;
  }

  state.iAlpha += dAlpha * dt;
  state.iBeta += dBeta * dt;
  state.udc = Math.max(0, state.udc + dUdc * dt);
  state.angle += omega * dt;
  state.speed += dSpeed * dt;
  state.time += dt;

  let sum = state.sum;
  sum.id += dq.d * dt;
  sum.iq += dq.q * dt;
  sum.uAlpha += u.alpha * dt;
  sum.uBeta += u.beta * dt;
  sum.torque += torque * dt;
  sum.duration += dt;

  let after = inverterPhaseCurrents(state.iAlpha, state.iBeta);
  let peak = Math.max(Math.abs(after.a), Math.abs(after.b), Math.abs(after.c));
  state.peakCurrent = Math.max(state.peakCurrent, peak);
  state.peakVoltage = Math.max(state.peakVoltage, state.udc);
  if (peak > INVERTER_CURRENT_LIMIT) {
    inverterLose(state, "Сработала защита по току: " + peak.toFixed(1) + " А при пределе "
      + INVERTER_CURRENT_LIMIT + " А.");
  } else if (state.udc > link.overVoltage) {
    inverterLose(state, "Перенапряжение звена: " + state.udc.toFixed(1) + " В при пределе "
      + link.overVoltage + " В.");
  }

  state.stepCounter++;
  let every = Math.round(INVERTER_PWM_PERIOD / INVERTER_STEP / INVERTER_FINE_SAMPLES_PER_PERIOD);
  if (state.stepCounter % every === 0) {
    let now = inverterPark(state.iAlpha, state.iBeta, state.angle);
    state.fine.push({ t: state.time, id: now.d, iq: now.q, udc: state.udc });
    let keep = INVERTER_FINE_PERIODS * INVERTER_FINE_SAMPLES_PER_PERIOD + 2;
    if (state.fine.length > keep) state.fine.splice(0, state.fine.length - keep);
  }

  if (state.time >= (state.periodIndex + 1) * INVERTER_PWM_PERIOD - dt * 1e-6) finishPeriod(state, level);
}

function inverterSetLegs(state, legs) {
  state.legs = legs.slice();
  state.switching.push({ t: inverterPeriodPhase(state), legs: legs.slice() });
}

function inverterToggleLeg(state, index) {
  if (state.status !== "running") return;
  let legs = state.legs.slice();
  legs[index] = legs[index] ? 0 : 1;
  inverterSetLegs(state, legs);
}

function inverterSetDuty(state, index, value) {
  state.duty[index] = Math.min(Math.max(value, 0), 1);
}

function inverterLose(state, reason) {
  if (state.status !== "running") return;
  state.status = "lost";
  state.reason = reason;
}

function inverterWin(state, reason) {
  if (state.status !== "running") return;
  state.status = "won";
  state.reason = reason;
}

// Конец периода: среднее за период уходит в историю, по нему судится цель.
function finishPeriod(state, level) {
  let sum = state.sum;
  let duration = sum.duration || INVERTER_PWM_PERIOD;
  let entry = {
    period: state.periodIndex,
    id: sum.id / duration,
    iq: sum.iq / duration,
    uAlpha: sum.uAlpha / duration,
    uBeta: sum.uBeta / duration,
    torque: sum.torque / duration,
    udc: state.udc,
    rpm: state.speed / RPM,
  };
  state.history.push(entry);
  if (state.history.length > INVERTER_HISTORY_PERIODS) state.history.shift();
  state.sum = emptyPeriodSum();
  state.periodIndex++;
  state.lastPeriodSwitching = state.switching;
  state.switching = [{ t: 0, legs: state.legs.slice() }];
  judgePeriod(state, level, entry);
}

function inverterHoldOk(goal, entry) {
  return Math.abs(entry.id - goal.id) <= goal.tolerance && Math.abs(entry.iq - goal.iq) <= goal.tolerance;
}

// Ток относительно цели и защиты — для подсветки на картинке машины.
// inside — мгновенный ток в допуске; averageInside — среднее за текущий
// период в допуске, а по нему период и засчитают; nearLimit — фазный ток
// выше INVERTER_CURRENT_WARNING от защиты. Без цели по току inside и
// averageInside ложны.
function inverterCurrentStatus(state, level) {
  let phases = inverterPhaseCurrents(state.iAlpha, state.iBeta);
  let peak = Math.max(Math.abs(phases.a), Math.abs(phases.b), Math.abs(phases.c));
  let status = { inside: false, averageInside: false, nearLimit: peak > INVERTER_CURRENT_LIMIT * INVERTER_CURRENT_WARNING };
  let goal = level.goal;
  if (goal.type !== "hold") return status;
  let now = inverterPark(state.iAlpha, state.iBeta, state.angle);
  status.inside = inverterHoldOk(goal, { id: now.d, iq: now.q });
  if (state.sum.duration > 0) {
    status.averageInside = inverterHoldOk(goal, { id: state.sum.id / state.sum.duration, iq: state.sum.iq / state.sum.duration });
  }
  return status;
}

function judgePeriod(state, level, entry) {
  if (state.status !== "running") return;
  let goal = level.goal;
  if (goal.type === "hold") {
    state.streak = inverterHoldOk(goal, entry) ? state.streak + 1 : 0;
    if (state.streak >= goal.periods) {
      inverterWin(state, "Ток удержан " + goal.periods + " периодов подряд.");
      return;
    }
  } else if (goal.type === "speed") {
    if (entry.rpm >= goal.rpm) {
      inverterWin(state, "Скорость " + Math.round(entry.rpm) + " об/мин за " + state.periodIndex + " периодов.");
      return;
    }
  } else if (goal.type === "stop") {
    if (Math.abs(entry.rpm) < goal.rpm) {
      inverterWin(state, "Ротор остановлен за " + state.periodIndex + " периодов.");
      return;
    }
  } else if (goal.type === "survive") {
    if (entry.rpm < goal.minRpm || entry.rpm > goal.maxRpm) {
      inverterLose(state, "Скорость " + Math.round(entry.rpm) + " об/мин вышла из полосы "
        + goal.minRpm + "–" + goal.maxRpm + ".");
      return;
    }
    if (state.periodIndex >= goal.periods) {
      inverterWin(state, "Смена отработана: " + goal.periods + " периодов.");
      return;
    }
  }
  if (state.periodIndex >= level.limitPeriods) {
    inverterLose(state, "Время вышло: " + level.limitPeriods + " периодов.");
  }
}

// Продвинуть модель на modelTime секунд модельного времени.
function inverterAdvance(state, level, modelTime) {
  let steps = Math.round(modelTime / INVERTER_STEP);
  for (let k = 0; k < steps && state.status === "running"; k++) inverterStep(state, level, INVERTER_STEP);
}

// Прогресс цели для шапки: текст и доля от 0 до 1.
function inverterGoalProgress(state, level) {
  let goal = level.goal;
  let last = state.history[state.history.length - 1];
  if (goal.type === "hold") {
    return { text: "В допуске " + state.streak + " / " + goal.periods, fraction: state.streak / goal.periods };
  }
  if (goal.type === "speed") {
    let rpm = last ? last.rpm : state.speed / RPM;
    return { text: Math.round(rpm) + " / " + goal.rpm + " об/мин", fraction: Math.max(0, rpm / goal.rpm) };
  }
  if (goal.type === "stop") {
    let start = Math.abs(level.rotor.rpm);
    let rpm = Math.abs(last ? last.rpm : state.speed / RPM);
    return { text: Math.round(rpm) + " → " + goal.rpm + " об/мин",
      fraction: Math.min(1, Math.max(0, (start - rpm) / Math.max(start - goal.rpm, 1))) };
  }
  return { text: "Период " + state.periodIndex + " / " + goal.periods, fraction: state.periodIndex / goal.periods };
}

// Текстовое описание цели для брифинга и шапки.
function inverterGoalText(level) {
  let goal = level.goal;
  if (goal.type === "hold") {
    return "id = " + goal.id + " А, iq = " + goal.iq + " А ± " + goal.tolerance + " А (среднее за период), "
      + goal.periods + " периодов подряд";
  }
  if (goal.type === "speed") return "n ≥ " + goal.rpm + " об/мин";
  if (goal.type === "stop") return "|n| < " + goal.rpm + " об/мин";
  return goal.minRpm + " ≤ n ≤ " + goal.maxRpm + " об/мин, " + goal.periods + " периодов";
}

// Вектор инвертора по состоянию стоек: номер 0–7 и подпись «100».
function inverterVectorLabel(legs) {
  return legs.join("");
}

// -- раскладка полотна ------------------------------------------------------

// Прямоугольники областей полотна. Широкое окно: слева машина над органами
// управления, справа шестиугольник над осциллограммами. Узкое: машина и
// шестиугольник рядом сверху, ниже осциллограммы, внизу органы управления.
function inverterLayout(width, height) {
  let gap = 10;
  if (width >= height * 1.15 && width >= 760) {
    let leftW = Math.round(width * 0.58);
    let rightW = width - leftW - gap * 3;
    let motorH = Math.round((height - gap * 3) * 0.52);
    let controlH = height - motorH - gap * 3;
    let hexH = Math.round((height - gap * 3) * 0.42);
    let scopeH = height - hexH - gap * 3;
    return {
      motor: { x: gap, y: gap, w: leftW - gap, h: motorH },
      control: { x: gap, y: motorH + gap * 2, w: leftW - gap, h: controlH },
      hexagon: { x: leftW + gap * 2, y: gap, w: rightW, h: hexH },
      scopes: { x: leftW + gap * 2, y: hexH + gap * 2, w: rightW, h: scopeH },
    };
  }
  let usable = height - gap * 4;
  let topH = Math.round(usable * 0.32);
  let scopeH = Math.round(usable * 0.26);
  let controlH = usable - topH - scopeH;
  let half = Math.floor((width - gap * 3) / 2);
  return {
    motor: { x: gap, y: gap, w: half, h: topH },
    hexagon: { x: gap * 2 + half, y: gap, w: width - half - gap * 3, h: topH },
    scopes: { x: gap, y: topH + gap * 2, w: width - gap * 2, h: scopeH },
    control: { x: gap, y: topH + scopeH + gap * 3, w: width - gap * 2, h: controlH },
  };
}

// Электрическая и механическая модель асинхронной машины с короткозамкнутым
// ротором.
//
// В отличие от PMSM, здесь нет оси, привязанной к ротору: поток ротора
// создаётся током статора и отстаёт от него, а сам ротор отстаёт от поля на
// скольжение. Поэтому уравнения записаны в неподвижной системе α–β — в ней
// не нужен ни угол ротора, ни угол потока, и шаг интегрирования ни от какого
// из них не зависит. Состояние — ток статора iα, iβ, потокосцепление ротора
// ψrα, ψrβ, механический угол θ и скорость Ω:
//
//   dψr/dt     = (Lm·is − ψr)/Tr + j·ωэ·ψr
//   L′·dis/dt  = us − Rs·is − E,          E = (Lm/Lr)·dψr/dt
//   J · dΩ/dt  = M − Mнагр − Mтр,         dθ/dt = Ω
//
// где Tr = Lr/Rr — постоянная времени ротора, L′ = Ls − Lm²/Lr — переходная
// индуктивность статора, ωэ = p·Ω, а j·ψr — поворот вектора на 90°. Момент
// M = 1,5·p·(Lm/Lr)·(ψrα·iβ − ψrβ·iα).
//
// Запись намеренно похожа на PMSM: us = Rs·is + L′·dis/dt + E. Роль
// индуктивности обмотки играет L′, роль противо-ЭДС магнитов — E, ЭДС от
// изменения потока ротора. Поэтому регулятор тока с теми же коэффициентами и
// тем же упреждением по E годится обеим машинам, если L′ подобрана близкой к
// индуктивности PMSM, — паспорт ниже так и подобран.
//
// Входы и выходы те же, что у PMSMModel: step() с напряжением в α–β и
// нагрузкой, состояние — MotorState. Токи id, iq здесь — проекции на оси,
// ориентированные по потоку ротора, и считаются уже после шага.

// Паспорт по умолчанию для величин, которые меняются из панели. Подобран
// под PMSM программы: p = 1, тот же инвертор 311 В и предел тока 25 А.
// При Lm = 150 мГн и Lσ = 3 мГн переходная индуктивность L′ = 5,9 мГн, а
// с Rs = 1,2 Ом электрическая постоянная L′/Rs = 4,9 мс — как 5 мс у PMSM.
// Номинальный поток 1,0 Вб берётся током намагничивания 6,7 А, а 311 В при
// 50 Гц как раз дают его на холостом ходу: ψ ≈ U/ω = 311/314.
const DEFAULT_INDUCTION_STATOR_RESISTANCE = 1.2;
const DEFAULT_INDUCTION_ROTOR_RESISTANCE = 1.0;
const DEFAULT_INDUCTION_MAGNETIZING_INDUCTANCE = 0.15;
const DEFAULT_INDUCTION_LEAKAGE_INDUCTANCE = 0.003;
const DEFAULT_INDUCTION_INERTIA = 0.1;

// Паспорт асинхронной машины. Поля, общие с MotorParameters (полюсы,
// трение, пределы), названы так же: регуляторы, отрисовка и панель читают их,
// не разбирая, какая машина перед ними.
class InductionMotorParameters {
  machineType = MACHINE_INDUCTION;

  // Электрическая часть. Рассеяние статора и ротора взято одинаковым и
  // задаётся одним полем: для показа их раздельная настройка ничего не
  // добавляет, а ползунков стало бы на один больше.
  statorResistance = DEFAULT_INDUCTION_STATOR_RESISTANCE;
  rotorResistance = DEFAULT_INDUCTION_ROTOR_RESISTANCE;
  magnetizingInductance = DEFAULT_INDUCTION_MAGNETIZING_INDUCTANCE;
  leakageInductance = DEFAULT_INDUCTION_LEAKAGE_INDUCTANCE;
  polePairs = 1;

  // Поток ротора, который держит векторный режим. Задание тока id — это
  // ratedRotorFlux / Lm, так что оно следует за ползунком Lm само.
  ratedRotorFlux = 1.0;

  // Механика и пределы — те же, что у PMSM, чтобы машины было с чем сравнить.
  inertia = DEFAULT_INDUCTION_INERTIA;
  viscousFriction = 0.0015;
  coulombFriction = 0.155;
  frictionSmoothingSpeed = 0.8;
  maximumVoltage = 311.0;
  maximumCurrent = 25.0;
  maximumLoadTorque = 50.0;

  get statorInductance() {
    return this.magnetizingInductance + this.leakageInductance;
  }

  get rotorInductance() {
    return this.magnetizingInductance + this.leakageInductance;
  }

  // L′ = Ls − Lm²/Lr: индуктивность, через которую ток статора меняется
  // быстро, пока поток ротора не успел за ним пойти.
  get transientInductance() {
    return this.statorInductance
      - this.magnetizingInductance * this.magnetizingInductance / this.rotorInductance;
  }

  get rotorTimeConstant() {
    return this.rotorInductance / this.rotorResistance;
  }

  // Lm/Lr — доля потока ротора, которая сцеплена со статором.
  get rotorCoupling() {
    return this.magnetizingInductance / this.rotorInductance;
  }

  // Сброс настраиваемой части паспорта — по кнопке «Сброс», как и у PMSM.
  resetTunableParameters() {
    this.statorResistance = DEFAULT_INDUCTION_STATOR_RESISTANCE;
    this.rotorResistance = DEFAULT_INDUCTION_ROTOR_RESISTANCE;
    this.magnetizingInductance = DEFAULT_INDUCTION_MAGNETIZING_INDUCTANCE;
    this.leakageInductance = DEFAULT_INDUCTION_LEAKAGE_INDUCTANCE;
    this.inertia = DEFAULT_INDUCTION_INERTIA;
  }
}

// Правая часть: по значению на каждую интегрируемую величину.
class InductionStateDerivative {
  currentAlpha;
  currentBeta;
  fluxAlpha;
  fluxBeta;
  mechanicalAngle;
  mechanicalSpeed;
}

// Модель асинхронной машины, метод Рунге — Кутты 4-го порядка. Устроена как
// PMSMModel: напряжение и нагрузка внутри шага постоянны, четыре стадии
// отличаются только точкой, в которой берётся состояние.
class InductionMotorModel {
  parameters;
  state = new MotorState();

  k1 = new InductionStateDerivative();
  k2 = new InductionStateDerivative();
  k3 = new InductionStateDerivative();
  k4 = new InductionStateDerivative();
  temporaryState = new MotorState();

  constructor(parameters) {
    this.parameters = parameters;
    this.reset();
  }

  // Обесточенная остановленная машина: ни тока, ни потока. Угол поля при
  // нулевом потоке не определён, и берётся нулевой — по оси α.
  reset() {
    this.state.currentAlpha = 0.0;
    this.state.currentBeta = 0.0;
    this.state.fluxAlpha = 0.0;
    this.state.fluxBeta = 0.0;
    this.state.mechanicalAngle = 0.0;
    this.state.mechanicalSpeed = 0.0;
    this.state.simulationTime = 0.0;
    this.state.fieldAngle = 0.0;
    this.state.loadTorque = 0.0;
    this.updateDerivedValues(0.0, 0.0, 0.0);
  }

  step(voltageAlpha, voltageBeta, loadTorque, timeStep) {
    this.evaluateDerivative(this.state, voltageAlpha, voltageBeta, loadTorque, this.k1);

    this.makeTemporaryState(this.state, this.k1, timeStep * 0.5);
    this.evaluateDerivative(this.temporaryState, voltageAlpha, voltageBeta, loadTorque, this.k2);

    this.makeTemporaryState(this.state, this.k2, timeStep * 0.5);
    this.evaluateDerivative(this.temporaryState, voltageAlpha, voltageBeta, loadTorque, this.k3);

    this.makeTemporaryState(this.state, this.k3, timeStep);
    this.evaluateDerivative(this.temporaryState, voltageAlpha, voltageBeta, loadTorque, this.k4);

    const sixthStep = timeStep / 6.0;
    for (const field of ["currentAlpha", "currentBeta", "fluxAlpha", "fluxBeta",
      "mechanicalAngle", "mechanicalSpeed"]) {
      this.state[field] += sixthStep * (this.k1[field] + 2.0 * this.k2[field]
        + 2.0 * this.k3[field] + this.k4[field]);
    }
    this.state.mechanicalAngle = wrapAngle(this.state.mechanicalAngle);
    this.state.simulationTime += timeStep;

    // Как и у PMSM: разошедшееся от нелепых ползунков решение не рисуется, а
    // машина начинает сначала.
    if (!this.stateIsFinite()) {
      this.reset();
      return;
    }
    this.updateDerivedValues(voltageAlpha, voltageBeta, loadTorque);
  }

  makeTemporaryState(source, derivative, timeOffset) {
    for (const field of ["currentAlpha", "currentBeta", "fluxAlpha", "fluxBeta",
      "mechanicalAngle", "mechanicalSpeed"]) {
      this.temporaryState[field] = source[field] + derivative[field] * timeOffset;
    }
  }

  // Производная потока ротора. Отдельно, потому что она нужна дважды: в
  // правой части и в ЭДС, которую показывает отрисовка и подаёт вперёд
  // регулятор тока. Первое слагаемое тянет поток к Lm·is с постоянной Tr,
  // второе поворачивает его вместе с ротором: в α–β поток ротора, «вмороженный»
  // в его клетку, уносится вращением.
  fluxDerivative(sample, electricalSpeed) {
    const rotorTimeConstant = this.parameters.rotorTimeConstant;
    const magnetizing = this.parameters.magnetizingInductance;
    return {
      alpha: (magnetizing * sample.currentAlpha - sample.fluxAlpha) / rotorTimeConstant
        - electricalSpeed * sample.fluxBeta,
      beta: (magnetizing * sample.currentBeta - sample.fluxBeta) / rotorTimeConstant
        + electricalSpeed * sample.fluxAlpha,
    };
  }

  evaluateDerivative(sample, voltageAlpha, voltageBeta, loadTorque, derivative) {
    const electricalSpeed = this.parameters.polePairs * sample.mechanicalSpeed;
    const flux = this.fluxDerivative(sample, electricalSpeed);
    const coupling = this.parameters.rotorCoupling;
    const transient = this.parameters.transientInductance;

    derivative.fluxAlpha = flux.alpha;
    derivative.fluxBeta = flux.beta;
    derivative.currentAlpha = (voltageAlpha
      - this.parameters.statorResistance * sample.currentAlpha
      - coupling * flux.alpha) / transient;
    derivative.currentBeta = (voltageBeta
      - this.parameters.statorResistance * sample.currentBeta
      - coupling * flux.beta) / transient;

    const torque = this.electromagneticTorque(sample.currentAlpha, sample.currentBeta,
      sample.fluxAlpha, sample.fluxBeta);
    const friction = this.frictionTorque(sample.mechanicalSpeed, torque - loadTorque);
    derivative.mechanicalSpeed = (torque - loadTorque - friction) / this.parameters.inertia;
    derivative.mechanicalAngle = sample.mechanicalSpeed;
  }

  // Момент — векторное произведение потока ротора на ток статора: он есть,
  // только пока ток не параллелен потоку.
  electromagneticTorque(currentAlpha, currentBeta, fluxAlpha, fluxBeta) {
    return 1.5 * this.parameters.polePairs * this.parameters.rotorCoupling
      * (fluxAlpha * currentBeta - fluxBeta * currentAlpha);
  }

  frictionTorque(mechanicalSpeed, torqueBeforeFriction) {
    return mechanicalFrictionTorque(this.parameters, mechanicalSpeed, torqueBeforeFriction);
  }

  // Всё, что пересчитывается из состояния: углы, d–q по потоку, ЭДС, ток
  // ротора, скольжение, моменты.
  updateDerivedValues(voltageAlpha, voltageBeta, loadTorque) {
    const state = this.state;
    state.electricalAngle = wrapAngle(this.parameters.polePairs * state.mechanicalAngle);
    state.electricalSpeed = this.parameters.polePairs * state.mechanicalSpeed;
    state.voltageAlpha = voltageAlpha;
    state.voltageBeta = voltageBeta;

    // Ось d — по потоку ротора. Пока потока практически нет, его направление
    // — шум, и оси d–q на картинке метались бы; тогда они остаются там, где
    // были.
    const fluxMagnitude = Math.hypot(state.fluxAlpha, state.fluxBeta);
    if (fluxMagnitude > 1e-4) {
      state.fieldAngle = Math.atan2(state.fluxBeta, state.fluxAlpha);
    }
    const cosine = cos(state.fieldAngle);
    const sine = sin(state.fieldAngle);
    state.currentD = cosine * state.currentAlpha + sine * state.currentBeta;
    state.currentQ = -sine * state.currentAlpha + cosine * state.currentBeta;

    const flux = this.fluxDerivative(state, state.electricalSpeed);
    state.emfAlpha = this.parameters.rotorCoupling * flux.alpha;
    state.emfBeta = this.parameters.rotorCoupling * flux.beta;

    // ψr = Lr·ir + Lm·is, отсюда ток ротора, приведённый к статору.
    const rotorInductance = this.parameters.rotorInductance;
    const magnetizing = this.parameters.magnetizingInductance;
    state.rotorCurrentAlpha = (state.fluxAlpha - magnetizing * state.currentAlpha) / rotorInductance;
    state.rotorCurrentBeta = (state.fluxBeta - magnetizing * state.currentBeta) / rotorInductance;

    // Скорость поля минус скорость ротора. В осях потока поток поворачивается
    // только за счёт iq: ωскольж = Lm·iq / (Tr·|ψr|).
    state.slipSpeed = fluxMagnitude > 1e-3
      ? magnetizing * state.currentQ / (this.parameters.rotorTimeConstant * fluxMagnitude)
      : 0.0;

    state.electromagneticTorque = this.electromagneticTorque(state.currentAlpha,
      state.currentBeta, state.fluxAlpha, state.fluxBeta);
    state.frictionTorque = this.frictionTorque(state.mechanicalSpeed,
      state.electromagneticTorque - loadTorque);
    state.loadTorque = loadTorque;
  }

  stateIsFinite() {
    return finiteValue(this.state.currentAlpha)
      && finiteValue(this.state.currentBeta)
      && finiteValue(this.state.fluxAlpha)
      && finiteValue(this.state.fluxBeta)
      && finiteValue(this.state.mechanicalAngle)
      && finiteValue(this.state.mechanicalSpeed);
  }
}

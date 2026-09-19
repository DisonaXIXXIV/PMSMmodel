// Электрическая и механическая модель неявнополюсной синхронной машины с
// постоянными магнитами (PMSM).
//
// Состояние модели — четыре величины: токи id, iq в системе координат,
// вращающейся вместе с ротором, механический угол θ и механическая скорость Ω.
// Уравнения записаны в d–q именно потому, что в этой системе потокосцепление
// магнитов постоянно и в правых частях нет явной зависимости от угла:
//
//   Ld · did/dt = ud − R·id + ωэ·Lq·iq
//   Lq · diq/dt = uq − R·iq − ωэ·(Ld·id + ψf)
//   J  · dΩ/dt  = M − Mнагр − Mтр
//        dθ/dt  = Ω
//
// где ωэ = p·Ω — электрическая скорость, а электромагнитный момент
// M = 1,5·p·(ψf·iq + (Ld − Lq)·id·iq). Слагаемые с ωэ — перекрёстные связи
// между осями: именно из-за них при вращении ток по одной оси «тянет» за собой
// другую, и именно их компенсируют регуляторы в Controllers.js.
//
// Входы модели — напряжения uα, uβ в неподвижной системе координат (их выдаёт
// DriveController) и момент нагрузки. Внутрь шага они переводятся прямым
// преобразованием Парка, наружу в MotorState отдаются и те, и другие величины:
// рисовать удобнее в α–β, считать — в d–q.
//
// Модель ничего не знает ни об интерфейсе, ни о способе управления: единственный
// способ на неё повлиять — вызвать step() с напряжением и нагрузкой.

// Паспорт машины: значения зафиксированы в коде, интерфейс их не меняет.
// Настройками остаются только задания и коэффициенты регуляторов
// (ControlSettings) — параметры самой машины по ходу показа не «плывут».
class MotorParameters {
  // Электрическая часть. Ld = Lq, то есть машина неявнополюсная: реактивный
  // момент из формулы момента при этом обращается в нуль, и момент
  // оказывается пропорционален одному iq. Постоянная времени обмотки
  // L/R = 5 мс. ψf = 1,25 Вб при p = 1 даёт моментную постоянную
  // 1,5·p·ψf = 1,875 Н·м/А.
  statorResistance = 1.2;
  inductanceD = 0.006;
  inductanceQ = 0.006;
  magnetFlux = 1.25;
  polePairs = 1;

  // Механическая часть. Трение состоит из вязкого (пропорционального
  // скорости) и сухого; сухое сглажено гиперболическим тангенсом с масштабом
  // frictionSmoothingSpeed, потому что разрывной знак скорости в правой части
  // заставил бы решатель дёргаться около нуля. Механическая постоянная
  // времени J/Bv здесь много больше электрической, поэтому скорость меняется
  // заметно медленнее тока — это видно и на экране.
  inertia = 0.1;
  viscousFriction = 0.0015;
  coulombFriction = 0.155;
  frictionSmoothingSpeed = 0.8;

  // Пределы. 311 В — амплитуда фазного напряжения инвертора при питании от
  // сети 220 В (220·√2); ею ограничивается вектор напряжения. Максимальный
  // ток задаёт и масштаб картинки, и ограничение задания в контуре скорости,
  // а максимальный момент — диапазон ползунка нагрузки и длину дуг моментов.
  maximumVoltage = 311.0;
  maximumCurrent = 25.0;
  maximumLoadTorque = 50.0;
}

// Полный снимок машины. Первые пять полей — собственно состояние (то, что
// интегрируется, плюс модельное время); остальные пересчитываются из них в
// updateDerivedValues после каждого шага. Регуляторы и отрисовка читают
// только этот объект, поэтому у них один и тот же взгляд на машину.
class MotorState {
  currentD;
  currentQ;
  mechanicalAngle;
  mechanicalSpeed;
  simulationTime;

  // Производные величины: их никто не интегрирует, они пересчитываются из
  // состояния. Здесь же лежат входы последнего шага (напряжение и нагрузка) —
  // их нужно показывать, а больше взять их негде.
  electricalAngle;
  electricalSpeed;
  currentAlpha;
  currentBeta;
  voltageAlpha;
  voltageBeta;
  emfAlpha;
  emfBeta;
  electromagneticTorque;
  frictionTorque;
  loadTorque;
}

// Правая часть системы: по одному значению на каждую интегрируемую
// величину. Четыре таких объекта (k1…k4) создаются один раз и
// переиспользуются — в цикле на 10 000 шагов в секунду это заметно.
class StateDerivative {
  currentD;
  currentQ;
  mechanicalAngle;
  mechanicalSpeed;
}

// Модель машины с интегрированием методом Рунге — Кутты 4-го порядка.
//
// Напряжение и момент нагрузки внутри шага считаются постоянными: их меняют
// регуляторы и интерфейс между шагами, а не внутри. Поэтому все четыре
// вычисления производной получают одни и те же voltageAlpha/voltageBeta, и
// отличаются только точкой, в которой берётся состояние.
class PMSMModel {
  parameters;
  state = new MotorState();

  k1 = new StateDerivative();
  k2 = new StateDerivative();
  k3 = new StateDerivative();
  k4 = new StateDerivative();
  temporaryState = new MotorState();

  constructor(parameters) {
    this.parameters = parameters;
    this.reset();
  }

  // Обнуление машины: токи, угол, скорость, время. Вызывается и при
  // создании, и по кнопке «Сброс», и самой моделью, если решение разошлось.
  // updateDerivedValues в конце нужен, чтобы состояние осталось согласованным
  // ещё до первого шага: первый же кадр уже что-то рисует.
  reset() {
    this.state.currentD = 0.0;
    this.state.currentQ = 0.0;
    this.state.mechanicalAngle = 0.0;
    this.state.mechanicalSpeed = 0.0;
    this.state.simulationTime = 0.0;
    this.state.loadTorque = 0.0;
    this.updateDerivedValues(0.0, 0.0, 0.0);
  }

  // Один шаг интегрирования. Классические четыре стадии: производная в
  // начале шага, две — в середине (по предыдущей оценке), одна — в конце.
  step(voltageAlpha, voltageBeta, loadTorque, timeStep) {
    this.evaluateDerivative(this.state, voltageAlpha, voltageBeta, loadTorque, this.k1);

    this.makeTemporaryState(this.state, this.k1, timeStep * 0.5);
    this.evaluateDerivative(this.temporaryState, voltageAlpha, voltageBeta, loadTorque, this.k2);

    this.makeTemporaryState(this.state, this.k2, timeStep * 0.5);
    this.evaluateDerivative(this.temporaryState, voltageAlpha, voltageBeta, loadTorque, this.k3);

    this.makeTemporaryState(this.state, this.k3, timeStep);
    this.evaluateDerivative(this.temporaryState, voltageAlpha, voltageBeta, loadTorque, this.k4);

    // Итоговое приращение — взвешенное среднее (k1 + 2k2 + 2k3 + k4)/6.
    const sixthStep = timeStep / 6.0;
    this.state.currentD += sixthStep * (this.k1.currentD + 2.0 * this.k2.currentD
      + 2.0 * this.k3.currentD + this.k4.currentD);
    this.state.currentQ += sixthStep * (this.k1.currentQ + 2.0 * this.k2.currentQ
      + 2.0 * this.k3.currentQ + this.k4.currentQ);
    this.state.mechanicalAngle += sixthStep * (this.k1.mechanicalAngle
      + 2.0 * this.k2.mechanicalAngle + 2.0 * this.k3.mechanicalAngle
      + this.k4.mechanicalAngle);
    this.state.mechanicalSpeed += sixthStep * (this.k1.mechanicalSpeed
      + 2.0 * this.k2.mechanicalSpeed + 2.0 * this.k3.mechanicalSpeed
      + this.k4.mechanicalSpeed);
    // Угол приводится к одному обороту сразу после интегрирования: только он
    // растёт неограниченно, а точность шага при больших углах теряется.
    this.state.mechanicalAngle = wrapAngle(this.state.mechanicalAngle);
    this.state.simulationTime += timeStep;

    // Крайние комбинации коэффициентов, выставленные ползунками, способны
    // раскачать численное решение до бесконечности. Показывать NaN незачем:
    // машина возвращается в исходное состояние и продолжает работать.
    if (!this.stateIsFinite()) {
      this.reset();
      return;
    }
    this.updateDerivedValues(voltageAlpha, voltageBeta, loadTorque);
  }

  // Промежуточная точка для стадии Рунге — Кутты: состояние, сдвинутое по
  // заданной производной на timeOffset. Всегда пишется в один и тот же
  // temporaryState — стадии считаются последовательно и одновременно он
  // никому больше не нужен.
  makeTemporaryState(source, derivative, timeOffset) {
    this.temporaryState.currentD = source.currentD + derivative.currentD * timeOffset;
    this.temporaryState.currentQ = source.currentQ + derivative.currentQ * timeOffset;
    this.temporaryState.mechanicalAngle = source.mechanicalAngle
      + derivative.mechanicalAngle * timeOffset;
    this.temporaryState.mechanicalSpeed = source.mechanicalSpeed
      + derivative.mechanicalSpeed * timeOffset;
  }

  // Правая часть системы в точке sample. Здесь и выполняется прямое
  // преобразование Парка: напряжение приходит в неподвижной системе α–β, а
  // уравнения обмоток записаны в d–q, повёрнутой на электрический угол.
  evaluateDerivative(sample, voltageAlpha, voltageBeta, loadTorque, derivative) {
    const electricalAngle = this.parameters.polePairs * sample.mechanicalAngle;
    const electricalSpeed = this.parameters.polePairs * sample.mechanicalSpeed;
    const cosine = cos(electricalAngle);
    const sine = sin(electricalAngle);

    const voltageD = cosine * voltageAlpha + sine * voltageBeta;
    const voltageQ = -sine * voltageAlpha + cosine * voltageBeta;

    // Уравнения обмоток с перекрёстными связями: в оси d вращение добавляет
    // +ωэ·Lq·iq, в оси q — вычитает ωэ·(Ld·id + ψf), где слагаемое с ψf и есть
    // противо-ЭДС магнитов. При достаточной скорости она одна способна
    // перекрыть напряжение инвертора — это естественный предел разгона.
    derivative.currentD = (voltageD
      - this.parameters.statorResistance * sample.currentD
      + electricalSpeed * this.parameters.inductanceQ * sample.currentQ)
      / this.parameters.inductanceD;
    derivative.currentQ = (voltageQ
      - this.parameters.statorResistance * sample.currentQ
      - electricalSpeed * (this.parameters.inductanceD * sample.currentD
      + this.parameters.magnetFlux)) / this.parameters.inductanceQ;

    // Механика: момент машины минус нагрузка минус трение, делённые на момент
    // инерции. Трение считается от полного момента до трения — так сухое трение
    // может удержать вал неподвижным, а не только тормозить вращение.
    const torque = this.electromagneticTorque(sample.currentD, sample.currentQ);
    const friction = this.frictionTorque(sample.mechanicalSpeed, torque - loadTorque);
    derivative.mechanicalSpeed = (torque - loadTorque - friction) / this.parameters.inertia;
    derivative.mechanicalAngle = sample.mechanicalSpeed;
  }

  // Момент: M = 1,5·p·(ψf·iq + (Ld − Lq)·id·iq). Множитель 1,5 — следствие
  // принятого здесь преобразования трёх фаз в две оси с сохранением
  // амплитуды. Второе слагаемое (реактивный момент) при Ld = Lq равно нулю,
  // но оставлено: так те же уравнения годятся и для явнополюсной машины.
  electromagneticTorque(currentD, currentQ) {
    return 1.5 * this.parameters.polePairs
      * (this.parameters.magnetFlux * currentQ
      + (this.parameters.inductanceD - this.parameters.inductanceQ) * currentD * currentQ);
  }

  // Трение: вязкое плюс сухое. Первая ветвь — режим покоя: если вал почти
  // стоит и приложенного момента не хватает, чтобы преодолеть сухое трение,
  // трение в точности уравновешивает приложенный момент и вал остаётся на
  // месте. Без этой ветви машина бесконечно ползла бы от любого сколь угодно
  // малого момента. Вне покоя знак сухого трения сглажен тангенсом, иначе
  // разрыв в правой части сбивал бы метод Рунге — Кутты.
  frictionTorque(mechanicalSpeed, torqueBeforeFriction) {
    if (abs(mechanicalSpeed) < 0.015
        && abs(torqueBeforeFriction) <= this.parameters.coulombFriction) {
      return torqueBeforeFriction;
    }
    return this.parameters.viscousFriction * mechanicalSpeed
      + this.parameters.coulombFriction
      * Math.tanh(mechanicalSpeed / this.parameters.frictionSmoothingSpeed);
  }

  // Пересчёт всего, что показывается и читается регуляторами, из четырёх
  // проинтегрированных величин. Вызывается один раз за шаг, после
  // интегрирования: обратное преобразование Парка для токов, ЭДС вращения,
  // момент машины, трение и запоминание входов шага.
  updateDerivedValues(voltageAlpha, voltageBeta, loadTorque) {
    this.state.electricalAngle = wrapAngle(
      this.parameters.polePairs * this.state.mechanicalAngle,
    );
    this.state.electricalSpeed = this.parameters.polePairs * this.state.mechanicalSpeed;

    const cosine = cos(this.state.electricalAngle);
    const sine = sin(this.state.electricalAngle);
    this.state.currentAlpha = cosine * this.state.currentD - sine * this.state.currentQ;
    this.state.currentBeta = sine * this.state.currentD + cosine * this.state.currentQ;
    this.state.voltageAlpha = voltageAlpha;
    this.state.voltageBeta = voltageBeta;
    // ЭДС вращения от магнитов в неподвижной системе: вектор длиной ψf·ωэ,
    // опережающий ось d на 90°. Её значение не только рисуется, но и подаётся
    // регуляторам ручного режима как упреждение (см. Controllers.js).
    this.state.emfAlpha = -this.parameters.magnetFlux * this.state.electricalSpeed * sine;
    this.state.emfBeta = this.parameters.magnetFlux * this.state.electricalSpeed * cosine;
    this.state.electromagneticTorque = this.electromagneticTorque(
      this.state.currentD,
      this.state.currentQ,
    );
    this.state.frictionTorque = this.frictionTorque(
      this.state.mechanicalSpeed,
      this.state.electromagneticTorque - loadTorque,
    );
    this.state.loadTorque = loadTorque;
  }

  // Признак того, что решение не развалилось. Проверяются только
  // интегрируемые величины: остальные считаются из них.
  stateIsFinite() {
    return finiteValue(this.state.currentD)
      && finiteValue(this.state.currentQ)
      && finiteValue(this.state.mechanicalAngle)
      && finiteValue(this.state.mechanicalSpeed);
  }
}

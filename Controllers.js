// Управление: три режима задания напряжения на машину и регуляторы, которыми
// это задание получается.
//
// Единственный выход файла — DriveController.voltageCommand, вектор напряжения
// в неподвижной системе α–β. Симулятор вызывает update() перед каждым шагом
// модели и передаёт этот вектор в PMSMModel.step. Всё остальное здесь — способы
// его получить:
//
//   MODE_MANUAL    — вектор ведёт мышь или палец внутри статора. Либо это
//                    вектор напряжения, и он подаётся на машину как есть, либо
//                    вектор тока, и тогда его поддерживают два ПИ-регулятора.
//   MODE_OPEN_LOOP — вектор постоянной амплитуды вращается с заданной
//                    электрической частотой; обратных связей нет вообще.
//   MODE_VECTOR    — векторное управление: id поддерживается нулевым, iq
//                    задаётся ползунком либо внешним контуром скорости.
//
// Настройки (ControlSettings) заполняет интерфейс, регуляторы их только читают.
// Обратная связь берётся прямо из MotorState, то есть из состояния модели:
// датчиков, их шума и задержек здесь нет — показывается идеализированная
// картина, где измерено всё и точно.

// Режимы управления. Числа не случайны: это же индексы кнопок в строке выбора
// режима (ButtonRowControl), поэтому нажатие кнопки превращается в режим без
// всякой таблицы соответствия.
const MODE_MANUAL = 0;
const MODE_OPEN_LOOP = 1;
const MODE_VECTOR = 2;

// Что именно тянут мышью в ручном режиме, тоже по индексам кнопок.
const MANUAL_VECTOR_CURRENT = 0;
const MANUAL_VECTOR_VOLTAGE = 1;
// Предел ручного вектора напряжения — 15 В, а не 311 В инвертора. Ручное
// напряжение подаётся на машину напрямую, без контуров тока, и при полной
// амплитуде ток мгновенно ушёл бы далеко за предел: показывать было бы
// нечего. 15 В дают токи того же порядка, что и остальные режимы.
const MANUAL_MAXIMUM_VOLTAGE = 15.0;

// Всё, что можно задать из интерфейса. Одна структура-посредник: панель в неё
// только пишет, регуляторы и отрисовка — только читают. Значения полей здесь
// и есть значения по умолчанию, к которым возвращает сброс.
class ControlSettings {
  // Выбранный режим управления и нагрузка на валу. Нагрузка — единственная
  // настройка, действующая во всех режимах: она идёт прямо в модель, минуя
  // регуляторы.
  mode = MODE_MANUAL;
  loadTorque = 0.0;

  // Ручные задания в неподвижной системе α–β: их пишет MotorView, когда
  // тянут указатель внутри статора. Ток и напряжение хранятся отдельно,
  // чтобы переключение между ними не теряло того, что было задано раньше.
  manualCurrentAlpha = 0.0;
  manualCurrentBeta = 0.0;
  manualVoltageAlpha = 0.0;
  manualVoltageBeta = 0.0;
  manualVectorType = MANUAL_VECTOR_CURRENT;
  openLoopVoltage = 0.0;
  openLoopFrequency = 0.0;

  // Задания и коэффициенты векторного режима. Один и тот же ПИ-регулятор тока
  // (Kp, Ki) используется и здесь, и в ручном задании тока: это буквально
  // один контур тока, просто заданный по-разному.
  currentQReference = 0.0;
  currentKp = 4.0;
  currentKi = 800.0;
  speedLoopEnabled = false;
  speedReferenceRpm = 0.0;
  // Контур скорости действует через момент, делённый на момент инерции,
  // поэтому оба коэффициента пропорциональны MotorParameters.inertia. Эти
  // настроены для J = 0,1 и дают собственную частоту 20 рад/с при
  // коэффициенте демпфирования 2,3; нуль ПИ-регулятора стоит на
  // Ki/Kp = 4,3 рад/с. При другом моменте инерции их пришлось бы
  // пересчитать в той же пропорции.
  speedKp = 5.0;
  speedKi = 21.67;

  // Что показывать на картинке. К модели это отношения не имеет, но живёт
  // здесь же: панель и вид машины читают один и тот же объект настроек.
  showVoltage = true;
  showEmf = true;
  showAlphaBetaAxes = true;
  showDqAxes = true;
  showAlphaBetaProjections = false;
  showDqProjections = true;
  lockDqFrame = false;

  // Копия предела из паспорта машины: панель строит по нему диапазон
  // ползунка задания тока, не заглядывая в MotorParameters.
  maximumCurrent;

  constructor(parameters) {
    this.maximumCurrent = parameters.maximumCurrent;
  }

  // Сброс всех параметров интерфейса к значениям по умолчанию. Режим и тип
  // ручного вектора сохраняются намеренно: страница отдельного режима
  // (см. Presets.js) иначе выпала бы из своего режима, а вернуть его там
  // нечем — переключателя на ней нет.
  resetGuiParametersPreservingMode() {
    let preservedMode = this.mode;
    let preservedManualVectorType = this.manualVectorType;

    this.loadTorque = 0.0;
    this.manualCurrentAlpha = 0.0;
    this.manualCurrentBeta = 0.0;
    this.manualVoltageAlpha = 0.0;
    this.manualVoltageBeta = 0.0;
    this.openLoopVoltage = 0.0;
    this.openLoopFrequency = 0.0;

    this.currentQReference = 0.0;
    this.currentKp = 4.0;
    this.currentKi = 800.0;
    this.speedLoopEnabled = false;
    this.speedReferenceRpm = 0.0;
    this.speedKp = 5.0;
    this.speedKi = 21.67;

    this.showVoltage = true;
    this.showEmf = true;
    this.showAlphaBetaAxes = true;
    this.showDqAxes = true;
    this.showAlphaBetaProjections = false;
    this.showDqProjections = true;
    this.lockDqFrame = false;

    this.mode = preservedMode;
    this.manualVectorType = preservedManualVectorType;
  }
}

// ПИ-регулятор с защитой от насыщения интегратора.
//
// Коэффициенты не хранятся в самом регуляторе, а передаются в каждый вызов:
// их крутят ползунками на ходу, и брать их надо всегда свежие. Состояние
// регулятора — один накопленный интеграл.
//
// Порядок работы такой: calculate() даёт желаемый выход, вызывающий код
// ограничивает его по своим пределам (насыщение инвертора), а затем
// applyTracking() сообщает регулятору разницу между ограниченным и желаемым.
// Без этого шага интегратор продолжал бы накапливать ошибку, пока привод
// упёрся в предел, и при выходе из насыщения выдал бы огромный выброс.
class PIRegulator {
  integrator = 0.0;

  // Пропорциональная часть плюс накопленная интегральная. Интеграл считается
  // простым прямоугольником — при шаге 100 мкс этого более чем достаточно.
  calculate(error, kp, ki, timeStep) {
    this.integrator += ki * error * timeStep;
    return kp * error + this.integrator;
  }

  // Возврат интегратора при насыщении. saturationDifference — насколько
  // ограниченный выход отличается от желаемого (ноль, пока насыщения нет).
  // При Ki = 0 интегральной части нет вовсе, и держать в интеграторе остаток
  // от прежних настроек нельзя: он бы так и остался в выходе навсегда.
  applyTracking(saturationDifference, kp, ki, timeStep) {
    if (ki <= 0.0) {
      this.integrator = 0.0;
      return;
    }
    // Обратный пересчёт при Tt = Ti даёт коэффициент возврата Kaw = Ki / Kp.
    // Границы поставлены не ради физики, а ради численной устойчивости: Kp и
    // Ki задаются ползунками, и нарочно нелепая их пара не должна ни делить
    // на нуль, ни разогнать интегратор до бесконечности.
    let trackingGain = constrain(ki / max(kp, 0.25), 1.0, 2000.0);
    this.integrator += trackingGain * saturationDifference * timeStep;
    this.integrator = constrain(this.integrator, -1000.0, 1000.0);
  }

  // Полный сброс памяти регулятора. Нужен при каждой смене режима: накопленный
  // в другом режиме интеграл — это задание из прошлой жизни, и без сброса он
  // дал бы толчок в первый же миг после переключения.
  reset() {
    this.integrator = 0.0;
  }
}

// Регуляторы привода: по настройкам и состоянию машины выдают вектор
// напряжения.
//
// Отдельно от settings.mode хранится activeMode — режим, в котором
// регуляторы работают сейчас. Пока они различаются, значит, режим только что
// переключили, и первым делом нужно сбросить интеграторы: см. update().
class DriveController {
  parameters;
  settings;
  // Выход: напряжение uα, uβ. Один объект на всё время работы — его читает
  // симулятор сразу после update().
  voltageCommand = new Vec2();

  // Четыре регулятора тока: два в неподвижной системе для ручного задания
  // тока и два в вращающейся для векторного режима. Они не работают
  // одновременно — режим всегда один, — но каждый помнит свой интеграл.
  manualAlphaController = new PIRegulator();
  manualBetaController = new PIRegulator();
  currentDController = new PIRegulator();
  currentQController = new PIRegulator();

  // Интеграл контура скорости ведётся здесь, а не в PIRegulator: его выход
  // ограничивается предельным током машины, и возврат при насыщении удобнее
  // считать на месте вместе с этим ограничением.
  // openLoopAngle — фаза вращающегося вектора разомкнутого режима: она
  // накапливается сама, без всякой связи с настоящим углом ротора.
  speedIntegrator = 0.0;
  openLoopAngle = 0.0;
  currentDReference = 0.0;
  currentQReference = 0.0;
  activeMode = MODE_MANUAL;
  activeManualVectorType = MANUAL_VECTOR_CURRENT;

  constructor(parameters, settings) {
    this.parameters = parameters;
    this.settings = settings;
    this.activeMode = settings.mode;
    this.activeManualVectorType = settings.manualVectorType;
  }

  // Вызывается перед каждым шагом модели. Сначала — реакция на переключения,
  // сделанные интерфейсом между шагами, затем работа в текущем режиме.
  update(state, timeStep) {
    if (this.settings.mode != this.activeMode) {
      this.changeMode(this.settings.mode, state);
    }
    if (this.settings.manualVectorType != this.activeManualVectorType) {
      this.changeManualVectorType(this.settings.manualVectorType);
    }

    if (this.activeMode == MODE_MANUAL) {
      this.updateManualMode(state, timeStep);
    } else if (this.activeMode == MODE_OPEN_LOOP) {
      this.updateOpenLoopMode(timeStep);
    } else {
      this.updateVectorMode(state, timeStep);
    }
  }

  // Ручной режим. Вектор напряжения идёт на машину как есть — с одним
  // ограничением амплитуды; вектор тока поддерживается двумя ПИ-регуляторами
  // в неподвижной системе. Заданий id/iq в этом режиме нет, и они обнуляются,
  // чтобы отрисовка не показывала задание из другого режима.
  updateManualMode(state, timeStep) {
    this.currentDReference = 0.0;
    this.currentQReference = 0.0;
    if (this.activeManualVectorType == MANUAL_VECTOR_VOLTAGE) {
      this.voltageCommand.set(
      this.settings.manualVoltageAlpha,
      this.settings.manualVoltageBeta,
      );
      limitVector(this.voltageCommand, MANUAL_MAXIMUM_VOLTAGE);
      return;
    }

    // Ток регулируется прямо в α–β: заданный вектор в этом режиме неподвижен,
    // так что переходить в вращающуюся систему незачем. Плата известная —
    // в неподвижной системе задание для регулятора при вращении переменное, и
    // установившаяся ошибка по фазе тем больше, чем быстрее вращение.
    let regulatorAlpha = this.manualAlphaController.calculate(
      this.settings.manualCurrentAlpha - state.currentAlpha,
      this.settings.currentKp, this.settings.currentKi, timeStep);
    let regulatorBeta = this.manualBetaController.calculate(
      this.settings.manualCurrentBeta - state.currentBeta,
      this.settings.currentKp, this.settings.currentKi, timeStep);

    // При Ld = Lq объект управления в α–β — это R·i + L·di/dt + e = u.
    // Известную ЭДС вращения подаём вперёд, и регулятору остаётся только
    // RL-цепь. Без этого упреждения при вращении пришлось бы догонять ЭДС
    // интегратором, и ток отставал бы от задания тем сильнее, чем быстрее
    // вращается машина.
    let unsaturatedAlpha = regulatorAlpha + state.emfAlpha;
    let unsaturatedBeta = regulatorBeta + state.emfBeta;

    this.voltageCommand.set(unsaturatedAlpha, unsaturatedBeta);
    limitVector(this.voltageCommand, this.parameters.maximumVoltage);
    this.manualAlphaController.applyTracking(this.voltageCommand.x - unsaturatedAlpha,
      this.settings.currentKp, this.settings.currentKi, timeStep);
    this.manualBetaController.applyTracking(this.voltageCommand.y - unsaturatedBeta,
      this.settings.currentKp, this.settings.currentKi, timeStep);
  }

  // Разомкнутый режим: вектор заданной амплитуды вращается с заданной
  // частотой, и ни ток, ни положение ротора ни на что не влияют. Так виден
  // смысл синхронной машины: ротор либо втягивается в синхронизм с этим
  // вектором, либо выпадает из него — при слишком большой нагрузке или
  // слишком быстром разгоне частоты.
  updateOpenLoopMode(timeStep) {
    // Фаза интегрируется от частоты, поэтому знак частоты задаёт направление
    // вращения вектора, а её изменение ползунком не даёт скачка фазы.
    this.openLoopAngle = wrapAngle(this.openLoopAngle + TWO_PI * this.settings.openLoopFrequency * timeStep);
    this.voltageCommand.x = this.settings.openLoopVoltage * cos(this.openLoopAngle);
    this.voltageCommand.y = this.settings.openLoopVoltage * sin(this.openLoopAngle);
    this.currentDReference = 0.0;
    this.currentQReference = 0.0;
  }

  // Векторное управление. Ток по оси d держится нулевым — при Ld = Lq он не
  // создаёт момента, а только греет обмотку. Момент задаётся одним iq: либо
  // напрямую ползунком, либо контуром скорости.
  updateVectorMode(state, timeStep) {
    this.currentDReference = 0.0;
    // Внешний контур скорости. Его выход — задание тока iq, то есть
    // фактически задание момента, поэтому ограничение выхода предельным током
    // машины и есть ограничение момента при разгоне. Возврат интегратора
    // считается тем же способом, что и в PIRegulator.applyTracking.
    if (this.settings.speedLoopEnabled) {
      let speedError = radiansFromRpm(this.settings.speedReferenceRpm) - state.mechanicalSpeed;
      let unsaturatedCurrent = this.settings.speedKp * speedError + this.speedIntegrator;
      this.currentQReference = clampMagnitude(unsaturatedCurrent, this.parameters.maximumCurrent);
      let speedTrackingGain = this.settings.speedKi > 0.0
        ? constrain(this.settings.speedKi / max(this.settings.speedKp, 0.01), 1.0, 500.0)
        : 0.0;
      this.speedIntegrator += this.settings.speedKi * speedError * timeStep
        + speedTrackingGain * (this.currentQReference - unsaturatedCurrent) * timeStep;
      this.speedIntegrator = constrain(this.speedIntegrator, -this.parameters.maximumCurrent, this.parameters.maximumCurrent);
    } else {
      this.currentQReference = this.settings.currentQReference;
    }

    // Внутренний контур тока — в вращающейся системе d–q. Здесь задания
    // постоянны, поэтому ПИ-регулятор выводит ошибку в нуль полностью, чего в
    // неподвижной системе не добиться.
    let errorD = this.currentDReference - state.currentD;
    let errorQ = this.currentQReference - state.currentQ;
    let regulatorD = this.currentDController.calculate(errorD, this.settings.currentKp, this.settings.currentKi, timeStep);
    let regulatorQ = this.currentQController.calculate(errorQ, this.settings.currentKp, this.settings.currentKi, timeStep);

    // Развязка осей: к выходу регуляторов добавляются те самые перекрёстные
    // слагаемые из уравнений машины, но с обратным знаком. После этого каждая
    // ось ведёт себя как отдельная RL-цепь, и контуры тока перестают мешать
    // друг другу. В слагаемом по оси q сидит и противо-ЭДС магнитов ωэ·ψf —
    // её регулятору тоже незачем догонять интегратором.
    let unsaturatedD = regulatorD - state.electricalSpeed * this.parameters.inductanceQ * state.currentQ;
    let unsaturatedQ = regulatorQ + state.electricalSpeed
      * (this.parameters.inductanceD * state.currentD + this.parameters.magnetFlux);

    // Обратное преобразование Парка: напряжение считалось в d–q, а инвертор и
    // модель принимают его в неподвижной системе α–β.
    let cosine = cos(state.electricalAngle);
    let sine = sin(state.electricalAngle);
    let unsaturatedAlpha = cosine * unsaturatedD - sine * unsaturatedQ;
    let unsaturatedBeta = sine * unsaturatedD + cosine * unsaturatedQ;

    this.voltageCommand.set(unsaturatedAlpha, unsaturatedBeta);
    limitVector(this.voltageCommand, this.parameters.maximumVoltage);

    // Ограничение наложено на вектор целиком, в α–β, — значит, и разницу для
    // возврата интеграторов нужно смотреть в d–q, в тех же осях, где работают
    // регуляторы. Поэтому ограниченный вектор переводится назад.
    let saturatedD = cosine * this.voltageCommand.x + sine * this.voltageCommand.y;
    let saturatedQ = -sine * this.voltageCommand.x + cosine * this.voltageCommand.y;
    this.currentDController.applyTracking(saturatedD - unsaturatedD,
      this.settings.currentKp, this.settings.currentKi, timeStep);
    this.currentQController.applyTracking(saturatedQ - unsaturatedQ,
      this.settings.currentKp, this.settings.currentKi, timeStep);
  }

  // Переход в другой режим. Интеграторы сбрасываются: накопленное в прошлом
  // режиме к новому заданию отношения не имеет. Фаза разомкнутого режима
  // подхватывается от текущего положения ротора — тогда включение режима не
  // даёт рывка, вектор напряжения продолжает с того места, где стоит ротор.
  changeMode(newMode, state) {
    this.resetRegulators();
    this.activeMode = newMode;
    this.activeManualVectorType = this.settings.manualVectorType;
    if (newMode == MODE_OPEN_LOOP) {
      this.openLoopAngle = state.electricalAngle;
    }
  }

  // Смена режима из панели: меняется и настройка, и активный режим сразу.
  // update() тот же переход не повторит — после этого они уже совпадают.
  setMode(newMode, state) {
    this.settings.mode = newMode;
    this.changeMode(newMode, state);
  }

  // Ручные задания пишет MotorView, пока тянут указатель внутри статора.
  setManualCurrent(alpha, beta) {
    this.settings.manualCurrentAlpha = alpha;
    this.settings.manualCurrentBeta = beta;
  }

  setManualVoltage(alpha, beta) {
    this.settings.manualVoltageAlpha = alpha;
    this.settings.manualVoltageBeta = beta;
  }

  // Переключение между ручным током и ручным напряжением из панели.
  setManualVectorType(vectorType) {
    this.settings.manualVectorType = vectorType;
    this.changeManualVectorType(vectorType);
  }

  // Смена типа ручного вектора сбрасывает регуляторы тока: при переходе на
  // ручное напряжение они всё равно не работают, а при обратном переходе их
  // интегралы уже устарели.
  changeManualVectorType(vectorType) {
    this.manualAlphaController.reset();
    this.manualBetaController.reset();
    this.activeManualVectorType = vectorType;
  }

  // Вся память регуляторов: четыре интегратора контуров тока и интеграл
  // контура скорости. Задания и режим при этом не трогаются.
  resetRegulators() {
    this.manualAlphaController.reset();
    this.manualBetaController.reset();
    this.currentDController.reset();
    this.currentQController.reset();
    this.speedIntegrator = 0.0;
  }

  // Сброс по кнопке «Сброс» или клавише R. Обнуляется вся память управления —
  // интеграторы, угол разомкнутого режима, ручные задания, — но не выбор
  // режима и не тип ручного вектора: на demo-странице одного режима сброс не
  // должен выводить страницу из её режима.
  reset() {
    this.resetRegulators();
    this.voltageCommand.set(0.0, 0.0);
    this.openLoopAngle = 0.0;
    this.settings.manualCurrentAlpha = 0.0;
    this.settings.manualCurrentBeta = 0.0;
    this.settings.manualVoltageAlpha = 0.0;
    this.settings.manualVoltageBeta = 0.0;
    this.currentDReference = 0.0;
    this.currentQReference = 0.0;
    this.activeMode = this.settings.mode;
    this.activeManualVectorType = this.settings.manualVectorType;
  }
}

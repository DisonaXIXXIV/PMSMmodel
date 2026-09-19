// Диагностические тесты: проверяют физику, регуляторы, сброс параметров,
// профили демонстрации, палитры тем и ту часть интерфейса, которая считает, а
// не рисует, — раскладку, попадание нажатий и перевод экранных координат.
//
// Запускаются двумя способами, и оба прогоняют один и тот же набор:
//   npm test                      — в Node (tests/run-diagnostics.js);
//   http://…/?self-test           — в браузере, той же программой.
//
// Тесты намеренно написаны без всякого каркаса: ни библиотеки, ни сборки — иначе
// вторым способом их было бы не запустить. Проверяются не отдельные функции, а
// поведение целиком собранной модели с регуляторами: почти каждый тест —
// это прогон переходного процесса шагами по 100 мкс с проверкой того, куда он
// пришёл. Допуски поэтому не «машинная точность», а инженерные: важно, что
// регулятор вывел ток к заданию, а не то, в каком знаке он это сделал.
//
// Ошибки не бросают исключений, а считаются в diagnosticFailures и печатаются в
// консоль: одна неудачная проверка не должна скрыть остальные.

// Счётчик неудачных проверок за прогон. Обнуляется в начале
// runSimulationDiagnostics, наращивается вспомогательными функциями внизу файла.
let diagnosticFailures = 0;

// Полный прогон. Возвращает число ошибок: ноль — всё прошло. Порядок
// примерно от простого к сложному — преобразование координат, режимы
// управления, защита регуляторов, затем то, что относится не к физике, а к
// устройству программы, и в конце — раскладка и разбор нажатий.
function runSimulationDiagnostics() {
  diagnosticFailures = 0;
  console.log("=== PMSM simulation diagnostics ===");
  testCoordinateTransform();
  testManualCurrentStep();
  testManualVoltageCommand();
  testManualBackEmfCompensation();
  testVectorCurrentStep();
  testSpeedLoopStep();
  testNegativeSpeedLoopStep();
  testCurrentAntiWindup();
  testGuiParameterReset();
  testDemoProfiles();
  testThemePalettes();
  testStatorWinding();
  testLineFlow();
  testSketchLayout();
  testDockGeometry();
  testSliderMapping();
  testButtonRowHitTest();
  testToolbarHitTest();
  testManualVectorMapping();
  testReferenceFrameLock();

  if (diagnosticFailures > 0) {
    console.log("PMSM diagnostics failed: " + diagnosticFailures);
    return diagnosticFailures;
  }
  console.log("All PMSM diagnostics passed.");
  return diagnosticFailures;
}

// Преобразование Парка — поворот, а значит, длина вектора тока в осях d–q и в
// осях α–β должна быть одной и той же. Самая базовая проверка: если она не
// проходит, неверны и все остальные величины.
function testCoordinateTransform() {
  let testParameters = new MotorParameters();
  let testMotor = new PMSMModel(testParameters);
  testMotor.state.currentD = 7.0;
  testMotor.state.currentQ = -4.0;
  testMotor.state.mechanicalAngle = 1.1;
  testMotor.updateDerivedValues(0.0, 0.0, 0.0);

  let dqMagnitude = sqrt(7.0 * 7.0 + 4.0 * 4.0);
  let alphaBetaMagnitude = sqrt(
    testMotor.state.currentAlpha * testMotor.state.currentAlpha
    + testMotor.state.currentBeta * testMotor.state.currentBeta);
  diagnosticNear("Park transform preserves current magnitude",
    alphaBetaMagnitude, dqMagnitude, 0.0001);
}

// Ручное задание тока: регуляторы должны вывести ток к заданному вектору и не
// навести при этом ток по поперечной оси. 250 шагов — это 25 мс, около пяти
// электрических постоянных времени обмотки.
function testManualCurrentStep() {
  let testParameters = new MotorParameters();
  let testSettings = new ControlSettings(testParameters);
  let testMotor = new PMSMModel(testParameters);
  let testController = new DriveController(testParameters, testSettings);
  testSettings.mode = MODE_MANUAL;
  testController.setManualCurrent(10.0, 0.0);

  runDiagnosticSteps(testMotor, testController, testSettings, 250);
  diagnosticNear("Manual alpha current step", testMotor.state.currentAlpha, 10.0, 0.05);
  diagnosticNear("Manual beta cross error", testMotor.state.currentBeta, 0.0, 0.02);
}

// Ручное задание напряжения проходит на машину без изменений: никаких
// контуров тока в этом режиме нет. Единственное, что с ним делается, —
// ограничение по длине; поэтому же здесь проверяется и оно.
function testManualVoltageCommand() {
  let testParameters = new MotorParameters();
  let testSettings = new ControlSettings(testParameters);
  let testMotor = new PMSMModel(testParameters);
  let testController = new DriveController(testParameters, testSettings);
  testSettings.mode = MODE_MANUAL;
  testController.setManualVectorType(MANUAL_VECTOR_VOLTAGE);
  testController.setManualVoltage(12.0, -6.0);

  testController.update(testMotor.state, 0.0001);
  diagnosticNear("Manual voltage alpha command", testController.voltageCommand.x, 12.0, 0.0001);
  diagnosticNear("Manual voltage beta command", testController.voltageCommand.y, -6.0, 0.0001);

  testController.setManualVoltage(400.0, 300.0);
  testController.update(testMotor.state, 0.0001);
  diagnosticNear("Manual voltage vector limit", testController.voltageCommand.magnitude(),
    MANUAL_MAXIMUM_VOLTAGE, 0.0001);
}

// Упреждение по ЭДС вращения. Машину раскручиваем до 100 рад/с при нулевом
// задании тока: без упреждения ЭДС наводила бы заметный ток, а с ним он
// остаётся почти нулевым.
function testManualBackEmfCompensation() {
  let testParameters = new MotorParameters();
  let testSettings = new ControlSettings(testParameters);
  let testMotor = new PMSMModel(testParameters);
  let testController = new DriveController(testParameters, testSettings);
  testSettings.mode = MODE_MANUAL;
  testMotor.state.mechanicalSpeed = 100.0;
  testMotor.updateDerivedValues(0.0, 0.0, 0.0);

  runDiagnosticSteps(testMotor, testController, testSettings, 100);
  let currentMagnitude = sqrt(
    testMotor.state.currentAlpha * testMotor.state.currentAlpha
    + testMotor.state.currentBeta * testMotor.state.currentBeta);
  diagnosticLessThan("Manual back-EMF rejection", currentMagnitude, 0.15);
}

// Векторное управление: заданный iq достигается, id держится нулевым — то
// есть развязка осей работает и контуры тока друг другу не мешают.
function testVectorCurrentStep() {
  let testParameters = new MotorParameters();
  let testSettings = new ControlSettings(testParameters);
  let testMotor = new PMSMModel(testParameters);
  let testController = new DriveController(testParameters, testSettings);
  testSettings.mode = MODE_VECTOR;
  testSettings.speedLoopEnabled = false;
  testSettings.currentQReference = 3.0;

  runDiagnosticSteps(testMotor, testController, testSettings, 500);
  diagnosticNear("Vector id regulation", testMotor.state.currentD, 0.0, 0.05);
  diagnosticNear("Vector iq regulation", testMotor.state.currentQ, 3.0, 0.08);
}

// Контур скорости, самый длинный тест: разгон до 1000 об/мин и затем наброс
// нагрузки 10 Н·м. Проверяется четыре вещи: скорость приходит к заданию,
// перерегулирование не больше 5 %, наброс нагрузки не проваливает скорость
// глубже 200 об/мин и после него скорость возвращается к заданию —
// установившейся ошибки по нагрузке нет, за это отвечает интегральная часть.
// 10 000 шагов — это 1 с модельного времени.
function testSpeedLoopStep() {
  let testParameters = new MotorParameters();
  let testSettings = new ControlSettings(testParameters);
  let testMotor = new PMSMModel(testParameters);
  let testController = new DriveController(testParameters, testSettings);
  testSettings.mode = MODE_VECTOR;
  testSettings.speedLoopEnabled = true;
  testSettings.speedReferenceRpm = 1000.0;

  let maximumRpm = 0.0;
  let maximumCurrentReference = 0.0;
  let maximumVoltage = 0.0;
  let peakTime = 0.0;
  for (let step = 0; step < 10000; step++) {
    runDiagnosticStep(testMotor, testController, testSettings);
    let currentRpm = rpmFromRadians(testMotor.state.mechanicalSpeed);
    if (currentRpm > maximumRpm) {
      maximumRpm = currentRpm;
      peakTime = testMotor.state.simulationTime;
    }
    maximumCurrentReference = max(maximumCurrentReference,
      abs(testController.currentQReference));
    maximumVoltage = max(maximumVoltage, testController.voltageCommand.magnitude());
  }
  let finalRpm = rpmFromRadians(testMotor.state.mechanicalSpeed);
  // Печатается не как проверка, а как справка: по этим числам видно, во что
  // упирается разгон — в предел тока или в предел напряжения.
  console.log("INFO: speed peak at " + peakTime + " s; max iq* = "
    + maximumCurrentReference + " A; max |u| = " + maximumVoltage + " V");
  diagnosticNear("Speed loop steady state", finalRpm, 1000.0, 10.0);
  diagnosticLessThan("Speed loop overshoot", maximumRpm, 1050.0);

  testSettings.loadTorque = 10.0;
  let minimumLoadedRpm = finalRpm;
  for (let step = 0; step < 10000; step++) {
    runDiagnosticStep(testMotor, testController, testSettings);
    minimumLoadedRpm = min(minimumLoadedRpm,
      rpmFromRadians(testMotor.state.mechanicalSpeed));
  }
  let loadedFinalRpm = rpmFromRadians(testMotor.state.mechanicalSpeed);
  console.log("INFO: 10 Nm load step minimum = " + minimumLoadedRpm
    + " rpm; final = " + loadedFinalRpm + " rpm");
  diagnosticLessThan("Speed load-step dip", 1000.0 - minimumLoadedRpm, 200.0);
  diagnosticNear("Speed load rejection", loadedFinalRpm, 1000.0, 10.0);
}

// Защита интегратора от насыщения, отдельно от модели: регулятору даётся
// заведомо недостижимая ошибка, а его выход жёстко ограничивается. Без
// возврата интегратор за секунду накопил бы величину порядка 10^5; проверка
// требует, чтобы он остался небольшим.
function testCurrentAntiWindup() {
  let testRegulator = new PIRegulator();
  let timeStep = 0.0001;
  for (let step = 0; step < 10000; step++) {
    let rawOutput = testRegulator.calculate(100.0, 4.0, 800.0, timeStep);
    let saturatedOutput = constrain(rawOutput, -10.0, 10.0);
    testRegulator.applyTracking(saturatedOutput - rawOutput, 4.0, 800.0, timeStep);
  }
  diagnosticLessThan("Current PI anti-windup", abs(testRegulator.integrator), 20.0);
}

// То же задание скорости, но отрицательное: и регулятор, и показания должны
// работать в обе стороны. Знак проверяется в том же виде, в каком он
// попадает на экран, — через formatSignedNumber.
function testNegativeSpeedLoopStep() {
  let testParameters = new MotorParameters();
  let testSettings = new ControlSettings(testParameters);
  let testMotor = new PMSMModel(testParameters);
  let testController = new DriveController(testParameters, testSettings);
  testSettings.mode = MODE_VECTOR;
  testSettings.speedLoopEnabled = true;
  testSettings.speedReferenceRpm = -1000.0;

  runDiagnosticSteps(testMotor, testController, testSettings, 10000);
  let finalRpm = rpmFromRadians(testMotor.state.mechanicalSpeed);
  diagnosticNear("Negative speed command", finalRpm, -1000.0, 10.0);
  if (formatSignedNumber(finalRpm, 0).startsWith("-")) {
    console.log("PASS: Negative speed display sign (" + formatSignedNumber(finalRpm, 0) + ")");
  } else {
    diagnosticFailures++;
    console.log("FAIL: Negative speed display sign (" + formatSignedNumber(finalRpm, 0) + ")");
  }
}

// Сброс параметров. Проверяется и то, что сбрасывается, и то, что
// сохраняется: режим и тип ручного вектора должны уцелеть, иначе кнопка
// «Сброс» выводила бы demo-страницу из её режима.
function testGuiParameterReset() {
  let testParameters = new MotorParameters();
  let testSettings = new ControlSettings(testParameters);
  testSettings.mode = MODE_VECTOR;
  testSettings.manualVectorType = MANUAL_VECTOR_VOLTAGE;
  testSettings.manualVoltageAlpha = 123.0;
  testSettings.manualVoltageBeta = -45.0;
  testSettings.loadTorque = 17.0;
  testSettings.openLoopVoltage = 200.0;
  testSettings.openLoopFrequency = 42.0;
  testSettings.currentKp = 12.0;
  testSettings.speedReferenceRpm = -730.0;
  testSettings.speedLoopEnabled = true;
  testSettings.showVoltage = false;
  testSettings.lockDqFrame = true;

  testSettings.resetGuiParametersPreservingMode();
  diagnosticNear("Reset restores load", testSettings.loadTorque, 0.0, 0.0001);
  diagnosticNear("Reset restores open-loop voltage", testSettings.openLoopVoltage, 0.0, 0.0001);
  diagnosticNear("Reset restores open-loop frequency", testSettings.openLoopFrequency, 0.0, 0.0001);
  diagnosticNear("Reset restores current Kp", testSettings.currentKp, 4.0, 0.0001);
  diagnosticNear("Reset restores speed reference", testSettings.speedReferenceRpm, 0.0, 0.0001);
  diagnosticNear("Reset clears manual voltage alpha", testSettings.manualVoltageAlpha, 0.0, 0.0001);
  diagnosticNear("Reset clears manual voltage beta", testSettings.manualVoltageBeta, 0.0, 0.0001);
  if (testSettings.mode == MODE_VECTOR && !testSettings.speedLoopEnabled
      && testSettings.manualVectorType == MANUAL_VECTOR_VOLTAGE
      && testSettings.showVoltage && !testSettings.lockDqFrame) {
    console.log("PASS: Reset preserves control selections and restores checkboxes");
  } else {
    diagnosticFailures++;
    console.log("FAIL: Reset control-selection/checkbox behavior");
  }
}

// Каждый профиль — это отдельная страница демонстрации, и ошибка в нём
// проявилась бы только открытой ссылкой. Проверяем состав профилей и то, что
// профиль доводит свой режим до настроек, до регуляторов и переживает сброс.
function testDemoProfiles() {
  let requiredKeys = ["name", "documentTitle", "panelTitle", "mode", "manualVectorType",
    "singleMode", "singleManualVector"];
  let names = Object.keys(DEMO_PROFILES);
  let failures = 0;
  let singleModes = [];

  for (const name of names) {
    let profile = DEMO_PROFILES[name];
    for (const key of requiredKeys) {
      if (!(key in profile)) {
        failures++;
        console.log("FAIL: profile " + name + " is missing " + key);
      }
    }
    // Профиль называет сам себя, чтобы имя из ссылки и имя в записи не разошлись.
    if (profile.name !== name) {
      failures++;
      console.log("FAIL: profile " + name + " calls itself " + profile.name);
    }

    let testParameters = new MotorParameters();
    let testSettings = new ControlSettings(testParameters);
    applyDemoProfile(profile, testSettings);
    let testController = new DriveController(testParameters, testSettings);
    if (testSettings.mode !== profile.mode
        || testSettings.manualVectorType !== profile.manualVectorType
        || testController.activeMode !== profile.mode
        || testController.activeManualVectorType !== profile.manualVectorType) {
      failures++;
      console.log("FAIL: profile " + name + " does not reach the settings and the controller");
    }
    // Сброс сохраняет режим, поэтому кнопка «Сброс» не выводит страницу из её
    // режима — иначе на demo-странице его было бы не вернуть.
    testSettings.resetGuiParametersPreservingMode();
    if (testSettings.mode !== profile.mode
        || testSettings.manualVectorType !== profile.manualVectorType) {
      failures++;
      console.log("FAIL: reset drops profile " + name + " out of its mode");
    }
    if (profile.singleMode) singleModes.push(profile.mode);
  }

  // Опечатка в ссылке или в window.PMSM_PROFILE не должна давать пустую страницу.
  if (demoProfile("нет-такого-профиля") !== DEMO_PROFILES[PROFILE_FULL]) {
    failures++;
    console.log("FAIL: an unknown profile name does not fall back to the full program");
  }
  if (!DEMO_PROFILES[PROFILE_FULL] || DEMO_PROFILES[PROFILE_FULL].singleMode) {
    failures++;
    console.log("FAIL: the full profile must keep the mode selector");
  }
  // Все режимы модели показаны хотя бы одной отдельной страницей.
  for (const mode of [MODE_MANUAL, MODE_OPEN_LOOP, MODE_VECTOR]) {
    if (!singleModes.includes(mode)) {
      failures++;
      console.log("FAIL: no single-mode profile demonstrates mode " + mode);
    }
  }

  if (failures > 0) {
    diagnosticFailures += failures;
    return;
  }
  console.log("PASS: " + names.length + " demo profiles are consistent ("
    + names.join(", ") + ")");
}

// Прогон нескольких шагов — то же, что делает FixedStepSimulator, но без
// привязки к кадрам: в тестах время идёт настолько быстро, насколько считается.
function runDiagnosticSteps(testMotor, testController,
                        testSettings, stepCount) {
  for (let step = 0; step < stepCount; step++) {
    runDiagnosticStep(testMotor, testController, testSettings);
  }
}

function runDiagnosticStep(testMotor, testController,
                       testSettings) {
  let timeStep = 0.0001;
  testController.update(testMotor.state, timeStep);
  testMotor.step(testController.voltageCommand.x, testController.voltageCommand.y,
    testSettings.loadTorque, timeStep);
}

// Тема добавляется отдельной палитрой, и забытый в ней ключ проявился бы
// невидимой заливкой где-нибудь в редком режиме. Проверяем состав палитр
// целиком: набор ключей у всех тем одинаковый, а запись — [r, g, b] или
// [r, g, b, a] в допустимых пределах.
function testThemePalettes() {
  let names = Object.keys(THEME_PALETTES);
  let referenceName = names[0];
  let referenceKeys = Object.keys(THEME_PALETTES[referenceName]).sort();
  let failures = 0;

  for (const name of names) {
    let keys = Object.keys(THEME_PALETTES[name]).sort();
    for (const key of referenceKeys) {
      if (!keys.includes(key)) {
        failures++;
        console.log("FAIL: theme " + name + " is missing colour " + key);
      }
    }
    for (const key of keys) {
      if (!referenceKeys.includes(key)) {
        failures++;
        console.log("FAIL: theme " + name + " has colour " + key
          + " that " + referenceName + " lacks");
      }
      let entry = THEME_PALETTES[name][key];
      let valid = Array.isArray(entry) && (entry.length === 3 || entry.length === 4)
        && entry.every((channel) => typeof channel === "number"
          && channel >= 0 && channel <= 255);
      if (!valid) {
        failures++;
        console.log("FAIL: theme " + name + ", colour " + key + " is not [r, g, b(, a)]");
      }
    }
  }

  if (failures > 0) {
    diagnosticFailures += failures;
    return;
  }
  console.log("PASS: themes define the same " + referenceKeys.length
    + " colours (" + names.join(", ") + ")");
}

// -- раскладка и разбор нажатий ---------------------------------------------
//
// Ниже — тесты той половины программы, которая рисует. Целиком её без полотна
// не проверить, но считает она заметно больше, чем рисует: выбор компоновки,
// расстановка виджетов, попадание нажатий и перевод точки полотна в физическую
// величину — обычные функции, которым полотно не нужно. Они и проверяются;
// всё, что действительно рисует, по-прежнему остаётся на открытие страницы
// ?self-test.

// Обмотка статора: шесть фазных зон по три паза в порядке A+ C− B+ A− C+ B−.
// Ожидаемое записано отдельным списком на все 18 пазов, а не выведено той же
// формулой, что и в MotorView: тест должен ловить ошибку в самой формуле.
//
// Проверка появилась из-за переноса с Processing: там slot / 3 было
// целочисленным делением, а в JavaScript дало дробь, индекс промахнулся мимо
// массива зон, и весь статор оказался нарисован одной фазой C.
function testStatorWinding() {
  let expectedSlots = [
    "A+", "A+", "A+", "C−", "C−", "C−", "B+", "B+", "B+",
    "A−", "A−", "A−", "C+", "C+", "C+", "B−", "B−", "B−",
  ];
  let failures = 0;

  if (STATOR_SLOT_COUNT !== expectedSlots.length) {
    failures++;
    console.log("FAIL: the stator has " + STATOR_SLOT_COUNT + " slots, the table has "
      + expectedSlots.length);
  }
  for (let slot = 0; slot < STATOR_SLOT_COUNT; slot++) {
    let winding = statorSlotWinding(slot);
    // Промах мимо массива зон проявился бы именно здесь: фаза стала бы
    // undefined, а имя — пустым.
    if (winding.phase === undefined || STATOR_PHASE_NAMES[winding.phase] === undefined) {
      failures++;
      console.log("FAIL: slot " + slot + " belongs to no phase belt");
      continue;
    }
    let actual = STATOR_PHASE_NAMES[winding.phase]
      + (winding.conductorDirection > 0 ? "+" : "−");
    if (actual !== expectedSlots[slot]) {
      failures++;
      console.log("FAIL: slot " + slot + " is " + actual + ", expected " + expectedSlots[slot]);
    }
  }
  // Цвет каждой зоны тоже берётся по индексу фазы, и промах там дал бы
  // неопределённый ключ палитры вместо заливки.
  for (const key of STATOR_PHASE_COLOR_KEYS) {
    if (theme()[key] === undefined) {
      failures++;
      console.log("FAIL: the palette has no stator phase colour " + key);
    }
  }

  if (failures > 0) {
    diagnosticFailures += failures;
    return;
  }
  console.log("PASS: " + STATOR_SLOT_COUNT + " stator slots form the belts A+ C− B+ A− C+ B−");
}

// Раскладка кусков по строкам. Ею набираются легенда и примечание об обмотке,
// где состав зависит от режима, а ширина — от экрана.
function testLineFlow() {
  let fitting = flowIntoLines([10.0, 10.0, 10.0], 5.0, 100.0);
  diagnosticTrue("Pieces that fit stay on one line", fitting.length === 1);

  // 40 + 10 + 40 = 90 укладывается, третий кусок уже нет.
  let wrapped = flowIntoLines([40.0, 40.0, 40.0], 10.0, 100.0);
  diagnosticTrue("Pieces that do not fit wrap to the next line",
    wrapped.length === 2 && wrapped[0].length === 2 && wrapped[1].length === 1);

  // Кусок шире всей строки всё равно попадает в неё: обрезать его нечем, а
  // потерять — тем более.
  let oversized = flowIntoLines([200.0, 10.0], 5.0, 100.0);
  diagnosticTrue("A piece wider than the line still gets a line of its own",
    oversized.length === 2 && oversized[0].length === 1);

  // Главное свойство: ни один кусок не потерян, не задвоен и не переставлен.
  let widths = [30.0, 90.0, 20.0, 60.0, 15.0, 45.0, 80.0];
  let order = [];
  for (const line of flowIntoLines(widths, 8.0, 100.0)) {
    for (const index of line) order.push(index);
  }
  let straight = order.length === widths.length
    && order.every((index, position) => index === position);
  diagnosticTrue("Flowing keeps every piece exactly once and in order", straight);
}

// Выбор компоновки и деление полотна.
function testSketchLayout() {
  let layout = new SketchLayout();
  // Признак принудительной компоновки выставляется явно: проверяется правило
  // выбора по размеру окна, а не разбор адреса. Иначе открытие страницы как
  // ?self-test&layout=compact роняло бы этот тест.
  layout.forcedMode = "";

  layout.update(1280.0, 720.0);
  diagnosticTrue("A wide window uses the desktop layout", !layout.compact);
  diagnosticNear("The desktop layout halves the canvas", layout.motorArea.w, 640.0, 0.0001);
  diagnosticNear("The panel starts where the motor ends",
    layout.panelArea.x, layout.motorArea.x + layout.motorArea.w, 0.0001);
  diagnosticNear("The desktop layout covers the canvas to the right edge",
    layout.panelArea.x + layout.panelArea.w, 1280.0, 0.0001);

  layout.update(390.0, 844.0);
  diagnosticTrue("A portrait window uses the compact layout", layout.compact);
  diagnosticTrue("The compact layout gives the whole canvas to both",
    layout.motorArea.w === 390.0 && layout.motorArea.h === 844.0
    && layout.panelArea.w === 390.0 && layout.panelArea.h === 844.0);

  // Окно шире своей высоты, но у́же 820 px: машина с панелью рядом не встанут.
  layout.update(800.0, 600.0);
  diagnosticTrue("A window narrower than 820 px stays compact", layout.compact);
  layout.update(1000.0, 600.0);
  diagnosticTrue("A wide short window goes back to the desktop layout", !layout.compact);
}

// Нижняя карточка: вид её рисует, панель раскладывает в неё свои кнопки, и
// размеры обе стороны берут из одних и тех же функций. Если они разойдутся,
// кнопки уедут с карточки — поэтому проверяется именно их согласованность.
function testDockGeometry() {
  let area = new Area();
  area.set(0.0, 0.0, 390.0, 844.0);
  let scale = 1.0;
  let dock = motorViewDockBounds(area, scale, true);

  diagnosticNear("The dock is its readout plus its toolbar",
    dock.readoutHeight + dock.toolbarHeight, dock.h, 0.0001);
  diagnosticNear("The toolbar starts where the readout ends",
    dock.toolbarY, dock.y + dock.readoutHeight, 0.0001);
  diagnosticNear("The dock keeps its margin from the bottom edge",
    area.y + area.h - (dock.y + dock.h), MOTOR_READOUT_BOTTOM_MARGIN * scale, 0.0001);
  diagnosticTrue("The dock stays inside the area",
    dock.x >= area.x && dock.x + dock.w <= area.x + area.w && dock.y >= area.y);

  // В широкой компоновке полосы действий нет вовсе: её кнопки стоят внизу панели.
  let desktopDock = motorViewDockBounds(area, scale, false);
  diagnosticNear("The desktop dock has no toolbar", desktopDock.toolbarHeight, 0.0, 0.0001);

  // Подвал — это всё занятое внизу: легенда, зазор, карточка и отступ от края.
  // По нему вид считает, сколько места осталось машине.
  diagnosticTrue("The footer leaves room for the whole dock",
    motorViewFooterHeight(scale, true) >= dock.h + MOTOR_READOUT_BOTTOM_MARGIN * scale);
  diagnosticTrue("The compact footer is the taller of the two",
    motorViewFooterHeight(scale, true) > motorViewFooterHeight(scale, false));
}

// Ползунок: попадание, перевод координаты в значение и захват.
function testSliderMapping() {
  let slider = new SliderControl("тест", "", -10.0, 10.0, 0.0);
  slider.setBounds(100.0, 200.0, 200.0, 40.0, 1.0);

  diagnosticTrue("A press below the slider is ignored",
    !slider.press(200.0, 300.0) && !slider.dragging);
  diagnosticTrue("A press inside the slider captures it",
    slider.press(200.0, 210.0) && slider.dragging);
  diagnosticNear("The press puts the value under the pointer", slider.value, 0.0, 0.0001);

  diagnosticTrue("Dragging keeps the capture", slider.drag(300.0));
  diagnosticNear("Dragging to the right edge gives the maximum", slider.value, 10.0, 0.0001);
  // Палец легко уходит далеко за край — значение при этом упирается в предел, а
  // захват не теряется.
  slider.drag(-500.0);
  diagnosticNear("Dragging past the left edge clamps to the minimum", slider.value, -10.0, 0.0001);

  slider.release();
  diagnosticTrue("Releasing drops the capture", !slider.dragging && !slider.drag(150.0));

  // Спрятанный ползунок не ловит нажатий: его убрала из раскладки смена режима,
  // и на его месте нарисовано уже другое.
  slider.visible = false;
  diagnosticTrue("A hidden slider ignores presses", !slider.press(200.0, 210.0));

  // Знак у задания скорости печатается всегда, кроме нуля: «−0» выглядит как
  // ошибка.
  let signed = new SliderControl("знак", "", -1000.0, 1000.0, 0.0);
  signed.showPositiveSign = true;
  diagnosticTrue("A signed slider prints the plus", signed.formatValue(120.0) === "+120");
  diagnosticTrue("A signed slider prints the minus", signed.formatValue(-120.0) === "−120");
  diagnosticTrue("A signed slider prints zero without a sign", signed.formatValue(0.0) === "0");
}

// Строка кнопок: каждая отвечает своим индексом, промежуток между ними — ничей.
function testButtonRowHitTest() {
  let row = new ButtonRowControl(["один", "два", "три"]);
  row.setBounds(0.0, 0.0, 100.0, 30.0, 5.0, 1.0);

  diagnosticNear("The button row fills its width",
    row.buttonX(2) + row.buttonWidth(), 100.0, 0.0001);
  let centresAnswer = true;
  for (let i = 0; i < 3; i++) {
    if (row.press(row.buttonX(i) + row.buttonWidth() * 0.5, 15.0) !== i) centresAnswer = false;
  }
  diagnosticTrue("Every button answers at its own centre", centresAnswer);
  diagnosticTrue("The gap between buttons belongs to no button",
    row.press(row.buttonX(1) - 2.5, 15.0) === -1);
  diagnosticTrue("A press above the row is ignored", row.press(50.0, -1.0) === -1);

  row.visible = false;
  diagnosticTrue("A hidden button row ignores presses", row.press(50.0, 15.0) === -1);
}

// Полоса действий: сегменты без промежутков, поэтому попадание считается
// делением, а не перебором, и крайний пиксель справа должен остаться за
// последним сегментом.
function testToolbarHitTest() {
  let toolbar = new ToolbarControl([
    { icon: ICON_SUN, label: "Тема" },
    { icon: ICON_PAUSE, label: "Пауза" },
    { icon: ICON_RESET, label: "Сброс" },
    { icon: ICON_SETTINGS, label: "Настройки" },
  ]);
  toolbar.setBounds(0.0, 100.0, 400.0, 50.0, 1.0);
  toolbar.visible = true;

  let segmentsAnswer = true;
  for (let i = 0; i < 4; i++) {
    if (toolbar.press(toolbar.segmentX(i) + toolbar.segmentWidth() * 0.5, 125.0) !== i) {
      segmentsAnswer = false;
    }
  }
  diagnosticTrue("Every toolbar segment answers at its own centre", segmentsAnswer);
  diagnosticTrue("The right edge belongs to the last segment",
    toolbar.press(400.0, 125.0) === TOOLBAR_SETTINGS);
  diagnosticTrue("A press below the toolbar is ignored", toolbar.press(200.0, 200.0) === -1);

  toolbar.visible = false;
  diagnosticTrue("A hidden toolbar ignores presses", toolbar.press(200.0, 125.0) === -1);
}

// Перевод точки полотна в ручное задание: длина — в величину, угол — в фазу.
// Это единственное место, где человек задаёт вектор мышью, и ошибка здесь
// означала бы, что задаётся не то, что видно.
function testManualVectorMapping() {
  let testParameters = new MotorParameters();
  let testSettings = new ControlSettings(testParameters);
  let testView = new MotorView(testParameters, testSettings);
  let area = new Area();
  area.set(0.0, 0.0, 640.0, 720.0);
  // Широкая компоновка: её геометрия считается из одного размера области и не
  // требует измерять текст.
  testView.updateGeometry(area, false);
  testSettings.mode = MODE_MANUAL;
  testSettings.manualVectorType = MANUAL_VECTOR_CURRENT;

  // Регуляторам здесь делать нечего: проверяется перевод координат, и принять
  // его хватит объекта с двумя методами.
  let received = { alpha: 0.0, beta: 0.0 };
  let stubController = {
    setManualCurrent: (alpha, beta) => { received.alpha = alpha; received.beta = beta; },
    setManualVoltage: (alpha, beta) => { received.alpha = alpha; received.beta = beta; },
  };
  let reach = testView.manualVectorMaximumLength();

  testView.updateManualVector(testView.centerX, testView.centerY, stubController);
  diagnosticNear("The centre of the stator gives a zero reference",
    sqrt(received.alpha * received.alpha + received.beta * received.beta), 0.0, 0.0001);

  // Вверх по экрану — это плюс по оси β: ось y полотна направлена вниз.
  testView.updateManualVector(testView.centerX, testView.centerY - reach, stubController);
  diagnosticNear("Dragging up gives the full beta current",
    received.beta, testParameters.maximumCurrent, 0.001);
  diagnosticNear("Dragging up gives no alpha current", received.alpha, 0.0, 0.001);

  // За границей области задание упирается в предел, но направление сохраняет.
  testView.updateManualVector(testView.centerX + reach * 5.0, testView.centerY, stubController);
  diagnosticNear("Beyond the drag region the reference is clamped to the maximum",
    received.alpha, testParameters.maximumCurrent, 0.001);
  diagnosticNear("Clamping keeps the direction", received.beta, 0.0, 0.001);

  // При зафиксированных осях d–q картинка повёрнута, и та же точка полотна
  // означает уже другой физический угол — повёрнутый на тот же viewRotation.
  testView.viewRotation = HALF_PI;
  testView.updateManualVector(testView.centerX + reach, testView.centerY, stubController);
  diagnosticNear("A locked frame rotates the reference onto beta",
    received.beta, testParameters.maximumCurrent, 0.001);
  diagnosticNear("A locked frame rotates the reference off alpha", received.alpha, 0.0, 0.001);
  testView.viewRotation = 0.0;
}

// Система наблюдения: фиксация осей d–q поворачивает картинку, а снятие
// фиксации возвращает её в неподвижное положение плавно и до конца.
function testReferenceFrameLock() {
  let testParameters = new MotorParameters();
  let testSettings = new ControlSettings(testParameters);
  let testMotor = new PMSMModel(testParameters);
  let testView = new MotorView(testParameters, testSettings);

  // Пока фиксации нет, картинка стоит неподвижно, как бы ни повернулся ротор.
  testMotor.state.mechanicalAngle = 1.0;
  testView.updateReferenceFrame(testMotor.state);
  diagnosticNear("An unlocked frame does not rotate", testView.viewRotation, 0.0, 0.0001);

  // Фиксация запоминает положение ротора, и дальше картинка доворачивается
  // ровно на то, что ротор прошёл с этого момента.
  testSettings.lockDqFrame = true;
  testView.updateReferenceFrame(testMotor.state);
  diagnosticNear("Locking starts from no rotation", testView.viewRotation, 0.0, 0.0001);
  testMotor.state.mechanicalAngle = 1.4;
  testView.updateReferenceFrame(testMotor.state);
  diagnosticNear("A locked frame follows the rotor", testView.viewRotation, 0.4, 0.0001);

  // Снятие фиксации возвращает картинку не рывком: первый же кадр сокращает
  // остаток, но не обнуляет его.
  testSettings.lockDqFrame = false;
  testView.updateReferenceFrame(testMotor.state);
  diagnosticTrue("Unlocking starts returning to the stationary frame",
    abs(testView.viewRotation) < 0.4 && abs(testView.viewRotation) > 0.0);

  // И обязательно доходит до нуля за конечное число кадров, а не ползёт к нему
  // вечно: возврат экспоненциальный, и у него есть порог остановки.
  let frames = 0;
  while (testView.viewRotation !== 0.0 && frames < 400) {
    testView.updateReferenceFrame(testMotor.state);
    frames++;
  }
  diagnosticTrue("The return to the stationary frame finishes (" + frames + " frames)",
    testView.viewRotation === 0.0 && frames < 400);
}

// Проверки, на которых держатся все тесты: «примерно равно», «признак верен» и
// «не больше». Числовые печатают и значение — по журналу видно не только то,
// что проверка не прошла, но и насколько.
function diagnosticNear(name, actual, expected, tolerance) {
  if (abs(actual - expected) <= tolerance) {
    console.log("PASS: " + name + " (" + actual + ")");
  } else {
    diagnosticFailures++;
    console.log("FAIL: " + name + ", expected " + expected + " ± " + tolerance
      + ", actual " + actual);
  }
}

// Проверка признака: то же самое для того, что не измеряется числом, —
// попало ли нажатие в кнопку, выбрана ли нужная компоновка.
function diagnosticTrue(name, condition) {
  if (condition) {
    console.log("PASS: " + name);
  } else {
    diagnosticFailures++;
    console.log("FAIL: " + name);
  }
}

function diagnosticLessThan(name, actual, limit) {
  if (actual <= limit) {
    console.log("PASS: " + name + " (" + actual + ")");
  } else {
    diagnosticFailures++;
    console.log("FAIL: " + name + ", expected <= " + limit + ", actual " + actual);
  }
}

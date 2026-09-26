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
// устройству программы, и в конце — компоновка, состав панели и картинка.
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
  testMotorParameterControls();
  testDemoProfiles();
  testThemePalettes();
  testStatorWinding();
  testLayoutMode();
  testModeDescriptions();
  testPanelControlDescriptions();
  testControlVisibilityRules();
  testManualVectorMapping();
  testVoltageDisplayScale();
  testReferenceFrameLock();
  testVersionStamp();
  testVersionParsing();

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

// Паспорт машины, который меняет карточка «Параметры двигателя». Проверяется
// то, ради чего её и добавили: что изменённое ползунком значение действительно
// попадает в уравнения. Ползунок пишет прямо в поле паспорта, и проверить это
// можно только по поведению модели — переписанное поле, которое никто не
// читает, выглядело бы ровно так же.
//
// Обмотка проверяется против аналитического решения. При неподвижном роторе и
// постоянном напряжении по оси d ток по оси q остаётся нулевым, а значит,
// нулевыми остаются и момент, и скорость: уравнение по оси d вырождается в
// обычную RL-цепь, у которой id(t) = (U/R)·(1 − e^{−t·R/L}). Значит, и R, и L
// проверяются точно, а не «стало больше — стало меньше».
function testMotorParameterControls() {
  // Одна индуктивность на обе оси: машина неявнополюсная, и ползунок в панели
  // один. Если оси разойдутся, в формуле момента оживёт реактивное слагаемое.
  let testParameters = new MotorParameters();
  testParameters.statorInductance = 0.011;
  diagnosticNear("The inductance slider reaches Ld", testParameters.inductanceD, 0.011, 1e-12);
  diagnosticNear("The inductance slider reaches Lq", testParameters.inductanceQ, 0.011, 1e-12);

  // Два набора: паспортный и вчетверо более «медленная» обмотка втрое большего
  // сопротивления. Оба идут к своему установившемуся току U/R по своей
  // постоянной времени L/R.
  for (const winding of [{ resistance: 1.2, inductance: 0.006 },
    { resistance: 3.6, inductance: 0.024 }]) {
    let windingParameters = new MotorParameters();
    windingParameters.statorResistance = winding.resistance;
    windingParameters.statorInductance = winding.inductance;
    let windingMotor = new PMSMModel(windingParameters);
    let timeStep = 0.0001;
    let steps = 50;
    for (let step = 0; step < steps; step++) {
      windingMotor.step(6.0, 0.0, 0.0, timeStep);
    }
    let elapsed = steps * timeStep;
    let expected = (6.0 / winding.resistance)
      * (1.0 - Math.exp(-elapsed * winding.resistance / winding.inductance));
    diagnosticNear("The winding of " + winding.resistance + " Ohm and "
      + winding.inductance * 1000.0 + " mH follows its own time constant",
      windingMotor.state.currentD, expected, 0.002);
    diagnosticNear("A current along d leaves the rotor standing",
      windingMotor.state.mechanicalSpeed, 0.0, 1e-12);
  }

  // Момент инерции: та же машина под тем же напряжением, но вдвое тяжелее,
  // разгоняется вдвое медленнее. Ровно половины не получается, и не должно:
  // отстав по скорости, тяжёлая машина наводит меньшую противо-ЭДС, берёт
  // чуть больший ток и развивает чуть больший момент — поэтому чуть больше
  // половины. За 10 мс эта добавка ещё мала.
  let speeds = [0.1, 0.2].map((inertia) => {
    let inertiaParameters = new MotorParameters();
    inertiaParameters.inertia = inertia;
    let inertiaMotor = new PMSMModel(inertiaParameters);
    for (let step = 0; step < 100; step++) {
      inertiaMotor.step(0.0, 6.0, 0.0, 0.0001);
    }
    return inertiaMotor.state.mechanicalSpeed;
  });
  diagnosticTrue("The inertia slider reaches the mechanics", speeds[0] > 0.1);

  // Потокосцепление: при заданном токе iq момент равен 1,5·p·ψf·iq, а при
  // заданной скорости противо-ЭДС равна ψf·ωэ. Обе величины должны следовать
  // за ползунком, а не за паспортным значением.
  for (const flux of [0.5, 2.0]) {
    let fluxParameters = new MotorParameters();
    fluxParameters.magnetFlux = flux;
    let fluxMotor = new PMSMModel(fluxParameters);
    diagnosticNear("The magnet flux of " + flux + " Wb sets the torque constant",
      fluxMotor.electromagneticTorque(0.0, 4.0),
      1.5 * fluxParameters.polePairs * flux * 4.0, 1e-9);
    fluxMotor.state.mechanicalSpeed = 10.0;
    fluxMotor.updateDerivedValues(0.0, 0.0, 0.0);
    let emf = Math.hypot(fluxMotor.state.emfAlpha, fluxMotor.state.emfBeta);
    diagnosticNear("The magnet flux of " + flux + " Wb sets the back EMF",
      emf, flux * fluxParameters.polePairs * 10.0, 1e-9);
  }
  diagnosticNear("Twice the inertia halves the acceleration",
    speeds[1] / speeds[0], 0.51, 0.02);

  // Сброс возвращает паспорт: эти три величины задаются из панели, а значит,
  // кнопка «Сброс» отвечает за них так же, как за коэффициенты регуляторов.
  let resetParameters = new MotorParameters();
  resetParameters.statorResistance = 4.4;
  resetParameters.statorInductance = 0.019;
  resetParameters.magnetFlux = 0.7;
  resetParameters.inertia = 0.47;
  resetParameters.resetTunableParameters();
  diagnosticNear("Reset restores the resistance", resetParameters.statorResistance, 1.2, 1e-12);
  diagnosticNear("Reset restores the inductance",
    resetParameters.statorInductance, 0.006, 1e-12);
  diagnosticNear("Reset restores the magnet flux", resetParameters.magnetFlux, 1.25, 1e-12);
  diagnosticNear("Reset restores the inertia", resetParameters.inertia, 0.1, 1e-12);
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

// Разбор version.js, скачанного с сервера (Updater.js). По ответу решается,
// перезагружать ли страницу, поэтому чужой текст — страница ошибки или
// обрезанный файл — должен давать «версии нет», а не мусорную версию, из-за
// которой страница перезагружалась бы по кругу.
function testVersionParsing() {
  let sample = "// Версия программы\nconst PMSM_VERSION = \"v2026.09.25 08:47\";\n";
  diagnosticTrue("A version file yields its stamp",
    parseVersionStamp(sample) === "v2026.09.25 08:47");
  diagnosticTrue("An error page yields no version",
    parseVersionStamp("<html><body>404</body></html>") === null);
  diagnosticTrue("A truncated file yields no version",
    parseVersionStamp("const PMSM_VERSION = \"v2026.09") === null);
}

// Версию под заголовком пишет git-хук .githooks/pre-commit. Проверяем, что
// файл подключён и строка в нём того вида, который хук и должен оставить:
// испорченный руками или сломанный хуком файл иначе заметили бы только глазами.
function testVersionStamp() {
  diagnosticTrue("The version stamp is loaded", typeof PMSM_VERSION === "string");
  diagnosticTrue("The version stamp reads vYYYY.MM.DD HH:mm",
    /^v\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}$/.test(String(PMSM_VERSION)));
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

// -- интерфейс ---------------------------------------------------------------
//
// Панель управления, показания и надписи теперь разметка, и попадание нажатий,
// перенос строк и высоту шторки считает браузер — проверять тут больше нечего.
// Осталось то, что решает сама программа: какая компоновка нужна окну, какие
// органы управления нужны режиму и с какими настройками они связаны. Плюс то,
// что по-прежнему живёт на полотне: обмотка статора и перевод координат.

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
  // Геометрия обмотки считается по правилу правой руки прямо по пазам, а не
  // той же формулой, что в MotorView: проводник с током «к нам» (+1) даёт в
  // центре поле, повёрнутое от него на −90°. Сумма по пазам фазы — её
  // магнитная ось; у фазы A она обязана совпасть с α, у B и C — стоять на
  // 120° и 240°, иначе картинка обмотки не сходится с вектором тока.
  function slotField(slot, weight) {
    let angle = statorSlotAngle(slot) - Math.PI / 2.0;
    return [weight * Math.cos(angle), weight * Math.sin(angle)];
  }
  function angleDegrees(x, y) {
    return (Math.atan2(y, x) * 180.0 / Math.PI + 360.0) % 360.0;
  }
  function angleError(actual, expected) {
    let difference = Math.abs(actual - expected) % 360.0;
    return Math.min(difference, 360.0 - difference);
  }
  for (let phase = 0; phase < 3; phase++) {
    let sum = [0.0, 0.0];
    for (let slot = 0; slot < STATOR_SLOT_COUNT; slot++) {
      let winding = statorSlotWinding(slot);
      if (winding.phase !== phase) continue;
      let field = slotField(slot, winding.conductorDirection);
      sum[0] += field[0];
      sum[1] += field[1];
    }
    let axis = angleDegrees(sum[0], sum[1]);
    if (angleError(axis, phase * 120.0) > 0.001) {
      failures++;
      console.log("FAIL: the axis of phase " + STATOR_PHASE_NAMES[phase] + " is at "
        + axis.toFixed(2) + "°, expected " + phase * 120 + "°");
    }
  }

  // Значки в пазах показывают мгновенный ток. Поле, которое дают эти токи,
  // обязано смотреть туда же, куда вектор тока: так проверяются сразу
  // геометрия, обратное преобразование Кларк и знаки значков.
  for (const currentAngle of [0.0, 35.0, 90.0, 200.0, 300.0]) {
    let radiansAngle = currentAngle * Math.PI / 180.0;
    let currents = phaseCurrentsFromAlphaBeta(10.0 * Math.cos(radiansAngle),
      10.0 * Math.sin(radiansAngle));
    let sum = [0.0, 0.0];
    for (let slot = 0; slot < STATOR_SLOT_COUNT; slot++) {
      let mark = statorSlotCurrentMark(slot, currents, 25.0);
      let magnitude = Math.abs(currents[statorSlotWinding(slot).phase]);
      let field = slotField(slot, mark.direction * magnitude);
      sum[0] += field[0];
      sum[1] += field[1];
    }
    let fieldAngle = angleDegrees(sum[0], sum[1]);
    if (angleError(fieldAngle, currentAngle) > 0.001) {
      failures++;
      console.log("FAIL: a current at " + currentAngle + "° gives slot marks whose field"
        + " points at " + fieldAngle.toFixed(2) + "°");
    }
  }

  // Отрицательный ток фазы меняет точку и крест местами, а без тока значка
  // нет вовсе.
  let slotAPlus = 1;
  let positive = statorSlotCurrentMark(slotAPlus, [5.0, 0.0, 0.0], 25.0);
  let negative = statorSlotCurrentMark(slotAPlus, [-5.0, 0.0, 0.0], 25.0);
  let none = statorSlotCurrentMark(slotAPlus, [0.0, 0.0, 0.0], 25.0);
  if (positive.direction !== 1 || negative.direction !== -1 || none.direction !== 0
      || !(positive.strength > 0.0) || none.strength !== 0.0) {
    failures++;
    console.log("FAIL: the A+ slot marks do not follow the sign of the phase current");
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

// Выбор компоновки. Решение принимается в одном месте и записывается атрибутом
// data-layout, по которому раскладывает страницу таблица стилей. Правило
// проверяется здесь: два источника — правило в программе и такое же правило в
// CSS — разошлись бы на первой же правке.
function testLayoutMode() {
  diagnosticTrue("A wide window uses the desktop layout",
    resolveLayoutMode(1280.0, 800.0) === LAYOUT_DESKTOP);
  diagnosticTrue("A portrait window uses the compact layout",
    resolveLayoutMode(390.0, 844.0) === LAYOUT_COMPACT);
  // Окно шире своей высоты, но у́же 820 px: машина с панелью рядом не встанут.
  diagnosticTrue("A window narrower than 820 px stays compact",
    resolveLayoutMode(800.0, 600.0) === LAYOUT_COMPACT);
  diagnosticTrue("A wide short window goes back to the desktop layout",
    resolveLayoutMode(1000.0, 600.0) === LAYOUT_DESKTOP);
}

// Описания режимов. Переключатель режима и заголовок карточки с параметрами
// берут подпись, значок и название отсюда по номеру режима, поэтому запись
// обязана стоять на своём месте: перепутанный порядок назвал бы выбранный режим
// чужим именем, а забытый значок дал бы неопределённый ключ вместо разметки —
// и то и другое видно только глазами, уже на открытой странице.
function testModeDescriptions() {
  let failures = 0;
  let expected = [MODE_MANUAL, MODE_OPEN_LOOP, MODE_VECTOR];

  if (MODE_DESCRIPTIONS.length !== expected.length) {
    failures++;
    console.log("FAIL: " + MODE_DESCRIPTIONS.length + " mode descriptions for "
      + expected.length + " modes");
  }
  for (let index = 0; index < expected.length; index++) {
    let description = MODE_DESCRIPTIONS[index];
    if (description === undefined || description.mode !== expected[index]) {
      failures++;
      console.log("FAIL: mode description " + index + " does not describe mode "
        + expected[index]);
      continue;
    }
    if (!description.label || !description.tuning) {
      failures++;
      console.log("FAIL: mode " + expected[index] + " has no label or tuning caption");
    }
    if (TOOLBAR_ICONS[description.icon] === undefined) {
      failures++;
      console.log("FAIL: mode " + expected[index] + " names no such icon "
        + description.icon);
    }
  }

  if (failures > 0) {
    diagnosticFailures += failures;
    return;
  }
  console.log("PASS: " + MODE_DESCRIPTIONS.length + " mode descriptions match the modes");
}

// Описания органов управления. Каждое называет поле, которым орган управляет —
// в настройках интерфейса или в паспорте машины, — и опечатка в имени ничем
// себя не выдаст: панель будет писать в несуществующее поле, а регуляторы —
// читать нетронутое старое. Поэтому имена сверяются с обоими объектами целиком.
function testPanelControlDescriptions() {
  let testParameters = new MotorParameters();
  let testSettings = new ControlSettings(testParameters);
  let sliders = panelSliderDescriptions(testParameters)
    .concat(motorParameterSliderDescriptions());
  let descriptions = sliders
    .concat(PANEL_CHECKBOX_DESCRIPTIONS, VISUALISATION_CHECKBOX_DESCRIPTIONS);
  let failures = 0;
  let claimed = [];

  for (const description of descriptions) {
    let target = controlTarget(description, testSettings, testParameters);
    if (!(description.setting in target)) {
      failures++;
      console.log("FAIL: control " + description.setting + " names no such setting");
    }
    if (claimed.includes(description.setting)) {
      failures++;
      console.log("FAIL: setting " + description.setting + " is claimed by two controls");
    }
    claimed.push(description.setting);
    if (!description.label) {
      failures++;
      console.log("FAIL: control " + description.setting + " has no label");
    }
  }

  // Диапазон ползунка обязан вмещать значение по умолчанию. Иначе первый же
  // проход «настройки → разметка» подтянул бы значение к краю диапазона, и
  // настройка изменилась бы сама, без единого действия человека. Сравнивается
  // показанное значение: пределы ползунка заданы в тех же единицах, что и он.
  for (const slider of sliders) {
    let target = controlTarget(slider, testSettings, testParameters);
    let value = sliderDisplayValue(slider, target[slider.setting]);
    if (value < slider.minimum || value > slider.maximum) {
      failures++;
      console.log("FAIL: the default of " + slider.setting + " (" + value
        + ") is outside its slider range " + slider.minimum + "…" + slider.maximum);
    }
    if (!(slider.step > 0.0)) {
      failures++;
      console.log("FAIL: slider " + slider.setting + " has no usable step");
    }
    // Перевод в единицы ползунка и обратно обязан возвращать то же число:
    // иначе один проход «поле → разметка → поле» сдвигал бы настройку сам.
    let restored = sliderStoredValue(slider, value);
    if (Math.abs(restored - target[slider.setting]) > 1e-9) {
      failures++;
      console.log("FAIL: slider " + slider.setting + " does not survive its own scale ("
        + target[slider.setting] + " → " + value + " → " + restored + ")");
    }
  }

  if (failures > 0) {
    diagnosticFailures += failures;
    return;
  }
  console.log("PASS: " + descriptions.length + " panel controls match the settings");
}

// Какие органы управления нужны текущему режиму. Раньше это решала сама
// раскладка тем, что просто не ставила их на место; теперь правило отделено от
// разметки и проверяется само по себе.
function testControlVisibilityRules() {
  let testParameters = new MotorParameters();
  let testSettings = new ControlSettings(testParameters);
  let byName = {};
  for (const slider of panelSliderDescriptions(testParameters)) {
    byName[slider.setting] = slider;
  }

  testSettings.mode = MODE_MANUAL;
  diagnosticTrue("The load slider is there in every mode",
    controlApplies(byName.loadTorque, testSettings));
  diagnosticTrue("Open-loop controls stay out of the manual mode",
    !controlApplies(byName.openLoopVoltage, testSettings));

  testSettings.mode = MODE_OPEN_LOOP;
  diagnosticTrue("The open-loop mode brings its own controls",
    controlApplies(byName.openLoopFrequency, testSettings));
  diagnosticTrue("Current gains stay out of the open-loop mode",
    !controlApplies(byName.currentKp, testSettings));

  testSettings.mode = MODE_VECTOR;
  testSettings.speedLoopEnabled = false;
  diagnosticTrue("The iq reference is there while the speed loop is off",
    controlApplies(byName.currentQReference, testSettings));
  diagnosticTrue("Speed-loop gains stay hidden while it is off",
    !controlApplies(byName.speedKp, testSettings));

  // Контур скорости сам задаёт iq, и ползунок задания тока в этот момент лишний.
  testSettings.speedLoopEnabled = true;
  diagnosticTrue("Turning the speed loop on replaces the iq reference",
    !controlApplies(byName.currentQReference, testSettings)
    && controlApplies(byName.speedReferenceRpm, testSettings));
  diagnosticTrue("Current gains stay in both cases",
    controlApplies(byName.currentKp, testSettings));
}

// Перевод точки полотна в ручное задание: длина — в величину, угол — в фазу.
// Это единственное место, где человек задаёт вектор мышью, и ошибка здесь
// означала бы, что задаётся не то, что видно.
function testManualVectorMapping() {
  let testParameters = new MotorParameters();
  let testSettings = new ControlSettings(testParameters);
  let testView = new MotorView(testParameters, testSettings);
  // Полотно целиком отдано машине, и прямоугольник ему передаётся обычным
  // объектом — делить его больше не с кем.
  let area = { x: 0.0, y: 0.0, w: 640.0, h: 720.0 };
  testView.updateGeometry(area);
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

// Масштаб векторов u и E. В ручном режиме напряжения вся окружность — это
// ручной предел 15 В, и ЭДС должна рисоваться ровно в том же масштабе, что и
// напряжение: иначе при равных u и E стрелки были бы разной длины. Отрисовку
// перехватываем на drawPhysicalVector — сравниваются предел и длина, с
// которыми векторы в неё попадают.
function testVoltageDisplayScale() {
  let testParameters = new MotorParameters();
  let testSettings = new ControlSettings(testParameters);
  let testView = new MotorView(testParameters, testSettings);
  testView.updateGeometry({ x: 0.0, y: 0.0, w: 640.0, h: 720.0 });
  let drawn = {};
  testView.drawPhysicalVector = (alpha, beta, maximum, maximumLength, vectorColor, label) => {
    drawn[label] = { maximum, maximumLength };
  };
  // В Node нет p5, а цвет векторов собирается её функцией color. Для этой
  // проверки цвет не важен, поэтому на время теста её заменяет заглушка.
  let stubbedColor = typeof color === "undefined";
  if (stubbedColor) globalThis.color = () => null;
  let state = new MotorState();

  testSettings.mode = MODE_MANUAL;
  testSettings.manualVectorType = MANUAL_VECTOR_VOLTAGE;
  testView.drawElectricalVectors(state);
  diagnosticNear("Manual voltage mode draws u on the manual scale",
    drawn.u.maximum, MANUAL_MAXIMUM_VOLTAGE, 1e-12);
  diagnosticNear("Manual voltage mode draws E on the manual scale",
    drawn.E.maximum, MANUAL_MAXIMUM_VOLTAGE, 1e-12);
  diagnosticNear("Manual voltage mode gives u and E the same length per volt",
    drawn.E.maximumLength / drawn.E.maximum, drawn.u.maximumLength / drawn.u.maximum, 1e-12);

  testSettings.mode = MODE_VECTOR;
  testView.drawElectricalVectors(state);
  diagnosticNear("Other modes draw E on the inverter scale",
    drawn.E.maximum, testParameters.maximumVoltage, 1e-12);

  if (stubbedColor) delete globalThis.color;
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

// Точка входа программы: здесь живут функции, которые вызывает сам p5 —
// setup(), draw(), обработчики мыши, клавиатуры и изменения размера окна.
//
// Имя файла совпадает с именем папки скетча: этого требует Processing в режиме
// p5.js, поэтому переименовать его нельзя (см. sketch.properties).
//
// Порядок работы кадра простой и всегда один и тот же:
//
//   1. FixedStepSimulator прокручивает модель на 1 мс модельного времени.
//   2. MotorView рисует машину на полотне.
//   3. MachineStage и ControlPanel переписывают показания в разметке.
//
// Делить полотно больше не с кем: панель управления — это разметка рядом с
// ним, а не колонка на нём, и её ширину задаёт таблица стилей. Полотно целиком
// принадлежит машине, а его размер программа узнаёт у контейнера.
//
// Ни модель, ни регуляторы про p5 ничего не знают; вся связь с браузером
// собрана в этом файле. Глобальные переменные здесь — это стиль самого p5:
// скетч один на страницу, и объекты создаются в setup() ровно по одному.

// Всё хозяйство скетча. Создаётся один раз в setup(); до этого здесь
// undefined, и обработчики событий, которые p5 может вызвать раньше,
// проверяют это явно (см. pointerReleased).
let activeProfile;
let motorParameters;
let controlSettings;
let motor;
let driveController;
let simulator;
let motorView;
let machineStage;
let controlPanel;
let canvasElement;

// Пауза — общий переключатель: её видят и полоса действий, и кнопки панели, и
// показания. diagnosticsMode включается ссылкой ?self-test: тогда полотно не
// создаётся вовсе, а страница показывает итог диагностических тестов.
let simulationPaused = false;
let diagnosticsMode = false;

// Какая компоновка действует сейчас. Значение выставляется атрибутом
// data-layout на корне документа: по нему таблица стилей и решает, колонка
// панель или шторка. Решение принимается здесь и только здесь — иначе CSS и
// программа разошлись бы в том, что считать узким экраном.
let activeLayoutMode = LAYOUT_DESKTOP;

// Полотно целиком отдано машине. Прямоугольник один на всё время работы: его
// размеры переписываются в каждом кадре, а объект переиспользуется.
const motorArea = { x: 0.0, y: 0.0, w: 0.0, h: 0.0 };

// Экраны телефонов сообщают плотность пикселей 3 и выше. Рисовать статор,
// векторы и дуги моментов в буфер такого размера дороже, чем стоит добавочная
// резкость: на кадр и без того приходится десять шагов модели, а держать нужно
// 60 кадров в секунду. Двух пикселей на точку хватает, чтобы линии не рябили.
const MAXIMUM_PIXEL_DENSITY = 2.0;

// p5 вызывает setup() один раз перед первым кадром. Здесь решается три вещи:
// какой профиль показывает страница, нужно ли вместо программы прогнать
// самотестирование, и как устроены разметка и полотно.
function setup() {
  activeProfile = resolveDemoProfile();
  document.title = activeProfile.documentTitle;

  // Те же тесты, что и npm test, но прямо в браузере: полотно не создаётся,
  // цикл кадров останавливается, итог печатается на странице и в консоль.
  if (new URLSearchParams(window.location.search).has("self-test")) {
    diagnosticsMode = true;
    noCanvas();
    const failures = runSimulationDiagnostics();
    showDiagnosticResult(failures);
    noLoop();
    return;
  }

  // Сборка программы. Порядок важен: настройки существуют раньше модели и
  // регуляторов, потому что и те, и другие держат на них ссылку, а профиль
  // применяется до создания регуляторов и панели — они читают режим в своих
  // конструкторах.
  motorParameters = new MotorParameters();
  controlSettings = new ControlSettings(motorParameters);
  applyDemoProfile(activeProfile, controlSettings);
  motor = new PMSMModel(motorParameters);
  driveController = new DriveController(motorParameters, controlSettings);
  simulator = new FixedStepSimulator(motor, driveController, controlSettings);
  motorView = new MotorView(motorParameters, controlSettings);

  // Разметка строится до полотна: размер полотна — это размер того, что от
  // страницы осталось после надписей, показаний и панели, и узнать его можно
  // только когда они уже стоят на своих местах.
  updateLayoutMode();
  buildInterface();

  // В Processing окно скетча задаётся размером, а не растягивается по
  // документу, поэтому там полотно фиксированное; в браузере оно занимает
  // отведённую ему область и меняется вместе с ней.
  const runningInProcessing = typeof window.pde !== "undefined";
  const viewport = viewportSize();
  const canvas = createCanvas(
    runningInProcessing ? 900 : viewport.width,
    runningInProcessing ? 640 : viewport.height,
  );
  const canvasHost = document.getElementById("app");
  if (canvasHost) canvas.parent(canvasHost);
  canvasElement = canvas.elt;
  pixelDensity(min(displayDensity(), MAXIMUM_PIXEL_DENSITY));
  // Частота кадров задана явно: шаг модели привязан к кадру (1 мс на кадр), и
  // от неё зависит, насколько замедленно идёт показ.
  frameRate(60);

  // Долгое нажатие внутри статора — это перетаскивание ручного вектора, а не
  // просьба показать контекстное меню.
  canvasElement.addEventListener("contextmenu", (event) => event.preventDefault());
  // p5 2.x проводит касания через события указателя, поэтому mousePressed и
  // остальные их уже получают и отдельные обработчики касаний не нужны. Но
  // pointercancel скетчу не передаётся: когда система забирает указатель
  // посреди перетаскивания — свайп от края, уведомление, отсечение ладони, —
  // вектор остался бы «залипшим» и продолжил бы следовать за следующим
  // нажатием. Отпускаем его сами.
  window.addEventListener("pointercancel", pointerReleased);
  window.addEventListener("blur", pointerReleased);
  // Одного windowResized мало, чтобы поймать конец поворота телефона: новый
  // размер области просмотра сообщается только после анимации поворота.
  window.addEventListener("orientationchange", () => setTimeout(windowResized, 120));
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", windowResized);
  }
  // Полотно меняет размер не только вместе с окном: в компактной компоновке под
  // ним стоит карточка показаний, и её высота зависит от того, сколько в ней
  // строк. Об изменении своей области полотно узнаёт от наблюдателя, а не
  // догадывается по событиям окна.
  if (window.ResizeObserver && canvasHost) {
    new ResizeObserver(() => windowResized()).observe(canvasHost);
  }
}

// Разметка: надписи и показания вокруг полотна, панель управления рядом с ним.
// Панель получает не глобальные имена, а команды — так она может нажать паузу и
// сброс, не зная ни про simulationPaused, ни про resetSimulation.
function buildInterface() {
  const stage = document.getElementById("stage");
  const canvasHost = document.getElementById("app");
  machineStage = new MachineStage(motorParameters, controlSettings);
  machineStage.build(stage, canvasHost);

  controlPanel = new ControlPanel(motorParameters, controlSettings, driveController,
    activeProfile, {
      togglePause: () => { simulationPaused = !simulationPaused; },
      reset: resetSimulation,
      isPaused: () => simulationPaused,
      motorState: () => motor.state,
      // Угол ротора нужно запомнить в момент самого нажатия, до следующего шага
      // модели: иначе картинка зафиксируется на положении, которого при нажатии
      // ещё не было.
      referenceFrameChanged: () => motorView.updateReferenceFrame(motor.state),
    });
  controlPanel.build(document.body, machineStage.toolbarSlot);
  controlPanel.setLayout(activeLayoutMode);
}

// Кадр: шаг модели, отрисовка машины, обновление показаний в разметке.
function draw() {
  if (diagnosticsMode) return;

  simulator.advanceFrame(simulationPaused);
  // Система наблюдения пересчитывается до отрисовки, но после шага модели:
  // при зафиксированных осях d–q картинка поворачивается вслед за ротором.
  motorView.updateReferenceFrame(motor.state);

  motorArea.w = width;
  motorArea.h = height;
  backgroundTheme(theme().motorBackground);
  motorView.draw(motorArea, motor);

  machineStage.update(motor.state, simulationPaused);
  controlPanel.update(motor.state);
}

// Размер берётся у контейнера полотна, а не у окна: в его высоте уже учтены и
// динамические единицы CSS (100dvh), и место, занятое надписями и показаниями.
// windowWidth/windowHeight остаются запасным вариантом — на случай, если
// разметка вдруг без контейнера.
function viewportSize() {
  const container = document.getElementById("app");
  const containerWidth = container ? container.clientWidth : 0;
  const containerHeight = container ? container.clientHeight : 0;
  return {
    width: containerWidth > 0 ? containerWidth : windowWidth,
    height: containerHeight > 0 ? containerHeight : windowHeight,
  };
}

// Выбор компоновки. Решение записывается атрибутом на корне документа: по нему
// таблица стилей и раскладывает страницу, а панель переставляет свои органы
// управления между колонкой и шторкой.
function updateLayoutMode() {
  const forced = forcedLayoutMode();
  const mode = forced === null
    ? resolveLayoutMode(windowWidth, windowHeight)
    : forced;
  const root = document.documentElement;
  if (root.getAttribute("data-layout") === mode) return;
  activeLayoutMode = mode;
  root.setAttribute("data-layout", mode);
  if (controlPanel) controlPanel.setLayout(mode);
}

// Полотно меняет размер только при настоящем изменении своей области:
// resizeCanvas сбрасывает содержимое, а событие приходит и от прокрутки
// адресной строки на телефоне, когда размер фактически тот же.
function windowResized() {
  if (diagnosticsMode) return;
  updateLayoutMode();
  const viewport = viewportSize();
  if (abs(viewport.width - width) < 1.0 && abs(viewport.height - height) < 1.0) return;
  resizeCanvas(viewport.width, viewport.height);
}

// Нажатие, перетаскивание и отпускание разобраны в трёх функциях, а мышь и
// касание попадают в них одинаково: p5 2.x сводит касания к событиям мыши.
// Панель здесь больше не участвует: она состоит из настоящих элементов, и
// нажатие по ней полотну попросту не принадлежит (см. eventBelongsToCanvas).
function pointerPressed(px, py) {
  motorView.mousePressed(px, py, motorArea, driveController);
}

function pointerDragged(px, py) {
  motorView.mouseDragged(px, py, motorArea, driveController);
}

// Отпускание приходит и от системных событий (pointercancel, потеря фокуса
// окном), которые могут случиться раньше setup(): отсюда проверка вида.
function pointerReleased() {
  if (diagnosticsMode || !motorView) return;
  motorView.mouseReleased();
}

// p5 раздаёт события мыши всему окну, поэтому нажатие по ползунку в панели
// пришло бы и сюда — с координатами, которые вполне могут попасть в
// прямоугольник полотна. Событие принадлежит полотну, только если по нему и
// нажали.
function eventBelongsToCanvas(event) {
  if (!canvasElement) return false;
  return !event || event.target === canvasElement;
}

// Обработчики p5. Возврат false запрещает браузеру поведение по умолчанию —
// без этого перетаскивание внутри полотна превращалось бы в выделение текста
// или в прокрутку страницы. Для событий панели его запрещать нельзя: именно
// поведением по умолчанию она и работает.
function mousePressed(event) {
  if (diagnosticsMode || !eventBelongsToCanvas(event)) return;
  pointerPressed(mouseX, mouseY);
  return false;
}

function mouseDragged(event) {
  if (diagnosticsMode || !eventBelongsToCanvas(event)) return;
  pointerDragged(mouseX, mouseY);
  return false;
}

function mouseReleased() {
  pointerReleased();
}

// Клавиатура: пробел — пауза, R — сброс, T — тема. Русские буквы «к» и «е»
// стоят рядом с латинскими на одних клавишах, поэтому при русской раскладке
// нажатие работает так же, а не молчит.
//
// Но только пока фокус не стоит на органе управления: там пробел нажимает
// кнопку, а стрелки двигают ползунок, и перехватывать их у панели нельзя.
function keyPressed(event) {
  if (diagnosticsMode) return;
  const target = event ? event.target : null;
  if (target && target !== document.body && target !== canvasElement) return;

  if (key === " ") {
    simulationPaused = !simulationPaused;
  } else if (key === "r" || key === "R" || key === "к" || key === "К") {
    resetSimulation();
  } else if (key === "t" || key === "T" || key === "е" || key === "Е") {
    toggleTheme();
  } else {
    return;
  }
  controlPanel.syncFromSettings();
  return false;
}

// Сброс по клавише R, кнопке «Сброс» или сегменту полосы действий. Выбранный
// режим и тип ручного вектора сохраняются, тема — тоже: она живёт в
// localStorage и к параметрам модели не относится.
function resetSimulation() {
  motorView.mouseReleased();
  controlSettings.resetGuiParametersPreservingMode();
  motor.reset();
  driveController.reset();
  simulator.resetClock();
  motorView.resetReferenceFrame();
  controlPanel.syncFromSettings();
}

// Итог самотестирования на странице ?self-test. Подробности печатаются в
// консоль, здесь — одна строка: прошло или сколько ошибок. Цвета карточки
// берутся из палитры через CSS-переменные (см. Theme.js и style.css).
function showDiagnosticResult(failures) {
  document.body.classList.add("diagnostics-page");
  const output = document.createElement("main");
  output.className = failures === 0 ? "diagnostics diagnostics--pass" : "diagnostics diagnostics--fail";
  output.textContent = failures === 0
    ? "Все диагностические тесты PMSM пройдены."
    : `Диагностические тесты PMSM: ошибок — ${failures}. Подробности в консоли.`;
  document.body.append(output);
}

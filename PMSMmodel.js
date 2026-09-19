// Точка входа программы: здесь живут функции, которые вызывает сам p5 —
// setup(), draw(), обработчики мыши, клавиатуры и изменения размера окна.
//
// Имя файла совпадает с именем папки скетча: этого требует Processing в режиме
// p5.js, поэтому переименовать его нельзя (см. sketch.properties).
//
// Порядок работы кадра простой и всегда один и тот же:
//
//   1. SketchLayout решает, какая компоновка нужна под текущий размер окна, и
//      делит полотно между машиной и панелью.
//   2. FixedStepSimulator прокручивает модель на 1 мс модельного времени.
//   3. MotorView рисует машину, векторы и показания, ControlPanel — панель.
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
let sketchLayout;
let motorView;
let controlPanel;

// Пауза — общий переключатель: её видят и полоса действий, и кнопка в панели,
// и показания. diagnosticsMode включается ссылкой ?self-test: тогда полотно не
// создаётся вовсе, а страница показывает итог диагностических тестов.
let simulationPaused = false;
let diagnosticsMode = false;

// Экраны телефонов сообщают плотность пикселей 3 и выше. Рисовать статор,
// векторы и дуги моментов в буфер такого размера дороже, чем стоит добавочная
// резкость: на кадр и без того приходится десять шагов модели, а держать нужно
// 60 кадров в секунду. Двух пикселей на точку хватает, чтобы линии не рябили.
const MAXIMUM_PIXEL_DENSITY = 2.0;

// p5 вызывает setup() один раз перед первым кадром. Здесь решается три вещи:
// какой профиль показывает страница, нужно ли вместо программы прогнать
// самотестирование, и как устроено полотно.
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

  // В Processing окно скетча задаётся размером, а не растягивается по
  // документу, поэтому там полотно фиксированное; в браузере оно занимает
  // всю область просмотра и меняется вместе с ней.
  const runningInProcessing = typeof window.pde !== "undefined";
  const viewport = viewportSize();
  const canvas = createCanvas(
    runningInProcessing ? 1280 : viewport.width,
    runningInProcessing ? 720 : viewport.height,
  );
  const browserContainer = document.getElementById("app");
  if (browserContainer) canvas.parent(browserContainer);
  pixelDensity(min(displayDensity(), MAXIMUM_PIXEL_DENSITY));
  // Частота кадров задана явно: шаг модели привязан к кадру (1 мс на кадр), и
  // от неё зависит, насколько замедленно идёт показ.
  frameRate(60);

  // Долгое нажатие внутри статора — это перетаскивание ручного вектора, а не
  // просьба показать контекстное меню.
  if (canvas.elt) {
    canvas.elt.addEventListener("contextmenu", (event) => event.preventDefault());
  }
  // p5 2.x проводит касания через события указателя, поэтому mousePressed и
  // остальные их уже получают и отдельные обработчики касаний не нужны. Но
  // pointercancel скетчу не передаётся: когда система забирает указатель
  // посреди перетаскивания — свайп от края, уведомление, отсечение ладони, —
  // виджет остался бы «залипшим» и продолжил бы следовать за следующим
  // нажатием. Отпускаем его сами.
  window.addEventListener("pointercancel", pointerReleased);
  window.addEventListener("blur", pointerReleased);
  // Одного windowResized мало, чтобы поймать конец поворота телефона: новый
  // размер области просмотра сообщается только после анимации поворота.
  window.addEventListener("orientationchange", () => setTimeout(windowResized, 120));
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", windowResized);
  }

  // Сборка программы. Порядок важен: настройки существуют раньше модели и
  // регуляторов, потому что и те, и другие держат на них ссылку, а профиль
  // применяется до создания регуляторов и панели — они читают режим в своих
  // конструкторах.
  motorParameters = new MotorParameters();
  controlSettings = new ControlSettings(motorParameters);
  // Режим выставляется до регуляторов и до панели: и те, и та читают его при
  // создании.
  applyDemoProfile(activeProfile, controlSettings);
  motor = new PMSMModel(motorParameters);
  driveController = new DriveController(motorParameters, controlSettings);
  simulator = new FixedStepSimulator(motor, driveController, controlSettings);
  sketchLayout = new SketchLayout();
  motorView = new MotorView(motorParameters, controlSettings);
  controlPanel = new ControlPanel(motorParameters, controlSettings, driveController,
    activeProfile);
}

// Кадр: пересчёт компоновки, шаг модели, отрисовка. p5 вызывает draw()
// столько раз в секунду, сколько задано в frameRate.
function draw() {
  if (diagnosticsMode) return;

  sketchLayout.update(width, height);
  simulator.advanceFrame(simulationPaused);
  // Система наблюдения пересчитывается до отрисовки, но после шага модели:
  // при зафиксированных осях d–q картинка поворачивается вслед за ротором.
  motorView.updateReferenceFrame(motor.state);

  backgroundTheme(theme().appBackground);
  motorView.draw(sketchLayout.motorArea, motor, driveController, simulator, sketchLayout.compact);
  controlPanel.draw(sketchLayout.panelArea, motor, simulator, sketchLayout.compact);
}

// Размер берётся у контейнера, а не у окна: в его высоте уже учтены
// динамические единицы CSS (100dvh), поэтому он не дёргается, пока на телефоне
// сворачивается адресная строка. windowWidth/windowHeight остаются запасным
// вариантом — на случай, если разметка вдруг без контейнера.
function viewportSize() {
  const container = document.getElementById("app");
  const containerWidth = container ? container.clientWidth : 0;
  const containerHeight = container ? container.clientHeight : 0;
  return {
    width: containerWidth > 0 ? containerWidth : windowWidth,
    height: containerHeight > 0 ? containerHeight : windowHeight,
  };
}

// Полотно меняет размер только при настоящем изменении области просмотра:
// resizeCanvas сбрасывает содержимое, а на телефоне это событие приходит и
// от прокрутки адресной строки, когда размер фактически тот же.
function windowResized() {
  if (diagnosticsMode) return;
  const viewport = viewportSize();
  if (abs(viewport.width - width) < 1.0 && abs(viewport.height - height) < 1.0) return;
  resizeCanvas(viewport.width, viewport.height);
}

// Нажатие, перетаскивание и отпускание разобраны в трёх функциях, а мышь и
// касание попадают в них одинаково: p5 2.x сводит касания к событиям мыши.
// Панель получает право на событие первой — она нарисована поверх машины, и в
// компактной компоновке её шторка закрывает статор.
function pointerPressed(px, py) {
  if (controlPanel.mousePressed(px, py)) return;
  motorView.mousePressed(px, py, sketchLayout.motorArea, driveController, sketchLayout.compact);
}

function pointerDragged(px, py) {
  if (controlPanel.mouseDragged(px, py)) return;
  motorView.mouseDragged(px, py, sketchLayout.motorArea, driveController, sketchLayout.compact);
}

// Отпускание приходит и от системных событий (pointercancel, потеря фокуса
// окном), которые могут случиться раньше setup(): отсюда проверка панели.
function pointerReleased() {
  if (diagnosticsMode || !controlPanel) return;
  controlPanel.mouseReleased();
  motorView.mouseReleased();
}

// Обработчики p5. Возврат false запрещает браузеру поведение по умолчанию —
// без этого перетаскивание внутри полотна превращалось бы в выделение текста
// или в прокрутку страницы.
function mousePressed() {
  if (diagnosticsMode) return false;
  pointerPressed(mouseX, mouseY);
  return false;
}

function mouseDragged() {
  if (diagnosticsMode) return false;
  pointerDragged(mouseX, mouseY);
  return false;
}

function mouseReleased() {
  pointerReleased();
  return false;
}

// Клавиатура: пробел — пауза, R — сброс, T — тема. Русские буквы «к» и «е»
// стоят рядом с латинскими на одних клавишах, поэтому при русской раскладке
// нажатие работает так же, а не молчит.
function keyPressed() {
  if (key === " ") {
    simulationPaused = !simulationPaused;
  } else if (key === "r" || key === "R" || key === "к" || key === "К") {
    resetSimulation();
  } else if (key === "t" || key === "T" || key === "е" || key === "Е") {
    toggleTheme();
    // Страница самотестирования обходится без панели, а тему меняет так же.
    if (controlPanel) controlPanel.syncWidgetsFromSettings();
  }
}

// Сброс по клавише R, кнопке «Сброс» или сегменту полосы действий.
// Отпустить виджеты нужно первым делом: иначе ползунок, который держат
// пальцем, тут же вернул бы своё значение в настройки. Выбранный режим и тип
// ручного вектора сохраняются, тема — тоже: она живёт в localStorage и к
// параметрам модели не относится.
function resetSimulation() {
  controlPanel.mouseReleased();
  motorView.mouseReleased();
  controlSettings.resetGuiParametersPreservingMode();
  controlPanel.syncWidgetsFromSettings();
  motor.reset();
  driveController.reset();
  simulator.resetClock();
  motorView.resetReferenceFrame();
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

// Интерфейс: надписи, показания и панель управления — обычная разметка.
//
// Раньше всё это рисовалось на том же полотне, что и машина: у каждого виджета
// был свой прямоугольник, своя отрисовка и своя проверка попадания, а раскладка
// была цепочкой из «y += 37 · scale». Теперь на полотне остаётся одна машина, а
// всё, что состоит из текста и органов управления, — узлы документа, и за их
// расстановку отвечает таблица стилей.
//
// Что от этого изменилось по существу:
//
//   * попадание нажатия больше не считается — его считает браузер;
//   * перенос строк, подбор кегля и высота шторки достаются от вёрстки;
//   * с клавиатуры работает всё: обход табуляцией, стрелки на ползунках,
//     Home/End, Esc на шторке. У рисованной панели этого не было вовсе;
//   * экранный диктор видит подписи, а не пустое полотно.
//
// Разметку строит этот файл, а не пять index.html: страницы отличаются только
// профилем, и повторять в каждой одну и ту же панель значило бы править их все
// при любом изменении. Поэтому в разметке страницы лежит лишь полотно, а панель
// и надписи создаются здесь — ровно так же, как раньше создавались виджеты.
//
// Устроено это так:
//
//   resolveLayoutMode — какая компоновка нужна текущему окну;
//   MachineStage      — надписи над машиной, легенда и показания под ней;
//   ControlPanel      — органы управления: колонка справа или шторка снизу.
//
// Сами органы управления разложены по карточкам-темам: «Машина» (показания и
// нагрузка), «Режим управления» (выбор режима), «Параметры режима» (то, что
// настраивает выбранный) и «Визуализация». Это не оформление: пока всё шло
// одной лентой одинаковых кнопок, по виду кнопки нельзя было понять, меняет
// она режим работы или параметр внутри него.
//
// Настройки по-прежнему единственный посредник: панель в ControlSettings только
// пишет, модель и регуляторы — только читают. Поэтому ни модель, ни регуляторы,
// ни MotorView о разметке ничего не знают.

// Компактная компоновка включается там, где машина с панелью рядом не встанут:
// окно у́же своей высоты (портретная ориентация) или просто у́же 820 px.
const COMPACT_MAXIMUM_ASPECT = 1.1;
const COMPACT_MAXIMUM_WIDTH = 820.0;
// Насколько нужно потянуть шапку шторки вниз, чтобы шторка закрылась.
const SHEET_DISMISS_DISTANCE = 70.0;

const LAYOUT_COMPACT = "compact";
const LAYOUT_DESKTOP = "desktop";

// Вкладки шторки. В широкой компоновке вкладок нет: там оба раздела видны
// сразу, и признак просто не действует.
const TAB_CONTROL = "control";
const TAB_VISUALISATION = "visualisation";

// Какая компоновка нужна окну такого размера. Отдельной функцией — потому что
// это единственное решение о компоновке во всей программе: таблица стилей его
// не повторяет, а смотрит на атрибут data-layout, который выставляется по
// этому ответу. Два источника истины разошлись бы на первом же правиле.
function resolveLayoutMode(windowWidth, windowHeight) {
  let compact = windowWidth < windowHeight * COMPACT_MAXIMUM_ASPECT
    || windowWidth < COMPACT_MAXIMUM_WIDTH;
  return compact ? LAYOUT_COMPACT : LAYOUT_DESKTOP;
}

// ?layout=compact и ?layout=desktop открывают любую компоновку с любого экрана:
// иначе проверить одну из них со второго устройства попросту нечем. Значение
// читается один раз — адрес по ходу работы не меняется.
function forcedLayoutMode() {
  if (typeof window === "undefined" || !window.location) return null;
  let requested = new URLSearchParams(window.location.search).get("layout");
  return requested === LAYOUT_COMPACT || requested === LAYOUT_DESKTOP ? requested : null;
}

// -- описание органов управления ---------------------------------------------
//
// Ползунки и флажки описаны списками, а не вписаны в раскладку по одному.
// Каждая запись называет поле ControlSettings, которым она управляет, поэтому
// перенос значений в настройки и обратно — это проход по списку, а не два
// рукописных перечисления, которые расходятся при первой же забытой строке.
// Новый ползунок добавляется одной записью здесь и ничем больше.
//
// modes — в каких режимах орган нужен; пустой список означает «во всех».
// speedLoop — нужен ли он только при включённом (true) или только при
// выключенном (false) контуре скорости.
// target — во что орган пишет: «settings» (по умолчанию) — в ControlSettings,
// «parameters» — в паспорт машины MotorParameters.
// scale — во сколько раз показанное значение больше хранимого; нужно одной
// индуктивности, которая хранится в генри, а показывается в миллигенри.

function panelSliderDescriptions(parameters) {
  return [
    { setting: "loadTorque", label: "Момент нагрузки", unit: " Н·м",
      minimum: -parameters.maximumLoadTorque, maximum: parameters.maximumLoadTorque,
      step: 0.5, decimals: 1, modes: [], common: true },
    { setting: "openLoopVoltage", label: "Амплитуда напряжения", unit: " В",
      minimum: 0.0, maximum: parameters.maximumVoltage,
      step: 1.0, decimals: 0, modes: [MODE_OPEN_LOOP] },
    { setting: "openLoopFrequency", label: "Электрическая частота", unit: " Гц",
      minimum: -100.0, maximum: 100.0, step: 0.5, decimals: 1, modes: [MODE_OPEN_LOOP] },
    { setting: "currentQReference", label: "Задание тока iq", unit: " А",
      minimum: -parameters.maximumCurrent, maximum: parameters.maximumCurrent,
      step: 0.1, decimals: 1, modes: [MODE_VECTOR], speedLoop: false },
    { setting: "currentKp", label: "Kp регулятора тока", unit: "",
      minimum: 0.0, maximum: 20.0, step: 0.1, decimals: 1, modes: [MODE_VECTOR] },
    { setting: "currentKi", label: "Ki регулятора тока", unit: "",
      minimum: 0.0, maximum: 3000.0, step: 10.0, decimals: 0, modes: [MODE_VECTOR] },
    { setting: "speedReferenceRpm", label: "Задание скорости", unit: " об/мин",
      minimum: -1000.0, maximum: 1000.0, step: 5.0, decimals: 0, signed: true,
      modes: [MODE_VECTOR], speedLoop: true },
    // Диапазоны обступают настройку для J = 0,1: ниже Kp = 4 переходный процесс
    // заметно перерегулирует, а Ki больше 60 сокращает время установления ценой
    // более высокого первого выброса.
    { setting: "speedKp", label: "Kp регулятора скорости", unit: "",
      minimum: 0.0, maximum: 10.0, step: 0.05, decimals: 2,
      modes: [MODE_VECTOR], speedLoop: true },
    { setting: "speedKi", label: "Ki регулятора скорости", unit: "",
      minimum: 0.0, maximum: 100.0, step: 0.05, decimals: 2,
      modes: [MODE_VECTOR], speedLoop: true },
  ];
}

// Паспорт машины: сопротивление обмотки, её индуктивность, потокосцепление
// магнитов и момент инерции. Эти четыре ползунка пишут не в настройки, а прямо в MotorParameters — объект
// паспорта один на программу, и модель с регуляторами читают его поля на
// каждом шаге, поэтому изменение действует сразу.
//
// Диапазоны выбраны так, чтобы обе постоянные времени менялись на порядок в
// обе стороны от паспортных, а решатель при этом оставался устойчивым: шаг
// модели 100 мкс, и самая быстрая обмотка списка (1 мГн при 5 Ом) даёт
// электрическую постоянную 0,2 мс — вдвое больше шага.
//
// Параметров машины список не спрашивает: пределы здесь не производные от
// паспорта, а сами по себе — это те значения, между которыми паспорт и
// двигают.
function motorParameterSliderDescriptions() {
  return [
    { setting: "statorResistance", label: "Сопротивление обмотки", unit: " Ом",
      minimum: 0.1, maximum: 5.0, step: 0.05, decimals: 2, target: "parameters" },
    // Хранится в генри, показывается в миллигенри: ползунок в генри шёл бы
    // шагом 0,0005 и читался бы как «0,0060 Гн».
    { setting: "statorInductance", label: "Индуктивность обмотки", unit: " мГн",
      minimum: 1.0, maximum: 30.0, step: 0.5, decimals: 1, scale: 1000.0,
      target: "parameters" },
    // Потокосцепление магнитов: моментная постоянная 1,5·p·ψf и противо-ЭДС
    // ψf·ωэ. Нижний предел не нулевой — без магнитов машина не развивала бы
    // момента при id = 0, и векторное управление просто стояло бы.
    { setting: "magnetFlux", label: "Потокосцепление магнитов", unit: " Вб",
      minimum: 0.2, maximum: 2.5, step: 0.05, decimals: 2, target: "parameters" },
    { setting: "inertia", label: "Момент инерции", unit: " кг·м²",
      minimum: 0.01, maximum: 1.0, step: 0.005, decimals: 3, target: "parameters" },
  ];
}

// Объект, которым управляет орган: настройки интерфейса или паспорт машины.
// Одна функция на оба направления переноса — и на запись в обработчике
// события, и на обратный проход в syncFromSettings.
function controlTarget(description, settings, parameters) {
  return description.target === "parameters" ? parameters : settings;
}

// Значение поля в единицах ползунка и обратно. Округление после умножения
// убирает хвост двоичного представления: 0,006 · 1000 — это 6,000000000000001,
// и без округления ползунок переписывался бы каждый кадр.
function sliderDisplayValue(description, stored) {
  let scale = description.scale === undefined ? 1.0 : description.scale;
  return Number((stored * scale).toFixed(6));
}

function sliderStoredValue(description, shown) {
  let scale = description.scale === undefined ? 1.0 : description.scale;
  return shown / scale;
}

// Режимы управления: подпись на сегменте переключателя, значок над ней и
// заголовок карточки с параметрами этого режима. Список идёт в порядке
// MODE_MANUAL, MODE_OPEN_LOOP, MODE_VECTOR — номер режима и есть номер записи,
// поэтому карточка параметров всегда называет тот режим, который выбран.
const MODE_DESCRIPTIONS = [
  { mode: MODE_MANUAL, label: "Ручной", icon: "pointer",
    tuning: "ПАРАМЕТРЫ РУЧНОГО РЕЖИМА" },
  { mode: MODE_OPEN_LOOP, label: "Разомкнутый", icon: "wave",
    tuning: "ПАРАМЕТРЫ РАЗОМКНУТОГО РЕЖИМА" },
  { mode: MODE_VECTOR, label: "Векторный", icon: "vector",
    tuning: "ПАРАМЕТРЫ ВЕКТОРНОГО РЕЖИМА" },
];

// Флажок контура скорости стоит среди органов векторного режима, остальные —
// в разделе «Визуализация», и к модели отношения не имеют.
const PANEL_CHECKBOX_DESCRIPTIONS = [
  { setting: "speedLoopEnabled", label: "Контур скорости", modes: [MODE_VECTOR] },
];

const VISUALISATION_CHECKBOX_DESCRIPTIONS = [
  { setting: "showVoltage", label: "Вектор напряжения" },
  { setting: "showEmf", label: "Вектор ЭДС" },
  { setting: "showAlphaBetaAxes", label: "Оси α–β" },
  { setting: "showDqAxes", label: "Оси d–q" },
  { setting: "showAlphaBetaProjections", label: "Проекции iα, iβ" },
  { setting: "showDqProjections", label: "Проекции id, iq" },
  { setting: "lockDqFrame", label: "Зафиксировать оси d–q" },
];

// Орган управления показывается, если его режим совпадает с выбранным и если
// совпадает требование к контуру скорости.
function controlApplies(description, settings) {
  if (description.modes !== undefined && description.modes.length > 0
      && !description.modes.includes(settings.mode)) {
    return false;
  }
  if (description.speedLoop !== undefined
      && description.speedLoop !== settings.speedLoopEnabled) {
    return false;
  }
  return true;
}

// -- мелкие помощники разметки -----------------------------------------------

function element(tag, className, text) {
  let node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Запись текста только при его изменении: показания обновляются каждый кадр, а
// присваивание textContent — это правка документа, и делать её шестьдесят раз в
// секунду без нужды незачем.
function setText(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

function setHidden(node, hidden) {
  if (node.hidden !== hidden) node.hidden = hidden;
}

// Карточка одной темы панели. Панель разложена на «Машину», «Режим
// управления», «Параметры режима» и «Визуализацию»; каждая тема стоит на своей
// подложке, и по виду органа видно, к чему он относится. Раньше всё это шло
// одной лентой, и кнопка выбора режима выглядела так же, как кнопка выбора
// ручного вектора внутри режима — то есть одинаково выглядели орган, меняющий
// поведение привода, и орган, настраивающий это поведение.
function panelCard(caption, modifier) {
  let card = element("div", "panel__group panel__group--card"
    + (modifier === undefined ? "" : " " + modifier));
  if (caption !== undefined) card.append(element("h3", "panel__section", caption));
  return card;
}

// Свёртываемая карточка: заголовок раскрывает её содержимое. Так сделана одна
// карточка — «Параметры двигателя»: паспорт машины нужен не в каждом показе, и
// развёрнутым он занял бы треть панели. Свёрнутая карточка — это одна строка.
//
// Раскрытие делает сам браузер элементом <details>: с клавиатуры заголовок
// нажимается пробелом и Enter, экранный диктор объявляет его как раскрывающий
// и называет состояние. Своей кнопкой со своим aria-expanded всё это пришлось
// бы писать.
function panelDisclosureCard(caption, modifier) {
  let card = element("details", "panel__group panel__group--card panel__group--folding"
    + (modifier === undefined ? "" : " " + modifier));
  let summary = element("summary", "panel__section panel__summary");
  // Шеврон вставляется разметкой, поэтому подпись кладётся отдельным узлом:
  // текстом её после innerHTML уже не задать.
  summary.innerHTML = iconMarkup("chevron");
  summary.append(element("span", "panel__summary-label", caption));
  card.append(summary);
  return card;
}

// Значки полосы действий и переключателя режима. Раньше они рисовались на
// полотне по точкам, потому что шрифта с такими символами могло не оказаться;
// теперь это встроенный SVG — тот же рисунок, но он масштабируется вместе с
// кеглем и красится currentColor.
const TOOLBAR_ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3'
    + 'M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="M8 5l11 7-11 7z" fill="currentColor" stroke="none"/>',
  reset: '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19 4v4h-4"/>',
  // Шеврон свёртываемой карточки: вниз — свёрнута, вверх (повёрнут стилями) —
  // раскрыта.
  chevron: '<path d="M6 9.5l6 6 6-6"/>',
  settings: '<path d="M3 7h18M3 12h18M3 17h18"/>'
    + '<circle cx="8" cy="7" r="2" fill="currentColor"/>'
    + '<circle cx="15" cy="12" r="2" fill="currentColor"/>'
    + '<circle cx="10" cy="17" r="2" fill="currentColor"/>',
  // Режимы: указатель — задание ведёт мышь или палец, волна — вращающийся
  // вектор заданной частоты, вектор на осях — векторное управление.
  pointer: '<path d="M5 2.5V18l4-3.8 2.6 5.8 2.6-1.1-2.6-5.6h5.9z"/>',
  wave: '<path d="M2.5 12c1.8-6.6 4.2-6.6 6 0s4.2 6.6 6 0"/>'
    + '<path d="M16 12h5m-2.2-2.2L21 12l-2.2 2.2"/>',
  vector: '<path d="M4.5 20V5M4.5 20h15"/><path d="M6.5 18L17 7.5"/>'
    + '<path d="M17 7.5l-4.6.5M17 7.5l-.5 4.6"/>',
};

function iconMarkup(name) {
  return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none"'
    + ' stroke="currentColor" stroke-width="1.8" stroke-linecap="round"'
    + ' stroke-linejoin="round">' + TOOLBAR_ICONS[name] + "</svg>";
}

// -- надписи, легенда и показания --------------------------------------------

// Всё, что окружает машину: заголовок и примечание об обмотке сверху, легенда и
// показания снизу. Раньше это рисовал MotorView и ради переноса примечания по
// словам сам измерял текст, а ради общей с панелью нижней карточки — делил её
// геометрию через motorViewDockBounds. Теперь это разметка: перенос делает
// браузер, а карточка просто содержит полосу действий как дочерний узел.
class MachineStage {
  parameters;
  settings;
  stage;
  title;
  frameName;
  note;
  legend;
  readoutValues = {};
  pausedMark;
  // Сюда панель кладёт свою полосу действий: в компактной компоновке она — часть
  // карточки показаний, а не кнопки поверх машины.
  toolbarSlot;

  constructor(parameters, settings) {
    this.parameters = parameters;
    this.settings = settings;
  }

  // Разметка строится один раз. Полотно уже лежит в документе (#app), надписи
  // встают до него, легенда с показаниями — после.
  build(stage, canvasHost) {
    this.stage = stage;

    let caption = element("header", "stage__caption");
    this.title = element("h1", "stage__title",
      "Синхронная машина с постоянными магнитами");
    this.frameName = element("p", "stage__subtitle");
    this.note = element("p", "stage__note", this.windingNote());
    caption.append(this.title, this.frameName, this.note);
    stage.insertBefore(caption, canvasHost);

    let footer = element("div", "stage__footer");
    this.legend = element("ul", "legend");
    this.legend.setAttribute("aria-label", "Обозначения на картинке");
    footer.append(this.legend, this.buildReadout());
    stage.append(footer);
    this.buildLegend();
  }

  // Примечание об обмотке: потокосцепление магнитов и как читать обозначения
  // сторон катушек.
  windingNote() {
    return "ψf = " + nf(this.parameters.magnetFlux, 1, 2)
      + " Вб; 18 пазов, q = 3;  • — из плоскости, × — в плоскость";
  }

  // Легенда: что означает каждый цвет. Цвета берутся из палитры переменными
  // CSS, поэтому смена темы перекрашивает и её.
  buildLegend() {
    let entries = [
      ["vector-current", "ток i"],
      ["vector-voltage", "напряжение u"],
      ["vector-emf", "ЭДС E"],
      ["torque-motor", "Mдв"],
      ["torque-load", "Mнагр"],
    ];
    for (const [variable, label] of entries) {
      let item = element("li", "legend__item");
      let marker = element("span", "legend__marker");
      marker.style.background = "var(--" + variable + ")";
      item.append(marker, element("span", "legend__label", label));
      this.legend.append(item);
    }
  }

  // Карточка показаний. Шесть величин сеткой: в широкой компоновке три колонки в
  // два ряда, в компактной две в три — это решает таблица стилей, а не расчёт.
  buildReadout() {
    let card = element("div", "readout");
    let grid = element("dl", "readout__grid");
    for (const key of ["speed", "motorTorque", "loadTorque",
      "currentD", "currentQ", "voltage"]) {
      let cell = element("div", "readout__cell");
      let value = element("dd", "readout__value");
      cell.append(element("dt", "readout__name", ""), value);
      this.readoutValues[key] = { name: cell.firstChild, value };
      grid.append(cell);
    }
    // Надпись о паузе нужна только там, где нет полосы действий: в компактной
    // компоновке о паузе говорит подсвеченная кнопка под этими же цифрами.
    this.pausedMark = element("p", "readout__paused", "ПАУЗА");
    this.pausedMark.hidden = true;
    this.toolbarSlot = element("div", "readout__toolbar");
    card.append(this.pausedMark, grid, this.toolbarSlot);
    this.readoutNames();
    return card;
  }

  readoutNames() {
    let names = {
      speed: "n", motorTorque: "Mдв", loadTorque: "Mнагр",
      currentD: "id", currentQ: "iq", voltage: "|u|",
    };
    for (const key of Object.keys(names)) {
      this.readoutValues[key].name.textContent = names[key];
    }
  }

  // Кадр: подпись о системе наблюдения и шесть чисел. Всё остальное в надписях
  // постоянно и переписывания не требует.
  update(state, paused) {
    setText(this.frameName, this.settings.lockDqFrame
      ? "система наблюдения d–q зафиксирована"
      : "неподвижная система α–β");
    setText(this.readoutValues.speed.value,
      formatSignedNumber(rpmFromRadians(state.mechanicalSpeed), 0) + " об/мин");
    setText(this.readoutValues.motorTorque.value,
      nf(state.electromagneticTorque, 1, 2) + " Н·м");
    setText(this.readoutValues.loadTorque.value, nf(state.loadTorque, 1, 2) + " Н·м");
    setText(this.readoutValues.currentD.value, nf(state.currentD, 1, 2) + " А");
    setText(this.readoutValues.currentQ.value, nf(state.currentQ, 1, 2) + " А");
    setText(this.readoutValues.voltage.value,
      nf(sqrt(state.voltageAlpha * state.voltageAlpha
        + state.voltageBeta * state.voltageBeta), 1, 1) + " В");
    // ψf меняется ползунком паспорта, поэтому примечание обновляется вместе
    // с показаниями, а не пишется один раз при построении.
    setText(this.note, this.windingNote());
    setHidden(this.pausedMark, !paused);
  }
}

// -- панель управления -------------------------------------------------------

// Органы управления: в широкой компоновке колонка справа, в компактной — шторка
// снизу. Узлы в обоих случаях одни и те же: меняется контейнер, в который они
// переставляются, и порядок. Поэтому значение ползунка и положение фокуса
// переживают поворот телефона.
//
// Наружу класс зависит только от того, что ему передали: настроек, регуляторов,
// профиля и команд (пауза и сброс). Глобальных имён он не читает — в отличие от
// прежней панели, которая лезла в motor, motorView и simulationPaused мимо
// собственного конструктора.
class ControlPanel {
  parameters;
  settings;
  controller;
  profile;
  commands;

  root;
  content;
  sheet;
  sheetBody;
  column;
  tabs;
  statusCard;
  statusValues = {};
  controlGroup;
  machineCard;
  modeCard;
  tuningCard;
  tuningCaption;
  motorCard;
  visualGroup;
  actions;
  toolbar;
  hint;

  sliders = [];
  checkboxes = [];
  themeCheckbox;
  modeButtons = [];
  manualVectorButtons = [];
  tabButtons = [];
  toolbarButtons = {};
  pauseButton;

  layout = LAYOUT_DESKTOP;
  activeTab = TAB_CONTROL;
  sheetOpen = false;
  sheetDragStartY = null;

  constructor(parameters, settings, controller, profile, commands) {
    this.parameters = parameters;
    this.settings = settings;
    this.controller = controller;
    this.profile = profile === undefined ? demoProfile(PROFILE_FULL) : profile;
    this.commands = commands;
  }

  // -- построение разметки ---------------------------------------------------

  build(host, toolbarSlot) {
    this.root = element("aside", "panel");
    this.root.setAttribute("aria-label", this.profile.panelTitle);
    this.column = element("div", "panel__column");

    this.sheet = element("div", "sheet");
    this.sheet.hidden = true;
    let scrim = element("div", "sheet__scrim");
    scrim.addEventListener("pointerdown", () => this.closeSheet());
    this.sheetBody = element("div", "sheet__body");
    this.sheetBody.setAttribute("role", "dialog");
    this.sheetBody.setAttribute("aria-label", "Настройки");
    this.sheetBody.setAttribute("aria-modal", "false");
    this.sheet.append(scrim, this.sheetBody);

    this.content = element("div", "panel__content");
    this.buildContent();
    this.root.append(this.column, this.sheet);
    host.append(this.root);

    this.buildToolbar(toolbarSlot);
    // Протягивание шапки шторки и Esc — единственное, ради чего панели нужны
    // события окна: всё остальное ей приносят сами органы управления.
    window.addEventListener("pointermove", (event) => this.pointerMoved(event.clientY));
    window.addEventListener("pointerup", () => this.pointerReleased());
    window.addEventListener("pointercancel", () => this.pointerReleased());
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.sheetOpen) this.closeSheet();
    });

    this.applyLayout();
    this.syncFromSettings();
  }

  buildContent() {
    let title = element("h2", "panel__title", this.profile.panelTitle);
    this.tabs = this.buildTabs();
    this.statusCard = this.buildStatusCard();
    // Вкладка «Управление» целиком: карточки «Машина», «Режим управления» и
    // «Параметры режима». Прячется она одна, поэтому карточки лежат в ней, а
    // не в содержимом панели по отдельности.
    this.controlGroup = element("div", "panel__group");
    this.visualGroup = panelCard("ВИЗУАЛИЗАЦИЯ");
    this.actions = this.buildActions();

    this.buildControlGroup();
    this.buildVisualGroup();
    this.content.append(title, this.tabs,
      this.controlGroup, this.visualGroup, this.actions);
    this.panelTitleNode = title;
  }

  // Строка вкладок шторки. В широкой компоновке она скрыта таблицей стилей: там
  // оба раздела видны сразу и выбирать между ними не из чего.
  buildTabs() {
    let tabs = element("div", "tabs");
    tabs.setAttribute("role", "tablist");
    for (const [name, label] of [[TAB_CONTROL, "Управление"],
      [TAB_VISUALISATION, "Визуализация"]]) {
      let button = element("button", "tabs__button", label);
      button.type = "button";
      button.setAttribute("role", "tab");
      button.addEventListener("click", () => {
        this.activeTab = name;
        this.syncFromSettings();
      });
      this.tabButtons.push({ name, button });
      tabs.append(button);
    }
    return tabs;
  }

  // Карточка с тремя главными величинами. В широкой компоновке стоит под
  // ползунком нагрузки, в компактной — в шапке шторки: там собственные показания
  // машины закрыты шторкой, и повторить их рядом с органами управления нужно.
  buildStatusCard() {
    let card = element("div", "status");
    for (const [key, caption] of [["speed", "СКОРОСТЬ"], ["current", "ТОК"],
      ["torque", "МОМЕНТ"]]) {
      let cell = element("div", "status__cell");
      let value = element("p", "status__value", "—");
      cell.append(element("p", "status__caption", caption), value);
      this.statusValues[key] = value;
      card.append(cell);
    }
    return card;
  }

  // Три карточки вкладки «Управление» — по одной на тему. Разделены они не для
  // красоты: до этого выбор режима и настройка выбранного режима стояли подряд
  // одинаковыми голубыми кнопками, и по виду нельзя было понять, что меняет
  // кнопка — сам режим работы или параметр внутри него.
  buildControlGroup() {
    let descriptions = panelSliderDescriptions(this.parameters);

    // «Машина»: показания и момент нагрузки. Нагрузка действует в любом режиме
    // и режимом не управляет, поэтому стоит не среди его органов, а рядом с
    // теми числами, которые она и меняет.
    this.machineCard = panelCard("МАШИНА");
    for (const description of descriptions.filter((item) => item.common)) {
      this.loadSliderRow = this.buildSlider(description);
      this.machineCard.append(this.loadSliderRow);
    }
    this.controlGroup.append(this.machineCard);

    // «Режим управления»: единственный орган, который меняет поведение привода,
    // а не число в нём. И выглядит он иначе — сегментами со значками в
    // тёмно-синей заливке, а не голубыми кнопками остальных органов.
    if (!this.profile.singleMode) {
      this.modeCard = panelCard("РЕЖИМ УПРАВЛЕНИЯ", "panel__group--mode");
      this.modeCard.append(this.buildButtonRow("Режим управления",
        MODE_DESCRIPTIONS.map((item) => item.label), this.modeButtons,
        (index) => {
          this.controller.setMode(index, this.commands.motorState());
          this.syncFromSettings();
        },
        { modifier: "buttons--modes", icons: MODE_DESCRIPTIONS.map((item) => item.icon) }));
      this.controlGroup.append(this.modeCard);
    }

    // «Параметры режима»: всё, что настраивает выбранный режим. Заголовок
    // карточки называет его, а полоса тёмно-синего по левому краю привязывает
    // карточку к переключателю над ней — это его продолжение, а не ещё один
    // равноправный набор кнопок.
    this.tuningCaption = element("h3", "panel__section");
    this.tuningCard = panelCard(undefined, "panel__group--tuning");
    this.tuningCard.append(this.tuningCaption);

    this.manualSection = element("div", "panel__subgroup");
    if (!this.profile.singleManualVector) {
      // Подпись строки — такая же, как у ползунков рядом: это орган настройки
      // режима, а не выбор режима, и выглядеть он должен как его соседи.
      this.manualSection.append(element("p", "buttons__caption", "Ручное задание"));
      this.manualSection.append(this.buildButtonRow("Тип ручного вектора",
        ["Вектор тока", "Вектор напряжения"], this.manualVectorButtons,
        (index) => {
          this.controller.setManualVectorType(index);
          this.syncFromSettings();
        }));
    }
    // Единственный режим, где задание берётся не с ползунка, а мышью по
    // картинке, и без подсказки догадаться об этом нельзя.
    this.hint = element("p", "hint");
    this.manualSection.append(this.hint);
    this.tuningCard.append(this.manualSection);

    for (const description of descriptions.filter((item) => !item.common)) {
      this.tuningCard.append(this.buildSlider(description));
    }
    for (const description of PANEL_CHECKBOX_DESCRIPTIONS) {
      this.tuningCard.append(this.buildCheckbox(description));
    }
    this.controlGroup.append(this.tuningCard);

    // «Параметры двигателя»: паспорт машины. Карточка стоит последней и
    // свёрнута — к показу привода её органы отношения не имеют, менять их
    // нужно редко, а занимают они втрое больше места, чем выбор режима.
    // Внутри — сопротивление и индуктивность обмотки (вместе они задают
    // электрическую постоянную времени), потокосцепление магнитов (моментную
    // постоянную и противо-ЭДС) и момент инерции (механическую).
    this.motorCard = panelDisclosureCard("ПАРАМЕТРЫ ДВИГАТЕЛЯ");
    for (const description of motorParameterSliderDescriptions()) {
      this.motorCard.append(this.buildSlider(description));
    }
    // Коэффициенты контура скорости настроены для паспортного момента
    // инерции и пропорциональны ему (см. ControlSettings): изменив J, их
    // приходится менять следом, и без этой оговорки разъехавшийся переходный
    // процесс выглядел бы ошибкой модели.
    this.motorCard.append(element("p", "hint",
      "Паспорт: 1,20 Ом, 6,0 мГн, 1,25 Вб, 0,100 кг·м². Коэффициенты регуляторов"
      + " настроены под эти значения и при других требуют пересчёта."));
    this.controlGroup.append(this.motorCard);
  }

  buildVisualGroup() {
    let list = element("div", "checkboxes");
    for (const description of VISUALISATION_CHECKBOX_DESCRIPTIONS) {
      list.append(this.buildCheckbox(description, true));
    }
    // Тема живёт не в настройках модели, а в Theme.js, поэтому этот флажок
    // читает её оттуда и сбросом параметров не затрагивается.
    this.themeCheckbox = this.buildPlainCheckbox("Светлая тема", (checked) => {
      setTheme(checked ? THEME_LIGHT : THEME_DARK);
      this.syncFromSettings();
    });
    list.append(this.themeCheckbox.row);
    this.visualGroup.append(list);
  }

  buildActions() {
    let actions = element("div", "actions");
    this.pauseButton = element("button", "button", "Пауза");
    this.pauseButton.type = "button";
    this.pauseButton.addEventListener("click", () => {
      this.commands.togglePause();
      this.syncFromSettings();
    });
    let reset = element("button", "button", "Сброс");
    reset.type = "button";
    reset.addEventListener("click", () => this.commands.reset());
    actions.append(this.pauseButton, reset);
    return actions;
  }

  // Полоса действий компактной компоновки. Она кладётся в карточку показаний,
  // которую построил MachineStage: это часть карточки, а не кнопки поверх
  // машины. В широкой компоновке карточка её прячет — там те же действия стоят
  // кнопками внизу панели.
  buildToolbar(toolbarSlot) {
    this.toolbar = element("div", "toolbar");
    let segments = [
      { name: "theme", label: "Тема", icon: "sun", action: () => {
        toggleTheme();
        this.syncFromSettings();
      } },
      { name: "pause", label: "Пауза", icon: "pause", action: () => {
        this.commands.togglePause();
        this.syncFromSettings();
      } },
      { name: "reset", label: "Сброс", icon: "reset", action: () => this.commands.reset() },
      { name: "settings", label: "Настройки", icon: "settings", action: () => {
        this.sheetOpen ? this.closeSheet() : this.openSheet();
      } },
    ];
    for (const segment of segments) {
      let button = element("button", "toolbar__button");
      button.type = "button";
      button.innerHTML = iconMarkup(segment.icon);
      let label = element("span", "toolbar__label", segment.label);
      button.append(label);
      button.addEventListener("click", segment.action);
      this.toolbarButtons[segment.name] = { button, label };
      this.toolbar.append(button);
    }
    toolbarSlot.append(this.toolbar);
  }

  // -- отдельные органы управления -------------------------------------------

  // Ползунок — это подпись, значение и нативный input[type=range]. Стрелки,
  // Home/End и шаг достаются от браузера; раньше всё это пришлось бы писать.
  buildSlider(description) {
    let row = element("div", "field");
    let input = element("input", "slider");
    input.type = "range";
    input.min = description.minimum;
    input.max = description.maximum;
    input.step = description.step;
    input.id = "slider-" + description.setting;
    let label = element("label", "field__label", description.label);
    label.htmlFor = input.id;
    let value = element("output", "field__value");
    value.htmlFor = input.id;
    row.append(label, value, input);

    let slider = { description, row, input, value };
    input.addEventListener("input", () => {
      // Ползунок работает в показанных единицах, поле хранит свои: у
      // индуктивности это миллигенри против генри, у остальных — одни и те же.
      this.targetOf(description)[description.setting] =
        sliderStoredValue(description, Number(input.value));
      this.updateSliderValue(slider);
      this.syncVisibility();
    });
    this.sliders.push(slider);
    return row;
  }

  updateSliderValue(slider) {
    let number = Number(slider.input.value);
    let span = slider.description.maximum - slider.description.minimum;
    let filled = span > 0.0 ? (number - slider.description.minimum) / span : 0.0;
    slider.input.style.setProperty("--progress", (filled * 100.0).toFixed(2) + "%");
    let text = slider.description.signed
      ? formatSignedNumber(number, slider.description.decimals)
      : nf(number, 1, slider.description.decimals);
    setText(slider.value, text + slider.description.unit);
  }

  buildCheckbox(description, visual) {
    let checkbox = this.buildPlainCheckbox(description.label, (checked) => {
      this.settings[description.setting] = checked;
      // Угол ротора нужно запомнить в момент самого нажатия, до следующего шага
      // модели: иначе картинка зафиксируется на положении, которого при нажатии
      // ещё не было.
      if (description.setting === "lockDqFrame") this.commands.referenceFrameChanged();
      this.syncVisibility();
    });
    this.checkboxes.push({ description, ...checkbox, visual });
    return checkbox.row;
  }

  buildPlainCheckbox(label, onChange) {
    let row = element("label", "check");
    let input = element("input", "check__input");
    input.type = "checkbox";
    row.append(input, element("span", "check__label", label));
    input.addEventListener("change", () => onChange(input.checked));
    return { row, input };
  }

  // Строка кнопок равной ширины, из которых выбрана одна. Размечена как группа
  // переключателей: экранный диктор объявит и её название, и выбранный пункт, а
  // стрелками по ней можно ходить.
  //
  // options.modifier меняет вид строки, options.icons добавляет над подписями
  // значки. И то и другое нужно одному переключателю — выбору режима: он
  // единственный меняет поведение привода, и выглядеть как соседние кнопки
  // настройки ему нельзя.
  buildButtonRow(name, labels, store, onSelect, options = {}) {
    let row = element("div", options.modifier === undefined
      ? "buttons" : "buttons " + options.modifier);
    row.setAttribute("role", "radiogroup");
    row.setAttribute("aria-label", name);
    for (let index = 0; index < labels.length; index++) {
      let button = element("button", "buttons__item");
      button.type = "button";
      button.setAttribute("role", "radio");
      // Значок вставляется разметкой, поэтому подпись кладётся отдельным узлом:
      // текстом её после innerHTML уже не задать.
      if (options.icons !== undefined) button.innerHTML = iconMarkup(options.icons[index]);
      button.append(element("span", "buttons__label", labels[index]));
      button.addEventListener("click", () => onSelect(index));
      store.push(button);
      row.append(button);
    }
    return row;
  }

  // -- компоновка ------------------------------------------------------------

  // Смена компоновки переставляет содержимое между колонкой и шторкой. Узлы при
  // этом те же самые, поэтому значения органов управления и их состояние
  // переживают и поворот телефона, и изменение размера окна.
  setLayout(layout) {
    if (layout === this.layout && this.content.parentNode) return;
    this.layout = layout;
    this.applyLayout();
  }

  applyLayout() {
    if (this.layout === LAYOUT_COMPACT) {
      // В шторке показания стоят в шапке, над вкладками с органами управления:
      // собственные показания машины в этот момент закрыты шторкой, и они
      // должны быть видны на любой вкладке, а карточка «Машина» с ними лежит
      // на вкладке «Управление».
      this.content.insertBefore(this.statusCard, this.tabs);
      this.sheetBody.append(this.sheetHandle(), this.content);
    } else {
      // В колонке — в карточке «Машина», над ползунком нагрузки: показания и
      // то, чем их меняют, стоят рядом и не зависят от выбранного режима.
      this.machineCard.insertBefore(this.statusCard, this.loadSliderRow);
      this.closeSheet();
      this.column.append(this.content);
    }
    this.syncFromSettings();
  }

  sheetHandle() {
    if (!this.handle) {
      this.handle = element("div", "sheet__handle");
      this.handle.addEventListener("pointerdown", (event) => {
        this.sheetDragStartY = event.clientY;
      });
    }
    return this.handle;
  }

  openSheet() {
    this.sheetOpen = true;
    this.sheet.hidden = false;
    this.syncFromSettings();
  }

  closeSheet() {
    this.sheetOpen = false;
    this.sheet.hidden = true;
    this.sheetDragStartY = null;
    this.syncFromSettings();
  }

  // Шторка закрывается движением её верхнего края вниз. Порог тот же, что был у
  // рисованной шторки: случайное движение пальцем её не роняет.
  pointerMoved(y) {
    if (this.sheetDragStartY === null) return;
    if (y - this.sheetDragStartY > SHEET_DISMISS_DISTANCE) this.closeSheet();
  }

  pointerReleased() {
    this.sheetDragStartY = null;
  }

  // -- перенос состояния -----------------------------------------------------

  // Настройки → разметка. Одна функция на оба направления не нужна: значения
  // органов управления попадают в настройки сразу в обработчике события, а
  // обратный проход нужен после сброса, смены режима и переключения клавишей.
  syncFromSettings() {
    for (const slider of this.sliders) {
      let stored = this.targetOf(slider.description)[slider.description.setting];
      let value = String(sliderDisplayValue(slider.description, stored));
      if (slider.input.value !== value) slider.input.value = value;
      this.updateSliderValue(slider);
    }
    for (const checkbox of this.checkboxes) {
      checkbox.input.checked = Boolean(this.settings[checkbox.description.setting]);
    }
    this.themeCheckbox.input.checked = isLightTheme();

    for (let index = 0; index < this.modeButtons.length; index++) {
      this.selectButton(this.modeButtons[index], this.settings.mode === index);
    }
    for (let index = 0; index < this.manualVectorButtons.length; index++) {
      this.selectButton(this.manualVectorButtons[index],
        this.settings.manualVectorType === index);
    }
    for (const tab of this.tabButtons) {
      let active = tab.name === this.activeTab;
      tab.button.setAttribute("aria-selected", String(active));
      tab.button.classList.toggle("is-selected", active);
    }

    let paused = this.commands.isPaused();
    setText(this.pauseButton, paused ? "Продолжить" : "Пауза");
    this.pauseButton.classList.toggle("is-active", paused);
    // Солнце и луна показывают тему, в которую кнопка переведёт, а не текущую.
    this.toolbarButtons.theme.button.innerHTML = iconMarkup(isLightTheme() ? "moon" : "sun");
    this.toolbarButtons.theme.button.append(this.toolbarButtons.theme.label);
    this.toolbarButtons.pause.button.innerHTML = iconMarkup(paused ? "play" : "pause");
    this.toolbarButtons.pause.button.append(this.toolbarButtons.pause.label);
    setText(this.toolbarButtons.pause.label, paused ? "Продолжить" : "Пауза");
    this.toolbarButtons.pause.button.classList.toggle("is-active", paused);
    this.toolbarButtons.settings.button.setAttribute("aria-expanded", String(this.sheetOpen));

    this.syncVisibility();
  }

  // Что из органов управления сейчас нужно. Скрытое именно скрыто, а не просто
  // не нарисовано: браузер не отдаст ему ни нажатие, ни фокус табуляцией.
  syncVisibility() {
    for (const slider of this.sliders) {
      setHidden(slider.row, !controlApplies(slider.description, this.settings));
    }
    for (const checkbox of this.checkboxes) {
      if (checkbox.visual) continue;
      setHidden(checkbox.row, !controlApplies(checkbox.description, this.settings));
    }
    setHidden(this.manualSection, this.settings.mode !== MODE_MANUAL);
    // Карточка параметров называет режим, которому они принадлежат: на странице
    // отдельного режима переключателя над ней нет, и назвать его больше нечему.
    setText(this.tuningCaption, MODE_DESCRIPTIONS[this.settings.mode].tuning);

    let vectorName = this.settings.manualVectorType === MANUAL_VECTOR_CURRENT
      ? "тока — регуляторы поддерживают i*"
      : "напряжения — u* подаётся напрямую";
    // На телефоне статор закрыт шторкой, и указание тянуть внутри статора без
    // такой оговорки бесполезно.
    let opening = this.layout === LAYOUT_COMPACT
      ? "Закройте настройки и тяните внутри статора,"
      : "Нажмите и тяните внутри статора,";
    setText(this.hint, opening + " чтобы задать вектор " + vectorName + ".");

    // Вкладки действуют только в шторке: в широкой компоновке видны оба раздела.
    let tabbed = this.layout === LAYOUT_COMPACT;
    setHidden(this.controlGroup, tabbed && this.activeTab !== TAB_CONTROL);
    setHidden(this.visualGroup, tabbed && this.activeTab !== TAB_VISUALISATION);
  }

  // Куда орган пишет и откуда читается: настройки интерфейса или паспорт
  // машины. Панель держит и то, и другое, и оба объекта общие с моделью.
  targetOf(description) {
    return controlTarget(description, this.settings, this.parameters);
  }

  selectButton(button, selected) {
    button.setAttribute("aria-checked", String(selected));
    button.classList.toggle("is-selected", selected);
  }

  // Кадр: три величины в карточке показаний. Остальное меняется не каждый кадр,
  // а по действию, и переписывается в syncFromSettings.
  update(state) {
    setText(this.statusValues.speed,
      formatPanelSpeed(rpmFromRadians(state.mechanicalSpeed)) + " об/мин");
    setText(this.statusValues.current,
      nf(sqrt(state.currentAlpha * state.currentAlpha
        + state.currentBeta * state.currentBeta), 1, 1) + " А");
    setText(this.statusValues.torque, nf(state.electromagneticTorque, 1, 2) + " Н·м");
  }
}

// Скорость со знаком, но без «−0»: у нуля знака нет.
function formatPanelSpeed(rpm) {
  let roundedMagnitude = round(abs(rpm));
  if (roundedMagnitude == 0) return "0";
  return (rpm > 0.0 ? "+" : "−") + str(roundedMagnitude);
}

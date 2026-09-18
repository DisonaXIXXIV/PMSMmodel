// Единственное место, где в программе записаны цвета. Всё остальное — виджеты,
// вид машины, диагностическая страница и сам HTML — берёт их отсюда, поэтому
// новая тема добавляется одной палитрой и ничего больше править не нужно.
//
// Запись цвета — массив [r, g, b] или [r, g, b, a]; альфа по умолчанию 255.
// Рисующий код обращается к ним через fillTheme / strokeTheme / themeColor,
// которые умеют подменять альфу, когда та зависит от скорости или от режима.

const THEME_DARK = "dark";
const THEME_LIGHT = "light";
const THEME_STORAGE_KEY = "pmsm.theme";

const DARK_PALETTE = {
  // -- страница и полотно ---------------------------------------------------
  appBackground: [16, 20, 28],
  diagnosticsCard: [23, 29, 39],
  diagnosticsPass: [112, 214, 155],
  diagnosticsFail: [245, 140, 133],

  // -- вид машины: фон и надписи --------------------------------------------
  motorBackground: [18, 22, 30],
  motorTitle: [235, 241, 248],
  motorSubtitle: [130, 147, 169],
  motorNote: [103, 119, 141],

  // -- статор ---------------------------------------------------------------
  statorYoke: [64, 73, 87],
  statorBore: [30, 36, 47],
  statorSlot: [31, 38, 49],
  statorOutline: [112, 125, 145],
  coilMarkerFill: [39, 45, 57],
  phaseA: [225, 92, 83],
  phaseB: [91, 193, 126],
  phaseC: [83, 139, 224],

  // -- ротор ----------------------------------------------------------------
  rotorNorth: [218, 75, 70],
  rotorSouth: [67, 119, 211],
  rotorOutline: [213, 222, 234, 210],
  rotorPoleLabel: [229, 235, 242],
  shaftOuter: [19, 24, 32],
  shaftInner: [151, 164, 183],

  // -- оси, проекции и векторы ----------------------------------------------
  axisAlphaBeta: [112, 127, 147, 190],
  axisD: [246, 157, 68, 225],
  axisQ: [180, 116, 235, 225],
  guideAlphaBeta: [70, 204, 217, 90],
  componentAlphaBeta: [70, 204, 217, 135],
  guideDq: [220, 150, 235, 100],
  componentD: [246, 157, 68, 190],
  componentQ: [180, 116, 235, 190],
  vectorCurrent: [73, 220, 232],
  vectorCurrentReference: [73, 220, 232, 90],
  vectorVoltage: [247, 205, 74],
  vectorVoltageReference: [247, 205, 74, 105],
  vectorEmf: [236, 102, 190],
  torqueMotor: [75, 205, 126, 225],
  torqueLoad: [241, 146, 71, 225],

  // -- легенда и показания --------------------------------------------------
  legendLabel: [159, 174, 195],
  readoutCard: [23, 29, 39],
  readoutText: [194, 205, 220],
  pausedMark: [245, 177, 80],

  // -- панель управления ----------------------------------------------------
  panelBackground: [23, 28, 38],
  panelDivider: [47, 57, 73],
  panelTitle: [237, 242, 249],
  panelSection: [145, 159, 180],
  statusCard: [28, 35, 47],
  statusCaption: [122, 139, 162],
  statusValue: [232, 238, 247],
  hintCard: [29, 44, 55],
  hintText: [155, 207, 226],

  // -- виджеты --------------------------------------------------------------
  sliderLabel: [205, 214, 228],
  sliderTrack: [66, 77, 94],
  sliderFill: [75, 184, 226],
  sliderHandle: [228, 239, 247],
  sliderHandleActive: [130, 220, 255],
  checkboxBorder: [105, 122, 145],
  checkboxFill: [28, 34, 45],
  checkboxMark: [68, 190, 226],
  checkboxLabel: [211, 220, 232],
  buttonFill: [38, 46, 60],
  buttonFillSelected: [49, 142, 178],
  buttonLabel: [180, 192, 210],
  buttonLabelSelected: [247, 247, 247],
  iconButtonFill: [40, 49, 64, 235],
  iconButtonFillActive: [158, 105, 47],
  iconButtonGlyph: [226, 233, 242],

  // -- шторка компактной компоновки -----------------------------------------
  sheetScrim: [8, 11, 16, 190],
  sheetBackground: [23, 28, 38],
  sheetHandle: [84, 97, 117],
};

// Светлая тема повторяет ту же роль каждого цвета: фоны и тексты меняются
// местами по светлоте, а смысловые цвета (фазы, полюсы, векторы) остаются
// узнаваемыми, но затемняются — на светлом фоне светлые заливки не читаются.
const LIGHT_PALETTE = {
  appBackground: [238, 242, 247],
  diagnosticsCard: [255, 255, 255],
  diagnosticsPass: [31, 122, 77],
  diagnosticsFail: [176, 58, 48],

  motorBackground: [250, 251, 253],
  motorTitle: [23, 30, 42],
  motorSubtitle: [82, 95, 114],
  motorNote: [110, 123, 143],

  statorYoke: [198, 205, 216],
  statorBore: [233, 237, 243],
  statorSlot: [150, 160, 176],
  statorOutline: [120, 133, 152],
  coilMarkerFill: [255, 255, 255],
  phaseA: [198, 52, 44],
  phaseB: [32, 132, 76],
  phaseC: [38, 86, 180],

  rotorNorth: [206, 58, 52],
  rotorSouth: [48, 96, 190],
  rotorOutline: [70, 82, 100, 210],
  rotorPoleLabel: [250, 251, 253],
  shaftOuter: [70, 80, 96],
  shaftInner: [232, 236, 243],

  axisAlphaBeta: [104, 117, 138, 190],
  axisD: [196, 110, 20, 225],
  axisQ: [124, 62, 182, 225],
  guideAlphaBeta: [10, 130, 150, 110],
  componentAlphaBeta: [10, 130, 150, 165],
  guideDq: [150, 74, 190, 120],
  componentD: [196, 110, 20, 210],
  componentQ: [124, 62, 182, 210],
  vectorCurrent: [10, 130, 150],
  vectorCurrentReference: [10, 130, 150, 110],
  vectorVoltage: [168, 120, 8],
  vectorVoltageReference: [168, 120, 8, 125],
  vectorEmf: [186, 40, 140],
  torqueMotor: [26, 138, 78, 225],
  torqueLoad: [198, 104, 20, 225],

  legendLabel: [86, 99, 119],
  readoutCard: [233, 237, 244],
  readoutText: [46, 57, 74],
  pausedMark: [176, 98, 8],

  panelBackground: [238, 242, 247],
  panelDivider: [216, 222, 232],
  panelTitle: [23, 30, 42],
  panelSection: [112, 125, 145],
  statusCard: [247, 249, 252],
  statusCaption: [110, 123, 143],
  statusValue: [28, 38, 54],
  hintCard: [222, 238, 247],
  hintText: [22, 84, 114],

  sliderLabel: [46, 57, 76],
  sliderTrack: [205, 212, 224],
  sliderFill: [32, 126, 174],
  // На светлом треке белая ручка пропадает, поэтому она здесь тёмная, а при
  // перетаскивании темнеет ещё — в тёмной теме всё наоборот.
  sliderHandle: [24, 104, 148],
  sliderHandleActive: [14, 78, 112],
  checkboxBorder: [144, 156, 174],
  checkboxFill: [255, 255, 255],
  checkboxMark: [32, 126, 174],
  checkboxLabel: [38, 49, 66],
  buttonFill: [226, 231, 240],
  buttonFillSelected: [40, 130, 174],
  buttonLabel: [64, 77, 96],
  buttonLabelSelected: [255, 255, 255],
  // Не чисто белая: на светлом фоне машины белый диск сливался бы с ним, а
  // тени в скетче нет.
  iconButtonFill: [225, 231, 240, 240],
  iconButtonFillActive: [245, 186, 106],
  iconButtonGlyph: [38, 49, 66],

  sheetScrim: [16, 22, 32, 120],
  sheetBackground: [255, 255, 255],
  sheetHandle: [178, 188, 204],
};

const THEME_PALETTES = {
  [THEME_DARK]: DARK_PALETTE,
  [THEME_LIGHT]: LIGHT_PALETTE,
};

// Цвета страницы, которые нужны CSS: полотно рисует p5, а фон документа и
// карточку самотестирования — таблица стилей. Чтобы палитра осталась
// единственным источником, значения отдаются в CSS переменные.
const THEME_CSS_VARIABLES = {
  "--page-background": "appBackground",
  "--diagnostics-background": "diagnosticsCard",
  "--diagnostics-pass": "diagnosticsPass",
  "--diagnostics-fail": "diagnosticsFail",
};

let activeThemeName = THEME_DARK;

function theme() {
  return THEME_PALETTES[activeThemeName];
}

function currentThemeName() {
  return activeThemeName;
}

function isLightTheme() {
  return activeThemeName === THEME_LIGHT;
}

// Альфа записи, если вызывающий не задал свою. Заданная всегда побеждает:
// прозрачность катушек и ротора зависит от скорости и считается на месте.
function themeAlpha(entry, alpha) {
  if (alpha !== undefined && alpha !== null) return alpha;
  return entry.length > 3 ? entry[3] : 255;
}

function fillTheme(entry, alpha) {
  fill(entry[0], entry[1], entry[2], themeAlpha(entry, alpha));
}

function strokeTheme(entry, alpha) {
  stroke(entry[0], entry[1], entry[2], themeAlpha(entry, alpha));
}

function backgroundTheme(entry, alpha) {
  background(entry[0], entry[1], entry[2], themeAlpha(entry, alpha));
}

// Для цветов, которые передаются дальше как значение: оси, векторы, легенда.
function themeColor(entry, alpha) {
  return color(entry[0], entry[1], entry[2], themeAlpha(entry, alpha));
}

function cssColor(entry) {
  let alpha = themeAlpha(entry, undefined);
  if (alpha >= 255) return "rgb(" + entry[0] + ", " + entry[1] + ", " + entry[2] + ")";
  return "rgba(" + entry[0] + ", " + entry[1] + ", " + entry[2] + ", "
    + (alpha / 255).toFixed(3) + ")";
}

function setTheme(name, remember = true) {
  let resolved = name === THEME_LIGHT ? THEME_LIGHT : THEME_DARK;
  let changed = resolved !== activeThemeName;
  activeThemeName = resolved;
  if (remember) storeThemePreference(resolved);
  applyThemeToDocument();
  return changed;
}

function toggleTheme() {
  setTheme(isLightTheme() ? THEME_DARK : THEME_LIGHT);
}

// Пока пользователь не выбрал тему сам, программа следует системной, включая
// её переключение на ходу. Явный выбор запоминается и системную перекрывает.
function initialiseTheme() {
  let stored = storedThemePreference();
  setTheme(stored === null ? systemThemeName() : stored, false);
  if (typeof window === "undefined" || !window.matchMedia) return;
  let query = window.matchMedia("(prefers-color-scheme: light)");
  let follow = () => {
    if (storedThemePreference() === null) setTheme(systemThemeName(), false);
  };
  if (query.addEventListener) query.addEventListener("change", follow);
  else if (query.addListener) query.addListener(follow);
}

function systemThemeName() {
  if (typeof window === "undefined" || !window.matchMedia) return THEME_DARK;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? THEME_LIGHT : THEME_DARK;
}

// localStorage бросает исключение в приватном режиме и при открытии файла с
// диска, а тема — не та настройка, ради которой стоит ронять скетч.
function storedThemePreference() {
  try {
    let stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === THEME_DARK || stored === THEME_LIGHT ? stored : null;
  } catch (error) {
    return null;
  }
}

function storeThemePreference(name) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, name);
  } catch (error) {
    // Выбор не переживёт перезагрузку — на текущем сеансе это не сказывается.
  }
}

function applyThemeToDocument() {
  if (typeof document === "undefined" || !document.documentElement) return;
  let root = document.documentElement;
  root.setAttribute("data-theme", activeThemeName);
  for (const [variable, key] of Object.entries(THEME_CSS_VARIABLES)) {
    root.style.setProperty(variable, cssColor(theme()[key]));
  }
}

// Тема выбирается до того, как p5 создаст полотно: страница уже покрашена к
// первому кадру, и светлая тема не начинается со вспышки тёмного фона.
if (typeof window !== "undefined") initialiseTheme();

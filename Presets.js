// Демонстрационные профили.
//
// Полная программа даёт выбрать любой режим управления кнопками в панели. Для
// показа одного режима это лишнее: профиль фиксирует режим, задаёт заголовок
// страницы и убирает переключатели, которые в нём ничего не меняют. Модель,
// регуляторы и визуализация при этом те же — профиль только закрывает выбор.
//
// Профиль выбирается страницей: подпапка demo-страницы объявляет
// window.PMSM_PROFILE до загрузки скриптов. Корневая страница его не задаёт и
// потому принимает ?mode=<имя> — этим любой профиль проверяется без подпапки.

// Имена профилей совпадают с именами подпапок demo-страниц и со значением
// параметра ?mode: одно имя на профиль, страницу и ссылку.
const PROFILE_FULL = "full";
const PROFILE_MANUAL_VOLTAGE = "manual-voltage";
const PROFILE_MANUAL_CURRENT = "manual-current";
const PROFILE_OPEN_LOOP = "open-loop";
const PROFILE_VECTOR = "vector";

// documentTitle — заголовок вкладки, panelTitle — заголовок панели управления
// вместо общего «Управление PMSM». singleMode убирает строку выбора режима,
// singleManualVector — строку выбора между вектором тока и напряжения.
const DEMO_PROFILES = {
  [PROFILE_FULL]: {
    name: PROFILE_FULL,
    documentTitle: "PMSM — визуальная модель синхронной машины",
    panelTitle: "Управление PMSM",
    mode: MODE_MANUAL,
    manualVectorType: MANUAL_VECTOR_CURRENT,
    singleMode: false,
    singleManualVector: false,
  },
  [PROFILE_MANUAL_CURRENT]: {
    name: PROFILE_MANUAL_CURRENT,
    documentTitle: "PMSM — ручное задание вектора тока",
    panelTitle: "Ручное задание тока",
    mode: MODE_MANUAL,
    manualVectorType: MANUAL_VECTOR_CURRENT,
    singleMode: true,
    singleManualVector: true,
  },
  [PROFILE_MANUAL_VOLTAGE]: {
    name: PROFILE_MANUAL_VOLTAGE,
    documentTitle: "PMSM — ручное задание вектора напряжения",
    panelTitle: "Ручное задание напряжения",
    mode: MODE_MANUAL,
    manualVectorType: MANUAL_VECTOR_VOLTAGE,
    singleMode: true,
    singleManualVector: true,
  },
  [PROFILE_OPEN_LOOP]: {
    name: PROFILE_OPEN_LOOP,
    documentTitle: "PMSM — разомкнутое управление",
    panelTitle: "Разомкнутое управление",
    mode: MODE_OPEN_LOOP,
    manualVectorType: MANUAL_VECTOR_CURRENT,
    singleMode: true,
    singleManualVector: true,
  },
  [PROFILE_VECTOR]: {
    name: PROFILE_VECTOR,
    documentTitle: "PMSM — векторное управление",
    panelTitle: "Векторное управление",
    mode: MODE_VECTOR,
    manualVectorType: MANUAL_VECTOR_CURRENT,
    singleMode: true,
    singleManualVector: true,
  },
};

// Неизвестное имя — опечатка в ссылке или в window.PMSM_PROFILE. Показывать
// пустую страницу из-за неё незачем: возвращаем полную программу.
function demoProfile(name) {
  let profile = DEMO_PROFILES[name];
  return profile === undefined ? DEMO_PROFILES[PROFILE_FULL] : profile;
}

// Какой профиль запрошен. Порядок важен: объявление страницы сильнее адреса.
// Страница режима задаёт window.PMSM_PROFILE, и ?mode её переопределить не
// может — иначе из режима можно было бы выйти правкой ссылки, а вся затея
// именно в том, что нельзя.
function requestedDemoProfileName() {
  if (typeof window === "undefined") return PROFILE_FULL;
  if (typeof window.PMSM_PROFILE === "string") return window.PMSM_PROFILE;
  if (window.location) {
    let requested = new URLSearchParams(window.location.search).get("mode");
    if (requested) return requested;
  }
  return PROFILE_FULL;
}

// Единственное, что нужно точке входа: узнать профиль этой страницы.
function resolveDemoProfile() {
  return demoProfile(requestedDemoProfileName());
}

// Профиль задаёт стартовый режим до создания регуляторов: DriveController
// запоминает режим в конструкторе. Сброс параметров режим сохраняет, поэтому
// повторно применять профиль не нужно.
function applyDemoProfile(profile, settings) {
  settings.mode = profile.mode;
  settings.manualVectorType = profile.manualVectorType;
}

// -- выбор машины -------------------------------------------------------------
//
// Машина выбирается независимо от профиля: любой режим показывается на любой
// из двух машин. Источник выбора — тот же, что у профиля, и в том же порядке:
// страница induction/ объявляет window.PMSM_MACHINE, остальные принимают
// ?machine=induction. Без того и другого — PMSM, как было всегда.
//
// Переключатель в панели не меняет машину на ходу, а открывает тот же адрес
// с другим ?machine. Смена машины — это всё равно полный сброс: другой
// паспорт, другие органы в панели, другие подписи. Перезагрузка делает его
// честно, без шанса забыть в старой машине какую-нибудь ссылку.

// Порядок — это и порядок кнопок переключателя: номер кнопки — номер записи.
const MACHINE_DESCRIPTIONS = [
  { type: MACHINE_PMSM, label: "Синхронная", shortName: "PMSM",
    title: "Синхронная машина с постоянными магнитами" },
  { type: MACHINE_INDUCTION, label: "Асинхронная", shortName: "АД",
    title: "Асинхронная машина с короткозамкнутым ротором" },
];

function machineDescription(type) {
  let found = MACHINE_DESCRIPTIONS.find((item) => item.type === type);
  return found === undefined ? MACHINE_DESCRIPTIONS[0] : found;
}

// Машину назвала сама страница — переключателя на ней нет, как нет выбора
// режима на странице режима.
function machineFixedByPage() {
  return typeof window !== "undefined" && typeof window.PMSM_MACHINE === "string";
}

// Неизвестное имя машины, как и неизвестный профиль, открывает PMSM.
function requestedMachineType() {
  let requested = null;
  if (machineFixedByPage()) {
    requested = window.PMSM_MACHINE;
  } else if (typeof window !== "undefined" && window.location) {
    requested = new URLSearchParams(window.location.search).get("machine");
  }
  return machineDescription(requested).type;
}

// Адрес той же страницы с другой машиной. Остальные параметры (?mode,
// ?layout) сохраняются; PMSM — машина по умолчанию, и для неё параметр
// убирается совсем, чтобы ссылка осталась такой же, как была до переключателя.
function machineSwitchSearch(search, type) {
  let parameters = new URLSearchParams(search);
  if (type === MACHINE_PMSM) {
    parameters.delete("machine");
  } else {
    parameters.set("machine", type);
  }
  let text = parameters.toString();
  return text === "" ? "" : "?" + text;
}

function createMotorParameters(type) {
  return type === MACHINE_INDUCTION ? new InductionMotorParameters() : new MotorParameters();
}

function createMotorModel(parameters) {
  return parameters.machineType === MACHINE_INDUCTION
    ? new InductionMotorModel(parameters)
    : new PMSMModel(parameters);
}

// Заголовки профилей написаны для PMSM. У асинхронной машины в них меняется
// только название машины — режим тот же.
function machineDocumentTitle(profile, type) {
  if (type !== MACHINE_INDUCTION) return profile.documentTitle;
  return profile.documentTitle.replace("PMSM", "АД")
    .replace("синхронной машины", "асинхронной машины");
}

function machinePanelTitle(profile, type) {
  if (type !== MACHINE_INDUCTION) return profile.panelTitle;
  return profile.panelTitle.replace("PMSM", "АД");
}

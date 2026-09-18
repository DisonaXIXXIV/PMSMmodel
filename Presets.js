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

function requestedDemoProfileName() {
  if (typeof window === "undefined") return PROFILE_FULL;
  if (typeof window.PMSM_PROFILE === "string") return window.PMSM_PROFILE;
  if (window.location) {
    let requested = new URLSearchParams(window.location.search).get("mode");
    if (requested) return requested;
  }
  return PROFILE_FULL;
}

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

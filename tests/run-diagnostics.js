// Запуск диагностических тестов в Node: npm test.
//
// Программа писана под p5.js и рассчитывает на её глобальные имена — PI, cos,
// constrain, nf и прочие. В Node их нет, а тянуть саму p5 ради арифметики
// незачем: она требует браузерного окружения. Поэтому нужные имена
// подставляются здесь заглушками из Math, а файлы модели выполняются в этом же
// контексте как обычные скрипты — ровно так же, как их выполнил бы браузер,
// подключив тегами <script>.
//
// Отсюда два следствия, о которых стоит помнить, добавляя код:
//   * новая математическая функция p5 в модели, регуляторах или в проверяемой
//     части раскладки потребует заглушки в списке ниже, иначе тесты упадут на
//     ReferenceError;
//   * MotorView и GUI подключаются наравне с остальными: выполнение их файлов
//     только объявляет классы и функции и ничего не рисует. Рисовать без
//     полотна по-прежнему нельзя, поэтому тесты вызывают из них лишь то, что
//     считает, — раскладку, попадание нажатий, перевод координат. Всё
//     остальное проверяет открытие страницы ?self-test.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Заглушки глобальных имён p5. Повторяют её поведение только в том, что
// нужно модели: nf — это форматирование числа с заданным числом знаков после
// запятой, constrain — ограничение диапазоном.
Object.assign(globalThis, {
  PI: Math.PI,
  HALF_PI: Math.PI / 2,
  TWO_PI: Math.PI * 2,
  abs: Math.abs,
  atan2: Math.atan2,
  cos: Math.cos,
  floor: Math.floor,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  round: Math.round,
  sin: Math.sin,
  sqrt: Math.sqrt,
  constrain: (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum),
  lerp: (start, stop, amount) => start + (stop - start) * amount,
  nf: (value, _left, right) => Number(value).toFixed(right),
  str: String,
});

// Порядок файлов — тот же, что в index.html: классы объявляются раньше, чем
// используются. Выполняются они в текущем контексте, поэтому их классы и
// функции становятся глобальными, как в браузере.
const root = path.resolve(__dirname, "..");
for (const file of ["version.js", "Theme.js", "MathUtils.js", "MotorModel.js", "InductionMotorModel.js", "Controllers.js", "Presets.js",
  "Simulation.js", "MotorView.js", "Panel.js", "Help.js", "Diagnostics.js",
  "Updater.js"]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  vm.runInThisContext(source, { filename: file });
}

// Ненулевой код возврата при ошибках: так npm test падает, а не просто печатает.
process.exitCode = runSimulationDiagnostics() === 0 ? 0 : 1;

// Изолируем браузерные настройки: тема iframe не должна зависеть от тёмной
// темы телефона, старого выбора или доступности хранилища в чужом iframe.
const assert = require("node:assert/strict");
const themeSource = fs.readFileSync(path.join(root, "Theme.js"), "utf8");
for (const [search, stored, systemLight, storageBlocked] of [
  ["?theme=light", "dark", false, false],
  ["?theme=dark", "light", true, false],
  ["?theme=light", null, false, true],
  ["?theme=light", null, false, false],
  ["?theme=dark", null, true, false],
  ["?theme=unknown", "light", false, false],
  ["?theme=", "dark", true, false],
  ["", null, true, false],
  ["", null, false, false],
  ["", "light", false, false],
]) {
  let preference = stored;
  let appliedTheme;
  let onSystemChange;
  const media = {
    matches: systemLight,
    addEventListener: (_event, callback) => { onSystemChange = callback; },
  };
  const context = vm.createContext({
    URLSearchParams,
    window: {
      location: { search },
      matchMedia: () => media,
      localStorage: {
        getItem: () => {
          if (storageBlocked) throw new Error("Storage is unavailable");
          return preference;
        },
        setItem: (_key, value) => { preference = value; },
      },
    },
    document: {
      documentElement: {
        setAttribute: (_key, value) => { appliedTheme = value; },
        style: { setProperty() {} },
      },
    },
  });
  vm.runInContext(themeSource, context, { filename: "Theme.js" });
  const parameter = new URLSearchParams(search).get("theme");
  const requested = ["light", "dark"].includes(parameter) ? parameter : null;
  const expected = requested ?? stored ?? (systemLight ? "light" : "dark");
  assert.equal(appliedTheme, expected, "initial theme: " + search);
  assert.equal(preference, stored, "opening a link preserves the saved theme");
  media.matches = !systemLight;
  onSystemChange();
  assert.equal(appliedTheme, requested ?? stored ?? (!systemLight ? "light" : "dark"),
    "system changes respect the URL and saved preference");
  vm.runInContext("toggleTheme()", context);
  assert.equal(appliedTheme, preference, "the theme button still works");
  vm.runInContext("initialiseTheme()", context);
  if (requested) assert.equal(appliedTheme, requested, "reopening reapplies the URL theme");
}
console.log("PASS: URL themes override system and saved themes without changing stored preferences");

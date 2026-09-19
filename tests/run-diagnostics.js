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
for (const file of ["Theme.js", "MathUtils.js", "MotorModel.js", "Controllers.js", "Presets.js",
  "MotorView.js", "Panel.js", "Diagnostics.js"]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  vm.runInThisContext(source, { filename: file });
}

// Ненулевой код возврата при ошибках: так npm test падает, а не просто печатает.
process.exitCode = runSimulationDiagnostics() === 0 ? 0 : 1;

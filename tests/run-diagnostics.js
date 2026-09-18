const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

Object.assign(globalThis, {
  PI: Math.PI,
  HALF_PI: Math.PI / 2,
  TWO_PI: Math.PI * 2,
  abs: Math.abs,
  atan2: Math.atan2,
  cos: Math.cos,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  round: Math.round,
  sin: Math.sin,
  sqrt: Math.sqrt,
  constrain: (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum),
  nf: (value, _left, right) => Number(value).toFixed(right),
  str: String,
});

const root = path.resolve(__dirname, "..");
for (const file of ["Theme.js", "MathUtils.js", "MotorModel.js", "Controllers.js", "Presets.js",
  "Diagnostics.js"]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  vm.runInThisContext(source, { filename: file });
}

process.exitCode = runSimulationDiagnostics() === 0 ? 0 : 1;

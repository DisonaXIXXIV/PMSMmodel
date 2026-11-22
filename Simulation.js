// Симулятор с фиксированным шагом связывает регуляторы с моделью.
// У АД ход модельного времени следует за временем кадров с замедлением
// 50:1. При 50 Гц поле делает на экране один оборот в секунду.
const INDUCTION_DISPLAY_SLOWDOWN = 50;
// После свёрнутой вкладки догоняем только последние 50 мс.
const MAXIMUM_INDUCTION_FRAME_MS = 50;

class FixedStepSimulator {
  // 100 мкс — шаг интегрирования. Электрическая постоянная времени машины
  // L/R = 5 мс, так что на неё приходится 50 шагов: метод Рунге — Кутты 4-го
  // порядка держит такой шаг с большим запасом даже при быстрых регуляторах.
  fixedTimeStep = 0.0001;
  // Для PMSM сохраняется 1 мс модельного времени на кадр.
  simulatedTimePerFrame = 0.001;
  inductionTimeRemainder = 0.0;

  motor;
  controller;
  settings;
  // Сколько шагов сделано в последнем кадре. Нужно только для диагностики: в
  // паузе здесь ноль.
  stepsLastFrame = 0;

  constructor(motor, controller, settings) {
    this.motor = motor;
    this.controller = controller;
    this.settings = settings;
  }

  // За кадр выполняется целое число шагов. Остаток времени АД переносится
  // на следующий кадр, чтобы округление не меняло скорость показа.
  advanceFrame(paused, elapsedMilliseconds = 1000 / 60) {
    this.stepsLastFrame = 0;
    if (paused) return;

    let stepsPerFrame = round(this.simulatedTimePerFrame / this.fixedTimeStep);
    if (this.motor.parameters.machineType === MACHINE_INDUCTION) {
      const elapsedSeconds = Math.min(elapsedMilliseconds, MAXIMUM_INDUCTION_FRAME_MS) / 1000;
      this.inductionTimeRemainder += elapsedSeconds / INDUCTION_DISPLAY_SLOWDOWN;
      stepsPerFrame = Math.floor((this.inductionTimeRemainder + Number.EPSILON) / this.fixedTimeStep);
      this.inductionTimeRemainder -= stepsPerFrame * this.fixedTimeStep;
    }
    for (let step = 0; step < stepsPerFrame; step++) {
      // Порядок внутри шага: сначала регуляторы смотрят на текущее состояние и
      // выдают напряжение, затем модель делает по нему шаг. Это обычная для
      // цифрового привода задержка на такт, и она же — причина, по которой
      // регуляторы получают тот же timeStep, что и модель.
      this.controller.update(this.motor.state, this.fixedTimeStep);
      this.motor.step(this.controller.voltageCommand.x, this.controller.voltageCommand.y,
        this.settings.loadTorque, this.fixedTimeStep);
      this.stepsLastFrame++;
    }
  }

  // Время модели обнуляется в MotorState. Здесь сбрасывается остаток кадра.
  resetClock() {
    this.inductionTimeRemainder = 0.0;
    this.stepsLastFrame = 0;
  }
}

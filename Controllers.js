const MODE_MANUAL = 0;
const MODE_OPEN_LOOP = 1;
const MODE_VECTOR = 2;

const MANUAL_VECTOR_CURRENT = 0;
const MANUAL_VECTOR_VOLTAGE = 1;
const MANUAL_MAXIMUM_VOLTAGE = 15.0;

class ControlSettings {
  mode = MODE_MANUAL;
  loadTorque = 0.0;

  manualCurrentAlpha = 0.0;
  manualCurrentBeta = 0.0;
  manualVoltageAlpha = 0.0;
  manualVoltageBeta = 0.0;
  manualVectorType = MANUAL_VECTOR_CURRENT;
  openLoopVoltage = 0.0;
  openLoopFrequency = 0.0;

  currentQReference = 0.0;
  currentKp = 4.0;
  currentKi = 800.0;
  speedLoopEnabled = false;
  speedReferenceRpm = 0.0;
  // The speed loop acts on torque over inertia, so both gains scale with
  // MotorParameters.inertia: these are tuned for J = 0.1 and give
  // wn = 20 rad/s, zeta = 2.3 with the PI zero at Ki/Kp = 4.3 rad/s.
  speedKp = 5.0;
  speedKi = 21.67;

  showVoltage = true;
  showEmf = true;
  showAlphaBetaAxes = true;
  showDqAxes = true;
  showAlphaBetaProjections = false;
  showDqProjections = true;
  lockDqFrame = false;

  maximumCurrent;

  constructor(parameters) {
    this.maximumCurrent = parameters.maximumCurrent;
  }

  resetGuiParametersPreservingMode() {
    let preservedMode = this.mode;
    let preservedManualVectorType = this.manualVectorType;

    this.loadTorque = 0.0;
    this.manualCurrentAlpha = 0.0;
    this.manualCurrentBeta = 0.0;
    this.manualVoltageAlpha = 0.0;
    this.manualVoltageBeta = 0.0;
    this.openLoopVoltage = 0.0;
    this.openLoopFrequency = 0.0;

    this.currentQReference = 0.0;
    this.currentKp = 4.0;
    this.currentKi = 800.0;
    this.speedLoopEnabled = false;
    this.speedReferenceRpm = 0.0;
    this.speedKp = 5.0;
    this.speedKi = 21.67;

    this.showVoltage = true;
    this.showEmf = true;
    this.showAlphaBetaAxes = true;
    this.showDqAxes = true;
    this.showAlphaBetaProjections = false;
    this.showDqProjections = true;
    this.lockDqFrame = false;

    this.mode = preservedMode;
    this.manualVectorType = preservedManualVectorType;
  }
}

class PIRegulator {
  integrator = 0.0;

  calculate(error, kp, ki, timeStep) {
    this.integrator += ki * error * timeStep;
    return kp * error + this.integrator;
  }

  applyTracking(saturationDifference, kp, ki, timeStep) {
    if (ki <= 0.0) {
      this.integrator = 0.0;
      return;
    }
    // Back-calculation with Tt = Ti gives Kaw = Ki / Kp. The limits keep
    // deliberately unusual GUI settings numerically safe.
    let trackingGain = constrain(ki / max(kp, 0.25), 1.0, 2000.0);
    this.integrator += trackingGain * saturationDifference * timeStep;
    this.integrator = constrain(this.integrator, -1000.0, 1000.0);
  }

  reset() {
    this.integrator = 0.0;
  }
}

class DriveController {
  parameters;
  settings;
  voltageCommand = new Vec2();

  manualAlphaController = new PIRegulator();
  manualBetaController = new PIRegulator();
  currentDController = new PIRegulator();
  currentQController = new PIRegulator();

  speedIntegrator = 0.0;
  openLoopAngle = 0.0;
  currentDReference = 0.0;
  currentQReference = 0.0;
  activeMode = MODE_MANUAL;
  activeManualVectorType = MANUAL_VECTOR_CURRENT;

  constructor(parameters, settings) {
    this.parameters = parameters;
    this.settings = settings;
    this.activeMode = settings.mode;
    this.activeManualVectorType = settings.manualVectorType;
  }

  update(state, timeStep) {
    if (this.settings.mode != this.activeMode) {
      this.changeMode(this.settings.mode, state);
    }
    if (this.settings.manualVectorType != this.activeManualVectorType) {
      this.changeManualVectorType(this.settings.manualVectorType);
    }

    if (this.activeMode == MODE_MANUAL) {
      this.updateManualMode(state, timeStep);
    } else if (this.activeMode == MODE_OPEN_LOOP) {
      this.updateOpenLoopMode(timeStep);
    } else {
      this.updateVectorMode(state, timeStep);
    }
  }

  updateManualMode(state, timeStep) {
    this.currentDReference = 0.0;
    this.currentQReference = 0.0;
    if (this.activeManualVectorType == MANUAL_VECTOR_VOLTAGE) {
      this.voltageCommand.set(
      this.settings.manualVoltageAlpha,
      this.settings.manualVoltageBeta,
      );
      limitVector(this.voltageCommand, MANUAL_MAXIMUM_VOLTAGE);
      return;
    }

    let regulatorAlpha = this.manualAlphaController.calculate(
      this.settings.manualCurrentAlpha - state.currentAlpha,
      this.settings.currentKp, this.settings.currentKi, timeStep);
    let regulatorBeta = this.manualBetaController.calculate(
      this.settings.manualCurrentBeta - state.currentBeta,
      this.settings.currentKp, this.settings.currentKi, timeStep);

    // For Ld = Lq the alpha-beta plant is R*i + L*di/dt + e = u.
    // Feed the measured back-EMF forward so the PI only controls the RL part.
    let unsaturatedAlpha = regulatorAlpha + state.emfAlpha;
    let unsaturatedBeta = regulatorBeta + state.emfBeta;

    this.voltageCommand.set(unsaturatedAlpha, unsaturatedBeta);
    limitVector(this.voltageCommand, this.parameters.maximumVoltage);
    this.manualAlphaController.applyTracking(this.voltageCommand.x - unsaturatedAlpha,
      this.settings.currentKp, this.settings.currentKi, timeStep);
    this.manualBetaController.applyTracking(this.voltageCommand.y - unsaturatedBeta,
      this.settings.currentKp, this.settings.currentKi, timeStep);
  }

  updateOpenLoopMode(timeStep) {
    this.openLoopAngle = wrapAngle(this.openLoopAngle + TWO_PI * this.settings.openLoopFrequency * timeStep);
    this.voltageCommand.x = this.settings.openLoopVoltage * cos(this.openLoopAngle);
    this.voltageCommand.y = this.settings.openLoopVoltage * sin(this.openLoopAngle);
    this.currentDReference = 0.0;
    this.currentQReference = 0.0;
  }

  updateVectorMode(state, timeStep) {
    this.currentDReference = 0.0;
    if (this.settings.speedLoopEnabled) {
      let speedError = radiansFromRpm(this.settings.speedReferenceRpm) - state.mechanicalSpeed;
      let unsaturatedCurrent = this.settings.speedKp * speedError + this.speedIntegrator;
      this.currentQReference = clampMagnitude(unsaturatedCurrent, this.parameters.maximumCurrent);
      let speedTrackingGain = this.settings.speedKi > 0.0
        ? constrain(this.settings.speedKi / max(this.settings.speedKp, 0.01), 1.0, 500.0)
        : 0.0;
      this.speedIntegrator += this.settings.speedKi * speedError * timeStep
        + speedTrackingGain * (this.currentQReference - unsaturatedCurrent) * timeStep;
      this.speedIntegrator = constrain(this.speedIntegrator, -this.parameters.maximumCurrent, this.parameters.maximumCurrent);
    } else {
      this.currentQReference = this.settings.currentQReference;
    }

    let errorD = this.currentDReference - state.currentD;
    let errorQ = this.currentQReference - state.currentQ;
    let regulatorD = this.currentDController.calculate(errorD, this.settings.currentKp, this.settings.currentKi, timeStep);
    let regulatorQ = this.currentQController.calculate(errorQ, this.settings.currentKp, this.settings.currentKi, timeStep);

    let unsaturatedD = regulatorD - state.electricalSpeed * this.parameters.inductanceQ * state.currentQ;
    let unsaturatedQ = regulatorQ + state.electricalSpeed
      * (this.parameters.inductanceD * state.currentD + this.parameters.magnetFlux);

    let cosine = cos(state.electricalAngle);
    let sine = sin(state.electricalAngle);
    let unsaturatedAlpha = cosine * unsaturatedD - sine * unsaturatedQ;
    let unsaturatedBeta = sine * unsaturatedD + cosine * unsaturatedQ;

    this.voltageCommand.set(unsaturatedAlpha, unsaturatedBeta);
    limitVector(this.voltageCommand, this.parameters.maximumVoltage);

    let saturatedD = cosine * this.voltageCommand.x + sine * this.voltageCommand.y;
    let saturatedQ = -sine * this.voltageCommand.x + cosine * this.voltageCommand.y;
    this.currentDController.applyTracking(saturatedD - unsaturatedD,
      this.settings.currentKp, this.settings.currentKi, timeStep);
    this.currentQController.applyTracking(saturatedQ - unsaturatedQ,
      this.settings.currentKp, this.settings.currentKi, timeStep);
  }

  changeMode(newMode, state) {
    this.resetRegulators();
    this.activeMode = newMode;
    this.activeManualVectorType = this.settings.manualVectorType;
    if (newMode == MODE_OPEN_LOOP) {
      this.openLoopAngle = state.electricalAngle;
    }
  }

  setMode(newMode, state) {
    this.settings.mode = newMode;
    this.changeMode(newMode, state);
  }

  setManualCurrent(alpha, beta) {
    this.settings.manualCurrentAlpha = alpha;
    this.settings.manualCurrentBeta = beta;
  }

  setManualVoltage(alpha, beta) {
    this.settings.manualVoltageAlpha = alpha;
    this.settings.manualVoltageBeta = beta;
  }

  setManualVectorType(vectorType) {
    this.settings.manualVectorType = vectorType;
    this.changeManualVectorType(vectorType);
  }

  changeManualVectorType(vectorType) {
    this.manualAlphaController.reset();
    this.manualBetaController.reset();
    this.activeManualVectorType = vectorType;
  }

  resetRegulators() {
    this.manualAlphaController.reset();
    this.manualBetaController.reset();
    this.currentDController.reset();
    this.currentQController.reset();
    this.speedIntegrator = 0.0;
  }

  reset() {
    this.resetRegulators();
    this.voltageCommand.set(0.0, 0.0);
    this.openLoopAngle = 0.0;
    this.settings.manualCurrentAlpha = 0.0;
    this.settings.manualCurrentBeta = 0.0;
    this.settings.manualVoltageAlpha = 0.0;
    this.settings.manualVoltageBeta = 0.0;
    this.currentDReference = 0.0;
    this.currentQReference = 0.0;
    this.activeMode = this.settings.mode;
    this.activeManualVectorType = this.settings.manualVectorType;
  }
}

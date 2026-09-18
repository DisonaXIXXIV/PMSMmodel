let activeProfile;
let motorParameters;
let controlSettings;
let motor;
let driveController;
let simulator;
let sketchLayout;
let motorView;
let controlPanel;

let simulationPaused = false;
let diagnosticsMode = false;

// Phone screens report a device pixel ratio of 3 or more. Rendering the stator,
// the vectors and the torque arcs into a buffer that large costs more than the
// extra sharpness is worth at 60 FPS with ten physics steps per frame.
const MAXIMUM_PIXEL_DENSITY = 2.0;

function setup() {
  activeProfile = resolveDemoProfile();
  document.title = activeProfile.documentTitle;

  if (new URLSearchParams(window.location.search).has("self-test")) {
    diagnosticsMode = true;
    noCanvas();
    const failures = runSimulationDiagnostics();
    showDiagnosticResult(failures);
    noLoop();
    return;
  }

  const runningInProcessing = typeof window.pde !== "undefined";
  const viewport = viewportSize();
  const canvas = createCanvas(
    runningInProcessing ? 1280 : viewport.width,
    runningInProcessing ? 720 : viewport.height,
  );
  const browserContainer = document.getElementById("app");
  if (browserContainer) canvas.parent(browserContainer);
  pixelDensity(min(displayDensity(), MAXIMUM_PIXEL_DENSITY));
  frameRate(60);

  // A long press inside the stator is a manual-vector drag, not a request for
  // the context menu.
  if (canvas.elt) {
    canvas.elt.addEventListener("contextmenu", (event) => event.preventDefault());
  }
  // p5 2.x routes touches through pointer events, so mousePressed and friends
  // already receive them and no touch handlers are needed. It does not report
  // pointercancel to the sketch, though: when the system takes the pointer away
  // mid-drag — an edge swipe, a notification, palm rejection — the widget would
  // stay latched and keep following the next press. Release it ourselves.
  window.addEventListener("pointercancel", pointerReleased);
  window.addEventListener("blur", pointerReleased);
  // windowResized alone misses the moment a phone finishes rotating: the new
  // viewport is only reported once the rotation animation ends.
  window.addEventListener("orientationchange", () => setTimeout(windowResized, 120));
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", windowResized);
  }

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

function draw() {
  if (diagnosticsMode) return;

  sketchLayout.update(width, height);
  simulator.advanceFrame(simulationPaused);
  motorView.updateReferenceFrame(motor.state);

  backgroundTheme(theme().appBackground);
  motorView.draw(sketchLayout.motorArea, motor, driveController, simulator, sketchLayout.compact);
  controlPanel.draw(sketchLayout.panelArea, motor, simulator, sketchLayout.compact);
}

// The container carries the viewport height, dynamic units included, so it is a
// steadier source than windowHeight while a mobile URL bar collapses.
function viewportSize() {
  const container = document.getElementById("app");
  const containerWidth = container ? container.clientWidth : 0;
  const containerHeight = container ? container.clientHeight : 0;
  return {
    width: containerWidth > 0 ? containerWidth : windowWidth,
    height: containerHeight > 0 ? containerHeight : windowHeight,
  };
}

function windowResized() {
  if (diagnosticsMode) return;
  const viewport = viewportSize();
  if (abs(viewport.width - width) < 1.0 && abs(viewport.height - height) < 1.0) return;
  resizeCanvas(viewport.width, viewport.height);
}

function pointerPressed(px, py) {
  if (controlPanel.mousePressed(px, py)) return;
  motorView.mousePressed(px, py, sketchLayout.motorArea, driveController, sketchLayout.compact);
}

function pointerDragged(px, py) {
  if (controlPanel.mouseDragged(px, py)) return;
  motorView.mouseDragged(px, py, sketchLayout.motorArea, driveController, sketchLayout.compact);
}

function pointerReleased() {
  if (diagnosticsMode || !controlPanel) return;
  controlPanel.mouseReleased();
  motorView.mouseReleased();
}

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

function showDiagnosticResult(failures) {
  document.body.classList.add("diagnostics-page");
  const output = document.createElement("main");
  output.className = failures === 0 ? "diagnostics diagnostics--pass" : "diagnostics diagnostics--fail";
  output.textContent = failures === 0
    ? "Все диагностические тесты PMSM пройдены."
    : `Диагностические тесты PMSM: ошибок — ${failures}. Подробности в консоли.`;
  document.body.append(output);
}

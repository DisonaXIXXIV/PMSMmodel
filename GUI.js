const PANEL_FONT_SCALE = 1.15;
// Both mobile platform guidelines land on roughly the same comfortable touch
// target, and every control the compact layout lays out is sized against it.
const TOUCH_TARGET_MINIMUM = 44.0;
// Anything that cannot hold the machine and the panel side by side — a phone in
// portrait, a narrow window — gets the compact layout instead.
const COMPACT_MAXIMUM_ASPECT = 1.1;
const COMPACT_MAXIMUM_WIDTH = 820.0;
// The sheet grows with its contents up to this much of the screen, then its
// rows are shrunk instead, but never below the second fraction of their size.
const SHEET_MAXIMUM_FRACTION = 0.88;
const SHEET_MINIMUM_FRACTION = 0.30;
const SHEET_MINIMUM_ROW_FIT = 0.72;
// How far the sheet header has to be pulled down before the sheet closes.
const SHEET_DISMISS_DISTANCE = 70.0;

const TAB_CONTROL = 0;
const TAB_VISUALISATION = 1;

// Shrinks a label until it fits, for the few headings that are set in one line
// at whatever width the screen happens to be.
function fittedTextSize(label, maximumWidth, desiredSize, minimumSize) {
  let size = desiredSize;
  while (size > minimumSize) {
    textSize(size);
    if (textWidth(label) <= maximumWidth) break;
    size -= 0.5;
  }
  textSize(size);
  return size;
}

// Packs pre-measured pieces into as few lines as fit the width. Used for the
// legend and the readout, whose contents differ by mode and by locale width.
function flowIntoLines(widths, gap, maximumWidth) {
  let lines = [];
  let current = [];
  let used = 0.0;
  for (let i = 0; i < widths.length; i++) {
    let advance = current.length === 0 ? widths[i] : gap + widths[i];
    if (current.length > 0 && used + advance > maximumWidth) {
      lines.push(current);
      current = [i];
      used = widths[i];
      continue;
    }
    current.push(i);
    used += advance;
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

class Area {
  x;
  y;
  w;
  h;

  set(x, y, w, h) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }

  contains(px, py) {
    return px >= this.x && px <= this.x + this.w && py >= this.y && py <= this.y + this.h;
  }
}

class SketchLayout {
  motorArea = new Area();
  panelArea = new Area();
  compact = false;
  forcedMode = null;

  update(sketchWidth, sketchHeight) {
    this.compact = this.resolveCompact(sketchWidth, sketchHeight);
    if (this.compact) {
      // The panel floats above the machine rather than taking a column from it,
      // so both get the whole screen and the panel decides what it swallows.
      this.motorArea.set(0.0, 0.0, sketchWidth, sketchHeight);
      this.panelArea.set(0.0, 0.0, sketchWidth, sketchHeight);
      return;
    }
    let divider = sketchWidth * 0.5;
    this.motorArea.set(0.0, 0.0, divider, sketchHeight);
    this.panelArea.set(divider, 0.0, sketchWidth - divider, sketchHeight);
  }

  resolveCompact(sketchWidth, sketchHeight) {
    if (this.forcedMode === null) {
      // ?layout=compact and ?layout=desktop let either layout be opened from
      // either kind of screen, which is the only way to check one from the other.
      let requested = null;
      if (typeof window !== "undefined" && window.location) {
        requested = new URLSearchParams(window.location.search).get("layout");
      }
      this.forcedMode = requested === "compact" || requested === "desktop" ? requested : "";
    }
    if (this.forcedMode !== "") return this.forcedMode === "compact";
    return sketchWidth < sketchHeight * COMPACT_MAXIMUM_ASPECT
      || sketchWidth < COMPACT_MAXIMUM_WIDTH;
  }
}

class SliderControl {
  label;
  suffix;
  minimum;
  maximum;
  value;
  x;
  y;
  w;
  h;
  scale = 1.0;
  visible = true;
  dragging = false;
  decimalPlaces = 1;
  showPositiveSign = false;

  constructor(label, suffix, minimum, maximum, value) {
    this.label = label;
    this.suffix = suffix;
    this.minimum = minimum;
    this.maximum = maximum;
    this.value = value;
  }

  setBounds(x, y, w, h, scale) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.scale = scale;
  }

  // The track and the handle are proportions of the row rather than multiples
  // of the text scale, so a row stretched to a touch target carries a handle
  // and a hit band stretched with it. At the desktop row height of 39 · scale
  // these reproduce the original 25 · scale and 13 · scale exactly.
  trackY() {
    return this.y + this.h * 0.641;
  }

  handleDiameter() {
    return this.h * 0.333;
  }

  drawControl() {
    if (!this.visible) return;

    fillTheme(theme().sliderLabel);
    textAlign(LEFT, TOP);
    textSize(12.5 * this.scale * PANEL_FONT_SCALE);
    text(this.label, this.x, this.y);
    textAlign(RIGHT, TOP);
    text(this.formatValue(this.value) + this.suffix, this.x + this.w, this.y);

    let trackY = this.trackY();
    strokeTheme(theme().sliderTrack);
    strokeWeight(4.0 * this.scale);
    line(this.x, trackY, this.x + this.w, trackY);
    let fraction = (this.value - this.minimum) / (this.maximum - this.minimum);
    strokeTheme(theme().sliderFill);
    line(this.x, trackY, this.x + this.w * fraction, trackY);
    noStroke();
    fillTheme(this.dragging ? theme().sliderHandleActive : theme().sliderHandle);
    circle(this.x + this.w * fraction, trackY, this.handleDiameter());
  }

  formatValue(number) {
    let displayedNumber = this.showPositiveSign ? abs(number) : number;
    let formatted;
    if (abs(this.maximum - this.minimum) >= 1000.0 || displayedNumber >= 100.0) {
      formatted = str(round(displayedNumber));
    } else {
      formatted = nf(displayedNumber, 1, this.decimalPlaces);
    }
    if (!this.showPositiveSign || number == 0.0) return formatted;
    return (number > 0.0 ? "+" : "−") + formatted;
  }

  press(px, py) {
    if (!this.visible) return false;
    if (px >= this.x - 8.0 * this.scale && px <= this.x + this.w + 8.0 * this.scale
        && py >= this.y && py <= this.y + this.h) {
      this.dragging = true;
      this.updateFromMouse(px);
      return true;
    }
    return false;
  }

  drag(px) {
    if (!this.dragging) return false;
    this.updateFromMouse(px);
    return true;
  }

  release() {
    this.dragging = false;
  }

  updateFromMouse(px) {
    let fraction = constrain((px - this.x) / this.w, 0.0, 1.0);
    this.value = lerp(this.minimum, this.maximum, fraction);
  }
}

class CheckboxControl {
  label;
  checked;
  x;
  y;
  w;
  h;
  scale = 1.0;
  visible = true;

  constructor(label, checked) {
    this.label = label;
    this.checked = checked;
  }

  setBounds(x, y, w, h, scale) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.scale = scale;
  }

  drawControl() {
    if (!this.visible) return;
    // The box and the label keep their own size and sit centred in the row, so
    // growing the row to a touch target grows the hit area and not the text.
    let boxSize = 15.0 * this.scale;
    let boxY = this.y + (this.h - boxSize) * 0.5;
    strokeTheme(theme().checkboxBorder);
    strokeWeight(1.2 * this.scale);
    fillTheme(theme().checkboxFill);
    rect(this.x, boxY, boxSize, boxSize, 3.0 * this.scale);
    if (this.checked) {
      noStroke();
      fillTheme(theme().checkboxMark);
      rect(this.x + 3.0 * this.scale, boxY + 3.0 * this.scale,
        boxSize - 6.0 * this.scale, boxSize - 6.0 * this.scale, 2.0 * this.scale);
    }
    // The box outline is still set as the stroke; without clearing it the label
    // is drawn outlined and reads as bold next to the checked ones.
    noStroke();
    fillTheme(theme().checkboxLabel);
    textAlign(LEFT, CENTER);
    textSize(12.0 * this.scale * PANEL_FONT_SCALE);
    text(this.label, this.x + 22.0 * this.scale, this.y, this.w - 22.0 * this.scale, this.h);
  }

  press(px, py) {
    if (!this.visible || px < this.x || px > this.x + this.w
        || py < this.y || py > this.y + this.h) return false;
    this.checked = !this.checked;
    return true;
  }
}

// A row of equally wide buttons. The segmented rows — control mode, manual
// vector type, the sheet's tabs — mark one entry as selected; the pause and
// reset pair marks none, or the pause entry while the simulation is held.
class ButtonRowControl {
  labels;
  selectedIndex = -1;
  x;
  y;
  w;
  h;
  gap = 0.0;
  scale = 1.0;
  visible = true;
  labelSize = 11.2;

  constructor(labels) {
    this.labels = labels;
  }

  setBounds(x, y, w, h, gap, scale) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.gap = gap;
    this.scale = scale;
  }

  buttonWidth() {
    return (this.w - this.gap * (this.labels.length - 1)) / this.labels.length;
  }

  buttonX(index) {
    return this.x + index * (this.buttonWidth() + this.gap);
  }

  drawControl() {
    if (!this.visible) return;
    let buttonWidth = this.buttonWidth();
    for (let i = 0; i < this.labels.length; i++) {
      let selected = this.selectedIndex === i;
      noStroke();
      fillTheme(selected ? theme().buttonFillSelected : theme().buttonFill);
      rect(this.buttonX(i), this.y, buttonWidth, this.h, 5.0 * this.scale);
      fillTheme(selected ? theme().buttonLabelSelected : theme().buttonLabel);
      textAlign(CENTER, CENTER);
      let size = fittedTextSize(this.labels[i], buttonWidth - 10.0 * this.scale,
        this.labelSize * this.scale * PANEL_FONT_SCALE, 8.0 * this.scale);
      textSize(size);
      text(this.labels[i], this.buttonX(i) + buttonWidth * 0.5, this.y + this.h * 0.48);
    }
  }

  press(px, py) {
    if (!this.visible || py < this.y || py > this.y + this.h) return -1;
    let buttonWidth = this.buttonWidth();
    for (let i = 0; i < this.labels.length; i++) {
      let x = this.buttonX(i);
      if (px >= x && px <= x + buttonWidth) return i;
    }
    return -1;
  }
}

// The round buttons the compact layout leaves on top of the machine: one opens
// the settings sheet, one holds and resumes the simulation.
const ICON_SETTINGS = 0;
const ICON_PAUSE = 1;
const ICON_PLAY = 2;

class IconButtonControl {
  icon;
  x;
  y;
  diameter;
  visible = false;

  constructor(icon) {
    this.icon = icon;
  }

  setBounds(x, y, diameter) {
    this.x = x;
    this.y = y;
    this.diameter = diameter;
  }

  drawControl(highlighted) {
    if (!this.visible) return;
    let radius = this.diameter * 0.5;
    noStroke();
    fillTheme(highlighted ? theme().iconButtonFillActive : theme().iconButtonFill);
    circle(this.x + radius, this.y + radius, this.diameter);
    strokeTheme(theme().iconButtonGlyph);
    strokeWeight(this.diameter * 0.055);
    noFill();
    let centreX = this.x + radius;
    let centreY = this.y + radius;
    // The glyphs are drawn rather than typed: a font that lacks them would
    // otherwise leave an empty circle with no way to tell what it does.
    if (this.icon === ICON_SETTINGS) {
      let reach = this.diameter * 0.26;
      let spacing = this.diameter * 0.17;
      for (let row = -1; row <= 1; row++) {
        let lineY = centreY + row * spacing;
        line(centreX - reach, lineY, centreX + reach, lineY);
        noStroke();
        fillTheme(theme().iconButtonGlyph);
        circle(centreX + row * reach * 0.55, lineY, this.diameter * 0.13);
        strokeTheme(theme().iconButtonGlyph);
        noFill();
      }
    } else if (this.icon === ICON_PAUSE) {
      let barOffset = this.diameter * 0.1;
      let barHeight = this.diameter * 0.19;
      line(centreX - barOffset, centreY - barHeight, centreX - barOffset, centreY + barHeight);
      line(centreX + barOffset, centreY - barHeight, centreX + barOffset, centreY + barHeight);
    } else {
      noStroke();
      fillTheme(theme().iconButtonGlyph);
      let reach = this.diameter * 0.17;
      triangle(centreX - reach * 0.75, centreY - reach, centreX - reach * 0.75, centreY + reach,
        centreX + reach, centreY);
    }
    noStroke();
  }

  press(px, py) {
    if (!this.visible) return false;
    let radius = this.diameter * 0.5;
    return dist(px, py, this.x + radius, this.y + radius) <= radius;
  }
}

class ControlPanel {
  parameters;
  settings;
  controller;
  lastArea = new Area();

  loadSlider;
  voltageSlider;
  frequencySlider;
  currentQSlider;
  currentKpSlider;
  currentKiSlider;
  speedSlider;
  speedKpSlider;
  speedKiSlider;

  speedLoopCheckbox;
  voltageCheckbox;
  emfCheckbox;
  alphaBetaAxesCheckbox;
  dqAxesCheckbox;
  alphaBetaProjectionCheckbox;
  dqProjectionCheckbox;
  lockDqCheckbox;
  themeCheckbox;

  modeButtons;
  manualVectorButtons;
  actionButtons;
  tabButtons;
  settingsButton;
  pauseButton;

  allSliders;
  allCheckboxes;
  allButtonRows;

  scale = 1.0;
  compact = false;
  sheetOpen = false;
  sheetTop = 0.0;
  sheetHeaderBottom = 0.0;
  sheetDragStartY = null;
  activeTab = TAB_CONTROL;
  // Layout writes the positioned entries here and both rendering and hit
  // testing read them, so a control's rectangle is decided in exactly one place.
  items = [];
  lastState = null;
  lastSimulator = null;

  constructor(parameters, settings, controller) {
    this.parameters = parameters;
    this.settings = settings;
    this.controller = controller;

    this.loadSlider = new SliderControl("Момент нагрузки", " Н·м",
      -parameters.maximumLoadTorque, parameters.maximumLoadTorque, settings.loadTorque);
    this.voltageSlider = new SliderControl("Амплитуда напряжения", " В",
      0.0, parameters.maximumVoltage, settings.openLoopVoltage);
    this.frequencySlider = new SliderControl("Электрическая частота", " Гц",
      -100.0, 100.0, settings.openLoopFrequency);
    this.currentQSlider = new SliderControl("Задание тока iq", " А",
      -parameters.maximumCurrent, parameters.maximumCurrent, settings.currentQReference);
    this.currentKpSlider = new SliderControl("Kp регулятора тока", "",
      0.0, 20.0, settings.currentKp);
    this.currentKiSlider = new SliderControl("Ki регулятора тока", "",
      0.0, 3000.0, settings.currentKi);
    this.speedSlider = new SliderControl("Задание скорости", " об/мин",
      -1000.0, 1000.0, settings.speedReferenceRpm);
    this.speedSlider.showPositiveSign = true;
    // Ranges bracket the tuning for J = 0.1: below Kp = 4 the step overshoots
    // visibly, and Ki past 60 trades settling time for a taller first peak.
    this.speedKpSlider = new SliderControl("Kp регулятора скорости", "",
      0.0, 10.0, settings.speedKp);
    this.speedKpSlider.decimalPlaces = 2;
    this.speedKiSlider = new SliderControl("Ki регулятора скорости", "",
      0.0, 100.0, settings.speedKi);
    this.speedKiSlider.decimalPlaces = 2;

    this.speedLoopCheckbox = new CheckboxControl("Контур скорости", settings.speedLoopEnabled);
    this.voltageCheckbox = new CheckboxControl("Вектор напряжения", settings.showVoltage);
    this.emfCheckbox = new CheckboxControl("Вектор ЭДС", settings.showEmf);
    this.alphaBetaAxesCheckbox = new CheckboxControl("Оси α–β", settings.showAlphaBetaAxes);
    this.dqAxesCheckbox = new CheckboxControl("Оси d–q", settings.showDqAxes);
    this.alphaBetaProjectionCheckbox = new CheckboxControl("Проекции iα, iβ", settings.showAlphaBetaProjections);
    this.dqProjectionCheckbox = new CheckboxControl("Проекции id, iq", settings.showDqProjections);
    this.lockDqCheckbox = new CheckboxControl("Зафиксировать оси d–q", settings.lockDqFrame);
    // Тема хранится не в настройках модели, а в Theme.js, поэтому флажок
    // читает её оттуда и сбросом параметров не затрагивается.
    this.themeCheckbox = new CheckboxControl("Светлая тема", isLightTheme());

    this.modeButtons = new ButtonRowControl(["Ручной", "Разомкнутый", "Векторный"]);
    this.manualVectorButtons = new ButtonRowControl(["Вектор тока", "Вектор напряжения"]);
    this.manualVectorButtons.labelSize = 11.0;
    this.actionButtons = new ButtonRowControl(["Пауза", "Сброс"]);
    this.actionButtons.labelSize = 12.5;
    this.tabButtons = new ButtonRowControl(["Управление", "Визуализация"]);
    this.tabButtons.labelSize = 12.0;
    this.settingsButton = new IconButtonControl(ICON_SETTINGS);
    this.pauseButton = new IconButtonControl(ICON_PAUSE);

    this.allSliders = [
      this.loadSlider, this.voltageSlider, this.frequencySlider, this.currentQSlider,
      this.currentKpSlider, this.currentKiSlider, this.speedSlider, this.speedKpSlider, this.speedKiSlider
    ];
    this.allCheckboxes = [
      this.speedLoopCheckbox, this.voltageCheckbox, this.emfCheckbox, this.alphaBetaAxesCheckbox,
      this.dqAxesCheckbox, this.alphaBetaProjectionCheckbox, this.dqProjectionCheckbox, this.lockDqCheckbox,
      this.themeCheckbox
    ];
    this.allButtonRows = [
      this.modeButtons, this.manualVectorButtons, this.actionButtons, this.tabButtons
    ];
  }

  visualisationCheckboxes() {
    return [
      this.voltageCheckbox, this.emfCheckbox, this.alphaBetaAxesCheckbox, this.dqAxesCheckbox,
      this.alphaBetaProjectionCheckbox, this.dqProjectionCheckbox, this.lockDqCheckbox,
      this.themeCheckbox
    ];
  }

  draw(area, motor, simulator, compact) {
    this.compact = compact;
    this.lastArea.set(area.x, area.y, area.w, area.h);
    this.lastState = motor.state;
    this.lastSimulator = simulator;
    this.syncSelections();
    if (compact) this.drawCompact(area);
    else this.drawDesktop(area);
  }

  syncSelections() {
    this.modeButtons.selectedIndex = this.settings.mode;
    this.manualVectorButtons.selectedIndex = this.settings.manualVectorType;
    this.actionButtons.labels[0] = simulationPaused ? "Продолжить" : "Пауза";
    this.actionButtons.selectedIndex = simulationPaused ? 0 : -1;
    this.tabButtons.selectedIndex = this.activeTab;
    this.pauseButton.icon = simulationPaused ? ICON_PLAY : ICON_PAUSE;
  }

  hideAllControls() {
    for (const slider of this.allSliders) slider.visible = false;
    for (const checkbox of this.allCheckboxes) checkbox.visible = false;
    for (const row of this.allButtonRows) row.visible = false;
    this.settingsButton.visible = false;
    this.pauseButton.visible = false;
  }

  // -- layout helpers -------------------------------------------------------

  addTitle(label, x, y, w, size) {
    this.items.push({ kind: "title", x, y, w, h: size, label, size });
  }

  addSection(label, x, y, w, advance) {
    this.items.push({ kind: "section", x, y, w, h: advance, label });
  }

  addControl(control) {
    control.visible = true;
    this.items.push({ kind: "control", control });
  }

  addSlider(slider, x, y, w, h) {
    slider.setBounds(x, y, w, h, this.scale);
    this.addControl(slider);
  }

  // -- desktop --------------------------------------------------------------

  drawDesktop(area) {
    this.scale = constrain(min(area.w / 640.0, area.h / 720.0), 0.68, 1.35);
    this.layoutDesktop(area);

    noStroke();
    fillTheme(theme().panelBackground);
    rect(area.x, area.y, area.w, area.h);
    fillTheme(theme().panelDivider);
    rect(area.x, area.y, max(1.0, this.scale), area.h);
    this.renderItems();
  }

  layoutDesktop(area) {
    this.hideAllControls();
    this.items = [];
    let scale = this.scale;
    let padding = 18.0 * scale;
    let contentX = area.x + padding;
    let contentWidth = area.w - 2.0 * padding;
    let y = area.y + 13.0 * scale;

    this.addTitle("Управление PMSM", contentX, y, contentWidth, 21.0 * scale * PANEL_FONT_SCALE);
    y += 37.0 * scale;

    this.addSection("РЕЖИМ УПРАВЛЕНИЯ", contentX, y, contentWidth, 18.0 * scale);
    y += 18.0 * scale;

    this.modeButtons.setBounds(contentX, y, contentWidth, 31.0 * scale, 4.0 * scale, scale);
    this.addControl(this.modeButtons);
    y += 31.0 * scale + 10.0 * scale;

    this.addSlider(this.loadSlider, contentX, y, contentWidth, 39.0 * scale);
    y += 43.0 * scale;

    this.items.push({ kind: "status", x: contentX, y, w: contentWidth, h: 61.0 * scale });
    y += 70.0 * scale;

    y = this.layoutModeControls(contentX, y, contentWidth, 39.0 * scale, 22.0 * scale, false);

    y += 2.0 * scale;
    this.addSection("ВИЗУАЛИЗАЦИЯ", contentX, y, contentWidth, 21.0 * scale);
    y += 21.0 * scale;

    let columnGap = 12.0 * scale;
    let columnWidth = (contentWidth - columnGap) * 0.5;
    let visualChecks = this.visualisationCheckboxes();
    for (let i = 0; i < visualChecks.length; i++) {
      // Processing truncated this division because i was an int; in JavaScript
      // it yields halves, which staggered the two columns by half a row.
      let row = floor(i / 2);
      let column = i % 2;
      // Полная ширина нужна только последнему флажку, если он остался один в
      // строке; иначе он выехал бы за правый край панели из второй колонки.
      let checkWidth = i === visualChecks.length - 1 && column === 0
        ? contentWidth : columnWidth;
      visualChecks[i].setBounds(contentX + column * (columnWidth + columnGap),
        y + row * 25.0 * scale, checkWidth, 21.0 * scale, scale);
      this.addControl(visualChecks[i]);
    }

    this.actionButtons.setBounds(contentX, area.y + area.h - 46.0 * scale, contentWidth,
      32.0 * scale, 9.0 * scale, scale);
    this.addControl(this.actionButtons);
  }

  // Shared by both layouts: the mode buttons decide which references are on
  // offer, and that set is the same whichever way the panel is arranged.
  layoutModeControls(contentX, y, contentWidth, sliderHeight, rowHeight, compact) {
    let scale = this.scale;
    let sliderAdvance = sliderHeight + 4.0 * scale;

    if (this.settings.mode == MODE_MANUAL) {
      this.addSection("РУЧНОЕ ЗАДАНИЕ", contentX, y, contentWidth, 19.0 * scale);
      y += 19.0 * scale;
      this.manualVectorButtons.setBounds(contentX, y, contentWidth,
        compact ? rowHeight : 30.0 * scale, 5.0 * scale, scale);
      this.addControl(this.manualVectorButtons);
      y += (compact ? rowHeight : 30.0 * scale) + 9.0 * scale;
      // The same sentence wraps to three lines in a phone-width column, and a
      // hint clipped halfway through is worse than no hint at all.
      let hintHeight = (compact ? 78.0 : 48.0) * scale;
      this.items.push({ kind: "hint", x: contentX, y, w: contentWidth, h: hintHeight });
      y += hintHeight + 10.0 * scale;
      return y;
    }

    if (this.settings.mode == MODE_OPEN_LOOP) {
      this.addSlider(this.voltageSlider, contentX, y, contentWidth, sliderHeight);
      y += sliderAdvance;
      this.addSlider(this.frequencySlider, contentX, y, contentWidth, sliderHeight);
      y += sliderAdvance;
      return y;
    }

    if (!this.speedLoopCheckbox.checked) {
      this.addSlider(this.currentQSlider, contentX, y, contentWidth, sliderHeight);
      y += sliderAdvance;
    }
    this.addSlider(this.currentKpSlider, contentX, y, contentWidth, sliderHeight);
    y += sliderAdvance;
    this.addSlider(this.currentKiSlider, contentX, y, contentWidth, sliderHeight);
    y += sliderAdvance;
    this.speedLoopCheckbox.setBounds(contentX, y, contentWidth, rowHeight, scale);
    this.addControl(this.speedLoopCheckbox);
    y += rowHeight + 5.0 * scale;
    if (this.speedLoopCheckbox.checked) {
      this.addSlider(this.speedSlider, contentX, y, contentWidth, sliderHeight);
      y += sliderAdvance;
      this.addSlider(this.speedKpSlider, contentX, y, contentWidth, sliderHeight);
      y += sliderAdvance;
      this.addSlider(this.speedKiSlider, contentX, y, contentWidth, sliderHeight);
      y += sliderAdvance;
    }
    return y;
  }

  // -- compact --------------------------------------------------------------

  drawCompact(area) {
    this.scale = constrain(area.w / 360.0, 0.92, 1.30);
    this.hideAllControls();
    this.items = [];

    // Side by side rather than stacked: a single row fits in the gap the footer
    // leaves below the machine, where the buttons cover none of the winding.
    let buttonDiameter = max(TOUCH_TARGET_MINIMUM + 12.0, 56.0 * this.scale);
    let margin = 16.0 * this.scale;
    let buttonGap = 12.0 * this.scale;
    let buttonsY = area.y + area.h
      - motorViewFooterHeight(motorView.viewScale(area, true), true)
      - buttonDiameter - margin;
    let settingsX = area.x + area.w - margin - buttonDiameter;
    this.settingsButton.setBounds(settingsX, buttonsY, buttonDiameter);
    this.pauseButton.setBounds(settingsX - buttonDiameter - buttonGap, buttonsY, buttonDiameter);

    if (!this.sheetOpen) {
      this.sheetTop = area.y + area.h;
      this.settingsButton.visible = true;
      this.pauseButton.visible = true;
      this.pauseButton.drawControl(simulationPaused);
      this.settingsButton.drawControl(false);
      return;
    }
    // While the sheet is up the buttons would sit on top of its controls, and
    // both of them are already in it: the tabs hold pause, the scrim and the
    // handle close it.
    this.settingsButton.visible = false;
    this.pauseButton.visible = false;

    // Lay the sheet out against a zero origin to learn how tall it wants to be,
    // shrinking the rows if the screen cannot give it that, and only then place
    // it for real at the settled height.
    let rowFit = 1.0;
    let sheetHeight = 0.0;
    for (let pass = 0; pass < 3; pass++) {
      let needed = this.layoutSheet(area, rowFit, 0.0);
      sheetHeight = min(needed, area.h * SHEET_MAXIMUM_FRACTION);
      if (needed <= sheetHeight + 0.5) break;
      rowFit = max(SHEET_MINIMUM_ROW_FIT, rowFit * sheetHeight / needed);
    }
    sheetHeight = constrain(sheetHeight, area.h * SHEET_MINIMUM_FRACTION,
      area.h * SHEET_MAXIMUM_FRACTION);
    this.sheetTop = area.y + area.h - sheetHeight;
    this.layoutSheet(area, rowFit, this.sheetTop);

    noStroke();
    fillTheme(theme().sheetScrim);
    rect(area.x, area.y, area.w, area.h);
    fillTheme(theme().sheetBackground);
    let corner = 18.0 * this.scale;
    rect(area.x, this.sheetTop, area.w, sheetHeight, corner, corner, 0.0, 0.0);
    fillTheme(theme().sheetHandle);
    let handleWidth = 44.0 * this.scale;
    rect(area.x + (area.w - handleWidth) * 0.5, this.sheetTop + 8.0 * this.scale,
      handleWidth, 4.0 * this.scale, 2.0 * this.scale);
    this.renderItems();
  }

  // Builds the sheet at the given origin and reports the height it needs.
  layoutSheet(area, rowFit, originY) {
    this.hideAllControls();
    this.items = [];
    let scale = this.scale;
    let padding = 18.0 * scale;
    let contentX = area.x + padding;
    let contentWidth = area.w - 2.0 * padding;
    let sliderHeight = max(TOUCH_TARGET_MINIMUM, 52.0 * scale) * rowFit;
    let rowHeight = max(TOUCH_TARGET_MINIMUM, 34.0 * scale) * rowFit;
    let y = originY + 22.0 * scale;

    this.tabButtons.setBounds(contentX, y, contentWidth, rowHeight, 5.0 * scale, scale);
    this.addControl(this.tabButtons);
    y += rowHeight + 12.0 * scale;

    // The machine's own readout is behind the sheet while it is open, so the
    // live values travel with the controls that change them.
    this.items.push({ kind: "status", x: contentX, y, w: contentWidth, h: 61.0 * scale });
    y += 70.0 * scale;
    this.sheetHeaderBottom = y;

    if (this.activeTab === TAB_CONTROL) {
      this.addSection("РЕЖИМ УПРАВЛЕНИЯ", contentX, y, contentWidth, 18.0 * scale);
      y += 18.0 * scale;
      this.modeButtons.setBounds(contentX, y, contentWidth, rowHeight, 5.0 * scale, scale);
      this.addControl(this.modeButtons);
      y += rowHeight + 12.0 * scale;
      this.addSlider(this.loadSlider, contentX, y, contentWidth, sliderHeight);
      y += sliderHeight + 4.0 * scale;
      y = this.layoutModeControls(contentX, y, contentWidth, sliderHeight, rowHeight, true);
    } else {
      let visualChecks = this.visualisationCheckboxes();
      for (const checkbox of visualChecks) {
        checkbox.setBounds(contentX, y, contentWidth, rowHeight, scale);
        this.addControl(checkbox);
        y += rowHeight + 2.0 * scale;
      }
    }

    y += 8.0 * scale;
    this.actionButtons.setBounds(contentX, y, contentWidth, rowHeight, 9.0 * scale, scale);
    this.addControl(this.actionButtons);
    y += rowHeight;

    return y - originY + 18.0 * scale;
  }

  // -- rendering ------------------------------------------------------------

  renderItems() {
    for (const item of this.items) {
      switch (item.kind) {
        case "title":
          fillTheme(theme().panelTitle);
          textAlign(LEFT, TOP);
          fittedTextSize(item.label, item.w, item.size, 12.0 * this.scale);
          text(item.label, item.x, item.y);
          break;
        case "section":
          fillTheme(theme().panelSection);
          textAlign(LEFT, TOP);
          textSize(11.5 * this.scale * PANEL_FONT_SCALE);
          text(item.label, item.x, item.y);
          break;
        case "status":
          this.drawStatusCard(item.x, item.y, item.w, item.h);
          break;
        case "hint":
          this.drawManualHint(item.x, item.y, item.w, item.h);
          break;
        case "control":
          item.control.drawControl();
          break;
      }
    }
  }

  drawStatusCard(x, y, w, h) {
    let state = this.lastState;
    noStroke();
    fillTheme(theme().statusCard);
    rect(x, y, w, h, 7.0 * this.scale);
    let third = w / 3.0;
    this.drawStatusValue(x + 10.0 * this.scale, y + 8.0 * this.scale,
      "СКОРОСТЬ", this.formatPanelSpeed(rpmFromRadians(state.mechanicalSpeed)) + " об/мин");
    this.drawStatusValue(x + third + 5.0 * this.scale, y + 8.0 * this.scale,
      "ТОК", nf(sqrt(state.currentAlpha * state.currentAlpha
        + state.currentBeta * state.currentBeta), 1, 1) + " А");
    this.drawStatusValue(x + 2.0 * third + 5.0 * this.scale, y + 8.0 * this.scale,
      "МОМЕНТ", nf(state.electromagneticTorque, 1, 2) + " Н·м");
  }

  formatPanelSpeed(rpm) {
    let roundedMagnitude = round(abs(rpm));
    if (roundedMagnitude == 0) return "0";
    return (rpm > 0.0 ? "+" : "−") + str(roundedMagnitude);
  }

  drawStatusValue(x, y, caption, value) {
    fillTheme(theme().statusCaption);
    textAlign(LEFT, TOP);
    textSize(9.5 * this.scale * PANEL_FONT_SCALE);
    text(caption, x, y);
    fillTheme(theme().statusValue);
    textSize(13.0 * this.scale * PANEL_FONT_SCALE);
    text(value, x, y + 19.0 * this.scale);
  }

  drawManualHint(x, y, w, h) {
    noStroke();
    fillTheme(theme().hintCard);
    rect(x, y, w, h, 6.0 * this.scale);
    fillTheme(theme().hintText);
    textAlign(LEFT, CENTER);
    textSize(11.5 * this.scale * PANEL_FONT_SCALE);
    let vectorName = this.settings.manualVectorType == MANUAL_VECTOR_CURRENT
      ? "тока — регуляторы поддерживают i*"
      : "напряжения — u* подаётся напрямую";
    // On a phone the stator is behind this very sheet, and the instruction is
    // useless without saying so first.
    let opening = this.compact
      ? "Закройте настройки и тяните внутри статора,"
      : "Нажмите и тяните внутри статора,";
    // The box form measures from the top edge, so the card's own y goes in and
    // the vertical CENTER alignment does the centring.
    text(opening + "\nчтобы задать вектор " + vectorName + ".",
      x + 11.0 * this.scale, y, w - 22.0 * this.scale, h);
  }

  // -- input ----------------------------------------------------------------

  mousePressed(px, py) {
    if (this.compact) return this.compactMousePressed(px, py);
    if (!this.lastArea.contains(px, py)) return false;
    this.hitTestItems(px, py);
    return true;
  }

  compactMousePressed(px, py) {
    if (this.settingsButton.press(px, py)) {
      this.sheetOpen = !this.sheetOpen;
      return true;
    }
    if (this.pauseButton.press(px, py)) {
      simulationPaused = !simulationPaused;
      return true;
    }
    if (!this.sheetOpen) return false;
    if (py < this.sheetTop) {
      // Tapping the machine behind the sheet dismisses it rather than starting
      // a manual vector drag the finger cannot see.
      this.sheetOpen = false;
      return true;
    }
    if (!this.hitTestItems(px, py) && py <= this.sheetHeaderBottom) {
      this.sheetDragStartY = py;
    }
    return true;
  }

  hitTestItems(px, py) {
    for (const item of this.items) {
      if (item.kind !== "control") continue;
      let control = item.control;
      if (control === this.modeButtons) {
        let index = control.press(px, py);
        if (index < 0) continue;
        this.controller.setMode(index, motor.state);
        this.applyWidgetValues();
        return true;
      }
      if (control === this.manualVectorButtons) {
        let index = control.press(px, py);
        if (index < 0) continue;
        this.controller.setManualVectorType(index);
        return true;
      }
      if (control === this.tabButtons) {
        let index = control.press(px, py);
        if (index < 0) continue;
        this.activeTab = index;
        return true;
      }
      if (control === this.actionButtons) {
        let index = control.press(px, py);
        if (index < 0) continue;
        if (index === 0) simulationPaused = !simulationPaused;
        else resetSimulation();
        return true;
      }
      if (control.press(px, py)) {
        this.applyWidgetValues();
        if (control === this.lockDqCheckbox) {
          // Capture the rotor angle at the actual click, before the next physics frame.
          motorView.updateReferenceFrame(motor.state);
        }
        return true;
      }
    }
    return false;
  }

  mouseDragged(px, py) {
    let handled = false;
    for (const slider of this.allSliders) {
      handled |= slider.drag(px);
    }
    if (handled) {
      this.applyWidgetValues();
      return true;
    }
    if (this.compact) {
      if (this.sheetDragStartY !== null) {
        if (py - this.sheetDragStartY > SHEET_DISMISS_DISTANCE * this.scale) {
          this.sheetOpen = false;
          this.sheetDragStartY = null;
        }
        return true;
      }
      return this.sheetOpen && py >= this.sheetTop;
    }
    return this.lastArea.contains(px, py);
  }

  mouseReleased() {
    for (const slider of this.allSliders) slider.release();
    this.sheetDragStartY = null;
  }

  applyWidgetValues() {
    this.settings.loadTorque = this.loadSlider.value;
    this.settings.openLoopVoltage = this.voltageSlider.value;
    this.settings.openLoopFrequency = this.frequencySlider.value;
    this.settings.currentQReference = this.currentQSlider.value;
    this.settings.currentKp = this.currentKpSlider.value;
    this.settings.currentKi = this.currentKiSlider.value;
    this.settings.speedReferenceRpm = this.speedSlider.value;
    this.settings.speedKp = this.speedKpSlider.value;
    this.settings.speedKi = this.speedKiSlider.value;

    this.settings.speedLoopEnabled = this.speedLoopCheckbox.checked;
    this.settings.showVoltage = this.voltageCheckbox.checked;
    this.settings.showEmf = this.emfCheckbox.checked;
    this.settings.showAlphaBetaAxes = this.alphaBetaAxesCheckbox.checked;
    this.settings.showDqAxes = this.dqAxesCheckbox.checked;
    this.settings.showAlphaBetaProjections = this.alphaBetaProjectionCheckbox.checked;
    this.settings.showDqProjections = this.dqProjectionCheckbox.checked;
    this.settings.lockDqFrame = this.lockDqCheckbox.checked;

    let requestedTheme = this.themeCheckbox.checked ? THEME_LIGHT : THEME_DARK;
    if (requestedTheme !== currentThemeName()) setTheme(requestedTheme);
  }

  syncWidgetsFromSettings() {
    this.loadSlider.value = this.settings.loadTorque;
    this.voltageSlider.value = this.settings.openLoopVoltage;
    this.frequencySlider.value = this.settings.openLoopFrequency;
    this.currentQSlider.value = this.settings.currentQReference;
    this.currentKpSlider.value = this.settings.currentKp;
    this.currentKiSlider.value = this.settings.currentKi;
    this.speedSlider.value = this.settings.speedReferenceRpm;
    this.speedKpSlider.value = this.settings.speedKp;
    this.speedKiSlider.value = this.settings.speedKi;

    this.speedLoopCheckbox.checked = this.settings.speedLoopEnabled;
    this.voltageCheckbox.checked = this.settings.showVoltage;
    this.emfCheckbox.checked = this.settings.showEmf;
    this.alphaBetaAxesCheckbox.checked = this.settings.showAlphaBetaAxes;
    this.dqAxesCheckbox.checked = this.settings.showDqAxes;
    this.alphaBetaProjectionCheckbox.checked = this.settings.showAlphaBetaProjections;
    this.dqProjectionCheckbox.checked = this.settings.showDqProjections;
    this.lockDqCheckbox.checked = this.settings.lockDqFrame;
    this.themeCheckbox.checked = isLightTheme();
  }
}

const PANEL_FONT_SCALE = 1.15;

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

  update(sketchWidth, sketchHeight) {
    let divider = sketchWidth * 0.5;
    this.motorArea.set(0.0, 0.0, divider, sketchHeight);
    this.panelArea.set(divider, 0.0, sketchWidth - divider, sketchHeight);
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

  setBounds(x, y, w, h) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }

  drawControl(uiScale) {
    if (!this.visible) return;

    fill(205, 214, 228);
    textAlign(LEFT, TOP);
    textSize(12.5 * uiScale * PANEL_FONT_SCALE);
    text(this.label, this.x, this.y);
    textAlign(RIGHT, TOP);
    text(this.formatValue(this.value) + this.suffix, this.x + this.w, this.y);

    let trackY = this.y + 25.0 * uiScale;
    stroke(66, 77, 94);
    strokeWeight(4.0 * uiScale);
    line(this.x, trackY, this.x + this.w, trackY);
    let fraction = (this.value - this.minimum) / (this.maximum - this.minimum);
    stroke(75, 184, 226);
    line(this.x, trackY, this.x + this.w * fraction, trackY);
    noStroke();
    fill(this.dragging ? color(130, 220, 255) : color(228, 239, 247));
    circle(this.x + this.w * fraction, trackY, 13.0 * uiScale);
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

  press(px, py, uiScale) {
    if (!this.visible) return false;
    let trackY = this.y + 25.0 * uiScale;
    if (px >= this.x - 8.0 * uiScale && px <= this.x + this.w + 8.0 * uiScale
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
  visible = true;

  constructor(label, checked) {
    this.label = label;
    this.checked = checked;
  }

  setBounds(x, y, w, h) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }

  drawControl(uiScale) {
    if (!this.visible) return;
    let boxSize = 15.0 * uiScale;
    stroke(105, 122, 145);
    strokeWeight(1.2 * uiScale);
    fill(28, 34, 45);
    rect(this.x, this.y + 2.0 * uiScale, boxSize, boxSize, 3.0 * uiScale);
    if (this.checked) {
      noStroke();
      fill(68, 190, 226);
      rect(this.x + 3.0 * uiScale, this.y + 5.0 * uiScale,
        boxSize - 6.0 * uiScale, boxSize - 6.0 * uiScale, 2.0 * uiScale);
    }
    fill(211, 220, 232);
    textAlign(LEFT, TOP);
    textSize(12.0 * uiScale * PANEL_FONT_SCALE);
    text(this.label, this.x + 22.0 * uiScale, this.y, this.w - 22.0 * uiScale, this.h);
  }

  press(px, py) {
    if (!this.visible || px < this.x || px > this.x + this.w || py < this.y || py > this.y + this.h) return false;
    this.checked = !this.checked;
    return true;
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

  allSliders;
  allCheckboxes;

  uiScale = 1.0;
  modeButtonsX;
  modeButtonsY;
  modeButtonWidth;
  modeButtonHeight;
  actionButtonY;
  actionButtonWidth;
  manualVectorButtonsX;
  manualVectorButtonsY;
  manualVectorButtonWidth;
  manualVectorButtonHeight;

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

    this.allSliders = [
      this.loadSlider, this.voltageSlider, this.frequencySlider, this.currentQSlider,
      this.currentKpSlider, this.currentKiSlider, this.speedSlider, this.speedKpSlider, this.speedKiSlider
    ];
    this.allCheckboxes = [
      this.speedLoopCheckbox, this.voltageCheckbox, this.emfCheckbox, this.alphaBetaAxesCheckbox,
      this.dqAxesCheckbox, this.alphaBetaProjectionCheckbox, this.dqProjectionCheckbox, this.lockDqCheckbox
    ];
  }

  draw(area, motor, simulator) {
    this.lastArea.set(area.x, area.y, area.w, area.h);
    this.uiScale = constrain(min(area.w / 640.0, area.h / 720.0), 0.68, 1.35);
    let padding = 18.0 * this.uiScale;
    let contentX = area.x + padding;
    let contentWidth = area.w - 2.0 * padding;
    let y = area.y + 13.0 * this.uiScale;

    noStroke();
    fill(23, 28, 38);
    rect(area.x, area.y, area.w, area.h);
    fill(47, 57, 73);
    rect(area.x, area.y, max(1.0, this.uiScale), area.h);

    fill(237, 242, 249);
    textAlign(LEFT, TOP);
    textSize(21.0 * this.uiScale * PANEL_FONT_SCALE);
    text("Управление PMSM", contentX, y);
    y += 37.0 * this.uiScale;

    fill(145, 159, 180);
    textSize(11.5 * this.uiScale * PANEL_FONT_SCALE);
    text("РЕЖИМ УПРАВЛЕНИЯ", contentX, y);
    y += 18.0 * this.uiScale;

    this.modeButtonsX = contentX;
    this.modeButtonsY = y;
    this.modeButtonHeight = 31.0 * this.uiScale;
    this.modeButtonWidth = (contentWidth - 8.0 * this.uiScale) / 3.0;
    this.drawModeButton(0, "Ручной");
    this.drawModeButton(1, "Разомкнутый");
    this.drawModeButton(2, "Векторный");
    y += this.modeButtonHeight + 10.0 * this.uiScale;

    this.loadSlider.visible = true;
    this.loadSlider.setBounds(contentX, y, contentWidth, 39.0 * this.uiScale);
    this.loadSlider.drawControl(this.uiScale);
    y += 43.0 * this.uiScale;

    this.drawStatusCard(contentX, y, contentWidth, 61.0 * this.uiScale, motor.state, simulator);
    y += 70.0 * this.uiScale;

    this.voltageSlider.visible = this.settings.mode == MODE_OPEN_LOOP;
    this.frequencySlider.visible = this.settings.mode == MODE_OPEN_LOOP;
    this.currentQSlider.visible = this.settings.mode == MODE_VECTOR && !this.speedLoopCheckbox.checked;
    this.currentKpSlider.visible = this.settings.mode == MODE_VECTOR;
    this.currentKiSlider.visible = this.settings.mode == MODE_VECTOR;
    this.speedLoopCheckbox.visible = this.settings.mode == MODE_VECTOR;
    this.speedSlider.visible = this.settings.mode == MODE_VECTOR && this.speedLoopCheckbox.checked;
    this.speedKpSlider.visible = this.settings.mode == MODE_VECTOR && this.speedLoopCheckbox.checked;
    this.speedKiSlider.visible = this.settings.mode == MODE_VECTOR && this.speedLoopCheckbox.checked;

    if (this.settings.mode == MODE_MANUAL) {
      fill(145, 159, 180);
      textAlign(LEFT, TOP);
      textSize(11.5 * this.uiScale * PANEL_FONT_SCALE);
      text("РУЧНОЕ ЗАДАНИЕ", contentX, y);
      y += 19.0 * this.uiScale;

      this.manualVectorButtonsX = contentX;
      this.manualVectorButtonsY = y;
      this.manualVectorButtonHeight = 30.0 * this.uiScale;
      this.manualVectorButtonWidth = (contentWidth - 5.0 * this.uiScale) * 0.5;
      this.drawManualVectorButton(MANUAL_VECTOR_CURRENT, "Вектор тока");
      this.drawManualVectorButton(MANUAL_VECTOR_VOLTAGE, "Вектор напряжения");
      y += this.manualVectorButtonHeight + 9.0 * this.uiScale;

      this.drawManualHint(contentX, y, contentWidth, 48.0 * this.uiScale);
      y += 58.0 * this.uiScale;
    } else if (this.settings.mode == MODE_OPEN_LOOP) {
      y = this.drawSliderAt(this.voltageSlider, contentX, y, contentWidth);
      y = this.drawSliderAt(this.frequencySlider, contentX, y, contentWidth);
    } else {
      if (this.currentQSlider.visible) y = this.drawSliderAt(this.currentQSlider, contentX, y, contentWidth);
      y = this.drawSliderAt(this.currentKpSlider, contentX, y, contentWidth);
      y = this.drawSliderAt(this.currentKiSlider, contentX, y, contentWidth);
      this.speedLoopCheckbox.setBounds(contentX, y, contentWidth, 22.0 * this.uiScale);
      this.speedLoopCheckbox.drawControl(this.uiScale);
      y += 27.0 * this.uiScale;
      if (this.speedSlider.visible) {
        y = this.drawSliderAt(this.speedSlider, contentX, y, contentWidth);
        y = this.drawSliderAt(this.speedKpSlider, contentX, y, contentWidth);
        y = this.drawSliderAt(this.speedKiSlider, contentX, y, contentWidth);
      }
    }

    y += 2.0 * this.uiScale;
    fill(145, 159, 180);
    textAlign(LEFT, TOP);
    textSize(11.5 * this.uiScale * PANEL_FONT_SCALE);
    text("ВИЗУАЛИЗАЦИЯ", contentX, y);
    y += 21.0 * this.uiScale;

    let columnGap = 12.0 * this.uiScale;
    let columnWidth = (contentWidth - columnGap) * 0.5;
    let visualChecks = [
      this.voltageCheckbox, this.emfCheckbox, this.alphaBetaAxesCheckbox, this.dqAxesCheckbox,
      this.alphaBetaProjectionCheckbox, this.dqProjectionCheckbox, this.lockDqCheckbox
    ];
    for (let i = 0; i < visualChecks.length; i++) {
      let row = i / 2;
      let column = i % 2;
      let checkX = contentX + column * (columnWidth + columnGap);
      let checkY = y + row * 25.0 * this.uiScale;
      let checkWidth = columnWidth;
      if (i == visualChecks.length - 1) checkWidth = contentWidth;
      visualChecks[i].visible = true;
      visualChecks[i].setBounds(checkX, checkY, checkWidth, 21.0 * this.uiScale);
      visualChecks[i].drawControl(this.uiScale);
    }

    this.actionButtonY = area.y + area.h - 46.0 * this.uiScale;
    this.actionButtonWidth = (contentWidth - 9.0 * this.uiScale) * 0.5;
    this.drawActionButton(contentX, this.actionButtonY, this.actionButtonWidth, 32.0 * this.uiScale,
      simulationPaused ? "Продолжить" : "Пауза", simulationPaused);
    this.drawActionButton(contentX + this.actionButtonWidth + 9.0 * this.uiScale, this.actionButtonY,
      this.actionButtonWidth, 32.0 * this.uiScale, "Сброс", false);
  }

  drawSliderAt(slider, x, y, w) {
    slider.setBounds(x, y, w, 39.0 * this.uiScale);
    slider.drawControl(this.uiScale);
    return y + 43.0 * this.uiScale;
  }

  drawModeButton(index, label) {
    let x = this.modeButtonsX + index * (this.modeButtonWidth + 4.0 * this.uiScale);
    let selected = this.settings.mode == index;
    noStroke();
    fill(selected ? color(49, 142, 178) : color(38, 46, 60));
    rect(x, this.modeButtonsY, this.modeButtonWidth, this.modeButtonHeight, 5.0 * this.uiScale);
    fill(selected ? color(247) : color(180, 192, 210));
    textAlign(CENTER, CENTER);
    textSize(11.2 * this.uiScale * PANEL_FONT_SCALE);
    text(label, x + this.modeButtonWidth * 0.5, this.modeButtonsY + this.modeButtonHeight * 0.48);
  }

  drawManualVectorButton(vectorType, label) {
    let x = this.manualVectorButtonsX
      + vectorType * (this.manualVectorButtonWidth + 5.0 * this.uiScale);
    let selected = this.settings.manualVectorType == vectorType;
    noStroke();
    fill(selected ? color(49, 142, 178) : color(38, 46, 60));
    rect(x, this.manualVectorButtonsY, this.manualVectorButtonWidth,
      this.manualVectorButtonHeight, 5.0 * this.uiScale);
    fill(selected ? color(247) : color(180, 192, 210));
    textAlign(CENTER, CENTER);
    textSize(11.0 * this.uiScale * PANEL_FONT_SCALE);
    text(label, x + this.manualVectorButtonWidth * 0.5,
      this.manualVectorButtonsY + this.manualVectorButtonHeight * 0.48);
  }

  drawStatusCard(x, y, w, h, state,
                      simulator) {
    noStroke();
    fill(28, 35, 47);
    rect(x, y, w, h, 7.0 * this.uiScale);
    let third = w / 3.0;
    this.drawStatusValue(x + 10.0 * this.uiScale, y + 8.0 * this.uiScale,
      "СКОРОСТЬ", this.formatPanelSpeed(rpmFromRadians(state.mechanicalSpeed))
      + " об/мин");
    this.drawStatusValue(x + third + 5.0 * this.uiScale, y + 8.0 * this.uiScale,
      "ТОК", nf(sqrt(state.currentAlpha * state.currentAlpha + state.currentBeta * state.currentBeta), 1, 1) + " А");
    this.drawStatusValue(x + 2.0 * third + 5.0 * this.uiScale, y + 8.0 * this.uiScale,
      "МОМЕНТ", nf(state.electromagneticTorque, 1, 2) + " Н·м");
  }

  formatPanelSpeed(rpm) {
    let roundedMagnitude = round(abs(rpm));
    if (roundedMagnitude == 0) return "0";
    return (rpm > 0.0 ? "+" : "−") + str(roundedMagnitude);
  }

  drawStatusValue(x, y, caption, value) {
    fill(122, 139, 162);
    textAlign(LEFT, TOP);
    textSize(9.5 * this.uiScale * PANEL_FONT_SCALE);
    text(caption, x, y);
    fill(232, 238, 247);
    textSize(13.0 * this.uiScale * PANEL_FONT_SCALE);
    text(value, x, y + 19.0 * this.uiScale);
  }

  drawManualHint(x, y, w, h) {
    noStroke();
    fill(29, 44, 55);
    rect(x, y, w, h, 6.0 * this.uiScale);
    fill(155, 207, 226);
    textAlign(LEFT, CENTER);
    textSize(11.5 * this.uiScale * PANEL_FONT_SCALE);
    let vectorName = this.settings.manualVectorType == MANUAL_VECTOR_CURRENT
      ? "тока — регуляторы поддерживают i*"
      : "напряжения — u* подаётся напрямую";
    text("Нажмите и тяните мышь внутри статора,\nчтобы задать вектор " + vectorName + ".",
      x + 11.0 * this.uiScale, y + h * 0.5);
  }

  drawActionButton(x, y, w, h, label, active) {
    noStroke();
    fill(active ? color(158, 105, 47) : color(45, 55, 70));
    rect(x, y, w, h, 5.0 * this.uiScale);
    fill(226, 233, 242);
    textAlign(CENTER, CENTER);
    textSize(12.5 * this.uiScale * PANEL_FONT_SCALE);
    text(label, x + w * 0.5, y + h * 0.48);
  }

  mousePressed(px, py) {
    if (!this.lastArea.contains(px, py)) return false;

    for (let i = 0; i < 3; i++) {
      let x = this.modeButtonsX + i * (this.modeButtonWidth + 4.0 * this.uiScale);
      if (px >= x && px <= x + this.modeButtonWidth
          && py >= this.modeButtonsY && py <= this.modeButtonsY + this.modeButtonHeight) {
        this.controller.setMode(i, motor.state);
        this.applyWidgetValues();
        return true;
      }
    }

    if (this.settings.mode == MODE_MANUAL
        && py >= this.manualVectorButtonsY
        && py <= this.manualVectorButtonsY + this.manualVectorButtonHeight) {
      for (let vectorType = 0; vectorType < 2; vectorType++) {
        let x = this.manualVectorButtonsX
          + vectorType * (this.manualVectorButtonWidth + 5.0 * this.uiScale);
        if (px >= x && px <= x + this.manualVectorButtonWidth) {
          this.controller.setManualVectorType(vectorType);
          return true;
        }
      }
    }

    for (const slider of this.allSliders) {
      if (slider.press(px, py, this.uiScale)) {
        this.applyWidgetValues();
        return true;
      }
    }
    for (const checkbox of this.allCheckboxes) {
      if (checkbox.press(px, py)) {
        this.applyWidgetValues();
        if (checkbox == this.lockDqCheckbox) {
          // Capture the rotor angle at the actual click, before the next physics frame.
          motorView.updateReferenceFrame(motor.state);
        }
        return true;
      }
    }

    let contentX = this.lastArea.x + 18.0 * this.uiScale;
    if (py >= this.actionButtonY && py <= this.actionButtonY + 32.0 * this.uiScale) {
      if (px >= contentX && px <= contentX + this.actionButtonWidth) {
        simulationPaused = !simulationPaused;
      } else if (px >= contentX + this.actionButtonWidth + 9.0 * this.uiScale
          && px <= contentX + 2.0 * this.actionButtonWidth + 9.0 * this.uiScale) {
        resetSimulation();
      }
    }
    return true;
  }

  mouseDragged(px, py) {
    let handled = false;
    for (const slider of this.allSliders) {
      handled |= slider.drag(px);
    }
    if (handled) this.applyWidgetValues();
    return handled || this.lastArea.contains(px, py);
  }

  mouseReleased() {
    for (const slider of this.allSliders) slider.release();
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
  }
}

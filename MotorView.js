class MotorView {
  parameters;
  settings;

  centerX;
  centerY;
  outerRadius;
  statorInnerRadius;
  rotorRadius;

  previousLockState = false;
  returningToStationaryFrame = false;
  manualDragging = false;
  mechanicalAngleAtLock = 0.0;
  viewRotation = 0.0;

  constructor(parameters, settings) {
    this.parameters = parameters;
    this.settings = settings;
  }

  updateReferenceFrame(state) {
    if (this.settings.lockDqFrame && !this.previousLockState) {
      this.mechanicalAngleAtLock = state.mechanicalAngle;
      this.returningToStationaryFrame = false;
    }

    if (this.settings.lockDqFrame) {
      this.viewRotation = signedAngle(state.mechanicalAngle - this.mechanicalAngleAtLock);
    } else if (this.previousLockState) {
      this.returningToStationaryFrame = true;
    }

    if (this.returningToStationaryFrame) {
      this.viewRotation += signedAngle(-this.viewRotation) * 0.16;
      if (abs(signedAngle(this.viewRotation)) < 0.002) {
        this.viewRotation = 0.0;
        this.returningToStationaryFrame = false;
      }
    } else if (!this.settings.lockDqFrame) {
      this.viewRotation = 0.0;
    }
    this.previousLockState = this.settings.lockDqFrame;
  }

  resetReferenceFrame() {
    this.previousLockState = false;
    this.returningToStationaryFrame = false;
    this.manualDragging = false;
    this.viewRotation = 0.0;
    this.mechanicalAngleAtLock = 0.0;
  }

  updateGeometry(area) {
    this.centerX = area.x + area.w * 0.5;
    this.centerY = area.y + area.h * 0.46;
    this.outerRadius = min(area.w * 0.365, area.h * 0.315);
    this.statorInnerRadius = this.outerRadius * 0.72;
    this.rotorRadius = this.outerRadius * 0.49;
  }

  draw(area, motor, controller,
            simulator) {
    this.updateGeometry(area);
    let state = motor.state;

    noStroke();
    fill(18, 22, 30);
    rect(area.x, area.y, area.w, area.h);

    let uiScale = constrain(min(area.w / 640.0, area.h / 720.0), 0.68, 1.35);
    fill(235, 241, 248);
    textAlign(LEFT, TOP);
    textSize(19.0 * uiScale);
    text("Синхронная машина с постоянными магнитами", area.x + 17.0 * uiScale,
      area.y + 13.0 * uiScale);
    fill(130, 147, 169);
    textSize(11.5 * uiScale);
    let frameName = this.settings.lockDqFrame ? "система наблюдения d–q зафиксирована"
      : "неподвижная система α–β";
    text(frameName, area.x + 18.0 * uiScale, area.y + 41.0 * uiScale);
    fill(103, 119, 141);
    textSize(10.5 * uiScale);
    text("ψf = " + nf(this.parameters.magnetFlux, 1, 2)
      + " Вб; 18 пазов, q = 3;  • — из плоскости, × — в плоскость",
      area.x + 18.0 * uiScale, area.y + 57.0 * uiScale);

    this.drawStator(state);
    this.drawRotor(state);
    this.drawAxes(state);
    this.drawCurrentProjections(state);
    this.drawElectricalVectors(state);
    this.drawTorqueArcs(state);
    this.drawLegend(area, uiScale);
    this.drawReadout(area, state, simulator, uiScale);
  }

  screenAngle(physicalAngle) {
    return physicalAngle - this.viewRotation;
  }

  drawStator(state) {
    noStroke();
    fill(64, 73, 87);
    circle(this.centerX, this.centerY, this.outerRadius * 2.0);
    fill(30, 36, 47);
    circle(this.centerX, this.centerY, this.statorInnerRadius * 2.0);

    let speedFade = this.settings.lockDqFrame
      ? constrain(map(abs(rpmFromRadians(state.mechanicalSpeed)), 500.0, 3500.0, 1.0, 0.20), 0.20, 1.0)
      : 1.0;
    let slotCount = 18;
    // Six 60-electrical-degree phase belts for a two-pole, three-phase winding:
    // A+, C-, B+, A-, C+, B-. Each belt occupies q = 3 adjacent slots.
    let beltPhases = [ 0, 2, 1, 0, 2, 1 ];
    let statorAngle = this.screenAngle(0.0);
    for (let slot = 0; slot < slotCount; slot++) {
      let angle = statorAngle + TWO_PI * slot / slotCount;
      let inner = this.statorInnerRadius + this.outerRadius * 0.025;
      let outer = this.outerRadius * 0.95;
      stroke(31, 38, 49, 210.0 * speedFade);
      strokeWeight(max(1.0, this.outerRadius * 0.026));
      line(this.pointX(angle, inner), this.pointY(angle, inner), this.pointX(angle, outer), this.pointY(angle, outer));

      let belt = slot / 3;
      let phase = beltPhases[belt];
      let conductorDirection = belt % 2 == 0 ? 1 : -1;
      let phaseColor = phase == 0 ? color(225, 92, 83)
        : (phase == 1 ? color(91, 193, 126) : color(83, 139, 224));
      this.drawCoilSide(angle, phaseColor, conductorDirection, speedFade);

      if (slot % 3 == 1) {
        let phaseName = phase == 0 ? "A" : (phase == 1 ? "B" : "C");
        noStroke();
        fill(red(phaseColor), green(phaseColor), blue(phaseColor), 225.0 * speedFade);
        textAlign(CENTER, CENTER);
        textSize(max(8.0, this.outerRadius * 0.052));
        text(phaseName + (conductorDirection > 0 ? "+" : "−"),
          this.pointX(angle, this.outerRadius * 0.895), this.pointY(angle, this.outerRadius * 0.895));
      }
    }

    noFill();
    stroke(112, 125, 145);
    strokeWeight(max(1.0, this.outerRadius * 0.009));
    circle(this.centerX, this.centerY, this.outerRadius * 2.0);
    circle(this.centerX, this.centerY, this.statorInnerRadius * 2.0);
  }

  drawCoilSide(angle, phaseColor, conductorDirection, fade) {
    let markerX = this.pointX(angle, this.outerRadius * 0.82);
    let markerY = this.pointY(angle, this.outerRadius * 0.82);
    let markerSize = max(7.0, this.outerRadius * 0.052);

    stroke(red(phaseColor), green(phaseColor), blue(phaseColor), 225.0 * fade);
    strokeWeight(max(1.0, this.outerRadius * 0.008));
    fill(39, 45, 57, 230.0 * fade);
    circle(markerX, markerY, markerSize);

    if (conductorDirection > 0) {
      noStroke();
      fill(red(phaseColor), green(phaseColor), blue(phaseColor), 245.0 * fade);
      circle(markerX, markerY, markerSize * 0.33);
    } else {
      let crossRadius = markerSize * 0.23;
      stroke(red(phaseColor), green(phaseColor), blue(phaseColor), 245.0 * fade);
      strokeWeight(max(1.0, this.outerRadius * 0.009));
      line(markerX - crossRadius, markerY - crossRadius,
        markerX + crossRadius, markerY + crossRadius);
      line(markerX - crossRadius, markerY + crossRadius,
        markerX + crossRadius, markerY - crossRadius);
    }
  }

  drawRotor(state) {
    let rotorScreenAngle = this.screenAngle(state.mechanicalAngle);
    let rpm = abs(rpmFromRadians(state.mechanicalSpeed));
    let movingFade = this.settings.lockDqFrame ? 1.0
      : constrain(map(rpm, 700.0, 3500.0, 1.0, 0.38), 0.38, 1.0);

    push();
    translate(this.centerX, this.centerY);
    rotate(-rotorScreenAngle);
    noStroke();
    fill(218, 75, 70, 255.0 * movingFade);
    arc(0.0, 0.0, this.rotorRadius * 2.0, this.rotorRadius * 2.0,
      -HALF_PI, HALF_PI, PIE);
    fill(67, 119, 211, 255.0 * movingFade);
    arc(0.0, 0.0, this.rotorRadius * 2.0, this.rotorRadius * 2.0,
      HALF_PI, PI + HALF_PI, PIE);
    pop();

    noFill();
    stroke(213, 222, 234, 210);
    strokeWeight(max(1.2, this.outerRadius * 0.012));
    circle(this.centerX, this.centerY, this.rotorRadius * 2.0);
    noStroke();
    fill(229, 235, 242, 245.0 * movingFade);
    textAlign(CENTER, CENTER);
    textSize(max(10.0, this.outerRadius * 0.075));
    text("N", this.pointX(rotorScreenAngle, this.rotorRadius * 0.58),
      this.pointY(rotorScreenAngle, this.rotorRadius * 0.58));
    text("S", this.pointX(rotorScreenAngle + PI, this.rotorRadius * 0.58),
      this.pointY(rotorScreenAngle + PI, this.rotorRadius * 0.58));

    noStroke();
    fill(19, 24, 32);
    circle(this.centerX, this.centerY, this.rotorRadius * 0.14);
    fill(151, 164, 183);
    circle(this.centerX, this.centerY, this.rotorRadius * 0.055);

  }

  drawAxes(state) {
    let axisRadius = this.statorInnerRadius * 0.94;
    if (this.settings.showAlphaBetaAxes) {
      this.drawAxis(this.screenAngle(0.0), axisRadius, color(112, 127, 147, 190), "α", "");
      this.drawAxis(this.screenAngle(HALF_PI), axisRadius, color(112, 127, 147, 190), "β", "");
    }
    if (this.settings.showDqAxes || this.settings.lockDqFrame) {
      this.drawAxis(this.screenAngle(state.electricalAngle), axisRadius * 0.91,
        color(246, 157, 68, 225), "d", "");
      this.drawAxis(this.screenAngle(state.electricalAngle + HALF_PI), axisRadius * 0.91,
        color(180, 116, 235, 225), "q", "");
    }
  }

  drawAxis(angle, radius, axisColor, positiveLabel,
                negativeLabel) {
    stroke(axisColor);
    strokeWeight(max(1.0, this.outerRadius * 0.006));
    line(this.pointX(angle + PI, radius), this.pointY(angle + PI, radius),
      this.pointX(angle, radius), this.pointY(angle, radius));
    noStroke();
    fill(axisColor);
    textAlign(CENTER, CENTER);
    textSize(max(9.0, this.outerRadius * 0.058));
    text(positiveLabel, this.pointX(angle, radius + this.outerRadius * 0.055),
      this.pointY(angle, radius + this.outerRadius * 0.055));
  }

  drawCurrentProjections(state) {
    let currentMagnitude = sqrt(state.currentAlpha * state.currentAlpha
      + state.currentBeta * state.currentBeta);
    // Use the same uniform scale as the displayed current vector. When the
    // vector reaches the visual limit, all of its components shrink together.
    let scale = this.limitedVectorScale(currentMagnitude, this.parameters.maximumCurrent,
      this.currentVectorMaximumLength());
    if (this.settings.showAlphaBetaProjections) {
      this.drawProjectionGuides(this.screenAngle(0.0), state.currentAlpha * scale,
        state.currentBeta * scale, color(70, 204, 217, 90));
      this.drawSignedComponent(this.screenAngle(0.0), state.currentAlpha * scale,
        color(70, 204, 217, 135), "iα");
      this.drawSignedComponent(this.screenAngle(HALF_PI), state.currentBeta * scale,
        color(70, 204, 217, 135), "iβ");
    }
    if (this.settings.showDqProjections) {
      this.drawProjectionGuides(this.screenAngle(state.electricalAngle), state.currentD * scale,
        state.currentQ * scale, color(220, 150, 235, 100));
      this.drawSignedComponent(this.screenAngle(state.electricalAngle), state.currentD * scale,
        color(246, 157, 68, 190), "id");
      this.drawSignedComponent(this.screenAngle(state.electricalAngle + HALF_PI), state.currentQ * scale,
        color(180, 116, 235, 190), "iq");
    }
  }

  drawElectricalVectors(state) {
    if (this.settings.mode == MODE_MANUAL) {
      if (this.settings.manualVectorType == MANUAL_VECTOR_CURRENT) {
        this.drawPhysicalVector(this.settings.manualCurrentAlpha, this.settings.manualCurrentBeta,
          this.parameters.maximumCurrent, this.currentVectorMaximumLength(),
          color(73, 220, 232, 90), "i*");
      } else {
        this.drawPhysicalVector(this.settings.manualVoltageAlpha, this.settings.manualVoltageBeta,
          MANUAL_MAXIMUM_VOLTAGE, this.statorInnerRadius * 0.91,
          color(247, 205, 74, 105), "u*");
      }
    }
    this.drawPhysicalVector(state.currentAlpha, state.currentBeta, this.parameters.maximumCurrent,
      this.currentVectorMaximumLength(), color(73, 220, 232), "i");
    if (this.settings.showVoltage) {
      let voltageScaleMaximum = this.settings.mode == MODE_MANUAL
          && this.settings.manualVectorType == MANUAL_VECTOR_VOLTAGE
        ? MANUAL_MAXIMUM_VOLTAGE
        : this.parameters.maximumVoltage;
      this.drawPhysicalVector(state.voltageAlpha, state.voltageBeta, voltageScaleMaximum,
        this.statorInnerRadius * 0.91, color(247, 205, 74), "u");
    }
    if (this.settings.showEmf) {
      this.drawPhysicalVector(state.emfAlpha, state.emfBeta, this.parameters.maximumVoltage,
        this.statorInnerRadius * 0.86, color(236, 102, 190), "E");
    }
  }

  drawPhysicalVector(alpha, beta, maximum, maximumLength,
                          vectorColor, label) {
    let magnitude = sqrt(alpha * alpha + beta * beta);
    if (magnitude < 0.001) return;
    let physicalAngle = atan2(beta, alpha);
    let length = magnitude * this.limitedVectorScale(magnitude, maximum, maximumLength);
    this.drawArrow(this.screenAngle(physicalAngle), length, vectorColor, label, 2.3);
  }

  limitedVectorScale(magnitude, nominalMaximum, maximumLength) {
    let normalScale = maximumLength / nominalMaximum;
    if (magnitude < 0.001) return normalScale;
    let saturatedScale = maximumLength * 1.15 / magnitude;
    return min(normalScale, saturatedScale);
  }

  drawSignedComponent(angle, signedLength, componentColor, label) {
    let maximumProjectionLength = this.currentVectorMaximumLength() * 1.15;
    let clampedLength = constrain(signedLength,
      -maximumProjectionLength, maximumProjectionLength);
    if (abs(clampedLength) < 1.0) return;
    if (clampedLength < 0.0) {
      angle += PI;
      clampedLength = -clampedLength;
    }
    this.drawArrow(angle, clampedLength, componentColor, label, 1.25);
  }

  drawProjectionGuides(firstAxisAngle, firstLength,
                            secondLength, guideColor) {
    let maximumLength = this.currentVectorMaximumLength() * 1.15;
    firstLength = constrain(firstLength, -maximumLength, maximumLength);
    secondLength = constrain(secondLength, -maximumLength, maximumLength);
    let secondAxisAngle = firstAxisAngle + HALF_PI;

    let firstX = this.pointX(firstAxisAngle, firstLength);
    let firstY = this.pointY(firstAxisAngle, firstLength);
    let secondX = this.pointX(secondAxisAngle, secondLength);
    let secondY = this.pointY(secondAxisAngle, secondLength);
    let tipX = firstX + secondLength * cos(secondAxisAngle);
    let tipY = firstY - secondLength * sin(secondAxisAngle);

    this.drawDashedLine(firstX, firstY, tipX, tipY, guideColor);
    this.drawDashedLine(secondX, secondY, tipX, tipY, guideColor);
  }

  drawDashedLine(x1, y1, x2, y2, lineColor) {
    let length = dist(x1, y1, x2, y2);
    if (length < 1.0) return;
    let segmentCount = max(1, ceil(length / 7.0));
    stroke(lineColor);
    strokeWeight(max(1.0, this.outerRadius * 0.005));
    for (let segment = 0; segment < segmentCount; segment += 2) {
      let startFraction = segment / segmentCount;
      let endFraction = min(1.0, (segment + 1) / segmentCount);
      line(lerp(x1, x2, startFraction), lerp(y1, y2, startFraction),
        lerp(x1, x2, endFraction), lerp(y1, y2, endFraction));
    }
  }

  drawArrow(angle, length, arrowColor, label, weightFactor) {
    let endX = this.pointX(angle, length);
    let endY = this.pointY(angle, length);
    stroke(arrowColor);
    strokeWeight(max(1.2, this.outerRadius * 0.008 * weightFactor));
    line(this.centerX, this.centerY, endX, endY);
    let headLength = constrain(length * 0.16, 6.0, 13.0);
    line(endX, endY,
      endX + headLength * cos(angle + PI - 0.45),
      endY - headLength * sin(angle + PI - 0.45));
    line(endX, endY,
      endX + headLength * cos(angle + PI + 0.45),
      endY - headLength * sin(angle + PI + 0.45));
    noStroke();
    fill(arrowColor);
    textAlign(CENTER, CENTER);
    textSize(max(9.0, this.outerRadius * 0.058));
    text(label, this.pointX(angle, length + 11.0), this.pointY(angle, length + 11.0));
  }

  drawTorqueArcs(state) {
    this.drawTorqueArc(state.electromagneticTorque, this.outerRadius * 1.08,
      color(75, 205, 126, 225));
    this.drawTorqueArc(-state.loadTorque, this.outerRadius * 1.17,
      color(241, 146, 71, 225));
  }

  drawTorqueArc(torque, radius, arcColor) {
    if (abs(torque) < 0.015) return;
    let direction = torque >= 0.0 ? 1.0 : -1.0;
    let normalized = constrain(abs(torque) / this.parameters.maximumLoadTorque, 0.0, 1.0);
    let sweep = direction * lerp(0.24 * PI, 1.22 * PI, normalized);
    let start = direction > 0.0 ? -0.70 * PI : -0.30 * PI;
    noFill();
    stroke(arcColor);
    strokeWeight(max(2.0, this.outerRadius * (0.012 + 0.014 * normalized)));
    this.drawMathArc(this.centerX, this.centerY, radius, start, sweep, 40);
    this.drawArcArrowHead(radius, start + sweep, direction, arcColor);
  }

  drawMathArc(cx, cy, radius, start, sweep, segments) {
    beginShape();
    for (let i = 0; i <= segments; i++) {
      let angle = start + sweep * i / segments;
      vertex(cx + radius * cos(angle), cy - radius * sin(angle));
    }
    endShape();
  }

  drawArcArrowHead(radius, endAngle, direction, arrowColor) {
    let endX = this.pointX(endAngle, radius);
    let endY = this.pointY(endAngle, radius);
    let tangentAngle = endAngle + direction * HALF_PI;
    let head = max(6.0, this.outerRadius * 0.045);
    stroke(arrowColor);
    strokeWeight(max(1.6, this.outerRadius * 0.012));
    line(endX, endY,
      endX + head * cos(tangentAngle + PI - 0.5),
      endY - head * sin(tangentAngle + PI - 0.5));
    line(endX, endY,
      endX + head * cos(tangentAngle + PI + 0.5),
      endY - head * sin(tangentAngle + PI + 0.5));
  }

  drawLegend(area, uiScale) {
    let x = area.x + 17.0 * uiScale;
    let y = area.y + area.h - 116.0 * uiScale;
    this.drawLegendItem(x, y, color(73, 220, 232), "ток i", uiScale);
    this.drawLegendItem(x + 85.0 * uiScale, y, color(247, 205, 74), "напряжение u", uiScale);
    this.drawLegendItem(x + 215.0 * uiScale, y, color(236, 102, 190), "ЭДС E", uiScale);
    this.drawLegendItem(x + 305.0 * uiScale, y, color(75, 205, 126), "Mдв", uiScale);
    this.drawLegendItem(x + 375.0 * uiScale, y, color(241, 146, 71), "Mнагр", uiScale);
  }

  drawLegendItem(x, y, itemColor, label, uiScale) {
    // Match the control panel's body text, PANEL_FONT_SCALE included: the motor
    // side never got that 15 % boost, which left the legend reading small next
    // to the panel. Deriving the marker and the gap from the label size keeps
    // the row balanced at whatever that size works out to.
    let labelSize = 12.5 * uiScale * PANEL_FONT_SCALE;
    let markerDiameter = labelSize * 0.62;
    let markerY = y + labelSize * 0.5;
    noStroke();
    fill(itemColor);
    circle(x + markerDiameter * 0.5, markerY, markerDiameter);
    fill(159, 174, 195);
    textAlign(LEFT, CENTER);
    textSize(labelSize);
    text(label, x + markerDiameter + labelSize * 0.35, markerY);
  }

  drawReadout(area, state, simulator, uiScale) {
    let x = area.x + 17.0 * uiScale;
    let y = area.y + area.h - 82.0 * uiScale;
    let w = area.w - 34.0 * uiScale;
    noStroke();
    fill(23, 29, 39);
    rect(x, y, w, 63.0 * uiScale, 7.0 * uiScale);

    fill(194, 205, 220);
    textAlign(LEFT, TOP);
    textSize(11.0 * uiScale);
    let lineOne = "n = " + formatSignedNumber(
      rpmFromRadians(state.mechanicalSpeed), 0) + " об/мин"
      + "     Mдв = " + nf(state.electromagneticTorque, 1, 2) + " Н·м"
      + "     Mнагр = " + nf(state.loadTorque, 1, 2) + " Н·м";
    let lineTwo = "id = " + nf(state.currentD, 1, 2) + " А"
      + "     iq = " + nf(state.currentQ, 1, 2) + " А"
      + "     |u| = " + nf(sqrt(state.voltageAlpha * state.voltageAlpha
      + state.voltageBeta * state.voltageBeta), 1, 1) + " В";
    text(lineOne, x + 11.0 * uiScale, y + 9.0 * uiScale);
    text(lineTwo, x + 11.0 * uiScale, y + 34.0 * uiScale);
    if (simulationPaused) {
      fill(245, 177, 80);
      textAlign(RIGHT, TOP);
      text("ПАУЗА", x + w - 10.0 * uiScale, y + 9.0 * uiScale);
    }
  }

  pointX(angle, radius) {
    return this.centerX + radius * cos(angle);
  }

  pointY(angle, radius) {
    return this.centerY - radius * sin(angle);
  }

  currentVectorMaximumLength() {
    return this.statorInnerRadius * 0.94;
  }

  currentPixelsPerAmp() {
    return this.currentVectorMaximumLength() / this.parameters.maximumCurrent;
  }

  mousePressed(px, py, area, controller) {
    this.updateGeometry(area);
    if (this.settings.mode != MODE_MANUAL) return;
    let distance = dist(px, py, this.centerX, this.centerY);
    if (distance <= this.manualVectorMaximumLength()) {
      this.manualDragging = true;
      this.updateManualVector(px, py, controller);
    }
  }

  mouseDragged(px, py, area, controller) {
    if (!this.manualDragging || this.settings.mode != MODE_MANUAL) return;
    this.updateGeometry(area);
    this.updateManualVector(px, py, controller);
  }

  mouseReleased() {
    this.manualDragging = false;
  }

  manualVectorMaximumLength() {
    return this.settings.manualVectorType == MANUAL_VECTOR_CURRENT
      ? this.currentVectorMaximumLength()
      : this.statorInnerRadius * 0.91;
  }

  updateManualVector(px, py, controller) {
    let dx = px - this.centerX;
    let dy = this.centerY - py;
    let distance = sqrt(dx * dx + dy * dy);
    let maximumLength = this.manualVectorMaximumLength();
    let maximumMagnitude = this.settings.manualVectorType == MANUAL_VECTOR_CURRENT
      ? this.parameters.maximumCurrent
      : MANUAL_MAXIMUM_VOLTAGE;
    let magnitude = constrain(distance / maximumLength, 0.0, 1.0) * maximumMagnitude;
    let screenVectorAngle = atan2(dy, dx);
    let physicalAngle = screenVectorAngle + this.viewRotation;
    let alpha = magnitude * cos(physicalAngle);
    let beta = magnitude * sin(physicalAngle);
    if (this.settings.manualVectorType == MANUAL_VECTOR_CURRENT) {
      controller.setManualCurrent(alpha, beta);
    } else {
      controller.setManualVoltage(alpha, beta);
    }
  }
}

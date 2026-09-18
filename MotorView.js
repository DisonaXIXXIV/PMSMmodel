// The machine view reserves a band at the top for its captions and a band at
// the bottom for the legend and the live values. In the compact layout that
// bottom card is also the home of the toolbar, so the whole dock is measured
// here once: the view draws the card, the control panel lays its buttons into
// the strip, and neither has to guess where the other put things.
// Шапка компактной компоновки: заголовок, система координат и примечание об
// обмотке. Её высота не задана числом, а складывается из этих отступов и того,
// на сколько строк разошлось примечание, — машина начинается сразу под текстом,
// а не под запасом на самый узкий экран.
const MOTOR_COMPACT_SIDE_MARGIN = 16.0;
const MOTOR_COMPACT_NOTE_TOP = 56.0;
const MOTOR_COMPACT_NOTE_SIZE = 10.5;
const MOTOR_COMPACT_NOTE_LEADING = 13.5;
const MOTOR_COMPACT_HEADER_PADDING = 12.0;
const MOTOR_LEGEND_ROW_HEIGHT = 24.0;
const MOTOR_READOUT_BOTTOM_MARGIN = 19.0;
const MOTOR_READOUT_LEGEND_GAP = 10.0;
const MOTOR_DOCK_SIDE_MARGIN = 17.0;
// Полоса действий — часть карточки показаний, а не кнопки поверх машины. При
// самом мелком масштабе компактной компоновки (0.92) эти 52 px дают 47.8 px
// высоты, то есть остаются выше порога комфортного касания.
const MOTOR_TOOLBAR_HEIGHT = 52.0;

function motorViewLegendRows(compact) {
  return compact ? 2 : 1;
}

function motorViewReadoutHeight(scale, compact) {
  return (compact ? 89.0 : 63.0) * scale;
}

function motorViewToolbarHeight(scale, compact) {
  return compact ? MOTOR_TOOLBAR_HEIGHT * scale : 0.0;
}

// Карточка у нижнего края: показания, а под ними — в компактной компоновке —
// полоса кнопок. Возвращает и внешний прямоугольник карточки, и границу между
// двумя её частями, потому что рисуют их разные классы.
function motorViewDockBounds(area, scale, compact) {
  let readoutHeight = motorViewReadoutHeight(scale, compact);
  let toolbarHeight = motorViewToolbarHeight(scale, compact);
  let height = readoutHeight + toolbarHeight;
  return {
    x: area.x + MOTOR_DOCK_SIDE_MARGIN * scale,
    y: area.y + area.h - MOTOR_READOUT_BOTTOM_MARGIN * scale - height,
    w: area.w - 2.0 * MOTOR_DOCK_SIDE_MARGIN * scale,
    h: height,
    readoutHeight,
    toolbarHeight,
    toolbarY: area.y + area.h - MOTOR_READOUT_BOTTOM_MARGIN * scale - toolbarHeight,
  };
}

function motorViewFooterHeight(scale, compact) {
  return motorViewLegendRows(compact) * MOTOR_LEGEND_ROW_HEIGHT * scale
    + MOTOR_READOUT_LEGEND_GAP * scale
    + motorViewReadoutHeight(scale, compact)
    + motorViewToolbarHeight(scale, compact)
    + MOTOR_READOUT_BOTTOM_MARGIN * scale;
}

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

  // The compact layout hands the view the whole screen, so the machine is sized
  // against the free band between the captions and the readout rather than
  // against a half-width column.
  viewScale(area, compact) {
    if (compact) return constrain(area.w / 360.0, 0.92, 1.30);
    return constrain(min(area.w / 640.0, area.h / 720.0), 0.68, 1.35);
  }

  updateGeometry(area, compact) {
    this.centerX = area.x + area.w * 0.5;
    if (compact) {
      let scale = this.viewScale(area, true);
      let bandTop = area.y + this.compactHeaderHeight(area, scale);
      let bandBottom = area.y + area.h - motorViewFooterHeight(scale, true);
      this.centerY = (bandTop + bandBottom) * 0.5;
      this.outerRadius = min(area.w * 0.46, (bandBottom - bandTop) * 0.46);
    } else {
      this.centerY = area.y + area.h * 0.46;
      this.outerRadius = min(area.w * 0.365, area.h * 0.315);
    }
    this.statorInnerRadius = this.outerRadius * 0.72;
    this.rotorRadius = this.outerRadius * 0.49;
  }

  draw(area, motor, controller,
            simulator, compact) {
    this.updateGeometry(area, compact);
    let state = motor.state;

    noStroke();
    fillTheme(theme().motorBackground);
    rect(area.x, area.y, area.w, area.h);

    let scale = this.viewScale(area, compact);
    this.drawCaptions(area, scale, compact);

    this.drawStator(state);
    this.drawRotor(state);
    this.drawAxes(state);
    this.drawCurrentProjections(state);
    this.drawElectricalVectors(state);
    this.drawTorqueArcs(state);
    this.drawLegend(area, scale, compact);
    this.drawReadout(area, state, simulator, scale, compact);
  }

  windingNote() {
    return "ψf = " + nf(this.parameters.magnetFlux, 1, 2)
      + " Вб; 18 пазов, q = 3;  • — из плоскости, × — в плоскость";
  }

  // Примечание переносится по словам здесь, а не отдаётся текстовому блоку p5:
  // тогда шапка знает свою высоту заранее и рисует ровно то, что измерила.
  compactNoteLines(area, scale) {
    textSize(MOTOR_COMPACT_NOTE_SIZE * scale);
    let words = this.windingNote().split(/\s+/).filter((word) => word.length > 0);
    let widths = words.map((word) => textWidth(word));
    let lines = flowIntoLines(widths, textWidth(" "),
      area.w - 2.0 * MOTOR_COMPACT_SIDE_MARGIN * scale);
    return lines.map((line) => line.map((index) => words[index]).join(" "));
  }

  compactHeaderHeight(area, scale) {
    let lines = this.compactNoteLines(area, scale).length;
    return (MOTOR_COMPACT_NOTE_TOP + MOTOR_COMPACT_HEADER_PADDING) * scale
      + lines * MOTOR_COMPACT_NOTE_LEADING * scale;
  }

  drawCaptions(area, scale, compact) {
    let x = area.x + (compact ? MOTOR_COMPACT_SIDE_MARGIN : 17.0) * scale;
    let frameName = this.settings.lockDqFrame ? "система наблюдения d–q зафиксирована"
      : "неподвижная система α–β";

    fillTheme(theme().motorTitle);
    textAlign(LEFT, TOP);
    if (compact) {
      // The title is the widest fixed string on the screen; on a phone it has
      // to give way rather than run off the edge.
      fittedTextSize("Синхронная машина с постоянными магнитами",
        area.w - 2.0 * MOTOR_COMPACT_SIDE_MARGIN * scale, 19.0 * scale, 11.0 * scale);
    } else {
      textSize(19.0 * scale);
    }
    text("Синхронная машина с постоянными магнитами", x, area.y + (compact ? 12.0 : 13.0) * scale);

    fillTheme(theme().motorSubtitle);
    textSize(11.5 * scale);
    text(frameName, area.x + (compact ? MOTOR_COMPACT_SIDE_MARGIN : 18.0) * scale,
      area.y + (compact ? 38.0 : 41.0) * scale);

    fillTheme(theme().motorNote);
    if (compact) {
      let lines = this.compactNoteLines(area, scale);
      textSize(MOTOR_COMPACT_NOTE_SIZE * scale);
      for (let i = 0; i < lines.length; i++) {
        text(lines[i], x, area.y + (MOTOR_COMPACT_NOTE_TOP
          + i * MOTOR_COMPACT_NOTE_LEADING) * scale);
      }
    } else {
      textSize(10.5 * scale);
      text(this.windingNote(), area.x + 18.0 * scale, area.y + 57.0 * scale);
    }
  }

  screenAngle(physicalAngle) {
    return physicalAngle - this.viewRotation;
  }

  drawStator(state) {
    noStroke();
    fillTheme(theme().statorYoke);
    circle(this.centerX, this.centerY, this.outerRadius * 2.0);
    fillTheme(theme().statorBore);
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
      strokeTheme(theme().statorSlot, 210.0 * speedFade);
      strokeWeight(max(1.0, this.outerRadius * 0.026));
      line(this.pointX(angle, inner), this.pointY(angle, inner), this.pointX(angle, outer), this.pointY(angle, outer));

      let belt = slot / 3;
      let phase = beltPhases[belt];
      let conductorDirection = belt % 2 == 0 ? 1 : -1;
      let phaseColor = phase == 0 ? themeColor(theme().phaseA)
        : (phase == 1 ? themeColor(theme().phaseB) : themeColor(theme().phaseC));
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
    strokeTheme(theme().statorOutline);
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
    fillTheme(theme().coilMarkerFill, 230.0 * fade);
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
    fillTheme(theme().rotorNorth, 255.0 * movingFade);
    arc(0.0, 0.0, this.rotorRadius * 2.0, this.rotorRadius * 2.0,
      -HALF_PI, HALF_PI, PIE);
    fillTheme(theme().rotorSouth, 255.0 * movingFade);
    arc(0.0, 0.0, this.rotorRadius * 2.0, this.rotorRadius * 2.0,
      HALF_PI, PI + HALF_PI, PIE);
    pop();

    noFill();
    strokeTheme(theme().rotorOutline);
    strokeWeight(max(1.2, this.outerRadius * 0.012));
    circle(this.centerX, this.centerY, this.rotorRadius * 2.0);
    noStroke();
    fillTheme(theme().rotorPoleLabel, 245.0 * movingFade);
    textAlign(CENTER, CENTER);
    textSize(max(10.0, this.outerRadius * 0.075));
    text("N", this.pointX(rotorScreenAngle, this.rotorRadius * 0.58),
      this.pointY(rotorScreenAngle, this.rotorRadius * 0.58));
    text("S", this.pointX(rotorScreenAngle + PI, this.rotorRadius * 0.58),
      this.pointY(rotorScreenAngle + PI, this.rotorRadius * 0.58));

    noStroke();
    fillTheme(theme().shaftOuter);
    circle(this.centerX, this.centerY, this.rotorRadius * 0.14);
    fillTheme(theme().shaftInner);
    circle(this.centerX, this.centerY, this.rotorRadius * 0.055);

  }

  drawAxes(state) {
    let axisRadius = this.statorInnerRadius * 0.94;
    if (this.settings.showAlphaBetaAxes) {
      this.drawAxis(this.screenAngle(0.0), axisRadius, themeColor(theme().axisAlphaBeta), "α", "");
      this.drawAxis(this.screenAngle(HALF_PI), axisRadius, themeColor(theme().axisAlphaBeta), "β", "");
    }
    if (this.settings.showDqAxes || this.settings.lockDqFrame) {
      this.drawAxis(this.screenAngle(state.electricalAngle), axisRadius * 0.91,
        themeColor(theme().axisD), "d", "");
      this.drawAxis(this.screenAngle(state.electricalAngle + HALF_PI), axisRadius * 0.91,
        themeColor(theme().axisQ), "q", "");
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
        state.currentBeta * scale, themeColor(theme().guideAlphaBeta));
      this.drawSignedComponent(this.screenAngle(0.0), state.currentAlpha * scale,
        themeColor(theme().componentAlphaBeta), "iα");
      this.drawSignedComponent(this.screenAngle(HALF_PI), state.currentBeta * scale,
        themeColor(theme().componentAlphaBeta), "iβ");
    }
    if (this.settings.showDqProjections) {
      this.drawProjectionGuides(this.screenAngle(state.electricalAngle), state.currentD * scale,
        state.currentQ * scale, themeColor(theme().guideDq));
      this.drawSignedComponent(this.screenAngle(state.electricalAngle), state.currentD * scale,
        themeColor(theme().componentD), "id");
      this.drawSignedComponent(this.screenAngle(state.electricalAngle + HALF_PI), state.currentQ * scale,
        themeColor(theme().componentQ), "iq");
    }
  }

  drawElectricalVectors(state) {
    if (this.settings.mode == MODE_MANUAL) {
      if (this.settings.manualVectorType == MANUAL_VECTOR_CURRENT) {
        this.drawPhysicalVector(this.settings.manualCurrentAlpha, this.settings.manualCurrentBeta,
          this.parameters.maximumCurrent, this.currentVectorMaximumLength(),
          themeColor(theme().vectorCurrentReference), "i*");
      } else {
        this.drawPhysicalVector(this.settings.manualVoltageAlpha, this.settings.manualVoltageBeta,
          MANUAL_MAXIMUM_VOLTAGE, this.statorInnerRadius * 0.91,
          themeColor(theme().vectorVoltageReference), "u*");
      }
    }
    this.drawPhysicalVector(state.currentAlpha, state.currentBeta, this.parameters.maximumCurrent,
      this.currentVectorMaximumLength(), themeColor(theme().vectorCurrent), "i");
    if (this.settings.showVoltage) {
      let voltageScaleMaximum = this.settings.mode == MODE_MANUAL
          && this.settings.manualVectorType == MANUAL_VECTOR_VOLTAGE
        ? MANUAL_MAXIMUM_VOLTAGE
        : this.parameters.maximumVoltage;
      this.drawPhysicalVector(state.voltageAlpha, state.voltageBeta, voltageScaleMaximum,
        this.statorInnerRadius * 0.91, themeColor(theme().vectorVoltage), "u");
    }
    if (this.settings.showEmf) {
      this.drawPhysicalVector(state.emfAlpha, state.emfBeta, this.parameters.maximumVoltage,
        this.statorInnerRadius * 0.86, themeColor(theme().vectorEmf), "E");
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
      themeColor(theme().torqueMotor));
    this.drawTorqueArc(-state.loadTorque, this.outerRadius * 1.17,
      themeColor(theme().torqueLoad));
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

  drawLegend(area, scale, compact) {
    let entries = [
      [themeColor(theme().vectorCurrent), "ток i"],
      [themeColor(theme().vectorVoltage), "напряжение u"],
      [themeColor(theme().vectorEmf), "ЭДС E"],
      // Дуги моментов полупрозрачны, а в легенде те же цвета нужны плотными.
      [themeColor(theme().torqueMotor, 255), "Mдв"],
      [themeColor(theme().torqueLoad, 255), "Mнагр"],
    ];
    let rows = motorViewLegendRows(compact);
    let available = area.w - 2.0 * MOTOR_DOCK_SIDE_MARGIN * scale;
    // Match the control panel's body text, PANEL_FONT_SCALE included: the motor
    // side never got that 15 % boost, which left the legend reading small next
    // to the panel. The items were laid out on hand-tuned offsets that only
    // held at one width, so measure them and shrink until they fit the rows the
    // footer has reserved.
    let labelSize = 12.5 * scale * PANEL_FONT_SCALE;
    let lines = [];
    let widths = [];
    let gap = 0.0;
    for (let attempt = 0; attempt < 14; attempt++) {
      textSize(labelSize);
      let markerDiameter = labelSize * 0.62;
      gap = labelSize * 1.2;
      widths = entries.map((entry) =>
        markerDiameter + labelSize * 0.35 + textWidth(entry[1]));
      lines = flowIntoLines(widths, gap, available);
      if (lines.length <= rows) break;
      labelSize -= 0.5;
    }

    let x = area.x + MOTOR_DOCK_SIDE_MARGIN * scale;
    let dock = motorViewDockBounds(area, scale, compact);
    let top = dock.y - MOTOR_READOUT_LEGEND_GAP * scale
      - rows * MOTOR_LEGEND_ROW_HEIGHT * scale;
    for (let row = 0; row < lines.length; row++) {
      let itemX = x;
      for (const index of lines[row]) {
        this.drawLegendItem(itemX, top + row * MOTOR_LEGEND_ROW_HEIGHT * scale,
          entries[index][0], entries[index][1], labelSize);
        itemX += widths[index] + gap;
      }
    }
  }

  drawLegendItem(x, y, itemColor, label, labelSize) {
    // Deriving the marker and the gap from the label size keeps the row
    // balanced at whatever size the fitting above settles on.
    let markerDiameter = labelSize * 0.62;
    let markerY = y + labelSize * 0.5;
    noStroke();
    fill(itemColor);
    circle(x + markerDiameter * 0.5, markerY, markerDiameter);
    fillTheme(theme().legendLabel);
    textAlign(LEFT, CENTER);
    textSize(labelSize);
    text(label, x + markerDiameter + labelSize * 0.35, markerY);
  }

  drawReadout(area, state, simulator, scale, compact) {
    let dock = motorViewDockBounds(area, scale, compact);
    let x = dock.x;
    let w = dock.w;
    let y = dock.y;
    noStroke();
    fillTheme(theme().readoutCard);
    // Одна карточка на показания и на полосу действий: кнопки внизу экрана
    // читаются как часть этого блока, а не как что-то положенное поверх него.
    rect(x, y, w, dock.h, 7.0 * scale);

    let speed = "n = " + formatSignedNumber(rpmFromRadians(state.mechanicalSpeed), 0) + " об/мин";
    let motorTorque = "Mдв = " + nf(state.electromagneticTorque, 1, 2) + " Н·м";
    let loadTorque = "Mнагр = " + nf(state.loadTorque, 1, 2) + " Н·м";
    let currentD = "id = " + nf(state.currentD, 1, 2) + " А";
    let currentQ = "iq = " + nf(state.currentQ, 1, 2) + " А";
    let voltage = "|u| = " + nf(sqrt(state.voltageAlpha * state.voltageAlpha
      + state.voltageBeta * state.voltageBeta), 1, 1) + " В";

    fillTheme(theme().readoutText);
    textAlign(LEFT, TOP);
    if (compact) {
      // Six values will not sit on two lines at this width, and shrinking them
      // to fit would undo the point of the layout. A two-column grid keeps the
      // mechanical quantities together on the left and the electrical on the
      // right, and its height is fixed whatever the numbers read.
      let values = [speed, motorTorque, loadTorque, currentD, currentQ, voltage];
      textSize(12.5 * scale);
      for (let i = 0; i < values.length; i++) {
        let column = i < 3 ? 0 : 1;
        let row = i % 3;
        text(values[i], x + 11.0 * scale + column * (w - 22.0 * scale) * 0.5,
          y + 9.0 * scale + row * 25.0 * scale);
      }
    } else {
      textSize(11.0 * scale);
      text(speed + "     " + motorTorque + "     " + loadTorque, x + 11.0 * scale, y + 9.0 * scale);
      text(currentD + "     " + currentQ + "     " + voltage, x + 11.0 * scale, y + 34.0 * scale);
    }
    if (compact) {
      // Волосяная линия отделяет показания от кнопок: карточка остаётся одной
      // деталью, но видно, где кончаются цифры и начинаются органы управления.
      strokeTheme(theme().dockDivider);
      strokeWeight(1.0);
      line(x + 10.0 * scale, dock.toolbarY, x + w - 10.0 * scale, dock.toolbarY);
      noStroke();
    } else if (simulationPaused) {
      // В компактной компоновке о паузе говорит подсвеченная кнопка в полосе
      // под этими цифрами, и вторая надпись о том же только отняла бы место.
      fillTheme(theme().pausedMark);
      textAlign(RIGHT, TOP);
      textSize(11.0 * scale);
      text("ПАУЗА", x + w - 10.0 * scale, y + 9.0 * scale);
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

  mousePressed(px, py, area, controller, compact) {
    this.updateGeometry(area, compact);
    if (this.settings.mode != MODE_MANUAL) return;
    let distance = dist(px, py, this.centerX, this.centerY);
    if (distance <= this.manualVectorMaximumLength()) {
      this.manualDragging = true;
      this.updateManualVector(px, py, controller);
    }
  }

  mouseDragged(px, py, area, controller, compact) {
    if (!this.manualDragging || this.settings.mode != MODE_MANUAL) return;
    this.updateGeometry(area, compact);
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

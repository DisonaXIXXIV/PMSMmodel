// Вид машины: статор с обмоткой, ротор, системы координат, векторы и дуги
// моментов.
//
// На полотне теперь только машина. Заголовки, легенда и показания, которые
// раньше рисовались здесь же, стали разметкой (см. MachineStage в Panel.js), и
// вместе с ними отсюда ушли перенос примечания по словам, подбор кегля легенды
// и общая с панелью геометрия нижней карточки. Полотну досталась ровно та
// работа, ради которой оно и нужно.
//
// Здесь не считается ничего физического — всё берётся из MotorState и рисуется.
// Зато здесь живёт вся геометрия картинки, и у неё два соглашения, которые
// стоит знать, прежде чем читать дальше:
//
//   * Углы — математические: отсчитываются от оси α (вправо) против часовой
//     стрелки. Ось y полотна направлена вниз, поэтому во всех переводах угла в
//     точку синус вычитается, а не прибавляется, — см. pointX/pointY.
//   * Физический угол и угол на экране — не одно и то же. Когда включена
//     фиксация осей d–q, картинка целиком повёрнута на viewRotation, и любой
//     физический угол перед рисованием проходит через screenAngle().
//
// Обмотка статора: двухполюсная трёхфазная распределённая. Шесть фазных зон по
// 60 электрических градусов — A+, C−, B+, A−, C+, B−; каждая зона занимает
// q = 3 соседних паза, отсюда и 18 пазов. Массив задаёт фазу каждой зоны, а
// знак (направление стороны катушки) чередуется через зону, потому что вторая
// половина обмотки — это обратные стороны тех же витков.
const STATOR_SLOT_COUNT = 18;
const STATOR_SLOTS_PER_BELT = 3;
const STATOR_BELT_PHASES = [0, 2, 1, 0, 2, 1];
// Фаза — это индекс и в этих двух списках: имя для подписи в пазу и ключ цвета
// в палитре. Списками, а не цепочкой условий: у промаха мимо фазы не должно
// быть «запасного» ответа, иначе ошибка индекса выглядит как обычная фаза C.
const STATOR_PHASE_NAMES = ["A", "B", "C"];
const STATOR_PHASE_COLOR_KEYS = ["phaseA", "phaseB", "phaseC"];

// Чему принадлежит паз: фаза его зоны и направление тока в стороне катушки.
// Принимает номер паза от 0 до STATOR_SLOT_COUNT − 1.
//
// Вынесено из отрисовки отдельной функцией, потому что это единственная часть
// картинки статора, которую можно проверить без полотна — см. testStatorWinding
// в Diagnostics.js.
//
// floor здесь обязателен: в Processing slot / 3 было целочисленным делением и
// отбрасывало дробную часть само, а в JavaScript даёт 0,333 — и индекс
// промахивался мимо STATOR_BELT_PHASES, отчего весь статор рисовался одной
// фазой. Та же ошибка переноса когда-то была и в раскладке флажков панели.
function statorSlotWinding(slot) {
  let belt = floor(slot / STATOR_SLOTS_PER_BELT);
  return {
    phase: STATOR_BELT_PHASES[belt],
    conductorDirection: belt % 2 === 0 ? 1 : -1,
  };
}

// Вид машины. Состояние здесь только то, что нельзя вывести из модели:
// геометрия текущего кадра, поворот системы наблюдения и признак того, что
// сейчас тянут ручной вектор.
class MotorView {
  parameters;
  settings;

  centerX;
  centerY;
  outerRadius;
  statorInnerRadius;
  rotorRadius;

  // Система наблюдения. viewRotation — на сколько повёрнута вся картинка;
  // mechanicalAngleAtLock — положение ротора в момент фиксации осей;
  // previousLockState нужен, чтобы заметить сам момент включения и выключения
  // флажка, а returningToStationaryFrame — чтобы картинка возвращалась в
  // неподвижное положение плавно, а не рывком.
  previousLockState = false;
  returningToStationaryFrame = false;
  manualDragging = false;
  mechanicalAngleAtLock = 0.0;
  viewRotation = 0.0;

  constructor(parameters, settings) {
    this.parameters = parameters;
    this.settings = settings;
  }

  // Поворот системы наблюдения, раз в кадр.
  //
  // «Зафиксировать оси d–q» не останавливает ротор физически — модель работает
  // как раньше. Поворачивается взгляд: картинка доворачивается на тот же угол,
  // что прошёл ротор с момента фиксации, и ротор оказывается неподвижен, а
  // статор и оси α–β начинают вращаться вокруг него. Так видно, что векторное
  // управление — это и есть переход в такую систему координат.
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

    // Возврат к неподвижной системе: 16 % остатка за кадр — экспоненциальное
    // сближение, которое выглядит плавным и заведомо заканчивается. Идти нужно
    // кратчайшим путём, отсюда signedAngle: с 350° правильно доворачивать на
    // +10°, а не отматывать назад почти полный оборот.
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

  // Сброс вида по кнопке «Сброс»: картинка возвращается в неподвижное
  // положение мгновенно, вместе с машиной.
  resetReferenceFrame() {
    this.previousLockState = false;
    this.returningToStationaryFrame = false;
    this.manualDragging = false;
    this.viewRotation = 0.0;
    this.mechanicalAngleAtLock = 0.0;
  }

  // Где на полотне стоит машина и какого она размера. Машина просто вписывается
  // в отведённое ей полотно: сколько его — решает вёрстка, а не расчёт свободной
  // полосы между надписями и показаниями, как было раньше. Считается заново
  // каждый кадр, потому что размер окна можно менять на ходу.
  updateGeometry(area) {
    this.centerX = area.x + area.w * 0.5;
    this.centerY = area.y + area.h * 0.5;
    this.outerRadius = min(area.w, area.h) * 0.46;
    // Три радиуса задают всю машину, и остальные размеры (пазы, кружки сторон
    // катушек, длины векторов, кегли подписей на картинке) считаются от них.
    // Поэтому машина остаётся соразмерной при любом размере окна.
    this.statorInnerRadius = this.outerRadius * 0.72;
    this.rotorRadius = this.outerRadius * 0.49;
  }

  // Кадр вида. Порядок вызовов — это порядок слоёв снизу вверх: фон, статор,
  // ротор, оси, проекции, векторы и дуги моментов.
  draw(area, motor) {
    this.updateGeometry(area);
    let state = motor.state;

    noStroke();
    fillTheme(theme().motorBackground);
    rect(area.x, area.y, area.w, area.h);

    this.drawStator(state);
    this.drawRotor(state);
    this.drawAxes(state);
    this.drawCurrentProjections(state);
    this.drawElectricalVectors(state);
    this.drawTorqueArcs(state);
  }

  // Перевод физического угла в экранный. Единственное место, где учитывается
  // поворот системы наблюдения, — поэтому всё остальное рисование может
  // спокойно работать с физическими углами.
  screenAngle(physicalAngle) {
    return physicalAngle - this.viewRotation;
  }

  // Статор: ярмо, расточка, 18 пазов и стороны катушек трёх фаз. Обмотка
  // показана распределённой, а не сосредоточенной, — так видно, что ток фазы
  // занимает целую зону, а не один паз.
  drawStator(state) {
    noStroke();
    fillTheme(theme().statorYoke);
    circle(this.centerX, this.centerY, this.outerRadius * 2.0);
    fillTheme(theme().statorBore);
    circle(this.centerX, this.centerY, this.statorInnerRadius * 2.0);

    // При зафиксированных осях d–q статор вращается на экране, и на большой
    // скорости 18 пазов с подписями превращаются в мелькание. Поэтому с ростом
    // скорости он бледнеет: остаётся видно, что он вращается, но рябь глаз не
    // утомляет. В обычном режиме статор неподвижен и бледнеть ему незачем.
    let speedFade = this.settings.lockDqFrame
      ? constrain(map(abs(rpmFromRadians(state.mechanicalSpeed)), 500.0, 3500.0, 1.0, 0.20), 0.20, 1.0)
      : 1.0;
    let statorAngle = this.screenAngle(0.0);
    for (let slot = 0; slot < STATOR_SLOT_COUNT; slot++) {
      let angle = statorAngle + TWO_PI * slot / STATOR_SLOT_COUNT;
      let inner = this.statorInnerRadius + this.outerRadius * 0.025;
      let outer = this.outerRadius * 0.95;
      strokeTheme(theme().statorSlot, 210.0 * speedFade);
      strokeWeight(max(1.0, this.outerRadius * 0.026));
      line(this.pointX(angle, inner), this.pointY(angle, inner), this.pointX(angle, outer), this.pointY(angle, outer));

      let winding = statorSlotWinding(slot);
      let phaseColor = themeColor(theme()[STATOR_PHASE_COLOR_KEYS[winding.phase]]);
      this.drawCoilSide(angle, phaseColor, winding.conductorDirection, speedFade);

      // Подпись зоны ставится на её среднем пазе — одна на три паза.
      if (slot % STATOR_SLOTS_PER_BELT === 1) {
        let phaseName = STATOR_PHASE_NAMES[winding.phase];
        noStroke();
        fill(red(phaseColor), green(phaseColor), blue(phaseColor), 225.0 * speedFade);
        textAlign(CENTER, CENTER);
        textSize(max(8.0, this.outerRadius * 0.052));
        text(phaseName + (winding.conductorDirection > 0 ? "+" : "−"),
          this.pointX(angle, this.outerRadius * 0.895), this.pointY(angle, this.outerRadius * 0.895));
      }
    }

    noFill();
    strokeTheme(theme().statorOutline);
    strokeWeight(max(1.0, this.outerRadius * 0.009));
    circle(this.centerX, this.centerY, this.outerRadius * 2.0);
    circle(this.centerX, this.centerY, this.statorInnerRadius * 2.0);
  }

  // Сторона катушки в пазу: кружок, а в нём точка (ток из плоскости чертежа)
  // или крест (ток в плоскость). Цвет — цвет фазы.
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

  // Ротор: два полюса постоянного магнита, N по оси d и S против неё, плюс вал
  // в центре. Ось d — это и есть направление потока магнитов, поэтому полюс N
  // всегда показывает туда, куда показывает ось d.
  drawRotor(state) {
    let rotorScreenAngle = this.screenAngle(state.mechanicalAngle);
    let rpm = abs(rpmFromRadians(state.mechanicalSpeed));
    // Обратная к статору мера: в обычном режиме на большой скорости бледнеет
    // уже ротор, а при зафиксированных осях он неподвижен и остаётся плотным.
    let movingFade = this.settings.lockDqFrame ? 1.0
      : constrain(map(rpm, 700.0, 3500.0, 1.0, 0.38), 0.38, 1.0);

    // Полюсы рисуются половинками круга, поэтому их проще повернуть
    // преобразованием системы координат, чем считать точки. Знак угла обратный:
    // у полотна ось y направлена вниз, и положительный поворот там по часовой
    // стрелке.
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

  // Две системы координат: неподвижная α–β и вращающаяся вместе с ротором d–q.
  // Оси d–q рисуются и тогда, когда флажок их показа снят, но включена
  // фиксация: без них было бы непонятно, относительно чего остановлена
  // картинка.
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

  // Одна ось: линия через центр в обе стороны и подпись на положительном
  // конце, чуть за линией.
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

  // Проекции вектора тока на выбранные оси со штриховыми линиями достроения.
  // Это главная учебная картинка файла: id и iq — не абстракция, а проекции
  // того же вектора тока на оси, вращающиеся вместе с ротором. Видно и то, что
  // момент даёт только iq.
  drawCurrentProjections(state) {
    let currentMagnitude = sqrt(state.currentAlpha * state.currentAlpha
      + state.currentBeta * state.currentBeta);
    // Масштаб берётся тот же, что и у нарисованного вектора тока: когда вектор
    // упирается в визуальный предел, его проекции сжимаются вместе с ним.
    // Иначе проекции перестали бы складываться в сам вектор — а это ровно то,
    // что картинка и должна показывать.
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

  // Векторы в неподвижной системе: заданный ручной вектор (бледный), ток,
  // напряжение и ЭДС. Задание рисуется только в ручном режиме — в остальных
  // его задают числом, а не мышью.
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
    let manualVoltage = this.isManualVoltageScale();
    if (this.settings.showVoltage) {
      this.drawPhysicalVector(state.voltageAlpha, state.voltageBeta,
        this.voltageDisplayMaximum(), this.statorInnerRadius * 0.91,
        themeColor(theme().vectorVoltage), "u");
    }
    if (this.settings.showEmf) {
      // В ручном режиме напряжения ЭДС рисуется ровно в масштабе u: тот же
      // предел и та же длина, так что разница длин u и E — это и есть
      // падение на обмотке. В остальных режимах её окружность чуть меньше,
      // чтобы при u ≈ E наконечники и подписи не сливались.
      this.drawPhysicalVector(state.emfAlpha, state.emfBeta, this.voltageDisplayMaximum(),
        this.statorInnerRadius * (manualVoltage ? 0.91 : 0.86),
        themeColor(theme().vectorEmf), "E");
    }
  }

  // Ручное задание напряжения: и задание, и полученное напряжение, и ЭДС
  // рисуются в масштабе ручного предела (15 В на всю окружность), а не
  // полного напряжения инвертора, — иначе вектор в несколько вольт был бы
  // почти не виден.
  isManualVoltageScale() {
    return this.settings.mode == MODE_MANUAL
      && this.settings.manualVectorType == MANUAL_VECTOR_VOLTAGE;
  }

  // Напряжение, которому соответствует полная длина векторов u и E.
  voltageDisplayMaximum() {
    return this.isManualVoltageScale()
      ? MANUAL_MAXIMUM_VOLTAGE
      : this.parameters.maximumVoltage;
  }

  // Вектор, заданный проекциями на α и β. Совсем короткие не рисуются: у
  // вектора нулевой длины нет направления, и наконечник со подписью
  // превратились бы в кляксу в центре.
  drawPhysicalVector(alpha, beta, maximum, maximumLength,
                          vectorColor, label) {
    let magnitude = sqrt(alpha * alpha + beta * beta);
    if (magnitude < 0.001) return;
    let physicalAngle = atan2(beta, alpha);
    let length = magnitude * this.limitedVectorScale(magnitude, maximum, maximumLength);
    this.drawArrow(this.screenAngle(physicalAngle), length, vectorColor, label, 2.3);
  }

  // Масштаб «пикселей на единицу». Обычно он постоянный — тогда длина вектора
  // прямо пропорциональна величине и векторы разных кадров сравнимы между
  // собой. Но при перерегулировании величина способна превысить номинальный
  // предел, и вектор ушёл бы за пределы статора; в этом случае масштаб
  // сжимается так, чтобы вектор остановился на 15 % дальше предельной длины —
  // видно, что предел превышен, но картинка не разваливается.
  limitedVectorScale(magnitude, nominalMaximum, maximumLength) {
    let normalScale = maximumLength / nominalMaximum;
    if (magnitude < 0.001) return normalScale;
    let saturatedScale = maximumLength * 1.15 / magnitude;
    return min(normalScale, saturatedScale);
  }

  // Проекция как стрелка по оси. Отрицательная проекция — это стрелка в
  // обратную сторону, а не стрелка отрицательной длины, поэтому знак
  // переносится в угол.
  drawSignedComponent(angle, signedLength, componentColor, label) {
    let maximumProjectionLength = this.currentVectorMaximumLength() * 1.15;
    let clampedLength = constrain(signedLength,
      -maximumProjectionLength, maximumProjectionLength);
    if (abs(clampedLength) < 1.0) return;
    if (clampedLength < 0.0) {
      angle += PI;
      clampedLength = -clampedLength;
    }
    // Проекции лежат поверх ротора, а тот наполовину красный, наполовину
    // синий: красная iq на полюсе N без обводки почти пропадала бы. Обводка
    // цвета фона отделяет стрелку от любой подложки.
    this.drawArrow(angle, clampedLength, componentColor, label, 1.25,
      themeColor(theme().componentHalo));
  }

  // Штриховые линии достроения от концов проекций к концу самого вектора: та
  // самая «параллелограммная» достройка, из которой видно, что вектор равен
  // сумме своих проекций.
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

  // Штриховая линия: p5 своего пунктира для линий не даёт, поэтому она
  // собирается из отрезков через один.
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

  // Стрелка из центра: линия, две линии наконечника и подпись чуть за концом.
  // weightFactor позволяет одному и тому же коду рисовать и жирные векторы, и
  // тонкие проекции.
  // haloColor необязателен: если задан, стрелка и подпись сначала рисуются
  // этим цветом чуть толще — получается обводка, которая держит стрелку
  // видимой на подложке её же цвета.
  drawArrow(angle, length, arrowColor, label, weightFactor, haloColor) {
    let weight = max(1.2, this.outerRadius * 0.008 * weightFactor);
    let haloWeight = 3.0;
    if (haloColor) {
      stroke(haloColor);
      strokeWeight(weight + haloWeight);
      this.drawArrowLines(angle, length);
    }
    stroke(arrowColor);
    strokeWeight(weight);
    this.drawArrowLines(angle, length);
    if (haloColor) {
      stroke(haloColor);
      strokeWeight(haloWeight);
    } else {
      noStroke();
    }
    fill(arrowColor);
    textAlign(CENTER, CENTER);
    textSize(max(9.0, this.outerRadius * 0.058));
    text(label, this.pointX(angle, length + 11.0), this.pointY(angle, length + 11.0));
    noStroke();
  }

  // Древко и наконечник стрелки текущими цветом и толщиной линии.
  drawArrowLines(angle, length) {
    let endX = this.pointX(angle, length);
    let endY = this.pointY(angle, length);
    line(this.centerX, this.centerY, endX, endY);
    let headLength = constrain(length * 0.16, 6.0, 13.0);
    line(endX, endY,
      endX + headLength * cos(angle + PI - 0.45),
      endY - headLength * sin(angle + PI - 0.45));
    line(endX, endY,
      endX + headLength * cos(angle + PI + 0.45),
      endY - headLength * sin(angle + PI + 0.45));
  }

  // Моменты показаны дугами вокруг статора: момент машины ближе, момент
  // нагрузки дальше. У нагрузки знак обратный, потому что положительная
  // нагрузка по принятому соглашению противодействует положительному
  // вращению, — и на картинке её дуга смотрит навстречу дуге машины.
  drawTorqueArcs(state) {
    this.drawTorqueArc(state.electromagneticTorque, this.outerRadius * 1.08,
      themeColor(theme().torqueMotor));
    this.drawTorqueArc(-state.loadTorque, this.outerRadius * 1.17,
      themeColor(theme().torqueLoad));
  }

  // Одна дуга: направление — знак момента, длина и толщина — его величина,
  // отнесённая к предельному моменту. Почти нулевые моменты не рисуются: их
  // дуга всё равно была бы короче наконечника.
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

  // Дуга в математических углах. Своей arc() у p5 углы отсчитываются по
  // часовой стрелке от оси x, поэтому дуга собирается из отрезков — так те же
  // углы, что и у всего остального в этом файле.
  drawMathArc(cx, cy, radius, start, sweep, segments) {
    beginShape();
    for (let i = 0; i <= segments; i++) {
      let angle = start + sweep * i / segments;
      vertex(cx + radius * cos(angle), cy - radius * sin(angle));
    }
    endShape();
  }

  // Наконечник на конце дуги: направлен по касательной, поэтому дуга читается
  // как вращающий момент, а не как просто отметка на окружности.
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

  // Полярные координаты от центра машины в точку на полотне. Синус
  // вычитается: у полотна ось y направлена вниз, а углы здесь
  // математические — против часовой стрелки от оси α.
  pointX(angle, radius) {
    return this.centerX + radius * cos(angle);
  }

  pointY(angle, radius) {
    return this.centerY - radius * sin(angle);
  }

  // Длина, которой на картинке соответствует предельный ток: почти вся
  // расточка статора. От неё считается масштаб и вектора тока, и его проекций,
  // и области, внутри которой можно тянуть ручное задание тока.
  currentVectorMaximumLength() {
    return this.statorInnerRadius * 0.94;
  }

  currentPixelsPerAmp() {
    return this.currentVectorMaximumLength() / this.parameters.maximumCurrent;
  }

  // Нажатие внутри машины. Тянуть можно только в ручном режиме и только
  // внутри области, соответствующей предельной величине вектора: за её
  // границей задание всё равно было бы ограничено, а хватать полотно целиком
  // незачем. Геометрия пересчитывается здесь же — нажатие может прийти до
  // первого кадра после изменения размера окна.
  mousePressed(px, py, area, controller) {
    this.updateGeometry(area);
    if (this.settings.mode != MODE_MANUAL) return;
    let distance = dist(px, py, this.centerX, this.centerY);
    if (distance <= this.manualVectorMaximumLength()) {
      this.manualDragging = true;
      this.updateManualVector(px, py, controller);
    }
  }

  // Протягивание засчитывается только если нажатие началось внутри статора:
  // иначе ползунок, который тянут за пределы панели, дёргал бы заодно и
  // вектор.
  mouseDragged(px, py, area, controller) {
    if (!this.manualDragging || this.settings.mode != MODE_MANUAL) return;
    this.updateGeometry(area);
    this.updateManualVector(px, py, controller);
  }

  // Отпускание. Заданный вектор остаётся там, где его оставили: убирать
  // задание при отпускании значило бы, что машину нельзя вывести в режим и
  // просто посмотреть на него.
  mouseReleased() {
    this.manualDragging = false;
  }

  // Радиус области перетаскивания: у тока и напряжения свои масштабы, а
  // значит, и свои предельные длины.
  manualVectorMaximumLength() {
    return this.settings.manualVectorType == MANUAL_VECTOR_CURRENT
      ? this.currentVectorMaximumLength()
      : this.statorInnerRadius * 0.91;
  }

  // Точка на полотне превращается в задание: длина — в величину (с
  // ограничением на границе области), угол — в фазу. viewRotation здесь
  // прибавляется, а не вычитается: это обратный перевод, с экрана в физические
  // координаты, и при зафиксированных осях d–q задание получается в той
  // системе, которую человек видит.
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

// Вид машины: статор с обмоткой, ротор, системы координат, векторы, дуги
// моментов, легенда и показания.
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
// Ещё одна особенность: вид измеряет и рисует нижнюю карточку (показания, а в
// компактной компоновке ещё и полосу действий), но кнопки в эту полосу
// раскладывает панель. Поэтому размеры карточки считаются свободными функциями
// в начале файла — их вызывают и вид, и панель, и оба получают один ответ.

// Сверху вид оставляет полосу под надписи, снизу — под легенду и показания. В
// компактной компоновке в той же нижней карточке живёт и полоса действий,
// поэтому вся карточка измеряется здесь один раз: вид её рисует, панель
// раскладывает в её нижнюю часть свои кнопки, и никому не приходится угадывать,
// где оказалось чужое.

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

// Сколько строк отведено легенде. На узком экране пять её элементов в одну
// строку не встают (см. drawLegend).
function motorViewLegendRows(compact) {
  return compact ? 2 : 1;
}

// Высоты частей нижней карточки. Компактная выше: показания там идут сеткой
// два на три, а не двумя строками. Полосы действий в широкой компоновке нет
// вовсе — её кнопки стоят внизу панели.
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

// Полная высота всего, что занято внизу: легенда, зазор, карточка и отступ от
// края. Ею updateGeometry считает, сколько места осталось самой машине.
function motorViewFooterHeight(scale, compact) {
  return motorViewLegendRows(compact) * MOTOR_LEGEND_ROW_HEIGHT * scale
    + MOTOR_READOUT_LEGEND_GAP * scale
    + motorViewReadoutHeight(scale, compact)
    + motorViewToolbarHeight(scale, compact)
    + MOTOR_READOUT_BOTTOM_MARGIN * scale;
}

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
// фазой. Тот же перенос уже исправлялся в раскладке флажков (см. GUI.js).
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

  // Общий масштаб картинки: от него зависят и кегли надписей, и отступы, и
  // толщины линий, так что вся картинка растёт и уменьшается целиком. В
  // компактной компоновке виду отдан весь экран, поэтому машина вписывается в
  // свободную полосу между шапкой и показаниями, а не в колонку половинной
  // ширины. Границы constrain не дают ей ни выродиться на узком экране, ни
  // растянуться до нелепого размера на большом.
  viewScale(area, compact) {
    if (compact) return constrain(area.w / 360.0, 0.92, 1.30);
    return constrain(min(area.w / 640.0, area.h / 720.0), 0.68, 1.35);
  }

  // Где на полотне стоит машина и какого она размера. Считается заново каждый
  // кадр: окно можно менять на ходу, а в компактной компоновке высота шапки
  // зависит от того, на сколько строк разошлось примечание об обмотке.
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
    // Три радиуса задают всю машину, и остальные размеры (пазы, кружки сторон
    // катушек, длины векторов, кегли подписей на картинке) считаются от них.
    // Поэтому машина остаётся соразмерной при любом размере окна.
    this.statorInnerRadius = this.outerRadius * 0.72;
    this.rotorRadius = this.outerRadius * 0.49;
  }

  // Кадр вида. Порядок вызовов — это порядок слоёв снизу вверх: фон, надписи,
  // статор, ротор, оси, проекции, векторы, дуги моментов и, наконец, легенда с
  // показаниями поверх всего.
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

  // Примечание об обмотке: потокосцепление магнитов и как читать обозначения
  // сторон катушек.
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

  // Высота шапки в компактной компоновке: отступы плюс столько строк
  // примечания, сколько его получилось. Машина начинается сразу под текстом, а
  // не под запасом, рассчитанным на самый узкий экран.
  compactHeaderHeight(area, scale) {
    let lines = this.compactNoteLines(area, scale).length;
    return (MOTOR_COMPACT_NOTE_TOP + MOTOR_COMPACT_HEADER_PADDING) * scale
      + lines * MOTOR_COMPACT_NOTE_LEADING * scale;
  }

  // Надписи над машиной: название, текущая система наблюдения и примечание об
  // обмотке. Подпись про систему наблюдения меняется вместе с флажком фиксации
  // осей — без неё вращающийся статор выглядел бы просто как ошибка.
  drawCaptions(area, scale, compact) {
    let x = area.x + (compact ? MOTOR_COMPACT_SIDE_MARGIN : 17.0) * scale;
    let frameName = this.settings.lockDqFrame ? "система наблюдения d–q зафиксирована"
      : "неподвижная система α–β";

    fillTheme(theme().motorTitle);
    textAlign(LEFT, TOP);
    if (compact) {
      // Заголовок — самая длинная несокращаемая строка на экране; на телефоне
      // ему приходится уменьшаться, а не уезжать за край.
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
    if (this.settings.showVoltage) {
      // Масштаб напряжения совпадает с масштабом задания: в ручном режиме
      // напряжения предел 15 В, иначе — полное напряжение инвертора. Иначе
      // заданный вектор и полученный рисовались бы в разных масштабах, и
      // сравнивать их было бы нельзя.
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
    this.drawArrow(angle, clampedLength, componentColor, label, 1.25);
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

  // Легенда: что означает каждый цвет. Расставляется по измеренной ширине
  // подписей, а не по заранее выбранным отступам, — иначе при другой ширине
  // экрана элементы либо наезжали бы друг на друга, либо расходились.
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
    // Кегль тот же, что у основного текста панели, вместе с PANEL_FONT_SCALE:
    // сторона машины эту прибавку в 15 % когда-то не получила, и легенда
    // читалась мельче панели. Раньше элементы стояли на подобранных вручную
    // отступах, которые сходились только при одной ширине; теперь они
    // измеряются и кегль уменьшается, пока они не улягутся в те строки,
    // которые под них отвела нижняя полоса.
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

  // Один элемент легенды: кружок цвета и подпись.
  drawLegendItem(x, y, itemColor, label, labelSize) {
    // Кружок и отступ считаются от кегля подписи: на каком бы размере не
    // остановился подбор выше, строка остаётся соразмерной.
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

  // Показания машины в нижней карточке: скорость, моменты, токи в осях d–q и
  // амплитуда напряжения. В компактной компоновке эта же карточка ниже
  // волосяной линии продолжается полосой действий, которую рисует панель.
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
      // Шесть значений в две строки при такой ширине не встанут, а уменьшать их
      // до нужного размера — значит потерять смысл компактной компоновки.
      // Сетка из двух колонок держит механические величины слева, а
      // электрические справа, и её высота не зависит от того, какие числа
      // выпали.
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
  mousePressed(px, py, area, controller, compact) {
    this.updateGeometry(area, compact);
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
  mouseDragged(px, py, area, controller, compact) {
    if (!this.manualDragging || this.settings.mode != MODE_MANUAL) return;
    this.updateGeometry(area, compact);
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

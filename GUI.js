// Интерфейс: выбор компоновки, виджеты и панель управления.
//
// Всё здесь рисуется на том же полотне, что и машина: ни одного элемента HTML,
// кроме самого canvas, в программе нет. Поэтому у каждого виджета две
// обязанности — нарисовать себя в заданном прямоугольнике и ответить, попало ли
// в него нажатие; своей позиции виджет не выбирает, её задаёт раскладка.
//
// Устроено это так:
//
//   SketchLayout    — делит полотно между машиной и панелью и решает, какая
//                     компоновка нужна: широкая (машина слева, панель справа)
//                     или компактная (машина на весь экран, органы управления в
//                     шторке снизу).
//   виджеты         — ползунок, флажок, строка кнопок, полоса действий.
//   ControlPanel    — раскладывает виджеты под выбранную компоновку, рисует их
//                     и разбирает нажатия.
//
// Раскладка и рисование намеренно разделены: layout* расставляет элементы в
// массив items, renderItems() его рисует, hitTestItems() по нему же разбирает
// нажатия. Поэтому нажатие всегда попадает ровно туда, где элемент нарисован, и
// координаты не приходится повторять в двух местах.
//
// Значения виджетов не пишутся в настройки сразу: applyWidgetValues() переносит
// их все разом после каждого действия, а syncWidgetsFromSettings() — наоборот,
// после сброса. Так в любой момент существует одна пара «настройки — виджеты»,
// а не две расходящиеся копии.

// Общая прибавка к кеглю текста панели. Вынесена отдельным множителем,
// потому что подбиралась для читаемости, когда все размеры уже были
// расставлены, — менять каждое число по отдельности было бы негде.
const PANEL_FONT_SCALE = 1.15;
// Рекомендации обеих мобильных платформ сходятся примерно на одном размере
// комфортной цели касания, и все органы управления компактной компоновки
// рассчитываются от него.
const TOUCH_TARGET_MINIMUM = 44.0;
// Всё, где машина и панель не встают рядом, — телефон в портретной ориентации,
// узкое окно — получает компактную компоновку.
const COMPACT_MAXIMUM_ASPECT = 1.1;
const COMPACT_MAXIMUM_WIDTH = 820.0;
// Шторка растёт вместе со своим содержимым до этой доли экрана; дальше вместо
// роста сжимаются её строки, но не сильнее второй доли от своего размера.
const SHEET_MAXIMUM_FRACTION = 0.88;
const SHEET_MINIMUM_FRACTION = 0.30;
const SHEET_MINIMUM_ROW_FIT = 0.72;
// Насколько нужно потянуть шапку шторки вниз, чтобы шторка закрылась.
const SHEET_DISMISS_DISTANCE = 70.0;

// Вкладки шторки. Индексы совпадают с индексами кнопок в строке вкладок.
const TAB_CONTROL = 0;
const TAB_VISUALISATION = 1;

// Сегменты полосы действий, слева направо. Пауза и сброс стоят рядом тем же
// порядком, что и одноимённые кнопки внизу шторки.
const TOOLBAR_THEME = 0;
const TOOLBAR_PAUSE = 1;
const TOOLBAR_RESET = 2;
const TOOLBAR_SETTINGS = 3;

// Уменьшает кегль подписи, пока та не уложится в заданную ширину. Нужна для
// тех немногих надписей, которые набираются в одну строку при любой ширине
// экрана: заголовков панели и подписей на кнопках.
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

// Раскладывает заранее измеренные куски по минимальному числу строк, которые
// влезают в ширину. Нужна легенде и показаниям: их состав зависит от режима, а
// ширина — от языка и от экрана, так что заранее рассчитать её нельзя.
// Возвращает строки как списки индексов — сами куски остаются у вызывающего.
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

// Прямоугольник. Полотно делится именно на такие области, и каждая из них
// передаётся дальше как есть — так и машина, и панель рисуют в своих границах,
// не зная ничего о соседе.
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

// Выбор компоновки и деление полотна.
//
// Компоновок две, и выбирается та, что подходит текущему размеру окна:
// широкая отдаёт машине левую половину, а панели — правую; компактная отдаёт
// весь экран и той, и другой, потому что панель в ней не колонка, а шторка
// поверх машины.
class SketchLayout {
  motorArea = new Area();
  panelArea = new Area();
  compact = false;
  forcedMode = null;

  // Раз в кадр: размер окна может измениться в любой момент, в том числе
  // поворотом телефона.
  update(sketchWidth, sketchHeight) {
    this.compact = this.resolveCompact(sketchWidth, sketchHeight);
    if (this.compact) {
      // Панель не отбирает у машины колонку, а лежит поверх неё, поэтому и той,
      // и другой отдан весь экран; что именно занято, решает сама панель.
      this.motorArea.set(0.0, 0.0, sketchWidth, sketchHeight);
      this.panelArea.set(0.0, 0.0, sketchWidth, sketchHeight);
      return;
    }
    // Широкая компоновка: ровно половина полотна каждому.
    let divider = sketchWidth * 0.5;
    this.motorArea.set(0.0, 0.0, divider, sketchHeight);
    this.panelArea.set(divider, 0.0, sketchWidth - divider, sketchHeight);
  }

  // Компактная компоновка включается, если окно у́же своей высоты (портретная
  // ориентация) или просто у́же 820 px: и в том, и в другом случае машина с
  // панелью рядом не встанут.
  resolveCompact(sketchWidth, sketchHeight) {
    if (this.forcedMode === null) {
      // ?layout=compact и ?layout=desktop позволяют открыть любую компоновку с
      // любого экрана — иначе проверить одну из них со второго устройства
      // попросту нечем. Значение читается один раз и запоминается: адрес по
      // ходу работы не меняется.
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

// Ползунок: подпись, значение справа, дорожка и ручка.
//
// Значение хранится в самом ползунке, а в настройки переносится панелью
// (applyWidgetValues). Диапазон задаётся при создании и берётся из паспорта
// машины — так ползунок не может задать того, чего машина не умеет.
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

  // Дорожка и ручка заданы долями высоты строки, а не кратными масштабу
  // текста: тогда строка, растянутая до размера цели касания, растягивает
  // вместе с собой и ручку, и область попадания. При высоте строки широкой
  // компоновки 39 · scale эти доли в точности повторяют исходные 25 · scale и
  // 13 · scale.
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

  // Значение у подписи. Крупные числа и широкие диапазоны показываются целыми:
  // десятые доли оборота в минуту ничего не добавляют, зато дёргают ширину
  // строки при каждом изменении. showPositiveSign нужен там, где важен знак
  // (задание скорости): знак тогда печатается всегда, кроме нуля.
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

  // Нажатие захватывает ползунок и сразу переносит ручку под палец: тянуть от
  // её прежнего положения неудобно, а на касании ручку под пальцем не видно.
  // Область попадания чуть шире дорожки, чтобы крайние значения можно было
  // выставить у самого её края.
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

  // Перетаскивание учитывает только координату x: увести палец вбок по
  // вертикали легко, и терять из-за этого захват было бы обидно.
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

// Флажок: квадратик и подпись. Всё состояние — один признак checked; что он
// означает, знает только панель.
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
    // Квадратик и подпись сохраняют свой размер и стоят по центру строки:
    // растягивание строки до цели касания увеличивает область попадания, а не
    // текст.
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
    // Обводка квадратика всё ещё стоит как текущий контур; без сброса подпись
    // рисовалась бы с обводкой и выглядела бы полужирной.
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

// Строка кнопок равной ширины. Одним классом сделаны и переключатели, где
// выбран ровно один элемент (режим управления, тип ручного вектора, вкладки
// шторки), и пара «Пауза»/«Сброс», где не выбрано ничего — кроме паузы, пока
// модель остановлена. Разница только в selectedIndex, который выставляет
// панель; сама строка про смысл своих кнопок ничего не знает и на нажатие
// отвечает лишь индексом.
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

  // Ширина одной кнопки: остаток ширины после промежутков, поделённый на число
  // кнопок. Поэтому строка занимает отведённую ширину целиком при любом их
  // количестве.
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

// Значки полосы действий. Они рисуются, а не набираются шрифтом: шрифта с
// такими символами может не оказаться, и тогда кнопка осталась бы пустой.
// Значки полосы действий. Они рисуются, а не набираются шрифтом: шрифта с
// такими символами в системе может не оказаться, и кнопка осталась бы пустой.
const ICON_SETTINGS = 0;
const ICON_PAUSE = 1;
const ICON_PLAY = 2;
const ICON_SUN = 3;
const ICON_MOON = 4;
const ICON_RESET = 5;

// Все значки полосы действий одной функцией. Размер передаётся, и от него
// считаются все пропорции значка: полоса действий меняет высоту вместе с
// масштабом компактной компоновки.
function drawControlIcon(icon, centreX, centreY, size, glyphColor) {
  strokeTheme(glyphColor);
  strokeWeight(size * 0.09);
  noFill();
  if (icon === ICON_SETTINGS) {
    let reach = size * 0.42;
    let spacing = size * 0.28;
    for (let row = -1; row <= 1; row++) {
      let lineY = centreY + row * spacing;
      line(centreX - reach, lineY, centreX + reach, lineY);
      noStroke();
      fillTheme(glyphColor);
      circle(centreX + row * reach * 0.55, lineY, size * 0.21);
      strokeTheme(glyphColor);
      noFill();
    }
  } else if (icon === ICON_PAUSE) {
    let barOffset = size * 0.16;
    let barHeight = size * 0.31;
    line(centreX - barOffset, centreY - barHeight, centreX - barOffset, centreY + barHeight);
    line(centreX + barOffset, centreY - barHeight, centreX + barOffset, centreY + barHeight);
  } else if (icon === ICON_PLAY) {
    noStroke();
    fillTheme(glyphColor);
    let reach = size * 0.28;
    triangle(centreX - reach * 0.75, centreY - reach, centreX - reach * 0.75, centreY + reach,
      centreX + reach, centreY);
  } else if (icon === ICON_SUN) {
    // Тонкие лучи: общей толщиной штриха значка солнце читается как клякса.
    strokeWeight(size * 0.072);
    let coreRadius = size * 0.2;
    circle(centreX, centreY, coreRadius * 2.0);
    for (let ray = 0; ray < 8; ray++) {
      let angle = TWO_PI * ray / 8.0;
      line(centreX + cos(angle) * coreRadius * 1.65, centreY + sin(angle) * coreRadius * 1.65,
        centreX + cos(angle) * coreRadius * 2.4, centreY + sin(angle) * coreRadius * 2.4);
    }
  } else if (icon === ICON_MOON) {
    noStroke();
    fillTheme(glyphColor);
    drawCrescentGlyph(centreX, centreY, size * 0.32);
  } else if (icon === ICON_RESET) {
    // Круговая стрелка: дуга в три четверти оборота с разрывом вверху справа и
    // остриём на верхнем конце. Ось y на полотне направлена вниз, поэтому по
    // часовой стрелке дуга идёт в сторону роста угла, а её касательная наверху
    // смотрит вправо — туда же и остриё.
    let radius = size * 0.27;
    let endAngle = -HALF_PI;
    arc(centreX, centreY, radius * 2.0, radius * 2.0, endAngle - 1.6 * PI, endAngle);
    noStroke();
    fillTheme(glyphColor);
    triangle(centreX + size * 0.2, centreY - radius,
      centreX - size * 0.09, centreY - radius - size * 0.14,
      centreX - size * 0.09, centreY - radius + size * 0.14);
  }
  noStroke();
}

// Полумесяц — область между внешней окружностью и смещённой вырезающей. Он
// собирается одной фигурой, а не заливкой поверх: подложка сегмента бывает
// подсвеченной, и «вырезанная» цветом карточки долька выдала бы себя.
function drawCrescentGlyph(cx, cy, radius) {
  let offset = radius * 0.55;
  let cutRadius = radius * 0.9;
  // Точка пересечения двух окружностей; по ней находятся углы, на которых одна
  // дуга переходит в другую.
  let crossX = (offset * offset + radius * radius - cutRadius * cutRadius) / (2.0 * offset);
  let crossY = sqrt(max(0.0, radius * radius - crossX * crossX));
  let outerStart = atan2(crossY, crossX);
  let cutStart = atan2(crossY, crossX - offset);
  let steps = 18;
  beginShape();
  for (let i = 0; i <= steps; i++) {
    let angle = lerp(outerStart, TWO_PI - outerStart, i / steps);
    vertex(cx + radius * cos(angle), cy + radius * sin(angle));
  }
  for (let i = 0; i <= steps; i++) {
    let angle = lerp(TWO_PI - cutStart, cutStart, i / steps);
    vertex(cx + offset + cutRadius * cos(angle), cy + cutRadius * sin(angle));
  }
  endShape(CLOSE);
}

// Полоса действий компактной компоновки. Она занимает нижнюю часть карточки
// показаний, поэтому это не кнопки поверх машины, а сегменты одной детали —
// значок со своей подписью, разделители волосяной линией, подсветка у
// включённого действия.
// Полоса действий компактной компоновки. Она занимает нижнюю часть карточки
// показаний, поэтому это не кнопки поверх машины, а сегменты одной детали —
// значок со своей подписью, разделители волосяной линией, подсветка у
// включённого действия.
class ToolbarControl {
  segments;
  activeIndex = -1;
  x;
  y;
  w;
  h;
  scale = 1.0;
  visible = false;

  constructor(segments) {
    this.segments = segments;
  }

  setBounds(x, y, w, h, scale) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.scale = scale;
  }

  // Сегменты равной ширины, без промежутков: это одна деталь, разделённая
  // линиями, а не четыре отдельные кнопки.
  segmentWidth() {
    return this.w / this.segments.length;
  }

  segmentX(index) {
    return this.x + index * this.segmentWidth();
  }

  drawControl() {
    if (!this.visible) return;
    let segmentWidth = this.segmentWidth();
    for (let i = 0; i < this.segments.length; i++) {
      let active = this.activeIndex === i;
      let x = this.segmentX(i);
      let centreX = x + segmentWidth * 0.5;
      if (active) {
        noStroke();
        fillTheme(theme().toolbarActiveFill);
        rect(x + 3.0 * this.scale, this.y + 4.0 * this.scale,
          segmentWidth - 6.0 * this.scale, this.h - 8.0 * this.scale, 7.0 * this.scale);
      }
      if (i > 0 && !active && this.activeIndex !== i - 1) {
        // Разделители между соседними сегментами; рядом с подсветкой линия
        // лишняя — её роль там играет край подложки.
        strokeTheme(theme().dockDivider);
        strokeWeight(1.0);
        line(x, this.y + this.h * 0.24, x, this.y + this.h * 0.76);
        noStroke();
      }
      let glyphColor = active ? theme().toolbarActiveGlyph : theme().toolbarGlyph;
      drawControlIcon(this.segments[i].icon, centreX, this.y + this.h * 0.34,
        this.h * 0.38, glyphColor);
      fillTheme(active ? theme().toolbarActiveLabel : theme().toolbarLabel);
      textAlign(CENTER, CENTER);
      fittedTextSize(this.segments[i].label, segmentWidth - 14.0 * this.scale,
        10.5 * this.scale * PANEL_FONT_SCALE, 8.0 * this.scale);
      text(this.segments[i].label, centreX, this.y + this.h * 0.76);
    }
  }

  press(px, py) {
    if (!this.visible || py < this.y || py > this.y + this.h
        || px < this.x || px > this.x + this.w) return -1;
    return min(floor((px - this.x) / this.segmentWidth()), this.segments.length - 1);
  }
}

// Панель управления: все виджеты, обе раскладки и разбор нажатий.
//
// Виджеты создаются один раз в конструкторе и живут всё время работы — в обеих
// компоновках это одни и те же объекты, меняется только их расстановка. Те, что
// в текущем режиме не нужны, просто не попадают в раскладку и получают
// visible = false: тогда они не рисуются и не ловят нажатия.
class ControlPanel {
  parameters;
  settings;
  controller;
  // Профиль решает, какие переключатели вообще есть в панели: demo-страница
  // одного режима обходится без выбора режима и без выбора типа ручного вектора.
  profile;
  lastArea = new Area();

  // Ползунки: нагрузка действует во всех режимах, остальные — каждый в своём.
  loadSlider;
  voltageSlider;
  frequencySlider;
  currentQSlider;
  currentKpSlider;
  currentKiSlider;
  speedSlider;
  speedKpSlider;
  speedKiSlider;

  // Флажки: первый включает контур скорости, остальные относятся к картинке.
  speedLoopCheckbox;
  voltageCheckbox;
  emfCheckbox;
  alphaBetaAxesCheckbox;
  dqAxesCheckbox;
  alphaBetaProjectionCheckbox;
  dqProjectionCheckbox;
  lockDqCheckbox;
  themeCheckbox;

  // Строки кнопок и полоса действий компактной компоновки.
  modeButtons;
  manualVectorButtons;
  actionButtons;
  tabButtons;
  toolbar;

  // Списки «все ползунки», «все флажки», «все строки кнопок» нужны там, где
  // действие одинаково для всех: спрятать перед раскладкой, отпустить при
  // потере указателя, собрать значения.
  allSliders;
  allCheckboxes;
  allButtonRows;

  scale = 1.0;
  compact = false;
  // Состояние компактной компоновки: поднята ли шторка, где её верхний край,
  // докуда простирается её шапка (ниже неё потянуть шторку вниз нельзя — там
  // уже органы управления) и с какой точки началось её протягивание.
  sheetOpen = false;
  sheetTop = 0.0;
  sheetHeaderBottom = 0.0;
  sheetDragStartY = null;
  activeTab = TAB_CONTROL;
  // Раскладка пишет сюда уже расставленные элементы, а рисование и разбор
  // нажатий их читают: прямоугольник каждого органа управления определяется
  // ровно в одном месте, и нажатие не может попасть туда, где ничего не
  // нарисовано.
  items = [];
  lastState = null;
  lastSimulator = null;

  constructor(parameters, settings, controller, profile) {
    this.parameters = parameters;
    this.settings = settings;
    this.controller = controller;
    this.profile = profile === undefined ? demoProfile(PROFILE_FULL) : profile;

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
    // Диапазоны обступают настройку для J = 0,1: ниже Kp = 4 переходный процесс
    // заметно перерегулирует, а Ki больше 60 сокращает время установления ценой
    // более высокого первого выброса.
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
    // Тема стоит в полосе, а не только флажком в шторке: на телефоне флажок до
    // себя прятать не хочется, а переключаться хочется в одно касание.
    this.toolbar = new ToolbarControl([
      { icon: ICON_SUN, label: "Тема" },
      { icon: ICON_PAUSE, label: "Пауза" },
      { icon: ICON_RESET, label: "Сброс" },
      { icon: ICON_SETTINGS, label: "Настройки" },
    ]);

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

  // Раздел «Визуализация» — один и тот же список в обеих компоновках: в широкой
  // он идёт двумя колонками внизу панели, в компактной — вкладкой шторки.
  visualisationCheckboxes() {
    return [
      this.voltageCheckbox, this.emfCheckbox, this.alphaBetaAxesCheckbox, this.dqAxesCheckbox,
      this.alphaBetaProjectionCheckbox, this.dqProjectionCheckbox, this.lockDqCheckbox,
      this.themeCheckbox
    ];
  }

  // Кадр панели. Модель и симулятор запоминаются, потому что нужны не здесь, а
  // в drawStatusCard: рисование разнесено по renderItems и передавать их через
  // всю цепочку было бы шумно.
  draw(area, motor, simulator, compact) {
    this.compact = compact;
    this.lastArea.set(area.x, area.y, area.w, area.h);
    this.lastState = motor.state;
    this.lastSimulator = simulator;
    this.syncSelections();
    if (compact) this.drawCompact(area);
    else this.drawDesktop(area);
  }

  // Подсветки и подписи, которые зависят не от значений виджетов, а от
  // состояния программы: выбранный режим, пауза, активная вкладка, текущая
  // тема. Пересчитываются каждый кадр — их могли изменить и клавиатурой.
  syncSelections() {
    this.modeButtons.selectedIndex = this.settings.mode;
    this.manualVectorButtons.selectedIndex = this.settings.manualVectorType;
    this.actionButtons.labels[0] = simulationPaused ? "Продолжить" : "Пауза";
    this.actionButtons.selectedIndex = simulationPaused ? 0 : -1;
    this.tabButtons.selectedIndex = this.activeTab;
    // Солнце и луна показывают тему, в которую кнопка переведёт, а не текущую.
    this.toolbar.segments[TOOLBAR_THEME].icon = isLightTheme() ? ICON_MOON : ICON_SUN;
    this.toolbar.segments[TOOLBAR_PAUSE].icon = simulationPaused ? ICON_PLAY : ICON_PAUSE;
    this.toolbar.segments[TOOLBAR_PAUSE].label = simulationPaused ? "Продолжить" : "Пауза";
    this.toolbar.activeIndex = simulationPaused ? TOOLBAR_PAUSE : -1;
  }

  // Перед каждой раскладкой всё скрывается, а показывается заново только то,
  // что в неё попало. Иначе виджет, убранный из раскладки сменой режима,
  // продолжал бы ловить нажатия там, где его давно не рисуют.
  hideAllControls() {
    for (const slider of this.allSliders) slider.visible = false;
    for (const checkbox of this.allCheckboxes) checkbox.visible = false;
    for (const row of this.allButtonRows) row.visible = false;
    this.toolbar.visible = false;
  }

  // -- layout helpers -------------------------------------------------------

  // Элементы раскладки. Заголовок, название раздела, карточка показаний и
  // подсказка — это не виджеты: они ничего не принимают, только рисуются, —
  // поэтому в items они лежат описаниями, а не объектами.
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

  // Широкая компоновка: панель — колонка справа, с тонкой линией по левому
  // краю. Порядок неизменный — сначала раскладка, потом фон, потом элементы.
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

  // Раскладка широкой компоновки, сверху вниз: заголовок, выбор режима,
  // нагрузка, показания, органы управления текущего режима, раздел
  // «Визуализация» двумя колонками. Кнопки «Пауза» и «Сброс» прижаты к нижнему
  // краю панели: они нужны всегда и не должны прыгать вместе со сменой режима.
  layoutDesktop(area) {
    this.hideAllControls();
    this.items = [];
    let scale = this.scale;
    let padding = 18.0 * scale;
    let contentX = area.x + padding;
    let contentWidth = area.w - 2.0 * padding;
    let y = area.y + 13.0 * scale;

    this.addTitle(this.profile.panelTitle, contentX, y, contentWidth,
      21.0 * scale * PANEL_FONT_SCALE);
    y += 37.0 * scale;

    if (!this.profile.singleMode) {
      this.addSection("РЕЖИМ УПРАВЛЕНИЯ", contentX, y, contentWidth, 18.0 * scale);
      y += 18.0 * scale;

      this.modeButtons.setBounds(contentX, y, contentWidth, 31.0 * scale, 4.0 * scale, scale);
      this.addControl(this.modeButtons);
      y += 31.0 * scale + 10.0 * scale;
    }

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
      // В Processing это деление отбрасывало дробную часть, потому что i было
      // целым; в JavaScript оно даёт половины, и колонки разъезжались на
      // полстроки. Отсюда явный floor.
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

    // Отсчёт от нижнего края области, а не от накопленного y: сколько бы места
    // ни заняли органы управления режима, эта пара кнопок стоит на одном месте.
    this.actionButtons.setBounds(contentX, area.y + area.h - 46.0 * scale, contentWidth,
      32.0 * scale, 9.0 * scale, scale);
    this.addControl(this.actionButtons);
  }

  // Общая часть обеих компоновок: какие задания предлагать, решает выбранный
  // режим, и набор этот один и тот же независимо от того, как расставлена
  // панель. Отсюда и параметры вместо готовых чисел — высоты строк в компактной
  // компоновке другие.
  layoutModeControls(contentX, y, contentWidth, sliderHeight, rowHeight, compact) {
    let scale = this.scale;
    let sliderAdvance = sliderHeight + 4.0 * scale;

    if (this.settings.mode == MODE_MANUAL) {
      // Заголовок раздела стоит над выбором тока и напряжения. Там, где выбора
      // нет, о нём уже сказал заголовок панели, и остаётся одна подсказка.
      if (!this.profile.singleManualVector) {
        this.addSection("РУЧНОЕ ЗАДАНИЕ", contentX, y, contentWidth, 19.0 * scale);
        y += 19.0 * scale;
        this.manualVectorButtons.setBounds(contentX, y, contentWidth,
          compact ? rowHeight : 30.0 * scale, 5.0 * scale, scale);
        this.addControl(this.manualVectorButtons);
        y += (compact ? rowHeight : 30.0 * scale) + 9.0 * scale;
      }
      // Та же фраза в колонке шириной с телефон переносится на три строки, а
      // подсказка, обрезанная на середине, хуже, чем никакая.
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

  // Компактная компоновка. Пока шторка опущена, от панели видна только полоса
  // действий в нижней карточке — всё остальное место у машины.
  drawCompact(area) {
    this.scale = constrain(area.w / 360.0, 0.92, 1.30);
    this.hideAllControls();
    this.items = [];

    // Полоса действий занимает нижнюю часть карточки показаний, которую машина
    // уже нарисовала: место под неё отведено там же, где считается вся нижняя
    // карточка, поэтому кнопки не накрывают ни обмотку, ни цифры.
    // Полоса действий занимает нижнюю часть карточки показаний, которую машина
    // уже нарисовала: место под неё отведено там же, где считается вся нижняя
    // карточка, поэтому кнопки не накрывают ни обмотку, ни цифры.
    let dock = motorViewDockBounds(area, motorView.viewScale(area, true), true);
    this.toolbar.setBounds(dock.x, dock.toolbarY, dock.w, dock.toolbarHeight, this.scale);

    if (!this.sheetOpen) {
      this.sheetTop = area.y + area.h;
      this.toolbar.visible = true;
      this.toolbar.drawControl();
      return;
    }
    // Пока шторка поднята, полоса действий оказалась бы под её органами
    // управления, а всё, что она делает, в шторке уже есть: пауза и сброс — в
    // строке действий, тема — на вкладке «Визуализация», закрывают шторку
    // затемнение и её верхний край.
    this.toolbar.visible = false;

    // Высота шторки не задана заранее: она зависит от режима, от того, включён
    // ли контур скорости, и от выбранной вкладки. Поэтому раскладка сначала
    // выполняется от нулевого начала — только чтобы узнать нужную высоту; если
    // экран столько не даёт, строки сжимаются, и раскладка повторяется. Трёх
    // попыток хватает: сжатие уменьшает высоту пропорционально.
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

  // Раскладывает шторку от заданного начала и возвращает высоту, которая ей
  // нужна. Та же функция служит и меркой, и настоящей раскладкой — иначе
  // измеренная высота могла бы разойтись с нарисованной.
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

    // Пока шторка поднята, собственные показания машины за ней не видны,
    // поэтому текущие значения повторяются здесь же, рядом с органами
    // управления, которые их меняют.
    this.items.push({ kind: "status", x: contentX, y, w: contentWidth, h: 61.0 * scale });
    y += 70.0 * scale;
    this.sheetHeaderBottom = y;

    if (this.activeTab === TAB_CONTROL) {
      if (!this.profile.singleMode) {
        this.addSection("РЕЖИМ УПРАВЛЕНИЯ", contentX, y, contentWidth, 18.0 * scale);
        y += 18.0 * scale;
        this.modeButtons.setBounds(contentX, y, contentWidth, rowHeight, 5.0 * scale, scale);
        this.addControl(this.modeButtons);
        y += rowHeight + 12.0 * scale;
      }
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

  // Рисование по готовой раскладке. Обе компоновки сходятся здесь: расставлять
  // элементы они умеют по-разному, а рисуются те одинаково.
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

  // Карточка с тремя главными величинами: скорость, ток, момент. В широкой
  // компоновке стоит под ползунком нагрузки, в компактной повторяется в шапке
  // шторки — там собственные показания машины закрыты.
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

  // Скорость со знаком, но без «−0»: у нуля знака нет.
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

  // Подсказка ручного режима. Это единственный режим, где задание берётся не с
  // ползунка, а мышью по картинке, и без подсказки догадаться об этом нельзя.
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
    // На телефоне статор закрыт этой самой шторкой, и указание тянуть внутри
    // статора без такой оговорки бесполезно.
    let opening = this.compact
      ? "Закройте настройки и тяните внутри статора,"
      : "Нажмите и тяните внутри статора,";
    // Текст в прямоугольнике отсчитывается от верхнего края, поэтому передаётся
    // собственный y карточки, а по вертикали центрирует выравнивание CENTER.
    text(opening + "\nчтобы задать вектор " + vectorName + ".",
      x + 11.0 * this.scale, y, w - 22.0 * this.scale, h);
  }

  // -- input ----------------------------------------------------------------

  // Нажатие. Возвращает true, если панель его забрала: тогда машина его уже не
  // получит (см. pointerPressed в PMSMmodel.js). В широкой компоновке панель
  // забирает всё, что попало в её колонку, даже если там нет ни одного
  // виджета, — иначе нажатие «сквозь панель» тянуло бы вектор в статоре.
  mousePressed(px, py) {
    if (this.compact) return this.compactMousePressed(px, py);
    if (!this.lastArea.contains(px, py)) return false;
    this.hitTestItems(px, py);
    return true;
  }

  // Нажатие в компактной компоновке: сначала полоса действий, затем шторка.
  // Если шторка опущена и в полосу не попали, панель нажатие не забирает — оно
  // уходит машине, и вектор можно тянуть прямо по статору.
  compactMousePressed(px, py) {
    let segment = this.toolbar.press(px, py);
    if (segment === TOOLBAR_THEME) {
      toggleTheme();
      // Флажок в шторке показывает ту же настройку и должен остаться в такте.
      this.themeCheckbox.checked = isLightTheme();
      return true;
    }
    if (segment === TOOLBAR_PAUSE) {
      simulationPaused = !simulationPaused;
      return true;
    }
    if (segment === TOOLBAR_RESET) {
      resetSimulation();
      return true;
    }
    if (segment === TOOLBAR_SETTINGS) {
      this.sheetOpen = !this.sheetOpen;
      return true;
    }
    if (!this.sheetOpen) return false;
    if (py < this.sheetTop) {
      // Касание машины за шторкой закрывает шторку, а не начинает
      // перетаскивание вектора, которого из-под неё всё равно не видно.
      this.sheetOpen = false;
      return true;
    }
    if (!this.hitTestItems(px, py) && py <= this.sheetHeaderBottom) {
      this.sheetDragStartY = py;
    }
    return true;
  }

  // Разбор нажатия по той же раскладке, по которой всё нарисовано. Строки
  // кнопок обрабатываются отдельно: у них не значение, а выбранный индекс, и
  // каждая означает своё. Остальные виджеты одинаковы — достаточно перенести
  // значения в настройки.
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
          // Угол ротора нужно запомнить в момент самого нажатия, до следующего
          // шага модели: иначе картинка зафиксируется на положении, которого
          // при нажатии ещё не было.
          motorView.updateReferenceFrame(motor.state);
        }
        return true;
      }
    }
    return false;
  }

  // Перетаскивание. Ползунки идут первыми и списком, а не по раскладке: палец
  // давно мог уйти за пределы своего ползунка, но захват сохраняется — иначе
  // значение срывалось бы на первом же неточном движении.
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

  // Отпускание: отпустить все ползунки и забыть начатое протягивание шторки.
  // Вызывается и при потере указателя системой (см. PMSMmodel.js).
  mouseReleased() {
    for (const slider of this.allSliders) slider.release();
    this.sheetDragStartY = null;
  }

  // Виджеты → настройки. Переносится всё сразу, а не только то, что изменилось:
  // значения независимые, и разбираться, какое из них тронули, дороже, чем
  // переписать все.
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

  // Настройки → виджеты. Обратное направление нужно после сброса и после
  // переключения темы клавишей: настройки изменились не через панель, и виджеты
  // об этом иначе не узнают.
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

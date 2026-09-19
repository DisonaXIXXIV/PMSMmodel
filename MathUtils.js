// Математические утилиты, общие для модели, регуляторов и отрисовки.
//
// Файл ничего из проекта не требует: здесь только то, что не зависит ни от
// машины, ни от интерфейса. Тригонометрия, constrain, nf и прочее берутся у
// p5 как глобальные имена, поэтому при запуске тестов в Node их приходится
// подменять заглушками — см. tests/run-diagnostics.js.

// Двумерный вектор в неподвижной системе координат α–β. Им передаётся
// команда напряжения от регуляторов к модели (DriveController.voltageCommand)
// и задание ручного вектора. Класс намеренно беден и меняется на месте (set,
// limitVector): за секунду модельного времени делается 10 000 шагов, и новый
// объект на каждом из них был бы лишней работой для сборщика мусора.
class Vec2 {
  x;
  y;

  constructor(x = 0.0, y = 0.0) {
    this.x = x;
    this.y = y;
  }

  // Обе координаты сразу: вектор переиспользуется, а не создаётся заново.
  set(x, y) {
    this.x = x;
    this.y = y;
  }

  // Длина вектора. Для напряжения это его амплитуда |u| — именно она
  // сравнивается с пределом инвертора.
  magnitude() {
    return sqrt(this.x * this.x + this.y * this.y);
  }
}

// Приводит угол к [0, 2π). Механический и электрический углы хранятся
// именно так: без приведения за минуты работы угол дорос бы до значений, где
// прибавляемый шаг теряется в мантиссе double и вращение бы «замерзло».
function wrapAngle(angle) {
  angle %= TWO_PI;
  if (angle < 0.0) {
    angle += TWO_PI;
  }
  return angle;
}

// Приводит угол к (−π, π]. Нужен там, где важен знак и кратчайшее
// направление доворота: возврат зафиксированной системы d–q в неподвижное
// положение в MotorView.updateReferenceFrame.
function signedAngle(angle) {
  angle = wrapAngle(angle);
  return angle > PI ? angle - TWO_PI : angle;
}

// Модель считает скорость в рад/с, а человеку показываются и задаются
// об/мин, поэтому перевод нужен в обе стороны.
function rpmFromRadians(radiansPerSecond) {
  return radiansPerSecond * 60.0 / TWO_PI;
}

function radiansFromRpm(rpm) {
  return rpm * TWO_PI / 60.0;
}

// Число со знаком для показаний: плюс печатается явно, чтобы направление
// вращения читалось сразу. Значение меньше половины последнего выводимого
// разряда обнуляется — иначе дрожащая около нуля скорость показывалась бы как
// «−0», что выглядит как ошибка.
function formatSignedNumber(value, decimalPlaces) {
  let zeroThreshold = 0.5 * pow(10.0, -decimalPlaces);
  if (abs(value) < zeroThreshold) value = 0.0;
  let formatted = decimalPlaces == 0
    ? str(round(value))
    : nf(value, 1, decimalPlaces);
  return value > 0.0 ? "+" + formatted : formatted;
}

// Симметричное ограничение ±maximum. Им контур скорости зажимает задание
// тока в допустимый для машины предел.
function clampMagnitude(value, maximum) {
  return constrain(value, -maximum, maximum);
}

// Ограничение длины вектора с сохранением направления, на месте. Насыщение
// инвертора уменьшает амплитуду напряжения, но не должно поворачивать
// вектор: покоординатное ограничение исказило бы его фазу.
function limitVector(vector, maximum) {
  let magnitudeSquared = vector.x * vector.x + vector.y * vector.y;
  if (magnitudeSquared > maximum * maximum) {
    let scale = maximum / sqrt(magnitudeSquared);
    vector.x *= scale;
    vector.y *= scale;
  }
}

// Проверка на NaN и бесконечность. Если сочетание настроек всё же развалило
// численное решение, PMSMModel.step по этому признаку сбрасывает состояние
// вместо того, чтобы рисовать бессмыслицу до перезагрузки страницы.
function finiteValue(value) {
  return Number.isFinite(value);
}

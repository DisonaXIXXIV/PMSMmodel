// Справка: что умеет программа, в общих чертах. Открывается кнопкой «?» в
// шапке над машиной.
//
// Текст намеренно короткий — режимы, что можно менять, что на картинке и
// какие клавиши. Как настраивать регуляторы и почему, здесь не объясняется:
// справка для того, кто зашёл впервые и хочет понять, куда нажимать.
//
// Окно — нативный <dialog>: фокус внутри, Esc и доступность достаются от
// браузера. Закрывается также кнопкой и нажатием мимо окна.

// Разделы справки. Пункт списка — строка или пара [термин, пояснение].
// Названия режимов совпадают с подписями переключателя (MODE_DESCRIPTIONS в
// Panel.js) — testHelpContents следит, чтобы они не разошлись.
const HELP_SECTIONS = [
  {
    title: "Режимы управления",
    items: [
      ["Ручной", "вектор тока или напряжения задаётся мышью или пальцем прямо"
        + " внутри статора. Ток поддерживают регуляторы, напряжение подаётся на"
        + " машину как есть."],
      ["Разомкнутый", "на машину подаётся вращающийся вектор напряжения заданной"
        + " амплитуды и частоты — без обратных связей."],
      ["Векторный", "векторное управление: задаётся ток iq (то есть момент) или"
        + " скорость, а регуляторы держат id равным нулю."],
    ],
  },
  {
    title: "Что можно менять",
    items: [
      "Момент нагрузки на валу — в любом режиме.",
      "Задания и коэффициенты регуляторов выбранного режима.",
      "Параметры двигателя: сопротивление и индуктивность обмотки,"
        + " потокосцепление магнитов, момент инерции.",
      "Что показывать: векторы напряжения и ЭДС, оси α–β и d–q, проекции"
        + " тока. Оси d–q можно зафиксировать — тогда ротор стоит на месте,"
        + " а вращается статор.",
    ],
  },
  {
    title: "Что на картинке",
    items: [
      "Векторы тока i, напряжения u и ЭДС E; цвета — в легенде под машиной.",
      "Оси α–β неподвижны, оси d–q вращаются с ротором; ось d смотрит на"
        + " полюс N.",
      "Значки в пазах — мгновенный ток фаз: • — из экрана, × — в экран;"
        + " чем ярче значок, тем больше ток.",
      "Дуги вокруг статора — момент двигателя и момент нагрузки.",
      "Под машиной — скорость, моменты, токи id и iq, напряжение.",
    ],
  },
  {
    title: "Клавиши и кнопки",
    items: [
      ["Пробел", "пауза."],
      ["R", "сброс модели и всех параметров; выбранный режим сохраняется."],
      ["T", "светлая или тёмная тема."],
      "На телефоне настройки открываются кнопкой «Настройки» внизу.",
      "Когда выходит новая версия, страница обновляется сама.",
    ],
  },
];

const HELP_INTRODUCTION = "Модель синхронной машины с постоянными магнитами"
  + " (PMSM). На картинке — поперечный разрез: статор с трёхфазной обмоткой и"
  + " двухполюсный ротор-магнит. Модель считается непрерывно, но примерно в"
  + " 17 раз медленнее реального времени, чтобы переходные процессы было видно"
  + " глазом.";

// Весь текст справки одной строкой — для проверки, что в нём упомянуто всё
// нужное.
function helpPlainText() {
  let parts = [HELP_INTRODUCTION];
  for (const section of HELP_SECTIONS) {
    parts.push(section.title);
    for (const item of section.items) {
      parts.push(Array.isArray(item) ? item.join(" — ") : item);
    }
  }
  return parts.join("\n");
}

class HelpDialog {
  dialog;

  // Окно строится один раз и дальше только открывается и закрывается.
  build(host) {
    this.dialog = element("dialog", "help");
    this.dialog.setAttribute("aria-labelledby", "help-title");

    // Внутренний блок занимает всё окно: нажатие, попавшее в сам <dialog>, а
    // не в блок, — это нажатие по затемнению вокруг, и оно закрывает окно.
    let body = element("div", "help__body");
    let header = element("div", "help__header");
    let title = element("h2", "help__title", "О программе");
    title.id = "help-title";
    let close = element("button", "help__close");
    close.type = "button";
    close.setAttribute("aria-label", "Закрыть справку");
    close.innerHTML = iconMarkup("close");
    close.addEventListener("click", () => this.close());
    header.append(title, close);

    let content = element("div", "help__content");
    content.append(element("p", "help__intro", HELP_INTRODUCTION));
    for (const section of HELP_SECTIONS) {
      content.append(element("h3", "help__section", section.title));
      let list = element("ul", "help__list");
      for (const item of section.items) {
        let row = element("li");
        if (Array.isArray(item)) {
          row.append(element("strong", "", item[0]), " — " + item[1]);
        } else {
          row.textContent = item;
        }
        list.append(row);
      }
      content.append(list);
    }

    body.append(header, content);
    this.dialog.append(body);
    this.dialog.addEventListener("click", (event) => {
      if (event.target === this.dialog) this.close();
    });
    host.append(this.dialog);
  }

  open() {
    if (this.dialog.open) return;
    this.dialog.showModal();
  }

  close() {
    this.dialog.close();
  }
}

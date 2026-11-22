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
// Panel.js) — testHelpContents следит, чтобы они не разошлись. Текст свой у
// каждой машины только там, где машины различаются: паспорт и картинка.
function helpSections(machineType) {
  let induction = machineType === MACHINE_INDUCTION;
  return [
    {
      title: "Режимы управления",
      items: [
        ["Ручной", "вектор тока или напряжения задаётся мышью или пальцем прямо"
          + " внутри статора. Ток поддерживают регуляторы, напряжение подаётся на"
          + " машину как есть."],
        ["Разомкнутый", "на машину подаётся вращающийся вектор напряжения заданной"
          + " амплитуды и частоты — без обратных связей."
          + (induction ? " Асинхронная машина сама разгоняется почти до скорости"
            + " поля, отставая на скольжение. На странице частотного управления"
            + " амплитуда напряжения пропорциональна модулю частоты." : "")],
        ["Векторный", "векторное управление: задаётся ток iq (то есть момент) или"
          + (induction
            ? " скорость, а регуляторы держат id равным току намагничивания."
              + " Оси d–q ставятся по потоку ротора, который оценивает наблюдатель."
              + " На странице векторного управления АД заданием ψr* меняют ток намагничивания."
            : " скорость, а регуляторы держат id равным нулю.")],
        ...(induction ? [] : [["Автокоммутация",
          "отметки в зазоре делят оборот ротора на шесть секторов. При переходе"
          + " в соседний сектор вектор напряжения поворачивается на 60 электрических градусов."]]),
      ],
    },
    {
      title: "Что можно менять",
      items: [
        "Машину — синхронную или асинхронную — кнопками в карточке «Машина».",
        "Момент нагрузки на валу — в любом режиме.",
        "Задания и коэффициенты регуляторов выбранного режима.",
        induction
          ? "Параметры двигателя: сопротивление статора и ротора, индуктивность"
            + " намагничивания и рассеяния, момент инерции."
          : "Параметры двигателя: сопротивление и индуктивность обмотки,"
            + " потокосцепление магнитов, момент инерции.",
        "Что показывать: векторы напряжения и ЭДС"
          + (induction ? ", поток ротора" : "") + ", оси α–β и d–q, проекции"
          + " тока. Оси d–q можно зафиксировать — тогда "
          + (induction ? "замирает поле, а ротор едва поворачивается на скольжение."
            : "ротор стоит на месте, а вращается статор."),
      ],
    },
    {
      title: "Что на картинке",
      items: [
        "Векторы тока i, напряжения u и ЭДС E"
          + (induction ? ", поток ротора ψr" : "") + "; цвета — в легенде под машиной.",
        induction
          ? "Оси α–β неподвижны, ось d смотрит по потоку ротора ψr; ротор отстаёт"
            + " от неё на скольжение s. Текущее скольжение показано в справке."
          : "Оси α–β неподвижны, оси d–q вращаются с ротором; ось d смотрит на"
            + " полюс N.",
        "Значки в пазах — мгновенный ток фаз: • — из экрана, × — в экран;"
          + " чем ярче значок, тем больше ток.",
        ...(induction ? ["Ротор — короткозамкнутая клетка: значки в стержнях — ток,"
          + " который в них наводит поле. Синяя метка — механический ноль ротора:"
          + " по ней видно, как ротор отстаёт от потока и тока."] : []),
        "Дуги вокруг статора — момент двигателя, момент нагрузки и момент трения;"
          + " дуга двигателя начинается там, где кончаются дуги сопротивления.",
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
        "При возврате на вкладку новая версия загружается автоматически."
          + " Обновить открытую страницу можно кнопкой рядом с версией в справке.",
      ],
    },
  ];
}

function helpIntroduction(machineType) {
  let ending = " Модель считается непрерывно, но примерно в 17 раз медленнее"
    + " реального времени, чтобы переходные процессы было видно глазом.";
  if (machineType === MACHINE_INDUCTION) {
    return "Модель асинхронной машины с короткозамкнутым ротором. На картинке —"
      + " поперечный разрез: статор с трёхфазной обмоткой и ротор-клетка."
      + " Момент появляется, только пока ротор отстаёт от поля статора." + ending;
  }
  return "Модель синхронной машины с постоянными магнитами"
    + " (PMSM). На картинке — поперечный разрез: статор с трёхфазной обмоткой и"
    + " двухполюсный ротор-магнит." + ending;
}

// Весь текст справки одной строкой — для проверки, что в нём упомянуто всё
// нужное.
function helpPlainText(machineType) {
  let parts = [helpIntroduction(machineType)];
  for (const section of helpSections(machineType)) {
    parts.push(section.title);
    for (const item of section.items) {
      parts.push(Array.isArray(item) ? item.join(" — ") : item);
    }
  }
  return parts.join("\n");
}

class HelpDialog {
  dialog;
  machineType;
  version;
  status;
  updateButton;
  reloadToUpdate;

  constructor(machineType = MACHINE_PMSM) {
    this.machineType = machineType;
  }

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
    this.version = element("p", "help__version",
      typeof PMSM_VERSION === "string" ? "Версия " + PMSM_VERSION : "");
    this.status = element("p", "help__status");
    this.status.hidden = true;
    content.append(this.version, element("p", "help__intro", helpIntroduction(this.machineType)),
      this.status);
    for (const section of helpSections(this.machineType)) {
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

  showUpdate(version, reload) {
    if (!this.updateButton) {
      this.updateButton = element("button", "help__update");
      this.updateButton.type = "button";
      this.updateButton.addEventListener("click", () => {
        this.updateButton.disabled = true;
        setText(this.updateButton, "обновляется…");
        this.reloadToUpdate();
      });
      this.version.append(" ", this.updateButton);
    }
    this.reloadToUpdate = reload;
    setText(this.updateButton, "обновить до " + version);
  }

  update(state, mode) {
    if (!this.dialog.open) return;
    let status = "";
    if (this.machineType === MACHINE_INDUCTION) {
      status = "Скольжение s = " + formatSlip(state);
    } else if (mode === MODE_AUTO_COMMUTATION) {
      const direction = state.voltageAlpha === 0 && state.voltageBeta === 0 ? "—"
        : Math.round(wrapAngle(Math.atan2(state.voltageBeta, state.voltageAlpha)) * 180 / PI) + "°";
      status = "Сектор ротора " + commutationSector(state.electricalAngle)
        + " · направление u: " + direction;
    }
    setText(this.status, status);
    setHidden(this.status, status === "");
  }

  open() {
    if (this.dialog.open) return;
    this.dialog.showModal();
  }

  close() {
    this.dialog.close();
  }
}

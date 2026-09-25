// Обновление страницы при выходе новой версии.
//
// На телефоне страницу не обновить жестом «потянуть вниз»: протягивания
// принадлежат машине, и style.css намеренно отключает упругую прокрутку
// (overscroll-behavior и touch-action). Поэтому страница сама следит за
// version.js на сервере и, когда версия там сменилась, обновляется.
//
// Когда обновляться — вопрос не технический. Перезагрузка сбрасывает модель и
// все ползунки, и выдернуть страницу из-под пальца посреди показа было бы
// хуже, чем показать старую версию. Поэтому:
//
//   * вернулся на вкладку (переключился из другого приложения, разблокировал
//     телефон) — новая версия загружается сразу: человек только что пришёл,
//     и терять ему нечего;
//   * страница открыта и на экране — рядом с версией под заголовком
//     появляется кнопка «обновить»; нажать её или нет, решает человек.
//
// Версия на сервере читается тем же version.js, что и подключён к странице,
// только в обход кешей: параметр в адресе мимо кеша GitHub Pages, no-store
// мимо кеша браузера. Без сети, из файла или в Processing проверка просто
// молчит.

// Как часто проверять, пока страница открыта на экране.
const VERSION_CHECK_INTERVAL_MS = 60000;
// Ключ sessionStorage: на какую версию страница уже перезагружалась сама.
const VERSION_RELOAD_KEY = "pmsm.reloadedForVersion";

// Версия из текста version.js. Формат строки задаёт хук .githooks/pre-commit:
// const PMSM_VERSION = "vYYYY.MM.DD HH:mm"; всё, что не похоже на него, —
// не версия (страница ошибки, обрезанный ответ), и это null.
function parseVersionStamp(text) {
  let match = /PMSM_VERSION\s*=\s*"(v\d{4}\.\d{2}\.\d{2} \d{2}:\d{2})"/.exec(String(text));
  return match ? match[1] : null;
}

// Адрес version.js, подключённого к этой странице. Страницы режимов лежат в
// подпапках и берут его из корня (../version.js), поэтому адрес берётся у
// самого тега, а не собирается заново.
function versionScriptUrl() {
  let script = document.querySelector('script[src$="version.js"]');
  return script ? script.src : null;
}

// Следит за версией. Вызывается один раз из setup(); onUpdateAvailable
// получает новую версию и функцию, которая на неё обновляет.
function startVersionWatch(onUpdateAvailable) {
  if (typeof PMSM_VERSION !== "string" || typeof fetch !== "function") return;
  let url = versionScriptUrl();
  if (!url || !/^https?:/.test(url)) return;

  let offered = null;
  let checking = false;

  async function check(returning) {
    if (checking) return;
    checking = true;
    try {
      let response = await fetch(url + "?check=" + Date.now(), { cache: "no-store" });
      let remote = response.ok ? parseVersionStamp(await response.text()) : null;
      if (remote === null || remote === PMSM_VERSION) return;
      // Уже перезагружались на эту версию, а пришла опять старая: значит,
      // какой-то кеш по дороге ещё отдаёт прежние файлы. Второй раз
      // перезагружаться сами не будем — иначе страница зациклится, пока
      // кеш не истечёт; кнопка останется.
      let alreadyTried = readReloadMark() === remote;
      if (returning && !alreadyTried) {
        reloadToVersion(remote);
      } else if (offered !== remote) {
        offered = remote;
        onUpdateAvailable(remote, () => reloadToVersion(remote));
      }
    } catch (error) {
      // Нет сети или сервер недоступен — проверим в следующий раз.
    } finally {
      checking = false;
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check(true);
  });
  // Страницы, открытые из кеша кнопкой «назад», не загружаются заново, и
  // visibilitychange на них может не прийти.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) check(true);
  });
  setInterval(() => {
    if (document.visibilityState === "visible") check(false);
  }, VERSION_CHECK_INTERVAL_MS);
  check(false);
}

// Перезагрузка на новую версию. Обычная перезагрузка сверяет с сервером только
// саму страницу, а скрипты и стили браузер может взять из кеша — и новая
// страница заработала бы со старым кодом. Поэтому сначала они запрашиваются
// заново с cache: "reload", что заодно обновляет кеш, и только потом
// перезагружается страница.
async function reloadToVersion(version) {
  writeReloadMark(version);
  let urls = [];
  for (const script of document.querySelectorAll("script[src]")) urls.push(script.src);
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) urls.push(link.href);
  let sameOrigin = urls.filter((url) => url.startsWith(window.location.origin));
  await Promise.allSettled(sameOrigin.map((url) => fetch(url, { cache: "reload" })));
  window.location.reload();
}

// sessionStorage бывает недоступен (приватный режим, запрет сайта) — тогда
// защиты от повторной перезагрузки нет, но и ломаться из-за этого нечему.
function readReloadMark() {
  try {
    return window.sessionStorage.getItem(VERSION_RELOAD_KEY);
  } catch (error) {
    return null;
  }
}

function writeReloadMark(version) {
  try {
    window.sessionStorage.setItem(VERSION_RELOAD_KEY, version);
  } catch (error) {
    // Без отметки обновление всё равно пройдёт.
  }
}

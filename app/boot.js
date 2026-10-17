// Boot watchdog. A classic script that runs before the app modules, so it still works when
// a module fails to load or a startup step never finishes:
//   * main.js reports each startup stage here (window.__boot.stage);
//   * a stage that takes too long, or a module error, replaces «Загрузка…» with a
//     diagnostic screen that names the stage and offers safe next steps;
//   * a failed module load (stale or broken cached files, a half-applied update) is
//     repaired once automatically: the service worker re-downloads the app files, or is
//     removed if it can't. Training data in IndexedDB is never touched by any of this.
(function () {
  'use strict';

  var BUILD = '__BUILD__'; // stamped with the commit hash on deploy
  var STAGES = {
    modules: 'Загрузка файлов приложения',
    'storage-open': 'Открытие базы данных на устройстве (IndexedDB)',
    'storage-read': 'Чтение сохранённых тренировок',
    'storage-write': 'Проверка записи на устройство',
    import: 'Перенос программы из Google Таблицы (первый запуск)',
    ui: 'Отрисовка интерфейса',
  };
  var STORAGE_STAGES = { 'storage-open': 1, 'storage-read': 1, 'storage-write': 1 };
  var HEAL_KEY = 'trainer.healAt';
  var TEMP_KEY = 'trainer.tempMode';
  var HEAL_GUARD_MS = 2 * 60 * 1000;

  var t0 = Date.now();
  var current = 'modules';
  var log = [{ stage: 'modules', at: 0 }];
  var finished = false;
  var failed = null;
  var timer = null;
  var newVersionReady = false;
  var healing = false;

  function storage(kind) {
    try {
      return window[kind];
    } catch (e) {
      return null;
    }
  }
  function getItem(kind, key) {
    try {
      return storage(kind).getItem(key);
    } catch (e) {
      return null;
    }
  }
  function setItem(kind, key, value) {
    try {
      if (value === null) storage(kind).removeItem(key);
      else storage(kind).setItem(key, value);
    } catch (e) {
      /* storage unavailable: the URL marker below still guards against loops */
    }
  }

  // What happened at the previous launch (helps when a launch froze the page).
  var previous = null;
  try {
    previous = JSON.parse(getItem('localStorage', 'trainer.lastBoot') || 'null');
  } catch (e) {
    previous = null;
  }
  function remember() {
    setItem(
      'localStorage',
      'trainer.lastBoot',
      JSON.stringify({ build: BUILD, at: t0, stage: current, ok: finished, error: failed ? failed.message : null }),
    );
  }

  function limitFor(stage) {
    if (window.__TRAINER_BOOT_TIMEOUT_MS) return window.__TRAINER_BOOT_TIMEOUT_MS;
    if (stage === 'modules') {
      // From the offline cache the code loads in well under a second; over a slow mobile
      // network on the very first visit it may take much longer.
      var cached = navigator.serviceWorker && navigator.serviceWorker.controller;
      return cached ? 12000 : 45000;
    }
    return 20000;
  }

  function arm() {
    clearTimeout(timer);
    var ms = limitFor(current);
    timer = setTimeout(function () {
      fail(new Error('нет ответа ' + Math.round(ms / 1000) + ' с'), current);
    }, ms);
  }

  function stage(id) {
    if (finished) return;
    current = id;
    log.push({ stage: id, at: Date.now() - t0 });
    remember();
    if (!failed) arm();
  }

  function done() {
    finished = true;
    clearTimeout(timer);
    log.push({ stage: 'done', at: Date.now() - t0 });
    remember();
    setItem('sessionStorage', HEAL_KEY, null);
    var el = document.getElementById('boot');
    if (el) el.remove();
    if (/[?&]heal=/.test(location.search) && history.replaceState) {
      history.replaceState(null, '', location.pathname + location.hash);
    }
  }

  function fail(err, stageId) {
    if (finished || failed) return;
    clearTimeout(timer);
    var at = stageId || current;
    failed = { stage: at, message: describe(err), at: Date.now() - t0 };
    current = at;
    remember();
    console.error('[boot] ' + at + ':', err);
    // A newer release that is already downloaded may have the fix: let it take over.
    activateWaitingWorker();
    if (at === 'modules') {
      healing = true;
      render({ checking: true });
      Promise.all([online(), checkModules()]).then(function (r) {
        failed.files = r[1];
        // Refused while the network works: a content blocker. Re-downloading can't help.
        var blocked = r[0]
          ? r[1].problems.filter(function (p) {
              return p.reason === 'blocked';
            })
          : [];
        if (blocked.length) {
          healing = false;
          failed.blocked = blocked.map(function (p) {
            return shortUrl(p.url);
          });
          render({});
        } else if (!healedRecently()) {
          render({ healing: true });
          heal().then(showHealResult);
        } else {
          healing = false;
          render({});
        }
      });
    } else {
      render({});
    }
  }

  function showHealResult(problem) {
    if (problem === null) return; // reloading
    healing = false;
    failed.heal = problem;
    render({});
  }

  function describe(err) {
    if (!err) return 'неизвестная ошибка';
    if (typeof err === 'string') return err;
    var text = err.message || String(err);
    if (err.name && err.name !== 'Error' && text.indexOf(err.name) === -1) text = err.name + ': ' + text;
    return text;
  }

  // --- module failures -----------------------------------------------------------------
  // Before main.js runs, any error from our own scripts means the app code didn't load:
  // a file missing from the cache, a 504 while offline, or files of two releases that
  // don't fit together.
  window.addEventListener(
    'error',
    function (event) {
      if (finished || current !== 'modules') return;
      var target = event.target;
      if (target && target !== window) {
        if (target.tagName !== 'SCRIPT') return; // e.g. a font preload: not fatal
        fail(new Error('не загрузился ' + shortUrl(target.src)), 'modules');
        return;
      }
      if (event.filename && event.filename.indexOf(location.origin) !== 0) return;
      var where = event.filename ? ' (' + shortUrl(event.filename) + ':' + event.lineno + ')' : '';
      fail(new Error(describe(event.error || event.message) + where), 'modules');
    },
    true,
  );

  function shortUrl(url) {
    try {
      var u = new URL(url, location.href);
      var base = location.pathname.replace(/[^/]*$/, '');
      return u.pathname.indexOf(base) === 0 ? u.pathname.slice(base.length) : u.pathname;
    } catch (e) {
      return String(url);
    }
  }

  // --- service worker recovery ------------------------------------------------------------

  function within(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () {
        var err = new Error('нет ответа ' + Math.round(ms / 1000) + ' с');
        err.timeout = true;
        reject(err);
      }, ms);
      Promise.resolve(promise).then(
        function (v) {
          clearTimeout(t);
          resolve(v);
        },
        function (e) {
          clearTimeout(t);
          reject(e);
        },
      );
    });
  }

  function healedRecently() {
    var at = Number(getItem('sessionStorage', HEAL_KEY) || 0);
    var m = /[?&]heal=(\d+)/.exec(location.search);
    if (m) at = Math.max(at, Number(m[1]));
    return Date.now() - at < HEAL_GUARD_MS;
  }

  function reloadAfterHeal() {
    var now = String(Date.now());
    setItem('sessionStorage', HEAL_KEY, now);
    var query = location.search.replace(/([?&])heal=\d+&?/, '$1').replace(/[?&]$/, '');
    location.replace(location.pathname + (query ? query + '&' : '?') + 'heal=' + now + location.hash);
    return null;
  }

  // Ask a service worker something over a MessageChannel; null when it doesn't answer
  // (a release from before this protocol, or a broken worker).
  function ask(worker, message, ms) {
    if (!worker) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var channel = new MessageChannel();
      var t = setTimeout(function () {
        resolve(null);
      }, ms);
      channel.port1.onmessage = function (event) {
        clearTimeout(t);
        resolve(event.data || null);
      };
      try {
        worker.postMessage(message, [channel.port2]);
      } catch (e) {
        clearTimeout(t);
        resolve(null);
      }
    });
  }

  // --- which file failed ------------------------------------------------------------------
  // Safari reports a failed dependency on the page's own module script (js/main.js), not on
  // the file that failed. Walk the import graph with fetch() to name it. A request that a
  // content blocker refuses fails like a network error while the rest of the network works.
  var IMPORT_RE = /^\s*(?:import|export)\s[^'"]*?['"](\.{1,2}\/[^'"]+)['"]/gm;

  function checkModules() {
    var entry = new URL('./js/main.js', location.href).href;
    var seen = {};
    seen[entry] = true;
    var result = { checked: 0, problems: [] };
    function level(urls) {
      if (!urls.length) return Promise.resolve(result);
      return Promise.all(
        urls.map(function (url) {
          return within(fetch(url, { cache: 'no-store' }), Math.min(5000, limitFor('modules'))).then(
            function (res) {
              result.checked++;
              if (!res.ok) {
                result.problems.push({ url: url, reason: 'HTTP ' + res.status });
                return [];
              }
              return res.text().then(function (src) {
                var next = [];
                var m;
                IMPORT_RE.lastIndex = 0;
                while ((m = IMPORT_RE.exec(src))) {
                  var dep = new URL(m[1], url).href;
                  if (!seen[dep]) {
                    seen[dep] = true;
                    next.push(dep);
                  }
                }
                return next;
              });
            },
            function (err) {
              result.checked++;
              // A refusal fails at once; a request that hangs is a network problem, not a blocker.
              result.problems.push({ url: url, reason: err && err.timeout ? 'нет ответа' : 'blocked', error: describe(err) });
              return [];
            },
          );
        }),
      ).then(function (lists) {
        return level([].concat.apply([], lists));
      });
    }
    return level([entry]).catch(function (err) {
      result.error = describe(err);
      return result;
    });
  }

  function online() {
    // sw.js is never served from the offline cache, so any HTTP answer means the network works.
    return within(fetch('./sw.js?probe=' + Date.now(), { cache: 'no-store' }), 8000).then(
      function () {
        return true;
      },
      function () {
        return false;
      },
    );
  }

  function activateWaitingWorker() {
    var sw = navigator.serviceWorker;
    if (!sw) return;
    sw.addEventListener('controllerchange', function () {
      newVersionReady = true;
      if (failed && !healing) render({});
    });
    within(sw.getRegistration(), 3000).then(
      function (reg) {
        if (reg && reg.waiting) reg.waiting.postMessage({ type: 'skip-waiting' });
      },
      function () {},
    );
  }

  // Returns a problem description, or null when the page is reloading.
  function heal() {
    var sw = navigator.serviceWorker;
    healing = true;
    return online()
      .then(function (isOnline) {
        if (!isOnline) return 'нет сети: файлы приложения обновятся, когда появится интернет';
        if (!sw) return reloadAfterHeal();
        return within(sw.getRegistration(), 3000).then(function (reg) {
          if (!reg) return reloadAfterHeal();
          return within(reg.update(), 10000)
            .catch(function () {})
            .then(function () {
              if (reg.waiting) reg.waiting.postMessage({ type: 'skip-waiting' });
              return ask(sw.controller || reg.active, { type: 'refresh-cache' }, 30000);
            })
            .then(function (answer) {
              if (answer && answer.ok) return reloadAfterHeal();
              // The worker can't repair its copy: remove it and its file cache. The next load
              // comes from the network and installs a fresh worker. IndexedDB stays as it is.
              return within(reg.unregister(), 5000)
                .catch(function () {})
                .then(dropFileCaches)
                .then(reloadAfterHeal);
            });
        });
      })
      .catch(function (err) {
        return 'восстановление не удалось: ' + describe(err);
      });
  }

  function dropFileCaches() {
    if (!window.caches) return Promise.resolve();
    return within(
      caches.keys().then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) {
              return k.indexOf('trainer-') === 0;
            })
            .map(function (k) {
              return caches.delete(k);
            }),
        );
      }),
      5000,
    ).catch(function () {});
  }

  // --- diagnostic screen -----------------------------------------------------------------

  function collect() {
    var lines = [];
    var sw = navigator.serviceWorker;
    var jobs = [];
    lines.push('Тренировки: отчёт о запуске');
    lines.push('Сборка: ' + BUILD + '; адрес: ' + location.href);
    lines.push('Время: ' + new Date().toISOString());
    lines.push('Этап: ' + (STAGES[failed.stage] || failed.stage) + ' [' + failed.stage + ']');
    lines.push('Ошибка: ' + failed.message);
    if (failed.heal) lines.push('Восстановление файлов: ' + failed.heal);
    if (failed.files) {
      lines.push(
        'Проверка модулей: ' + failed.files.checked + ' файлов, ' +
          (failed.files.problems.length
            ? 'не загружаются: ' +
              failed.files.problems
                .map(function (p) {
                  return shortUrl(p.url) + ' (' + (p.reason === 'blocked' ? 'запрос отклонён: ' + p.error : p.reason) + ')';
                })
                .join(', ')
            : 'все загружаются'),
      );
    }
    lines.push(
      'Ход запуска: ' +
        log
          .map(function (e) {
            return e.stage + ' +' + e.at + ' мс';
          })
          .join(', '),
    );
    if (previous) {
      lines.push(
        'Предыдущий запуск: сборка ' + previous.build + ', ' + new Date(previous.at).toISOString() + ', ' +
          (previous.ok ? 'успешно' : 'не завершился на этапе ' + previous.stage + (previous.error ? ' (' + previous.error + ')' : '')),
      );
    }
    lines.push('Сеть: ' + (navigator.onLine ? 'есть' : 'нет') + '; режим: ' + (isStandalone() ? 'приложение с экрана «Домой»' : 'вкладка браузера'));
    lines.push('Браузер: ' + navigator.userAgent);
    if (sw) {
      var c = sw.controller;
      lines.push('Service Worker страницы: ' + (c ? c.state : 'нет'));
      jobs.push(
        within(sw.getRegistration(), 2000).then(function (reg) {
          if (!reg) return 'Регистрация SW: нет';
          return 'Регистрация SW: active=' + (reg.active ? reg.active.state : '—') + ', waiting=' + (reg.waiting ? 'да' : 'нет') + ', installing=' + (reg.installing ? 'да' : 'нет');
        }),
      );
      jobs.push(
        ask(c, { type: 'version' }, 1500).then(function (v) {
          return 'Версия SW: ' + (v ? v.build : 'не ответил (старый выпуск или нет SW)');
        }),
      );
    }
    if (window.caches) {
      jobs.push(
        within(caches.keys(), 2000).then(function (keys) {
          return 'Кэши файлов: ' + (keys.join(', ') || 'нет');
        }),
      );
    }
    if (navigator.storage && navigator.storage.estimate) {
      jobs.push(
        within(navigator.storage.estimate(), 2000).then(function (e) {
          return 'Хранилище: занято ' + Math.round((e.usage || 0) / 1024) + ' КБ из ' + Math.round((e.quota || 0) / 1048576) + ' МБ';
        }),
      );
    }
    if (window.indexedDB && indexedDB.databases) {
      jobs.push(
        within(indexedDB.databases(), 2000).then(function (list) {
          return 'Базы IndexedDB: ' + (list.map(function (d) { return d.name + ' v' + d.version; }).join(', ') || 'нет');
        }),
      );
    }
    return Promise.all(
      jobs.map(function (job) {
        return job.catch(function (e) {
          return 'не удалось узнать: ' + describe(e);
        });
      }),
    ).then(function (more) {
      return lines.concat(more).join('\n');
    });
  }

  function isStandalone() {
    return navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  }

  function node(tag, attrs, children) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === 'text') el.textContent = attrs[k];
      else if (k === 'onclick') el.addEventListener('click', attrs[k]);
      else el.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) {
      if (c) el.appendChild(c);
    });
    return el;
  }

  function render(opts) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        render(opts);
      });
      return;
    }
    var host = document.getElementById('boot');
    if (!host) {
      host = node('div', { id: 'boot' });
      document.body.appendChild(host);
    }
    host.removeAttribute('style');
    host.className = 'diag';
    host.textContent = '';
    if (opts.checking) {
      host.appendChild(node('h1', { text: 'Проверяю файлы приложения…' }));
      host.appendChild(node('p', { text: 'Приложение не загрузилось. Ищу файл, который не удаётся получить.' }));
      return;
    }
    if (opts.healing) {
      host.appendChild(node('h1', { text: 'Обновляю файлы приложения…' }));
      host.appendChild(node('p', { text: 'Файлы приложения в памяти телефона не загрузились. Скачиваю их заново, страница перезапустится сама. Тренировки на устройстве не затрагиваются.' }));
      return;
    }
    var isStorage = !!STORAGE_STAGES[failed.stage];
    var report = node('textarea', { class: 'diag__report', readonly: 'readonly', rows: '9', 'aria-label': 'Отчёт для разработчика' });
    report.value = 'Собираю отчёт…';
    collect().then(function (text) {
      report.value = text;
    });

    var actions = node('div', { class: 'diag__actions' }, [
      node('button', {
        type: 'button',
        class: 'btn btn--primary',
        text: newVersionReady ? 'Запустить новую версию' : 'Повторить',
        onclick: function () {
          location.reload();
        },
      }),
      node('button', {
        type: 'button',
        class: 'btn',
        text: 'Скопировать отчёт',
        onclick: function (event) {
          var button = event.currentTarget;
          var text = report.value;
          var copied = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject();
          copied.then(
            function () {
              button.textContent = 'Отчёт скопирован';
            },
            function () {
              report.focus();
              report.select();
              button.textContent = 'Выделено: скопируйте вручную';
            },
          );
        },
      }),
      node('button', {
        type: 'button',
        class: 'btn',
        text: 'Обновить файлы приложения',
        onclick: function (event) {
          event.currentTarget.disabled = true;
          render({ healing: true });
          heal().then(showHealResult);
        },
      }),
    ]);

    host.appendChild(node('h1', { text: 'Приложение не запустилось' }));
    host.appendChild(
      node('p', { class: 'diag__stage' }, [
        node('b', { text: 'Этап: ' }),
        document.createTextNode((STAGES[failed.stage] || failed.stage) + '. '),
        document.createTextNode(failed.message),
      ]),
    );
    if (failed.blocked) {
      host.appendChild(
        node('p', { class: 'diag__stage' }, [
          node('b', { text: 'Не загружается: ' + failed.blocked.join(', ') + '. ' }),
          document.createTextNode(
            'Интернет при этом работает. Так бывает, когда файл отклоняет блокировщик контента Safari: его правила против рекламы и трекеров срабатывают на имя файла. Это ошибка приложения, а не ваших настроек — скопируйте отчёт и пришлите разработчику.',
          ),
        ]),
      );
    }
    if (failed.heal) host.appendChild(node('p', { text: 'Восстановление файлов: ' + failed.heal + '.' }));
    if (newVersionReady) host.appendChild(node('p', { text: 'Загружена новая версия приложения: нажмите «Запустить новую версию».' }));
    host.appendChild(node('p', { text: 'Сохранённые тренировки не удалялись: ни этот экран, ни кнопки ниже не трогают данные на устройстве.' }));
    host.appendChild(actions);

    if (isStorage) {
      host.appendChild(
        node('div', { class: 'diag__temp' }, [
          node('p', {
            text:
              'Можно продолжить без базы на устройстве. Внимание: это временный режим. Новые записи будут только в памяти и пропадут при закрытии вкладки, если не успеют отправиться в Google Таблицу. Сохранённые раньше тренировки в нём не видны, но не удаляются.',
          }),
          node('button', {
            type: 'button',
            class: 'btn',
            text: 'Продолжить без сохранения',
            onclick: function () {
              setItem('sessionStorage', TEMP_KEY, '1');
              if (getItem('sessionStorage', TEMP_KEY) === '1') location.reload();
              else location.replace(location.pathname + location.search + '#temp');
            },
          }),
        ]),
      );
    }
    host.appendChild(node('p', { class: 'diag__hint', text: 'Если экран повторяется, скопируйте отчёт и пришлите его разработчику.' }));
    host.appendChild(report);
  }

  window.__boot = {
    build: BUILD,
    stages: STAGES,
    stage: stage,
    done: done,
    fail: function (err, stageId) {
      fail(err, stageId);
    },
    get failed() {
      return failed;
    },
    tempMode: function () {
      return getItem('sessionStorage', TEMP_KEY) === '1' || location.hash === '#temp';
    },
    leaveTempMode: function () {
      setItem('sessionStorage', TEMP_KEY, null);
      location.replace(location.pathname + location.search);
    },
  };

  remember();
  arm();
})();

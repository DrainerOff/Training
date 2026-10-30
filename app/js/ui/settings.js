// Settings, program editor and the text importers.

import { html, useState, useRef, app, Icon, Sheet, openSheet, Seg, Toggle, confirmSheet } from './core.js';
import {
  CATEGORY, CATEGORY_KEYS, exerciseCatalog, makeSlot, optionsFromNames, parseProgramText, programToText, parseOverride,
  fmtOverride, targetFor, fmtTarget, reuseKeys,
} from '../lib/program.js';
import { parseResultsText } from '../lib/textimport.js';
import { fmtDay, fmtTime, fmtNum, parseNum, uid, plural } from '../lib/util.js';
import { describeError, checkApiUrl, checkToken } from '../data/sync.js';
import { SETUP_MAX } from '../data/store.js';
import { findSameSlotSession } from '../lib/planner.js';
import { knownKeys } from '../lib/exercises.js';
import { exercisesNow } from './derive.js';

const ORIGINAL_PROGRAM_URL = 'https://docs.google.com/spreadsheets/d/1uiEDiFZYKHKUqVUqPT4HrZlBR8fqNGYr/edit';
const CURRENT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/10jlAOVqpZbhSr_-v5Ahz83oHcJFXZnz187nspKKlVkg/edit';

export const PROGRAM_PROMPT = `Открой Google Таблицу с исходной программой тренировок: ${ORIGINAL_PROGRAM_URL}
Перепиши программу строго в этом текстовом формате, ничего не меняя в составе упражнений и порядке:

День 1: <название дня, если есть>
- <Упражнение> [категория] / <альтернатива> / <альтернатива>

Категории: [base] — базовые (жим штанги, маятниковый присед, горизонтальные и вертикальные тяги), [hammer] — Hammer, [pullup] — подтягивания, [iso] — изоляция и пресс, [calves] — икры.
Если в программе для упражнения указаны свои подходы/повторения по неделям, добавь в строку н1=3x10-12@4-5 н2=... н3=... (подходы x повторения @ RIR). Если не указаны — не добавляй.
Выведи только текст программы, без пояснений.`;

export const RESULTS_PROMPT = `Открой Google Таблицу: ${CURRENT_SHEET_URL}
Выпиши ВСЕ фактически выполненные тренировки — только реально записанные результаты, не план и не расчётные значения — в формате:

16.10.2026 цикл 1 неделя 1 день 1
Название упражнения: 60x10@4, 60x10@4, 60x9@3

Правила: вес в кг (дробные через запятую), «x» между весом и повторениями, «@RIR» только если фактический RIR записан. Подтягивания без веса — «св x6». Дроп-сет — «дроп 70x10». Названия упражнений — как в таблице. Ничего не придумывай: если значение не записано, пропусти подход.`;

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    app.ui.toast('Скопировано');
  } catch {
    app.ui.toast('Не удалось скопировать — выделите текст вручную');
  }
}

function Back({ title, onBack = null, action = null }) {
  return html`<header class="topbar">
    <button type="button" class="icon-btn" aria-label="Назад" onClick=${() => (onBack ? onBack() : app.ui.back())}><${Icon} name="back" /></button>
    <h1>${title}</h1>
    ${action}
  </header>`;
}

// ---------------------------------------------------------------- settings

export function Settings({ syncStatus }) {
  const st = app.store.state;
  const cfg = st.kv.sync || {};
  const [url, setUrl] = useState(cfg.url || '');
  const [token, setToken] = useState(cfg.token || '');
  const [check, setCheck] = useState(null);
  const theme = st.kv.theme || 'auto';

  const saveAndTest = async () => {
    const next = { url: url.trim(), token: token.replace(/\s+/g, '') };
    if (next.url || next.token) {
      const problem = checkApiUrl(next.url) || checkToken(next.token);
      if (problem) {
        setCheck({ ok: false, text: problem });
        return;
      }
    }
    await app.store.setKV({ sync: next });
    if (!next.url || !next.token) {
      setCheck({ ok: false, text: 'Синхронизация выключена: данные хранятся только на этом устройстве.' });
      app.sync.refresh();
      return;
    }
    setCheck({ ok: null, text: 'Проверяю…' });
    try {
      const res = await app.sync.ping(next);
      setCheck({ ok: true, text: `Подключено к таблице «${res.name}».` });
      app.sync.syncNow();
    } catch (err) {
      const unreachable = err?.code === 'network' && navigator.onLine;
      setCheck({
        ok: false,
        text: unreachable
          ? 'Веб-приложение не ответило. Проверьте: 1) в развертывании выбран доступ «Все», а не «Все, у кого есть аккаунт Google»; 2) адрес взят из «Управление развертываниями» и оканчивается на /exec; 3) на телефоне есть интернет.'
          : describeError(err),
      });
    }
  };

  const statusText = {
    off: 'Не подключено: всё хранится только на этом устройстве.',
    idle: syncStatus.lastSyncAt ? `Синхронизировано в ${fmtTime(syncStatus.lastSyncAt)}.` : 'Готово к синхронизации.',
    syncing: 'Идёт синхронизация…',
    offline: 'Нет связи. Изменения сохранены на телефоне и отправятся автоматически.',
    error: syncStatus.error || 'Ошибка синхронизации.',
  }[syncStatus.state];

  const exportBackup = async () => {
    const data = JSON.stringify(app.store.exportAll());
    const name = `trainer-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([data], name, { type: 'application/json' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return;
      }
    } catch {
      /* share cancelled — fall back to download */
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const importBackup = async (e) => {
    const input = e.currentTarget; // currentTarget is null after the first await
    const f = input.files?.[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const { changed } = await app.store.importBackup(obj);
      app.ui.toast(`Восстановлено записей: ${changed}`);
    } catch (err) {
      app.ui.toast(`Файл не подошёл: ${err.message}`);
    }
    input.value = '';
  };

  return html`<main class="screen">
    <${Back} title="Настройки" />

    <h2 class="section-title">Google Таблица</h2>
    <div class="settings-group" style="padding:14px">
      <p style="font-size:14px">${statusText}${syncStatus.pending
        ? syncStatus.state === 'off'
          ? ` Изменений для отправки: ${syncStatus.pending} — уйдут в таблицу после подключения.`
          : ` Ждут отправки: ${syncStatus.pending}.`
        : ''}</p>
      ${syncStatus.notice ? html`<p class="notice notice--caution sync-notice">${syncStatus.notice}</p>` : null}
      <div class="kv" style="margin-top:12px">
        <label for="sync-url">Адрес веб-приложения Apps Script (…/exec)</label>
        <input id="sync-url" class="input" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
          placeholder="https://script.google.com/macros/s/…/exec" value=${url} onInput=${(e) => setUrl(e.currentTarget.value)} />
      </div>
      <div class="kv" style="margin-top:10px">
        <label for="sync-token">Ключ доступа</label>
        <input id="sync-token" class="input" autocomplete="off" autocapitalize="off" spellcheck="false"
          placeholder="из меню «Тренировки» в таблице" value=${token} onInput=${(e) => setToken(e.currentTarget.value)} />
      </div>
      ${check ? html`<p style="font-size:14px;margin-top:10px" class=${check.ok === false ? 'warn-line' : 'muted'}>${check.text}</p>` : null}
      <div class="btn-stack" style="margin-top:12px">
        <button type="button" class="btn btn--primary" onClick=${saveAndTest}>Сохранить и проверить связь</button>
        ${syncStatus.state !== 'off' ? html`<button type="button" class="btn" onClick=${() => app.sync.syncNow()}>Синхронизировать сейчас</button>` : null}
        ${syncStatus.state !== 'off' ? html`<button type="button" class="btn" onClick=${() => openSheet((close) => html`<${RestoreCheckSheet} onClose=${close} />`)}>Проверить восстановление</button>` : null}
      </div>
      <p class="muted" style="font-size:13px;margin-top:10px">Как подключить: таблица → Расширения → Apps Script → вставить код из apps-script/Code.gs → меню «Тренировки» → «Подготовить листы и ключ» → Развернуть как веб-приложение (доступ «Все»). Подробно — в README.</p>
    </div>

    <h2 class="section-title">Программа</h2>
    <div class="settings-group">
      <button type="button" class="choice" onClick=${() => app.ui.go({ view: { type: 'program' } })}>
        <span class="choice__main">Редактировать программу<span class="choice__sub">${st.program.days.length} дн., ${st.program.days.reduce((t, d) => t + d.slots.length, 0)} упражнений${st.program.draft ? ', не заполнена' : ''}</span></span></button>
      <button type="button" class="choice" onClick=${() => app.ui.go({ view: { type: 'program-import' } })}>
        <span class="choice__main">Вставить программу текстом</span></button>
      <button type="button" class="choice" onClick=${() => copy(programToText(st.program))}>
        <span class="choice__main">Скопировать программу как текст</span></button>
    </div>

    <h2 class="section-title">Прошлые тренировки</h2>
    <div class="settings-group">
      <button type="button" class="choice" onClick=${() => app.ui.go({ view: { type: 'results-import' } })}>
        <span class="choice__main">Перенести из текста<span class="choice__sub">например, тренировку 16.10 из старой таблицы</span></span></button>
    </div>

    <h2 class="section-title">Резервная копия</h2>
    <div class="settings-group">
      <button type="button" class="choice" onClick=${exportBackup}><span class="choice__main">Сохранить копию (JSON)</span></button>
      <label class="choice" style="cursor:pointer">
        <span class="choice__main">Восстановить из файла<span class="choice__sub">записи объединяются, ничего не удаляется</span></span>
        <input type="file" accept="application/json,.json" class="sr-only" onChange=${importBackup} />
      </label>
    </div>

    <h2 class="section-title">Экран</h2>
    <div class="settings-group" style="padding:12px 14px">
      <${Toggle} on=${!!st.kv.wakeLock} onChange=${(v) => app.store.setKV({ wakeLock: v })}>Не гасить экран во время тренировки</${Toggle}>
      <div style="margin-top:12px">
        <${Seg} label="Тема" value=${theme} onChange=${(v) => { app.store.setKV({ theme: v }); applyTheme(v); }}
          options=${[{ value: 'auto', label: 'Как в системе' }, { value: 'light', label: 'Светлая' }, { value: 'dark', label: 'Тёмная' }]} />
      </div>
    </div>

    <p class="muted" style="font-size:12px;margin-top:20px">Версия ${app.version}${app.build && !app.build.startsWith('__') ? `, сборка ${app.build}` : ''}. Хранилище: ${app.storageKind}${app.persisted ? ', постоянное' : ''}.</p>
  </main>`;
}

// Would a new phone get everything? Reads the whole sheet the way a new phone does and compares
// it with this one; nothing is sent, nothing received is applied.
function RestoreCheckSheet({ onClose }) {
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      await app.sync.syncNow(); // send what is waiting first, so the comparison is about what is stored
      setRes(await app.sync.verify());
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setBusy(false);
    }
  };
  const footer = html`<button type="button" class="btn btn--primary btn--big" disabled=${busy} onClick=${run}>${busy ? 'Проверяю…' : res ? 'Проверить ещё раз' : 'Проверить'}</button>`;
  return html`<${Sheet} title="Проверка восстановления" onClose=${onClose} footer=${footer}>
    <p style="font-size:15px">Приложение прочитает из таблицы всё, что получил бы новый телефон, и сравнит с этим телефоном запись за записью. Ничего не отправляется и не меняется.</p>
    ${err ? html`<p class="warn-line">${err}</p>` : null}
    ${res
      ? html`<div class=${'notice' + (res.ok ? '' : ' notice--caution')} role="status" aria-label="Результат проверки">
          <h3>${res.ok ? 'Новый телефон получит всё' : 'Новый телефон получит не всё'}</h3>
          <p>${res.ok
            ? 'Каждая запись этого телефона есть в таблице в той же версии.'
            : `Проблем: ${res.problems}. Синхронизируйте и проверьте ещё раз; если не помогло — обновите Code.gs (docs/SETUP.md).`}</p>
        </div>
        <ul class="rows restore-rows">
          ${res.rows.map((r) => html`<li class="row">
            <span class="row__title">${r.label}</span>
            <span class="num">${r.unsupported ? '—' : r.there}</span>
            <span class="row__sub">${r.unsupported
              ? r.here ? `на телефоне ${r.here}; эта версия Code.gs их не хранит` : 'эта версия Code.gs их не хранит'
              : [
                  `на телефоне ${r.here}`,
                  r.pending ? `ждут отправки ${r.pending}` : null,
                  r.missing ? `нет в таблице ${r.missing}` : null,
                  r.older ? `в таблице старее ${r.older}` : null,
                  r.newer ? `в таблице новее ${r.newer} — придут при синхронизации` : null,
                  r.onlyThere ? `только в таблице ${r.onlyThere}` : null,
                ].filter(Boolean).join(', ')}</span>
          </li>`)}
          <li class="row"><span class="row__title">программа</span><span>${res.program.ok ? 'совпадает' : 'в таблице старее'}</span></li>
        </ul>`
      : null}
    <p class="muted" style="font-size:13px">Полная проверка без второго телефона: откройте draineroff.github.io/Training в Safari, а не с экрана «Домой», — у Safari своё хранилище, это как новый телефон. Подключите тот же адрес и ключ, дождитесь синхронизации и сравните «Тело», «Прогресс» и последние тренировки.</p>
  <//>`;
}

export function applyTheme(v) {
  if (v === 'light' || v === 'dark') document.documentElement.dataset.theme = v;
  else delete document.documentElement.dataset.theme;
}

// ---------------------------------------------------------------- program editor

export function ProgramEditor() {
  const [draft, setDraft] = useState(() => structuredClone(app.store.state.program));
  const [day, setDay] = useState(draft.days[0]?.day || 1);
  const [dirty, setDirty] = useState(false);
  const d = draft.days.find((x) => x.day === day) || draft.days[0];
  const mutate = (fn) => {
    setDraft((p) => {
      const n = structuredClone(p);
      fn(n);
      return n;
    });
    setDirty(true);
  };
  const curDay = (p) => p.days.find((x) => x.day === d.day);
  const move = (i, dir) => mutate((p) => {
    const s = curDay(p).slots;
    const j = i + dir;
    if (j < 0 || j >= s.length) return;
    [s[i], s[j]] = [s[j], s[i]];
  });
  const editSlot = (slot, idx) =>
    openSheet((close) => html`<${SlotSheet} slot=${slot} onClose=${close}
      onSave=${(ns) => mutate((p) => { const s = curDay(p).slots; if (idx == null) s.push(ns); else s[idx] = ns; })}
      onDelete=${idx == null ? null : () => mutate((p) => curDay(p).slots.splice(idx, 1))} />`);
  const save = async () => {
    await app.store.saveProgram(draft);
    setDirty(false);
    app.ui.toast('Программа сохранена');
    app.ui.back();
  };
  // Leaving with unsaved changes asks first; «Сохранить» stays at the top while there are any.
  const leave = async () => {
    if (dirty && !(await confirmSheet({ title: 'Выйти без сохранения программы?', text: 'Изменения программы не сохранятся. Настройки тренажёра, сохранённые по «Готово», останутся.', okLabel: 'Выйти', cancelLabel: 'Остаться', danger: true }))) return;
    app.ui.back();
  };
  const saveTop = dirty ? html`<button type="button" class="btn btn--primary topbar__action" onClick=${save}>Сохранить</button>` : null;

  if (!d) return html`<main class="screen"><${Back} title="Программа" /></main>`;
  return html`<main class="screen">
    <${Back} title="Программа" onBack=${leave} action=${saveTop} />
    <p class="muted" style="font-size:14px">Изменения применяются к новым тренировкам. Прошлые тренировки не меняются.</p>
    <div style="margin:12px 0">
      <${Seg} label="День" value=${d.day} onChange=${setDay}
        options=${[...draft.days.map((x) => ({ value: x.day, label: `День ${x.day}` }))]} />
    </div>
    <input class="input" placeholder="Название дня (необязательно)" value=${d.title}
      onInput=${(e) => { const t = e.currentTarget.value; mutate((p) => { curDay(p).title = t; }); }} />
    <div style="margin-top:8px">
      ${d.slots.map(
        (s, i) => html`<div class="slot-edit" key=${s.id}>
          <button type="button" style="text-align:left" onClick=${() => editSlot(s, i)}>
            <div style="font-weight:600">${s.options[0].name}</div>
            <div class="muted" style="font-size:13px">${CATEGORY[s.category].label}${s.options.length > 1 ? `; альтернативы: ${s.options.slice(1).map((o) => o.name).join(', ')}` : ''}</div>
            ${setupsLine(s)}
          </button>
          <div class="slot-edit__btns">
            <button type="button" class="icon-btn" aria-label="Выше" onClick=${() => move(i, -1)}><${Icon} name="up" /></button>
            <button type="button" class="icon-btn" aria-label="Ниже" onClick=${() => move(i, 1)}><${Icon} name="down" /></button>
          </div>
        </div>`,
      )}
    </div>
    <button type="button" class="btn btn--block" style="margin-top:12px" onClick=${() => editSlot(null, null)}><${Icon} name="plus" />Добавить упражнение</button>
    <div class="btn-row" style="margin-top:10px">
      <button type="button" class="btn btn--quiet" onClick=${() => mutate((p) => p.days.push({ day: Math.max(...p.days.map((x) => x.day)) + 1, title: '', slots: [] }))}>Добавить день</button>
      ${draft.days.length > 1
        ? html`<button type="button" class="btn btn--quiet btn--danger" onClick=${async () => {
            if (await confirmSheet({ title: `Удалить день ${d.day}?`, okLabel: 'Удалить', danger: true })) {
              mutate((p) => { p.days = p.days.filter((x) => x.day !== d.day); });
              setDay(draft.days.find((x) => x.day !== d.day)?.day || 1);
            }
          }}>Удалить день</button>`
        : null}
    </div>
    <button type="button" class="btn btn--primary btn--block btn--big" style="margin-top:18px" disabled=${!dirty} onClick=${save}>Сохранить программу</button>
  </main>`;
}

// Which variants of a slot have machine settings, for the editor list.
function setupsLine(slot) {
  const set = slot.options.map((o) => [o, app.store.setupOf(o.key)]).filter(([, t]) => t);
  if (!set.length) return null;
  const text = slot.options.length === 1 ? set[0][1] : `${set.length} из ${slot.options.length} вариантов`;
  return html`<div class="slot-edit__setup"><${Icon} name="tune" /> Настройки: ${text}</div>`;
}

function SlotSheet({ slot, onSave, onDelete, onClose }) {
  const isNew = !slot;
  const [start] = useState(() => ({
    name: slot?.options[0].name || '',
    alts: (slot?.options.slice(1) || []).map((o) => o.name).join('\n'),
    category: slot?.category || 'base',
    step: slot?.step || 2.5,
    w: [1, 2, 3].map((w) => fmtOverride(slot?.overrides?.[w])),
    note: slot?.note || '',
  }));
  const [v, setV] = useState(start);
  const [typed, setTyped] = useState({}); // series key -> settings typed here
  // A name of an exercise done elsewhere (program or history) joins that series.
  const index = exercisesNow();
  const known = knownKeys(index);
  const optionsFor = (x) => (x.name.trim() ? optionsFromNames([x.name.trim(), ...x.alts.split('\n').map((n) => n.trim()).filter(Boolean)], slot?.options || [], known) : []);
  // Renaming a variant gives it a new key: settings typed for it here move along with it.
  const up = (p) => {
    const before = optionsFor(v);
    const after = optionsFor({ ...v, ...p });
    setTyped((t) => {
      const n = { ...t };
      after.forEach((o, i) => {
        const was = before[i]?.key;
        if (was && was !== o.key && was in t && !(o.key in t)) n[o.key] = t[was];
      });
      return n;
    });
    setV((x) => ({ ...x, ...p }));
  };
  // The variants as they will be saved (same keys as on «Готово»), each with its settings
  // (App_Exercises by series key — the same records the workout's «Настройки» line edits).
  const options = optionsFor(v);
  const own = new Set((slot?.options || []).map((o) => o.key));
  const joined = options.filter((o) => !own.has(o.key)).map((o) => ({ o, e: index.find((x) => x.key === o.key) })).filter((x) => x.e && (x.e.count || x.e.inProgram));
  const setupText = (key) => (key in typed ? typed[key] : app.store.setupOf(key));
  // The lifted part of the body weight, typed in %; '' = by category (pull-ups 100 %, others 0).
  const [shares, setShares] = useState({});
  const storedShare = (key) => app.store.setupRecord(key)?.bwShare ?? null;
  const shareText = (key) => (key in shares ? shares[key] : storedShare(key) == null ? '' : fmtNum(storedShare(key) * 100));
  const shareOf = (key) => {
    const t = String(shares[key] ?? '').trim();
    if (!t) return null;
    const n = parseNum(t);
    return n >= 0 && n <= 150 ? n / 100 : undefined;
  };
  const shareBad = options.some((o) => o.key in shares && shareOf(o.key) === undefined);
  const setupsChanged = options.filter((o) => (o.key in typed && typed[o.key].trim() !== app.store.setupOf(o.key)) || (o.key in shares && shareOf(o.key) !== undefined && shareOf(o.key) !== storedShare(o.key)));
  const dirty = JSON.stringify(v) !== JSON.stringify(start) || setupsChanged.length > 0;
  const busy = useRef(false); // a double tap on «Готово» must not add the exercise twice
  const save = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      for (const o of setupsChanged) await app.store.saveSetup(o.key, o.name, o.key in typed ? typed[o.key] : null, o.key in shares ? { bwShare: shareOf(o.key) } : {});
    } catch (err) {
      busy.current = false;
      app.ui.toast(`Не удалось сохранить настройки: ${err.message}`);
      return;
    }
    const overrides = {};
    [1, 2, 3].forEach((w, i) => {
      const o = parseOverride(v.w[i]);
      if (o) overrides[w] = o;
    });
    // Only settings changed: the program draft stays as it was (nothing to «Сохранить»).
    if (isNew || JSON.stringify(v) !== JSON.stringify(start)) onSave({ id: slot?.id || uid('sl'), category: v.category, step: Number(v.step) || 2.5, options, overrides, note: v.note });
    onClose();
  };
  const footer = html`
    ${onDelete ? html`<button type="button" class="btn btn--danger" onClick=${() => { onDelete(); onClose(); }}>Удалить</button>` : null}
    <button type="button" class="btn btn--primary" disabled=${!v.name.trim() || shareBad} onClick=${save}>Готово</button>`;
  return html`<${Sheet} title=${isNew ? 'Новое упражнение' : 'Упражнение'} onClose=${onClose} footer=${footer} dirty=${dirty}>
    ${isNew
      ? html`<div class="sheet__section"><div class="sheet__label">Быстрый выбор</div>
          <div class="seg">${exerciseCatalog(app.store.state.program).map((k) => html`<button type="button" onClick=${() => up({ name: k.name, category: k.category, alts: (k.alts || []).join('\n') })}>${k.name}</button>`)}</div>
        </div>`
      : null}
    <div class="sheet__section">
      <div class="sheet__label">Название</div>
      <input class="input" value=${v.name} onInput=${(e) => up({ name: e.currentTarget.value })} />
      ${!isNew ? html`<p class="muted" style="font-size:12px;margin-top:4px">Переименование сохраняет историю. Для другого упражнения добавьте новое.</p>` : null}
      ${joined.map(({ o, e }) => html`<p class="muted" style="font-size:12px;margin-top:4px">«${o.name}» уже есть${e.count ? ` (${e.count} ${plural(e.count, 'тренировка', 'тренировки', 'тренировок')}, последняя ${fmtDay(e.last.date)})` : ' в программе'}: история будет общей.</p>`)}
    </div>
    <div class="sheet__section">
      <div class="sheet__label">Альтернативы, по одной в строке (каждая — отдельная серия)</div>
      <textarea class="input" style="min-height:70px" value=${v.alts} onInput=${(e) => up({ alts: e.currentTarget.value })}></textarea>
    </div>
    ${options.length
      ? html`<div class="sheet__section" role="group" aria-label="Настройки тренажёра по вариантам">
          <div class="sheet__label">Настройки тренажёра — у каждого варианта свои</div>
          <p class="muted" style="font-size:12px;margin-bottom:8px">Сиденье, рукоятки, ограничители, особенности техники. В тренировке они видны над подходами. Сохраняются по «Готово», отдельно от программы.</p>
          ${options.map((o) => html`<label class="setup-field" key=${o.key}>
            <span class="setup-field__name">${o.name}</span>
            <textarea class="input" rows="2" maxlength=${SETUP_MAX} aria-label=${`Настройки: ${o.name}`} placeholder="например: сиденье 5, ручки 3"
              value=${setupText(o.key)} onInput=${(e) => { const t = e.currentTarget.value; setTyped((x) => ({ ...x, [o.key]: t })); }}></textarea>
            <span class="setup-field__bw">
              <span>Масса тела в нагрузке, %</span>
              <input class="input" inputmode="decimal" aria-label=${`Масса тела в нагрузке, %: ${o.name}`} placeholder=${v.category === 'pullup' ? '100' : '0'}
                value=${shareText(o.key)} onInput=${(e) => { const t = e.currentTarget.value; setShares((x) => ({ ...x, [o.key]: t })); }} />
            </span>
          </label>`)}
          <p class="muted" style="font-size:12px">Масса тела в нагрузке — для сравнения и оценок, в подходах по-прежнему записывается только добавленный вес. Пусто: подтягивания — 100 %, остальное — 0. Для отжиманий или брусьев укажите сами.</p>
          ${shareBad ? html`<p class="warn-line">Масса тела в нагрузке — число от 0 до 150 или пусто.</p>` : null}
        </div>`
      : null}
    <div class="sheet__section">
      <div class="sheet__label">Категория</div>
      <${Seg} label="Категория" value=${v.category} onChange=${(category) => up({ category })} options=${CATEGORY_KEYS.map((k) => ({ value: k, label: CATEGORY[k].label }))} />
    </div>
    <div class="sheet__section">
      <div class="sheet__label">Шаг веса, кг</div>
      <${Seg} label="Шаг веса" value=${Number(v.step)} onChange=${(step) => up({ step })} options=${[1, 1.25, 2, 2.5, 5].map((s) => ({ value: s, label: String(s).replace('.', ',') }))} />
    </div>
    <div class="sheet__section">
      <div class="sheet__label">Особые подходы по неделям (если отличаются от правил)</div>
      ${[1, 2, 3].map((w, i) => html`<div class="kv" style="margin-bottom:6px">
        <label>Неделя ${w}: по правилам ${fmtTarget(targetFor({ category: v.category }, w))}</label>
        <input class="input" placeholder="например 3x10-12@1-2" value=${v.w[i]} onInput=${(e) => { const w2 = [...v.w]; w2[i] = e.currentTarget.value; up({ w: w2 }); }} />
      </div>`)}
    </div>
    <div class="sheet__section">
      <div class="sheet__label">Заметка тренера — общая для упражнения и всех его вариантов</div>
      <textarea class="input" rows="2" style="min-height:72px" aria-label="Заметка тренера" placeholder="например: держать стабильную технику"
        value=${v.note} onInput=${(e) => up({ note: e.currentTarget.value })}></textarea>
    </div>
  <//>`;
}

// ---------------------------------------------------------------- program as text

export function ProgramImport() {
  const [text, setText] = useState('');
  const parsed = text.trim() ? parseProgramText(text) : null;
  const ok = parsed && parsed.program.days.length > 0 && parsed.program.days.some((d) => d.slots.length);
  const apply = async () => {
    const yes = await confirmSheet({
      title: 'Заменить программу?',
      text: 'Новые тренировки будут строиться по этой программе. Прошлые тренировки и история не меняются.',
      okLabel: 'Заменить',
    });
    if (!yes) return;
    await app.store.saveProgram(reuseKeys(parsed.program, app.store.state.program, knownKeys(exercisesNow())));
    app.ui.toast('Программа сохранена');
    app.ui.back();
  };
  return html`<main class="screen">
    <${Back} title="Программа текстом" />
    <p class="muted" style="font-size:14px">Самый быстрый способ перенести исходную программу: попросите ChatGPT (у него есть доступ к вашему Google Drive) переписать её в формате ниже и вставьте результат.</p>
    <div class="sheet__section">
      <button type="button" class="btn btn--block" onClick=${() => copy(PROGRAM_PROMPT)}>Скопировать запрос для ChatGPT</button>
    </div>
    <div class="code">День 1: Верх${'\n'}- Подтягивания прямым хватом [pullup]${'\n'}- Жим штанги под наклоном [base] / Горизонтальный жим штанги${'\n'}- Наклонный Hammer [hammer] / Наклонный жим гантелей</div>
    <div class="sheet__section">
      <textarea class="input" placeholder="Вставьте программу" value=${text} onInput=${(e) => setText(e.currentTarget.value)}></textarea>
    </div>
    ${parsed
      ? html`
        ${parsed.warnings.map((w) => html`<p class="warn-line">${w}</p>`)}
        <ul class="preview" style="list-style:none;padding:0">
          ${parsed.program.days.map((d) => html`<li><strong>День ${d.day}${d.title ? ': ' + d.title : ''}</strong>
            ${d.slots.map((s) => html`<div>${s.options.map((o) => o.name).join(' / ')} <span class="muted">— ${CATEGORY[s.category].label}, нед. 2: ${fmtTarget(targetFor(s, 2))}</span></div>`)}
          </li>`)}
        </ul>`
      : null}
    <button type="button" class="btn btn--primary btn--block btn--big" style="margin-top:14px" disabled=${!ok} onClick=${apply}>Заменить программу</button>
  </main>`;
}

// ---------------------------------------------------------------- past workouts as text

export function ResultsImport() {
  const [text, setText] = useState('');
  const [skipDup, setSkipDup] = useState(true);
  const parsed = text.trim() ? parseResultsText(text, app.store.state.program) : null;
  const sessions = app.store.liveSessions();
  const valid = (parsed?.sessions || []).filter((s) => s.cycle && s.week && s.day && s.items.length);
  const dupOf = (s) => sessions.find((x) => x.date === s.date && findSameSlotSession([x], s));
  const toSave = valid.filter((s) => !(skipDup && dupOf(s)));
  const save = async () => {
    const created = await app.store.importParsedSessions(toSave);
    app.ui.toast(`Перенесено тренировок: ${created.length}`);
    app.ui.go({ tab: 'history', view: null });
  };
  return html`<main class="screen">
    <${Back} title="Перенос тренировок" />
    <p class="muted" style="font-size:14px">Вставьте результаты текстом — вручную или попросив ChatGPT выписать их из старой таблицы. Перед сохранением вы увидите всё, что будет записано. Ничего не дописывается автоматически.</p>
    <div class="sheet__section">
      <button type="button" class="btn btn--block" onClick=${() => copy(RESULTS_PROMPT)}>Скопировать запрос для ChatGPT</button>
    </div>
    <div class="code">16.10.2026 цикл 1 неделя 1 день 1${'\n'}Подтягивания прямым хватом: св x6 x3${'\n'}Жим штанги под наклоном: 60x10@4, 60x10@4, 62,5x9@3${'\n'}Икры в жиме ногами: 100x12, 100x12, дроп 70x10</div>
    <div class="sheet__section">
      <textarea class="input" placeholder="Вставьте тренировки" value=${text} onInput=${(e) => setText(e.currentTarget.value)}></textarea>
    </div>
    ${parsed
      ? html`
        ${parsed.errors.map((e) => html`<p class="warn-line">Строка ${e.line}: ${e.msg}</p>`)}
        <ul class="preview" style="list-style:none;padding:0">
          ${parsed.sessions.map((s) => html`<li>
            <strong>${fmtDay(s.date)}</strong> <span class="muted">цикл ${s.cycle ?? '?'}, неделя ${s.week ?? '?'}, день ${s.day ?? '?'}</span>
            ${dupOf(s) ? html`<div class="warn-line">Такая тренировка уже есть${skipDup ? ' — будет пропущена' : ' — появится дубликат'}</div>` : null}
            ${s.items.map((it) => html`<div>${it.name}${it.known ? '' : html` <span class="tag">нет в программе</span>`}: ${it.sets.map((x) => `${x.drop ? 'дроп ' : ''}${x.weight === 0 ? 'св' : String(x.weight).replace('.', ',')}×${x.reps}${x.rir != null ? '@' + x.rir : ''}`).join(', ')}</div>`)}
          </li>`)}
        </ul>
        <div style="margin-top:10px"><${Toggle} on=${skipDup} onChange=${setSkipDup}>Пропускать уже записанные</${Toggle}></div>`
      : null}
    <button type="button" class="btn btn--primary btn--block btn--big" style="margin-top:14px" disabled=${!toSave.length} onClick=${save}>
      ${toSave.length ? `Сохранить тренировок: ${toSave.length}` : 'Нечего сохранять'}
    </button>
  </main>`;
}

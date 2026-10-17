// Settings, program editor and the text importers.

import { html, useState, app, Icon, Sheet, openSheet, Seg, Toggle, confirmSheet } from './core.js';
import {
  CATEGORY, CATEGORY_KEYS, exerciseCatalog, makeSlot, makeOption, parseProgramText, programToText, parseOverride,
  fmtOverride, targetFor, fmtTarget, reuseKeys,
} from '../lib/program.js';
import { parseResultsText } from '../lib/textimport.js';
import { fmtDay, fmtTime, normName, uid } from '../lib/util.js';
import { describeError } from '../data/sync.js';
import { findSameSlotSession } from '../lib/planner.js';

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

function Back({ title }) {
  return html`<header class="topbar">
    <button type="button" class="icon-btn" aria-label="Назад" onClick=${() => app.ui.back()}><${Icon} name="back" /></button>
    <h1>${title}</h1>
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
    const next = { url: url.trim(), token: token.trim() };
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
      setCheck({ ok: false, text: describeError(err) });
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

    <p class="muted" style="font-size:12px;margin-top:20px">Версия ${app.version}. Хранилище: ${app.storageKind}${app.persisted ? ', постоянное' : ''}.</p>
  </main>`;
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

  if (!d) return html`<main class="screen"><${Back} title="Программа" /></main>`;
  return html`<main class="screen">
    <${Back} title="Программа" />
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

function SlotSheet({ slot, onSave, onDelete, onClose }) {
  const isNew = !slot;
  const [v, setV] = useState(() => ({
    name: slot?.options[0].name || '',
    alts: (slot?.options.slice(1) || []).map((o) => o.name).join('\n'),
    category: slot?.category || 'base',
    step: slot?.step || 2.5,
    w: [1, 2, 3].map((w) => fmtOverride(slot?.overrides?.[w])),
    note: slot?.note || '',
  }));
  const up = (p) => setV((x) => ({ ...x, ...p }));
  const save = () => {
    const names = [v.name.trim(), ...v.alts.split('\n').map((s) => s.trim()).filter(Boolean)];
    const old = slot?.options || [];
    const options = names.map((n, i) => {
      const same = old.find((o) => normName(o.name) === normName(n));
      if (same) return { key: same.key, name: n };
      if (i === 0 && old[0]) return { key: old[0].key, name: n }; // rename keeps history
      return makeOption(n);
    });
    const overrides = {};
    [1, 2, 3].forEach((w, i) => {
      const o = parseOverride(v.w[i]);
      if (o) overrides[w] = o;
    });
    onSave({ id: slot?.id || uid('sl'), category: v.category, step: Number(v.step) || 2.5, options, overrides, note: v.note });
    onClose();
  };
  return html`<${Sheet} title=${isNew ? 'Новое упражнение' : 'Упражнение'} onClose=${onClose}>
    ${isNew
      ? html`<div class="sheet__section"><div class="sheet__label">Быстрый выбор</div>
          <div class="seg">${exerciseCatalog(app.store.state.program).map((k) => html`<button type="button" onClick=${() => up({ name: k.name, category: k.category, alts: (k.alts || []).join('\n') })}>${k.name}</button>`)}</div>
        </div>`
      : null}
    <div class="sheet__section">
      <div class="sheet__label">Название</div>
      <input class="input" value=${v.name} onInput=${(e) => up({ name: e.currentTarget.value })} />
      ${!isNew ? html`<p class="muted" style="font-size:12px;margin-top:4px">Переименование сохраняет историю. Для другого упражнения добавьте новое.</p>` : null}
    </div>
    <div class="sheet__section">
      <div class="sheet__label">Альтернативы, по одной в строке (каждая — отдельная серия)</div>
      <textarea class="input" style="min-height:70px" value=${v.alts} onInput=${(e) => up({ alts: e.currentTarget.value })}></textarea>
    </div>
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
      <input class="input" placeholder="Заметка (настройки тренажёра…)" value=${v.note} onInput=${(e) => up({ note: e.currentTarget.value })} />
    </div>
    <div class="btn-row">
      ${onDelete ? html`<button type="button" class="btn btn--danger" onClick=${() => { onDelete(); onClose(); }}>Удалить</button>` : null}
      <button type="button" class="btn btn--primary" disabled=${!v.name.trim()} onClick=${save}>Готово</button>
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
    await app.store.saveProgram(reuseKeys(parsed.program, app.store.state.program));
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

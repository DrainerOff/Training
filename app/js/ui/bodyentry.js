// Body measurements and sleep: manual entry, corrections, history per quantity, file import with
// a preview and undo, and where the data came from. Values never leave the device except by sync.

import { html, useState, app, openSheet, Sheet, Seg, confirmSheet } from './core.js';
import { isoDate, fmtDay, fmtNum, parseNum, uid } from '../lib/util.js';
import { KINDS, FORMAT_LABEL, parseFile, planImport, weightSuspects, isCounted, sleepNights } from '../lib/bodydata.js';

const pad = (n) => String(n).padStart(2, '0');
const nowTime = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function suspectText(s) {
  if (!s) return '';
  return `под вопросом: на ${fmtNum(Math.abs(s.diff), 1)} кг ${s.diff > 0 ? 'выше' : 'ниже'} соседних взвешиваний`;
}

function fail(err) {
  app.ui.toast(err?.message || String(err));
}

// ---------------------------------------------------------------- manual entry

export function openAddBody(kind = 'waist') {
  openSheet((close) => html`<${AddBodySheet} kind=${kind} onClose=${close} />`);
}

function AddBodySheet({ kind: initial, onClose }) {
  const [kind, setKind] = useState(initial);
  const [value, setValue] = useState('');
  const [date, setDate] = useState(isoDate());
  const [time, setTime] = useState(nowTime());
  const [note, setNote] = useState('');
  const k = KINDS[kind];
  const v = parseNum(value);
  const valid = v != null && v >= k.min && v <= k.max && date && /^\d{2}:\d{2}$/.test(time);
  const save = async () => {
    try {
      await app.store.addBody({ kind, value: v, measuredAt: `${date}T${time}`, note });
      app.ui.toast(`${k.label}: сохранено`);
      onClose();
    } catch (err) {
      fail(err);
    }
  };
  const footer = html`<button type="button" class="btn btn--primary" disabled=${!valid} onClick=${save}>Сохранить</button>`;
  return html`<${Sheet} title="Новый замер" onClose=${onClose} footer=${footer} dirty=${value !== '' || note !== ''}>
    <div class="sheet__section">
      <label class="sheet__label" for="body-kind">Что измерили</label>
      <select id="body-kind" class="input" value=${kind} onChange=${(e) => setKind(e.currentTarget.value)}>
        ${Object.entries(KINDS).map(([key, x]) => html`<option value=${key}>${x.label}</option>`)}
      </select>
    </div>
    <div class="sheet__section">
      <label class="sheet__label" for="body-value">Значение, ${k.unit}</label>
      <input id="body-value" class="input" inputmode="decimal" autocomplete="off" placeholder=${`${k.min}–${k.max}`} value=${value} onInput=${(e) => setValue(e.currentTarget.value)} />
      ${value !== '' && !valid && v != null ? html`<p class="muted" style="font-size:13px">Допустимо от ${k.min} до ${k.max} ${k.unit}.</p>` : null}
    </div>
    <div class="sheet__section body-when">
      <div>
        <label class="sheet__label" for="body-date">Дата</label>
        <input id="body-date" class="input" type="date" max=${isoDate()} value=${date} onInput=${(e) => setDate(e.currentTarget.value)} />
      </div>
      <div>
        <label class="sheet__label" for="body-time">Время</label>
        <input id="body-time" class="input" type="time" value=${time} onInput=${(e) => setTime(e.currentTarget.value)} />
      </div>
    </div>
    <div class="sheet__section">
      <input class="input" placeholder="Заметка" aria-label="Заметка" value=${note} onInput=${(e) => setNote(e.currentTarget.value)} />
    </div>
    ${kind === 'fat' ? html`<p class="muted" style="font-size:13px">Процент жира от весов с биоимпедансом — оценка, полезна только как тренд.</p>` : null}
  <//>`;
}

// ---------------------------------------------------------------- one measurement

export function openBodyRecord(id) {
  openSheet((close) => html`<${BodyRecordSheet} id=${id} onClose=${close} />`);
}

const COUNT_OPTIONS = [
  { value: 'auto', label: 'Авто' },
  { value: 'yes', label: 'Учитывать' },
  { value: 'no', label: 'Не учитывать' },
];
const toCount = (excluded) => (excluded === true ? 'no' : excluded === false ? 'yes' : 'auto');
const fromCount = (c) => (c === 'no' ? true : c === 'yes' ? false : null);

function BodyRecordSheet({ id, onClose }) {
  const r = app.store.state.body.get(id);
  const [value, setValue] = useState(r ? fmtNum(r.value, 2) : '');
  const [note, setNote] = useState(r?.note || '');
  const [count, setCount] = useState(toCount(r?.excluded));
  if (!r) return null;
  const k = KINDS[r.kind];
  const v = parseNum(value);
  const valid = v != null && v >= k.min && v <= k.max;
  const suspects = r.kind === 'weight' ? weightSuspects([...app.store.state.body.values()]) : new Map();
  const dirty = v !== r.value || note !== (r.note || '') || fromCount(count) !== (r.excluded ?? null);
  const save = async () => {
    const patch = { note, excluded: fromCount(count) };
    if (v !== r.value) patch.value = v;
    try {
      await app.store.editBody(id, patch);
      onClose();
    } catch (err) {
      fail(err);
    }
  };
  const remove = async () => {
    await app.store.deleteBody(id);
    app.ui.toast('Замер удалён. Повторный импорт его не вернёт.');
    onClose();
  };
  const footer = html`
    <button type="button" class="btn btn--danger" onClick=${remove}>Удалить</button>
    <button type="button" class="btn btn--primary" disabled=${!valid || !dirty} onClick=${save}>Сохранить</button>`;
  return html`<${Sheet} title=${k.label} onClose=${onClose} footer=${footer} dirty=${dirty}>
    <p class="muted" style="font-size:14px">
      ${fmtDay(r.date)}, ${r.measuredAt.slice(11, 16)} · ${r.source || 'источник не указан'}${r.via === 'csv' ? ' · из файла' : ''}
      ${r.edited ? html`<br />Исправлено вручную, измерено: ${fmtNum(r.origValue, 2)} ${k.unit}` : null}
    </p>
    <div class="sheet__section">
      <label class="sheet__label" for="rec-value">Значение, ${k.unit}</label>
      <input id="rec-value" class="input" inputmode="decimal" autocomplete="off" value=${value} onInput=${(e) => setValue(e.currentTarget.value)} />
    </div>
    ${r.kind === 'weight'
      ? html`<div class="sheet__section">
          <div class="sheet__label">В среднем и темпе</div>
          <${Seg} label="Учитывать в среднем и темпе" value=${count} onChange=${setCount} options=${COUNT_OPTIONS} />
          <p class="muted" style="font-size:13px">${suspects.has(id) ? `Авто: не учитывается, ${suspectText(suspects.get(id))}.` : 'Авто: учитывается.'} Взвешивание не удаляется.</p>
        </div>`
      : null}
    <div class="sheet__section">
      <input class="input" placeholder="Заметка" aria-label="Заметка" value=${note} onInput=${(e) => setNote(e.currentTarget.value)} />
    </div>
  <//>`;
}

// ---------------------------------------------------------------- history of one quantity

export function openKindHistory(kind) {
  openSheet((close) => html`<${KindHistorySheet} kind=${kind} onClose=${close} />`);
}

function KindHistorySheet({ kind, onClose }) {
  const all = [...app.store.state.body.values()];
  const list = all.filter((r) => r.kind === kind).sort((a, b) => (a.measuredAt < b.measuredAt ? 1 : -1));
  const suspects = kind === 'weight' ? weightSuspects(all) : new Map();
  const k = KINDS[kind];
  return html`<${Sheet} title=${k.label} onClose=${onClose}>
    <button type="button" class="btn btn--block" onClick=${() => openAddBody(kind)}>Добавить замер</button>
    <ul class="rows" style="margin-top:12px">
      ${list.map(
        (r) => html`<li><button type="button" class=${'row' + (r.deleted ? ' body-deleted' : '')} onClick=${() => (r.deleted ? restore(r) : openBodyRecord(r.id))}>
          <span class="row__title">${fmtDay(r.date)}, ${r.measuredAt.slice(11, 16)}</span>
          <span class="num body-value">${fmtNum(r.value, 2)} ${k.unit}</span>
          <span class="row__sub">${[
            r.source,
            r.deleted ? 'удалён, нажмите, чтобы вернуть' : null,
            r.edited ? 'исправлено' : null,
            !r.deleted && !isCounted(r, suspects) ? (r.excluded === true ? 'не учитывается' : suspectText(suspects.get(r.id))) : null,
            r.note || null,
          ].filter(Boolean).join(' · ')}</span>
        </button></li>`,
      )}
    </ul>
  <//>`;
}

async function restore(r) {
  await app.store.restoreBody(r.id);
  app.ui.toast('Замер возвращён');
}

// ---------------------------------------------------------------- sleep nights

export function openNights() {
  openSheet((close) => html`<${NightsSheet} onClose=${close} />`);
}

function NightsSheet({ onClose }) {
  const st = app.store.state;
  const { nights } = sleepNights(st.sleep.values(), [...st.metrics.values()]);
  const deleted = [...st.sleep.values()].filter((s) => s.deleted);
  const list = [...nights].reverse().slice(0, 90);
  const remove = async (n) => {
    const ok = await confirmSheet({ title: `Удалить сон за ${fmtDay(n.date)}?`, text: 'Ночь перестанет учитываться в среднем. Повторный импорт её не вернёт.', okLabel: 'Удалить', danger: true });
    if (ok) await app.store.deleteSleep(n.rec.id);
  };
  return html`<${Sheet} title="Основной сон" onClose=${onClose}>
    <p class="muted" style="font-size:13px">Самый длинный эпизод сна Apple Watch, по дате пробуждения. Нажмите на ночь, чтобы удалить её.</p>
    <ul class="rows">
      ${list.map(
        (n) => html`<li><button type="button" class="row" disabled=${n.from !== 'sleep'} onClick=${() => remove(n)}>
          <span class="row__title">${fmtDay(n.date)}</span>
          <span class="num body-value">${fmtNum(n.hours, 1)} ч</span>
          <span class="row__sub">${n.from === 'sleep' ? [n.rec.core != null ? `основной ${fmtNum(n.rec.core, 1)}` : null, n.rec.deep != null ? `глубокий ${fmtNum(n.rec.deep, 1)}` : null, n.rec.rem != null ? `REM ${fmtNum(n.rec.rem, 1)}` : null].filter(Boolean).join(' · ') : 'из записи самочувствия'}</span>
        </button></li>`,
      )}
    </ul>
    ${deleted.length
      ? html`<h3 class="section-title">Удалённые</h3>
          <ul class="rows">
            ${deleted.map(
              (s) => html`<li><button type="button" class="row body-deleted" onClick=${() => app.store.restoreSleep(s.id)}>
                <span class="row__title">${fmtDay(s.wakeDate)}</span>
                <span class="num body-value">${fmtNum(s.hours, 1)} ч</span>
                <span class="row__sub">нажмите, чтобы вернуть</span>
              </button></li>`,
            )}
          </ul>`
      : null}
  <//>`;
}

// ---------------------------------------------------------------- sources

const VIA_LABEL = { csv: 'из файла', manual: 'вручную', shortcut: 'из «Команд»' };

export function Sources() {
  const st = app.store.state;
  const by = new Map();
  const note = (key, label, at, via) => {
    const cur = by.get(key) || { label, at: '', n: 0, via: new Set() };
    cur.n++;
    if (at > cur.at) cur.at = at;
    if (via) cur.via.add(VIA_LABEL[via] || via);
    by.set(key, cur);
  };
  for (const r of st.body.values()) if (!r.deleted) note(r.family || 'other', r.source || 'другое', r.measuredAt, r.via);
  for (const s of st.sleep.values()) if (!s.deleted) note('sleep', `${s.source || 'Сон'} (сон)`, s.end || s.wakeDate, s.via);
  const imports = (st.kv.bodyImports || []).slice().reverse();
  if (!by.size && !imports.length) return null;
  return html`<div class="settings-group">
    ${[...by.values()].map(
      (x) => html`<div class="choice"><span class="choice__main">${x.label}<span class="choice__sub">записей: ${x.n}, последняя ${fmtDay(x.at.slice(0, 10))}${x.at.length > 10 ? `, ${x.at.slice(11, 16)}` : ''}${x.via.size ? ` · ${[...x.via].join(', ')}` : ''}</span></span></div>`,
    )}
    ${imports.slice(0, 5).map(
      (e) => html`<div class="choice">
        <span class="choice__main">Загрузка ${new Date(e.at).toLocaleDateString('ru-RU')}${e.file ? `: ${e.file}` : ''}
          <span class="choice__sub">${FORMAT_LABEL[e.format] || ''}, добавлено ${e.body + e.sleep}${e.undone ? ' · отменена' : ''}</span></span>
        ${e.undone ? null : html`<button type="button" class="btn btn--quiet" onClick=${() => undo(e)}>Отменить</button>`}
      </div>`,
    )}
  </div>`;
}

async function undo(e) {
  const ok = await confirmSheet({
    title: 'Отменить загрузку?',
    text: 'Записи этой загрузки удалятся на всех устройствах. Исправленные вручную останутся. Если загрузить тот же файл снова, записи вернутся.',
    okLabel: 'Отменить загрузку',
    cancelLabel: 'Оставить',
    danger: true,
  });
  if (!ok) return;
  const n = await app.store.undoImport(e.batch);
  app.ui.toast(`Удалено записей: ${n}`);
}

// ---------------------------------------------------------------- import

export function ImportButton() {
  const pick = async (e) => {
    const input = e.currentTarget; // currentTarget is null after the first await
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) return app.ui.toast('Файл больше 20 МБ — это не экспорт замеров');
    try {
      const parsed = parseFile(await f.text());
      if (!parsed.format) return app.ui.toast(parsed.errors[0]?.reason || 'Формат файла не распознан');
      const st = app.store.state;
      const plan = planImport(parsed, { body: st.body, sleep: st.sleep });
      openSheet((close) => html`<${ImportSheet} plan=${plan} file=${f.name} onClose=${close} />`);
    } catch (err) {
      fail(err);
    }
  };
  return html`<label class="btn btn--block body-import">
    Загрузить из файла (CSV)
    <input type="file" accept=".csv,text/csv,text/plain" class="sr-only" onChange=${pick} />
  </label>
  <p class="muted" style="font-size:12px">Файл читается только на этом телефоне. В таблицу попадают сами замеры, файл никуда не отправляется.</p>`;
}

function ImportSheet({ plan, file, onClose }) {
  const [withNear, setWithNear] = useState(false);
  const [busy, setBusy] = useState(false);
  const extra = withNear ? plan.near.map((n) => n.rec) : [];
  const total = plan.add.length + extra.length;
  const kinds = Object.entries(plan.kinds).map(([k, n]) => `${KINDS[k].label.toLowerCase()} — ${n}`);
  const go = async () => {
    setBusy(true);
    try {
      await app.store.importBody(plan, { batch: uid('i'), file, extra });
      app.ui.toast(`Загружено записей: ${total}`);
      onClose();
    } catch (err) {
      setBusy(false);
      fail(err);
    }
  };
  const footer = html`<button type="button" class="btn btn--primary" disabled=${!total || busy} onClick=${go}>${total ? `Загрузить ${total}` : 'Нечего загружать'}</button>`;
  return html`<${Sheet} title="Загрузка из файла" onClose=${onClose} footer=${footer}>
    <p><b>${FORMAT_LABEL[plan.format]}</b><br /><span class="muted" style="font-size:13px">${file}</span></p>
    <ul class="rows">
      <li class="row"><span class="row__title">Новые</span><span class="num">${plan.add.length}</span>${kinds.length ? html`<span class="row__sub">${kinds.join(', ')}</span>` : plan.sleepAdded ? html`<span class="row__sub">ночей сна — ${plan.sleepAdded}</span>` : null}</li>
      ${plan.same ? html`<li class="row"><span class="row__title">Уже есть</span><span class="num">${plan.same}</span></li>` : null}
      ${plan.kept ? html`<li class="row"><span class="row__title">Исправлены вручную — не меняются</span><span class="num">${plan.kept}</span></li>` : null}
      ${plan.deleted ? html`<li class="row"><span class="row__title">Удалены вами — не возвращаются</span><span class="num">${plan.deleted}</span></li>` : null}
      ${plan.repeated ? html`<li class="row"><span class="row__title">Повторы внутри файла</span><span class="num">${plan.repeated}</span></li>` : null}
      ${plan.errors.length
        ? html`<li class="row"><span class="row__title">Строки с ошибками — пропущены</span><span class="num">${plan.errors.length}</span>
            <span class="row__sub">${plan.errors.slice(0, 4).map((e) => `строка ${e.line}: ${e.reason}`).join('; ')}${plan.errors.length > 4 ? '…' : ''}</span></li>`
        : null}
      ${plan.ignored.length ? html`<li class="row"><span class="row__title">Столбцы не загружаются</span><span class="row__sub">${plan.ignored.join(', ')}</span></li>` : null}
    </ul>
    ${plan.near.length
      ? html`<div class="sheet__section">
          <p style="font-size:14px">Похожих на уже записанные: ${plan.near.length}. Время в пределах 3 минут, значение отличается не больше чем на 0,1, но источник другой. Скорее всего, это те же измерения.</p>
          <${Seg} label="Похожие записи" value=${withNear ? 'add' : 'skip'} onChange=${(v) => setWithNear(v === 'add')}
            options=${[{ value: 'skip', label: 'Пропустить' }, { value: 'add', label: 'Добавить тоже' }]} />
        </div>`
      : null}
    <p class="muted" style="font-size:13px">Загрузку можно отменить целиком в разделе «Источники и загрузка».</p>
  <//>`;
}

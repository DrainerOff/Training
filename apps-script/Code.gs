/**
 * Тренировки — API синхронизации для приложения-трекера.
 *
 * Скрипт привязан к вашей Google Таблице (Расширения → Apps Script).
 * Он создаёт и использует ТОЛЬКО новые листы с префиксом «App_».
 * Существующие листы не изменяются; функция describeLegacySheets их только читает.
 *
 * Протокол: POST text/plain JSON { action, token, ... } → JSON { ok, ... }.
 * Запись идемпотентна: строка ищется по id, повторная отправка не создаёт дубликат,
 * более старая версия (updated_at) не перезаписывает более новую.
 */

// 2: manual personal records (App_Records); the response's `ack` lists every entity handled,
// so a client never treats records as saved by a server that doesn't know them.
// 3: per-variant exercise settings (App_Exercises).
// 4: body measurements (App_Body, one real measurement per row) and main sleep per wake date
// (App_Sleep). Old clients never send them and never receive them. `ingest`: iPhone Shortcuts
// add weight, waist and sleep with their own key, which can do nothing else.
var API_VERSION = 4;
var MAX_RECORDS = 2000;
var MAX_TEXT = 2000;
var MAX_BODY = 5 * 1024 * 1024; // a year of workouts is well under 1 MB

// [column header, client field, type]. Readable columns first — так листы удобно читать
// человеку и ChatGPT; технические поля в конце.
var SCHEMA = {
  sets: {
    sheet: 'App_Sets',
    cols: [
      ['date', 'date', 'date'],
      ['cycle', 'cycle', 'int'],
      ['week', 'week', 'int'],
      ['day', 'day', 'int'],
      ['exercise', 'exercise', 'text'],
      ['set_no', 'setNo', 'int'],
      ['weight_kg', 'weight', 'num'],
      ['reps', 'reps', 'int'],
      ['rir', 'rir', 'num'],
      ['drop_set', 'drop', 'bool'],
      ['pain', 'pain', 'bool'],
      ['technique_worse', 'technique', 'bool'],
      ['note', 'note', 'text'],
      ['series_key', 'seriesKey', 'key'],
      ['session_id', 'sessionId', 'key'],
      ['slot_id', 'slotId', 'key'],
      ['id', 'id', 'key'],
      ['created_at', 'createdAt', 'ms'],
      ['updated_at', 'updatedAt', 'ms'],
      ['deleted', 'deleted', 'bool'],
      ['_srv', '_srv', 'ms'],
    ],
  },
  sessions: {
    sheet: 'App_Sessions',
    cols: [
      ['date', 'date', 'date'],
      ['cycle', 'cycle', 'int'],
      ['week', 'week', 'int'],
      ['day', 'day', 'int'],
      ['status', 'status', 'text'],
      ['note', 'note', 'text'],
      ['started_at', 'startedAt', 'ms'],
      ['finished_at', 'finishedAt', 'ms'],
      ['id', 'id', 'key'],
      ['items_json', 'items', 'json'],
      ['updated_at', 'updatedAt', 'ms'],
      ['deleted', 'deleted', 'bool'],
      ['_srv', '_srv', 'ms'],
    ],
  },
  records: {
    sheet: 'App_Records',
    cols: [
      ['date', 'date', 'date'],
      ['exercise', 'exercise', 'text'],
      ['weight_kg', 'weight', 'num'],
      ['reps', 'reps', 'int'],
      ['rir', 'rir', 'num'],
      ['bodyweight_kg', 'bodyweight', 'num'],
      ['note', 'note', 'text'],
      ['category', 'category', 'text'],
      ['series_key', 'seriesKey', 'key'],
      ['id', 'id', 'key'],
      ['created_at', 'createdAt', 'ms'],
      ['updated_at', 'updatedAt', 'ms'],
      ['deleted', 'deleted', 'bool'],
      ['_srv', '_srv', 'ms'],
    ],
  },
  // One row per exercise variant: settings that stay with the machine, not with a workout.
  exercises: {
    sheet: 'App_Exercises',
    cols: [
      ['exercise', 'exercise', 'text'],
      ['setup', 'setup', 'text'],
      ['series_key', 'seriesKey', 'key'],
      ['id', 'id', 'key'],
      ['updated_at', 'updatedAt', 'ms'],
      ['deleted', 'deleted', 'bool'],
      ['_srv', '_srv', 'ms'],
    ],
  },
  metrics: {
    sheet: 'App_Metrics',
    cols: [
      ['date', 'date', 'date'],
      ['bodyweight_kg', 'bodyweight', 'num'],
      ['sleep_h', 'sleep', 'num'],
      ['recovery_1_5', 'recovery', 'num'],
      ['note', 'note', 'text'],
      ['id', 'id', 'key'],
      ['updated_at', 'updatedAt', 'ms'],
      ['deleted', 'deleted', 'bool'],
      ['_srv', '_srv', 'ms'],
    ],
  },
  // One real measurement per row: a weigh-in, a waist, an arm… measured_at keeps the clock and
  // offset of the place it was taken. excluded: empty = the app decides, TRUE/FALSE = the owner did.
  body: {
    sheet: 'App_Body',
    cols: [
      ['date', 'date', 'date'],
      ['measured_at', 'measuredAt', 'text'],
      ['kind', 'kind', 'key'],
      ['value', 'value', 'num'],
      ['unit', 'unit', 'text'],
      ['source', 'source', 'text'],
      ['note', 'note', 'text'],
      ['excluded', 'excluded', 'tri'],
      ['edited', 'edited', 'bool'],
      ['orig_value', 'origValue', 'num'],
      ['family', 'family', 'key'],
      ['via', 'via', 'key'],
      ['src_id', 'srcId', 'key'],
      ['batch', 'batch', 'key'],
      ['id', 'id', 'key'],
      ['updated_at', 'updatedAt', 'ms'],
      ['deleted', 'deleted', 'bool'],
      ['_srv', '_srv', 'ms'],
    ],
  },
  // Sleep of the day that ended on wake_date (Apple Watch stages): sleep_h = main sleep (longest
  // episode, 2 h+), total_h = all sleep of that date, hours by stage of the main sleep.
  sleep: {
    sheet: 'App_Sleep',
    cols: [
      ['wake_date', 'wakeDate', 'date'],
      ['sleep_h', 'hours', 'num'],
      ['total_h', 'total', 'num'],
      ['episodes', 'episodes', 'int'],
      ['start', 'start', 'text'],
      ['end', 'end', 'text'],
      ['core_h', 'core', 'num'],
      ['deep_h', 'deep', 'num'],
      ['rem_h', 'rem', 'num'],
      ['unspecified_h', 'unspec', 'num'],
      ['segments', 'segments', 'int'],
      ['source', 'source', 'text'],
      ['note', 'note', 'text'],
      ['edited', 'edited', 'bool'],
      ['via', 'via', 'key'],
      ['batch', 'batch', 'key'],
      ['id', 'id', 'key'],
      ['updated_at', 'updatedAt', 'ms'],
      ['deleted', 'deleted', 'bool'],
      ['_srv', '_srv', 'ms'],
    ],
  },
};
var BODY_KINDS = {
  weight: [20, 300], fat: [2, 70], waist: [10, 250], chest: [10, 250], shoulders: [10, 250], neck: [10, 250],
  arm_l: [10, 250], arm_r: [10, 250], hips: [10, 250], thigh_l: [10, 250], thigh_r: [10, 250],
  calf_l: [10, 250], calf_r: [10, 250], head: [10, 250],
};
var STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?[+-]\d{2}:\d{2}$/;
var ENTITIES = ['sessions', 'sets', 'metrics', 'records', 'exercises', 'body', 'sleep'];

var PROGRAM_SHEET = 'App_Program';
var PROGRAM_COLS = ['day', 'day_title', 'order', 'exercise', 'alternatives', 'category', 'step', 'w1', 'w2', 'w3', 'note', 'slot_id', 'keys'];
var SUMMARY_SHEET = 'App_Summary';
var INSPECT_SHEET = 'App_Inspect';
var CATEGORIES = ['base', 'hammer', 'pullup', 'iso', 'calves'];
var TZ_ = null;

// The bound spreadsheet. A web-app execution may have no "active" spreadsheet, so setup()
// stores the id and the API opens it by id. The id never comes from a request.
function ss_() {
  var active = SpreadsheetApp.getActive();
  if (active) return active;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Не найден ID таблицы: откройте таблицу и выполните «Тренировки → Подготовить листы и ключ».');
  return SpreadsheetApp.openById(id);
}

function tz_() {
  if (!TZ_) TZ_ = ss_().getSpreadsheetTimeZone();
  return TZ_;
}

// ---------------------------------------------------------------------------- web app

function doGet() {
  return json_({ ok: true, app: 'trainer', api: API_VERSION, message: 'API тренировок работает. Данные передаются только через POST с ключом.' });
}

function doPost(e) {
  var body = e && e.postData ? String(e.postData.contents || '') : '';
  if (body.length > MAX_BODY) return json_({ ok: false, error: 'bad_request', message: 'Слишком большой запрос' });
  var req;
  try {
    req = JSON.parse(body);
  } catch (err) {
    return json_({ ok: false, error: 'bad_request', message: 'Тело запроса не JSON' });
  }
  // Shortcuts: their own key, append-only, nothing is read back.
  if (req && req.action === 'ingest') {
    if (body.length > INGEST_MAX_BODY) return json_({ ok: false, error: 'bad_request', message: 'Слишком большой запрос' });
    var ingestKey = PropertiesService.getScriptProperties().getProperty('INGEST_KEY');
    if (!ingestKey || typeof req.key !== 'string' || !sameSecret_(req.key, ingestKey)) return json_({ ok: false, error: 'unauthorized' });
    try {
      return json_(ingest_(req));
    } catch (err) {
      return json_({ ok: false, error: 'server_error', message: String(err && err.message ? err.message : err) });
    }
  }
  // Every other action needs the access key; without it nothing is read or written.
  var token = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!token || !req || typeof req.token !== 'string' || !sameSecret_(req.token, token)) return json_({ ok: false, error: 'unauthorized' });
  try {
    if (req.action === 'ping') {
      return json_({ ok: true, api: API_VERSION, name: ss_().getName(), now: Date.now() });
    }
    if (req.action === 'sync') return json_(sync_(req));
    return json_({ ok: false, error: 'bad_request', message: 'Неизвестное действие' });
  } catch (err) {
    return json_({ ok: false, error: 'server_error', message: String(err && err.message ? err.message : err) });
  }
}

// Comparison time does not depend on where the strings differ.
function sameSecret_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------- sync

function sync_(req) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    ensureSheets_();
    var props = PropertiesService.getScriptProperties();
    var srv = Math.max(Date.now(), Number(props.getProperty('LAST_SRV') || 0) + 1);
    var since = Number(req.since) || 0;
    // Per-entity starting points below `since` (a client catching up on an entity it used to ignore).
    var entitySince = req.entitySince && typeof req.entitySince === 'object' ? req.entitySince : {};
    var push = req.push || {};
    var ack = {};
    var rejected = [];
    var pushedNow = {};
    var cursor = since;
    var pull = {};
    var touched = false;
    var tables = {};

    ENTITIES.forEach(function (entity) {
      var table = readTable_(entity);
      tables[entity] = table;
      var incoming = Array.isArray(push[entity]) ? push[entity].slice(0, MAX_RECORDS) : [];
      ack[entity] = 0;
      incoming.forEach(function (rec) {
        var clean = sanitize_(entity, rec);
        if (!clean) {
          rejected.push({ entity: entity, id: rec && rec.id ? String(rec.id) : '' });
          return;
        }
        ack[entity]++;
        pushedNow[entity + ':' + clean.id] = clean.updatedAt;
        var at = table.index[clean.id];
        if (at != null) {
          var existing = Number(table.rows[at][table.map.updatedAt]) || 0;
          if (clean.updatedAt <= existing) return; // older or identical resend → ignore
          clean._srv = srv++;
          table.rows[at] = toRow_(entity, clean, table, table.rows[at]);
          table.changed[at] = true;
        } else {
          clean._srv = srv++;
          table.index[clean.id] = table.rows.length;
          table.rows.push(toRow_(entity, clean, table, null));
          table.changed[table.rows.length - 1] = true;
        }
        touched = true;
      });
      writeTable_(table);
    });
    props.setProperty('LAST_SRV', String(srv));

    ENTITIES.forEach(function (entity) {
      var table = tables[entity];
      var out = [];
      var from = isFinite(Number(entitySince[entity])) && entitySince[entity] !== null && entitySince[entity] !== '' ? Math.min(since, Number(entitySince[entity])) : since;
      table.rows.forEach(function (row) {
        var s = Number(row[table.map._srv]) || 0;
        if (s > cursor) cursor = s;
        if (s <= from) return;
        var rec = fromRow_(entity, row, table);
        if (!rec) return;
        if (pushedNow[entity + ':' + rec.id] === rec.updatedAt) return; // the client already has it
        out.push(rec);
      });
      pull[entity] = out;
    });

    // Read first: a hand edit of App_Program is detected here and becomes the newest version,
    // so an older program from the phone cannot silently overwrite it.
    var programUpdatedAt = 0;
    var prog = readProgram_();
    var storedAt = prog ? prog.updatedAt : Number(props.getProperty('PROGRAM_UPDATED_AT') || 0);
    if (push.program && Array.isArray(push.program.days) && Number(push.program.updatedAt) > storedAt) {
      writeProgram_(push.program);
      prog = readProgram_();
    }
    if (prog) {
      programUpdatedAt = prog.updatedAt;
      if (prog.updatedAt > (Number(req.programSince) || 0)) pull.program = prog;
    }

    if (touched) rebuildSummary_(tables.sets, tables.sessions);
    SpreadsheetApp.flush();
    return { ok: true, api: API_VERSION, entities: ENTITIES, ack: ack, rejected: rejected, pull: pull, cursor: cursor, programUpdatedAt: programUpdatedAt, serverTime: Date.now() };
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------- ingest (Shortcuts)

// A shortcut sends one type per request: { action: 'ingest', key, type, lines }, where `lines` is
// the text it builds from «Найти данные Здоровья»: one sample per line, «value|start|end|source».
// Measurements are only added (a known one, or one the owner deleted, is left as it is); sleep is
// recomputed per wake date from the samples sent and updates a row unless the owner edited or
// deleted it, and never shrinks it (a window that cuts a night short must not overwrite it).
var INGEST_MAX_BODY = 1024 * 1024;
var INGEST_MAX_LINES = 3000;
var INGEST_TYPES = { weight: 'weight', waist: 'waist', fat: 'fat', sleep: 'sleep' };
var INGEST_FIRST_DAY = Date.UTC(2015, 0, 1);
var HEALTH_LOG_SHEET = 'App_HealthLog';
var HEALTH_LOG_COLS = ['received_at', 'type', 'lines', 'added', 'updated', 'same', 'kept', 'rejected', 'sources'];

function ingest_(req) {
  var type = INGEST_TYPES[String(req.type || '')];
  if (!type) return { ok: false, error: 'bad_request', message: 'Неизвестный тип данных' };
  var lines = String(req.lines || '').split(/\r?\n/).filter(function (l) { return l.replace(/[|\s]/g, ''); });
  if (lines.length > INGEST_MAX_LINES) return { ok: false, error: 'bad_request', message: 'Слишком много строк: не больше ' + INGEST_MAX_LINES };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    ensureSheets_();
    var props = PropertiesService.getScriptProperties();
    var srv = Math.max(Date.now(), Number(props.getProperty('LAST_SRV') || 0) + 1);
    var now = Date.now();
    var res = { ok: true, api: API_VERSION, type: type, received: lines.length, added: 0, updated: 0, same: 0, kept: 0, rejected: 0, errors: [] };
    var bad = function (i, reason) {
      res.rejected++;
      res.errors.push({ line: i + 1, reason: reason });
    };
    var samples = [];
    var sources = {};
    lines.forEach(function (line, i) {
      var f = line.split('|').map(function (x) { return x.trim(); });
      var start = ingestTime_(f[1]);
      var end = ingestTime_(f[2] || f[1]);
      if (!start || !end) return bad(i, 'дата');
      if (start.utc < INGEST_FIRST_DAY || end.utc > now + 86400000 || end.utc < start.utc) return bad(i, 'дата вне диапазона');
      var source = String(f[3] || '').slice(0, 64);
      if (source) sources[source] = true;
      samples.push({ i: i, value: f[0], start: start, end: end, source: source });
    });
    var table = readTable_(type === 'sleep' ? 'sleep' : 'body');
    if (type === 'sleep') ingestSleep_(samples, table, res, now, function () { return srv++; });
    else ingestBody_(type, samples, table, res, now, bad, function () { return srv++; });
    writeTable_(table);
    props.setProperty('LAST_SRV', String(srv));
    // Freshness for the owner and the app; counts only, never values.
    logIngest_([new Date(now).toISOString(), type, res.received, res.added, res.updated, res.same, res.kept, res.rejected, Object.keys(sources).join(', ').slice(0, 200)]);
    SpreadsheetApp.flush();
    res.errors = res.errors.sort(function (x, y) { return x.line - y.line; }).slice(0, 5);
    return res;
  } finally {
    lock.releaseLock();
  }
}

// Same rules as the app (js/lib/bodydata.js): a stable family per source app, the UTC time to the
// second, the value × 100. A measurement the app imported from a CSV (to the minute) is the same
// measurement when kind, family, minute and value agree.
function ingestBody_(kind, samples, table, res, now, bad, nextSrv) {
  var range = BODY_KINDS[kind];
  var byMatch = {};
  table.rows.forEach(function (row) {
    var t = ingestTime_(String(row[table.map.measuredAt] || ''));
    if (!t) return;
    var orig = row[table.map.origValue];
    var v = orig === '' || orig == null ? row[table.map.value] : orig;
    byMatch[matchKey_(String(row[table.map.kind]), String(row[table.map.family]), t.utc, Number(v))] = true;
  });
  samples.forEach(function (x) {
    var value = Math.round(Number(String(x.value).replace(',', '.').replace(/[^0-9.\-]/g, '')) * 100) / 100;
    if (!isFinite(value) || !(value >= range[0] && value <= range[1])) return bad(x.i, 'значение вне диапазона');
    var family = sourceFamily_(x.source);
    var id = 'b:' + kind + ':' + family + ':' + utcStamp_(x.start.utc, x.start.precision) + ':' + Math.round(value * 100);
    var key = matchKey_(kind, family, x.start.utc, value);
    if (table.index[id] != null || byMatch[key]) {
      res.same++;
      return;
    }
    var rec = {
      id: id, kind: kind, value: value, origValue: value, unit: kind === 'fat' ? '%' : kind === 'weight' ? 'кг' : 'см',
      measuredAt: x.start.local, date: x.start.local.slice(0, 10), source: x.source || 'Здоровье', family: family,
      via: 'shortcut', srcId: '', batch: 'sc' + x.start.local.slice(0, 10).replace(/-/g, ''), excluded: null,
      edited: false, note: '', updatedAt: now, deleted: false, _srv: nextSrv(),
    };
    byMatch[key] = true;
    table.index[id] = table.rows.length;
    table.rows.push(toRow_('body', rec, table, null));
    table.changed[table.rows.length - 1] = true;
    res.added++;
  });
}

function ingestSleep_(samples, table, res, now, nextSrv) {
  sleepFromSamples_(samples).forEach(function (n) {
    var id = 's:' + n.wakeDate;
    var at = table.index[id];
    var rec = { id: id, wakeDate: n.wakeDate, hours: n.hours, total: n.total, episodes: n.episodes, start: n.start, end: n.end,
      core: n.core, deep: n.deep, rem: n.rem, unspec: n.unspec, segments: n.segments, source: n.source,
      via: 'shortcut', batch: 'sc' + n.wakeDate.replace(/-/g, ''), edited: false, note: '', updatedAt: now, deleted: false };
    if (at == null) {
      rec._srv = nextSrv();
      table.index[id] = table.rows.length;
      table.rows.push(toRow_('sleep', rec, table, null));
      table.changed[table.rows.length - 1] = true;
      res.added++;
      return;
    }
    var old = fromRow_('sleep', table.rows[at], table);
    if (old.deleted || old.edited) {
      res.kept++;
      return;
    }
    var oldTotal = old.total != null ? old.total : old.hours || 0;
    if (n.total < oldTotal - 0.01 || (n.total === oldTotal && n.hours === old.hours && n.start === old.start && n.end === old.end)) {
      res.same++;
      return;
    }
    rec.note = old.note || '';
    rec.updatedAt = Math.max(now, (Number(old.updatedAt) || 0) + 1);
    rec._srv = nextSrv();
    table.rows[at] = toRow_('sleep', rec, table, table.rows[at]);
    table.changed[at] = true;
    res.updated++;
  });
}

function logIngest_(row) {
  var ss = ss_();
  var sh = ss.getSheetByName(HEALTH_LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(HEALTH_LOG_SHEET, ss.getSheets().length);
    sh.getRange(1, 1, 1, HEALTH_LOG_COLS.length).setValues([HEALTH_LOG_COLS]);
    sh.setFrozenRows(1);
  }
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

// Stage names come in English even on a Russian iPhone.
function sleepStage_(v) {
  var s = String(v || '').trim().toLowerCase();
  if (/^(core|ядро|основн)/.test(s)) return 'core';
  if (/^(deep|глубок)/.test(s)) return 'deep';
  if (/^(rem|быстр)/.test(s)) return 'rem';
  if (/^(awake|бодрств)/.test(s)) return 'awake';
  if (/^(in ?bed|в кровати)/.test(s)) return 'inbed';
  if (/^(asleep|unspecified|сон|спит)/.test(s)) return 'unspec';
  return null;
}

// The app's sleepFromSamples (js/lib/bodydata.js), line for line: a gap over 90 min starts a new
// episode, main = longest episode of 2 h+, total = all sleep of episodes ending on that date.
function sleepFromSamples_(samples) {
  var pts = [];
  samples.forEach(function (x) {
    var stage = sleepStage_(x.value);
    if (!stage || stage === 'awake' || stage === 'inbed' || x.end.utc <= x.start.utc) return;
    pts.push({ stage: stage, a: x.start.utc, b: x.end.utc, start: x.start.local, end: x.end.local, source: x.source || '' });
  });
  pts.sort(function (p, q) { return p.a - q.a || p.b - q.b; });
  var episodes = [];
  var cur = null;
  pts.forEach(function (p) {
    if (cur && p.a - cur.b <= 90 * 60000) {
      cur.pts.push(p);
      if (p.b > cur.b) {
        cur.b = p.b;
        cur.end = p.end;
      }
    } else {
      cur = { a: p.a, b: p.b, start: p.start, end: p.end, pts: [p] };
      episodes.push(cur);
    }
  });
  var union = function (list) {
    var ms = 0;
    var end = -Infinity;
    list.forEach(function (p) {
      var from = Math.max(p.a, end);
      if (p.b > from) ms += p.b - from;
      end = Math.max(end, p.b);
    });
    return ms / 3600000;
  };
  var byDate = {};
  var dates = [];
  episodes.forEach(function (e) {
    var ep = { start: e.start, end: e.end, hours: union(e.pts), segments: e.pts.length, sources: {} };
    ['core', 'deep', 'rem', 'unspec'].forEach(function (k) {
      ep[k] = union(e.pts.filter(function (p) { return p.stage === k; }));
    });
    e.pts.forEach(function (p) { if (p.source) ep.sources[p.source] = true; });
    var date = e.end.slice(0, 10);
    if (!byDate[date]) {
      byDate[date] = [];
      dates.push(date);
    }
    byDate[date].push(ep);
  });
  var r2 = function (n) { return Math.round(n * 100) / 100; };
  var out = [];
  dates.sort().forEach(function (wakeDate) {
    var eps = byDate[wakeDate];
    var total = eps.reduce(function (t, e) { return t + e.hours; }, 0);
    if (total < 1) return;
    var main = eps.filter(function (e) { return e.hours >= 2; }).sort(function (x, y) { return y.hours - x.hours; })[0] || null;
    var base = main || eps.slice().sort(function (x, y) { return y.hours - x.hours; })[0];
    out.push({
      wakeDate: wakeDate, start: base.start, end: base.end, hours: main ? r2(main.hours) : null, total: r2(total), episodes: eps.length,
      core: r2(base.core), deep: r2(base.deep), rem: r2(base.rem), unspec: r2(base.unspec), segments: base.segments,
      source: Object.keys(base.sources).join(', ') || 'Apple Watch',
    });
  });
  return out;
}

// «2026-10-16T18:44:32+03:00» (what Shortcuts writes) or with a space; the offset is required.
function ingestTime_(raw) {
  var m = String(raw || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})$/);
  if (!m) return null;
  var y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5];
  var sec = m[6] != null ? +m[6] : null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || (sec != null && sec > 59)) return null;
  var off = 0;
  if (m[7] !== 'Z') {
    var z = m[7].replace(':', '');
    off = (z[0] === '-' ? -1 : 1) * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3, 5)));
  }
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
  var oa = Math.abs(off);
  var local = y + '-' + p2(mo) + '-' + p2(d) + 'T' + p2(h) + ':' + p2(mi) + (sec != null ? ':' + p2(sec) : '') + (off < 0 ? '-' : '+') + p2(Math.floor(oa / 60)) + ':' + p2(oa % 60);
  return { utc: Date.UTC(y, mo - 1, d, h, mi, sec || 0) - off * 60000, local: local, precision: sec != null ? 's' : 'm' };
}

function utcStamp_(utc, precision) {
  var t = new Date(utc).toISOString();
  var base = t.slice(0, 4) + t.slice(5, 7) + t.slice(8, 10) + 'T' + t.slice(11, 13) + t.slice(14, 16);
  return precision === 's' ? base + t.slice(17, 19) : base;
}

function matchKey_(kind, family, utc, value) {
  return kind + '|' + family + '|' + utcStamp_(utc, 'm') + '|' + Math.round(Number(value) * 100);
}

function sourceFamily_(name) {
  var s = String(name || '').trim().toLowerCase();
  if (!s) return 'unknown';
  if (s === 'manual' || s === 'вручную') return 'manual';
  if (/zepp|mi fit|mifit/.test(s)) return 'zepp';
  if (/fitdays/.test(s)) return 'fitdays';
  if (/watch/.test(s)) return 'watch';
  if (s === 'здоровье' || s === 'health' || s === 'apple health') return 'health';
  var slug = s.replace(/[^a-z0-9а-яё]+/g, '-').replace(/^-+|-+$/g, '');
  return /^[a-z0-9-]+$/.test(slug) && slug ? slug.slice(0, 24) : 'other';
}

// ---------------------------------------------------------------------------- sheets io

function ensureSheets_() {
  var ss = ss_();
  ENTITIES.forEach(function (entity) {
    var def = SCHEMA[entity];
    var sh = ss.getSheetByName(def.sheet);
    var headers = def.cols.map(function (c) { return c[0]; });
    if (!sh) sh = ss.insertSheet(def.sheet, ss.getSheets().length);
    var lastCol = sh.getLastColumn();
    var have = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
    if (!have.join('')) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
      formatByHeader_(sh, entity, headers, 2, Math.max(1, sh.getMaxRows() - 1));
      return;
    }
    // Forward-compatible: add any missing columns at the end, never reorder or drop.
    var missing = headers.filter(function (h) { return have.indexOf(h) < 0; });
    if (missing.length) {
      if (lastCol + missing.length > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), lastCol + missing.length - sh.getMaxColumns());
      sh.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
      formatByHeader_(sh, entity, have.concat(missing), 2, Math.max(1, sh.getMaxRows() - 1));
    }
  });
  var ps = ss.getSheetByName(PROGRAM_SHEET);
  if (!ps) {
    ps = ss.insertSheet(PROGRAM_SHEET, ss.getSheets().length);
    ps.getRange(1, 1, 1, PROGRAM_COLS.length).setValues([PROGRAM_COLS]);
    ps.setFrozenRows(1);
    ps.getRange(2, 1, Math.max(1, ps.getMaxRows() - 1), PROGRAM_COLS.length).setNumberFormat('@');
  }
}

// Plain-text format for text/date/id columns (so "2026-10-16" never turns into a Date and
// notes like "1/2" are not reinterpreted); integer format for millisecond timestamps.
function formatByHeader_(sh, entity, header, fromRow, numRows) {
  SCHEMA[entity].cols.forEach(function (c) {
    var pos = header.indexOf(c[0]);
    if (pos < 0) return;
    var t = c[2];
    var fmt = t === 'ms' ? '0' : t === 'text' || t === 'date' || t === 'key' || t === 'json' ? '@' : null;
    if (fmt) sh.getRange(fromRow, pos + 1, numRows, 1).setNumberFormat(fmt);
  });
}

function headerMap_(sh, entity) {
  var lastCol = sh.getLastColumn();
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var map = {};
  SCHEMA[entity].cols.forEach(function (c) {
    map[c[1]] = header.indexOf(c[0]);
  });
  return { header: header, map: map };
}

function readTable_(entity) {
  var sh = ss_().getSheetByName(SCHEMA[entity].sheet);
  var hm = headerMap_(sh, entity);
  var lastRow = sh.getLastRow();
  var rows = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, hm.header.length).getValues() : [];
  var index = {};
  rows.forEach(function (r, i) {
    var id = String(r[hm.map.id] || '');
    if (id) index[id] = i;
  });
  return { entity: entity, sh: sh, header: hm.header, map: hm.map, rows: rows, index: index, changed: {}, firstNew: rows.length };
}

// Writes changed rows in contiguous runs (one setValues per run) and appends new rows.
function writeTable_(table) {
  var idx = Object.keys(table.changed).map(Number).sort(function (a, b) { return a - b; });
  if (!idx.length) return;
  var sh = table.sh;
  var width = table.header.length;
  var needRows = table.rows.length + 1;
  if (needRows > sh.getMaxRows()) {
    var start = sh.getMaxRows();
    sh.insertRowsAfter(start, needRows - start + 200);
    formatByHeader_(sh, table.entity, table.header, start + 1, needRows - start + 200);
  }
  var runStart = idx[0];
  var prev = idx[0];
  for (var k = 1; k <= idx.length; k++) {
    var cur = idx[k];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    var block = table.rows.slice(runStart, prev + 1);
    sh.getRange(runStart + 2, 1, block.length, width).setValues(block);
    runStart = cur;
    prev = cur;
  }
}

function toRow_(entity, rec, table, existingRow) {
  var row = existingRow ? existingRow.slice() : table.header.map(function () { return ''; });
  SCHEMA[entity].cols.forEach(function (c) {
    var pos = table.map[c[1]];
    if (pos < 0) return;
    row[pos] = toCell_(rec[c[1]], c[2]);
  });
  return row;
}

function toCell_(v, type) {
  if (v === null || v === undefined || v === '') return type === 'bool' ? false : '';
  switch (type) {
    case 'bool':
    case 'tri':
      return !!v;
    case 'int':
    case 'num':
    case 'ms':
      return Number(v);
    case 'json':
      return JSON.stringify(v);
    case 'text':
      var s = String(v);
      return /^[=+\-@]/.test(s) ? "'" + s : s; // never let user text become a formula
    default:
      return String(v);
  }
}

function fromRow_(entity, row, table) {
  var rec = {};
  SCHEMA[entity].cols.forEach(function (c) {
    var pos = table.map[c[1]];
    var v = pos >= 0 ? row[pos] : '';
    rec[c[1]] = fromCell_(v, c[2]);
  });
  if (!rec.id) return null;
  delete rec._srv;
  return rec;
}

function fromCell_(v, type) {
  if (v instanceof Date) {
    if (type === 'ms') return v.getTime();
    v = Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  }
  switch (type) {
    case 'bool':
      return v === true || v === 'TRUE' || v === 'true' || v === 1;
    case 'tri':
      if (v === '' || v === null) return null;
      return v === true || v === 'TRUE' || v === 'true' || v === 1;
    case 'int':
    case 'num':
    case 'ms':
      if (v === '' || v === null) return null;
      var n = Number(String(v).replace(',', '.'));
      return isFinite(n) ? n : null;
    case 'json':
      if (!v) return [];
      try {
        return JSON.parse(v);
      } catch (e) {
        return [];
      }
    case 'date':
      return v === '' ? null : String(v).slice(0, 10);
    default:
      if (v === '' || v === null) return '';
      v = String(v);
      return /^'[=+\-@]/.test(v) ? v.slice(1) : v;
  }
}

// ---------------------------------------------------------------------------- validation

var ID_RE = /^[A-Za-z0-9_:\-]{1,80}$/;
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sanitize_(entity, rec) {
  if (!rec || typeof rec !== 'object') return null;
  if (!ID_RE.test(String(rec.id || ''))) return null;
  var updatedAt = Number(rec.updatedAt);
  if (!(updatedAt > 0)) return null;
  var out = {};
  var ok = true;
  SCHEMA[entity].cols.forEach(function (c) {
    var f = c[1];
    var t = c[2];
    var v = rec[f];
    if (f === '_srv') return;
    if (v === undefined || v === null || v === '') {
      out[f] = t === 'bool' ? false : null;
      return;
    }
    if (t === 'int' || t === 'num' || t === 'ms') {
      var n = Number(v);
      if (!isFinite(n) || n < 0 || (t !== 'ms' && n > 100000)) ok = false;
      out[f] = t === 'int' ? Math.round(n) : n;
    } else if (t === 'bool' || t === 'tri') {
      out[f] = !!v;
    } else if (t === 'date') {
      if (!DATE_RE.test(String(v))) ok = false;
      out[f] = String(v);
    } else if (t === 'key') {
      if (!ID_RE.test(String(v))) ok = false;
      out[f] = String(v);
    } else if (t === 'json') {
      out[f] = Array.isArray(v) ? v : [];
      if (JSON.stringify(out[f]).length > 45000) ok = false;
    } else {
      out[f] = String(v).slice(0, MAX_TEXT);
    }
  });
  out.updatedAt = updatedAt;
  // A record without what makes it a record is refused (and stays queued on the phone).
  if (entity === 'records' && (!out.date || !out.seriesKey || !(out.reps >= 1) || out.weight == null)) ok = false;
  if (entity === 'exercises' && (!out.seriesKey || out.id !== 'x:' + out.seriesKey)) ok = false;
  if (entity === 'body') {
    var range = BODY_KINDS[out.kind];
    if (!range || out.id.indexOf('b:' + out.kind + ':') !== 0 || !out.date || !STAMP_RE.test(out.measuredAt || '')) ok = false;
    else if (out.measuredAt.slice(0, 10) !== out.date) ok = false;
    else if (!out.deleted && !(out.value >= range[0] && out.value <= range[1])) ok = false;
  }
  if (entity === 'sleep') {
    if (!out.wakeDate || out.id !== 's:' + out.wakeDate) ok = false;
    else if (!out.deleted && !((out.hours > 0 && out.hours <= 24) || (out.total > 0 && out.total <= 24))) ok = false;
    else if (out.total != null && out.total > 24) ok = false;
  }
  return ok ? out : null;
}

// ---------------------------------------------------------------------------- program

function slugify_(name) {
  var map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  var s = String(name || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split('')
    .map(function (ch) { return Object.prototype.hasOwnProperty.call(map, ch) ? map[ch] : ch; })
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, 48) || 'ex';
}

function fmtOverride_(o) {
  if (!o || o.sets == null) return '';
  var r = o.reps ? o.reps[0] + (o.reps[1] !== o.reps[0] ? '-' + o.reps[1] : '') : '';
  var s = o.sets + 'x' + r;
  if (o.rir) s += '@' + o.rir[0] + (o.rir[1] !== o.rir[0] ? '-' + o.rir[1] : '');
  return s;
}

function parseOverride_(s) {
  var m = String(s || '').match(/(\d+)\s*[xх×]\s*(\d+)(?:\s*[-–]\s*(\d+))?(?:\s*@\s*(\d+)(?:\s*[-–]\s*(\d+))?)?/i);
  if (!m) return null;
  var o = { sets: Number(m[1]), reps: [Number(m[2]), Number(m[3] || m[2])] };
  if (m[4] != null) o.rir = [Number(m[4]), Number(m[5] != null ? m[5] : m[4])];
  return o;
}

function programRows_(p) {
  var rows = [];
  (p.days || []).forEach(function (d) {
    (d.slots || []).forEach(function (s, i) {
      var opts = s.options || [];
      if (!opts.length) return;
      var ov = s.overrides || {};
      rows.push([
        String(d.day),
        String(d.title || ''),
        String(i + 1),
        toCell_(opts[0].name, 'text'),
        toCell_(opts.slice(1).map(function (o) { return o.name; }).join(' / '), 'text'),
        String(s.category || 'iso'),
        String(s.step || 2.5),
        fmtOverride_(ov[1] || ov['1']),
        fmtOverride_(ov[2] || ov['2']),
        fmtOverride_(ov[3] || ov['3']),
        toCell_(s.note || '', 'text'),
        String(s.id || ''),
        opts.map(function (o) { return o.key; }).join(' / '),
      ]);
    });
  });
  return rows;
}

function hashRows_(rows) {
  var text = rows.map(function (r) { return r.map(function (v) { return String(v).replace(/^'/, ''); }).join('\t'); }).join('\n');
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8));
}

function writeProgram_(p) {
  var sh = ss_().getSheetByName(PROGRAM_SHEET);
  var rows = programRows_(p);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, PROGRAM_COLS.length).clearContent();
  if (rows.length) {
    if (rows.length + 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
    sh.getRange(2, 1, rows.length, PROGRAM_COLS.length).setNumberFormat('@');
    sh.getRange(2, 1, rows.length, PROGRAM_COLS.length).setValues(rows);
  }
  var props = PropertiesService.getScriptProperties();
  props.setProperty('PROGRAM_UPDATED_AT', String(Number(p.updatedAt)));
  props.setProperty('PROGRAM_HASH', hashRows_(readProgramRows_()));
}

function readProgramRows_() {
  var sh = ss_().getSheetByName(PROGRAM_SHEET);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh
    .getRange(2, 1, last - 1, PROGRAM_COLS.length)
    .getValues()
    .filter(function (r) { return String(r[3]).trim() !== ''; });
}

// Reads App_Program. If the sheet was edited by hand (hash changed), the edit becomes the
// newest program version so the app picks it up on the next sync.
function readProgram_() {
  var rows = readProgramRows_();
  if (!rows.length) return null;
  var props = PropertiesService.getScriptProperties();
  var hash = hashRows_(rows);
  var updatedAt = Number(props.getProperty('PROGRAM_UPDATED_AT') || 0);
  if (hash !== props.getProperty('PROGRAM_HASH')) {
    updatedAt = Math.max(Date.now(), updatedAt + 1);
    props.setProperty('PROGRAM_UPDATED_AT', String(updatedAt));
    props.setProperty('PROGRAM_HASH', hash);
  }
  var days = {};
  rows.forEach(function (r, i) {
    var day = Number(r[0]) || 1;
    if (!days[day]) days[day] = { day: day, title: String(r[1] || ''), slots: [] };
    var names = [String(r[3]).trim()].concat(
      String(r[4] || '')
        .split('/')
        .map(function (x) { return x.trim(); })
        .filter(String),
    );
    var keys = String(r[12] || '').split('/').map(function (x) { return x.trim(); });
    var overrides = {};
    [1, 2, 3].forEach(function (w) {
      var o = parseOverride_(r[6 + w]);
      if (o) overrides[w] = o;
    });
    days[day].slots.push({
      id: String(r[11] || '') || 'row' + (i + 2),
      category: CATEGORIES.indexOf(String(r[5])) >= 0 ? String(r[5]) : 'iso',
      step: Number(String(r[6]).replace(',', '.')) || 2.5,
      // Keys go with names by position. If a hand edit changed the number of alternatives without
      // the `keys` column, positions no longer match: a name keeps a key only if it is its own,
      // otherwise it starts a series of its own — two variants never share one.
      options: names.map(function (n, k) {
        var slug = slugify_(n);
        var key = keys.length === names.length ? keys[k] : keys.indexOf(slug) >= 0 ? slug : null;
        return { key: key && ID_RE.test(key) ? key : slug, name: n };
      }),
      overrides: overrides,
      note: String(r[10] || ''),
      order: Number(r[2]) || i,
    });
  });
  var list = Object.keys(days)
    .map(function (k) { return days[k]; })
    .sort(function (a, b) { return a.day - b.day; });
  list.forEach(function (d) {
    d.slots.sort(function (a, b) { return a.order - b.order; });
    d.slots.forEach(function (s) { delete s.order; });
  });
  return { id: 'main', draft: false, updatedAt: updatedAt, days: list };
}

// ---------------------------------------------------------------------------- summary

// Human-readable digest: one row per exercise per workout. Rebuilt from App_Sets; safe to delete.
function rebuildSummary_(setsTable, sessionsTable) {
  var ss = ss_();
  var sh = ss.getSheetByName(SUMMARY_SHEET) || ss.insertSheet(SUMMARY_SHEET, ss.getSheets().length);
  var tz = ss.getSpreadsheetTimeZone();
  var sessions = {};
  sessionsTable.rows.forEach(function (r) {
    var s = fromRow_('sessions', r, sessionsTable);
    if (s && !s.deleted) sessions[s.id] = s;
  });
  var groups = {};
  var order = [];
  setsTable.rows.forEach(function (r) {
    var x = fromRow_('sets', r, setsTable);
    if (!x || x.deleted || !sessions[x.sessionId]) return;
    var k = x.sessionId + '|' + x.seriesKey;
    if (!groups[k]) {
      groups[k] = { s: sessions[x.sessionId], name: x.exercise, sets: [] };
      order.push(k);
    }
    groups[k].sets.push(x);
  });
  var rows = order.map(function (k) {
    var g = groups[k];
    g.sets.sort(function (a, b) { return (a.setNo || 0) - (b.setNo || 0); });
    var work = g.sets.filter(function (x) { return !x.drop; });
    var fmt = function (x) {
      return (x.drop ? 'дроп ' : '') + String(x.weight).replace('.', ',') + '×' + x.reps + (x.rir != null ? ' @' + x.rir : '');
    };
    var best = work.slice().sort(function (a, b) { return b.weight * (1 + b.reps / 30) - a.weight * (1 + a.reps / 30); })[0];
    var tonnage = work.reduce(function (t, x) { return t + (x.weight || 0) * (x.reps || 0); }, 0);
    var flags = [];
    if (g.sets.some(function (x) { return x.pain; })) flags.push('боль');
    if (g.sets.some(function (x) { return x.technique; })) flags.push('техника хуже');
    var item = (g.s.items || []).filter(function (i) { return i.seriesKey === g.sets[0].seriesKey; })[0];
    if (item && item.flags) {
      if (item.flags.pain && flags.indexOf('боль') < 0) flags.push('боль');
      if (item.flags.technique && flags.indexOf('техника хуже') < 0) flags.push('техника хуже');
      if (item.flags.baseline) flags.push('новая точка отсчёта');
    }
    return [
      g.s.date, g.s.cycle, g.s.week, g.s.day, toCell_(g.name, 'text'),
      g.sets.map(fmt).join(', '),
      best ? fmt(best) : '',
      Math.round(tonnage),
      flags.join(', '),
      toCell_((item && item.note) || '', 'text'),
      g.s.status === 'done' ? '' : 'в процессе',
    ];
  });
  rows.sort(function (a, b) { return String(b[0]).localeCompare(String(a[0])) || b[3] - a[3]; });
  var header = ['Дата', 'Цикл', 'Неделя', 'День', 'Упражнение', 'Подходы (кг×повт @RIR)', 'Лучший подход', 'Тоннаж, кг', 'Отметки', 'Заметка', 'Статус'];
  sh.clearContents();
  sh.getRange(1, 1, 1, header.length).setValues([header]);
  if (rows.length) {
    if (rows.length + 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
    sh.getRange(2, 1, rows.length, 1).setNumberFormat('@');
    sh.getRange(2, 1, rows.length, header.length).setValues(rows);
  }
  sh.setFrozenRows(1);
}

function rebuildSummary() {
  ensureSheets_();
  rebuildSummary_(readTable_('sets'), readTable_('sessions'));
}

// ---------------------------------------------------------------------------- manual edits

// Simple trigger: if a row of an App_* data sheet (App_Sets, App_Body, …) is edited by hand,
// bump its version so the app pulls the correction on the next sync.
function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  var entity = null;
  ENTITIES.forEach(function (k) {
    if (SCHEMA[k].sheet === sh.getName()) entity = k;
  });
  if (!entity || e.range.getRow() < 2) return;
  var hm = headerMap_(sh, entity);
  var col = e.range.getColumn() - 1;
  if (col === hm.map.updatedAt || col === hm.map._srv) return;
  // Wait for a sync in progress, so the edit gets a cursor value the app has not passed yet.
  var lock = null;
  try {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) lock = null;
  } catch (err) {
    lock = null;
  }
  try {
    var props = null;
    var srv = Date.now();
    try {
      props = PropertiesService.getScriptProperties();
      srv = Math.max(srv, Number(props.getProperty('LAST_SRV') || 0) + 1);
    } catch (err) {
      props = null;
    }
    var first = e.range.getRow();
    var n = e.range.getNumRows();
    var versions = sh.getRange(first, hm.map.updatedAt + 1, n, 1).getValues();
    for (var i = 0; i < n; i++) {
      // Never lower the version: the phone's clock may run ahead of Google's.
      var next = Math.max(Date.now(), (Number(versions[i][0]) || 0) + 1);
      sh.getRange(first + i, hm.map.updatedAt + 1).setValue(next);
      sh.getRange(first + i, hm.map._srv + 1).setValue(srv++);
    }
    if (props) props.setProperty('LAST_SRV', String(srv));
  } finally {
    if (lock) lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------- setup & menu

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Тренировки')
    .addItem('Подготовить листы и ключ', 'setup')
    .addItem('Показать ключ доступа', 'showToken')
    .addItem('Сменить ключ доступа (если телефон потерян)', 'rotateToken')
    .addItem('Обновить сводку', 'rebuildSummary')
    .addItem('Описать старые листы (для переноса)', 'describeLegacySheets')
    .addItem('Резервная копия таблицы', 'backupSpreadsheet')
    .addItem('Ключ для «Команд» iPhone', 'showIngestKey')
    .addItem('Сменить ключ для «Команд»', 'rotateIngestKey')
    .addToUi();
}

// 64 hex characters from two random UUIDs (~244 random bits).
function newToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function getOrCreateToken_() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('API_TOKEN');
  if (!token) {
    token = newToken_();
    props.setProperty('API_TOKEN', token);
  }
  return token;
}

// Invalidates the old key at once (no redeploy needed); every device must enter the new one.
function rotateToken() {
  var token = newToken_();
  PropertiesService.getScriptProperties().setProperty('API_TOKEN', token);
  notify_('Новый ключ доступа (старый больше не работает):\n' + token + '\n\nВставьте его в настройки приложения на своих устройствах.');
  return token;
}

function setup() {
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss_().getId());
  ensureSheets_();
  var token = getOrCreateToken_();
  var msg =
    'Листы App_* готовы. Существующие листы не изменялись.\n\n' +
    'Ключ доступа (вставьте в приложение):\n' + token + '\n\n' +
    'Дальше: Развернуть → Новое развертывание → Веб-приложение.\n' +
    'Выполнять от имени: «Меня». У кого есть доступ: «Все».\n' +
    'Скопируйте URL веб-приложения (оканчивается на /exec) в настройки приложения.';
  notify_(msg);
  return token;
}

// A full copy of the spreadsheet (every tab, old ones included) next to it in Google Drive.
// Run it before anything that changes many rows; restoring = opening the copy.
function backupSpreadsheet() {
  var ss = ss_();
  var stamp = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm');
  var copy = ss.copy(ss.getName() + ' — резервная копия ' + stamp);
  notify_('Резервная копия создана:\n' + copy.getName() + '\n' + copy.getUrl());
  return copy.getId();
}

// The Shortcuts key only adds weight, waist and sleep: it cannot read the sheet or change workouts.
function showIngestKey() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('INGEST_KEY');
  if (!key) {
    key = newToken_();
    props.setProperty('INGEST_KEY', key);
  }
  notify_('Ключ для «Команд» (только добавляет вес, талию и сон, ничего не читает):\n' + key);
  return key;
}

function rotateIngestKey() {
  var key = newToken_();
  PropertiesService.getScriptProperties().setProperty('INGEST_KEY', key);
  notify_('Новый ключ для «Команд» (старый больше не работает):\n' + key + '\n\nВставьте его в команду на iPhone.');
  return key;
}

function showToken() {
  notify_('Ключ доступа:\n' + getOrCreateToken_());
}

function notify_(msg) {
  Logger.log(msg);
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    // Run from the editor: the message is in the execution log.
  }
}

// Read-only snapshot of the old tabs (first rows of each) into App_Inspect, so the exact
// layout can be mapped for a precise migration. The old tabs are not modified.
function describeLegacySheets() {
  var ss = ss_();
  var out = [];
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (name.indexOf('App_') === 0) return;
    var rows = Math.min(sh.getLastRow(), 40);
    var cols = Math.min(sh.getLastColumn(), 30);
    out.push(['### ' + name, 'строк: ' + sh.getLastRow(), 'столбцов: ' + sh.getLastColumn()]);
    if (rows > 0 && cols > 0) {
      sh.getRange(1, 1, rows, cols).getDisplayValues().forEach(function (r, i) {
        out.push(['r' + (i + 1)].concat(r));
      });
    }
    out.push(['']);
  });
  var width = out.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
  out = out.map(function (r) {
    var x = r.map(function (v) { return toCell_(v, 'text'); });
    while (x.length < width) x.push('');
    return x;
  });
  var dst = ss.getSheetByName(INSPECT_SHEET) || ss.insertSheet(INSPECT_SHEET, ss.getSheets().length);
  dst.clearContents();
  if (out.length > dst.getMaxRows()) dst.insertRowsAfter(dst.getMaxRows(), out.length - dst.getMaxRows());
  if (width > dst.getMaxColumns()) dst.insertColumnsAfter(dst.getMaxColumns(), width - dst.getMaxColumns());
  dst.getRange(1, 1, out.length, width).setNumberFormat('@');
  dst.getRange(1, 1, out.length, width).setValues(out);
  notify_('Готово: структура старых листов записана в лист ' + INSPECT_SHEET + '.');
}

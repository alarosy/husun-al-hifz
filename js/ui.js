// العرض والأحداث.

import * as E from './engine.js';
import * as S from './store.js';
import * as Y from './sync.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/* ───────────── التنسيق ───────────── */

function makeFmt(locale, opts) {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...opts });
  } catch {
    return new Intl.DateTimeFormat('ar', { timeZone: 'UTC', ...opts });
  }
}

const FMT = {
  long: makeFmt('ar-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  short: makeFmt('ar-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }),
  hijri: makeFmt('ar-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }),
};
const STAMP = new Intl.DateTimeFormat('ar-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
const NUM = new Intl.NumberFormat('ar-u-nu-latn', { maximumFractionDigits: 1 });

const asUTC = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
};
const fmtDate = (s, kind = 'short') => FMT[kind].format(asUTC(s));
const fmtStamp = (ms) => (ms ? STAMP.format(new Date(ms)) : 'غير معروف');

// [مفرد، جمع 3–10، تمييز 11+]
const U = {
  page: ['صفحة', 'صفحات', 'صفحة'],
  day: ['يوم', 'أيام', 'يومًا'],
  task: ['مهمة', 'مهام', 'مهمة'],
  hizb: ['حزب', 'أحزاب', 'حزبًا'],
};
const DUAL = { page: 'صفحتان', day: 'يومان', task: 'مهمتان', hizb: 'حزبان' };

function unit(n, kind) {
  const k = Math.abs(n) % 100;
  if (k >= 3 && k <= 10) return U[kind][1];
  if (k >= 11) return U[kind][2];
  return U[kind][0];
}

/** «صفحة واحدة»، «صفحتان»، «5 صفحات»، «36 صفحة». */
function counted(n, kind) {
  if (n === 1) return `${U[kind][0]} واحد${kind === 'day' || kind === 'hizb' ? '' : 'ة'}`;
  if (n === 2) return DUAL[kind];
  return `${NUM.format(n)} ${unit(n, kind)}`;
}

function fmtMin(min) {
  if (min < 60) return `${min} د`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} س ${m} د` : `${h} س`;
}

function fmtPages(list) {
  if (!list.length) return '—';
  return `ص ${E.toRanges(list)
    .map(([a, b]) => (a === b ? `${a}` : `${a} – ${b}`))
    .join('، ')}`;
}

/** أجزاء متتالية تلتف عند الفاصل «·» فقط، لا داخل الجزء الواحد. */
const joinParts = (...parts) => parts.map((p) => `<span class="nw">${p}</span>`).join(' · ');

function fmtHizb(r) {
  const hizb = r.from === r.to ? `الحزب ${r.from}` : `الحزب ${r.from} – ${r.to}`;
  const juz = r.juzFrom === r.juzTo ? `الجزء ${r.juzFrom}` : `الجزء ${r.juzFrom} – ${r.juzTo}`;
  return joinParts(hizb, juz);
}

const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

/* ───────────── الأيقونات ───────────── */

const svg = (d, sw = 1.8) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const ICON = {
  right: svg('<path d="M9 6l6 6-6 6"/>', 2.2),
  left: svg('<path d="M15 6l-6 6 6 6"/>', 2.2),
  check: svg('<path d="M5 12.5l4.2 4.2L19 7"/>', 3),
  fajr: svg('<path d="M12 3v3M4.9 8.9l1.4 1.4M19.1 8.9l-1.4 1.4M2 18h20M6.5 18a5.5 5.5 0 0 1 11 0M8 21.5h8"/>'),
  day: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>'),
  night: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  follow: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
};

/* ───────────── نصوص المهام ───────────── */

const GROUP_TITLE = { fajr: 'بعد الفجر', day: 'خلال اليوم', night: 'قبل النوم', follow: 'متابعة' };

const TASK = {
  qabli: { title: 'التحضير القبلي', desc: 'اقرأ صفحة الحفظ حدرًا نحو 15 مرة قبل البدء.' },
  hifz: { title: 'الحفظ الجديد' },
  near: { title: 'مراجعة القريب', desc: 'يوميًا ولا تُترك.' },
  far: { title: 'مراجعة البعيد', desc: 'أنبوب واحد من المحفوظ القديم.' },
  read: { title: 'القراءة المستمرة' },
  listen: { title: 'الاستماع المنهجي', desc: 'حزب على الأقل من ختمة مرتّلة برواية قالون.' },
  weekly: { title: 'التحضير الأسبوعي', desc: 'اقرأ صفحات الأسبوع القادم مرة واحدة يوميًا.' },
  night: { title: 'التحضير الليلي', desc: 'استمع لصفحة الغد 10 مرات، ثم ردّدها ترتيلًا 15 دقيقة.' },
  checkpoint: { title: 'نقطة تفتيش', desc: 'سمِّع كل صفحة غيبًا مع سطرين قبلها وسطرين بعدها.' },
  sheikh: { title: 'العرض على الشيخ', desc: 'مرة أسبوعيًا على الأقل.' },
};

/* ───────────── الحالة ───────────── */

let { state, persistent } = S.load();
const meta = S.loadMeta();
let today = E.localToday();
let viewDate = clampDate(today);
let tab = 'today';
let howOpen = false;
let clearArmed = false;
let pendingNote = null;
let noteTimer = 0;
let settingsDraft = null;
let settingsErrors = {};
let mapPage = 1;
let sync = Y.loadSync();
let syncing = false;
let syncOffArmed = false;
let pushTimer = 0;

const canShareFiles = (() => {
  try {
    return !!navigator.canShare?.({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] });
  } catch {
    return false;
  }
})();

function clampDate(d) {
  const start = state.settings.startDate;
  if (d > today) d = today;
  if (d < start) d = start;
  return d;
}

function commit(fn, rerender = true) {
  fn(state);
  state.updatedAt = Date.now();
  if (!S.save(state)) {
    persistent = false;
    toast('تعذّر الحفظ في هذا المتصفح');
  }
  if (sync.token && sync.auto) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => syncNow({ quiet: true }), 5000);
  }
  if (rerender) render();
}

/* ───────────── العرض ───────────── */

function render() {
  const key = document.activeElement?.dataset?.key;
  if (tab === 'today') renderToday();
  else if (tab === 'map') renderMap();
  else renderSettings();
  if (key) document.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}

function bannersHTML() {
  const out = [];
  if (!persistent) {
    out.push(
      '<div class="banner red" role="alert"><span>التخزين غير متاح في هذا المتصفح (ربما وضع التصفح الخاص)، فلن تبقى بياناتك بعد إغلاق الصفحة.</span></div>',
    );
  }
  // المزامنة الناجحة مع الـGist تُعدّ نسخة احتياطية أيضًا
  const lastCopy = Math.max(meta.lastBackupAt, sync.token ? sync.lastSyncAt : 0);
  const since = Date.now() - (lastCopy || meta.createdAt);
  if (S.hasData(state) && since > 7 * 864e5) {
    const msg = lastCopy
      ? `مرّ ${counted(Math.floor(since / 864e5), 'day')} على آخر نسخة احتياطية.`
      : 'لم تُنزّل أي نسخة احتياطية بعد.';
    out.push(
      `<div class="banner ochre"><span>${msg} نزّل نسخة لتحفظ سجلك من الضياع.</span><button type="button" class="btn sm ochre" data-act="backup">تنزيل الآن</button></div>`,
    );
  }
  if (!state.settings.endConfirmed) {
    out.push(
      '<div class="banner"><span>لم تؤكّد رقم صفحة النهاية بعد. راجعه في الإعدادات ليكون حساب الختم دقيقًا.</span></div>',
    );
  }
  return out.join('');
}

function renderToday() {
  const el = $('#tab-today');
  const s = state.settings;
  if (today < s.startDate) {
    el.innerHTML = `${bannersHTML()}
      <article class="card notice">
        <h2>لم يبدأ البرنامج بعد</h2>
        <p>يبدأ البرنامج يوم ${fmtDate(s.startDate, 'long')}، بعد ${counted(E.diffDays(today, s.startDate), 'day')}.</p>
        <p class="muted">يمكنك تغيير تاريخ البدء من الإعدادات.</p>
      </article>`;
    return;
  }
  const info = E.dayInfo(state, viewDate);
  el.innerHTML = [
    bannersHTML(),
    navHTML(),
    heroHTML(info),
    reviewHTML(info),
    summaryHTML(info),
    ...E.GROUPS.map((g) => groupHTML(info, g)),
    notesHTML(),
    howHTML(),
  ].join('');
  $('#notes').value = pendingNote?.date === viewDate ? pendingNote.value : info.record.n || '';
}

function navHTML() {
  const atStart = viewDate <= state.settings.startDate;
  const atToday = viewDate >= today;
  return `<nav class="day-nav" aria-label="التنقل بين الأيام">
    <button type="button" class="btn ghost" data-act="prev" data-key="nav-prev" ${atStart ? 'disabled' : ''}>${ICON.right}<span>السابق</span></button>
    <button type="button" class="btn ghost" data-act="go-today" data-key="nav-today" ${atToday ? 'disabled' : ''}>العودة إلى اليوم</button>
    <button type="button" class="btn ghost" data-act="next" data-key="nav-next" ${atToday ? 'disabled' : ''}><span>التالي</span>${ICON.left}</button>
  </nav>`;
}

function heroHTML(info) {
  const s = state.settings;
  const c = E.counts(state);
  const p = E.projection(state, today);
  const pct = (n) => (c.total ? (100 * n) / c.total : 0).toFixed(2);

  let main = fmtPages(info.wird);
  let note;
  if (info.review && !info.doneToday.length) {
    main = 'يوم تثبيت';
    note = 'مراجعة فقط بلا حفظ جديد.';
  } else if (info.finished && !info.doneToday.length) {
    main = 'تمّ الحفظ';
    note = 'أُنجزت كل صفحات البرنامج، والحمد لله.';
  } else if (info.wirdDone) {
    note = '<span class="ok">أُنجز ورد اليوم ✓</span>';
  } else {
    note = `المتبقي من الورد: ${counted(info.upcoming.length, 'page')}`;
  }

  const over = info.dayNo > s.totalDays;
  const badges = [
    viewDate !== today ? '<span class="badge">يوم سابق</span>' : '',
    info.review ? '<span class="badge ochre">يوم تثبيت</span>' : '',
    over ? '<span class="badge">بعد نهاية البرنامج</span>' : '',
  ].join('');

  return `<article class="card hero" aria-label="ملخص اليوم">
    <div class="hero-top">
      <p class="day-count">اليوم <b>${info.dayNo}</b> من ${s.totalDays}</p>
      ${badges}
    </div>
    <p class="dates"><span>${fmtDate(viewDate, 'long')}</span><span>${fmtDate(viewDate, 'hijri')}</span></p>
    <div class="wird">
      <p class="wird-label">ورد الحفظ</p>
      <p class="wird-pages">${main}</p>
      <p class="wird-note">${note}</p>
    </div>
    <div class="bar" role="img" aria-label="حفظ جديد ${c.m}، ومتخطّى ${c.s}، من ${c.total} صفحة">
      <span class="bar-m" style="width:${pct(c.m)}%"></span><span class="bar-s" style="width:${pct(c.s)}%"></span>
    </div>
    <div class="bar-legend" aria-hidden="true"><span><i class="sw m"></i>حفظ جديد ${c.m}</span><span><i class="sw s"></i>متخطّى ${c.s}</span></div>
    <dl class="metrics">
      <div class="metric"><dt>المنجز</dt><dd><b>${c.handled}</b><small>من ${c.total}</small></dd></div>
      <div class="metric"><dt>المتبقي</dt><dd><b>${c.remaining}</b><small>${unit(c.remaining, 'page')}</small></dd></div>
      <div class="metric"><dt>الختم المتوقع</dt><dd><b>اليوم ${p.finishDayNo}</b><small>${fmtDate(p.finishDate)}</small></dd></div>
      <div class="metric ${p.margin >= 0 ? 'pos' : 'neg'}"><dt>الهامش</dt><dd><b dir="ltr">${signed(p.margin)}</b><small>${unit(p.margin, 'day')} ${p.margin >= 0 ? 'قبل النهاية' : 'بعد النهاية'}</small></dd></div>
    </dl>
  </article>`;
}

function reviewHTML(info) {
  return `<label class="card switch-row">
    <span class="switch-text"><b>يوم تثبيت</b><small>مراجعة فقط بلا حفظ جديد، ولا يُحسب ورد اليوم.</small></span>
    <input type="checkbox" class="switch" role="switch" data-act="review" data-key="review" ${info.review ? 'checked' : ''}>
  </label>`;
}

function summaryHTML(info) {
  const pct = info.total ? Math.round((100 * info.done) / info.total) : 0;
  return `<div class="card summary">
    <div class="summary-row">
      <p><b>${info.done}</b> من ${info.total} ${unit(info.total, 'task')} منجزة</p>
      <p>الوقت المقدّر <b>${fmtMin(info.minutes)}</b></p>
    </div>
    <div class="bar thin" role="progressbar" aria-label="المهام المنجزة" aria-valuemin="0" aria-valuemax="${info.total}" aria-valuenow="${info.done}"><span class="bar-m" style="width:${pct}%"></span></div>
  </div>`;
}

function groupHTML(info, g) {
  const tasks = info.tasks.filter((t) => t.group === g);
  let body = '';
  if (tasks.length) {
    body = `<ul class="tasks">${tasks.map((t) => taskHTML(info, t)).join('')}</ul>`;
  } else if (g === 'fajr') {
    body = info.review
      ? '<p class="empty">يوم تثبيت: لا حفظ جديد اليوم، فاجعل وقت الفجر للمراجعة.</p>'
      : '<p class="empty">أتممت حفظ صفحات البرنامج.</p>';
  } else {
    return '';
  }
  const mins = E.groupMinutes(info.tasks, g);
  return `<section class="card group" aria-labelledby="g-${g}">
    <header class="group-head">
      <h2 id="g-${g}">${ICON[g]}<span>${GROUP_TITLE[g]}</span></h2>
      ${mins ? `<span class="group-time" title="الوقت المقدّر">${fmtMin(mins)}</span>` : ''}
    </header>
    ${body}
  </section>`;
}

function staticCheck(done) {
  return `<span class="check-static" aria-hidden="true">${done ? ICON.check : ''}</span>`;
}

function taskHTML(info, t) {
  if (t.id === 'hifz') return hifzHTML(info, t);
  if (t.id === 'read') return readHTML(info, t);
  const text = TASK[t.id];
  let detail = '';
  if (t.id === 'far') detail = joinParts(fmtPages(t.pages), `الأنبوب ${info.far.index + 1} من ${info.far.count}`);
  else if (t.id === 'checkpoint') detail = `ص ${t.pages.join('، ')}`;
  else if (t.pages) detail = joinParts(fmtPages(t.pages), counted(t.pages.length, 'page'));
  return `<li class="task${t.done ? ' is-done' : ''}">
    <label class="task-row">
      <input type="checkbox" class="check" data-act="check" data-id="${t.id}" data-key="check-${t.id}" ${t.done ? 'checked' : ''}>
      <span class="task-body">
        <span class="task-title">${text.title}${t.optional ? ' <span class="tag">اختياري</span>' : ''}</span>
        ${detail ? `<span class="task-pages">${detail}</span>` : ''}
        ${text.desc ? `<span class="task-desc">${text.desc}</span>` : ''}
      </span>
      ${t.minutes ? `<span class="chip">${fmtMin(t.minutes)}</span>` : ''}
    </label>
  </li>`;
}

function hifzHTML(info, t) {
  const items = info.doneToday.map(
    ({ p, t: kind }) => `<li class="page-item ${kind === 'm' ? 'is-m' : 'is-s'}">
      <span class="pnum">ص ${p}</span>
      <span class="pstate">${kind === 'm' ? 'حُفظت ✓' : 'متقنة من قبل'}</span>
      <button type="button" class="btn link" data-act="undo" data-page="${p}" data-key="undo-${p}" aria-label="تراجع عن تسجيل ص ${p}">تراجع</button>
    </li>`,
  );
  for (const p of info.upcoming) {
    items.push(`<li class="page-item">
      <span class="pnum">ص ${p}</span>
      <span class="page-btns">
        <button type="button" class="btn primary sm" data-act="mark" data-page="${p}" data-key="mark-${p}">حفظتها</button>
        <button type="button" class="btn ghost sm" data-act="skip" data-page="${p}" data-key="skip-${p}">متقنة من قبل</button>
      </span>
    </li>`);
  }
  return `<li class="task task-hifz${t.done ? ' is-done' : ''}">
    <div class="task-row">
      ${staticCheck(t.done)}
      <span class="task-body">
        <span class="task-title">${TASK.hifz.title}<span class="visually-hidden">${t.done ? ' (منجز)' : ''}</span></span>
        <span class="task-desc">${t.done ? 'أُنجز ورد اليوم.' : 'احفظ الورد، ثم علِّم كل صفحة بعد إتقانها.'}</span>
      </span>
      <span class="chip">${fmtMin(t.minutes)}</span>
    </div>
    ${items.length ? `<ul class="page-list">${items.join('')}</ul>` : ''}
  </li>`;
}

function readHTML(info, t) {
  const r = info.reading;
  const per = state.settings.readPerDay;
  return `<li class="task${t.done ? ' is-done' : ''}">
    <div class="task-row">
      ${staticCheck(t.done)}
      <span class="task-body">
        <span class="task-title">${TASK.read.title}<span class="visually-hidden">${t.done ? ' (منجز)' : ''}</span></span>
        <span class="task-pages">${fmtHizb(r)}</span>
        <span class="task-desc">اقرأ ${counted(per, 'hizb')} نظرًا من المصحف، وسجّل ما قرأته فعلًا.</span>
      </span>
      <span class="chip">${fmtMin(t.minutes)}</span>
    </div>
    <div class="counter" role="group" aria-label="الأحزاب المقروءة اليوم">
      <button type="button" class="btn icon ghost" data-act="read" data-delta="-1" data-key="read-minus" aria-label="إنقاص حزب" ${r.r <= 0 ? 'disabled' : ''}>−</button>
      <output aria-live="polite"><b>${r.r}</b> من ${per}</output>
      <button type="button" class="btn icon ghost" data-act="read" data-delta="1" data-key="read-plus" aria-label="زيادة حزب" ${r.r >= E.READ_MAX ? 'disabled' : ''}>+</button>
    </div>
  </li>`;
}

function notesHTML() {
  return `<section class="card notes">
    <div class="notes-head">
      <h2><label for="notes">ملاحظات اليوم</label></h2>
      <span class="save-state" id="note-state" aria-live="polite"></span>
    </div>
    <textarea id="notes" rows="3" data-key="notes" placeholder="مواضع الخطأ، والمتشابهات، وما يحتاج إلى مراجعة…"></textarea>
  </section>`;
}

function howHTML() {
  const s = state.settings;
  return `<details class="card how" id="how" ${howOpen ? 'open' : ''}>
    <summary>كيف يُحسب الورد؟</summary>
    <div class="how-body">
      <p><b>ورد الحفظ:</b> ${counted(s.ppd, 'page')} يوميًا، ناقص ما علّمته «حفظتها» اليوم. الصفحة «المتقنة من قبل» لا تُحسب من الورد، فتأتي الصفحة التالية مكانها.</p>
      <p><b>يوم التثبيت:</b> لا ورد فيه، وتبقى الصفحات كما هي لليوم التالي.</p>
      <p><b>القريب:</b> آخر ${counted(s.near, 'page')} محفوظة قبل اليوم، ومنها الصفحات ${s.startPage > 1 ? `1 – ${s.startPage - 1}` : ''} المحفوظة قبل البرنامج.</p>
      <p><b>البعيد:</b> ما قبل القريب، مقسومًا إلى أنابيب كل منها ${counted(s.chunk, 'page')}. إن كانت الأنابيب 7 أو أقل فلكل يوم من الأسبوع أنبوبه (السبت للأول)، وإلا فأنبوب واحد يوميًا بالتناوب.</p>
      <p><b>القراءة المستمرة:</b> تبدأ من الحزب ${s.readStart} وتتقدّم بعدد ما قرأته فعلًا، وتعود إلى الحزب 1 بعد الحزب 60.</p>
      <p><b>التحضير الليلي:</b> صفحات الغد. <b>التحضير الأسبوعي:</b> صفحات الأسبوع القادم بعد ما بقي من هذا الأسبوع.</p>
      <p><b>الختم المتوقع:</b> المتبقي ÷ ${s.ppd}. <b>الهامش:</b> الأيام الباقية بين الختم المتوقع ونهاية اليوم ${s.totalDays}.</p>
      <p><b>اليوم المكتمل الأساس:</b> أُنجز فيه الورد (أو كان يوم تثبيت) وروجع القريب، وعليه تُحسب الأيام المتتالية.</p>
    </div>
  </details>`;
}

/* ───────────── الخريطة والسجل ───────────── */

function renderMap() {
  const el = $('#tab-map');
  const s = state.settings;
  const st = E.stats(state, today);
  const p = st.projection;
  const wird = new Set(today >= s.startDate ? E.dayInfo(state, today).wird : []);

  const stat = (label, value, sub, cls = '') =>
    `<div class="card stat ${cls}"><dt>${label}</dt><dd><b>${value}</b><small>${sub}</small></dd></div>`;

  const stats = [
    stat('المحفوظ قبل البرنامج', st.pre, unit(st.pre, 'page')),
    stat('الحفظ الجديد', st.m, unit(st.m, 'page')),
    stat('المتخطّى', st.s, unit(st.s, 'page')),
    stat('المتبقي', st.remaining, unit(st.remaining, 'page')),
    stat('المعدل اليومي', NUM.format(st.rate), 'صفحة يوميًا · آخر 7 أيام'),
    stat('الأيام المتتالية', st.streak, `${unit(st.streak, 'day')} · ورد وقريب`),
    stat('الهامش', `<span dir="ltr">${signed(p.margin)}</span>`, unit(p.margin, 'day'), p.margin >= 0 ? 'pos' : 'neg'),
    stat('نهاية البرنامج', fmtDate(st.end), `اليوم ${s.totalDays}`, 'date'),
  ].join('');

  const STATE_LABEL = { pre: 'محفوظة قبل البرنامج', m: 'حُفظت', s: 'متقنة من قبل', todo: 'لم تُعالج', out: 'خارج البرنامج' };
  const cells = [];
  for (let row = 0; row * 20 < E.MUSHAF_PAGES; row++) {
    cells.push(`<span class="row-label" aria-hidden="true">${row * 20 + 1}</span>`);
    for (let i = 1; i <= 20; i++) {
      const pg = row * 20 + i;
      if (pg > E.MUSHAF_PAGES) {
        cells.push('<span></span>');
        continue;
      }
      const rec = state.pages[pg];
      const kind =
        pg < s.startPage ? 'pre' : pg > s.endPage ? 'out' : rec ? rec.t : 'todo';
      cells.push(
        `<button type="button" tabindex="-1" class="pg ${kind}${wird.has(pg) ? ' is-wird' : ''}" data-act="page" data-page="${pg}" title="ص ${pg}: ${STATE_LABEL[kind]}" aria-label="ص ${pg}: ${STATE_LABEL[kind]}"></button>`,
      );
    }
  }

  const DAY_LABEL = { full: 'كامل', most: 'أكثر من النصف', partial: 'جزئي', missed: 'فائت', none: 'لم يبدأ', future: 'قادم' };
  const days = [];
  for (let i = 0; i < s.totalDays; i++) {
    if (i % 30 === 0) days.push(`<span class="row-label" aria-hidden="true">${i + 1}</span>`);
    const date = E.addDays(s.startDate, i);
    const status = E.dayStatus(state, date, today);
    const cls = `dg st-${status}${date === today ? ' today' : ''}`;
    const label = `اليوم ${i + 1} · ${fmtDate(date)}: ${DAY_LABEL[status]}`;
    days.push(
      `<button type="button" tabindex="-1" class="${cls}" data-act="day" data-date="${date}" title="${label}" aria-label="${label}" ${date > today ? 'disabled' : ''}></button>`,
    );
  }

  el.innerHTML = `
    <dl class="stats">${stats}</dl>
    <section class="card">
      <h2>خريطة المصحف</h2>
      <p class="muted">${E.MUSHAF_PAGES} صفحة، 20 في كل صف. اضغط على صفحة لتصحيح حالتها.</p>
      <div class="legend" aria-hidden="true">
        <span><i class="sw pre"></i>قبل البرنامج</span><span><i class="sw m"></i>حُفظت</span>
        <span><i class="sw s"></i>متقنة من قبل</span><span><i class="sw todo"></i>لم تُعالج</span>
        <span><i class="sw is-wird"></i>ورد اليوم</span>
      </div>
      <div class="grid mushaf">${cells.join('')}</div>
      <form class="page-jump" id="page-jump">
        <label for="jump">تصحيح صفحة برقمها</label>
        <input id="jump" name="p" type="number" inputmode="numeric" min="1" max="${E.MUSHAF_PAGES}" placeholder="مثلًا 37" required>
        <button type="submit" class="btn ghost sm">فتح</button>
      </form>
    </section>
    <section class="card">
      <h2>أيام البرنامج</h2>
      <p class="muted">${s.totalDays} يومًا، 30 في كل صف، ملوّنة بنسبة المهام المنجزة. اضغط على يوم لفتحه.</p>
      <div class="legend" aria-hidden="true">
        <span><i class="sw st-full"></i>كامل</span><span><i class="sw st-most"></i>أكثر من النصف</span>
        <span><i class="sw st-partial"></i>جزئي</span><span><i class="sw st-missed"></i>فائت</span>
        <span><i class="sw st-future"></i>قادم</span>
      </div>
      <div class="grid days">${days.join('')}</div>
    </section>`;
}

/* ───────────── الإعدادات ───────────── */

function renderSettings() {
  const el = $('#tab-settings');
  const v = settingsDraft || state.settings;
  const field = (name, label, hint, type = 'number') => {
    const [min, max] = S.LIMITS[name] || [];
    const err = settingsErrors[name];
    const range = type === 'number' ? `من ${min} إلى ${max}` : '';
    const help = err || [hint, range].filter(Boolean).join(' · ');
    return `<div class="field${err ? ' has-error' : ''}">
      <label for="f-${name}">${label}</label>
      <input id="f-${name}" name="${name}" type="${type}" ${type === 'number' ? `inputmode="numeric" min="${min}" max="${max}" step="1"` : ''} value="${esc(v[name])}" required aria-describedby="h-${name}" ${err ? 'aria-invalid="true"' : ''}>
      <small id="h-${name}" class="${err ? 'error' : 'hint'}">${esc(help)}</small>
    </div>`;
  };

  const lastBackup = meta.lastBackupAt ? fmtStamp(meta.lastBackupAt) : 'لم تُنزَّل بعد';

  el.innerHTML = `
    <form class="card" id="settings-form" novalidate>
      <h2>إعدادات البرنامج</h2>
      <p class="muted">تُعاد الخطة فور الحفظ، ولا يتغيّر السجل.</p>
      <div class="fields">
        ${field('startDate', 'تاريخ البدء', 'اليوم الأول من البرنامج', 'date')}
        ${field('totalDays', 'مدة البرنامج', 'بالأيام')}
        ${field('startPage', 'صفحة البداية', 'ما قبلها محفوظ قبل البرنامج')}
        ${field('endPage', 'صفحة النهاية', 'آخر صفحة في المصحف')}
        <label class="check-field"><input type="checkbox" class="check" name="endConfirmed" ${v.endConfirmed ? 'checked' : ''}><span>تأكّدت من رقم صفحة النهاية</span></label>
        ${field('ppd', 'صفحات الحفظ يوميًا', '')}
        ${field('near', 'حجم القريب', 'صفحات تُراجع يوميًا')}
        ${field('chunk', 'حجم أنبوب البعيد', 'صفحات كل أنبوب')}
        ${field('readStart', 'حزب بداية القراءة', '')}
        ${field('readPerDay', 'أحزاب القراءة يوميًا', '')}
      </div>
      <div class="btn-row"><button type="submit" class="btn primary">حفظ الإعدادات</button></div>
    </form>

    <section class="card">
      <h2>النسخة الاحتياطية والنقل بين الأجهزة</h2>
      <p class="muted">بياناتك محفوظة في هذا المتصفح فقط. لنقلها بين الهاتف والحاسوب: نزّل الملف من جهاز، ثم ارفعه أو الصق نصّه في الجهاز الآخر.</p>
      <p class="meta-line">آخر نسخة احتياطية: <b>${lastBackup}</b><br>آخر تعديل للبيانات: <b>${fmtStamp(state.updatedAt)}</b></p>
      <div class="btn-row">
        <button type="button" class="btn primary" data-act="backup">تنزيل ملف JSON</button>
        ${canShareFiles ? '<button type="button" class="btn ghost" data-act="share">مشاركة الملف</button>' : ''}
        <button type="button" class="btn ghost" data-act="copy">نسخ النص</button>
      </div>
      <h3>استيراد</h3>
      <p class="muted">الاستيراد يستبدل كل بيانات هذا الجهاز بمحتوى النسخة.</p>
      <div class="btn-row">
        <label class="btn ghost file-btn">رفع ملف<input type="file" accept="application/json,.json" data-act="import-file" class="visually-hidden"></label>
      </div>
      <label for="import-text" class="sub-label">أو الصق نص النسخة</label>
      <textarea id="import-text" rows="3" dir="ltr" spellcheck="false" placeholder='{"v":1,"updatedAt":…}'></textarea>
      <div class="btn-row"><button type="button" class="btn ghost" data-act="import-text">استيراد النص</button></div>
    </section>

    ${syncHTML()}

    <section class="card danger-zone">
      <h2>محو السجل</h2>
      <p class="muted">يحذف كل الصفحات المسجّلة والأيام والملاحظات، ويُبقي الإعدادات. نزّل نسخة احتياطية أولًا.</p>
      ${
        clearArmed
          ? `<div class="confirm-box" role="alert">
              <p><b>هل أنت متأكد؟</b> لا يمكن التراجع عن المحو.</p>
              <div class="btn-row">
                <button type="button" class="btn danger" data-act="clear-confirm" data-key="clear-confirm">نعم، امحُ السجل</button>
                <button type="button" class="btn ghost" data-act="clear-cancel">إلغاء</button>
              </div>
            </div>`
          : '<div class="btn-row"><button type="button" class="btn danger-ghost" data-act="clear-arm" data-key="clear-arm">محو السجل…</button></div>'
      }
    </section>

    <section class="card about">
      <h2>عن التطبيق</h2>
      <p>«حصون الحفظ» لمتابعة برنامج حفظ القرآن الكريم بطريقة الحصون الخمسة: الحفظ الجديد، والقريب، والبعيد، والتحضير، والقراءة المستمرة. رواية قالون عن نافع، مصحف الجماهيرية (${E.MUSHAF_PAGES} صفحة).</p>
      <p class="muted">يعمل دون اتصال بعد أول زيارة، ولا يرسل أي بيانات إلى أي خادم.</p>
    </section>`;
}

const TOKEN_WARNING = `<div class="warn-box" role="note">
  <b>تنبيه مهم عن الرمز</b>
  <ul>
    <li>الرمز مثل كلمة المرور: من يحصل عليه يستطيع قراءة الـGists في حسابك وتعديلها.</li>
    <li>أنشئ رمزًا <b>fine-grained</b> بصلاحية <b>Gists: Read and write</b> وحدها، بلا أي صلاحية أخرى، وبتاريخ انتهاء.</li>
    <li>يُحفظ الرمز في متصفح هذا الجهاز فقط، ولا يدخل في ملف النسخة الاحتياطية ولا في المستودع. لا تفعّل المزامنة على جهاز يستخدمه غيرك.</li>
    <li>ألغِ الرمز من إعدادات GitHub في أي وقت، فتتوقف المزامنة فورًا.</li>
  </ul>
</div>`;

function syncHTML() {
  if (!sync.token) {
    return `<section class="card" id="sync-card">
      <h2>المزامنة عبر GitHub Gist <span class="tag">اختيارية</span></h2>
      <p class="muted">بديل عن نقل الملف يدويًا: تُحفظ بياناتك في Gist <b>خاص</b> في حسابك على GitHub، ويجلبها كل جهاز تفعّل فيه المزامنة. عند الاختلاف تفوز النسخة الأحدث تعديلًا.</p>
      ${TOKEN_WARNING}
      <ol class="steps">
        <li>افتح <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">إنشاء رمز fine-grained</a> في GitHub.</li>
        <li>في Permissions اختر Account permissions ← <b>Gists</b> ← Read and write، ولا تختر غيرها.</li>
        <li>انسخ الرمز والصقه هنا. كرّر الخطوة نفسها على كل جهاز.</li>
      </ol>
      <label for="sync-token" class="sub-label">الرمز</label>
      <input id="sync-token" class="text-input" type="password" dir="ltr" autocomplete="off" spellcheck="false" placeholder="github_pat_…">
      <div class="btn-row"><button type="button" class="btn primary" data-act="sync-enable" ${syncing ? 'disabled' : ''}>${syncing ? 'جارٍ التحقّق…' : 'تفعيل المزامنة'}</button></div>
    </section>`;
  }
  const safety = Y.loadSafety();
  const gistLink = sync.gistId
    ? ` · <a href="https://gist.github.com/${esc(sync.gistId)}" target="_blank" rel="noopener">فتح الـGist</a>`
    : '';
  return `<section class="card" id="sync-card">
    <h2>المزامنة عبر GitHub Gist <span class="tag on">مفعّلة</span></h2>
    <p class="meta-line">آخر مزامنة: <b>${sync.lastSyncAt ? fmtStamp(sync.lastSyncAt) : 'لم تتمّ بعد'}</b><br>الرمز: <b dir="ltr">${esc(Y.maskToken(sync.token))}</b>${gistLink}</p>
    ${sync.lastError ? `<p class="sync-error" role="alert">${esc(sync.lastError)}</p>` : ''}
    <label class="check-field"><input type="checkbox" class="check" data-act="sync-auto" ${sync.auto ? 'checked' : ''}><span>مزامنة تلقائية عند فتح التطبيق وبعد كل تعديل</span></label>
    <div class="btn-row">
      <button type="button" class="btn primary" data-act="sync-now" data-key="sync-now" ${syncing ? 'disabled' : ''}>${syncing ? 'جارٍ المزامنة…' : 'مزامنة الآن'}</button>
      ${safety ? '<button type="button" class="btn ghost" data-act="sync-restore">استعادة ما قبل آخر جلب</button>' : ''}
    </div>
    <p class="muted">قبل أن تستبدل نسخةُ الـGist بياناتِ هذا الجهاز تُحفظ نسخة أمان منها هنا، ويحتفظ GitHub بسجل مراجعات الـGist.</p>
    ${TOKEN_WARNING}
    ${
      syncOffArmed
        ? `<div class="confirm-box" role="alert">
            <p><b>إيقاف المزامنة؟</b> يُحذف الرمز من هذا الجهاز، وتبقى بياناتك هنا وفي الـGist.</p>
            <div class="btn-row">
              <button type="button" class="btn danger" data-act="sync-off-confirm" data-key="sync-off-confirm">نعم، أوقفها</button>
              <button type="button" class="btn ghost" data-act="sync-off-cancel">إلغاء</button>
            </div>
          </div>`
        : '<div class="btn-row"><button type="button" class="btn danger-ghost" data-act="sync-off" data-key="sync-off">إيقاف المزامنة وحذف الرمز</button></div>'
    }
  </section>`;
}

/* ───────────── المزامنة ───────────── */

async function syncNow({ quiet = false } = {}) {
  if (!sync.token || syncing) return;
  flushNote();
  clearTimeout(pushTimer);
  syncing = true;
  if (tab === 'settings') render();
  const startedAt = state.updatedAt;
  let pulled = false;
  try {
    const res = await Y.syncState(state, sync);
    sync.gistId = res.gistId;
    sync.lastSyncAt = Date.now();
    sync.lastError = '';
    if (res.action === 'pull') {
      if (state.updatedAt !== startedAt) {
        // تعديل محلي أثناء المزامنة: صارت المحلية أحدث، فتُرفع في الجولة التالية
        pushTimer = setTimeout(() => syncNow({ quiet: true }), 1000);
      } else {
        Y.saveSafety(state);
        state = res.state;
        persistent = S.save(state);
        settingsDraft = null;
        settingsErrors = {};
        viewDate = clampDate(viewDate);
        pulled = true;
        toast('جُلبت أحدث البيانات من الـGist ✓');
      }
    } else if (!quiet) {
      const MSG = { create: 'أُنشئ Gist خاص ورُفعت إليه بياناتك ✓', push: 'رُفعت بياناتك إلى الـGist ✓', same: 'البيانات متطابقة ✓' };
      toast(MSG[res.action]);
    }
  } catch (err) {
    sync.lastError = err.message;
    if (!quiet || err.status === 401) toast(err.message);
  } finally {
    syncing = false;
    Y.saveSync(sync);
    // لا نعيد العرض في المزامنة الخلفية إلا إن تغيّرت البيانات، كي لا يُقاطَع ما يكتبه المستخدم
    if (pulled || tab === 'settings') render();
  }
}

async function enableSync() {
  const token = $('#sync-token').value.trim();
  if (!token) return toast('الصق الرمز أولًا');
  sync = { ...Y.loadSync(), token, gistId: '', lastSyncAt: 0, lastError: '' };
  await syncNow();
  if (!sync.lastSyncAt) {
    // فشل التحقّق: لا نُبقي رمزًا لا يعمل
    const error = sync.lastError;
    Y.clearSync();
    sync = Y.loadSync();
    render();
    toast(error || 'تعذّر تفعيل المزامنة');
  }
}

async function restoreSafety() {
  const safety = Y.loadSafety();
  if (!safety) return;
  const ok = await confirmDialog({
    title: 'استعادة ما قبل آخر جلب',
    message: `تعود بيانات هذا الجهاز إلى ما كانت عليه قبل آخر جلب من الـGist (آخر تعديل فيها: ${fmtStamp(safety.updatedAt)}). ستُرفع هذه النسخة إلى الـGist في المزامنة التالية.`,
    ok: 'استعادة',
  });
  if (!ok) return;
  Y.clearSafety();
  pendingNote = null;
  // تاريخ تعديل جديد كي تفوز النسخة المستعادة في المزامنة التالية
  commit((s) => {
    s.settings = safety.settings;
    s.pages = safety.pages;
    s.days = safety.days;
  });
  viewDate = clampDate(viewDate);
  render();
  toast('استُعيدت البيانات');
}

/* ───────────── الحوارات والإشعارات ───────────── */

function confirmDialog({ title, message, ok = 'متابعة', danger = false }) {
  const dlg = $('#dlg-confirm');
  $('#dlg-confirm-title').textContent = title;
  $('#dlg-confirm-msg').textContent = message;
  const okBtn = $('#dlg-confirm-ok');
  okBtn.textContent = ok;
  okBtn.className = `btn ${danger ? 'danger' : 'primary'}`;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
}

function askSkip(p) {
  const dlg = $('#dlg-skip');
  const form = dlg.querySelector('form');
  const date = viewDate;
  form.reset();
  form.elements.ok.disabled = true;
  $('#dlg-skip-title').textContent = `متقنة من قبل · ص ${p}`;
  dlg.returnValue = '';
  dlg.showModal();
  dlg.addEventListener(
    'close',
    () => {
      if (dlg.returnValue !== 'ok') return;
      commit((s) => S.setPage(s, p, 's', date));
      toast(`تُخطّيت ص ${p} لإتقانها`, { label: 'تراجع', run: () => commit((s) => S.clearPage(s, p)) });
    },
    { once: true },
  );
}

function openPage(p) {
  mapPage = Math.min(E.MUSHAF_PAGES, Math.max(1, p));
  fillPageDialog();
  const dlg = $('#dlg-page');
  if (!dlg.open) {
    dlg.returnValue = '';
    dlg.showModal();
  }
}

function fillPageDialog() {
  const p = mapPage;
  const s = state.settings;
  const rec = state.pages[p];
  const editable = p >= s.startPage && p <= s.endPage;
  let text;
  if (p < s.startPage) text = 'محفوظة قبل البرنامج.';
  else if (p > s.endPage) text = 'خارج نطاق البرنامج.';
  else if (!rec) text = 'لم تُعالج بعد.';
  else if (rec.t === 'm') text = `حُفظت يوم ${fmtDate(rec.d, 'long')}.`;
  else text = `متقنة من قبل، وتُخطّيت يوم ${fmtDate(rec.d, 'long')}.`;
  $('#dlg-page-title').textContent = `صفحة ${p}`;
  $('#dlg-page-state').textContent = text;
  const form = $('#dlg-page form');
  const btn = (v) => form.querySelector(`[value="${v}"]`);
  btn('m').disabled = !editable || (rec?.t === 'm' && rec.d === today);
  btn('s').disabled = !editable || (rec?.t === 's' && rec.d === today);
  btn('clear').disabled = !editable || !rec;
  form.querySelector('[data-step="-1"]').disabled = p <= 1;
  form.querySelector('[data-step="1"]').disabled = p >= E.MUSHAF_PAGES;
}

let toastTimer = 0;
function toast(message, action) {
  const el = $('#toast');
  $('#toast-msg').textContent = message;
  const btn = $('#toast-action');
  btn.hidden = !action;
  btn.onclick = action
    ? () => {
        hideToast();
        action.run();
      }
    : null;
  if (action) btn.textContent = action.label;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  if (!action?.sticky) toastTimer = setTimeout(hideToast, action ? 6000 : 2600);
}

function hideToast() {
  const el = $('#toast');
  el.classList.remove('show');
  setTimeout(() => {
    if (!el.classList.contains('show')) el.hidden = true;
  }, 250);
}

/* ───────────── الأفعال ───────────── */

function switchTab(name, focusTab = false) {
  flushNote();
  tab = name;
  for (const b of $$('[role="tab"]')) {
    const on = b.dataset.tab === name;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focusTab) b.focus();
  }
  for (const id of ['today', 'map', 'settings']) $(`#tab-${id}`).hidden = id !== name;
  if (name !== 'settings') clearArmed = syncOffArmed = false;
  render();
  window.scrollTo(0, 0);
}

function goTo(date) {
  flushNote();
  viewDate = clampDate(date);
  render();
}

function onNoteInput(value) {
  pendingNote = { date: viewDate, value };
  const st = $('#note-state');
  if (st) st.textContent = 'جارٍ الحفظ…';
  clearTimeout(noteTimer);
  noteTimer = setTimeout(flushNote, 600);
}

function flushNote() {
  clearTimeout(noteTimer);
  if (!pendingNote) return;
  const { date, value } = pendingNote;
  pendingNote = null;
  commit((s) => S.updateDay(s, date, (d) => (d.n = value)), false);
  const st = $('#note-state');
  if (st) st.textContent = 'حُفظت ✓';
}

function markBackedUp() {
  meta.lastBackupAt = Date.now();
  S.saveMeta(meta);
  render();
}

function downloadBackup() {
  flushNote();
  const blob = new Blob([S.serialize(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = S.backupFilename(today);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  markBackedUp();
  toast('نُزّلت النسخة الاحتياطية');
}

async function shareBackup() {
  flushNote();
  const file = new File([S.serialize(state)], S.backupFilename(today), { type: 'application/json' });
  try {
    await navigator.share({ files: [file], title: 'نسخة حصون الحفظ' });
    markBackedUp();
  } catch (err) {
    if (err?.name !== 'AbortError') toast('تعذّرت المشاركة');
  }
}

async function copyBackup() {
  flushNote();
  try {
    await navigator.clipboard.writeText(S.serialize(state));
    toast('نُسخ نص النسخة إلى الحافظة');
  } catch {
    const ta = $('#import-text');
    ta.value = S.serialize(state);
    ta.select();
    toast('حدّد النص وانسخه يدويًا');
  }
}

async function importBackup(text) {
  let incoming;
  try {
    incoming = S.parseBackup(text);
  } catch (err) {
    toast(err.message);
    return false;
  }
  flushNote();
  if (S.hasData(state) || state.updatedAt) {
    const older = incoming.updatedAt < state.updatedAt;
    const ok = await confirmDialog(
      older
        ? {
            title: 'النسخة أقدم من بياناتك',
            message: `آخر تعديل في النسخة: ${fmtStamp(incoming.updatedAt)}، وآخر تعديل في هذا الجهاز: ${fmtStamp(state.updatedAt)}. الاستيراد سيستبدل بياناتك الأحدث بهذه النسخة الأقدم.`,
            ok: 'استبدال رغم ذلك',
            danger: true,
          }
        : {
            title: 'استبدال البيانات',
            message: `سيُستبدل كل ما في هذا الجهاز بمحتوى النسخة (آخر تعديل فيها: ${fmtStamp(incoming.updatedAt)}).`,
            ok: 'استيراد',
          },
    );
    if (!ok) return false;
  }
  state = incoming;
  // مع المزامنة: تاريخ تعديل جديد كي لا تلغي نسخةُ الـGist الاستيرادَ
  if (sync.token) commit(() => {}, false);
  else persistent = S.save(state);
  settingsDraft = null;
  settingsErrors = {};
  viewDate = clampDate(today);
  render();
  toast('تم الاستيراد ✓');
  return true;
}

function saveSettings(form) {
  const input = Object.fromEntries(new FormData(form).entries());
  input.endConfirmed = form.elements.endConfirmed.checked;
  const { settings, errors } = S.validateSettings(input);
  if (Object.keys(errors).length) {
    settingsDraft = input;
    settingsErrors = errors;
    render();
    $(`#f-${Object.keys(errors)[0]}`)?.focus();
    return;
  }
  settingsDraft = null;
  settingsErrors = {};
  commit((s) => (s.settings = settings));
  viewDate = clampDate(viewDate);
  toast('حُفظت الإعدادات');
}

/* ───────────── الأحداث ───────────── */

function onClick(e) {
  const tabBtn = e.target.closest('[role="tab"]');
  if (tabBtn) return switchTab(tabBtn.dataset.tab);

  const step = e.target.closest('[data-step]');
  if (step) {
    mapPage += Number(step.dataset.step);
    return fillPageDialog();
  }

  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const page = Number(el.dataset.page);
  switch (el.dataset.act) {
    case 'prev':
      return goTo(E.addDays(viewDate, -1));
    case 'next':
      return goTo(E.addDays(viewDate, 1));
    case 'go-today':
      return goTo(today);
    case 'mark': {
      const date = viewDate;
      commit((s) => S.setPage(s, page, 'm', date));
      return toast(`حُفظت ص ${page} ✓`, { label: 'تراجع', run: () => commit((s) => S.clearPage(s, page)) });
    }
    case 'skip':
      return askSkip(page);
    case 'undo':
      return commit((s) => S.clearPage(s, page));
    case 'read': {
      const delta = Number(el.dataset.delta);
      return commit((s) =>
        S.updateDay(s, viewDate, (d) => (d.r = Math.max(0, Math.min(E.READ_MAX, (d.r || 0) + delta)))),
      );
    }
    case 'page':
      return openPage(page);
    case 'day':
      viewDate = clampDate(el.dataset.date);
      return switchTab('today');
    case 'backup':
      return downloadBackup();
    case 'share':
      return shareBackup();
    case 'copy':
      return copyBackup();
    case 'import-text': {
      const ta = $('#import-text');
      if (!ta.value.trim()) return toast('الصق نص النسخة أولًا');
      return importBackup(ta.value).then((ok) => ok && (ta.value = ''));
    }
    case 'clear-arm':
      clearArmed = true;
      render();
      return $('[data-key="clear-confirm"]')?.focus();
    case 'clear-cancel':
      clearArmed = false;
      render();
      return $('[data-key="clear-arm"]')?.focus();
    case 'sync-enable':
      return enableSync();
    case 'sync-now':
      return syncNow();
    case 'sync-restore':
      return restoreSafety();
    case 'sync-off':
      syncOffArmed = true;
      render();
      return $('[data-key="sync-off-confirm"]')?.focus();
    case 'sync-off-cancel':
      syncOffArmed = false;
      render();
      return $('[data-key="sync-off"]')?.focus();
    case 'sync-off-confirm':
      clearTimeout(pushTimer);
      Y.clearSync();
      sync = Y.loadSync();
      syncOffArmed = false;
      render();
      return toast('أُوقفت المزامنة وحُذف الرمز من هذا الجهاز');
    case 'clear-confirm':
      clearArmed = false;
      pendingNote = null;
      commit((s) => S.clearHistory(s));
      return toast('مُحي السجل، وبقيت الإعدادات');
  }
}

function onChange(e) {
  const t = e.target;
  if (t.closest('#dlg-skip')) {
    const form = t.form;
    form.elements.ok.disabled = !(form.elements.c1.checked && form.elements.c2.checked);
    return;
  }
  switch (t.dataset.act) {
    case 'check': {
      const id = t.dataset.id;
      return commit((s) =>
        S.updateDay(s, viewDate, (d) => {
          if (t.checked) d.c[id] = true;
          else delete d.c[id];
        }),
      );
    }
    case 'review':
      return commit((s) => S.updateDay(s, viewDate, (d) => (d.mode = t.checked ? 'review' : undefined)));
    case 'sync-auto':
      sync.auto = t.checked;
      return Y.saveSync(sync);
    case 'import-file': {
      const file = t.files?.[0];
      t.value = '';
      if (!file) return;
      file
        .text()
        .then(importBackup)
        .catch(() => toast('تعذّرت قراءة الملف'));
    }
  }
}

function onSubmit(e) {
  if (e.target.id === 'settings-form') {
    e.preventDefault();
    saveSettings(e.target);
  } else if (e.target.id === 'page-jump') {
    e.preventDefault();
    const n = Number(e.target.elements.p.value);
    if (Number.isInteger(n) && n >= 1 && n <= E.MUSHAF_PAGES) openPage(n);
  }
}

function onTabKey(e) {
  const tabs = $$('[role="tab"]');
  const i = tabs.indexOf(e.target);
  if (i < 0) return;
  // في RTL: السهم الأيسر للتبويب التالي
  const move = { ArrowLeft: 1, ArrowRight: -1, Home: -i, End: tabs.length - 1 - i }[e.key];
  if (move === undefined) return;
  e.preventDefault();
  switchTab(tabs[(i + move + tabs.length) % tabs.length].dataset.tab, true);
}

function checkDay() {
  const t = E.localToday();
  if (t === today) return;
  const wasToday = viewDate === today;
  today = t;
  viewDate = clampDate(wasToday ? today : viewDate);
  render();
}

function updateOnline() {
  $('#brand-sub').textContent = navigator.onLine ? '' : 'دون اتصال';
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    flushNote();
    location.reload();
  });
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      const offer = (worker) =>
        toast('نسخة جديدة من التطبيق جاهزة', { label: 'تحديث', sticky: true, run: () => worker.postMessage('skipWaiting') });
      if (reg.waiting && hadController) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
        });
      });
    } catch {
      // التطبيق يعمل دون service worker أيضًا
    }
  });
}

function init() {
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('input', (e) => {
    if (e.target.id === 'notes') onNoteInput(e.target.value);
  });
  document.addEventListener(
    'toggle',
    (e) => {
      if (e.target.id === 'how') howOpen = e.target.open;
    },
    true,
  );
  $('.tabs').addEventListener('keydown', onTabKey);
  $('#dlg-page').addEventListener('close', () => {
    const v = $('#dlg-page').returnValue;
    const p = mapPage;
    if (v === 'm' || v === 's') commit((s) => S.setPage(s, p, v, today));
    else if (v === 'clear') commit((s) => S.clearPage(s, p));
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return flushNote();
    checkDay();
    if (sync.token && sync.auto && Date.now() - sync.lastSyncAt > 30000) syncNow({ quiet: true });
  });
  window.addEventListener('pagehide', flushNote);
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  window.addEventListener('storage', (e) => {
    if (e.key !== S.KEY) return;
    state = S.load().state;
    viewDate = clampDate(viewDate);
    render();
  });
  setInterval(checkDay, 60000);
  updateOnline();
  render();
  registerSW();
  if (sync.token && sync.auto) syncNow({ quiet: true });
}

init();

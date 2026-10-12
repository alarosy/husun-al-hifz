// محرّك خطة «حصون الحفظ» — دوال نقية بلا DOM.
// كل التواريخ نصوص YYYY-MM-DD بالتوقيت المحلي، والأسبوع يبدأ السبت (السبت = 0).

export const MUSHAF_PAGES = 602;
export const HIZB_COUNT = 60;
export const READ_MAX = 8;

const DAY_MS = 86400000;

/* ───────────── التواريخ ───────────── */

const pad2 = (n) => String(n).padStart(2, '0');

export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function toDayNum(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function fromDayNum(n) {
  const dt = new Date(n * DAY_MS);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export const addDays = (s, n) => fromDayNum(toDayNum(s) + n);

/** عدد الأيام من a إلى b (b − a). */
export const diffDays = (a, b) => toDayNum(b) - toDayNum(a);

/** يوم الأسبوع: السبت = 0 … الجمعة = 6. */
export function weekday(s) {
  const jsDay = new Date(toDayNum(s) * DAY_MS).getUTCDay(); // الأحد = 0
  return (jsDay + 1) % 7;
}

export function localToday(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** رقم اليوم في البرنامج (اليوم الأول = 1). */
export const dayNo = (settings, date) => diffDays(settings.startDate, date) + 1;

export const programEnd = (settings) => addDays(settings.startDate, settings.totalDays - 1);

/* ───────────── الصفحات ───────────── */

function inProgram(settings, p) {
  return p >= settings.startPage && p <= settings.endPage;
}

/** كل صفحة من startPage إلى endPage ليس لها سجل. */
export function unhandled(state) {
  const { startPage, endPage } = state.settings;
  const out = [];
  for (let p = startPage; p <= endPage; p++) if (!state.pages[p]) out.push(p);
  return out;
}

/** الصفحات 1..startPage−1، ثم كل صفحة سجلّها d < date (مرتّبة تصاعديًا). */
export function memorizedBefore(state, date) {
  const { startPage, endPage } = state.settings;
  const out = [];
  for (let p = 1; p < startPage; p++) out.push(p);
  for (let p = startPage; p <= endPage; p++) {
    const rec = state.pages[p];
    if (rec && rec.d < date) out.push(p);
  }
  return out;
}

/** سجلات الصفحات المنجزة في يوم معيّن ضمن نطاق البرنامج. */
export function pagesOn(state, date) {
  const out = [];
  for (const [key, rec] of Object.entries(state.pages)) {
    const p = Number(key);
    if (rec && rec.d === date && inProgram(state.settings, p)) out.push({ p, t: rec.t });
  }
  return out.sort((a, b) => a.p - b.p);
}

export function counts(state) {
  let m = 0;
  let s = 0;
  for (const [key, rec] of Object.entries(state.pages)) {
    if (!rec || !inProgram(state.settings, Number(key))) continue;
    if (rec.t === 'm') m++;
    else if (rec.t === 's') s++;
  }
  const total = state.settings.endPage - state.settings.startPage + 1;
  return { m, s, handled: m + s, total, remaining: total - m - s, pre: state.settings.startPage - 1 };
}

/** يضغط قائمة صفحات إلى مقاطع متصلة: [34,35,36,40] ⇒ [[34,36],[40,40]]. */
export function toRanges(list) {
  const sorted = [...list].sort((a, b) => a - b);
  const out = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && p === last[1] + 1) last[1] = p;
    else out.push([p, p]);
  }
  return out;
}

/* ───────────── القريب والبعيد ───────────── */

/** يقسم البعيد إلى أنابيب حجم كل منها chunk؛ الأنبوب الأخير قد يكون ناقصًا. */
export function farPipes(far, chunk) {
  const pipes = [];
  for (let i = 0; i < far.length; i += chunk) pipes.push(far.slice(i, i + chunk));
  return pipes;
}

export function farForDay(pipes, wd, dayIndex) {
  if (pipes.length === 0) return null;
  const index = pipes.length <= 7 ? wd : dayIndex % pipes.length;
  if (index >= pipes.length) return null;
  return { index, count: pipes.length, pages: pipes[index] };
}

/* ───────────── القراءة المستمرة ───────────── */

const wrapHizb = (h) => ((((h - 1) % HIZB_COUNT) + HIZB_COUNT) % HIZB_COUNT) + 1;
export const juzOf = (hizb) => Math.ceil(hizb / 2);

export function readingFor(state, date) {
  const { readStart, readPerDay } = state.settings;
  let read = 0;
  for (const [d, rec] of Object.entries(state.days)) {
    if (d < date && rec && Number.isFinite(rec.r)) read += rec.r;
  }
  const from = wrapHizb(readStart + read);
  const list = Array.from({ length: readPerDay }, (_, i) => wrapHizb(from + i));
  const to = list[list.length - 1];
  return { from, to, list, juzFrom: juzOf(from), juzTo: juzOf(to), r: state.days[date]?.r || 0 };
}

/* ───────────── نقطة التفتيش ───────────── */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function checkpointPages(memorized, n, count = 5) {
  const rand = mulberry32(n * 7919);
  const pool = [...memorized];
  const k = Math.min(count, pool.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rand() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, k).sort((a, b) => a - b);
}

export const isCheckpointDay = (n, memorizedCount) => n > 0 && n % 60 === 0 && memorizedCount > 20;

/* ───────────── اليوم ───────────── */

export const GROUPS = ['fajr', 'day', 'night', 'follow'];

/**
 * كل ما يلزم لعرض يوم واحد: الورد، والقريب، والبعيد، والقراءة، والمهام.
 */
export function dayInfo(state, date) {
  const { settings } = state;
  const { ppd } = settings;
  const record = state.days[date] || {};
  const checks = record.c || {};
  const review = record.mode === 'review';
  const n = dayNo(settings, date);
  const wd = weekday(date);

  // 1) ورد الحفظ
  const doneToday = pagesOn(state, date);
  const memorizedToday = doneToday.filter((x) => x.t === 'm').length;
  const quota = review ? 0 : Math.max(0, ppd - memorizedToday);
  const pool = unhandled(state);
  const upcoming = pool.slice(0, quota);
  const finished = pool.length === 0;
  const wirdDone = review || quota === 0 || finished;
  const wird = [...doneToday.map((x) => x.p), ...upcoming].sort((a, b) => a - b);

  // 2) الغد  3) الأسبوع القادم
  const tomorrow = pool.slice(upcoming.length, upcoming.length + ppd);
  const weekStart = upcoming.length + (6 - wd) * ppd;
  const nextWeek = pool.slice(weekStart, weekStart + 7 * ppd);

  // 4) القريب  5) البعيد
  const memorized = memorizedBefore(state, date);
  const near = memorized.slice(Math.max(0, memorized.length - settings.near));
  const farAll = memorized.slice(0, Math.max(0, memorized.length - settings.near));
  const far = farForDay(farPipes(farAll, settings.chunk), wd, n - 1);

  // 6) القراءة المستمرة
  const reading = readingFor(state, date);

  // نقطة التفتيش
  const checkpoint = isCheckpointDay(n, memorized.length) ? { pages: checkpointPages(memorized, n) } : null;

  // المهام
  const tasks = [];
  const add = (id, group, minutes, done, extra = {}) => tasks.push({ id, group, minutes, done: !!done, ...extra });

  if (!review && !finished) {
    add('qabli', 'fajr', 15 * ppd, checks.qabli, { pages: wird });
    add('hifz', 'fajr', 15 * ppd, wirdDone, { auto: true });
  }
  if (near.length) add('near', 'day', near.length, checks.near, { pages: near });
  if (far) add('far', 'day', far.pages.length, checks.far, { pages: far.pages });
  add('read', 'day', 10 * settings.readPerDay, reading.r >= settings.readPerDay, { counter: true });
  add('listen', 'day', 20, checks.listen);
  if (nextWeek.length) add('weekly', 'day', 10 * ppd, checks.weekly, { pages: nextWeek });
  if (tomorrow.length) add('night', 'night', 25 * tomorrow.length, checks.night, { pages: tomorrow });
  if (checkpoint) add('checkpoint', 'follow', 25, checks.checkpoint, { pages: checkpoint.pages });
  add('sheikh', 'follow', 0, checks.sheikh, { optional: true });

  const counted = tasks.filter((t) => !t.optional);
  const done = counted.filter((t) => t.done).length;
  const minutes = tasks.reduce((sum, t) => sum + t.minutes, 0);

  return {
    date,
    dayNo: n,
    weekday: wd,
    review,
    record,
    doneToday,
    quota,
    upcoming,
    wird,
    wirdDone,
    finished,
    tomorrow,
    nextWeek,
    near,
    far,
    reading,
    checkpoint,
    tasks,
    done,
    total: counted.length,
    minutes,
    coreDone: wirdDone && !!checks.near,
  };
}

export function groupMinutes(tasks, group) {
  return tasks.filter((t) => t.group === group).reduce((sum, t) => sum + t.minutes, 0);
}

/** حالة يوم في شبكة الأيام. */
export function dayStatus(state, date, today) {
  if (date > today) return 'future';
  const info = dayInfo(state, date);
  const ratio = info.total ? info.done / info.total : 0;
  if (ratio >= 1) return 'full';
  if (ratio > 0.5) return 'most';
  if (ratio > 0) return 'partial';
  return date < today ? 'missed' : 'none';
}

/* ───────────── الإسقاط والإحصاءات ───────────── */

/**
 * الختم المتوقع = المتبقي ÷ ppd. ما بقي من ورد اليوم يُنجز اليوم، والباقي بمعدل ppd
 * من الغد. الهامش = الأيام بين يوم الختم المتوقع ونهاية اليوم الأخير من البرنامج.
 */
export function projection(state, today) {
  const { settings } = state;
  const remaining = unhandled(state).length;
  const daysNeeded = Math.ceil(remaining / settings.ppd);
  const rest = remaining - dayInfo(state, today).upcoming.length;
  const finishDate = addDays(today, Math.ceil(rest / settings.ppd));
  const finishDayNo = dayNo(settings, finishDate);
  return { remaining, daysNeeded, finishDate, finishDayNo, margin: settings.totalDays - finishDayNo };
}

/** الأيام المتتالية المكتملة الأساس؛ اليوم الجاري لا يكسر السلسلة قبل انتهائه. */
export function streak(state, today) {
  const start = state.settings.startDate;
  let date = today;
  if (date < start) return 0;
  if (!dayInfo(state, date).coreDone) date = addDays(date, -1);
  let count = 0;
  while (date >= start && dayInfo(state, date).coreDone) {
    count++;
    date = addDays(date, -1);
  }
  return count;
}

/** متوسط الصفحات المعالَجة يوميًا في آخر 7 أيام (بما فيها اليوم). */
export function weeklyRate(state, today) {
  const { startDate } = state.settings;
  if (today < startDate) return 0;
  const from = diffDays(startDate, today) >= 6 ? addDays(today, -6) : startDate;
  const span = diffDays(from, today) + 1;
  let handled = 0;
  for (const [key, rec] of Object.entries(state.pages)) {
    if (rec && rec.d >= from && rec.d <= today && inProgram(state.settings, Number(key))) handled++;
  }
  return handled / span;
}

export function stats(state, today) {
  return {
    ...counts(state),
    rate: weeklyRate(state, today),
    streak: streak(state, today),
    projection: projection(state, today),
    end: programEnd(state.settings),
  };
}

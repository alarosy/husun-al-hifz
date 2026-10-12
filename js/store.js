// الحفظ في localStorage والاستيراد والتصدير. نموذج البيانات v1 محفوظ كما هو.

import { HIZB_COUNT, MUSHAF_PAGES, READ_MAX, isValidDate, localToday } from './engine.js';

export const KEY = 'husun-hifz-v1';
const META_KEY = 'husun-hifz-v1-meta'; // بيانات الجهاز فقط (آخر نسخة احتياطية)، خارج نموذج البيانات

export const LIMITS = {
  startPage: [1, MUSHAF_PAGES],
  endPage: [1, MUSHAF_PAGES],
  ppd: [1, 20],
  near: [1, 200],
  chunk: [5, 200],
  readStart: [1, HIZB_COUNT],
  readPerDay: [1, READ_MAX],
  totalDays: [7, 2000],
};

export function defaultSettings(today = localToday()) {
  return {
    startDate: today,
    startPage: 34,
    endPage: 602,
    endConfirmed: true,
    ppd: 2,
    near: 40,
    chunk: 40,
    readStart: 52,
    readPerDay: 4,
    totalDays: 300,
  };
}

export function defaultState(today = localToday()) {
  return { v: 1, updatedAt: 0, settings: defaultSettings(today), pages: {}, days: {} };
}

/** يتحقق من الإعدادات ويعيد {settings, errors}. errors فارغة إن كانت سليمة. */
export function validateSettings(input) {
  const errors = {};
  const num = {};
  for (const [field, [min, max]] of Object.entries(LIMITS)) {
    const n = Number(input[field]);
    if (!Number.isInteger(n) || n < min || n > max) errors[field] = `أدخل عددًا صحيحًا من ${min} إلى ${max}`;
    else num[field] = n;
  }
  if (!isValidDate(input.startDate)) errors.startDate = 'تاريخ غير صالح';
  if (!errors.startPage && !errors.endPage && num.startPage > num.endPage) {
    errors.endPage = 'صفحة النهاية يجب ألا تسبق صفحة البداية';
  }
  // بترتيب حقول نموذج البيانات نفسه
  const settings = {
    startDate: input.startDate,
    startPage: num.startPage,
    endPage: num.endPage,
    endConfirmed: input.endConfirmed === true || input.endConfirmed === 'on',
    ppd: num.ppd,
    near: num.near,
    chunk: num.chunk,
    readStart: num.readStart,
    readPerDay: num.readPerDay,
    totalDays: num.totalDays,
  };
  return { settings, errors };
}

/** يحوّل كائنًا خامًا إلى حالة سليمة، أو يرمي خطأ برسالة عربية. */
export function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('الملف ليس نسخة احتياطية صالحة');
  if (raw.v !== 1) throw new Error('إصدار الملف غير مدعوم (المطلوب v = 1)');
  if (!raw.settings || typeof raw.settings !== 'object') throw new Error('الملف لا يحتوي الإعدادات');

  const { settings, errors } = validateSettings({ ...raw.settings, endConfirmed: raw.settings.endConfirmed === true });
  const bad = Object.keys(errors);
  if (bad.length) throw new Error(`إعدادات غير صالحة في الملف: ${bad.join('، ')}`);

  const pages = {};
  for (const [key, rec] of Object.entries(raw.pages || {})) {
    const p = Number(key);
    if (!Number.isInteger(p) || p < 1 || p > MUSHAF_PAGES) continue;
    if (!rec || (rec.t !== 'm' && rec.t !== 's') || !isValidDate(rec.d)) continue;
    pages[p] = { d: rec.d, t: rec.t };
  }

  const days = {};
  for (const [date, rec] of Object.entries(raw.days || {})) {
    if (!isValidDate(date) || !rec || typeof rec !== 'object') continue;
    const day = {};
    const c = {};
    for (const [id, val] of Object.entries(rec.c || {})) if (val === true) c[id] = true;
    if (Object.keys(c).length) day.c = c;
    const r = Number(rec.r);
    if (Number.isInteger(r) && r > 0) day.r = Math.min(r, READ_MAX);
    if (typeof rec.n === 'string' && rec.n.trim()) day.n = rec.n;
    if (rec.mode === 'review') day.mode = 'review';
    if (Object.keys(day).length) days[date] = day;
  }

  const updatedAt = Number(raw.updatedAt);
  return { v: 1, updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0, settings, pages, days };
}

/* ───────────── التخزين ───────────── */

export function load() {
  let text = null;
  let persistent = true;
  try {
    text = localStorage.getItem(KEY);
  } catch {
    persistent = false;
  }
  if (text) {
    try {
      return { state: normalize(JSON.parse(text)), persistent };
    } catch {
      // بيانات تالفة: نحتفظ بنسخة منها ونبدأ من جديد
      try {
        localStorage.setItem(`${KEY}-corrupt-${Date.now()}`, text);
      } catch {}
    }
  }
  const state = defaultState();
  persistent = save(state) && persistent;
  return { state, persistent };
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function loadMeta() {
  let meta = null;
  try {
    meta = JSON.parse(localStorage.getItem(META_KEY) || 'null');
  } catch {}
  if (!meta || typeof meta !== 'object') {
    meta = { createdAt: Date.now(), lastBackupAt: 0 };
    saveMeta(meta);
  }
  return meta;
}

export function saveMeta(meta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {}
}

/* ───────────── التصدير والاستيراد ───────────── */

export const serialize = (state) => JSON.stringify(state);

export const backupFilename = (today = localToday()) => `husun-hifz-${today}.json`;

export function parseBackup(text) {
  let raw;
  try {
    raw = JSON.parse(String(text).trim());
  } catch {
    throw new Error('النص ليس JSON صالحًا');
  }
  return normalize(raw);
}

export const hasData = (state) => Object.keys(state.pages).length > 0 || Object.keys(state.days).length > 0;

/* ───────────── التعديلات ───────────── */

/** يعدّل سجل يوم ثم يحذفه إن صار فارغًا. */
export function updateDay(state, date, fn) {
  const day = state.days[date] ? { ...state.days[date], c: { ...(state.days[date].c || {}) } } : { c: {} };
  fn(day);
  if (day.c && !Object.keys(day.c).length) delete day.c;
  if (!day.r) delete day.r;
  if (!day.n || !String(day.n).trim()) delete day.n;
  if (day.mode !== 'review') delete day.mode;
  if (Object.keys(day).length) state.days[date] = day;
  else delete state.days[date];
}

export function setPage(state, p, t, d) {
  state.pages[p] = { d, t };
}

export function clearPage(state, p) {
  delete state.pages[p];
}

export function clearHistory(state) {
  state.pages = {};
  state.days = {};
}

// المزامنة الاختيارية عبر GitHub Gist خاص. القاعدة: الأحدث updatedAt يفوز.
// الرمز يُحفظ في localStorage على هذا الجهاز فقط، ولا يدخل في نموذج البيانات ولا في النسخة الاحتياطية.

import { normalize, serialize } from './store.js';

const SYNC_KEY = 'husun-hifz-v1-sync';
const SAFETY_KEY = 'husun-hifz-v1-before-sync';
export const GIST_FILE = 'husun-hifz.json';
const API = 'https://api.github.com';

const DEFAULTS = { token: '', gistId: '', auto: true, lastSyncAt: 0, lastError: '' };

export function loadSync() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SYNC_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSync(cfg) {
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify(cfg));
  } catch {}
}

export function clearSync() {
  try {
    localStorage.removeItem(SYNC_KEY);
  } catch {}
}

/** نسخة أمان محلية من البيانات قبل أن تستبدلها نسخة الـGist. */
export function saveSafety(state) {
  try {
    localStorage.setItem(SAFETY_KEY, serialize(state));
  } catch {}
}

export function loadSafety() {
  try {
    const text = localStorage.getItem(SAFETY_KEY);
    return text ? normalize(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

export function clearSafety() {
  try {
    localStorage.removeItem(SAFETY_KEY);
  } catch {}
}

export const maskToken = (t) => (t.length > 12 ? `${t.slice(0, 11)}…${t.slice(-4)}` : '••••');

export class SyncError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

function messageFor(status) {
  if (status === 401) return 'الرمز غير صالح أو انتهت صلاحيته.';
  if (status === 403) return 'الرمز لا يملك صلاحية Gists (Read and write)، أو تجاوزت حدّ الطلبات.';
  if (status === 404) return 'الـGist غير موجود، أو الرمز لا يملك صلاحية Gists.';
  return `خطأ من GitHub (${status}).`;
}

async function api(fetchFn, token, path, opts = {}) {
  let res;
  try {
    res = await fetchFn(API + path, {
      ...opts,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new SyncError('تعذّر الاتصال بـGitHub. تحقّق من الإنترنت.');
  }
  if (!res.ok) throw new SyncError(messageFor(res.status), res.status);
  return res.json();
}

async function findGist(fetchFn, token) {
  for (let page = 1; page <= 5; page++) {
    const list = await api(fetchFn, token, `/gists?per_page=100&page=${page}`);
    const hit = list.find((g) => g.files && g.files[GIST_FILE]);
    if (hit) return hit.id;
    if (list.length < 100) break;
  }
  return '';
}

async function readGist(fetchFn, token, id) {
  const gist = await api(fetchFn, token, `/gists/${id}`);
  const file = gist.files?.[GIST_FILE];
  if (!file) return null;
  if (!file.truncated) return file.content;
  try {
    return await (await fetchFn(file.raw_url, { cache: 'no-store' })).text();
  } catch {
    throw new SyncError('تعذّر تنزيل محتوى الـGist.');
  }
}

const writeGist = (fetchFn, token, id, state) =>
  api(fetchFn, token, `/gists/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ files: { [GIST_FILE]: { content: serialize(state) } } }),
  });

/**
 * يزامن الحالة المحلية مع الـGist ويعيد {action, state, gistId}:
 * create = أُنشئ Gist جديد، push = رُفعت المحلية، pull = جُلبت البعيدة، same = متطابقتان.
 */
export async function syncState(local, { token, gistId }, fetchFn = globalThis.fetch.bind(globalThis)) {
  if (!token) throw new SyncError('أدخل الرمز أولًا.');
  const id = gistId || (await findGist(fetchFn, token));
  if (!id) {
    const gist = await api(fetchFn, token, '/gists', {
      method: 'POST',
      body: JSON.stringify({
        description: 'حصون الحفظ: بيانات المزامنة (لا تحذفه)',
        public: false,
        files: { [GIST_FILE]: { content: serialize(local) } },
      }),
    });
    return { action: 'create', state: local, gistId: gist.id };
  }

  let content;
  try {
    content = await readGist(fetchFn, token, id);
  } catch (err) {
    // حُذف الـGist المحفوظ: ابحث من جديد أو أنشئ واحدًا
    if (err.status === 404 && gistId) return syncState(local, { token, gistId: '' }, fetchFn);
    throw err;
  }

  let remote = null;
  if (content) {
    try {
      remote = normalize(JSON.parse(content));
    } catch {
      throw new SyncError('محتوى الـGist تالف، فلم يُغيَّر شيء.');
    }
  }
  if (remote && remote.updatedAt > local.updatedAt) return { action: 'pull', state: remote, gistId: id };
  if (!remote || local.updatedAt > remote.updatedAt) {
    await writeGist(fetchFn, token, id, local);
    return { action: 'push', state: local, gistId: id };
  }
  return { action: 'same', state: local, gistId: id };
}

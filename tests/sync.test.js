import test from 'node:test';
import assert from 'node:assert/strict';
import { GIST_FILE, syncState } from '../js/sync.js';

const state = (updatedAt, pages = {}) => ({
  v: 1,
  updatedAt,
  settings: {
    startDate: '2026-10-10',
    startPage: 34,
    endPage: 602,
    endConfirmed: true,
    ppd: 2,
    near: 40,
    chunk: 40,
    readStart: 52,
    readPerDay: 4,
    totalDays: 300,
  },
  pages,
  days: {},
});

/** خادم Gist وهمي يسجّل الطلبات. */
function fakeGitHub({ gists = {}, token = 'good' } = {}) {
  const calls = [];
  let next = 1;
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const path = url.replace('https://api.github.com', '');
    calls.push(`${method} ${path}`);
    if (opts.headers?.Authorization !== `Bearer ${token}`) return json(401, {});
    const view = (id) => ({ id, files: { [GIST_FILE]: { content: gists[id], truncated: false } } });
    if (method === 'GET' && path.startsWith('/gists?')) return json(200, Object.keys(gists).map(view));
    if (method === 'POST' && path === '/gists') {
      const body = JSON.parse(opts.body);
      assert.equal(body.public, false);
      const id = `g${next++}`;
      gists[id] = body.files[GIST_FILE].content;
      return json(201, view(id));
    }
    const m = path.match(/^\/gists\/(\w+)$/);
    if (m && !(m[1] in gists)) return json(404, {});
    if (m && method === 'GET') return json(200, view(m[1]));
    if (m && method === 'PATCH') {
      gists[m[1]] = JSON.parse(opts.body).files[GIST_FILE].content;
      return json(200, view(m[1]));
    }
    return json(500, {});
  };
  return { fetch, calls, gists };
}

test('المزامنة الأولى بلا Gist: يُنشأ Gist خاص بالبيانات المحلية', async () => {
  const gh = fakeGitHub();
  const res = await syncState(state(100), { token: 'good', gistId: '' }, gh.fetch);
  assert.equal(res.action, 'create');
  assert.equal(res.gistId, 'g1');
  assert.equal(JSON.parse(gh.gists.g1).updatedAt, 100);
});

test('جهاز جديد يجد الـGist الموجود ويجلب الأحدث', async () => {
  const gh = fakeGitHub({ gists: { abc: JSON.stringify(state(500, { 34: { d: '2026-10-10', t: 'm' } })) } });
  const res = await syncState(state(0), { token: 'good', gistId: '' }, gh.fetch);
  assert.equal(res.action, 'pull');
  assert.equal(res.gistId, 'abc');
  assert.equal(res.state.updatedAt, 500);
  assert.deepEqual(res.state.pages[34], { d: '2026-10-10', t: 'm' });
});

test('المحلية أحدث: تُرفع إلى الـGist', async () => {
  const gh = fakeGitHub({ gists: { abc: JSON.stringify(state(500)) } });
  const res = await syncState(state(900), { token: 'good', gistId: 'abc' }, gh.fetch);
  assert.equal(res.action, 'push');
  assert.equal(JSON.parse(gh.gists.abc).updatedAt, 900);
  assert.ok(gh.calls.includes('PATCH /gists/abc'));
});

test('متطابقتان: لا كتابة', async () => {
  const gh = fakeGitHub({ gists: { abc: JSON.stringify(state(500)) } });
  const res = await syncState(state(500), { token: 'good', gistId: 'abc' }, gh.fetch);
  assert.equal(res.action, 'same');
  assert.ok(!gh.calls.some((c) => c.startsWith('PATCH')));
});

test('الـGist المحفوظ حُذف: يُبحث من جديد ثم يُنشأ', async () => {
  const gh = fakeGitHub();
  const res = await syncState(state(100), { token: 'good', gistId: 'gone' }, gh.fetch);
  assert.equal(res.action, 'create');
});

test('رمز خاطئ: رسالة واضحة ولا تغيير', async () => {
  const gh = fakeGitHub({ gists: { abc: JSON.stringify(state(500)) } });
  await assert.rejects(syncState(state(900), { token: 'bad', gistId: 'abc' }, gh.fetch), /الرمز غير صالح/);
  assert.equal(JSON.parse(gh.gists.abc).updatedAt, 500);
});

test('محتوى تالف في الـGist: خطأ ولا كتابة فوقه', async () => {
  const gh = fakeGitHub({ gists: { abc: 'not json' } });
  await assert.rejects(syncState(state(900), { token: 'good', gistId: 'abc' }, gh.fetch), /تالف/);
  assert.equal(gh.gists.abc, 'not json');
});

test('انقطاع الشبكة: رسالة اتصال', async () => {
  const offline = async () => {
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(syncState(state(1), { token: 'good', gistId: 'abc' }, offline), /تعذّر الاتصال/);
});

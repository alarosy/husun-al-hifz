import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  dayInfo,
  diffDays,
  farForDay,
  farPipes,
  memorizedBefore,
  projection,
  readingFor,
  streak,
  toRanges,
  unhandled,
  weekday,
  checkpointPages,
} from '../js/engine.js';

const SETTINGS = {
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
};

const make = (settings = {}, pages = {}, days = {}) => ({
  v: 1,
  updatedAt: 0,
  settings: { ...SETTINGS, ...settings },
  pages,
  days,
});

// النسخة الاحتياطية الفعلية (11 أكتوبر 2026)
const backup = () =>
  make(
    {},
    {
      34: { d: '2026-10-10', t: 'm' },
      35: { d: '2026-10-10', t: 's' },
      36: { d: '2026-10-10', t: 'm' },
    },
    { '2026-10-10': { c: { near: true, qabli: true }, r: 1 } },
  );

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

test('أسبوع البرنامج يبدأ السبت', () => {
  assert.equal(weekday('2026-10-10'), 0); // السبت
  assert.equal(weekday('2026-10-11'), 1); // الأحد
  assert.equal(weekday('2026-10-16'), 6); // الجمعة
  assert.equal(weekday('2026-10-17'), 0);
  assert.equal(diffDays('2026-10-10', '2027-08-05'), 299);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('الورد يتجاوز الصفحة المتخطّاة: 34 m و35 s و36 m ⇒ quota = 0', () => {
  const info = dayInfo(backup(), '2026-10-10');
  assert.equal(info.quota, 0);
  assert.deepEqual(info.upcoming, []);
  assert.deepEqual(info.wird, [34, 35, 36]);
  assert.equal(info.wirdDone, true);
  assert.equal(info.coreDone, true);
});

test('المتخطّاة لا تُحسب من الورد فتأتي التالية مكانها', () => {
  const s = make({}, { 34: { d: '2026-10-10', t: 's' } });
  const info = dayInfo(s, '2026-10-10');
  assert.equal(info.quota, 2);
  assert.deepEqual(info.upcoming, [35, 36]);
});

test('يوم التثبيت: لا ورد، والغد يبدأ من أول صفحة لم تُعالج', () => {
  const s = backup();
  s.days['2026-10-11'] = { mode: 'review' };
  const info = dayInfo(s, '2026-10-11');
  assert.equal(info.quota, 0);
  assert.deepEqual(info.upcoming, []);
  assert.deepEqual(info.tomorrow, [37, 38]);
  assert.equal(info.tasks.some((t) => t.id === 'hifz'), false);
  assert.equal(info.coreDone, false); // القريب لم يُعلَّم بعد
});

test('معايير القبول: يوم 2026-10-11 بعد استيراد النسخة', () => {
  const info = dayInfo(backup(), '2026-10-11');
  assert.equal(info.dayNo, 2);
  assert.deepEqual(info.upcoming, [37, 38]);
  assert.deepEqual(info.near, range(1, 36));
  assert.equal(info.reading.from, 53);
  assert.equal(info.reading.to, 56);
  assert.deepEqual(info.tomorrow, [39, 40]);
  assert.equal(info.far, null);
});

test('نافذة القريب = آخر 40 صفحة وتشمل الصفحات 1–33', () => {
  const s = backup();
  assert.deepEqual(memorizedBefore(s, '2026-10-11'), range(1, 36));
  assert.deepEqual(memorizedBefore(s, '2026-10-10'), range(1, 33));
  assert.deepEqual(dayInfo(s, '2026-10-10').near, range(1, 33));

  const pages = {};
  for (let p = 34; p <= 100; p++) pages[p] = { d: '2026-10-10', t: 'm' };
  const info = dayInfo(make({}, pages), '2026-10-20');
  assert.deepEqual(info.near, range(61, 100));
  assert.equal(info.near.length, 40);
});

test('التحضير الأسبوعي: يتخطّى بقية الأسبوع ثم يأخذ 7 × ppd', () => {
  // الأحد: اليوم 37–38، ثم 5 أيام × 2 = 39–48، ثم الأسبوع القادم 49–62
  assert.deepEqual(dayInfo(backup(), '2026-10-11').nextWeek, range(49, 62));
  // السبت (يوم البداية): اليوم 34–35، ثم 6 × 2 = 36–47، ثم 48–61
  assert.deepEqual(dayInfo(make(), '2026-10-10').nextWeek, range(48, 61));
});

test('الأنابيب ≤ 7: أنبوب اليوم = يوم الأسبوع، ولا مراجعة إن لم يتكوّن', () => {
  // المحفوظ 1–149: القريب 110–149، والبعيد 1–109 ⇒ 3 أنابيب
  const s = make({ startPage: 150 });
  const sat = dayInfo(s, '2026-10-10');
  assert.deepEqual(sat.near, range(110, 149));
  assert.equal(sat.far.count, 3);
  assert.equal(sat.far.index, 0);
  assert.deepEqual(sat.far.pages, range(1, 40));

  const mon = dayInfo(s, '2026-10-12'); // الاثنين = 2
  assert.equal(mon.far.index, 2);
  assert.deepEqual(mon.far.pages, range(81, 109));

  assert.equal(dayInfo(s, '2026-10-13').far, null); // الثلاثاء = 3: لا أنبوب
});

test('الأنابيب > 7: أنبوب واحد يوميًا بالتناوب (dayIndex mod العدد)', () => {
  // المحفوظ 1–400: البعيد 1–360 ⇒ 9 أنابيب
  const s = make({ startPage: 401 });
  const d1 = dayInfo(s, '2026-10-10'); // اليوم 1 ⇒ index 0
  assert.equal(d1.far.count, 9);
  assert.equal(d1.far.index, 0);
  assert.equal(dayInfo(s, addDays('2026-10-10', 8)).far.index, 8); // اليوم 9
  assert.equal(dayInfo(s, addDays('2026-10-10', 9)).far.index, 0); // اليوم 10
  const d12 = dayInfo(s, addDays('2026-10-10', 11)); // اليوم 12 ⇒ 11 mod 9 = 2
  assert.equal(d12.far.index, 2);
  assert.deepEqual(d12.far.pages, range(81, 120));
});

test('تقسيم الأنابيب واختيارها مباشرة', () => {
  const pipes = farPipes(range(1, 85), 40);
  assert.deepEqual(pipes.map((p) => [p[0], p[p.length - 1]]), [[1, 40], [41, 80], [81, 85]]);
  assert.equal(farForDay(pipes, 5, 0), null);
  assert.equal(farForDay([], 0, 0), null);
});

test('تقدّم حزب القراءة المستمرة', () => {
  const s = make({}, {}, {
    '2026-10-10': { r: 1 },
    '2026-10-11': { r: 4 },
    '2026-10-12': { r: 0 },
  });
  assert.equal(readingFor(s, '2026-10-10').from, 52);
  assert.equal(readingFor(s, '2026-10-11').from, 53);
  assert.equal(readingFor(s, '2026-10-12').from, 57);
  assert.equal(readingFor(s, '2026-10-13').from, 57);
  const r = readingFor(s, '2026-10-11');
  assert.deepEqual(r.list, [53, 54, 55, 56]);
  assert.equal(r.juzFrom, 27);
  assert.equal(r.juzTo, 28);
  assert.equal(r.r, 4);
});

test('تدوير حزب القراءة بعد الحزب 60', () => {
  const s = make({ readStart: 58 }, {}, { '2026-10-10': { r: 1 } });
  const r = readingFor(s, '2026-10-11'); // يبدأ 59
  assert.deepEqual(r.list, [59, 60, 1, 2]);
  assert.equal(r.from, 59);
  assert.equal(r.to, 2);
  assert.equal(r.juzFrom, 30);
  assert.equal(r.juzTo, 1);

  const s2 = make({ readStart: 58 }, {}, { '2026-10-10': { r: 8 } });
  assert.equal(readingFor(s2, '2026-10-11').from, 6); // 58 + 8 = 66 ⇒ 6
});

test('الختم المتوقع والهامش', () => {
  // 566 صفحة متبقية ÷ 2 = 283 يومًا، تبدأ اليوم (الورد لم يُنجز) ⇒ الختم اليوم 284
  const p = projection(backup(), '2026-10-11');
  assert.equal(p.remaining, 566);
  assert.equal(p.daysNeeded, 283);
  assert.equal(p.finishDate, '2027-07-20');
  assert.equal(p.finishDayNo, 284);
  assert.equal(p.margin, 16);

  // بعد إنجاز ورد اليوم يبدأ العدّ من الغد، والنتيجة نفسها
  const s = backup();
  s.pages[37] = { d: '2026-10-11', t: 'm' };
  s.pages[38] = { d: '2026-10-11', t: 'm' };
  const p2 = projection(s, '2026-10-11');
  assert.equal(p2.remaining, 564);
  assert.equal(p2.finishDayNo, 284);
  assert.equal(p2.margin, 16);

  // الهامش لا ينقص بإنجاز صفحة من ورد اليوم
  const s5 = backup();
  s5.pages[37] = { d: '2026-10-11', t: 'm' };
  assert.equal(projection(s5, '2026-10-11').finishDayNo, 284);
  s5.pages[38] = { d: '2026-10-11', t: 's' }; // تُخطّيت ⇒ 39 من ورد اليوم
  assert.equal(projection(s5, '2026-10-11').finishDayNo, 284);
  s5.pages[39] = { d: '2026-10-11', t: 'm' };
  assert.equal(projection(s5, '2026-10-11').finishDayNo, 284);

  // يوم التثبيت لا ينجز شيئًا اليوم
  const s6 = backup();
  s6.days['2026-10-11'] = { mode: 'review' };
  assert.equal(projection(s6, '2026-10-11').finishDayNo, 285);

  // هامش سالب
  const s3 = backup();
  s3.settings.totalDays = 200;
  assert.equal(projection(s3, '2026-10-11').margin, -84);

  // عدد فردي من الصفحات: ceil
  const s4 = make({ endPage: 38 });
  const p4 = projection(s4, '2026-10-10');
  assert.equal(p4.daysNeeded, 3);
  assert.equal(p4.finishDayNo, 3);
});

test('unhandled يستثني كل صفحة لها سجل', () => {
  const list = unhandled(backup());
  assert.equal(list[0], 37);
  assert.equal(list.length, 566);
});

test('نقطة التفتيش: كل 60 يومًا، 5 صفحات ثابتة البذرة', () => {
  const s = make({ startPage: 100 });
  const d60 = addDays('2026-10-10', 59);
  const info = dayInfo(s, d60);
  assert.ok(info.checkpoint);
  assert.equal(info.checkpoint.pages.length, 5);
  assert.equal(new Set(info.checkpoint.pages).size, 5);
  assert.ok(info.checkpoint.pages.every((p) => p >= 1 && p <= 99));
  assert.deepEqual(checkpointPages(range(1, 99), 60), info.checkpoint.pages);
  assert.equal(dayInfo(s, addDays(d60, 1)).checkpoint, null);
  // لا تفتيش إن لم تزد المحفوظات على 20
  assert.equal(dayInfo(make({ startPage: 10 }), d60).checkpoint, null);
});

test('الأيام المتتالية حسب coreDone', () => {
  const s = backup(); // اليوم الأول مكتمل الأساس
  assert.equal(streak(s, '2026-10-11'), 1); // اليوم الجاري لم يكتمل ولا يكسر السلسلة
  s.pages[37] = { d: '2026-10-11', t: 'm' };
  s.pages[38] = { d: '2026-10-11', t: 'm' };
  s.days['2026-10-11'] = { c: { near: true } };
  assert.equal(streak(s, '2026-10-11'), 2);
  assert.equal(streak(s, '2026-10-13'), 0); // يوم 12 فائت
});

test('toRanges يضغط الصفحات المتصلة', () => {
  assert.deepEqual(toRanges([36, 34, 35, 40]), [[34, 36], [40, 40]]);
  assert.deepEqual(toRanges([]), []);
});

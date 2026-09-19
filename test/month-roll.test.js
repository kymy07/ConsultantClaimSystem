/* =======================================================================
   month-roll.test.js — a draft is kept while its month runs, and becomes
   next month's claim once that month is over.

   Run:  node test/month-roll.test.js
   ======================================================================= */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'assets/js/app.js'), 'utf8');
function extract (name) {
  const start = app.indexOf('function ' + name + ' (');
  assert.ok(start !== -1, name + ' is in app.js');
  return app.slice(start, app.indexOf('\n}', start) + 2);
}

/** a fresh app on a given day, with the answer the confirm box will get */
function appOn (iso, answer) {
  const Real = Date;
  class FixedDate extends Real {
    constructor (...a) { super(...(a.length ? a : [iso + 'T09:00:00'])); }
    static now () { return new Real(iso + 'T09:00:00').getTime(); }
  }
  const ctx = vm.createContext({ console, Date: FixedDate });
  ctx.asked = 0;
  ctx.confirm = () => { ctx.asked++; return answer; };
  ctx.toast = () => {};
  ctx.persist = () => {};
  ['assets/js/state.js', 'assets/js/holidays.js', 'assets/js/timesheet.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  vm.runInContext(extract('rollToThisMonth'), ctx);
  return ctx;
}

/** a September 2026 draft somebody has been working on */
const SEPT = `
  var S = defaultState();
  S.timesheet.year = 2026; S.timesheet.month = 8;
  S.timesheet.activities[0].name = 'GIS mapping';
  autoFillMonth(S);
  S.timesheet.activities[0].days[3] = 'PTO';
  S.timesheet.autoFilled = false;
  S.invoice.pStart = '2026-09-01'; S.invoice.pEnd = '2026-09-30';
  S.invoice.override = 9999;
  S.invoice.items = [{ desc: 'Fee', amount: 1 }, { desc: 'Travel', amount: 2 }];
  S.consultant.name = 'Test Person'; S.invoice.monthlyRate = 8000;
`;
const run = (ctx, expr) => vm.runInContext(expr, ctx);

// Still September: nothing moves, the half-done sheet is exactly as left.
{
  const ctx = appOn('2026-09-25', false);
  run(ctx, SEPT);
  assert.equal(run(ctx, 'rollToThisMonth()'), false);
  assert.equal(run(ctx, 'S.timesheet.month'), 8);
  assert.equal(run(ctx, 'S.timesheet.activities[0].days[3]'), 'PTO');
  assert.equal(ctx.asked, 0);
  console.log('  ok    a draft is kept as it was while its month runs');
}

// October, September already sent: it moves without asking.
{
  const ctx = appOn('2026-10-02', true);
  run(ctx, SEPT + `S.consultant.claimNos = { '2026-09': 4 };`);
  assert.equal(run(ctx, 'rollToThisMonth()'), true);
  assert.equal(ctx.asked, 0);
  assert.equal(run(ctx, 'S.timesheet.month'), 9);
  assert.equal(run(ctx, 'S.timesheet.year'), 2026);
  // October's own calendar: 3 and 4 Oct 2026 are Sat and Sun, the 1st a Thursday
  assert.equal(run(ctx, 'S.timesheet.activities[0].days[3]'), undefined);
  assert.equal(run(ctx, 'S.timesheet.activities[0].days[4]'), undefined);
  assert.equal(run(ctx, 'S.timesheet.activities[0].days[1]'), '/');
  assert.equal(run(ctx, 'S.timesheet.autoFilled'), true);
  // the person and the activity stay; September's own figures go
  assert.equal(run(ctx, 'S.timesheet.activities[0].name'), 'GIS mapping');
  assert.equal(run(ctx, 'S.consultant.name'), 'Test Person');
  assert.equal(run(ctx, 'S.invoice.monthlyRate'), 8000);
  // the invoice follows the sheet
  assert.equal(run(ctx, 'S.invoice.pStart'), '2026-10-01');
  assert.equal(run(ctx, 'S.invoice.pEnd'), '2026-10-31');
  assert.equal(run(ctx, 'S.invoice.override'), null);
  assert.equal(run(ctx, 'S.invoice.items.length'), 1);
  assert.equal(run(ctx, 'S.consultant.assignPeriod'), 'Oct-26');
  console.log('  ok    a sent month becomes next month, from next month\'s calendar');
}

// October, September worked on but never sent: asked, and kept if wanted.
{
  const ctx = appOn('2026-10-02', true);
  run(ctx, SEPT);
  assert.equal(run(ctx, 'rollToThisMonth()'), false);
  assert.equal(ctx.asked, 1);
  assert.equal(run(ctx, 'S.timesheet.month'), 8);
  assert.equal(run(ctx, 'S.timesheet.activities[0].days[3]'), 'PTO');
  // and not asked again this month
  assert.equal(run(ctx, 'rollToThisMonth()'), false);
  assert.equal(ctx.asked, 1);
  console.log('  ok    an unsent month is kept when the person says so, and not asked twice');
}

// ...or started afresh when they say so.
{
  const ctx = appOn('2026-10-02', false);
  run(ctx, SEPT);
  assert.equal(run(ctx, 'rollToThisMonth()'), true);
  assert.equal(run(ctx, 'S.timesheet.month'), 9);
  console.log('  ok    or moved on when they would rather start the new month');
}

// A sheet nobody touched moves across a year without asking.
{
  const ctx = appOn('2027-01-05', true);
  run(ctx, `var S = defaultState(); S.timesheet.year = 2026; S.timesheet.month = 11; autoFillMonth(S);`);
  assert.equal(run(ctx, 'rollToThisMonth()'), true);
  assert.equal(ctx.asked, 0);
  assert.equal(run(ctx, 'S.timesheet.year'), 2027);
  assert.equal(run(ctx, 'S.timesheet.month'), 0);
  console.log('  ok    an untouched sheet moves over the new year without asking');
}

// The month is moved when the app opens, when a profile is opened, and
// when a draft from another device is taken.
assert.match(app, /rollToThisMonth\(\);\s*fillDefaultsForMonth\(\);\s*writeBindings\(\);/);
assert.match(app, /the app is opened cold\. \*\/\s*rollToThisMonth\(\);/);
assert.match(app, /S = adopted;\s*rollToThisMonth\(\);/);
console.log('  ok    and it happens on open, on a profile, and on a synced draft');

console.log('All tests passed.');

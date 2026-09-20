/* =======================================================================
   paid-days.test.js — which days of a month are paid, and what that makes
   the invoice come to.

   Run:  node test/paid-days.test.js
   ======================================================================= */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({ console });
['assets/js/state.js', 'assets/js/holidays.js', 'assets/js/timesheet.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
const run = expr => vm.runInContext(expr, ctx);

/* September 2026: 30 days, 8 of them Saturdays and Sundays (5, 6, 12, 13,
   19, 20, 26, 27), and Malaysia Day on the 16th. */
const SEPT = `
  var S = defaultState();
  S.timesheet.year = 2026; S.timesheet.month = 8;
  S.invoice.monthlyRate = 10000;
  var a = S.timesheet.activities[0];
`;

// A whole month worked is a whole month paid.
run(SEPT + 'autoFillMonth(S);');
assert.equal(run('timesheetTotals(S.timesheet).A'), 30);
assert.equal(run('computeAmount(S).amount'), 10000);
console.log('  ok    a full month is 30 of 30 days, at the full rate');

/* Somebody who starts on the 14th dashes every day before it. A dash is a
   day they were not here for, weekend or not: 14-30 September is 17 days. */
run(SEPT + `
  for (var d = 1; d < 14; d++) a.days[d] = '-';
  [14,15,17,18,21,22,23,24,25,28,29,30].forEach(function (d) { a.days[d] = '/'; });
  a.days[16] = 'PH';
`);
assert.equal(run('timesheetTotals(S.timesheet).A'), 17, 'the 14th to the 30th');
assert.equal(run('workedDays(S.timesheet)'), 12, 'the days actually worked');
assert.equal(run('computeAmount(S).amount'), 5666.67, '17/30 of the rate');
assert.match(run('computeAmount(S).formula'), /13 unpaid days ÷ 30 days/);
console.log('  ok    a mid-month start is paid from the day it starts, weekends included');

// The same day worked on another row is still worked: a mark beats a dash.
run(SEPT + `
  autoFillMonth(S);
  S.timesheet.activities.push(newActivity('Second project'));
  a.days[12] = '-';                                  // Saturday, dashed here
  S.timesheet.activities[1].days[12] = '/';          // but worked there
`);
assert.equal(run('timesheetTotals(S.timesheet).A'), 30);
console.log('  ok    a day worked on any row is paid, whatever another row says');

// A dashed weekend is not counted against the first row's printed total
// either, or the rows would not add up to the sheet's own TOTAL.
run(SEPT + `
  autoFillMonth(S);
  [5, 6].forEach(function (d) { a.days[d] = '-'; });
`);
assert.equal(run('timesheetTotals(S.timesheet).A'), 28);
assert.equal(run('rowPaidDays(S.timesheet, 0)'), 28, 'the printed row matches the total');
console.log('  ok    and the printed row adds up to the same total');

console.log('All tests passed.');

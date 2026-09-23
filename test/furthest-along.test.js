/* =======================================================================
   furthest-along.test.js — a month with the same document in it twice
   reads the same way on every screen.

   Anir's invoice was approved, and a second copy of it was still sitting
   with the project manager. The status table took the first row the list
   returned and the payment advice page took the last, so one screen said
   approved and the other said "with the project manager" — and the advice
   that was ready stayed locked.

   Run:  node test/furthest-along.test.js
   ======================================================================= */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const ROOT = path.join(__dirname, '..');
const signing = fs.readFileSync(path.join(ROOT, 'assets/js/signing.js'), 'utf8');
const approvals = fs.readFileSync(path.join(ROOT, 'assets/js/approvals.js'), 'utf8');
function extract (src, name) {
  const start = src.indexOf('function ' + name + ' (');
  assert.ok(start !== -1, name + ' is there');
  return src.slice(start, src.indexOf('\n}', start) + 2);
}

const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/state.js'), 'utf8'), ctx,
                { filename: 'state.js' });
vm.runInContext(`
  function kindOf (s) { return s.kind; }
  var signingSubs = [], subs = [];
  ${extract(signing, 'monthInvoice')}
  ${extract(signing, 'adviceFor')}
  ${extract(signing, 'adviceUnlocked')}
  ${extract(approvals, 'submissionFor')}
`, ctx);
const run = expr => vm.runInContext(expr, ctx);

/* Anir's September: the invoice the HOD approved, and a second copy of it
   left behind with the project manager. The list returns them in that
   order on one screen and the other way round on another. */
const ANIR = `
  var approved = { id: 'a', kind: 'invoice', consultant: 'Anir Syazwan bin Sharbirin',
                   period_year: 2026, period_month: 9, status: 'complete',
                   invoice_no: '2026-06-001', updated_at: '2026-09-20T02:00:00Z' };
  var stuck    = { id: 'b', kind: 'invoice', consultant: 'Anir Syazwan bin Sharbirin',
                   period_year: 2026, period_month: 9, status: 'pending_manager',
                   invoice_no: '2026-06-001', updated_at: '2026-09-22T02:00:00Z' };
`;

// Whichever order they arrive in, both screens read the approved one.
[['approved first', 'approved, stuck'], ['stuck first', 'stuck, approved']].forEach(([what, order]) => {
  run(ANIR + `signingSubs = [${order}]; subs = signingSubs;`);
  assert.equal(run("monthInvoice('Anir Syazwan bin Sharbirin', 2026, 9).id"), 'a', what);
  assert.equal(run("adviceUnlocked(monthInvoice('Anir Syazwan bin Sharbirin', 2026, 9))"), true, what);
  assert.equal(
    run("submissionFor('Anir Syazwan bin Sharbirin', { y: 2026, m: 8 }, 'invoice').id"), 'a', what);
});
console.log('  ok    an approved invoice is the month\'s invoice, whatever else is lying about');

// The order of the stages, and the newest when two are level.
run(`
  signingSubs = [];
  var rank = ['returned', 'pending_manager', 'pending_boss', 'pending_signature', 'complete']
    .map(function (s) { return submissionRank({ status: s }); });
`);
// (the array is the sandbox's own, so it is compared as text)
assert.equal(run('rank.join()'), '1,2,3,4,5');
assert.equal(run("submissionRank({ status: 'something else' })"), 0);
assert.equal(run(`furthestAlong([
  { id: 'old', status: 'complete', updated_at: '2026-09-01T00:00:00Z' },
  { id: 'new', status: 'complete', updated_at: '2026-09-09T00:00:00Z' }]).id`), 'new');
assert.equal(run('furthestAlong([])'), null);
assert.equal(run('furthestAlong(undefined)'), null);
console.log('  ok    the furthest along wins, and the newest of two that are level');

// An advice that exists twice is read the same way.
run(ANIR + `
  signingSubs = [approved,
    { id: 'c', kind: 'advice', consultant: 'Anir Syazwan bin Sharbirin',
      period_year: 2026, period_month: 9, status: 'pending_manager' },
    { id: 'd', kind: 'advice', consultant: 'Anir Syazwan bin Sharbirin',
      period_year: 2026, period_month: 9, status: 'complete' }];
`);
assert.equal(run('adviceFor(approved).id'), 'd');
console.log('  ok    and the same holds for a payment advice');

// Nobody else's month is touched.
run(`signingSubs = [{ id: 'x', kind: 'invoice', consultant: 'Somebody Else',
                      period_year: 2026, period_month: 9, status: 'complete' }];`);
assert.equal(run("monthInvoice('Anir Syazwan bin Sharbirin', 2026, 9)"), null);
console.log('  ok    and one person\'s invoice is never another\'s');

// The tables pick the same way when they draw a row per person.
assert.match(signing, /byName\.set\(who, furthestAlong\(\[byName\.get\(who\), sub\]\.filter\(Boolean\)\)\)/);
console.log('  ok    the month tables draw the row from the same copy');

console.log('All tests passed.');

/* =======================================================================
   close-complete.test.js — Submit closes each month whose own copies are
   in, and leaves the rest open.

   Run:  node test/close-complete.test.js
   ======================================================================= */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'assets/js/signing.js'), 'utf8');
function extract (name) {
  const start = src.indexOf('function ' + name + ' (');
  assert.ok(start !== -1, name + ' is in signing.js');
  return src.slice(start, src.indexOf('\n}', start) + 2);
}

/* Two people's September. Adlishah's time sheet and advice are both on file;
   Anir's advice is not. Nizar's advice has no box yet — the HOD has not
   approved his invoice — so it cannot be on file either. */
const filed = new Set(['Adlishah|claim', 'Adlishah|advice', 'Anir|claim', 'Nizar|claim']);
const ctx = vm.createContext({
  attached: new Map(),
  uploadTarget: (r, kind) =>
    (r.consultant === 'Nizar' && kind === 'advice') ? null : { key: r.consultant + ':' + kind },
  archiveFor: (who, y, m, kind) => filed.has(who + '|' + kind) ? { id: who + kind } : null
});
vm.runInContext(extract('completeRows'), ctx);
vm.runInContext(src.match(/const wasReopened = .*;/)[0], ctx);
const month = who => ({ consultant: who, period_year: 2026, period_month: 9 });
const names = rows => ctx.completeRows(rows).map(r => r.consultant).join(',');
// a `const` in the sandbox is not a property of it, so it is asked for there
const reopened = sub => vm.runInContext('wasReopened(' + JSON.stringify(sub) + ')', ctx);

assert.equal(names([month('Adlishah'), month('Anir'), month('Nizar')]), 'Adlishah');
console.log('  ok    a month with all of its own copies in can close while the others wait');

// a scan on its way up counts as in
ctx.attached.set('Anir:advice', { name: 'advice.pdf' });
assert.equal(names([month('Adlishah'), month('Anir')]), 'Adlishah,Anir');
ctx.attached.clear();
console.log('  ok    a copy being uploaded counts as in');

// an advice with no box yet is not "nothing owed" — the month is not complete
assert.equal(names([month('Nizar')]), '');
console.log('  ok    a month whose advice cannot be filed yet does not close');

// Resubmit is said for a month that was reopened
assert.equal(reopened({ history: [{ action: 'approve' }, { action: 'reopen' }] }), true);
assert.equal(reopened({ history: [{ action: 'approve' }] }), false);
assert.equal(reopened({}), false);
console.log('  ok    and a reopened month is told apart, for the Resubmit label');

console.log('All tests passed.');

/* =======================================================================
   resubmit-owner.test.js — a returned document is sent again by the person
   who sent it. Everybody else reads it.

   Run:  node test/resubmit-owner.test.js
   ======================================================================= */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'assets/js/resubmit.js'), 'utf8');
const approvals = fs.readFileSync(path.join(ROOT, 'assets/js/approvals.js'), 'utf8');
function extract (name) {
  const start = src.indexOf('function ' + name + ' (');
  assert.ok(start !== -1, name + ' is in resubmit.js');
  return src.slice(start, src.indexOf('\n}', start) + 2);
}

let admin = false;
const ctx = vm.createContext({
  Auth: { isAdmin: () => admin },
  myEmail: () => 'tajul@uzmagroup.com'
});
['ownedByMe', 'canFix', 'whoseToFix', 'mineToFix'].forEach(n => vm.runInContext(extract(n), ctx));
const mine = { created_by: 'Tajul@uzmagroup.com', consultant: 'Mohd Tajul Azuar bin Ahmad Sharby' };
const theirs = { created_by: 'nizar@uzmagroup.com', consultant: 'Syed Nizar bin Syed Tarmizi' };

assert.equal(ctx.ownedByMe(mine), true, 'the address is the same whatever its case');
assert.equal(ctx.ownedByMe(theirs), false);
console.log('  ok    a returned document belongs to the account that sent it');

// A consultant fixes their own, and nobody else's.
assert.equal(ctx.canFix(mine), true);
assert.equal(ctx.canFix(theirs), false);

// The administrator stands in at any stage, and is told whose it is.
admin = true;
assert.equal(ctx.mineToFix(theirs), true, 'listed for the administrator');
assert.equal(ctx.canFix(theirs), true, 'and theirs to fix and send again');
assert.equal(ctx.ownedByMe(theirs), false, 'while still not their own document');
assert.equal(ctx.whoseToFix(theirs), 'Syed Nizar bin Syed Tarmizi');
console.log('  ok    a consultant fixes only their own; the administrator stands in');

// The card offers Resubmit to those two, and says who it waits on otherwise.
assert.match(src, /const mine = canFix\(sub\);/);
assert.match(src, /if \(!open && mine\) bar\.appendChild\(button\('Open and fix'/);
assert.match(src, /if \(mine\) \{[\s\S]{0,400}const send = button\(behalf/);
assert.match(src, /Waiting on \$\{whoseToFix\(sub\)\} to fix and send it again/);
// standing in says so on the button, so nobody sends one by accident
assert.match(src, /const behalf = !ownedByMe\(sub\);/);
assert.match(src, /Resubmit for \$\{whoseToFix\(sub\)\}/);
assert.match(src, /Sent again on behalf of \$\{whoseToFix\(sub\)\}/);
// ...and the status table offers it to the same two accounts
assert.match(approvals, /=== myEmail\(\) \|\| Auth\.isAdmin\(\)\)\) \{[\s\S]{0,200}button\('Resubmit'/);
console.log('  ok    the button names whose document it sends, and only where it can work');

// A refusal is said in words, not as a status code.
assert.match(src, /err\.status === 403[\s\S]{0,400}can send this one again/);
assert.match(src, /acts_on|act at any stage there/, 'and tells the admin where the rule lives');
// opening a returned document never lands on top of an unsaved month
assert.match(src, /if \(S && S\.unsaved\) return false;/);
assert.match(src, /err\.status === 409[\s\S]{0,160}already moved on/);
console.log('  ok    a refusal says what happened and reloads the list');

console.log('All tests passed.');

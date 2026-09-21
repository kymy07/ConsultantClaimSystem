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
['ownedByMe', 'whoseToFix', 'mineToFix'].forEach(n => vm.runInContext(extract(n), ctx));
const mine = { created_by: 'Tajul@uzmagroup.com', consultant: 'Mohd Tajul Azuar bin Ahmad Sharby' };
const theirs = { created_by: 'nizar@uzmagroup.com', consultant: 'Syed Nizar bin Syed Tarmizi' };

assert.equal(ctx.ownedByMe(mine), true, 'the address is the same whatever its case');
assert.equal(ctx.ownedByMe(theirs), false);
console.log('  ok    a returned document belongs to the account that sent it');

// The administrator sees everything that came back, and owns only their own.
admin = true;
assert.equal(ctx.mineToFix(theirs), true, 'still listed for the administrator');
assert.equal(ctx.ownedByMe(theirs), false, 'but not theirs to send again');
assert.equal(ctx.whoseToFix(theirs), 'Syed Nizar bin Syed Tarmizi');
console.log('  ok    the administrator reads somebody else\'s, and is told whose it is');

// The card offers Resubmit only to the owner, and says who it waits on.
assert.match(src, /const mine = ownedByMe\(sub\);/);
assert.match(src, /if \(!open && mine\) bar\.appendChild\(button\('Open and fix'/);
assert.match(src, /if \(mine\) \{\s*const send = button\('Resubmit for approval'/);
assert.match(src, /Waiting on \$\{whoseToFix\(sub\)\} to fix and send it again/);
// ...and the status table's own Resubmit button follows the same rule
assert.match(approvals, /if \(String\(sub\.created_by \|\| ''\)\.toLowerCase\(\) === myEmail\(\)\) \{\s*acts\.appendChild\(button\('Resubmit'/);
console.log('  ok    and neither screen offers a button BDOS would refuse');

// A refusal is said in words, not as a status code.
assert.match(src, /err\.status === 403[\s\S]{0,200}can send this one again/);
assert.match(src, /err\.status === 409[\s\S]{0,160}already moved on/);
console.log('  ok    a refusal says what happened and reloads the list');

console.log('All tests passed.');

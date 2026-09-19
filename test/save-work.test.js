/* =======================================================================
   save-work.test.js — the claim form and the invoice are saved to the
   person by hand, and are not left until they are.

   Run:  node test/save-work.test.js
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
const line = re => { const m = app.match(re); assert.ok(m, String(re)); return m[0]; };

function fresh (answer) {
  const saved = {};
  const toasts = [];
  const ctx = vm.createContext({
    console,
    toasts, saved,
    confirm: () => answer,
    toast: (m, bad) => toasts.push({ m, bad }),
    persist: () => {}, renderNavRows: () => {}, showStep: () => {},
    refreshProfileList: () => {}, canLeave: () => true,
    clearProfileDirty: () => { ctx.profileDirty = false; },
    document: { getElementById: () => null, querySelector: () => null },
    Auth: { prepares: () => true, setsNumbering: () => true, email: () => 'a@b.c' },
    Store: { saveProfile: (name, S) => { saved[name] = JSON.parse(JSON.stringify(S)); return true; } },
    Sync: { pushProfile: () => {} }
  });
  vm.runInContext(`
    var S = { unsaved: false, consultant: { name: 'On The Form', email: 'x' } };
    var stepIndex = 2, profileDirty = false, activeProfile = 'On The Card';
    var INFO_STEPS = ['history'];
    var steps = [{ id: 'consultant' }, { id: 'choose' }, { id: 'claim' }, { id: 'invoice' }, { id: 'history' }];
    function activeSteps () { return steps; }
    ${line(/const WORK_STEPS = .*;/)}
    ${line(/const unsavedHere = .*;/)}
  `, ctx);
  ['onWorkStep', 'markWorkDirty', 'holdUnsaved', 'leaveUnsaved', 'goToStep', 'saveProfileNow']
    .forEach(n => vm.runInContext(extract(n), ctx));
  return ctx;
}
const run = (ctx, expr) => vm.runInContext(expr, ctx);

// An edit on the claim form is unsaved, and the form is not left with it.
{
  const ctx = fresh(false);
  run(ctx, 'markWorkDirty()');
  assert.equal(run(ctx, 'S.unsaved'), true);
  run(ctx, 'goToStep(3)');
  assert.equal(run(ctx, 'stepIndex'), 2, 'not on to the invoice');
  run(ctx, 'goToStep(0, true)');
  assert.equal(run(ctx, 'stepIndex'), 2, 'not back either');
  run(ctx, 'goToStep(4)');
  assert.equal(run(ctx, 'stepIndex'), 2, 'nor to a page you only read');
  assert.ok(ctx.toasts.some(t => t.bad && /Press Save first/.test(t.m)));
  console.log('  ok    an unsaved claim form is not left, in any direction');

  // Save files it under the card it was opened from, and then it can go.
  run(ctx, 'saveProfileNow()');
  assert.equal(run(ctx, 'S.unsaved'), false);
  assert.ok(ctx.saved['On The Card'], 'saved to the open profile');
  assert.equal(ctx.saved['On The Card'].unsaved, false);
  assert.equal(ctx.saved['On The Form'], undefined, 'not a second profile');
  run(ctx, 'goToStep(3)');
  assert.equal(run(ctx, 'stepIndex'), 3);
  console.log('  ok    Save files it to the person, and then the step can be left');
}

// Edits anywhere else are not claim-form work.
{
  const ctx = fresh(false);
  run(ctx, 'stepIndex = 0; markWorkDirty()');
  assert.equal(run(ctx, 'S.unsaved'), false);
  console.log('  ok    only the claim form and the invoice count as the month\'s work');
}

// Opening another profile with unsaved work: saved first, or not at all.
{
  const ctx = fresh(false);
  run(ctx, 'markWorkDirty()');
  assert.equal(run(ctx, 'leaveUnsaved()'), false, 'Cancel stays');
  assert.equal(Object.keys(ctx.saved).length, 0);
  const yes = fresh(true);
  run(yes, 'markWorkDirty()');
  assert.equal(run(yes, 'leaveUnsaved()'), true, 'OK saves and goes');
  assert.ok(yes.saved['On The Card']);
  console.log('  ok    switching profile saves the work first, or stays');
}

// Wired where it matters.
assert.match(app, /function editProfile \(name\) \{\s*if \(!Auth\.prepares\(\)\) return;\s*if \(name !== activeProfile && !leaveUnsaved\(\)\) return;/);
assert.match(app, /function newProfile \(\) \{\s*if \(!Auth\.prepares\(\)\) return;\s*if \(!leaveUnsaved\(\)\) return;/);
assert.match(app, /const afterTimesheetChange = \(\) => \{ markWorkDirty\(\);/);
assert.match(app, /row\.appendChild\(saveWorkButton\(\)\)/);
assert.match(fs.readFileSync(path.join(ROOT, 'assets/js/state.js'), 'utf8'), /unsaved: false,/);
console.log('  ok    and a changed day, a new profile and the nav row all use it');

console.log('All tests passed.');

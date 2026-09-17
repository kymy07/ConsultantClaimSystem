/* =======================================================================
   sync.test.js — the database sync, with zero npm dependencies.

   Loads state.js and sync.js into a Node VM behind a stub browser and a
   stub BDOS, and pins the behaviour the app depends on:

     · when the /ccs endpoints are not there, syncing switches itself off
       and the app is left exactly as it was
     · a draft is only adopted when doing so cannot lose work
     · profiles converge in both directions, and a deleted one stays deleted
     · a claim is recorded in the shape docs/BDOS-CCS-Endpoints.md promises

   No real network call is made.

   Run:  node test/sync.test.js
   ======================================================================= */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

let passed = 0;
const failures = [];

function check (label, actual, expected) {
  if (String(actual) === String(expected)) {
    passed++;
    console.log(`  ok    ${label} = ${actual}`);
  } else {
    failures.push(`${label}: got ${actual}, expected ${expected}`);
    console.log(`  FAIL  ${label}: got ${actual}, expected ${expected}`);
  }
}

/* ---------------- stub browser ---------------- */
const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};

/* ---------------- stub BDOS ---------------- */
let routes = {};                 // 'GET /ccs/draft' → { status, body }
const sent = [];                 // every request the app made

const fetch = async (url, opts) => {
  const method = (opts && opts.method) || 'GET';
  const p = String(url).replace('https://bdos.uzmadigitalearth.app', '');
  const body = opts && opts.body ? JSON.parse(opts.body) : null;
  sent.push({ method, path: p, body, auth: opts.headers.Authorization });

  const r = routes[`${method} ${p.split('?')[0]}`] || { status: 404, body: { detail: 'Not Found' } };
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    json: async () => r.body
  };
};

const ctx = vm.createContext({
  console, localStorage, fetch, JSON, Map, Set, Date, Number, String, Object, Array, Boolean,
  navigator: { onLine: true },
  // Timers fire straight away here, so the lazy draft push is testable
  // without the suite sitting through its five-second delay.
  setTimeout: fn => { fn(); return 0; },
  clearTimeout: () => {},
  confirm: () => { ctx.confirmCalls++; return ctx.confirmAnswer; },
  Auth: { token: () => 'stub-token', BASE: 'https://bdos.uzmadigitalearth.app' },
  confirmAnswer: false,
  confirmCalls: 0
});

vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/state.js'), 'utf8'), ctx, { filename: 'state.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/sync.js'), 'utf8'), ctx, { filename: 'sync.js' });

const run = expr => vm.runInContext(expr, ctx);

function reset (newRoutes) {
  routes = newRoutes || {};
  sent.length = 0;
  store.clear();
  run('Sync.forget()');
}

/** A state object with something in it worth not losing. */
function filledState () {
  const S = run('defaultState()');
  S.consultant.name = 'Ahmad bin Abdullah';
  S.mode = 'both';
  S.invoice.no = 'INV-2026-08-026';
  S.invoice.items = [{ desc: 'Consultancy', amount: 903.23 }];
  S.timesheet.month = 7;                       // August, zero-based
  S.timesheet.year = 2026;
  return S;
}

const adopting = () => {
  const box = { adopted: null };
  ctx.adopt = s => { box.adopted = s; };
  return box;
};

(async () => {
  console.log('\nWhen BDOS has not shipped the endpoints');
  reset({});                                    // everything 404s
  ctx.S = filledState();
  let box = adopting();
  let r = await run('Sync.init(S, adopt)');
  check('syncing is off',              r.on, false);
  check('Sync.on agrees',              run('Sync.on'), false);
  check('nothing was adopted',         box.adopted, null);
  check('only the one probe was sent', sent.length, 1);
  check('and it was the draft probe',  sent[0].method + ' ' + sent[0].path, 'GET /ccs/draft');

  // With syncing off, the app may keep calling these — they must do nothing.
  run('Sync.pushDraft(S)');
  run("Sync.pushProfile('Ahmad', S)");
  const recorded = await run('Sync.recordClaim(S, ["Invoice PDF"])');
  check('a draft push is a no-op',   sent.length, 1);
  check('a claim is not recorded',   recorded, null);

  console.log('\nWhen the account is not allowed through');
  reset({ 'GET /ccs/draft': { status: 403, body: { detail: 'Forbidden' } } });
  ctx.S = filledState();
  r = await run('Sync.init(S, adopt)');
  check('a 403 also just turns syncing off', r.on, false);

  console.log('\nAdopting a stored draft');
  // An untouched form has nothing to lose, so the stored draft is loaded.
  const remote = filledState();
  remote.consultant.name = 'Saved Elsewhere';
  reset({
    'GET /ccs/draft': { status: 200, body: { draft: { data: remote, updated_at: '2026-09-08T10:00:00Z' } } },
    'GET /ccs/profiles': { status: 200, body: { profiles: [] } }
  });
  ctx.S = run('defaultState()');                 // blank form
  box = adopting();
  r = await run('Sync.init(S, adopt)');
  check('syncing is on',                r.on, true);
  check('the blank form adopts it',     r.adopted, true);
  check('the saved work is loaded',     box.adopted.consultant.name, 'Saved Elsewhere');
  check('the request carried the token', sent[0].auth, 'Bearer stub-token');

  // A form with work in it is never replaced without being asked.
  reset({
    'GET /ccs/draft': { status: 200, body: { draft: { data: remote, updated_at: '2026-09-08T10:00:00Z' } } },
    'GET /ccs/profiles': { status: 200, body: { profiles: [] } }
  });
  ctx.S = filledState();
  box = adopting();
  ctx.confirmAnswer = false;
  r = await run('Sync.init(S, adopt)');
  check('work on screen is not silently replaced', r.adopted, false);
  check('and nothing was handed over',             box.adopted, null);

  // Unless it is demonstrably older than what another device sent up.
  reset({
    'GET /ccs/draft': { status: 200, body: { draft: { data: remote, updated_at: '2999-01-01T00:00:00Z' } } },
    'GET /ccs/profiles': { status: 200, body: { profiles: [] } }
  });
  localStorage.setItem('ccs.syncedAt', '2026-09-01T00:00:00Z');
  ctx.S = filledState();
  box = adopting();
  ctx.confirmAnswer = true;                      // the user says yes
  r = await run('Sync.init(S, adopt)');
  check('a newer draft is offered and taken', r.adopted, true);
  check('the newer work is loaded',           box.adopted.consultant.name, 'Saved Elsewhere');

  console.log('\nProfiles converge both ways');
  const theirs = filledState();
  theirs.consultant.name = 'Hanis';
  reset({
    'GET /ccs/draft':    { status: 200, body: { draft: null } },
    'GET /ccs/profiles': { status: 200, body: { profiles: [{ id: 7, name: 'Hanis', data: theirs }] } },
    'POST /ccs/profiles': { status: 200, body: { profile: { id: 8, name: 'Mine', data: {} } } }
  });
  /* saved here while BDOS was unreachable, so it is still owed to the
     shared list — that, and not merely being here, is what sends it up */
  run(`Store.saveProfile('Mine', defaultState()); Store.markUnsent('Mine')`);
  ctx.S = run('defaultState()');
  box = adopting();
  r = await run('Sync.init(S, adopt)');
  check('the shared profile arrives',   r.gained, 1);
  check('it is saved locally',          run(`Store.profiles()['Hanis'].consultant.name`), 'Hanis');
  check('the one BDOS never took is sent up', r.sent, 1);
  check('and is not owed twice',        run(`Store.unsent().length`), 0);
  check('a null draft changes nothing', r.adopted, false);

  const post = sent.find(x => x.method === 'POST' && x.path === '/ccs/profiles');
  check('the upload is keyed by name', post.body.name, 'Mine');

  /* A copy that merely arrived here from somebody else is not this browser's
     to republish. Republishing is how the same person used to appear twice:
     one machine deletes the profile, the next sync puts it back. */
  console.log('\nA deleted profile stays deleted');
  reset({
    'GET /ccs/draft':    { status: 200, body: { draft: null } },
    'GET /ccs/profiles': { status: 200, body: { profiles: [] } }
  });
  run(`Store.saveProfile('Someone Else', defaultState())`);
  ctx.S = run('defaultState()');
  box = adopting();
  r = await run('Sync.init(S, adopt)');
  check('a copy from elsewhere is not republished', r.sent, 0);

  reset({
    'GET /ccs/draft':    { status: 200, body: { draft: null } },
    'GET /ccs/profiles': { status: 200, body: { profiles: [{ id: 9, name: 'Gone', data: theirs }] } },
    'DELETE /ccs/profiles/9': { status: 200, body: { ok: true } }
  });
  run(`Store.saveProfile('Gone', defaultState()); Store.deleteProfile('Gone')`);
  check('the deletion is remembered', run(`Store.isBuried('Gone')`), true);
  ctx.S = run('defaultState()');
  box = adopting();
  r = await run('Sync.init(S, adopt)');
  check('it does not come back down',  run(`Store.profiles()['Gone'] === undefined`), true);
  check('and it is taken off the shared list', r.removed, 1);
  check('by the endpoint that removes it',
    !!sent.find(x => x.method === 'DELETE' && x.path === '/ccs/profiles/9'), true);
  run(`Store.saveProfile('Gone', defaultState())`);
  check('saving it again is meaning it', run(`Store.isBuried('Gone')`), false);

  console.log('\nRecording a claim');
  reset({
    'GET /ccs/draft':  { status: 200, body: { draft: null } },
    'GET /ccs/profiles': { status: 200, body: { profiles: [] } },
    'POST /ccs/claims': { status: 200, body: { claim: { id: 3 } } },
    'PUT /ccs/draft':  { status: 200, body: { ok: true } }
  });
  ctx.S = filledState();
  await run('Sync.init(S, adopt)');
  await run('Sync.recordClaim(S, ["Invoice PDF", "Claim Word"])');
  const claim = sent.find(x => x.path === '/ccs/claims').body;
  check('the consultant is named',        claim.consultant, 'Ahmad bin Abdullah');
  check('the month is 1-12, not 0-11',    claim.period_month, 8);
  check('the year is carried',            claim.period_year, 2026);
  check('the invoice number is carried',  claim.invoice_no, 'INV-2026-08-026');
  check('the total is computed, not typed', claim.amount, 903.23);
  check('the documents are listed',       claim.documents.join(', '), 'Invoice PDF, Claim Word');
  check('the whole form is kept with it', claim.data.consultant.name, 'Ahmad bin Abdullah');

  /* The two clocks are not the same clock. This browser records when it last
     sent the draft up, and compares that against the stamp the server put on
     it — so the time it records has to be the server's, or a server a few
     seconds ahead makes every reload look like somebody else saved something
     newer, and the app offers to replace your form with your own work. */
  console.log('\nWhose clock the draft is timed by');
  reset({
    'GET /ccs/draft': { status: 200, body: { draft: null } },
    'GET /ccs/profiles': { status: 200, body: { profiles: [] } },
    'PUT /ccs/draft': { status: 200, body: { ok: true, updated_at: '2030-01-01T00:00:00Z' } }
  });
  ctx.S = filledState();
  await run('Sync.init(S, adopt)');
  run('Sync.pushDraft(S)');
  await new Promise(res => setImmediate(res));
  check("the server's time is what gets remembered",
        store.get('ccs.syncedAt'), '2030-01-01T00:00:00Z');

  // ...and a stored draft that is the form already on screen is not a choice
  // anybody needs to make, so it is not put to them
  console.log('\nA draft that is not actually different');
  reset({
    'GET /ccs/draft': { status: 200,
      body: { draft: { data: filledState(), updated_at: '2999-01-01T00:00:00Z',
                       updated_by: 'me@example.com' } } },
    'GET /ccs/profiles': { status: 200, body: { profiles: [] } },
    'PUT /ccs/draft': { status: 200, body: { ok: true } }
  });
  store.set('ccs.syncedAt', '2020-01-01T00:00:00Z');     // long out of date
  ctx.confirmCalls = 0;
  ctx.confirmAnswer = true;
  ctx.S = filledState();
  const r2 = await run('Sync.init(S, adopt)');
  check('nothing is asked when there is nothing to choose', ctx.confirmCalls, 0);
  check('and nothing is replaced', r2.adopted, false);
  check('the browser stops thinking it is behind',
        store.get('ccs.syncedAt'), '2999-01-01T00:00:00Z');

  /* Answering the question has to settle it. The mark this browser keeps is
     the newest stored draft it has been shown — not the last thing it sent,
     which was the bug: a reload with nothing typed sends nothing, so the mark
     never moved and the same question came back on every single reload. */
  console.log('\nAsking twice about the same draft');
  const hers = filledState();
  hers.consultant.name = 'Somebody Else';
  reset({
    'GET /ccs/draft': { status: 200,
      body: { draft: { data: hers, updated_at: '2999-01-01T00:00:00Z',
                       updated_by: 'her@example.com' } } },
    'GET /ccs/profiles': { status: 200, body: { profiles: [] } },
    'PUT /ccs/draft': { status: 200, body: { ok: true } }
  });
  store.set('ccs.syncedAt', '2020-01-01T00:00:00Z');
  ctx.confirmCalls = 0;
  ctx.confirmAnswer = false;                    // "no, keep what I have"
  ctx.S = filledState();
  await run('Sync.init(S, adopt)');
  check('a genuinely different draft is put to you once', ctx.confirmCalls, 1);

  // reload, having typed nothing: the same draft is still sitting there
  ctx.S = filledState();
  await run('Sync.init(S, adopt)');
  check('and not put to you again', ctx.confirmCalls, 1);

  // ...but a newer one is a new question
  routes['GET /ccs/draft'].body.draft.updated_at = '2999-06-01T00:00:00Z';
  ctx.S = filledState();
  await run('Sync.init(S, adopt)');
  check('something newer is asked about', ctx.confirmCalls, 2);

  console.log('\nThe draft goes up as you work');
  run('Sync.pushDraft(S)');
  await new Promise(res => setImmediate(res));
  const put = sent.find(x => x.method === 'PUT' && x.path === '/ccs/draft');
  check('the draft was sent',        put ? 'yes' : 'no', 'yes');
  check('wrapped as { data }',       put.body.data.consultant.name, 'Ahmad bin Abdullah');
  check('and the push is timestamped', localStorage.getItem('ccs.syncedAt') ? 'yes' : 'no', 'yes');

  console.log('\nArchive errors stay distinct from an empty archive');
  reset({
    'GET /ccs/draft': { status: 200, body: { draft: null } },
    'GET /ccs/profiles': { status: 200, body: { profiles: [] } },
    'GET /ccs/archive': { status: 503, body: { detail: 'Storage temporarily unavailable' } }
  });
  ctx.S = filledState();
  await run('Sync.init(S, adopt)');
  let archiveError;
  try { await run("Sync.stored('', '')"); }
  catch (err) { archiveError = err; }
  check('a storage failure is surfaced for retry', archiveError && archiveError.status, 503);
  check('a temporary failure does not disable the archive', run('Sync.archiveOn'), true);
  check('or the rest of syncing', run('Sync.on'), true);
  routes['GET /ccs/archive'] = { status: 200, body: { records: [{ id: 'signed-copy' }] } };
  const recovered = await run("Sync.stored('', '')");
  check('retry returns the filed records', recovered[0] && recovered[0].id, 'signed-copy');

  routes['GET /ccs/archive'] = { status: 404, body: { detail: 'Not Found' } };
  const unavailable = await run("Sync.stored('', '')");
  check('optional storage still tolerates a missing endpoint', unavailable.length, 0);
  check('missing storage is reported as unavailable', run('Sync.archiveOn'), false);
  check('missing storage leaves the rest of syncing working', run('Sync.on'), true);
  const requestsBefore = sent.length;
  await run("Sync.stored('', '')");
  check('the missing endpoint is not repeatedly requested', sent.length, requestsBefore);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('All tests passed.');
})();

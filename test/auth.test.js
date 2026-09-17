/* =======================================================================
   auth.test.js — the sign-in gate rules, with zero npm dependencies.

   Loads assets/js/auth.js into a Node VM behind a stub browser (fake
   localStorage, fake fetch) and checks the rules that decide who gets in:
   the two-account allow-list, token expiry, and the fact that the address
   BDOS confirms — not the one typed — is the one that counts.

   No real network call is made and no real password appears here.

   Run:  node test/auth.test.js
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

async function checkThrows (label, fn, fragment) {
  let msg = '(no error thrown)';
  try { await fn(); } catch (err) { msg = err.message; }
  if (msg.includes(fragment)) {
    passed++;
    console.log(`  ok    ${label} → "${msg}"`);
  } else {
    failures.push(`${label}: got "${msg}", expected something containing "${fragment}"`);
    console.log(`  FAIL  ${label}: got "${msg}", expected "...${fragment}..."`);
  }
}

/* ---------------- stub browser ---------------- */
const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};

/** Unsigned stand-in for a BDOS token — only the `exp` claim is ever read. */
function fakeToken (expSeconds) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ uid: 'u1', exp: expSeconds })}.sig`;
}

let nextResponse = null;               // what the fake BDOS replies with
let lastBody = null;
const lastLoginBody = () => lastBody;

const fetch = async (url, opts) => {
  lastBody = opts && opts.body ? JSON.parse(opts.body) : null;
  if (nextResponse instanceof Error) throw nextResponse;
  const r = nextResponse;
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    json: async () => r.body
  };
};

/** Just enough DOM for the gate to open, close and wire its form up. */
function fakeDom () {
  const el = extra => Object.assign({
    hidden: false, textContent: '', title: '', value: '', disabled: false,
    focus () {}, select () {}, addEventListener () {}
  }, extra);
  const nodes = {
    authGate: el({ hidden: true }), authForm: el(), authEmail: el(),
    authPassword: el(), authSubmit: el(), authError: el(),
    authWho: el({ hidden: true }), btnSignOut: el({ hidden: true })
  };
  const classes = new Set(['locked']);
  return {
    nodes,
    document: {
      getElementById: id => nodes[id] || null,
      body: { classList: { add: c => classes.add(c), remove: c => classes.delete(c) } }
    },
    locked: () => classes.has('locked')
  };
}

let dom = fakeDom();

const ctx = vm.createContext({
  console, localStorage, fetch, atob, Buffer,
  navigator: { onLine: true },
  get document () { return dom.document; },
  setTimeout, location: { reload () {} }
});

vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/auth.js'), 'utf8'), ctx, { filename: 'auth.js' });

const run = expr => vm.runInContext(expr, ctx);

(async () => {
  console.log('\nThe allow-list');
  check('the owner is allowed',        run("isAllowed('geospatial.ai@uzmagroup.com')"), true);
  check('the second consultant allowed', run("isAllowed('nuramilazulfa@gmail.com')"), true);
  check('the project manager allowed', run("isAllowed('hanis.rashidan@uzmagroup.com')"), true);
  check('the HOD allowed',             run("isAllowed('fadhli.jamaluddin@uzmagroup.com')"), true);
  check('the PA allowed',              run("isAllowed('fatin.zaini@uzmagroup.com')"), true);
  check('case and spaces ignored',     run("isAllowed('  Hanis.Rashidan@UzmaGroup.com ')"), true);
  check('any other BDOS user refused', run("isAllowed('someone.else@uzmagroup.com')"), false);
  check('empty refused',               run("isAllowed('')"), false);
  check('eleven accounts, no more',   run('ALLOWED_USERS.length'), 11);
  /* The claim finishes with the PA. Nobody collects it afterwards, so the
     account that used to has no part in the process and no way into it. */
  check('the collector is off the list',
        run("!ROLES['najihah.zakir@uzmagroup.com'] && !isAllowed('najihah.zakir@uzmagroup.com')"), true);
  check('and keeping the whole record is the administrator alone',
        run("keepsRecords('admin') && !keepsRecords('pa') && !keepsRecords('finance')"), true);
  // everybody who sends a claim has an account of their own now, and each of
  // them sees their own work and nobody else's
  check('Zharif prepares his own',     run("ROLES['zharif.zaidi@uzmagroup.com']"), 'consultant');
  check('so does Afifah',              run("ROLES['afifah.zamzari@uzmagroup.com']"), 'consultant');
  check('and so does Nizar',           run("ROLES['nizar.tarmizi@uzmagroup.com']"), 'consultant');
  check('and so does Tajul',           run("ROLES['tajul.sharby@uzmagroup.com']"), 'consultant');
  check('and so does Anir',            run("ROLES['anir.sharbirin@uzmagroup.com']"), 'consultant');
  check('a consultant does not see everybody', run("seesEveryone('consultant')"), false);
  check('but the administrator does',  run("seesEveryone('admin')"), true);
  check('and so do the approvers, who have to read what they sign',
        run("seesEveryone('manager') && seesEveryone('boss') && seesEveryone('pa')"), true);
  // the numbering is the office's, not the person's: one consultant deciding
  // they are 07 is how two people end up both being 07
  check('only the administrator sets the numbering',
        run("setsNumbering('admin') && !setsNumbering('consultant') && !setsNumbering('manager')"), true);

  // A claim is prepared, reviewed, approved and then signed — each account
  // has exactly one part in that, and the list is the roles it comes from.
  console.log('\nWho does what');
  check('the owner runs the thing',    run("ROLES['geospatial.ai@uzmagroup.com']"), 'admin');
  check('and the address it moved from is an ordinary account now',
        run("ROLES['adlishah0821@gmail.com']"), 'consultant');
  check('the second account prepares', run("ROLES['nuramilazulfa@gmail.com']"), 'consultant');
  check('an admin prepares claims too', run("prepares('admin')"), true);
  check('an approver does not',        run("prepares('manager')"), false);
  check('Hanis reviews them',          run("ROLES['hanis.rashidan@uzmagroup.com']"), 'manager');
  check('Fadhli approves them',        run("ROLES['fadhli.jamaluddin@uzmagroup.com']"), 'boss');
  check('Fatin signs for him',         run("ROLES['fatin.zaini@uzmagroup.com']"), 'pa');
  check('everybody listed has a part',
        run('ALLOWED_USERS.every(e => !!ROLES[e])'), true);
  check('an outsider has none',        run("!ROLES['someone.else@uzmagroup.com']"), true);

  console.log('\nToken expiry');
  ctx.freshToken   = fakeToken(Math.floor(Date.now() / 1000) + 3600);
  ctx.staleToken   = fakeToken(Math.floor(Date.now() / 1000) - 60);
  check('a live token is usable',   run('tokenExpired(freshToken)'), false);
  check('a lapsed token is not',    run('tokenExpired(staleToken)'), true);
  check('nonsense counts as spent', run("tokenExpired('not-a-token')"), true);

  console.log('\nSigning in');
  const login = (e, p) => run(`bdosLogin(${JSON.stringify(e)}, ${JSON.stringify(p)})`);

  await checkThrows('a blank password is refused before any request',
    () => login('adlishah0821@gmail.com', ''), 'Enter your email and password');

  await checkThrows('a stranger never reaches BDOS',
    () => login('stranger@example.com', 'whatever'), 'not on the list');

  nextResponse = { status: 401, body: { detail: 'Email or password is incorrect' } };
  await checkThrows('a 401 is reported as BDOS refusing the pair',
    () => login('adlishah0821@gmail.com', 'wrong'), 'BDOS did not accept');

  // The allow-list is applied again to whatever BDOS says the account is,
  // so a mismatched or redirected identity cannot walk in.
  nextResponse = {
    status: 200,
    body: { token: ctx.freshToken, user: { uid: 'u9', email: 'someone.else@uzmagroup.com', name: 'Someone Else' } }
  };
  await checkThrows("BDOS's own answer decides, not the typed address",
    () => login('adlishah0821@gmail.com', 'right'), 'not on the list');
  check('nothing was stored after that', run(`localStorage.getItem('ccs.token')`), null);

  nextResponse = new Error('network down');
  await checkThrows('an unreachable BDOS says so',
    () => login('adlishah0821@gmail.com', 'right'), 'Cannot reach BDOS');

  nextResponse = {
    status: 200,
    body: { token: ctx.freshToken, user: { uid: 'u1', email: 'adlishah0821@gmail.com', name: 'Adlishah Hakimi' } }
  };
  const user = await login('  Adlishah0821@Gmail.com ', 'right');
  check('a good sign-in returns the user', user.name, 'Adlishah Hakimi');
  check('the address reaches BDOS as typed, only trimmed',
    lastLoginBody().email, 'Adlishah0821@Gmail.com');
  check('the token is kept for next time', run(`localStorage.getItem('ccs.token')`), ctx.freshToken);

  console.log('\nOpening the app again');
  // The session from the sign-in above is still in localStorage. Offline, the
  // app must still open: the token is good for 30 days and nothing here needs
  // a server. That is the whole reason the gate does not block on the network.
  ctx.navigator.onLine = false;
  dom = fakeDom();
  run('starts = 0; unlocked = false; startAuth(() => { unlocked = true; starts = starts + 1; })');
  check('a stored session opens the app offline', run('unlocked'), true);
  check('the gate stays out of the way',          run('document.getElementById("authGate").hidden'), true);
  check('the app is unlocked',                    dom.locked(), false);
  check('the top bar names who is signed in',     run('document.getElementById("authWho").textContent'), 'Adlishah Hakimi');

  // A second unlock — a double-clicked Sign in, or a stray second call —
  // must not start the app again: every button would end up bound twice.
  run('startAuth(() => { starts = starts + 1; })');
  check('the app is only ever started once', run('starts'), 1);

  // A token past its 30 days is not worth trying: ask for the password again.
  dom = fakeDom();
  run(`localStorage.setItem('ccs.token', staleToken)`);
  run('unlocked = false; startAuth(() => { unlocked = true; })');
  check('an expired token asks for a password', run('unlocked'), false);
  check('the gate is shown',                    run('document.getElementById("authGate").hidden'), false);
  check('and the stale token is dropped',       run(`localStorage.getItem('ccs.token')`), null);

  // Someone taken off the list keeps a valid BDOS token — the app still refuses.
  dom = fakeDom();
  run(`localStorage.setItem('ccs.token', freshToken)`);
  run(`localStorage.setItem('ccs.user', JSON.stringify({ email: 'someone.else@uzmagroup.com' }))`);
  run('unlocked = false; startAuth(() => { unlocked = true; })');
  check('a removed account cannot resume', run('unlocked'), false);

  console.log('\nSigning out');
  ctx.navigator.onLine = true;
  dom = fakeDom();
  nextResponse = {
    status: 200,
    body: { token: ctx.freshToken, user: { uid: 'u1', email: 'adlishah0821@gmail.com', name: 'Adlishah Hakimi' } }
  };
  await login('adlishah0821@gmail.com', 'right');
  run('signOut()');
  check('the token is discarded', run(`localStorage.getItem('ccs.token')`), null);
  check('so is the user',         run(`localStorage.getItem('ccs.user')`), null);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('All tests passed.');
})();

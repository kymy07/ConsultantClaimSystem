/* =======================================================================
   auth.js — the BDOS sign-in gate

   Everybody who sends a claim has an account, so the door is a BDOS account
   (https://bdos.uzmadigitalearth.app) plus the allow-list below. A
   consultant signs in and sees their own profile and their own claims;
   the administrator sees everybody's.

   BDOS issues a stateless JWT that lasts 30 days. We keep it in
   localStorage and send it back as `Authorization: Bearer <token>`.
   There is no server-side logout, so signing out simply discards it.

   What this gate is NOT: a security boundary. Everything it hides is HTML
   and JavaScript the browser has already downloaded, and anyone can open
   the folder directly. Read it as "who is at the keyboard, and are they
   meant to be here" — not as a lock on the documents. The lock is the same
   list on the BDOS side, which decides who the stored work is handed to;
   this one only decides what the sign-in page says.
   ======================================================================= */

const BDOS_BASE = 'https://bdos.uzmadigitalearth.app';

/**
 * The only accounts allowed in, and what each of them does with a claim.
 * A consultant prepares one; the project manager reviews it; the HOD
 * approves it; the HOD's PA places their signature on it. Compared
 * lower-case and trimmed.
 *
 * BDOS holds the same map and is the one that enforces it — this copy only
 * decides what the app draws, and it must be changed alongside `CCS_ROLES`
 * there. See docs/BDOS-CCS-Endpoints.md.
 */
const ROLES = {
  'geospatial.ai@uzmagroup.com':     'admin',
  'adlishah0821@gmail.com':          'consultant',
  'nuramilazulfa@gmail.com':         'consultant',
  'zharif.zaidi@uzmagroup.com':      'consultant',
  'afifah.zamzari@uzmagroup.com':    'consultant',
  'nizar.tarmizi@uzmagroup.com':     'consultant',
  'tajul.sharby@uzmagroup.com':      'consultant',
  'hanis.rashidan@uzmagroup.com':    'manager',
  'fadhli.jamaluddin@uzmagroup.com': 'boss',
  'fatin.zaini@uzmagroup.com':       'pa'
};
const ALLOWED_USERS = Object.keys(ROLES);

/**
 * Which profile belongs to which account, for the profiles that existed
 * before profiles carried an owner.
 *
 * A profile stamped with an `email` needs none of this and always wins. This
 * is only the answer for the ones saved before that field existed, and it is
 * a fragment rather than a whole name on purpose: a name typed into a form
 * five times is spelled five ways, and "Sharifuddin" or "Sharilfuddin" is
 * not a question anybody should be locked out of their own claims over.
 */
const PROFILE_HINTS = {
  'adlishah0821@gmail.com':       /adlishah/i,
  'geospatial.ai@uzmagroup.com':  /geospatial/i,
  'nuramilazulfa@gmail.com':      /amila/i,
  'zharif.zaidi@uzmagroup.com':   /zharif/i,
  'afifah.zamzari@uzmagroup.com': /afifah/i,
  'nizar.tarmizi@uzmagroup.com':  /nizar/i,
  'tajul.sharby@uzmagroup.com':   /tajul/i
};

/** What a role is called where somebody has to read it. */
const ROLE_NAMES = {
  admin:      'Administrator',
  consultant: 'Consultant',
  manager:    'Project Manager',
  boss:       'Head of Department',
  pa:         'PA to the HOD'
};

/**
 * Who actually holds each part, by name.
 *
 * "Reviewed" is a column heading that tells nobody anything; "Muhammad Hanis
 * Rashidan" tells them who to go and ask. These are the people the process
 * runs through today, and they are only what the screen says — every one of
 * them is also an ordinary field on the Claim page, so a month somebody else
 * signs is typed over there and the documents follow.
 *
 * Changed together with ROLES above when somebody moves on.
 */
const ROLE_PEOPLE = {
  consultant: 'the consultant',
  manager:    'Muhammad Hanis Rashidan',
  boss:       'Gs. Mohammad Fadhli Jamaluddin',
  pa:         'Fatin Zaini'
};

/* What the office calls them. A button is read in a second and pressed
   without being read twice, so it says the name the person would answer to
   rather than the name on their identity card or the name of their
   department: a name somebody can check, rather than a form field.
   Changed with ROLE_PEOPLE. */
const ROLE_SHORT = {
  manager: 'Hanis',
  boss:    'Fadhli',
  pa:      'Fatin'
};

/* The admin prepares claims like a consultant and can also move any claim at
   any stage — somebody has to be able to finish a month when the project
   manager is on leave and the HOD is on a plane. BDOS decides this too; the
   copy here only decides what the app draws. */
const prepares = r => r === 'consultant' || r === 'admin';
const isAdmin  = r => r === 'admin';

/* Placing the HOD's signature is the PA's whole part in this, and some
   months it happens on paper rather than in the app — so the account that
   places it is also the account that puts the finished document on file.
   Asked as "does this account place signatures", never as "is this the PA":
   comparing to a role name is how the admin ended up with less access than
   the people it administers. */
const places = r => r === 'pa' || r === 'admin';

/* Whose job is the finished paper: reading the whole record back, and taking
   a copy of it away. The claim finishes with the PA, and what it leaves
   behind is the administrator's to keep. */
const keepsRecords = r => r === 'admin';

/* Who moves a claim along. Somebody who only collects the finished forms
   does not, and should not be shown a queue of decisions that will never be
   theirs to make — their whole app is the shelf the documents end up on. */
const approves = r => r === 'manager' || r === 'boss' || r === 'pa' || r === 'admin';

/* Seeing everybody's work, rather than only your own. The administrator sets
   the app up and answers for all of it; the three approvers have to read
   what they are approving. A consultant sees their own, and that is the
   whole of the change — asked as "does this account see everybody", never as
   "is this a consultant". */
const seesEveryone = r => r !== 'consultant';

/* The payment advice is the office's paperwork for paying a bill. It is
   prepared for the consultant, approved without them, and they never see
   it — so the question is asked as "is this the office", not "is this the
   PA", because the administrator and the approvers are the office too. */
const seesOfficeDocuments = r => !!r && r !== 'consultant';

/* Two numbers belong to the office rather than to the person: the unique ID
   that makes their invoice series, and the count of claims they have sent.
   One person deciding they are 07 is how two people end up both being 07. */
const setsNumbering = r => r === 'admin';

const TOKEN_KEY = 'ccs.token';
const USER_KEY  = 'ccs.user';

const normEmail = e => String(e || '').trim().toLowerCase();
const isAllowed = e => ALLOWED_USERS.includes(normEmail(e));

/* -----------------------------------------------------------------------
   Token helpers. We read `exp` only to know whether the token is worth
   trying — never to decide what somebody may do. BDOS re-verifies the
   signature on every protected call, and that is the answer that counts.
   ----------------------------------------------------------------------- */
function decodeJwt (token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
    const json = decodeURIComponent(
      raw.split('')
         .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
         .join('')
    );
    return JSON.parse(json);
  } catch (err) { return null; }
}

function tokenExpired (token) {
  const claims = decodeJwt(token);
  if (!claims || !claims.exp) return true;
  return claims.exp * 1000 <= Date.now();
}

/* ---------------- the stored session ---------------- */
function storedToken () {
  try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
}

function storedUser () {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
  catch (e) { return null; }
}

function saveSession (token, user) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch (e) { /* private window or full quota — the session just won't outlive the tab */ }
}

function clearSession () {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch (e) {}
}

/* -----------------------------------------------------------------------
   Talking to BDOS
   ----------------------------------------------------------------------- */
async function bdosError (res, fallback) {
  try {
    const body = await res.json();
    return new Error(body.detail || fallback);
  } catch (e) { return new Error(fallback); }
}

async function bdosLogin (email, password) {
  const typed = String(email || '').trim();
  if (!typed || !password) throw new Error('Enter your email and password.');
  if (!isAllowed(typed)) throw new Error('That account is not on the list for this app.');

  let res;
  try {
    res = await fetch(BDOS_BASE + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: typed, password: password })
    });
  } catch (err) {
    throw new Error('Cannot reach BDOS. Check your internet connection and try again.');
  }

  if (res.status === 401) {
    console.info('BDOS refused the sign-in for ' + typed +
                 '. It answers 401 both for a wrong password and for an address it has ' +
                 'never heard of, so check with a BDOS admin that this account exists.');
    throw new Error('BDOS did not accept that email and password.');
  }
  if (!res.ok) throw await bdosError(res, 'Sign-in failed. Please try again.');

  const data = await res.json();
  if (!data || !data.token || !data.user) throw new Error('BDOS returned an unexpected response.');

  // The address BDOS confirms is the one that decides — not the one typed in.
  if (!isAllowed(data.user.email)) throw new Error('That account is not on the list for this app.');

  saveSession(data.token, data.user);
  return data.user;
}

/** Ask BDOS who the stored token belongs to. Throws when the session is over. */
async function bdosMe () {
  const token = storedToken();
  if (!token) throw new Error('Not signed in.');

  const res = await fetch(BDOS_BASE + '/auth/me', {
    headers: { Authorization: 'Bearer ' + token }
  });

  if (res.status === 401) {
    clearSession();
    throw new Error('Session expired — please sign in again.');
  }
  if (!res.ok) throw await bdosError(res, 'Could not verify the session.');

  const data = await res.json();
  const user = data && data.user;
  if (!user || !isAllowed(user.email)) {
    clearSession();
    throw new Error('That account is not on the list for this app.');
  }

  saveSession(token, user);
  return user;
}

/* =======================================================================
   The gate
   ======================================================================= */

/** Re-check a restored session with BDOS — but never punish being offline. */
function revalidateSession () {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  bdosMe()
    .then(paintWho)
    .catch(() => {
      // Only a definite rejection closes the door: bdosMe() clears the
      // session on 401. A dead network leaves the token in place, because
      // it is good for 30 days and the app itself needs no server.
      if (!storedToken()) {
        alert('Your BDOS session has ended. Please sign in again.');
        location.reload();
      }
    });
}

function paintWho (user) {
  if (!user) return;
  const who = document.getElementById('authWho');
  if (who) {
    who.textContent = user.name || user.email;
    who.title = user.email;
    who.hidden = false;
  }
  const out = document.getElementById('btnSignOut');
  if (out) out.hidden = false;
}

let started = false;

function unlockApp (user, onUnlock) {
  const gate = document.getElementById('authGate');
  if (gate) gate.hidden = true;
  document.body.classList.remove('locked');
  paintWho(user);

  // Once only. A second run would bind every button's handler a second time,
  // and the app would answer each click twice.
  if (started) return;
  started = true;
  onUnlock();
}

function showGate (onUnlock) {
  const gate  = document.getElementById('authGate');
  const form  = document.getElementById('authForm');
  const email = document.getElementById('authEmail');
  const pass  = document.getElementById('authPassword');
  const btn   = document.getElementById('authSubmit');
  const err   = document.getElementById('authError');
  const reveal = document.getElementById('authPasswordToggle');
  if (!gate || !form) return;

  gate.hidden = false;
  document.body.classList.add('locked');
  setTimeout(() => email.focus(), 50);

  if (reveal) reveal.addEventListener('click', () => {
    const visible = pass.type === 'password';
    pass.type = visible ? 'text' : 'password';
    reveal.textContent = visible ? 'Hide' : 'Show';
    reveal.setAttribute('aria-pressed', String(visible));
    reveal.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (btn.disabled) return;
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const user = await bdosLogin(email.value, pass.value);
      pass.value = '';
      pass.type = 'password';
      if (reveal) {
        reveal.textContent = 'Show';
        reveal.setAttribute('aria-pressed', 'false');
        reveal.setAttribute('aria-label', 'Show password');
      }
      unlockApp(user, onUnlock);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      pass.select();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
}

function signOut () {
  clearSession();
  location.reload();
}

/**
 * Run the gate, then hand the app over.
 *
 * A token already in hand unlocks straight away, so the app still opens
 * on a plane or behind a blocked network — half its point is that it needs
 * no server. BDOS confirms the token in the background when online.
 */
function startAuth (onUnlock) {
  const token = storedToken();
  const user  = storedUser();

  if (token && user && isAllowed(user.email) && !tokenExpired(token)) {
    unlockApp(user, onUnlock);
    revalidateSession();
  } else {
    if (token) clearSession();          // expired, or no longer on the list
    showGate(onUnlock);
  }

  const out = document.getElementById('btnSignOut');
  if (out) out.addEventListener('click', signOut);
}

/** The signed-in account's part in the process, '' when signed out. */
function currentRole () {
  const u = storedUser();
  return (u && ROLES[normEmail(u.email)]) || '';
}

const Auth = {
  start: startAuth,
  signOut: signOut,
  user: storedUser,
  token: storedToken,
  isAllowed: isAllowed,
  role: currentRole,
  roleName: r => ROLE_NAMES[r || currentRole()] || '',
  /** the person who holds that part, by name */
  personFor: r => ROLE_PEOPLE[r] || '',
  /** the name the office uses, falling back to the full one */
  shortFor: r => ROLE_SHORT[r] || ROLE_PEOPLE[r] || '',
  prepares: () => prepares(currentRole()),
  places: () => places(currentRole()),
  keepsRecords: () => keepsRecords(currentRole()),
  approves: () => approves(currentRole()),
  seesEveryone: () => seesEveryone(currentRole()),
  seesOfficeDocuments: () => seesOfficeDocuments(currentRole()),
  setsNumbering: () => setsNumbering(currentRole()),
  isAdmin: () => isAdmin(currentRole()),
  /** the signed-in address, lower-cased — '' when signed out */
  email: () => normEmail((storedUser() || {}).email),
  /** every account that prepares claims, for the administrator to choose from */
  preparers: () => ALLOWED_USERS.filter(e => prepares(ROLES[e])),
  /**
   * Is this profile this account's own? The administrator and the approvers
   * see everybody's, so the question only bites for a consultant.
   *
   * @param {object} p a state object, as stored under a profile name
   */
  owns: function (p) {
    if (seesEveryone(currentRole())) return true;
    const me = normEmail((storedUser() || {}).email);
    if (!me) return false;
    const stamped = normEmail(p && p.consultant && p.consultant.email);
    if (stamped) return stamped === me;
    const hint = PROFILE_HINTS[me];
    return !!(hint && hint.test(String((p && p.consultant && p.consultant.name) || '')));
  },
  BASE: BDOS_BASE
};

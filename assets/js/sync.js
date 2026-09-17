/* =======================================================================
   sync.js — keeping profiles, the current draft and the claims history
             in the `cradle` database, through BDOS.

   The browser cannot talk to PostgreSQL, and a static app has nowhere safe
   to keep a database password. So BDOS holds the database and exposes it
   over the same authenticated API the sign-in already uses; this file is
   the client half. The endpoints are specified in
   docs/BDOS-CCS-Endpoints.md.

   Everything here is best-effort and silent. If the endpoints are not
   deployed yet, or the machine is offline, or a request fails, syncing
   switches itself off for the session and the app carries on saving to
   localStorage exactly as it always has. Nothing in the app waits on a
   response, and no failure here is ever allowed to interrupt somebody
   filling in a form.
   ======================================================================= */

const SYNC_ROOT   = '/ccs';
const SYNCED_KEY  = 'ccs.syncedAt';    // when we last pushed the draft up
const PUSH_DELAY  = 5000;              // draft pushes are lazy, not per-keystroke

let syncOn      = false;               // did the probe find the endpoints?
let probing     = false;               // is the probe still out?
let probed      = false;               // has it even been sent yet?
let syncProblem = '';                  // why the probe failed, in words
let pushTimer   = null;
let pushing     = false;
let pendingPush = null;
const profileIds = new Map();          // profile name → row id, for deletes

/* -----------------------------------------------------------------------
   The one place a request is made
   ----------------------------------------------------------------------- */
async function ccsFetch (path, opts) {
  const token = Auth.token();
  if (!token) throw new Error('Not signed in.');

  const res = await fetch(Auth.BASE + SYNC_ROOT + path, Object.assign({}, opts, {
    headers: Object.assign(
      { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      (opts && opts.headers) || {}
    )
  }));

  // 404 means BDOS has not shipped these routes yet — that is expected, and
  // the app is designed to work without them. 401/403 mean this session is
  // not welcome here; either way, stop asking.
  if (!res.ok) {
    const err = new Error('CCS sync: ' + res.status + ' on ' + path);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

/**
 * Remember when this browser last sent the draft up — as the server timed it,
 * not as this machine did.
 *
 * The two clocks are not the same clock. Storing our own and comparing it
 * against the server's stamp on the very same write meant that a server a few
 * seconds ahead made every reload look like somebody else had saved something
 * newer — and the app dutifully offered to replace your form with your own
 * work. Server time against server time cannot drift.
 */
function markSynced (serverTime) {
  try {
    localStorage.setItem(SYNCED_KEY, serverTime || new Date().toISOString());
  } catch (e) {}
}

function lastSynced () {
  try { return localStorage.getItem(SYNCED_KEY); } catch (e) { return null; }
}

/** Is the stored draft the same work as the form on screen? */
function sameDraft (S, stored) {
  try {
    return JSON.stringify(mergeDefaults(stored)) === JSON.stringify(mergeDefaults(S));
  } catch (e) {
    return false;                 // unreadable either side: better to ask
  }
}

/** Is this form still untouched? Then adopting a saved draft costs nothing. */
function isBlankForm (S) {
  return !S || (!String(S.consultant && S.consultant.name || '').trim() && !S.mode);
}

/* -----------------------------------------------------------------------
   Draft — the form currently open. One row, shared: picking it up on
   another machine is the whole reason this file exists.
   ----------------------------------------------------------------------- */
async function pullDraft () {
  const body = await ccsFetch('/draft', { method: 'GET' });
  return (body && body.draft) || null;
}

async function flushDraft () {
  if (!syncOn || pushing || !pendingPush) return;
  pushing = true;
  const payload = pendingPush;
  pendingPush = null;
  try {
    const body = await ccsFetch('/draft', { method: 'PUT', body: JSON.stringify({ data: payload }) });
    markSynced(body && body.updated_at);
  } catch (err) {
    if (err.status === 404 || err.status === 403) syncOn = false;
    console.warn(err.message || err);
  } finally {
    pushing = false;
    if (pendingPush) flushDraft();          // something changed while we were away
  }
}

/** Queue the draft for upload. Cheap to call on every autosave. */
function pushDraft (S) {
  if (!syncOn) return;
  pendingPush = JSON.parse(JSON.stringify(S));
  clearTimeout(pushTimer);
  pushTimer = setTimeout(flushDraft, PUSH_DELAY);
}

/* -----------------------------------------------------------------------
   Profiles — shared by every account that can sign in
   ----------------------------------------------------------------------- */
async function pullProfiles () {
  const body = await ccsFetch('/profiles', { method: 'GET' });
  const list = (body && body.profiles) || [];
  profileIds.clear();
  list.forEach(p => profileIds.set(p.name, p.id));
  return list;
}

async function pushProfile (name, S) {
  if (!syncOn) { Store.markUnsent(name); return; }
  try {
    const body = await ccsFetch('/profiles', {
      method: 'POST',
      body: JSON.stringify({ name: name, data: S })
    });
    if (body && body.profile) profileIds.set(body.profile.name, body.profile.id);
    Store.markSent(name);
  } catch (err) {
    if (err.status === 404 || err.status === 403) syncOn = false;
    Store.markUnsent(name);
    console.warn(err.message || err);
  }
}

async function deleteProfile (name) {
  if (!syncOn) return;
  const id = profileIds.get(name);
  if (id === undefined) return;             // never made it up there
  try {
    await ccsFetch('/profiles/' + encodeURIComponent(id), { method: 'DELETE' });
    profileIds.delete(name);
  } catch (err) {
    if (err.status === 404) { profileIds.delete(name); return; }   // already gone
    console.warn(err.message || err);
  }
}

/**
 * Reconcile the shared profile list with this browser's copy.
 *
 * A name on the shared list and not here is copied down. A name on both keeps
 * the copy already in this browser, which is the one whose owner is sitting
 * here.
 *
 * What goes up is only what was saved here and never accepted \u2014 not
 * everything this browser happens to hold. That distinction is the whole
 * reason a deleted profile used to come back: every browser still holding an
 * old copy would see a name the shared list was missing and helpfully send it
 * again. A copy that merely arrived here from somebody else is not this
 * browser's to republish, and a name deleted here on purpose is nobody's.
 *
 * And a copy the shared list no longer has is dropped from here. Stopping
 * the republishing was half the fix: the other browsers still held the old
 * copy and went on listing a person the administrator had taken off. The
 * shared list is the list; what is here is a copy of it, plus whatever was
 * saved here and not yet accepted.
 */
async function mergeProfiles () {
  const remote = await pullProfiles();
  const local  = Store.profiles();
  let gained = 0;
  let removed = 0;

  for (const p of remote) {
    if (Store.isBuried(p.name)) {
      Store.deleteProfile(p.name);            // in case a copy slipped back in
      await deleteProfile(p.name);            // and take it off the shared list
      removed++;
      continue;
    }
    if (local[p.name] === undefined && p.data) {
      Store.saveProfile(p.name, mergeDefaults(p.data));
      gained++;
    }
  }

  const known = new Set(remote.map(p => p.name));
  const waiting = Store.unsent().filter(n =>
    local[n] !== undefined && !known.has(n) && !Store.isBuried(n));
  for (const name of waiting) await pushProfile(name, local[name]);

  let dropped = 0;
  Object.keys(local).forEach(name => {
    if (known.has(name) || waiting.indexOf(name) !== -1) return;
    Store.forgetProfile(name);
    dropped++;
  });

  return { gained: gained, sent: waiting.length, removed: removed, dropped: dropped };
}

/* -----------------------------------------------------------------------
   Claims history — shared, written when documents are generated
   ----------------------------------------------------------------------- */
function claimRecord (S, documents) {
  const t = invoiceTotals(S);
  return {
    consultant:   String(S.consultant.name || '').trim(),
    period_month: (Number(S.timesheet.month) || 0) + 1,     // 1-12 for the API
    period_year:  Number(S.timesheet.year) || null,
    invoice_no:   S.invoice.no || null,
    amount:       t.total,
    documents:    documents || [],
    data:         JSON.parse(JSON.stringify(S))
  };
}

async function recordClaim (S, documents) {
  if (!syncOn) return null;
  try {
    const body = await ccsFetch('/claims', {
      method: 'POST',
      body: JSON.stringify(claimRecord(S, documents))
    });
    return (body && body.claim) || null;
  } catch (err) {
    if (err.status === 404 || err.status === 403) syncOn = false;
    console.warn(err.message || err);
    return null;
  }
}

async function claimHistory (limit) {
  if (!syncOn) return [];
  try {
    const body = await ccsFetch('/claims?limit=' + (limit || 50), { method: 'GET' });
    return (body && body.claims) || [];
  } catch (err) { return []; }
}

/* -----------------------------------------------------------------------
   The archive — the signed copies

   Everything else here is the form as software holds it. This is the
   opposite: the paper that came back, scanned. A month is only really
   finished when the signed invoice and the signed time sheet exist as
   files somebody can produce a year later, so they are filed against the
   person and the month and left alone after that.

   Like submissions, and unlike the drafts and profiles, these are not
   best-effort: a file that silently failed to upload is worse than one
   never chosen, so they throw and the caller says so.
   ----------------------------------------------------------------------- */

/* Set when BDOS answers 404 for the archive: it has not been deployed yet.
   Asking again on every repaint would be a request per click for nothing. */
let archiveMissing = false;

/** what one file looks like on the way up: bytes as base64, plus its name */
function readFileForUpload (file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error(`Could not read "${file.name}".`));
    r.onload = () => {
      const url = String(r.result || '');
      const comma = url.indexOf(',');
      resolve({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        content: comma >= 0 ? url.slice(comma + 1) : ''
      });
    };
    r.readAsDataURL(file);
  });
}

/**
 * File the signed copy of one document of one month.
 *
 * `kind` says which document, so the status table can light "on file" per
 * document rather than per month. A record without one means the month, and
 * is read as covering both — which is what every record written before the
 * archive knew about documents meant.
 *
 * `stage` says who signed it: the project manager reviewing, or the PA at the
 * end. Both are worth keeping, and only the second is the finished article —
 * which is what the table's "On file" column is asking about. A record
 * without one is read as the finished article, because that is all there was
 * to file before the project manager signed anything.
 */
async function storeSigned (S, files, note, kind, stage) {
  if (!syncOn) throw new Error('The shared database is not reachable, so there is nowhere to file them.');
  const body = await ccsFetch('/archive', {
    method: 'POST',
    body: JSON.stringify({
      consultant:   String(S.consultant.name || '').trim(),
      unique_id:    uniqueIdOf(S) || null,
      invoice_no:   S.invoice.no || null,
      period_month: (Number(S.timesheet.month) || 0) + 1,
      period_year:  Number(S.timesheet.year) || null,
      kind:         SUBMIT_KINDS[kind] ? kind : null,
      stage:        stage || 'pending_signature',
      note:         note || '',
      files:        files
    })
  });
  return (body && body.record) || null;
}

/**
 * What has been filed. Both filters are optional: no consultant means
 * everybody, no year means every year.
 *
 * A 404 here means BDOS has not shipped the archive yet, and — unlike every
 * other endpoint in this file — that must not switch syncing off. Drafts,
 * profiles and approvals are a working system without it; taking them down
 * because one newer feature is missing would be the archive breaking the
 * app it was added to.
 */
async function storedClaims (consultant, year) {
  if (!syncOn || archiveMissing) return [];
  const q = [];
  if (consultant) q.push('consultant=' + encodeURIComponent(consultant));
  if (year) q.push('year=' + encodeURIComponent(year));
  try {
    const body = await ccsFetch('/archive' + (q.length ? '?' + q.join('&') : ''), { method: 'GET' });
    return (body && body.records) || [];
  } catch (err) {
    if (err.status === 404) {
      archiveMissing = true;                         // optional storage is not deployed
      return [];
    }
    // A failed request is not an empty archive. Let the screen offer a retry
    // without replacing its cached records or claiming nothing was filed.
    throw err;
  }
}

/** One filed month, with the files themselves. */
async function storedClaim (id) {
  const body = await ccsFetch('/archive/' + encodeURIComponent(id), { method: 'GET' });
  return (body && body.record) || null;
}

/* -----------------------------------------------------------------------
   Submissions — a claim on its way through the approvals

   Unlike everything else here, these are not best-effort. A claim that
   silently failed to reach the project manager is worse than one that was
   never sent, so these throw and the caller says so out loud.
   ----------------------------------------------------------------------- */

/** What this account may do — BDOS decides, not the browser. */
async function whoAmI () {
  return ccsFetch('/me', { method: 'GET' });
}

/**
 * Send one document off for approval.
 *
 * `kind` is 'invoice' or 'claim'. It travels twice on purpose: as a field of
 * its own, which is what the list endpoint needs so a table can be drawn
 * without fetching every form; and inside `data`, which BDOS stores verbatim
 * and hands back whatever it makes of the rest. The second copy is what makes
 * this work against a BDOS that has not learned the field yet.
 */
async function submitClaim (S, note, kind) {
  const which = SUBMIT_KINDS[kind] ? kind : 'claim';
  const payload = JSON.parse(JSON.stringify(S));
  payload.submitKind = which;

  const body = await ccsFetch('/submissions', {
    method: 'POST',
    body: JSON.stringify({
      consultant: String(S.consultant.name || '').trim(),
      period_month: (Number(S.timesheet.month) || 0) + 1,
      period_year: Number(S.timesheet.year) || null,
      invoice_no: S.invoice.no || null,
      kind: which,
      note: note || '',
      data: payload
    })
  });
  return (body && body.submission) || null;
}

/**
 * Which document a submission is.
 *
 * Rows sent before a claim was split into two documents were the whole claim,
 * and the time sheet is the half that carries the signatures, so that is what
 * an unlabelled row is read as. Returns '' when the row came from the list
 * endpoint and the field is not there — the caller can then decide whether it
 * is worth fetching the form to find out.
 */
function submissionKind (sub) {
  if (!sub) return '';
  if (SUBMIT_KINDS[sub.kind]) return sub.kind;
  const inData = sub.data && sub.data.submitKind;
  if (SUBMIT_KINDS[inData]) return inData;
  return sub.data ? 'claim' : '';
}

/**
 * Take a claim off the record entirely.
 *
 * Not part of the process — a claim that was wrong is sent back, not erased,
 * and the trail of who approved what is the reason the trail exists. This is
 * for the rows that were never part of the process in the first place: the
 * ones left behind by setting the thing up. The administrator only, enforced
 * at the other end.
 */
async function deleteSubmission (id) {
  try {
    await ccsFetch('/submissions/' + encodeURIComponent(id), { method: 'DELETE' });
    return true;
  } catch (err) {
    if (err.status === 404 || err.status === 405) {
      throw new Error('BDOS cannot delete a claim yet — see docs/BDOS-CCS-Endpoints.md.');
    }
    if (err.status === 403) throw new Error('Only the administrator can delete a claim.');
    throw err;
  }
}

/**
 * @param {string} scope  '' for everything, 'open' for what is unfinished,
 *                        or one status; `mine` narrows to this account's own
 */
async function listSubmissions (scope, mine) {
  const q = [];
  if (scope) q.push('status=' + encodeURIComponent(scope));
  if (mine) q.push('mine=1');
  const body = await ccsFetch('/submissions' + (q.length ? '?' + q.join('&') : ''),
                              { method: 'GET' });
  return (body && body.submissions) || [];
}

/** One claim, with the form itself — what an approver reads before deciding. */
async function getSubmission (id) {
  const body = await ccsFetch('/submissions/' + encodeURIComponent(id), { method: 'GET' });
  return (body && body.submission) || null;
}

/**
 * Move a claim along, or send it back.
 * @param {string} action  'approve' | 'return' | 'resubmit'
 * @param {object} [data]  the form again, when this step signed it
 */
async function actOnSubmission (id, action, note, data) {
  const body = await ccsFetch('/submissions/' + encodeURIComponent(id) + '/action', {
    method: 'POST',
    body: JSON.stringify({ action: action, note: note || '', data: data || undefined })
  });
  return (body && body.submission) || null;
}

/* =======================================================================
   Start-up

   Probes the draft endpoint once. That single call answers everything we
   need to know: are the routes there, and is this account allowed through
   them. Anything other than a clean 200 turns syncing off for the session.
   ======================================================================= */

/**
 * @param {object}   S        the state the app just loaded from localStorage
 * @param {function} adopt    called with a state object to load, if the
 *                            database is holding newer work than this browser
 * @returns {Promise<object>} { on, adopted, gained, sent, removed }
 */
async function initSync (S, adopt) {
  const result = { on: false, adopted: false, gained: 0, sent: 0, removed: 0, dropped: 0 };
  probed = true;
  if (!Auth.token()) return result;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return result;

  let draft;
  probing = true;
  try {
    draft = await pullDraft();
    syncProblem = '';
  } catch (err) {
    /* "Not connected" is true of all of these and useful about none of them.
       Somebody staring at that sentence has to know whether to sign in
       again, ring whoever runs BDOS, or wait — and the status code already
       says which. */
    syncProblem = whyNot(err);
    console.info('CCS sync unavailable: ' + syncProblem);
    return result;
  } finally {
    probing = false;
  }

  syncOn = true;
  result.on = true;

  if (draft && draft.data) {
    const mine = lastSynced();
    /* Adopt when there is nothing here to lose. Otherwise ask, but only when
       the stored draft is both different from the form on screen and newer
       than the newest this browser has already seen — work on screen wins by
       default and goes up on the next autosave. */
    if (isBlankForm(S)) {
      adopt(mergeDefaults(draft.data));
      result.adopted = true;
    } else if (!sameDraft(S, draft.data) && mine && draft.updated_at &&
               draft.updated_at > mine) {
      const when = new Date(draft.updated_at).toLocaleString();
      const who = draft.updated_by ? ' by ' + draft.updated_by : '';
      if (confirm('A newer draft was saved' + who + ' on ' + when + '.\n\nLoad it? Your current form will be replaced.')) {
        adopt(mergeDefaults(draft.data));
        result.adopted = true;
      }
    }

    /* Seen it. Whatever was decided, this browser now knows about this draft,
       and asking about it a second time is asking the same question twice.

       That is what the mark means — the newest stored draft this browser has
       been shown, not the last thing it sent. Meaning "sent" was the bug: a
       reload with nothing typed sends nothing, so the mark never moved and
       every reload put the same question again, for ever. */
    markSynced(draft.updated_at);
  }

  try {
    const merged = await mergeProfiles();
    result.gained = merged.gained;
    result.sent = merged.sent;
    result.removed = merged.removed;
    result.dropped = merged.dropped;
  } catch (err) { console.warn(err.message || err); }

  return result;
}

/**
 * What the probe's failure means, said to whoever is looking at the screen.
 *
 * The three that matter are three different jobs. A 401 is this browser's
 * session, and signing in again fixes it. A 403 is the account: BDOS let
 * them in but this part of it is not theirs, which is what an address that
 * has not been added to CCS_ROLES looks like from here. A 404 is BDOS
 * itself, missing the routes.
 */
function whyNot (err) {
  const code = err && err.status;
  if (code === 401) {
    return 'Your session has run out. Sign out and sign in again.';
  }
  if (code === 403) {
    return 'BDOS knows this account but will not let it into the claim system. ' +
           'The address has to be in CCS_ROLES there — see docs/BDOS-CCS-Endpoints.md.';
  }
  if (code === 404) {
    return 'BDOS has not shipped the claim endpoints yet — see docs/BDOS-CCS-Endpoints.md.';
  }
  if (code) {
    return 'BDOS answered ' + code + '. Nothing here can fix that; whoever runs it can.';
  }
  return 'This browser could not reach BDOS at all. Check the connection, then press Refresh.';
}

/** Forget this browser's sync bookkeeping (used by Reset All). */
function forgetSync () {
  try { localStorage.removeItem(SYNCED_KEY); } catch (e) {}
  profileIds.clear();
  archiveMissing = false;
  pendingPush = null;
  clearTimeout(pushTimer);
}

/**
 * Take one filed copy off the record.
 *
 * Only ever used for a copy a newer one has just replaced. BDOS allows it for
 * the administrator and whoever filed the copy; anything else is refused, and
 * the caller treats that as "leave it", because the newer copy is already the
 * one every screen reads.
 */
async function unstoreSigned (id) {
  await ccsFetch('/archive/' + encodeURIComponent(id), { method: 'DELETE' });
}

/**
 * Replace the form on a payment advice that is still open. The server
 * refuses anything else: another kind of document, a closed month, or an
 * account that is not the PA or the administrator.
 */
async function updateSubmissionData (id, data) {
  return ccsFetch('/submissions/' + encodeURIComponent(id) + '/data', {
    method: 'PATCH',
    body: JSON.stringify({ data: data })
  });
}

/**
 * Replace the form on a payment advice that is still open. The server
 * refuses anything else: another kind of document, a closed month, or an
 * account that is not the PA or the administrator.
 */
async function updateSubmissionData (id, data) {
  return ccsFetch('/submissions/' + encodeURIComponent(id) + '/data', {
    method: 'PATCH',
    body: JSON.stringify({ data: data })
  });
}

/**
 * Take a stray spelling off the record: every document filed under a name
 * that has no profile, when a profile exists a letter or two away. The
 * server decides whether the name qualifies and refuses otherwise, so
 * what comes back is either the counts or the reason it would not.
 */
async function removeStrayName (name) {
  return ccsFetch('/names/' + encodeURIComponent(name), { method: 'DELETE' });
}

const Sync = {
  init: initSync,
  me: whoAmI,
  submit: submitClaim,
  kindOf: submissionKind,
  /* Not `forget` — that name was already taken by the housekeeping this
     browser does for itself, and two different meanings under one name is
     how Reset All would have quietly become a no-op. */
  remove: deleteSubmission,
  submissions: listSubmissions,
  submission: getSubmission,
  act: actOnSubmission,
  pushDraft: pushDraft,
  pushProfile: pushProfile,
  deleteProfile: deleteProfile,
  recordClaim: recordClaim,
  history: claimHistory,
  readFile: readFileForUpload,
  store: storeSigned,
  stored: storedClaims,
  storedOne: storedClaim,
  unstore: unstoreSigned,
  removeStrayName: removeStrayName,
  updateData: updateSubmissionData,
  updateData: updateSubmissionData,
  forget: forgetSync,
  get on () { return syncOn; },
  /* The probe answers after the first paint. Until it has, a screen that
     needs the database is waiting for it, not cut off from it. */
  get connecting () {
    if (probing) return true;
    // the first paint comes before the probe is even sent; a signed-in
    // browser that is online is about to connect, not cut off
    return !probed && !!Auth.token() &&
      !(typeof navigator !== 'undefined' && navigator.onLine === false);
  },
  /** what a screen that needs the database says while it has none */
  /** why the probe failed, in words — '' before it has run or when it worked */
  get problem () { return syncProblem; },
  offlineNote (what) {
    if (this.connecting) return '<p class="emptynote">Connecting to the database…</p>';
    /* The reason first, because it is the actionable half. What the screen
       in particular loses comes after it. */
    return '<p class="emptynote"><b>Not connected to the database.</b> ' +
      // every one of these sentences is written here, not typed by anybody
      (syncProblem ? syncProblem + ' ' : '') + what + '</p>';
  },
  /** is there an archive to file into? false while BDOS has not shipped one */
  get archiveOn () { return syncOn && !archiveMissing; }
};

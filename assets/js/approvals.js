/* =======================================================================
   approvals.js — a month, and how far each document of it has got

   A month is two documents, and they are not the same document. The time
   sheet is the evidence; the invoice is the bill that follows from it. Each
   goes for approval on its own and carries its own status the whole way, so
   the project manager can be happy with the sheet and not with the invoice,
   and say so, without holding up the half that was fine.

   The table is the point of this screen, and it starts from the people
   rather than from the submissions. Everybody who has a profile gets a row
   per document for the month being looked at, whether or not they have sent
   anything — because "has Amila sent September yet" is the question that
   gets asked, and a list of what was sent can never answer it.

   Then five lights, left to right, in the order they happen:

     Sent → Reviewed (PM) → Approved (HOD) → Signed (PA) → On file

   Nothing here edits a claim. An approver reads the document as it will be
   printed — the PDF is rebuilt from the submitted form and shown in the
   same viewer the consultant used — and then signs their own box or sends
   it back with a reason. BDOS decides whether a move is allowed; this file
   asks, and says plainly when the answer is no.
   ======================================================================= */

const STATUS_TEXT = {
  pending_manager:   'With the project manager',
  pending_boss:      'With the HOD',
  pending_signature: 'Waiting for the HOD signature',
  returned:          'Sent back',
  complete:          'Complete'
};

/** which role a status is waiting on — the client's copy of BDOS's stages */
const STATUS_ROLE = {
  pending_manager:   'manager',
  pending_boss:      'boss',
  pending_signature: 'pa'
};

/* The three approval stages in order, and what each column is called. */
const STAGES = [
  { key: 'pending_manager',   head: 'Reviewed', who: 'manager', filed: 'reviewed',
    does: 'reads it and signs it before it goes any further' },
  { key: 'pending_boss',      head: 'Approved', who: 'boss',
    does: 'approves it; signs nothing themselves' },
  { key: 'pending_signature', head: 'Signed',   who: 'pa', filed: 'signed',
    does: 'places the HOD signature, in the app or on paper' }
];
const STAGE_BY_KEY = {};
STAGES.forEach(st => { STAGE_BY_KEY[st.key] = st; });

/* Two of the three stages put a name to the document, and the HOD's does not
   — they approve, and their PA places the signature afterwards. A stage that
   signs cannot be passed on without one: drawn in the app where the document
   has a box for it, or the document signed on paper and uploaded back. */
const signingStage = status => !!(STAGE_BY_KEY[status] && STAGE_BY_KEY[status].filed);
const STAGE_KEYS = STAGES.map(s => s.key);

/* Which box gets signed at which stage — by the stage, not by whoever is
   signing, because the admin can stand in at any of them. The HOD's box is
   filled when it reaches the PA: placing that signature is the PA's whole
   part in this, and the HOD signs nothing themselves.

   Only the time sheet has these boxes. An invoice has one signature on it,
   the consultant's, and an approver approving a bill does not sign it. */
const STAGE_SIGNS = {
  pending_manager:   { sig: 'pm',  name: 'reviewName', date: 'reviewDate', auto: 'review' },
  pending_signature: { sig: 'hod', name: 'apprName',   date: 'apprDate',   auto: 'appr' }
};

const LAST_SIG_KEY = 'ccs.mysignature';      // this approver's own, on this machine

/* Rows sent before a claim was split in two carry no `kind`, and a list
   endpoint that has not learned the field carries none either. Reading the
   form itself always answers, so up to this many are read — enough for a
   month's worth of open work, and bounded so a year of history cannot turn
   opening this screen into a download. */
const KIND_LOOKUP_MAX = 24;

let subs = [];                 // what the last load returned
let openRow = '';              // the submission whose panel is expanded
let busy = false;
let onlyMine = false;          // the "waiting on me" filter
let statusMonth = null;        // { y, m } — the month the table is showing
const kindCache = new Map();   // submission id → 'invoice' | 'claim'

/* -------------------------------------------------------------------
   A signature pad that belongs to nothing else

   The pads in the form are bound to the form's own state. An approver is
   not filling that form in, so this one stands alone: draw or upload, and
   hand back a PNG when asked.
   ------------------------------------------------------------------- */
function makePad (host, initial) {
  host.innerHTML = `
    <div class="sigslot">
      <canvas></canvas>
      <div class="sigbtns">
        <button type="button" data-a="clear">Clear</button>
        <button type="button" data-a="upload">Upload</button>
        <input type="file" accept="image/*" hidden>
      </div>
      <span class="sighint">Draw here, or upload an image</span>
    </div>`;

  const canvas = host.querySelector('canvas');
  const hint = host.querySelector('.sighint');
  const pad = new SignaturePad(canvas, {
    backgroundColor: 'rgba(255,255,255,0)', penColor: '#0b1f4b',
    minWidth: 0.6, maxWidth: 1.9
  });
  let uploaded = '';

  const fit = () => {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const w = canvas.offsetWidth || 260, h = canvas.offsetHeight || 62;
    canvas.width = w * ratio; canvas.height = h * ratio;
    canvas.getContext('2d').scale(ratio, ratio);
    pad.clear();
  };
  setTimeout(fit, 20);

  const say = on => { hint.textContent = on ? '✓ Signed' : 'Draw here, or upload an image'; };

  host.querySelector('[data-a="clear"]').addEventListener('click', () => {
    pad.clear(); uploaded = ''; say(false);
  });
  const file = host.querySelector('input[type=file]');
  host.querySelector('[data-a="upload"]').addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { uploaded = String(r.result || ''); pad.clear(); say(true); };
    r.readAsDataURL(f);
    file.value = '';
  });
  pad.addEventListener('endStroke', () => { uploaded = ''; say(true); });

  if (initial) {
    uploaded = initial;
    say(true);
  }

  return {
    value: () => uploaded || (pad.isEmpty() ? '' : pad.toDataURL('image/png')),
    isEmpty: () => !uploaded && pad.isEmpty()
  };
}

function myLastSignature () {
  try { return localStorage.getItem(LAST_SIG_KEY) || ''; } catch (e) { return ''; }
}
function rememberSignature (png) {
  try { localStorage.setItem(LAST_SIG_KEY, png); } catch (e) { /* private mode */ }
}

/* -------------------------------------------------------------------
   Reading a row
   ------------------------------------------------------------------- */

function myRole () { return Auth.role(); }
function myEmail () { return String((Auth.user() || {}).email || '').toLowerCase(); }

/** can the account that is signed in move this document on? */
function waitingOnMe (sub) {
  if (!sub || !STATUS_ROLE[sub.status]) return false;   // finished, or sent back
  /* The PA places the HOD's signature, and an invoice does not carry one —
     so an invoice never lands in their queue. Until BDOS stops routing one
     there, somebody has to close it, and that is the account that stands in
     everywhere. */
  if (sub.status === 'pending_signature' && !hasSignatureStage(sub)) return Auth.isAdmin();
  return Auth.isAdmin() || STATUS_ROLE[sub.status] === myRole();
}

/** whose turn it is, said plainly */
function waitingOnWhom (sub) {
  return Auth.roleName(STATUS_ROLE[sub.status]) || '';
}

function periodOf (sub) {
  if (!sub.period_year) return '';
  const m = Number(sub.period_month) || 0;
  return `${MON3[Math.max(0, m - 1)]} ${sub.period_year}`;
}

/** which document a row is, using whatever answered when the list was read */
function kindOf (sub) {
  return Sync.kindOf(sub) || kindCache.get(sub.id) || 'claim';
}

/** and the boxes it gets signed in — an invoice has none */
function signsFor (sub) {
  return kindOf(sub) === 'claim' ? STAGE_SIGNS[sub.status] : null;
}

/**
 * Does somebody have to put their name to this document at this stage?
 *
 * Only the time sheet is ever signed by an approver: the project manager
 * in the REVIEWED BY box, the HOD's signature placed by the PA at the end.
 * An invoice carries one signature, the consultant's own, and nobody in the
 * queue adds to it — an approver approving a bill is approving it, not
 * signing it. So an invoice is passed on with a decision and nothing else,
 * and should never reach the PA at all. See docs/BDOS-CCS-Endpoints.md: an
 * approved invoice ought to finish at the HOD.
 */
function mustSign (sub) {
  return signingStage(sub.status) && kindOf(sub) === 'claim';
}

/** is the PA's stage even a thing for this document? */
const hasSignatureStage = sub => kindOf(sub) === 'claim';

/**
 * Where one approval stage stands for one document.
 * @returns {'done'|'waiting'|'returned'|'todo'}
 */
function stageState (sub, stageKey) {
  if (!sub) return 'todo';
  const at = STAGE_KEYS.indexOf(stageKey);

  if (sub.status === 'complete') return 'done';

  if (sub.status === 'returned') {
    // the stage that sent it back is the one to point at; the ones before it
    // had already said yes, and saying so is the point of the row
    const back = (sub.history || []).slice().reverse()
      .filter(h => h.action === 'return')[0];
    const from = STAGE_KEYS.indexOf((back && back.from) || 'pending_manager');
    if (from < 0) return 'todo';
    if (at === from) return 'returned';
    return at < from ? 'done' : 'todo';
  }

  const now = STAGE_KEYS.indexOf(sub.status);
  if (now < 0) return 'todo';
  if (at < now) return 'done';
  return at === now ? 'waiting' : 'todo';
}

/* -------------------------------------------------------------------
   Loading
   ------------------------------------------------------------------- */

async function renderApprovals () {
  const host = document.getElementById('approvalList');
  if (!host) return;

  /* The same table answers two different questions. Somebody who prepares
     claims is asking where theirs got to; an approver is asking what is
     waiting on them. Naming the screen for whoever opened it costs nothing
     and saves them reading it twice. */
  const prepares = !Auth.role() || Auth.prepares();
  const head = document.getElementById('approvalHead');
  const lead = document.getElementById('approvalLead');
  if (head) head.textContent = prepares ? 'Status' : 'Approvals';
  if (lead) {
    lead.textContent = prepares
      ? 'Everybody, and how far each of their two documents has got this month.'
      : 'What is waiting on you, and how far everything else has got.';
  }

  if (!Sync.on) {
    host.innerHTML = `
      <p class="emptynote"><b>Not connected to the database.</b>
      Approvals travel between five people on five machines, so they need the
      shared database — which this browser cannot reach right now. Nothing has
      been lost: the form is still saved here.</p>`;
    return;
  }

  host.innerHTML = '<p class="emptynote">Loading…</p>';
  try {
    subs = await Sync.submissions('');
  } catch (err) {
    host.innerHTML = `<p class="emptynote">Could not read the approvals: ${err.message}</p>`;
    return;
  }
  await learnKinds();
  // the last column is "is the signed paper on file", which lives over there
  if (typeof ensureArchive === 'function') await ensureArchive();
  // and the Re-submit tab comes and goes with what is sitting in `returned`
  if (typeof loadReturned === 'function') { await loadReturned(); renderStepper(); }
  paintApprovals();
}

/**
 * Find out which document each row is, for the rows that did not say.
 *
 * A row carries its kind as a field of its own, which the list endpoint
 * returns and this then needs nothing for. Until BDOS learns that field the
 * answer is inside the stored form, which costs a request each — so they are
 * fetched once per session, in parallel, and only so many.
 */
async function learnKinds () {
  const missing = subs.filter(s => !Sync.kindOf(s) && !kindCache.has(s.id));
  if (!missing.length) return;
  await Promise.all(missing.slice(0, KIND_LOOKUP_MAX).map(async s => {
    try {
      const full = await Sync.submission(s.id);
      kindCache.set(s.id, Sync.kindOf(full) || 'claim');
    } catch (err) {
      kindCache.set(s.id, 'claim');           // unreadable: read it as it always was
    }
  }));
}

/* -------------------------------------------------------------------
   Who is in the table

   Everybody with a profile, plus anybody who has sent something, plus
   whoever is in the form right now. Profiles are shared through BDOS, so
   this is the same five people on every machine.
   ------------------------------------------------------------------- */
function everybody () {
  const names = new Set();
  const all = Store.profiles();
  Object.keys(all).forEach(n => {
    if (Auth.owns(mergeDefaults(all[n]))) names.add(n.trim());
  });

  /* A consultant sees their own rows. Their own means the profiles that are
     theirs, and anything they sent themselves — a claim submitted before the
     profile was assigned to them is still theirs. Everybody else here reads
     what they approve, so they see all of it. */
  const mine = myEmail();
  subs.forEach(s => {
    const n = String(s.consultant || '').trim();
    if (!n) return;
    if (Auth.seesEveryone() || String(s.created_by || '').toLowerCase() === mine) names.add(n);
  });

  const here = String(S.consultant.name || '').trim();
  if (here) names.add(here);
  return [...names].filter(Boolean).sort();
}

/** every month anybody has sent something for, plus the one on the sheet */
function monthsSeen () {
  const keys = new Set();
  subs.forEach(s => {
    if (s.period_year && s.period_month) {
      keys.add(monthKey(Number(s.period_year), Number(s.period_month) - 1));
    }
  });
  keys.add(monthKey(S.timesheet.year, S.timesheet.month));
  return [...keys].sort().reverse();
}

/** the submission for one person, one month, one document — or null */
function submissionFor (name, when, kind) {
  return subs.filter(s =>
    String(s.consultant || '').trim() === name &&
    Number(s.period_year) === when.y &&
    Number(s.period_month) === when.m + 1 &&
    kindOf(s) === kind)[0] || null;
}

function paintApprovals () {
  const host = document.getElementById('approvalList');
  if (!host) return;

  if (!statusMonth) statusMonth = { y: S.timesheet.year, m: S.timesheet.month };
  host.innerHTML = '';

  const waiting = subs.filter(waitingOnMe);
  host.appendChild(filterBar(waiting.length));

  /* The admin stands in at every stage, so they are the one who can end up
     with a pile. Clearing it one row at a time is the same decision made over
     and over, so they can make it once. */
  if (Auth.isAdmin() && waiting.length > 1) host.appendChild(bulkBar(waiting));

  host.appendChild(statusTable());
}

function filterBar (waiting) {
  const bar = document.createElement('div');
  bar.className = 'statusbar';

  const pick = document.createElement('label');
  pick.className = 'statuspick';
  pick.appendChild(document.createTextNode('Month '));
  const sel = document.createElement('select');
  monthsSeen().forEach(key => {
    const y = Number(key.slice(0, 4)), m = Number(key.slice(5)) - 1;
    const o = document.createElement('option');
    o.value = key;
    o.textContent = `${MONTHS[m]} ${y}`;
    sel.appendChild(o);
  });
  sel.value = monthKey(statusMonth.y, statusMonth.m);
  sel.addEventListener('change', () => {
    statusMonth = { y: Number(sel.value.slice(0, 4)), m: Number(sel.value.slice(5)) - 1 };
    openRow = '';
    paintApprovals();
  });
  pick.appendChild(sel);
  bar.appendChild(pick);

  const count = document.createElement('span');
  count.className = 'statuscount';
  count.textContent = waiting
    ? `${waiting} document${waiting > 1 ? 's are' : ' is'} waiting on you.`
    : 'Nothing is waiting on you.';
  bar.appendChild(count);

  const toggle = document.createElement('label');
  toggle.className = 'statustoggle';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = onlyMine;
  box.addEventListener('change', () => { onlyMine = box.checked; paintApprovals(); });
  toggle.appendChild(box);
  toggle.appendChild(document.createTextNode(' Only what is waiting on me'));
  bar.appendChild(toggle);

  return bar;
}

/* -------------------------------------------------------------------
   The table
   ------------------------------------------------------------------- */

function statusTable () {
  const wrap = document.createElement('div');
  wrap.className = 'statuswrap';

  const table = document.createElement('table');
  table.className = 'statustable';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  hr.appendChild(th('Consultant'));
  hr.appendChild(th('Document'));
  hr.appendChild(lampHead('Sent', Auth.personFor('consultant'),
                          'the consultant submits it'));
  STAGES.forEach(st => hr.appendChild(
    lampHead(st.head, Auth.personFor(st.who), Auth.roleName(st.who) + ' — ' + st.does)));
  hr.appendChild(lampHead('On file', Auth.personFor('pa'),
                          'the signed document is uploaded back into the system'));
  hr.appendChild(th(''));
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  let drawn = 0;

  everybody().forEach(name => {
    KIND_ORDER.forEach((kind, i) => {
      const sub = submissionFor(name, statusMonth, kind);
      if (onlyMine && !waitingOnMe(sub)) return;
      tbody.appendChild(statusRow(name, kind, sub, i === 0));
      drawn++;
      if (sub && openRow === sub.id) tbody.appendChild(decideRow(sub));
    });
  });

  if (!drawn) {
    const tr = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 8;
    cell.className = 'statusempty';
    cell.textContent = onlyMine
      ? 'Nothing in this month is waiting on you.'
      : 'Nobody has a profile yet — save one on the Profile step and they appear here.';
    tr.appendChild(cell);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  wrap.appendChild(table);
  wrap.appendChild(legend());
  return wrap;
}

function th (text) {
  const cell = document.createElement('th');
  cell.textContent = text;
  return cell;
}

/**
 * A stage column heading: what the stage is, and who does it.
 *
 * "Reviewed" on its own tells nobody anything. "Reviewed / Muhammad Hanis
 * Rashidan" tells them who to go and ask, which is what somebody staring at
 * an amber light actually wants to know.
 */
function lampHead (text, who, why) {
  const cell = document.createElement('th');
  cell.className = 'stagecol';
  const name = document.createElement('span');
  name.textContent = text;
  cell.appendChild(name);
  if (who) {
    const person = document.createElement('small');
    person.textContent = who;          // typed by us, but read as text regardless
    cell.appendChild(person);
  }
  cell.title = why || '';
  return cell;
}

/**
 * One person, one document, one month.
 * @param {boolean} first is this the first of the person's two rows? only
 *        that one carries the name, so a person reads as one block
 */
function statusRow (name, kind, sub, first) {
  const tr = document.createElement('tr');
  tr.className = 'statusrow'
    + (first ? ' firstof' : '')
    + (waitingOnMe(sub) ? ' urgent' : '')
    + (sub && sub.status === 'complete' ? ' done' : '')
    + (sub && sub.status === 'returned' ? ' back' : '')
    + (sub ? '' : ' unsent');

  const who = document.createElement('td');
  who.className = 'who';
  who.dataset.col = 'Consultant';
  if (first) {
    const b = document.createElement('b');
    b.textContent = name;
    who.appendChild(b);
    if (sub && sub.invoice_no) {
      const no = document.createElement('small');
      no.textContent = sub.invoice_no;
      who.appendChild(no);
    }
  }
  tr.appendChild(who);

  const doc = document.createElement('td');
  doc.className = 'doc';
  doc.dataset.col = 'Document';
  const tag = document.createElement('span');
  tag.className = 'doctag ' + kind;
  tag.textContent = kindLabel(kind);
  doc.appendChild(tag);
  tr.appendChild(doc);

  // Sent
  tr.appendChild(lampCell(sub ? 'done' : 'todo', 'Sent',
    sub ? sentWhen(sub) : 'not sent yet'));

  // the three approval stages
  STAGES.forEach(st => {
    // an invoice has no HOD signature to place, so that column is not a
    // thing it is waiting for — it is a thing it does not have
    if (sub && st.key === 'pending_signature' && !hasSignatureStage(sub)) {
      tr.appendChild(lampCell('na', st.head,
        'an invoice carries no approver signature — nothing to place'));
      return;
    }
    const state = stageState(sub, st.key);
    const did = sub ? whoDid(sub, st.key) : '';
    tr.appendChild(lampCell(state, st.head,
      !sub ? 'nothing sent yet'
      : state === 'done' ? (did ? 'done by ' + did : 'done')
      : state === 'waiting' ? 'waiting on ' + Auth.personFor(st.who)
      : state === 'returned' ? 'sent back' + (did ? ' by ' + did : '')
      : 'not reached yet'));
  });

  // On file — the signed paper, uploaded back into the system
  const filedBy = typeof archiveBy === 'function'
    ? archiveBy(name, statusMonth.y, statusMonth.m, kind) : '';
  tr.appendChild(lampCell(filedBy ? 'done' : 'todo', 'On file',
    filedBy ? 'uploaded back by ' + filedBy
    : (typeof Sync !== 'undefined' && Sync.archiveOn === false)
      ? 'the archive is not switched on yet'
      : 'not uploaded back yet'));

  const acts = document.createElement('td');
  acts.className = 'statusacts';
  acts.dataset.col = '';
  if (sub) {
    acts.appendChild(button('Read', 'ghost small', () => reviewSubmission(sub.id)));
    if (waitingOnMe(sub)) {
      const verb = sub.status === 'pending_signature' ? 'Sign' : 'Approve';
      acts.appendChild(button(verb, 'small', () => toggleDecide(sub.id, 'approve')));
      acts.appendChild(button('Reject', 'ghost small danger', () => toggleDecide(sub.id, 'return')));
    }
    if (sub.status === 'returned' && (sub.created_by === myEmail() || Auth.isAdmin())) {
      acts.appendChild(button('Open', 'ghost small', () => loadIntoForm(sub.id)));
      acts.appendChild(button('Resubmit', 'small', () => toggleDecide(sub.id, 'resubmit')));
    }
    // the account that set the thing up is the one that clears up after it
    if (Auth.isAdmin()) {
      acts.appendChild(button('Delete', 'ghost small danger', () => deleteSubmission(sub)));
    }
  } else {
    const nothing = document.createElement('span');
    nothing.className = 'statusnone';
    nothing.textContent = 'not sent';
    acts.appendChild(nothing);
  }
  tr.appendChild(acts);
  return tr;
}

function lampCell (state, head, why) {
  const cell = document.createElement('td');
  cell.className = 'stagecell';
  // on a phone the headings are gone and each row becomes a card, so every
  // lamp has to be able to say what it is on its own
  cell.dataset.col = head;
  const lamp = document.createElement('span');
  lamp.className = 'lamp ' + state;
  lamp.textContent = state === 'done' ? '✓'
    : state === 'returned' ? '✕'
    : state === 'waiting' ? '●'
    : state === 'na' ? '–' : '';
  lamp.title = `${head} — ${why}`;
  cell.appendChild(lamp);
  return cell;
}

/**
 * Who actually moved this document past one stage, and when.
 *
 * The heading says who is meant to; this says who did. They are usually the
 * same person and occasionally not — the admin stands in when somebody is on
 * a plane — and a light that cannot tell you which is a light you end up
 * asking about anyway.
 */
function whoDid (sub, stageKey) {
  const moved = (sub.history || []).filter(h => h.from === stageKey &&
                                                (h.action === 'approve' || h.action === 'return'))[0];
  if (!moved) return '';
  const when = moved.at ? new Date(moved.at).toLocaleDateString() : '';
  return (moved.by || 'somebody') + (when ? ' on ' + when : '');
}

function sentWhen (sub) {
  const first = (sub.history || [])[0];
  const when = first && first.at ? new Date(first.at).toLocaleDateString() : '';
  return when ? 'sent ' + when : 'sent';
}

function legend () {
  const box = document.createElement('div');
  box.className = 'statuslegend';
  [['done', '✓', 'done'],
   ['waiting', '●', 'waiting here now'],
   ['returned', '✕', 'sent back from here'],
   ['todo', '', 'not yet']
  ].forEach(([cls, mark, text]) => {
    const item = document.createElement('span');
    const lamp = document.createElement('i');
    lamp.className = 'lamp ' + cls;
    lamp.textContent = mark;
    item.appendChild(lamp);
    item.appendChild(document.createTextNode(' ' + text));
    box.appendChild(item);
  });
  return box;
}

/* -------------------------------------------------------------------
   Bulk decisions, for the account that stands in everywhere
   ------------------------------------------------------------------- */

function bulkBar (waiting) {
  const bar = document.createElement('div');
  bar.className = 'bulkbar';

  const said = document.createElement('span');
  said.textContent = 'Clear them in one go:';
  bar.appendChild(said);

  const note = document.createElement('input');
  note.className = 'dinput';
  note.placeholder = 'Reason — needed to reject';
  bar.appendChild(note);

  bar.appendChild(button('Approve all', 'small', () => bulk(waiting, 'approve', note.value.trim())));
  bar.appendChild(button('Reject all', 'ghost small danger',
                         () => bulk(waiting, 'return', note.value.trim())));
  return bar;
}

async function bulk (waiting, action, note) {
  if (busy) return;
  if (action === 'return' && !note) {
    toast('Say why — every one of them gets sent back with this note.', true);
    return;
  }
  /* A time sheet can be signed in bulk, using the signature this machine
     remembers; an invoice is not signed at all, so it simply goes. A stage
     that signs a document with no box to draw in would need a scan only a
     person can produce — none exists today, but were one added it would be
     left where it is and said so. */
  const needsScan = action === 'approve'
    ? waiting.filter(s => mustSign(s) && !signsFor(s)) : [];
  const canDo = waiting.filter(s => needsScan.indexOf(s) < 0);
  const signing = action === 'approve' && canDo.some(s => signsFor(s));
  if (signing && !myLastSignature()) {
    toast('Approve one time sheet on its own first, so the app has your signature to place.', true);
    return;
  }
  if (!canDo.length) {
    toast('Every one of these needs a signed file uploaded, which has to be done one at a time.', true);
    return;
  }
  if (!confirm(`${action === 'approve' ? 'Approve' : 'Reject'} ${canDo.length} document${canDo.length > 1 ? 's' : ''}?` +
    (needsScan.length ? `\n\n${needsScan.length} need a signed file uploaded and are left alone.` : ''))) return;

  busy = true;
  let done = 0;
  const failed = [];
  for (const sub of canDo) {
    try {
      const signs = action === 'approve' ? signsFor(sub) : null;
      let data;
      if (signs) {
        const full = await Sync.submission(sub.id);
        data = mergeDefaults((full && full.data) || {});
        data.sig[signs.sig] = myLastSignature();
        data.timesheet[signs.name] = (Auth.user() || {}).name || data.timesheet[signs.name] || '';
        data.timesheet[signs.date] = todayDotted();
        // the day somebody signed is a fact, not a default to be kept current
        (data.timesheet.dateAuto = data.timesheet.dateAuto || {})[signs.auto] = false;
      }
      await Sync.act(sub.id, action, note, data);
      done++;
    } catch (err) {
      // one that somebody else moved first must not stop the rest
      failed.push(`${sub.consultant || sub.id}: ${err.message}`);
    }
  }
  busy = false;
  const left = needsScan.length ? ` ${needsScan.length} still need a signed file.` : '';
  toast(failed.length
    ? `${done} done, ${failed.length} could not be: ${failed[0]}`
    : `${done} documents ${action === 'approve' ? 'approved' : 'sent back'}.` + left,
    !!failed.length);
  await renderApprovals();
}

/* -------------------------------------------------------------------
   Deciding
   ------------------------------------------------------------------- */

let decideAction = 'approve';

function toggleDecide (id, action) {
  openRow = (openRow === id && decideAction === action) ? '' : id;
  decideAction = action;
  paintApprovals();
}

/** the expanded panel, as a row of its own under the row it belongs to */
function decideRow (sub) {
  const tr = document.createElement('tr');
  tr.className = 'decidetr';
  const cell = document.createElement('td');
  cell.colSpan = 8;
  cell.appendChild(decideBox(sub));
  tr.appendChild(cell);
  return tr;
}

function decideBox (sub) {
  const box = document.createElement('div');
  box.className = 'decidebox';
  const signs = decideAction === 'approve' ? signsFor(sub) : null;
  const signing = decideAction === 'approve' && mustSign(sub);
  const stage = STAGE_BY_KEY[sub.status] || {};

  const head = document.createElement('p');
  head.className = 'decidehead';
  head.textContent =
    decideAction === 'return' ? 'Send this document back — say what needs fixing'
    : decideAction === 'resubmit' ? 'Send this document back for approval'
    : signs ? 'Sign and approve'
    : signing ? `Sign the ${kindLabel(kindOf(sub)).toLowerCase()} and pass it on`
    : kindOf(sub) !== 'claim' && sub.status !== 'pending_signature'
      ? 'Approve the invoice — there is nothing on it for an approver to sign'
    : sub.status === 'pending_signature'
      ? 'Close the invoice — there is no signature to place on one'
      : `Approve the ${kindLabel(kindOf(sub)).toLowerCase()}`;
  box.appendChild(head);

  let pad = null;
  if (signs) {
    const padHost = document.createElement('div');
    padHost.className = 'decidepad';
    box.appendChild(padHost);
    // an approver signs the same way every month; theirs is remembered on
    // this machine so it does not have to be drawn again each time
    pad = makePad(padHost, myLastSignature());
  }

  /* Signing happens two ways, and both are real. In the app, where the
     document has a box to draw in; or on paper, in a room, with a pen, and
     then scanned back in. A stage that signs will not pass a document on
     without one of them, and the scan is kept — it is the thing anybody will
     be asked for a year later. */
  let filed = null;
  if (signing) {
    const drop = document.createElement('div');
    drop.className = 'decidefile' + (signs ? '' : ' required');
    const cap = document.createElement('span');
    cap.textContent = signs
      ? `Or, if it was signed on paper, upload the ${stage.filed} document:`
      : `Upload the ${kindLabel(kindOf(sub)).toLowerCase()} you have signed:`;
    drop.appendChild(cap);
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.pdf,.png,.jpg,.jpeg,image/*,application/pdf';
    drop.appendChild(inp);
    const why = document.createElement('small');
    why.textContent = signs
      ? 'Either is enough — draw above, or upload here. Whatever is uploaded is kept on file.'
      : `An ${kindLabel(kindOf(sub)).toLowerCase()} has no box for an approver to sign, so the ` +
        'signed file is the only thing there is to put your name to.';
    drop.appendChild(why);
    box.appendChild(drop);
    filed = inp;
  }

  const note = document.createElement('textarea');
  note.className = 'decidenote';
  note.rows = 2;
  note.placeholder = decideAction === 'return'
    ? 'What needs to change? The consultant sees this.'
    : 'Anything to add (optional)';
  box.appendChild(note);

  const bar = document.createElement('div');
  bar.className = 'btnrow';
  const go = button(
    decideAction === 'return' ? 'Send it back'
      : decideAction === 'resubmit' ? 'Resubmit'
      : sub.status === 'pending_signature' ? (signing ? 'Mark it signed' : 'Close it')
      : signing ? 'Sign and pass it on' : 'Confirm',
    decideAction === 'return' ? 'danger' : 'primary',
    () => decide(sub, note.value.trim(), pad, filed, go));
  bar.appendChild(go);
  bar.appendChild(button('Cancel', 'ghost', () => { openRow = ''; paintApprovals(); }));
  box.appendChild(bar);
  return box;
}

async function decide (sub, note, pad, filed, go) {
  if (busy) return;
  if (decideAction === 'return' && !note) {
    toast('Say what needs fixing — the consultant only sees this note.', true);
    return;
  }
  const signs = decideAction === 'approve' ? signsFor(sub) : null;
  const signing = decideAction === 'approve' && mustSign(sub);
  const file = filed && filed.files && filed.files[0];

  /* A stage that signs does not pass anything on unsigned. Where the document
     has a box, drawing in it or uploading a signed scan will both do; where
     it has none — an invoice — the scan is the only thing there is. */
  if (signing && signs && pad.isEmpty() && !file) {
    toast('Sign the box, or upload the document you signed on paper.', true);
    return;
  }
  if (signing && !signs && !file) {
    toast(`Upload the signed ${kindLabel(kindOf(sub)).toLowerCase()} before passing it on.`, true);
    return;
  }
  if (file && file.size > ARCHIVE_MAX_BYTES) {
    toast(`${file.name} is over the ${Math.round(ARCHIVE_MAX_BYTES / 1048576)} MB limit.`, true);
    return;
  }

  busy = true;
  const was = go && go.textContent;
  if (go) { go.disabled = true; go.textContent = 'Working…'; }
  try {
    let data;
    if (signs && !pad.isEmpty()) {
      // the signature goes onto the sheet itself, so the whole form goes
      // back up with it — BDOS keeps the order, not the shape of the form
      const full = await Sync.submission(sub.id);
      data = mergeDefaults((full && full.data) || {});
      const png = pad.value();
      data.sig[signs.sig] = png;
      // whoever actually signed is the name that goes beside the signature,
      // even when it is the admin standing in for somebody away
      data.timesheet[signs.name] = (Auth.user() || {}).name || data.timesheet[signs.name] || '';
      data.timesheet[signs.date] = todayDotted();
      // the day somebody signed is a fact, not a default to be kept current
      (data.timesheet.dateAuto = data.timesheet.dateAuto || {})[signs.auto] = false;
      rememberSignature(png);
    }

    /* Resubmitting sends the form as it stands when the form as it stands is
       this document. Sending the stored copy would hand the approver the very
       document they rejected. */
    if (decideAction === 'resubmit' && typeof fixingId === 'function' &&
        fixingId() === sub.id) {
      data = S;
    }

    /* File first, then move the document on. A file that is on record for a
       document still waiting is a small oddity; a document marked complete
       with the file lost to a failed upload is a month nobody can produce. */
    if (file) await fileFinished(sub, file, note);

    await Sync.act(sub.id, decideAction, note, data);
    openRow = '';
    toast(decideAction === 'return' ? 'Sent back to the consultant.'
        : decideAction === 'resubmit' ? 'Sent for approval again.'
        : sub.status === 'pending_signature' ? 'Signed and filed.'
        : 'Approved.');
    if (typeof renderArchive === 'function' && file) await renderArchive(true);
    await renderApprovals();
  } catch (err) {
    // 403 and 409 are the interesting ones: somebody else moved it first,
    // or this account was never the one to move it
    toast(err.message || 'Could not record that.', true);
  } finally {
    busy = false;
    if (go) { go.disabled = false; if (was) go.textContent = was; }
  }
}

/**
 * Put a signed document on file, against its month and the stage that signed
 * it. The stage matters: the project manager's copy is evidence that it was
 * reviewed, and the PA's is the finished article — only the second one is
 * what the table's "On file" column is asking about.
 */
async function fileFinished (sub, file, note) {
  const full = await Sync.submission(sub.id);
  const state = mergeDefaults((full && full.data) || {});
  const kind = kindOf(sub);
  const stage = STAGE_BY_KEY[sub.status] || {};
  const what = stage.filed || 'signed';
  const payload = await Sync.readFile(file);
  payload.name = `${kindLabel(kind)} (${what}) — ${payload.name}`;
  await Sync.store(state, [payload],
    [note, `${kindLabel(kind)} ${what} by ${(Auth.user() || {}).name || myEmail()}`]
      .filter(Boolean).join(' · '), kind, sub.status);
}

/* -------------------------------------------------------------------
   Reading a document
   ------------------------------------------------------------------- */

/**
 * Erase one claim, for the account that set the thing up.
 *
 * The confirmation names the document, the month and the number, because the
 * rows worth deleting look exactly like the rows that must never be — three
 * identical test submissions and one real one are the same four lines on a
 * screen, and the difference is in the detail.
 *
 * @param {function} [after] run when it is gone
 */
async function deleteSubmission (sub, after) {
  if (busy) return;
  const what = kindLabel(kindOf(sub)).toLowerCase();
  const who = sub.consultant || 'somebody';
  if (!confirm(
    `Delete the ${what} for ${periodOf(sub)}?\n\n` +
    `${who}${sub.invoice_no ? ' · ' + sub.invoice_no : ''}\n\n` +
    'It goes from the database for everybody, and the trail goes with it — who ' +
    'approved it, when, and what they said. This cannot be undone.')) return;

  busy = true;
  try {
    await Sync.remove(sub.id);
    toast('Deleted.');
    if (typeof loadReturned === 'function') await loadReturned();
    if (typeof renderResubmit === 'function') await renderResubmit();
    renderStepper();
    await renderApprovals();
    if (typeof after === 'function') after();
  } catch (err) {
    toast(err.message || 'Could not delete it.', true);
  } finally {
    busy = false;
  }
}

function button (label, cls, onClick) {
  const b = document.createElement('button');
  b.className = 'btn ' + cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/** rebuild the document exactly as it was submitted, and show it */
async function reviewSubmission (id) {
  try {
    const sub = await Sync.submission(id);
    if (!sub || !sub.data) { toast('That document could not be read.', true); return; }
    const state = mergeDefaults(sub.data);
    const kind = Sync.kindOf(sub) || kindCache.get(id) || 'claim';
    // read the document that was sent, not the other one
    const doc = kind === 'invoice' ? await buildInvoicePDF(state) : await buildClaimPDF(state);
    const base = kind === 'invoice' ? invoiceFileBase(state) : claimFileBase(state);
    openPdfPreview(
      `${state.consultant.name || 'Claim'} — ${kindLabel(kind)} — ${STATUS_TEXT[sub.status] || sub.status}`,
      `${base}.pdf`, doc);
  } catch (err) {
    toast(err.message || 'Could not open that document.', true);
  }
}

/** a document that came back: put it in the form so it can be fixed */
async function loadIntoForm (id) {
  try {
    const sub = await Sync.submission(id);
    if (!sub || !sub.data) { toast('That document could not be read.', true); return; }
    adoptSubmission(sub);
  } catch (err) {
    toast(err.message || 'Could not open that document.', true);
  }
}

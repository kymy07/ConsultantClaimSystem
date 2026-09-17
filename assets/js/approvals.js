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
let statusMonth = null;        // { y, m } — the month the table is showing
const kindCache = new Map();   // submission id → 'invoice' | 'claim'

/** Plain text keeps server errors safe; the retry stays beside the problem. */
function workflowMessage (host, message, retry) {
  host.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'emptynote workflow-state' + (retry ? ' error' : '');
  const words = document.createElement('p');
  words.setAttribute('role', retry ? 'alert' : 'status');
  words.textContent = message;
  box.appendChild(words);
  if (retry) box.appendChild(button('Try again', 'ghost small', retry));
  host.appendChild(box);
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

/**
 * Which documents the table draws a row for.
 *
 * The consultant's two, and for anybody in the office the payment advice
 * as well. A consultant seeing a row for a form they are not allowed to
 * read is worse than not seeing it at all: they would ask about it.
 */
const kindsOnStatus = () =>
  (Auth.seesOfficeDocuments() ? KIND_ORDER.concat('advice') : KIND_ORDER.slice());

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
/* Everything but the invoice reaches the PA: the time sheet for the HOD's
   signature, and the payment advice for both of his and hers. */
const hasSignatureStage = sub => kindOf(sub) !== 'invoice';

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
      ? 'Track your time sheets and invoices by month. Open a document to see its details.'
      : 'Choose a month, review the documents waiting on you, and track their approval progress.';
  }

  if (!Sync.on) {
    host.innerHTML = Sync.offlineNote(
      'Approvals travel between five people on five machines, so they need the ' +
      'shared database — which this browser cannot reach right now. Nothing has ' +
      'been lost: the form is still saved here.');
    return;
  }

  workflowMessage(host, 'Loading approvals and signed copies…');
  host.setAttribute('aria-busy', 'true');
  try {
    subs = await Sync.submissions('');
    await learnKinds();
    // The signed paper and returned documents complete the status picture.
    if (typeof ensureArchive === 'function') await ensureArchive();
    if (typeof loadReturned === 'function') { await loadReturned(); renderStepper(); }
    paintApprovals();
  } catch (err) {
    workflowMessage(host, 'Approvals could not be loaded. ' +
      (err.message || 'Check your connection and try again.'), renderApprovals);
  } finally {
    host.removeAttribute('aria-busy');
  }
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
  if (statusMonth) keys.add(monthKey(statusMonth.y, statusMonth.m));
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

  const waiting = subs.filter(s => waitingOnMe(s) &&
    Number(s.period_year) === statusMonth.y && Number(s.period_month) === statusMonth.m + 1);
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
  sel.id = 'statusMonthFilter';
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
    if (typeof renderArchive === 'function') renderArchive();
    document.getElementById('statusMonthFilter').focus();
  });
  pick.appendChild(sel);
  bar.appendChild(pick);

  const count = document.createElement('span');
  count.className = 'statuscount';
  count.setAttribute('role', 'status');
  count.textContent = Auth.approves()
    ? waiting
      ? `${waiting} document${waiting > 1 ? 's need' : ' needs'} your review this month.`
      : 'Nothing is waiting on you. You are up to date for this month.'
    : 'Time sheets and invoices are tracked separately.';
  bar.appendChild(count);

  return bar;
}

/* -------------------------------------------------------------------
   The table
   ------------------------------------------------------------------- */

function statusTable () {
  const wrap = document.createElement('div');
  wrap.className = 'statuswrap';
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', 'Document approval progress');

  const table = document.createElement('table');
  table.className = 'statustable';
  const caption = document.createElement('caption');
  caption.className = 'sr-only';
  caption.textContent = `Document status for ${MONTHS[statusMonth.m]} ${statusMonth.y}`;
  table.appendChild(caption);

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
  hr.appendChild(th('Actions'));
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  let drawn = 0;

  everybody().forEach(name => {
    kindsOnStatus().forEach((kind, i) => {
      const sub = submissionFor(name, statusMonth, kind);
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
    cell.textContent = 'No profiles to show yet. Save a consultant profile to start tracking documents.';
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
  cell.scope = 'col';
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
  cell.scope = 'col';
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
 * @param {boolean} first is this the first of the person's two rows?
 *        Each card keeps its name so it also makes sense on a phone.
 */
function statusRow (name, kind, sub, first) {
  const tr = document.createElement('tr');
  tr.className = 'statusrow'
    + (first ? ' firstof' : '')
    + (waitingOnMe(sub) ? ' urgent' : '')
    + (sub && sub.status === 'complete' ? ' done' : '')
    + (sub && sub.status === 'returned' ? ' back' : '')
    + (sub ? '' : ' unsent');

  /* One name per person, not one per document. The rows under it are the
     same person's, and repeating the name three times reads as three people.
     The cell is still there, empty, rather than spanned: an open decision
     panel puts a full-width row in the middle of somebody's rows, and a
     spanned cell would have every column after it sliding sideways. */
  const who = document.createElement('td');
  who.className = 'who' + (first ? '' : ' cont');
  who.dataset.col = first ? 'Consultant' : '';
  if (first) {
    const b = document.createElement('b');
    b.textContent = name;
    who.appendChild(b);
    if (sub && sub.invoice_no) {
      const no = document.createElement('small');
      no.textContent = sub.invoice_no;
      who.appendChild(no);
    }
    /* An empty profile a letter off another is a slip, not a person; the
       administrator is told so here and offered to take it off. */
    if (!sub && typeof duplicateProfileNote === 'function') {
      const dup = duplicateProfileNote(name, () => renderApprovals());
      if (dup) who.appendChild(dup);
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
  const status = document.createElement('span');
  status.className = 'status-label ' + (sub ? sub.status : 'unsent');
  status.textContent = sub ? (STATUS_TEXT[sub.status] || 'Status unavailable') : 'Not submitted';
  doc.appendChild(status);
  tr.appendChild(doc);

  // Sent
  tr.appendChild(lampCell(sub ? 'done' : 'todo', 'Sent',
    sub ? sentWhen(sub) : 'not sent yet'));

  // the three approval stages
  STAGES.forEach(st => {
    // an invoice has no HOD signature to place, so that column is not a
    // thing it is waiting for — it is a thing it does not have
    if (st.key === 'pending_signature' && (kind === 'invoice' || (sub && !hasSignatureStage(sub)))) {
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
  /* A copy on file belongs to a claim. With the claim gone there is
     nothing for it to be the copy of, so the lamp goes back to waiting
     rather than reporting a month that is no longer there. */
  const filedBy = sub && typeof archiveBy === 'function'
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
    const read = button('View', 'ghost small', () => reviewSubmission(sub.id));
    read.setAttribute('aria-label', `View ${kindLabel(kind)} for ${name}, ${periodOf(sub)}`);
    acts.appendChild(read);
    if (waitingOnMe(sub)) {
      const verb = sub.status === 'pending_signature' ? 'Sign' : 'Approve';
      const approve = button(verb, 'small', () => toggleDecide(sub.id, 'approve'));
      approve.setAttribute('aria-expanded', String(openRow === sub.id && decideAction === 'approve'));
      approve.setAttribute('aria-label', `${verb} ${kindLabel(kind)} for ${name}, ${periodOf(sub)}`);
      acts.appendChild(approve);
      const reject = button('Send back', 'ghost small danger', () => toggleDecide(sub.id, 'return'));
      reject.setAttribute('aria-expanded', String(openRow === sub.id && decideAction === 'return'));
      reject.setAttribute('aria-label', `Send back ${kindLabel(kind)} for ${name}, ${periodOf(sub)}`);
      acts.appendChild(reject);
    }
    /* An invoice approved before CCS filed them itself is finished but has
       no copy on record, so it never reached whoever collects the paper.
       One press puts it there. */
    if (sub.status === 'complete' && kind === 'invoice' && Sync.archiveOn &&
        typeof canFileSigned === 'function' && canFileSigned() &&
        typeof archiveHas === 'function' &&
        !archiveHas(name, statusMonth.y, statusMonth.m, 'invoice')) {
      const put = button('File it', 'ghost small', () => fileInvoiceNow(sub, put));
      put.title = 'Put the approved invoice on file, so the month has its copy';
      acts.appendChild(put);
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
  lamp.setAttribute('aria-hidden', 'true');
  cell.appendChild(lamp);
  const text = document.createElement('span');
  text.className = 'stage-status ' + state;
  text.textContent = state === 'done' ? 'Done' : state === 'waiting' ? 'Waiting'
    : state === 'returned' ? 'Returned' : state === 'na' ? 'N/A' : 'Pending';
  cell.setAttribute('aria-label', `${head}: ${why}`);
  cell.appendChild(text);
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
  said.textContent = `Bulk review · ${MONTHS[statusMonth.m]} ${statusMonth.y} · ${waiting.length} documents`;
  bar.appendChild(said);

  const note = document.createElement('input');
  note.className = 'dinput';
  note.placeholder = 'Reason — needed to reject';
  note.setAttribute('aria-label', 'Reason for sending all listed documents back');
  bar.appendChild(note);

  bar.appendChild(button(`Approve all (${waiting.length})`, 'small', () => bulk(waiting, 'approve', note.value.trim())));
  bar.appendChild(button(`Send all back (${waiting.length})`, 'ghost small danger',
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
      const moved = await Sync.act(sub.id, action, note, data);
      if (action === 'approve') await fileApprovedInvoice(sub, moved);
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
  if (openRow) {
    const panel = document.querySelector('#approvalList .decidebox');
    if (panel) panel.focus();
  }
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
  box.tabIndex = -1;
  box.setAttribute('role', 'region');
  box.setAttribute('aria-labelledby', 'approvalDecisionHeading');
  const signs = decideAction === 'approve' ? signsFor(sub) : null;
  const signing = decideAction === 'approve' && mustSign(sub);
  const stage = STAGE_BY_KEY[sub.status] || {};

  const head = document.createElement('p');
  head.className = 'decidehead';
  head.id = 'approvalDecisionHeading';
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
  const context = document.createElement('p');
  context.className = 'status-context';
  context.textContent = `${sub.consultant || 'Consultant'} · ${kindLabel(kindOf(sub))} · ${periodOf(sub)}`;
  box.appendChild(context);

  let pad = null;
  if (signs) {
    const padHost = document.createElement('div');
    padHost.className = 'decidepad sigprofile';
    box.appendChild(padHost);
    /* The same control the Profile step uses: what is on record, then draw
       it or read it off a scan, with the box over the ink and a preview
       before anything is kept. An approver signs the same way every month,
       so theirs is remembered on this machine and shown already chosen. */
    let chosen = myLastSignature();
    mountSignaturePicker(padHost, { get: () => chosen, set: url => { chosen = url; } });
    pad = { value: () => chosen, isEmpty: () => !chosen };
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
    inp.setAttribute('aria-label', `Upload the signed ${kindLabel(kindOf(sub)).toLowerCase()}`);
    inp.accept = '.pdf,.png,.jpg,.jpeg,image/*,application/pdf';
    drop.appendChild(inp);
    const why = document.createElement('small');
    why.textContent = signs
      ? 'Draw above or upload a signed copy. PDF or image, up to 12 MB. Uploaded copies are kept on file.'
      : `An ${kindLabel(kindOf(sub)).toLowerCase()} has no box for an approver to sign, so the ` +
        'signed file is the only thing there is to put your name to.';
    drop.appendChild(why);
    box.appendChild(drop);
    filed = inp;
  }

  const noteLabel = document.createElement('label');
  noteLabel.className = 'fieldlabel';
  noteLabel.htmlFor = 'approvalDecisionNote';
  noteLabel.textContent = decideAction === 'return' ? 'Reason for returning (required)' : 'Note to the consultant (optional)';
  box.appendChild(noteLabel);
  const note = document.createElement('textarea');
  note.id = 'approvalDecisionNote';
  note.className = 'decidenote';
  note.rows = 2;
  note.required = decideAction === 'return';
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
    () => {
      if (decideAction === 'return' && !note.value.trim()) {
        note.setCustomValidity('Explain what the consultant needs to change.');
        note.reportValidity();
        note.focus();
        return;
      }
      decide(sub, note.value.trim(), pad, filed, go);
    });
  note.addEventListener('input', () => note.setCustomValidity(''));
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

    const moved = await Sync.act(sub.id, decideAction, note, data);
    /* An approved invoice is finished here: nobody signs one, so the copy
       worth keeping is the invoice as it was approved, and it is filed now
       rather than waiting for a signature that does not exist. */
    if (decideAction === 'approve') await fileApprovedInvoice(sub, moved);
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

/* -------------------------------------------------------------------
   An approved invoice is a finished document

   A time sheet becomes paper: it goes out, gets signed, and the scan that
   comes back is the finished article. An invoice never does. It carries one
   signature, the consultant's, it is already on the document when it is
   sent, and the HOD approving it is the last thing that happens to it.

   So the moment the HOD approves one it is finished, and the copy worth
   keeping is the invoice exactly as it was approved. CCS files that copy
   itself rather than waiting for somebody to upload a signed version that
   will never exist — which is what left approved invoices out of the list
   Group People & Finance collects from.
   ------------------------------------------------------------------- */

/** build the invoice as it stands on the record and put it on file */
async function storeInvoiceCopy (sub) {
  const full = await Sync.submission(sub.id);
  if (!full || !full.data) throw new Error('That invoice could not be read.');
  const state = mergeDefaults(full.data);
  const doc = await buildInvoicePDF(state);
  const name = invoiceFileBase(state) + '.pdf';
  // Sync.readFile wants something with a name on it, which a blob has not
  const payload = await Sync.readFile(
    new File([doc.output('blob')], name, { type: 'application/pdf' }));
  payload.name = `${kindLabel('invoice')} (approved) — ${payload.name}`;
  await Sync.store(state, [payload],
    `${kindLabel('invoice')} approved — filed as it was approved`,
    'invoice', ARCHIVE_FINAL);
  archiveLoaded = false;            // the On file column has something to read
}

/**
 * File the copy, if this approval is the one that finished an invoice.
 *
 * Quietly: the approval itself has already happened and is what mattered.
 * A failure here is worth saying out loud, but it must not be reported as
 * though the invoice had not been approved.
 */
async function fileApprovedInvoice (sub, moved) {
  if (kindOf(sub) !== 'invoice') return;
  if (!moved || moved.status !== 'complete') return;
  if (!Sync.archiveOn) return;
  if (typeof archiveHas === 'function' &&
      archiveHas(sub.consultant, sub.period_year, Number(sub.period_month) - 1, 'invoice')) return;
  try {
    await storeInvoiceCopy(sub);
  } catch (err) {
    console.warn(err);
    toast('Approved. The copy could not be filed: ' + (err.message || err), true);
  }
}

/** the same thing, for an invoice that was approved before this was here */
async function fileInvoiceNow (sub, btn) {
  if (busy) return;
  busy = true;
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Filing…';
  try {
    await storeInvoiceCopy(sub);
    toast('The approved invoice is on file.');
    if (typeof renderArchive === 'function') await renderArchive(true);
    await renderApprovals();
  } catch (err) {
    toast(err.message || 'Could not file it.', true);
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = was;
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
    /* And whatever was filed against it. A signed copy is the copy of a
       claim; once the claim is gone it is a file nobody can place, and it
       would still light the On file column for a month that has nothing in
       it. Only copies this account may remove go — BDOS refuses the rest. */
    const mine = myEmail();
    const orphans = (typeof archive !== 'undefined' ? archive : []).filter(r =>
      String(r.consultant || '').trim() === String(sub.consultant || '').trim() &&
      Number(r.period_year) === Number(sub.period_year) &&
      Number(r.period_month) === Number(sub.period_month) &&
      (!r.kind || r.kind === kindOf(sub)) &&
      (Auth.isAdmin() || String(r.created_by || '').toLowerCase() === mine));
    for (const r of orphans) {
      try {
        await Sync.unstore(r.id);
        archive = archive.filter(x => x.id !== r.id);
      } catch (err) { /* already gone, or not ours to remove */ }
    }
    toast(orphans.length ? 'Deleted, with its filed cop' + (orphans.length === 1 ? 'y.' : 'ies.')
                         : 'Deleted.');
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

/* -------------------------------------------------------------------
   Icons

   A button that does one obvious thing to one obvious file reads better
   as a picture than as a word, and a row of them reads better still: two
   words repeated down a column is noise, two shapes is a pattern.

   Drawn rather than typed. An emoji is a font question — whichever font
   the machine happens to have decides whether an eye is an eye or a
   hollow box, and on the machine this was found on the download arrow
   came out as a question mark. An inline SVG is the same drawing
   everywhere, takes the colour of the text around it, and scales with it.

   Every icon still travels with a word: `title` for the mouse and
   `aria-label` for a screen reader, because a picture alone is a guess.
   ------------------------------------------------------------------- */

const ICON_PATHS = {
  /* an eye — look at it without taking it away */
  view: 'M1.7 8S4.5 3.2 8 3.2 14.3 8 14.3 8 11.5 12.8 8 12.8 1.7 8 1.7 8Z|M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  /* an arrow into a tray — take a copy away */
  download: 'M8 2.6v6.9|M5.2 7.1 8 9.9l2.8-2.8|M2.8 11.4v1.1a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1v-1.1',
  /* a bin — take it off the record altogether */
  remove: 'M3.2 4.6h9.6|M6.4 4.6V3.4a.8.8 0 0 1 .8-.8h1.6a.8.8 0 0 1 .8.8v1.2|M4.4 4.6l.5 7.6a1 1 0 0 0 1 .9h4.2a1 1 0 0 0 1-.9l.5-7.6|M6.9 7v3.6|M9.1 7v3.6'
};

/**
 * One icon, as an inline SVG that inherits the text colour around it.
 * @param {string} name  a key of ICON_PATHS
 */
function icon (name) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('focusable', 'false');
  // the word beside it is what is read out; the drawing is decoration
  svg.setAttribute('aria-hidden', 'true');
  String(ICON_PATHS[name] || '').split('|').filter(Boolean).forEach(d => {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  });
  return svg;
}

/**
 * A button that is a picture, with the word it stands for kept where
 * anybody who needs it can still get at it.
 *
 * @param {string} name   which icon
 * @param {string} label  what it does, in words — the tooltip and the
 *                        label a screen reader reads
 * @param {function} onClick  handed the button itself, since one that is
 *                        fetching something has to be able to disable it
 */
function iconButton (name, label, cls, onClick) {
  const b = button('', 'iconbtn ' + (cls || ''), () => onClick(b));
  b.type = 'button';
  b.appendChild(icon(name));
  b.title = label;
  b.setAttribute('aria-label', label);
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
    const doc = kind === 'invoice' ? await buildInvoicePDF(state)
      : kind === 'advice' ? await buildAdvicePDF(state)
      : await buildClaimPDF(state);
    const base = kind === 'invoice' ? invoiceFileBase(state)
      : kind === 'advice' ? adviceFileBase(state)
      : claimFileBase(state);
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

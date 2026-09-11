/* =======================================================================
   resubmit.js — the documents that came back, and putting them right

   A rejection is not a status, it is a job. Somebody read the claim, found
   something wrong with it, wrote down what, and sent it back — and until
   that one thing is fixed and the document goes round again, nobody is
   getting paid for that month.

   So it is a step of its own, and it appears by itself: the moment
   something of yours is sent back, a Re-submit tab is there with a number
   on it, carrying the reason in the approver's own words. Fix the one
   thing, send it round again, and it goes the same way it went the first
   time — the project manager, then the HOD, then the PA.

   The important part is the last one. Resubmitting used to send the stored
   form back up unchanged, so the fix travelled nowhere: the approver got
   the same document they had already rejected. What is opened here is
   remembered, and what is sent is the form as it stands.
   ======================================================================= */

const FIXING_KEY = 'ccs.fixing';        // the submission open in the form, across reloads

let returned = [];                      // what has come back, for this account
let resubmitBusy = false;
let putBack = null;                     // returns the borrowed step to its panel


/* -------------------------------------------------------------------
   Editing it here

   The document that came back is drawn by a step of its own, and sending
   somebody there to change one number meant leaving this card, finding the
   thing, changing it, and finding the way back. So the step is brought
   here instead: its contents are moved into the card and moved back
   afterwards.

   Moved, not copied. The replica is bound to the state by `data-bind` and
   carries live signature pads; a second copy would be a second form
   fighting the first over the same claim.
   ------------------------------------------------------------------- */

/** put the borrowed step back where it came from */
function releaseEditor () {
  if (putBack) {
    try { putBack(); } catch (err) { console.warn(err); }
  }
  putBack = null;
}

/**
 * Move the step that draws this document into `host`.
 * @returns {function|null} what to call to give it back
 */
function borrowDocument (kind, host) {
  const panel = document.getElementById(kind === 'invoice' ? 'p-invoice' : 'p-claim');
  if (!panel) return null;

  // the heading belongs to the step, not to a card that has its own; the
  // nav row is rebuilt from scratch every time a step is shown
  const moved = [...panel.children].filter(
    el => el.tagName !== 'H2' && !el.classList.contains('navrow'));
  moved.forEach(el => host.appendChild(el));
  host.hidden = false;

  // canvases can only be measured once they are somewhere visible
  setTimeout(() => Sig.resizeAll(), 40);

  return () => {
    host.hidden = true;
    moved.forEach(el => panel.appendChild(el));
  };
}

/** the document currently open in the form to be fixed, '' when none */
function fixingId () {
  try { return localStorage.getItem(FIXING_KEY) || ''; } catch (e) { return ''; }
}
function setFixing (id) {
  try {
    if (id) localStorage.setItem(FIXING_KEY, id);
    else localStorage.removeItem(FIXING_KEY);
  } catch (e) { /* private window */ }
}

/** is this account the one who has to fix it? */
function mineToFix (sub) {
  return String(sub.created_by || '').toLowerCase() === myEmail() || Auth.isAdmin();
}

/**
 * Ask what has come back. Called at sign-in, so the tab is there before
 * anybody goes looking for it, and again whenever the status table reloads.
 */
async function loadReturned () {
  if (!Sync.on) { returned = []; return returned; }
  try {
    returned = (await Sync.submissions('returned')).filter(mineToFix);
  } catch (err) {
    returned = [];
  }
  return returned;
}

/** how many are waiting to be put right — what the tab counts */
const returnedCount = () => returned.length;

/* -------------------------------------------------------------------
   The step
   ------------------------------------------------------------------- */

/**
 * Should the step open the document by itself?
 *
 * Almost always the answer is yes: somebody whose invoice was rejected has
 * come here to fix that invoice, and making them press a button to be handed
 * the thing they came for is a button for its own sake.
 *
 * The exception is the one that would cost them something. Adopting a
 * document replaces the form, so it is never done over the top of work that
 * is not about this document — a half-typed October claim, or an edit that
 * has not been saved. In those cases the card is there and the button is
 * there, and the choice stays with the person.
 */
function safeToOpen (sub) {
  if (fixingId()) return false;                       // already fixing one
  if (typeof profileDirty !== 'undefined' && profileDirty) return false;

  const here = String(S.consultant.name || '').trim();
  if (!here) return true;                             // nothing on screen to lose
  if (here !== String(sub.consultant || '').trim()) return false;

  // the same person, but possibly a month they have moved on to
  return Number(sub.period_year) === Number(S.timesheet.year) &&
         Number(sub.period_month) === Number(S.timesheet.month) + 1;
}

let renderingResubmit = false;

async function renderResubmit () {
  const host = document.getElementById('resubmitList');
  if (!host || renderingResubmit) return;
  releaseEditor();          // the card it lives in is about to be rebuilt

  if (!Sync.on) {
    host.innerHTML =
      '<p class="emptynote"><b>Not connected to the database.</b> ' +
      'A document that came back lives in the shared database, which this browser cannot ' +
      'reach right now.</p>';
    return;
  }

  host.innerHTML = '';

  if (!returned.length) {
    const ok = document.createElement('p');
    ok.className = 'emptynote';
    ok.textContent = 'Nothing has been sent back. When something is, it appears here with ' +
      'the reason it was sent back for.';
    host.appendChild(ok);
    return;
  }

  /* One document back is the ordinary case, and it is the one worth opening
     without being asked. Two or more and there is a choice to make, so the
     cards make it. */
  if (returned.length === 1 && safeToOpen(returned[0])) {
    renderingResubmit = true;                 // adopting redraws the step
    try { await openToFix(returned[0], { jump: false }); }
    finally { renderingResubmit = false; }
  }

  host.innerHTML = '';
  returned
    .slice()
    .sort((a, b) => (b.period_year - a.period_year) || (b.period_month - a.period_month))
    .forEach(sub => host.appendChild(returnedCard(sub)));
}

function returnedCard (sub) {
  const card = document.createElement('div');
  const open = fixingId() === sub.id;
  card.className = 'backcard' + (open ? ' fixing' : '');

  const head = document.createElement('div');
  head.className = 'backhead';

  const tag = document.createElement('span');
  const kind = kindOf(sub);
  tag.className = 'doctag ' + kind;
  tag.textContent = kindLabel(kind);
  head.appendChild(tag);

  const what = document.createElement('b');
  what.textContent = periodOf(sub);
  head.appendChild(what);

  const no = document.createElement('span');
  no.textContent = sub.invoice_no || '';
  head.appendChild(no);
  card.appendChild(head);

  /* Who sent it back and what they said. This is the whole reason the card
     exists, so it is the biggest thing on it — not a tooltip, not a line of
     history somebody has to go looking for. */
  const back = (sub.history || []).slice().reverse()
    .filter(h => h.action === 'return')[0] || {};

  const who = document.createElement('p');
  who.className = 'backwho';
  who.textContent = 'Sent back by ' + (back.by || 'an approver') +
    (back.at ? ' on ' + new Date(back.at).toLocaleDateString() : '') +
    (back.from && STAGE_BY_KEY[back.from]
      ? ' — it had got as far as ' + Auth.roleName(STAGE_BY_KEY[back.from].who) : '');
  card.appendChild(who);

  const why = document.createElement('blockquote');
  why.className = 'backwhy';
  why.textContent = back.note || 'No reason was given.';
  card.appendChild(why);

  /* The document itself. When this is the one open in the form it is here,
     now — not behind a button. Somebody whose invoice was sent back has come
     to this card to fix that invoice, and the invoice is the thing they came
     for; the reason is above it and the way to send it again is below it. */
  const editHost = document.createElement('div');
  editHost.className = 'edithost';
  editHost.hidden = true;

  if (open) {
    const now = document.createElement('p');
    now.className = 'backnow';
    now.textContent = `This ${kindLabel(kind).toLowerCase()} is open below. Change whatever was ` +
      'wrong with it, then send it back for approval — what goes up is the form as it stands.';
    card.appendChild(now);
  }
  card.appendChild(editHost);

  const note = document.createElement('textarea');
  note.className = 'decidenote';
  note.rows = 2;
  note.placeholder = 'What you changed (optional — the approver sees this)';
  card.appendChild(note);

  const bar = document.createElement('div');
  bar.className = 'btnrow';
  bar.appendChild(button('Read it', 'ghost small', () => reviewSubmission(sub.id)));

  /* Only a document that is not the one open in the form needs asking for:
     more than one came back, or opening this one would replace work that is
     not about it. Once it is open there is nothing to press — it is there. */
  if (!open) bar.appendChild(button('Open and fix', 'ghost small', () => openToFix(sub)));

  const send = button('Send it back for approval', 'primary',
                      () => resubmitOne(sub, note.value.trim(), send));
  bar.appendChild(send);
  /* Rows left behind by setting the thing up look exactly like real ones.
     The administrator can take them off the record; nobody else can, and
     nothing about the process does it — a claim that was wrong is sent back,
     not erased. */
  if (Auth.isAdmin()) {
    bar.appendChild(button('Delete', 'ghost small danger', () => {
      if (open) setFixing('');
      deleteSubmission(sub);
    }));
  }
  card.appendChild(bar);

  if (open) {
    putBack = borrowDocument(kind, editHost);
    if (!putBack) toast('That document could not be opened here.', true);
  }
  return card;
}

/**
 * Put the document that came back into the form, on the step that draws it.
 * An invoice opens on the Invoice step and a time sheet on the Claim step,
 * because the thing that was wrong with it is on one of them.
 */
async function openToFix (sub, opts) {
  const jump = !opts || opts.jump !== false;
  try {
    const full = await Sync.submission(sub.id);
    if (!full || !full.data) { toast('That document could not be read.', true); return; }

    /* Adopting jumps to the step that draws the claim, which is right when
       somebody pressed a button to be taken there and wrong when the step
       opened it by itself. Remember where they were. */
    const here = (activeSteps()[stepIndex] || {}).id;

    adoptSubmission(full);
    setFixing(sub.id);

    const kind = Sync.kindOf(full) || kindOf(sub);
    /* The step has to exist before anybody can be sent to it, and a claim
       submitted before step 2 was ever answered carries no mode at all —
       which is not the same as carrying one that covers this document. */
    if (!S.mode || kindsForMode(S.mode).indexOf(kind) < 0) {
      S.mode = SUBMIT_KINDS[kind].mode;
    }

    renderAll();
    if (jump) {
      // opened from somewhere else: bring them to the step that carries it
      const at = activeSteps().findIndex(st => st.id === 'resubmit');
      if (at >= 0) goToStep(at, true);
      toast(`Opened the ${kindLabel(kind).toLowerCase()} — edit it here.`);
    } else {
      const back = activeSteps().findIndex(st => st.id === here);
      if (back >= 0) goToStep(back, true); else renderStepper();
    }
  } catch (err) {
    toast(err.message || 'Could not open that document.', true);
  }
}

/**
 * Send it round again, the same way it went the first time.
 *
 * What goes up is the form on screen when the form on screen is this
 * document — which is the point of the whole step. Sending the stored copy
 * back would hand the approver the very document they rejected.
 */
async function resubmitOne (sub, note, btn) {
  if (resubmitBusy) return;
  const editing = fixingId() === sub.id;

  if (!editing && !confirm(
    'Send this back for approval without opening it?\n\n' +
    'Nothing has been changed in the form, so the approver gets the same document they sent ' +
    'back. Press Cancel and use "Open and fix" first.')) return;

  resubmitBusy = true;
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    await Sync.act(sub.id, 'resubmit', note, editing ? S : undefined);
    if (editing) setFixing('');
    toast('Sent to the project manager again.');
    await loadReturned();
    renderResubmit();
    renderStepper();
    if (typeof renderApprovals === 'function') await renderApprovals();
  } catch (err) {
    toast(err.message || 'Could not send it.', true);
  } finally {
    resubmitBusy = false;
    btn.disabled = false;
    btn.textContent = was;
  }
}

/* =======================================================================
   app.js — the guided step flow, two-way field binding, autosave,
            profiles and the generate buttons
   ======================================================================= */

let S = Store.loadCurrent() || defaultState();

/* -----------------------------------------------------------------------
   Section (C) starting values. These are only defaults — every one of them
   is an ordinary field on the Claim page, so change the approver, blank a
   name out or hand the sheet to somebody else and the documents follow.
   ----------------------------------------------------------------------- */
const SIGN_DEFAULTS = {
  review: Auth.personFor('manager'),        // project manager, who reviews first
  hod: Auth.personFor('boss'),              // approver; edit on the Claim page
  verified: ''                              // Group People & Finance sign on paper
};

/** today as the form writes it: 26.8.2026 */
function todayDotted () {
  const n = new Date();
  return `${n.getDate()}.${n.getMonth() + 1}.${n.getFullYear()}`;
}

/* The three dates in section C, and the flag that says whether each is still
   the app's to keep up to date. Typing in one hands it over; emptying it
   hands it back. */
const AUTO_DATES = {
  'timesheet.prepDate':   'prep',
  'timesheet.reviewDate': 'review',
  'timesheet.apprDate':   'appr'
};

/**
 * Move every date nobody has typed over on to today.
 *
 * Called whenever the form is opened or the month changes, so a claim that
 * sat half-finished for two days is dated the day it is actually sent —
 * while a date somebody set on purpose is left exactly where they set it.
 */
function refreshAutoDates () {
  const today = todayDotted();
  const auto = S.timesheet.dateAuto || (S.timesheet.dateAuto = {});
  let moved = false;
  Object.keys(AUTO_DATES).forEach(path => {
    const key = AUTO_DATES[path];
    const field = path.split('.')[1];
    if (auto[key] === false) return;
    if (S.timesheet[field] === today) return;
    S.timesheet[field] = today;
    moved = true;
  });
  if (moved) { mirror('timesheet.prepDate'); mirror('timesheet.reviewDate'); mirror('timesheet.apprDate'); }
  return moved;
}

/* ---------------- toast ---------------- */
let toastTimer = null;
function toast (msg, bad) {
  const el = document.getElementById('toast');
  el.setAttribute('role', bad ? 'alert' : 'status');
  el.setAttribute('aria-live', bad ? 'assertive' : 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.textContent = msg;
  el.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  // Long feedback stays readable on a phone and with magnification.
  toastTimer = setTimeout(() => { el.className = 'toast'; }, Math.min(12000, Math.max(5000, msg.length * 55)));
}

/* =======================================================================
   Step flow — steps without a `modes` list always apply
   ======================================================================= */

const STEPS = [
  { id: 'consultant', label: 'Profile' },
  { id: 'choose',     label: 'Document' },
  /* The time sheet before the invoice: the days are counted first, and the
     amount follows from them. The other way round asked somebody to price a
     month before saying which days of it they had worked. */
  { id: 'claim',      label: 'Claim Form', modes: ['claim', 'both'] },
  { id: 'invoice',    label: 'Invoice',    modes: ['invoice', 'both'] },
  { id: 'generate',   label: 'Review' },
  /* Downloading the documents and sending the claim away are two different
     decisions, and they were on one screen. Generating is something you do
     several times while a month is still being argued about; submitting
     happens once and cannot be taken back. They are separate steps now. */
  { id: 'submit',     label: 'Submit' },
  /* Only there while something of yours has been sent back. A rejection is
     not a status, it is a job — and a job nobody can see is a month nobody
     gets paid for. */
  { id: 'resubmit',   label: 'Re-submit', whenReturned: true },
  /* Not a step. Nothing is prepared here and nothing moves on from it —
     it is where you go to see where things got to, which is a question
     rather than a stage. So it is off the end of the numbered run, with
     the record beside it, and the numbers stop at Submit. */
  { id: 'approvals',  label: 'Status', view: true },
  /* The administrator, and only them: the Status step answers "where is this
     month", and somebody has to be able to answer "where is last March" as
     well. `admin: true` is the only thing that keeps a step out of the flow
     for everybody else. */
  /* The whole record, for the two accounts whose job it is: the
     administrator, and whoever keeps the finished paper. */
  { id: 'history',    label: 'History', records: true, view: true },
  /* The PA's three pages, in the order the job happens: print what is
     waiting, write the payment advice for it, then file both back signed.
     The admin stands in everywhere, so the admin gets them too — after
     everything else.

     Writing the advice and filing the signed copies are separate steps
     because they are separate days: one is a form to fill in and check, the
     other is a scan of that form once the HOD has put his name on it. */
  /* Her own signature first, because it is the one thing on the payment
     advice that is hers rather than the claim's, and a form prepared before
     it exists prints a Prepared by box with a name and no signature. */
  { id: 'mysign',     label: 'Signature', signs: true },
  { id: 'advice',     label: 'Payment Advice', signs: true },
  { id: 'todownload', label: 'Download', signs: true },
  /* "Re-Upload", because every document on it went out of this app first:
     it was downloaded, signed on paper or in another program, and is coming
     back. Plain "Upload" read as a place to put something new. */
  { id: 'toupload',   label: 'Re-Upload', signs: true },
  /* Not a step either: the job behind, rather than the job in front. */
  /* Called History for the PA, who has no other: it is where a confirmed
     month lives, under the person's name. The administrator already has a
     History of everything, so theirs keeps the narrower name. */
  { id: 'filed',      label: 'Filed',    signs: true, view: true,
    labelFor: () => (Auth.keepsRecords() ? 'Filed' : 'History') }
];

/** what a step is called for the account looking at it */
const stepLabel = s => (s.labelFor ? s.labelFor() : s.label);

/** steps this account is allowed to see at all, right now */
const permittedSteps = () => STEPS.filter(s =>
  (!s.records || Auth.keepsRecords()) &&
  (!s.signs || Auth.places()) &&
  (!s.whenReturned || (typeof returnedCount === 'function' && returnedCount() > 0)));

let stepIndex = 0;
/* The last step of the form that was open, so a place you went to look
   knows where to send you back to. */
let lastFormStep = 0;
let activeProfile = '';          // the saved profile the form was opened from

function activeSteps () {
  /* An approver does not fill a claim in — they read one and sign it, so the
     wizard is not drawn for them at all. The admin is not an approver in that
     sense: they prepare claims like a consultant as well, and get everything.
     "Prepares" is the question, not "is a consultant". */
  const all = permittedSteps();
  if (Auth.role() && !Auth.prepares()) {
    /* Nobody here fills a claim in, so none of them sees the wizard. What
       each of them does see is the one screen their job happens on: the
       approvers get the queue, and whoever collects the finished forms gets
       the shelf they end up on and nothing else. A queue of decisions that
       will never be yours to make is not information, it is furniture. */
    /* The PA is the exception among the approvers: their part is a
       signature on paper, so their app is the paper going out and coming
       back — two pages, and not the table. */
    if (Auth.places()) return all.filter(s => s.signs);
    return all.filter(s =>
      (s.id === 'approvals' && Auth.approves()) ||
      (s.id === 'history' && Auth.keepsRecords()));
  }
  const tail = all.filter(s => s.id === 'resubmit' || s.id === 'approvals' ||
                              s.id === 'history' || s.signs);
  if (!S.mode) {
    return all.filter(s => s.id === 'consultant' || s.id === 'choose').concat(tail);
  }
  return all.filter(s => !s.modes || s.modes.includes(S.mode));
}

function canLeave (id) {
  if (id === 'consultant') {
    const missing = profileProblems();
    if (missing.length) {
      toast('Required: ' + missing.join(', ') + '.', true);
      paintProfileGate();
      const first = !String(S.consultant.name || '').trim() ? 'c_name'
        : !uniqueIdOf(S) && Auth.setsNumbering() ? 'c_uniqueId'
        : !(Number(S.invoice.monthlyRate) > 0) ? 'c_rate' : '';
      const box = first && document.getElementById(first);
      if (box) {
        const disclosure = box.closest('details');
        if (disclosure) disclosure.open = true;
        box.focus();
      }
      return false;
    }
    if (profileDirty) {
      toast('Press Save Profile first to keep your changes.', true);
      paintProfileGate();
      const save = document.getElementById('btnSaveProfile');
      if (save) save.focus();
      return false;
    }
  }
  if (id === 'choose' && !S.mode) {
    toast('Pick which document you need.', true);
    return false;
  }
  return true;
}

/* Steps that only report, or that are about a claim already sent. Nothing on
   them is part of preparing a new one, so nothing has to be filled in to
   reach one — an administrator opening the app to see whether Amila has sent
   September should not first be asked to pick a document they are not going
   to produce, and somebody whose invoice was rejected should not have to
   finish a fresh claim before they can read why. */
const INFO_STEPS = ['approvals', 'history', 'resubmit', 'todownload', 'toupload', 'filed',
                    'advice', 'mysign'];

function goToStep (i, skipGuard) {
  const list = activeSteps();
  const target = Math.max(0, Math.min(i, list.length - 1));
  const reporting = INFO_STEPS.indexOf(list[target].id) >= 0;
  if (!skipGuard && !reporting && target > stepIndex) {
    for (let k = stepIndex; k < target; k++) if (!canLeave(list[k].id)) return;
  }
  stepIndex = target;
  showStep();
  const heading = document.querySelector('.panel.active h2');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
}

function showStep () {
  const list = activeSteps();
  const step = list[Math.min(stepIndex, list.length - 1)];
  if (!step.view) lastFormStep = stepIndex;

  /* The Re-submit step borrows the Invoice or Claim step to edit a document
     in place. Give it back before anything else is drawn, or the step it was
     borrowed from is an empty panel. */
  if (typeof releaseEditor === 'function' && step.id !== 'resubmit') releaseEditor();

  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('p-' + step.id).classList.add('active');

  renderStepper();
  renderNavRows();
  // canvases can only be measured once their panel is visible
  if (step.id === 'claim' || step.id === 'invoice') setTimeout(() => Sig.resizeAll(), 30);
  // a tab left open over midnight should not date today's claim yesterday
  if (step.id === 'claim' && refreshAutoDates()) persist();
  if (step.id === 'generate') renderGenSummary();
  if (step.id === 'choose') paintChoices();
  if (step.id === 'submit') renderSubmitStep();
  if (step.id === 'approvals') { renderApprovals(); renderArchive(); }
  if (step.id === 'history') renderHistory();
  if (step.id === 'resubmit') renderResubmit();
  if (step.id === 'mysign') renderMySignature();
  if (step.id === 'todownload') renderSignDownload();
  if (step.id === 'toupload') renderSignUpload();
  if (step.id === 'advice') renderAdvice();
  if (step.id === 'filed') renderFiled();
  window.scrollTo({ top: 0, behavior: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

/**
 * The bar along the top: the process, then the places you go to look.
 *
 * They were one numbered run, and the numbers were a promise the last of
 * them did not keep — Status is not something you do after Submit, it is
 * where you go to see where Submit got to. Numbering it made a question
 * look like a stage, and made the run look longer than the work.
 *
 * So the numbers stop where the work stops, and what is left is set apart
 * at the end of the bar: the same buttons, no numbers, no line joining
 * them to anything.
 */
function renderStepper () {
  const list = activeSteps();
  const host = document.getElementById('stepper');
  host.innerHTML = '';
  host.setAttribute('aria-label', 'Claim preparation and records');

  const steps = document.createElement('div');
  steps.className = 'stepgroup';
  const views = document.createElement('div');
  views.className = 'stepviews';

  // standing on a view is not standing past the process, so nothing behind
  // it is "done" — a consultant reading Status has not finished anything
  const onView = !!(list[stepIndex] && list[stepIndex].view);
  let number = 0;

  list.forEach((s, i) => {
    const isView = !!s.view;
    if (!isView) number++;

    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-controls', 'p-' + s.id);
    b.setAttribute('aria-label', (isView ? '' : 'Step ' + number + ': ') + stepLabel(s));
    if (i === stepIndex) b.setAttribute('aria-current', 'step');
    b.className = 'step' + (isView ? ' view' : '') +
      (i === stepIndex ? ' active' : (!isView && !onView && i < stepIndex ? ' done' : ''));

    if (!isView) {
      const num = document.createElement('span');
      num.className = 'step-num';
      num.textContent = String(number);
      b.appendChild(num);
    }
    const label = document.createElement('span');
    label.textContent = stepLabel(s);     // step names are ours, not markup
    b.appendChild(label);

    const n = s.whenReturned && typeof returnedCount === 'function' ? returnedCount() : 0;
    if (n) {
      const badge = document.createElement('i');
      badge.className = 'stepbadge';
      badge.textContent = String(n);
      b.appendChild(badge);
    }

    b.addEventListener('click', () => goToStep(i));
    (isView ? views : steps).appendChild(b);
  });

  if (steps.children.length) host.appendChild(steps);
  if (views.children.length) host.appendChild(views);

  const current = host.querySelector && host.querySelector('[aria-current="step"]');
  if (current && current.scrollIntoView) current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderNavRows () {
  const list = activeSteps();
  const step = list[Math.min(stepIndex, list.length - 1)];
  const panel = document.getElementById('p-' + step.id);

  document.querySelectorAll('.navrow').forEach(n => n.remove());

  const row = document.createElement('div');
  row.className = 'navrow';

  /* A place you went to look has no next and no number. What it has is the
     way back to what you were doing, which is the only thing anybody wants
     from the bottom of it. */
  if (step.view) {
    const first = list.findIndex(s => !s.view);
    if (first >= 0) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'btn ghost';
      back.textContent = '← Back to the form';
      back.addEventListener('click', () =>
        goToStep(list[lastFormStep] && !list[lastFormStep].view ? lastFormStep : first, true));
      row.appendChild(back);
    }
    panel.appendChild(row);
    return;
  }

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'btn ghost';
  back.textContent = stepIndex > 0 ? '← ' + list[stepIndex - 1].label : '← Back';
  back.disabled = stepIndex === 0;
  back.addEventListener('click', () => goToStep(stepIndex - 1, true));
  row.appendChild(back);

  /* Counted against the work, not against the bar: Status and History are on
     the bar and are not steps, and saying "Step 6 of 10" over a run of six
     was the numbering promising four more than there were. */
  const total = list.filter(s => !s.view).length;
  const here = list.slice(0, stepIndex + 1).filter(s => !s.view).length;
  const note = document.createElement('span');
  note.className = 'stepnote';
  note.textContent = `Step ${here} of ${total}`;
  row.appendChild(note);

  row.appendChild(Object.assign(document.createElement('span'), { className: 'spacerflex' }));

  // the next thing to do, which is never a place you go to look
  const nextAt = list.findIndex((s, i) => i > stepIndex && !s.view);
  if (nextAt >= 0) {
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'btn';
    const nextLabels = {
      choose: 'Choose documents', claim: 'Complete claim form', invoice: 'Review invoice',
      generate: 'Preview & download', submit: 'Review submission',
      resubmit: 'Review returned documents', todownload: 'Download documents',
      toupload: 'Re-upload signed documents', mysign: 'Your signature'
    };
    next.textContent = (nextLabels[list[nextAt].id] || list[nextAt].label) + ' →';
    /* On step 1, Next is not offered while there is a reason it would be
       refused. A button that can be pressed and then says no is a button
       that has wasted the press. */
    if (step.id === 'consultant') {
      const missing = profileProblems();
      next.disabled = !!missing.length || profileDirty;
      next.title = missing.length ? 'Still needed: ' + missing.join(', ')
        : profileDirty ? 'Press Save Profile first' : '';
      if (next.disabled) next.setAttribute('aria-describedby', 'profileGate');
    }
    next.addEventListener('click', () => goToStep(nextAt));
    row.appendChild(next);
  }
  panel.appendChild(row);
}

/* ---------------- step 2: the choice cards ---------------- */

function paintChoices () {
  document.querySelectorAll('.choice').forEach(c => {
    const selected = c.dataset.mode === S.mode;
    c.classList.toggle('selected', selected);
    c.setAttribute('aria-pressed', String(selected));
  });
}

function chooseMode (mode) {
  const changed = S.mode !== mode;
  S.mode = mode;
  paintChoices();
  persist();
  syncAutoAmount();
  if (changed) {
    toast(mode === 'both' ? 'Both documents selected.'
        : mode === 'invoice' ? 'Invoice Timesheet selected.' : 'Claim form selected.');
  }
  goToStep(stepIndex + 1, true);
}

/* =======================================================================
   Two-way binding via data-bind="section.key"
   Several elements may share one path; editing any of them updates the rest.
   ======================================================================= */

const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath (o, p, v) {
  const ks = p.split('.');
  const last = ks.pop();
  const host = ks.reduce((a, k) => a[k], o);
  host[last] = v;
}

function elValue (el) {
  if (el.dataset.type === 'bool') return el.checked;
  if (el.dataset.type === 'num') return Number(el.value) || 0;
  return el.value;
}

function applyToEl (el, v) {
  if (el.dataset.type === 'bool') el.checked = !!v;
  else el.value = v == null ? '' : v;
}

/** push the whole state out to every bound element */
function writeBindings () {
  document.querySelectorAll('[data-bind]').forEach(el => applyToEl(el, getPath(S, el.dataset.bind)));
}

/** mirror one path to every other element bound to it */
function mirror (path, source) {
  const v = getPath(S, path);
  document.querySelectorAll(`[data-bind="${path}"]`).forEach(el => {
    if (el !== source) applyToEl(el, v);
  });
}

/**
 * Keep the consultant's address line 1 inside what the invoice prints. What
 * will not fit moves to the front of line 2, and the caret goes with it, so
 * typing simply carries on where the words went.
 */
function flowAddressOverflow (el) {
  const split = splitAddressLines(S.consultant.addr1, S.consultant.addr2);
  if (!split.moved) return;

  S.consultant.addr1 = split.line1;
  S.consultant.addr2 = split.line2;
  mirror('consultant.addr1');
  mirror('consultant.addr2');

  // the address is on the details page and again on the invoice: follow the
  // words into the line 2 belonging to whichever copy is being typed in
  const next = (el.closest('section') || document)
    .querySelector('[data-bind="consultant.addr2"]');
  if (next && document.activeElement === el) {
    next.focus();
    next.setSelectionRange(split.moved.length, split.moved.length);
  }
}

function bindInputs () {
  document.querySelectorAll('[data-bind]').forEach(el => {
    const path = el.dataset.bind;
    const ev = (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'date') ? 'change' : 'input';
    el.addEventListener(ev, () => {
      setPath(S, path, elValue(el));
      mirror(path, el);

      // line 1 only holds so much of an address; the rest flows to line 2
      if (path === 'consultant.addr1') flowAddressOverflow(el);

      if (path === 'consultant.name') {
        if (!S.timesheet.prepName.trim() || S.timesheet.prepName === lastName) {
          S.timesheet.prepName = el.value;
          mirror('timesheet.prepName');
        }
        lastName = el.value;
        updateInvSigName();
        syncInvoiceNo();          // the seeded starting number follows the name
      }
      // move the timesheet to the invoice period, but never over a sheet
      // somebody has actually worked on
      if (path === 'invoice.pStart' && timesheetIsAuto(S)) {
        const ref = periodMonth(el.value);
        if (ref && (ref.y !== S.timesheet.year || ref.m !== S.timesheet.month)) {
          setTimesheetMonth(ref.y, ref.m, { keepPeriod: true });
        }
      }
      if (path === 'timesheet.month' || path === 'timesheet.year') {
        onMonthChanged();
      }
      /* Assignment Period and Month / Year are the same fact written two
         ways, so each writes the other. Read on every keystroke, which is
         why parseMonthLabel says no to everything that is not yet a month. */
      if (path === 'consultant.assignPeriod') {
        const ref = parseMonthLabel(el.value);
        if (ref && (ref.y !== S.timesheet.year || ref.m !== S.timesheet.month)) {
          setTimesheetMonth(ref.y, ref.m, { keepAssign: true });
        }
      }
      if (path === 'consultant.uniqueId' || path === 'consultant.claimSeq') {
        // changing either half of the number is asking for the number back
        S.invoice.autoNo = true;
        syncInvoiceNo();
      }
      if (path === 'invoice.no') {
        S.invoice.autoNo = !el.value.trim() || el.value.trim() === invoiceNumberOf(S);
        paintInvoiceNo();
      }
      /* A date somebody typed is theirs from then on, and one they emptied
         is handed back to the app — which is the only way to undo having
         typed one, and is what an empty box has always meant here. */
      if (AUTO_DATES[path]) {
        S.timesheet.dateAuto[AUTO_DATES[path]] = !String(el.value).trim();
      }
      // a person typed something, which is the only thing that counts as an edit
      if (path.indexOf('consultant.') === 0 || path === 'invoice.monthlyRate') {
        markProfileDirty();
      }
      syncAutoAmount();
      persist();
    });
  });
}

let lastName = '';
const afterTimesheetChange = () => { persist(); syncAutoAmount(); };

/* -----------------------------------------------------------------------
   Unsaved changes

   The form autosaves as a draft, so nothing is ever lost — but a draft is
   not a profile, and details typed into one and never saved were details
   that came back blank next month. So an edited profile step will not be
   left until it has been saved, and the Next button says so rather than
   simply refusing when pressed.

   Only a person typing sets this. The month filling itself in, an address
   reflowing, an invoice number being worked out — none of those are edits
   somebody made, and stopping them at the door for it would be nonsense.
   ----------------------------------------------------------------------- */
let profileDirty = false;

function markProfileDirty () {
  if (profileDirty) return;
  profileDirty = true;
  renderNavRows();
  paintProfileGate();
}

function clearProfileDirty () {
  profileDirty = false;
  paintProfileGate();
  renderNavRows();
}

/** what step 1 is still missing, in the order somebody would fill it in */
function profileProblems () {
  const out = [];
  if (!String(S.consultant.name || '').trim()) out.push('the full name');
  if (!uniqueIdOf(S)) {
    out.push(Auth.setsNumbering()
      ? 'the unique ID'
      : 'a unique ID — ask the administrator to set one');
  }
  if (!(Number(S.invoice.monthlyRate) > 0)) out.push('the monthly rate');
  if (!S.sig.personnel) out.push('a signature');
  return out;
}

/** say, under the save button, what is left to do before this step is done */
function paintProfileGate () {
  const box = document.getElementById('profileGate');
  if (!box) return;
  const missing = profileProblems();
  // cleared as well as hidden: stale text is a sentence waiting to flash up
  if (!missing.length && !profileDirty) { box.hidden = true; box.textContent = ''; return; }

  box.hidden = false;
  box.className = 'keynote warn';
  box.textContent = missing.length
    ? 'Required: ' + missing.join(', ') + (profileDirty ? '. Save your changes to continue.' : '.')
    : 'Save your profile changes to continue.';
}

/* =======================================================================
   The month, and the three things that follow it

   A claim is for one month, and that month is written in four places: the
   Month / Year boxes, the Assignment Period line above them, the invoice
   period, and the year in the invoice number. Keeping them in step by hand
   is how a sheet ends up dated August with September's days on it, so the
   month is set in one place here and everything else is derived.
   ======================================================================= */

/**
 * Move the whole form to a month.
 * @param {object} [opts] `keepAssign` when the change came from the
 *        Assignment Period box, `keepPeriod` when it came from the invoice
 *        period — the field being typed in is not written back over.
 */
function setTimesheetMonth (y, m, opts) {
  S.timesheet.year = y;
  S.timesheet.month = m;
  mirror('timesheet.year');
  mirror('timesheet.month');
  onMonthChanged(opts);
}

function onMonthChanged (opts) {
  const o = opts || {};
  const ts = S.timesheet;

  // a month nobody has touched is filled in again for the new month; one
  // somebody has worked on is theirs, and is left exactly as it is
  if (timesheetIsAuto(S)) autoFillMonth(S);

  if (!o.keepAssign) {
    S.consultant.assignPeriod = monthLabel(ts);
    mirror('consultant.assignPeriod');
  }
  if (!o.keepPeriod) movePeriodToMonth();

  syncInvoiceNo();
  renderTimesheet(S, afterTimesheetChange);
  syncAutoAmount();
  persist();
}

/**
 * Move the invoice period onto the new month — but only when it was the
 * whole of the old one. A period somebody narrowed by hand (a consultant
 * who started on the 24th) is a decision, not a default, and survives.
 */
function movePeriodToMonth () {
  const ts = S.timesheet;
  const pad = n => String(n).padStart(2, '0');
  const firstOf = (y, m) => `${y}-${pad(m + 1)}-01`;
  const lastOf  = (y, m) => `${y}-${pad(m + 1)}-${pad(daysInMonth(y, m))}`;

  const a = periodMonth(S.invoice.pStart);
  const b = periodMonth(S.invoice.pEnd);
  const wholeMonth = a && b && a.y === b.y && a.m === b.m &&
    S.invoice.pStart === firstOf(a.y, a.m) && S.invoice.pEnd === lastOf(b.y, b.m);
  if (S.invoice.pStart && S.invoice.pEnd && !wholeMonth) return;

  const wasDue = S.invoice.due === S.invoice.pEnd || !S.invoice.due;
  S.invoice.pStart = firstOf(ts.year, ts.month);
  S.invoice.pEnd   = lastOf(ts.year, ts.month);
  if (wasDue) { S.invoice.due = S.invoice.pEnd; mirror('invoice.due'); }
  mirror('invoice.pStart');
  mirror('invoice.pEnd');
}

/**
 * Write the invoice number the profile says this claim is, unless somebody
 * has typed their own over it.
 */
function syncInvoiceNo () {
  const auto = invoiceNumberOf(S);
  if (S.invoice.autoNo !== false && auto && S.invoice.no !== auto) {
    S.invoice.no = auto;
    mirror('invoice.no');
  }
  paintInvoiceNo();
  renderGenSummary();
}

/**
 * The three fields that belong to the office: the unique ID, the count of
 * claims, and which sign-in owns this profile. A consultant can read them
 * and can see why they are as they are; only the administrator changes
 * them, because one person deciding they are 07 is how two people end up
 * both being 07.
 *
 * This is what the app draws. BDOS is what enforces it — see
 * docs/BDOS-CCS-Endpoints.md.
 */
function paintAdminFields () {
  const may = Auth.setsNumbering();

  const pick = document.getElementById('c_email');
  if (pick) {
    const chosen = String(S.consultant.email || '');
    pick.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '— not assigned —';
    pick.appendChild(blank);
    const emails = Auth.preparers().slice();
    if (chosen && emails.indexOf(chosen) < 0) emails.push(chosen);
    emails.forEach(e => {
      const o = document.createElement('option');
      o.value = e;
      o.textContent = e;
      pick.appendChild(o);
    });
    pick.value = chosen;
  }

  ['c_uniqueId', 'c_claimSeq', 'c_email'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = !may;
    el.classList.toggle('locked', !may);
  });

  const note = document.getElementById('adminLocked');
  if (note) {
    note.hidden = may;
    note.className = 'keynote';
    note.textContent = 'The administrator manages your unique ID, claim count and linked account.';
  }
}

/** say, on the profile step, what number the next claim will carry */
function paintInvoiceNo () {
  const box = document.getElementById('invNoPreview');
  if (!box) return;
  const auto = invoiceNumberOf(S);
  if (!auto) {
    box.className = 'keynote warn';
    box.textContent = Auth.setsNumbering()
      ? 'Add a Unique ID to generate the invoice number.'
      : 'Ask the administrator to set your Unique ID for invoice numbering.';
    return;
  }
  const typed = S.invoice.autoNo === false && S.invoice.no && S.invoice.no !== auto;
  box.className = 'keynote' + (typed ? ' warn' : '');
  box.textContent = typed
    ? `Manual invoice no.: ${S.invoice.no}. Suggested: ${auto}.`
    : `Invoice no.: ${auto}`;
}

/* ---------------- invoice item rows ---------------- */

function renderItems () {
  const tb = document.querySelector('#itemTable tbody');
  tb.innerHTML = '';
  // the first line is always the sum's; lines two onwards are yours to write
  const autoManaged = true;

  S.invoice.items.forEach((it, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="idx">${i + 1}</td>
      <td><input class="dinput" data-f="desc" placeholder="e.g. Consultancy Service Fee"></td>
      <td><input class="dinput" data-f="period" placeholder="e.g. 1 - 31 Aug 2026"></td>
      <td><input class="dinput ta-r" data-f="amount" type="number" step="0.01" placeholder="0.00"></td>
      <td><button type="button" class="rowdel" title="Delete this item" aria-label="Delete invoice item ${i + 1}">&times;</button></td>`;
    const fieldNames = { desc: 'Description', period: 'Service period', amount: 'Amount in Malaysian ringgit' };
    tr.querySelectorAll('input').forEach(inp => {
      inp.setAttribute('aria-label', 'Item ' + (i + 1) + ': ' + fieldNames[inp.dataset.f]);
      if (inp.dataset.f === 'amount') inp.setAttribute('inputmode', 'decimal');
    });
    tr.querySelector('[data-f="desc"]').value = it.desc || '';
    tr.querySelector('[data-f="period"]').value = it.period || '';
    const amtEl = tr.querySelector('[data-f="amount"]');
    amtEl.value = it.amount === '' || it.amount == null ? '' : it.amount;
    if (autoManaged && i === 0) {
      // The sum is the starting point, not the last word: a month can be
      // settled at something else, and typing over it says so rather than
      // being quietly overwritten on the next keystroke elsewhere.
      amtEl.title = 'Calculated from your rate and paid days. Enter a different agreed amount if needed.';
    }

    tr.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => {
      const f = inp.dataset.f;
      it[f] = f === 'amount' ? (inp.value === '' ? '' : Number(inp.value)) : inp.value;
      if (f === 'amount' && autoManaged && i === 0) {
        S.invoice.override = inp.value === '' ? null : Number(inp.value);
        paintOverride(computeAmount(S), S.invoice.override != null);
      }
      refreshTotals();
      persist();
    }));
    tr.querySelector('.rowdel').addEventListener('click', () => {
      S.invoice.items.splice(i, 1);
      renderItems(); refreshTotals(); persist();
      const remaining = tb.querySelectorAll('[data-f="desc"]');
      const focus = remaining[Math.min(i, remaining.length - 1)] || document.getElementById('btnAddItem');
      if (focus) focus.focus();
      toast('Invoice item removed.');
    });
    tb.appendChild(tr);
  });

  // keep four rows on screen, exactly like the printed template
  for (let i = S.invoice.items.length; i < 4; i++) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td class="idx"></td><td></td><td></td><td></td><td></td>';
    tb.appendChild(tr);
  }
}

function refreshTotals () {
  const T = invoiceTotals(S);
  document.getElementById('t_sub').textContent = money(T.sub);
  document.getElementById('t_tax').textContent = money(T.tax);
  document.getElementById('t_total').textContent = money(T.total);
  renderGenSummary();
}

function syncAutoAmount () {
  const calc = computeAmount(S);

  if (!S.invoice.items.length) {
    S.invoice.items.push({ desc: 'Consultancy Service Fee', position: S.consultant.position, period: '', amount: 0 });
  }
  {
    const it = S.invoice.items[0];
    const overridden = S.invoice.override != null && S.invoice.override !== '';
    it.amount = overridden ? Number(S.invoice.override) : (calc.amount || 0);
    if (!it.desc) it.desc = 'Consultancy Service Fee';
    /* The position and the period on the first line are the profile's and the
       period's, not a copy taken once when the row was made. Filling them in
       only when they were empty meant a row created before a profile was
       opened kept whatever it had — usually nothing — and no amount of
       editing the profile afterwards would move it. Line 2 onwards is yours
       to write; this one follows what it is a line about. */
    it.position = S.consultant.position;
    it.period = fmtPeriodShort(S.invoice.pStart, S.invoice.pEnd);
    paintOverride(calc, overridden);
  }
  renderItems();
  refreshTotals();
}

/** say so when the figure on the invoice is not the one the sum arrived at */
function paintOverride (calc, overridden) {
  const box = document.getElementById('amountOverride');
  if (!box) return;
  box.hidden = !overridden;
  if (!overridden) return;
  box.innerHTML = '<span></span> ';
  box.querySelector('span').textContent =
    `Manual amount. Calculated: RM ${money(calc.amount || 0)}.`;
  const undo = document.createElement('button');
  undo.className = 'btn ghost small';
  undo.textContent = 'Use calculated amount';
  undo.addEventListener('click', () => {
    S.invoice.override = null;
    syncAutoAmount();
    persist();
  });
  box.appendChild(undo);
}

/* ---------------- Generate step ---------------- */

function renderGenSummary () {
  const wantInv   = S.mode === 'invoice' || S.mode === 'both';
  const wantClaim = S.mode === 'claim'   || S.mode === 'both';

  const cInv = document.getElementById('card_inv');
  const cClm = document.getElementById('card_claim');
  if (cInv) cInv.classList.toggle('hidden', !wantInv);
  if (cClm) cClm.classList.toggle('hidden', !wantClaim);

  const T = invoiceTotals(S);
  const t = timesheetTotals(S.timesheet);
  const gi = document.getElementById('gsum_inv');
  if (gi) {
    gi.innerHTML = '';
    const number = document.createElement('b');
    number.textContent = S.invoice.no || '(no invoice number)';
    const amount = document.createElement('b');
    amount.textContent = 'RM ' + money(T.total);
    gi.append(number,
      document.createTextNode(' · ' + (fmtPeriod(S.invoice.pStart, S.invoice.pEnd) || '(no period)')),
      document.createElement('br'), document.createTextNode('Total due: '), amount);
  }
  const gc = document.getElementById('gsum_claim');
  if (gc) {
    gc.innerHTML = '';
    const paid = document.createElement('b');
    paid.textContent = String(t.A);
    const balance = document.createElement('b');
    balance.textContent = String(t.balance);
    gc.append(document.createTextNode(`${MONTHS[S.timesheet.month]} ${S.timesheet.year} · ${S.consultant.name || '(no name)'}`),
      document.createElement('br'), document.createTextNode('Paid days [A]: '), paid,
      document.createTextNode(' · Balance: '), balance);
  }
}

/* =======================================================================
   Step 6 — sending it

   The one irreversible thing in the app, so the screen before it is a
   summary rather than a button: what is about to go, to whom, and what is
   wrong with it if anything is. Everything it lists is fixable on a step
   that is still there behind you.
   ======================================================================= */

/** documents downloaded in this session — what the history row records */
const generated = new Set();

/* Which of the two documents this submission carries. null means "whatever
   the chosen mode produces", which is the answer until somebody says
   otherwise — so choosing Both on step 2 and pressing submit sends both,
   with nothing to tick. */
let submitPick = null;

/** the documents that would go if the button were pressed now */
function pickedKinds () {
  const available = kindsForMode(S.mode);
  if (!submitPick) return available.slice();
  return available.filter(k => submitPick.has(k));
}

function paintSubmitPick () {
  const host = document.getElementById('submitPick');
  if (!host) return;
  const available = kindsForMode(S.mode);
  const chosen = pickedKinds();
  host.innerHTML = '';

  available.forEach(kind => {
    const label = document.createElement('label');
    label.className = 'pickone';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.kind = kind;
    box.checked = chosen.indexOf(kind) >= 0;
    box.addEventListener('change', () => {
      if (!submitPick) submitPick = new Set(available);
      if (box.checked) submitPick.add(kind); else submitPick.delete(kind);
      renderSubmitStep();
    });
    label.appendChild(box);
    const name = document.createElement('b');
    name.textContent = kindLabel(kind);
    label.appendChild(name);
    const what = document.createElement('span');
    what.textContent = kind === 'invoice'
      ? 'Amount and bank details'
      : 'Days worked and approvals';
    label.appendChild(what);
    host.appendChild(label);
  });

  if (available.length < 2) {
    const only = document.createElement('p');
    only.className = 'pickonly';
    only.textContent = 'To send both documents, choose Both in step 2.';
    host.appendChild(only);
  }
}

function renderSubmitStep () {
  const facts = document.getElementById('submitFacts');
  const card  = document.getElementById('card_submit');
  const off   = document.getElementById('submitOffline');
  const warn  = document.getElementById('submitWarn');
  if (!facts) return;

  const T = invoiceTotals(S);
  const t = timesheetTotals(S.timesheet);
  paintSubmitPick();
  const going = pickedKinds();

  const rows = [
    ['Consultant', S.consultant.name || '(no name)'],
    ['Month', `${MONTHS[S.timesheet.month]} ${S.timesheet.year}`],
    ['Documents', going.length ? going.map(kindLabel).join(' + ') : 'None selected'],
    ['Invoice No.', S.invoice.no || '(none)'],
    ['Period', fmtPeriod(S.invoice.pStart, S.invoice.pEnd) || '(none)'],
    ['Total days [A]', String(t.A)],
    ['Total due', 'RM ' + money(T.total)],
    ['Reviewer', S.timesheet.reviewName || 'Project manager']
  ];
  facts.innerHTML = '';
  rows.forEach(([k, v]) => {
    const d = document.createElement('div');
    d.innerHTML = '<span></span><b></b>';
    d.querySelector('span').textContent = k;
    d.querySelector('b').textContent = v;
    facts.appendChild(d);
  });

  /* Not blocking — an approver can still be sent something imperfect, and
     usually the person submitting knows why. Saying it once is enough. */
  const problems = [];
  if (!String(S.consultant.name || '').trim()) problems.push('add your name in Profile');
  if (!String(S.invoice.no || '').trim()) {
    problems.push(Auth.setsNumbering()
      ? 'add a Unique ID in Profile for invoice numbering'
      : 'ask the administrator to set your Unique ID for invoice numbering');
  }
  if (!going.length) problems.push('select a document to send');
  if (going.indexOf('claim') >= 0 && !S.sig.personnel) {
    problems.push('add your signature to the PERSONNEL box');
  }
  const over = leaveStandings(S).filter(L => L.over);
  over.forEach(L => problems.push(
    `${L.name} is over the ${L.limit}-day allowance by ${L.taken - L.limit}`));
  const blank = unmarkedDays(S.timesheet);
  if (blank.length) {
    problems.push(`${blank.length} unmarked working day${blank.length > 1 ? 's' : ''} will be unpaid`);
  }

  if (warn) {
    warn.hidden = !problems.length;
    warn.textContent = problems.length
      ? 'Before submitting: ' + problems.join('; ') + '.'
      : '';
  }

  const canSend = Sync.on;
  if (card) card.hidden = !canSend;
  if (off)  off.hidden = canSend;
}

/**
 * A claim has gone. Three things follow, and all three are the kind nobody
 * should have to remember:
 *
 *   · this month's leave is filed against the year, so the next month opens
 *     with the balance already carried forward
 *   · this month's claim number is fixed, and the next month starts from the
 *     one after it — fixed, not incremented, because the second of a month's
 *     two documents must not arrive under a different number from the first
 *   · the profile keeps both, because they belong to the person and not to
 *     whatever happens to be in the form
 */
function afterSubmitted () {
  recordLeaveTaken(S);
  const next = assignClaimNo(S);
  if (next != null) {
    S.consultant.claimSeq = next;
    mirror('consultant.claimSeq');
  }
  syncInvoiceNo();

  // one history row per claim sent, listing whatever was downloaded for it
  Sync.recordClaim(S, [...generated]);
  generated.clear();

  if (activeProfile) {
    Store.saveProfile(activeProfile, S);
    Sync.pushProfile(activeProfile, S);
  }
  renderProfileCards();
  persist();
}

/* ---------------- persistence ---------------- */

let saveTimer = null;
let saveWarned = false;
function persist () {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    Sync.pushDraft(S);                       // lazy, silent, never blocking
    if (Store.saveCurrent(S)) { saveWarned = false; return; }
    if (!saveWarned) {
      saveWarned = true;
      toast('Autosave failed — browser storage is full. Delete a profile you no longer need.', true);
    }
  }, 250);
}

/* ---------------- automatic defaults ---------------- */

function fillDefaultsForMonth () {
  const ts = S.timesheet;
  const dim = daysInMonth(ts.year, ts.month);
  const pad = n => String(n).padStart(2, '0');

  if (!S.invoice.pStart) S.invoice.pStart = `${ts.year}-${pad(ts.month + 1)}-01`;
  if (!S.invoice.pEnd)   S.invoice.pEnd   = `${ts.year}-${pad(ts.month + 1)}-${pad(dim)}`;
  if (!S.invoice.due)    S.invoice.due    = S.invoice.pEnd;
  if (!S.invoice.date) {
    const now = new Date();
    S.invoice.date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
  /* Assignment Period is Month / Year said another way, so a saved profile
     opened in a new month is moved on rather than left dated to the month it
     was saved in. Anything that is not a month — somebody who wrote
     "Aug-Sep 26" on purpose — is left exactly as they wrote it. */
  const assigned = parseMonthLabel(S.consultant.assignPeriod);
  if (!String(S.consultant.assignPeriod || '').trim() ||
      (assigned && (assigned.y !== ts.year || assigned.m !== ts.month))) {
    S.consultant.assignPeriod = monthLabel(ts);
  }
  if (!S.timesheet.prepName) S.timesheet.prepName = S.consultant.name;
  if (!S.timesheet.reviewName) S.timesheet.reviewName = SIGN_DEFAULTS.review;
  if (!S.timesheet.apprName)  S.timesheet.apprName  = SIGN_DEFAULTS.hod;
  if (!S.timesheet.verifName) S.timesheet.verifName = SIGN_DEFAULTS.verified;
  /* The reviewer and the approver date their own boxes when they sign, so
     these only start filled the way the printed form starts filled — with
     today's date, which is what a blank form handed over today would have
     written on it. Every one of them is still an ordinary box: type a
     different date and it stays. */
  refreshAutoDates();
  /* The leave record is keyed by month, so a year turning over needs nothing
     done to it — last year's months simply stop being this year's. All this
     has to do is make sure the shape is there to write into. */
  if (!S.leave || typeof S.leave !== 'object') S.leave = { year: ts.year, pto: 0, mc: 0, ul: 0, counted: {} };
  if (!S.leave.counted || typeof S.leave.counted !== 'object') S.leave.counted = {};
  S.leave.year = ts.year;

  // an empty month is filled in from the calendar rather than left blank
  if (timesheetIsAuto(S)) autoFillMonth(S);

  lastName = S.consultant.name;
}

/**
 * Put a submitted claim back into the form. Used when one is sent back: the
 * consultant gets exactly what the approver saw, fixes it, and resubmits.
 */
function adoptSubmission (sub) {
  S = mergeDefaults(sub.data);
  activeProfile = '';
  fillDefaultsForMonth();
  clearProfileDirty();
  stepIndex = Math.max(0, activeSteps().findIndex(s => s.id === 'claim'));
  renderAll();
  persist();
  toast('Opened in the form. Fix it, then send it again from the Re-submit step.');
}

/* ---------------- signatures inside the form ---------------- */

/* Repaints the signature card on the Profile step. Drawing in a pad on the
   Claim page changes the same signature, so the card has to be told. */
let repaintProfileSig = () => {};

function mountSignatures () {
  Sig.reset(S, () => { persist(); repaintProfileSig(); paintProfileGate(); renderNavRows(); });

  document.querySelectorAll('[data-sig]').forEach(td => Sig.mount(td, td.dataset.sig));

  const slot = document.getElementById('invSigSlot');
  if (slot) {
    slot.innerHTML = '<div class="sigslot-host"></div><div class="signame"></div>';
    Sig.mount(slot.querySelector('.sigslot-host'), 'personnel');
    updateInvSigName();
  }

  repaintProfileSig = mountProfileSignature(
    document.getElementById('sigProfile'), S,
    () => { markProfileDirty(); persist(); paintProfileGate(); renderNavRows(); }
  ) || (() => {});
}

function updateInvSigName () {
  const el = document.querySelector('#invSigSlot .signame');
  if (el) el.innerHTML = `${S.consultant.name || '&nbsp;'}<small>Consultant</small>`;
}

/* ---------------- full UI refresh ---------------- */

function renderAll () {
  writeBindings();
  paintAdminFields();
  renderProfileCards();
  renderTimesheet(S, afterTimesheetChange);
  mountSignatures();
  syncInvoiceNo();
  syncAutoAmount();
  paintChoices();
  paintProfileGate();
  showStep();
}

/* ---------------- start-up ---------------- */

function boot () {
  mountBrandLogo();
  mountFootLogo();
  mountClaimLogo();

  const msel = document.getElementById('ts_month');
  msel.innerHTML = '';
  MONTHS.forEach((m, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = m;
    msel.appendChild(o);
  });

  fillDefaultsForMonth();
  writeBindings();
  bindInputs();

  paintAdminFields();
  renderTimesheet(S, afterTimesheetChange);
  mountSignatures();
  syncInvoiceNo();
  syncAutoAmount();
  paintChoices();
  paintProfileGate();
  showStep();

  document.querySelectorAll('.choice').forEach(c => {
    c.addEventListener('click', () => chooseMode(c.dataset.mode));
  });

  /* --- timesheet buttons --- */
  document.getElementById('btnAddActivity').addEventListener('click', () => {
    S.timesheet.activities.push(newActivity(''));
    renderTimesheet(S, afterTimesheetChange);
    persist();
    const fields = document.querySelectorAll('#activities .c-act input');
    if (fields.length) fields[fields.length - 1].focus();
  });
  document.getElementById('btnResetDays').addEventListener('click', () => {
    if (!confirm('Clear every day tick on every activity row?')) return;
    S.timesheet.activities.forEach(a => { a.days = {}; });
    // an empty sheet is an automatic one again: change the month and it fills
    S.timesheet.autoFilled = false;
    renderTimesheet(S, afterTimesheetChange);
    syncAutoAmount(); persist();
    toast('All ticks cleared.');
  });
  document.getElementById('btnFillDays').addEventListener('click', () => {
    const marked = !timesheetIsAuto(S);
    if (marked && !confirm(
      'Fill this month in from the calendar?\n\n' +
      'Every working day is ticked and the Selangor public holidays are marked PH. ' +
      'Anything already on the grid is replaced.')) return;
    const done = autoFillMonth(S);
    renderTimesheet(S, afterTimesheetChange);
    syncAutoAmount(); persist();
    const n = Object.keys(done.holidays).length;
    toast(done.known || !n
      ? `Month filled in${n ? `, ${n} public holiday${n > 1 ? 's' : ''} marked` : ''}.`
      : `Month filled in — only the fixed public holidays are known for ${S.timesheet.year}.`);
  });

  document.getElementById('btnAddItem').addEventListener('click', () => {
    S.invoice.items.push({ desc: '', position: S.consultant.position, period: '', amount: 0 });
    renderItems(); refreshTotals(); persist();
    const fields = document.querySelectorAll('#itemTable [data-f="desc"]');
    if (fields.length) fields[fields.length - 1].focus();
  });

  /* --- profiles --- */
  refreshProfileList();
  document.getElementById('btnSaveProfile').addEventListener('click', saveProfileNow);
  document.getElementById('btnProfiles').addEventListener('click', e => {
    e.stopPropagation();
    openProfiles(document.getElementById('profileMenu').hidden);
  });
  // anywhere else, and the list closes — including Escape, as a menu should
  document.addEventListener('click', e => {
    const box = document.getElementById('profileBox');
    if (box && !box.contains(e.target)) openProfiles(false);
  });
  document.addEventListener('keydown', e => {
    const menu = document.getElementById('profileMenu');
    if (e.key === 'Escape' && menu && !menu.hidden) {
      const hadFocus = menu.contains(document.activeElement);
      openProfiles(false);
      if (hadFocus) document.getElementById('btnProfiles').focus();
    }
  });

  /* --- reset everything --- */
  document.getElementById('btnReset').addEventListener('click', () => {
    if (!Auth.prepares()) return;
    const n = Object.keys(Store.profiles()).length;
    if (!confirm(
      [ 'Erase ALL data stored by this app?',
        '',
        '• the form currently open',
        `• ${n} saved profile(s)`,
        '• every signature',
        '',
        'PDF/Excel/Word files you have already downloaded are NOT affected.' ].join('\n')
    )) return;
    if (!confirm('Are you sure? This cannot be undone.')) return;

    Store.clearAll();
    Sync.forget();
    S = defaultState();
    activeProfile = '';
    fillDefaultsForMonth();
    stepIndex = 0;
    refreshProfileList();
    renderAll();
    Store.saveCurrent(S);
    toast('All data erased — the app is back to empty.');
  });

  /* --- look before you download --- */
  mountPdfViewer();
  wireView('btnInvPreview',   buildInvoicePDF, invoiceFileBase, 'Invoice Timesheet');
  wireView('btnClaimPreview', buildClaimPDF,   claimFileBase,   'Claim / Personnel Time Sheet');

  /* --- generate --- */
  wire('btnInvPdf',    generateInvoicePDF,  'Invoice PDF');
  wire('btnInvXlsx',   generateInvoiceXLSX, 'Invoice Excel');
  wire('btnClaimPdf',  generateClaimPDF,    'Claim PDF');
  wire('btnClaimDocx', generateClaimDOCX,   'Claim Word');

  /* --- sending the claim off to be approved --- */
  // one Refresh for the whole step: the table reads both
  document.getElementById('btnRefreshApprovals').addEventListener('click', async () => {
    await renderArchive(true);
    await renderApprovals();
  });
  const btnHist = document.getElementById('btnRefreshHistory');
  if (btnHist) btnHist.addEventListener('click', () => renderHistory(true));
  const btnAll = document.getElementById('btnDownloadAll');
  if (btnAll) btnAll.addEventListener('click', () => downloadAllHistory(btnAll));
  const btnDl = document.getElementById('btnRefreshSignDownload');
  if (btnDl) btnDl.addEventListener('click', () => renderSignDownload());
  const btnUp = document.getElementById('btnRefreshSignUpload');
  if (btnUp) btnUp.addEventListener('click', () => renderSignUpload());
  const advPreview = document.getElementById('adviceEditorPreview');
  if (advPreview) advPreview.addEventListener('click', () => previewAdvice(advPreview));
  const advSend = document.getElementById('adviceEditorSend');
  if (advSend) advSend.addEventListener('click', () => prepareAdvice(advSend));
  const advClose = document.getElementById('adviceEditorClose');
  if (advClose) advClose.addEventListener('click', () => closeAdviceEditor());

  const btnAdvice = document.getElementById('btnRefreshAdvice');
  if (btnAdvice) btnAdvice.addEventListener('click', () => renderAdvice());
  const btnFiled = document.getElementById('btnRefreshFiled');
  if (btnFiled) btnFiled.addEventListener('click', () => { archiveLoaded = false; renderFiled(); });
  const btnBack = document.getElementById('btnRefreshReturned');
  if (btnBack) btnBack.addEventListener('click', async () => {
    await loadReturned();
    renderResubmit();
    renderStepper();
  });

  document.getElementById('btnSubmitClaim').addEventListener('click', async () => {
    if (!validate()) return;
    if (!Sync.on) {
      toast('Cannot connect to submit. Check your connection and try again.', true);
      return;
    }
    const going = pickedKinds();
    if (!going.length) {
      toast('Tick at least one document to send.', true);
      return;
    }

    const btn = document.getElementById('btnSubmitClaim');
    const note = document.getElementById('submitNote');
    const was = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Sending…';

    /* One submission per document, because that is what gets approved. If the
       second one fails the first has still gone, and saying which went is
       more use than pretending neither did — the one that did not can be sent
       again from here without duplicating the one that did. */
    const sent = [];
    const failed = [];
    try {
      for (const kind of going) {
        try {
          await Sync.submit(S, note.value.trim(), kind);
          sent.push(kindLabel(kind));
        } catch (err) {
          failed.push(`${kindLabel(kind)}: ${err.message}`);
        }
      }
      if (sent.length) {
        note.value = '';
        afterSubmitted();
        submitPick = null;
      }
      if (failed.length) {
        toast(sent.length
          ? `${sent.join(' and ')} sent. ${failed[0]}`
          : failed[0], true);
      } else {
        toast(`${sent.join(' and ')} sent to the project manager.`);
      }
      if (sent.length) goToStep(activeSteps().findIndex(st => st.id === 'approvals'), true);
    } finally {
      btn.disabled = false;
      btn.textContent = was;
    }
  });

  /* -----------------------------------------------------------------------
     Last, and never blocking: ask BDOS whether the shared database is on
     offer. If it is not — not deployed, offline, not permitted — nothing
     above notices and the app stays exactly as it was.
     ----------------------------------------------------------------------- */
  Sync.init(S, adopted => {
    S = adopted;
    stepIndex = 0;
    renderAll();
    Store.saveCurrent(S);
  }).then(r => {
    /* The first paint happened while the probe was still out, so whatever
       step is open drew itself without the database — a PA saw "connecting"
       where their list goes. Now that the answer is in, draw it again. */
    if (!r.adopted) showStep();
    if (!r.on) return;
    if (r.adopted)     toast('Loaded the draft saved from your other device.');
    else if (r.gained) toast(`${r.gained} shared profile(s) loaded.`);
    refreshProfileList();
    // the probe is what decides whether a claim can be sent at all, and it
    // answers after the first paint
    renderSubmitStep();
    loadReturned().then(list => {
      if (!list.length) return;
      renderStepper();
      renderNavRows();
      toast(list.length === 1
        ? 'One document was sent back — see the Re-submit step.'
        : `${list.length} documents were sent back — see the Re-submit step.`, true);
    });
  });
}

function mountFootLogo () {
  const host = document.getElementById('footLogo');
  if (!host) return;
  host.innerHTML = geospatialFallbackMarkup();
  loadLogo('geospatial').then(l => { if (l) host.innerHTML = `<img src="${l.url}" alt="Geospatial AI" class="brand-img">`; });
}

function mountClaimLogo () {
  const host = document.getElementById('claimLogo');
  if (!host) return;
  host.innerHTML = '<span class="uz-fallback">UZM<i>A</i></span>';
  loadLogo('uzma').then(l => { if (l) host.innerHTML = `<img src="${l.url}" alt="UZMA">`; });
}

/** Wire a "View PDF" button: build the document, then show it on screen. */
function wireView (id, build, nameOf, label) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!validate()) return;
    const was = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparing…';
    try {
      openPdfPreview(label, `${nameOf(S)}.pdf`, await build(S), btn);
    } catch (err) {
      toast(`${label} could not be rendered.`, true);
      console.error(err);
    } finally {
      btn.disabled = false;
      btn.textContent = was;
    }
  });
}

function wire (id, fn, label) {
  document.getElementById(id).addEventListener('click', async () => {
    if (!validate()) return;
    try { await fn(S); generated.add(label); log(`✓ ${label} generated.`, 'ok'); toast(`${label} downloaded.`); }
    catch (err) { log(`✗ ${label} failed: ${err.message}`, 'err'); toast(`${label} could not be generated.`, true); console.error(err); }
  });
}

function validate () {
  if (!S.consultant.name.trim()) {
    toast('Enter your Full Name first (step 1).', true);
    return false;
  }
  return true;
}

function log (msg, cls) {
  const box = document.getElementById('genlog');
  box.classList.add('on');
  const d = document.createElement('div');
  d.className = cls || '';
  d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

/**
 * Save what is on screen. That is all it does.
 *
 * It used to ask for a profile name every time, which meant the ordinary
 * case — open a profile, change one thing, save it — was a dialog asking a
 * question that had already been answered. A profile that is open is saved
 * back to itself; a new one takes the name from the Full Name field, which
 * is the name it would have been given anyway.
 */
function saveProfileNow () {
  if (!Auth.prepares()) return;
  const name = (activeProfile || String(S.consultant.name || '')).trim();
  if (!name) {
    toast('Enter the Full Name first — that is what the profile is saved under.', true);
    const box = document.getElementById('c_name');
    if (box) box.focus();
    return;
  }
  /* A profile saved by a consultant is theirs, and saying so is what keeps
     it visible to them next time. The administrator is setting profiles up
     for other people, so theirs is only stamped when the field is empty and
     the account being stamped is their own. */
  if (!String(S.consultant.email || '').trim() && !Auth.setsNumbering()) {
    S.consultant.email = Auth.email();
  }

  if (!Store.saveProfile(name, S)) {
    toast('Could not save the profile (browser storage full?).', true);
    return;
  }
  activeProfile = name;
  clearProfileDirty();
  refreshProfileList();
  Sync.pushProfile(name, S);
  toast(`Saved to "${name}".`);
}

/* =======================================================================
   Saved profiles

   A dropdown could only ever load a profile; renaming one meant saving it
   again under the new name and deleting the old, and deleting one meant
   selecting it first. So the list is a menu of rows instead, and each row
   carries the two things you can do to that profile.
   ======================================================================= */

function openProfiles (open) {
  if (open && !Auth.prepares()) return;
  const menu = document.getElementById('profileMenu');
  const btn  = document.getElementById('btnProfiles');
  if (!menu || !btn) return;
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(!!open));
}

/**
 * Open a profile into the form, at Your Details. This is what editing one
 * means: its details are the form, so they are edited by filling the form
 * in, and Save Profile puts them back under the same name.
 */
function editProfile (name) {
  if (!Auth.prepares()) return;
  const p = Store.profiles()[name];
  if (p && !Auth.owns(mergeDefaults(p))) return;
  if (!p) { toast(`Profile "${name}" is no longer there.`, true); refreshProfileList(); return; }
  S = mergeDefaults(p);
  activeProfile = name;
  stepIndex = 0;                       // Your Details, which is what is being edited
  /* A profile saved in August, opened in September, is a September claim.
     The month, the Assignment Period and an untouched grid all move with it —
     the same thing that happens when the app is opened cold. */
  fillDefaultsForMonth();
  clearProfileDirty();
  renderAll();
  persist();
  openProfiles(false);
  refreshProfileList();
  toast(`Editing "${name}" — press Save changes when you are done.`);
}

/**
 * Start a fresh set of details. The profile itself appears in the list once
 * it is saved a name, which is also when it stops being able to be
 * abandoned by mistake — an empty profile is never left lying in the list.
 */
function newProfile () {
  if (!Auth.prepares()) return;
  if (!confirm('Start a new profile?\n\nThe form open right now is cleared. Saved profiles are not touched.')) return;
  S = defaultState();
  fillDefaultsForMonth();
  activeProfile = '';
  stepIndex = 0;
  clearProfileDirty();
  renderAll();
  persist();
  openProfiles(false);
  refreshProfileList();
  toast('New profile — fill in the details, then press Save Profile.');
}

function removeProfile (name) {
  const profile = Store.profiles()[name];
  if (!Auth.prepares() || !profile || !Auth.owns(mergeDefaults(profile))) return;
  if (!confirm(`Delete the profile "${name}"?

The form open right now is not touched.`)) return;
  Store.deleteProfile(name);
  Sync.deleteProfile(name);
  if (activeProfile === name) activeProfile = '';
  refreshProfileList();
  toast(`Profile "${name}" deleted.`);
}

/* =======================================================================
   Step 1: whose claim is this

   A card each, with the year's leave on it. Everything downstream — the
   invoice, the sheet, the pay — comes from whichever one is open, so this
   is the question the app asks first.
   ======================================================================= */

function renderProfileCards () {
  const host = document.getElementById('profileCards');
  const box  = document.getElementById('detailsBox');
  if (!host) return;

  /* A consultant sees their own profile and nobody else's. The
     administrator and the three approvers see everybody's — the approvers
     because they have to read what they are signing. */
  const everything = Store.profiles();
  const all = {};
  Object.keys(everything).forEach(name => {
    if (Auth.owns(mergeDefaults(everything[name]))) all[name] = everything[name];
  });
  /* In unique-ID order, and the ones without an ID last. The ID is the middle
     of every invoice number that person sends, so a profile that has one is
     ready to send and a profile that has not is a job still to do — which is
     the order somebody wants to see them in, and it puts the unfinished ones
     where they get noticed rather than scattered through the alphabet. */
  const cards = Object.keys(all).map(name => ({ name: name, p: mergeDefaults(all[name]) }));
  cards.sort((a, b) => {
    const ia = uniqueIdOf(a.p), ib = uniqueIdOf(b.p);
    if (!ia !== !ib) return ia ? -1 : 1;
    if (ia && ib && ia !== ib) {
      const na = Number(ia), nb = Number(ib);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return ia.localeCompare(ib);
    }
    return a.name.localeCompare(b.name);
  });
  const names = cards.map(c => c.name);
  host.innerHTML = '';

  cards.forEach(({ name, p }) => {
    const card = document.createElement('button');
    card.className = 'pcard' + (name === activeProfile ? ' on' : '');
    card.type = 'button';

    const head = document.createElement('b');
    head.textContent = name;
    card.appendChild(head);

    const sub = document.createElement('span');
    sub.className = 'pcardsub';
    sub.textContent = p.consultant.position || p.consultant.position2 || 'No position saved';
    card.appendChild(sub);

    // the unique ID is the middle of every invoice number this person sends,
    // so it belongs on the card that chooses them
    const id = document.createElement('span');
    const pid = String(p.consultant.uniqueId || '').trim();
    id.className = 'pcardid' + (pid ? '' : ' missing');
    id.textContent = pid ? `ID ${pid}` : 'no unique ID';
    card.appendChild(id);

    // the balance is the thing people open a profile to find out
    const chips = document.createElement('span');
    chips.className = 'pchips';
    leaveStandings(p).forEach(L => {
      const chip = document.createElement('i');
      chip.className = 'pchip ' + MARKS[L.mark] + (L.over ? ' over' : '');
      // a capped kind shows what is left, because that is the question;
      // an uncapped one has no answer to that, so it shows what was taken
      chip.textContent = L.limit == null ? `${L.mark} ${L.taken}` : `${L.mark} ${L.left}`;
      chip.title = L.limit == null
        ? `${L.name}: ${L.taken} taken in ${p.timesheet.year} — no yearly allowance`
        : `${L.name}: ${L.taken} of ${L.limit} taken in ${p.timesheet.year}, ${L.left} left`;
      chips.appendChild(chip);
    });
    card.appendChild(chips);

    card.addEventListener('click', () => editProfile(name));
    host.appendChild(card);
  });

  // the same rule as the menu: a new set of details is the office's to start
  if (Auth.isAdmin()) {
    const add = document.createElement('button');
    add.className = 'pcard new';
    add.type = 'button';
    add.innerHTML = '<b>+ New profile</b>';
    const addSub = document.createElement('span');
    addSub.className = 'pcardsub';
    addSub.textContent = names.length ? 'Start a fresh set of details' : 'Nothing saved yet — start here';
    add.appendChild(addSub);
    add.addEventListener('click', startNewProfile);
    host.appendChild(add);
  }

  // the details only appear once there is something to show them for
  if (box) {
    box.hidden = !(activeProfile || String(S.consultant.name || '').trim());
    const head = document.getElementById('detailsHead');
    if (head) head.textContent = 'Personal details';
  }
  renderLeave(S, 'leaveBoxProfile');
}

function startNewProfile () {
  if (!Auth.prepares()) return;
  if (String(S.consultant.name || '').trim() &&
      !confirm('Start a new profile? The details on screen stay saved under their own profile.')) return;
  S = defaultState();
  activeProfile = '';
  fillDefaultsForMonth();
  clearProfileDirty();
  renderAll();
  persist();
  const box = document.getElementById('detailsBox');
  if (box) box.hidden = false;
  const name = document.getElementById('c_name');
  if (name) name.focus();
  toast('New profile — fill the details in, then press Save Profile.');
}

function refreshProfileList () {
  const menu  = document.getElementById('profileMenu');
  const label = document.getElementById('profileCurrent');
  const canPrepare = Auth.prepares();
  const box = document.getElementById('profileBox');
  const reset = document.getElementById('btnReset');
  /* The picker is for somebody who holds several sets of details, which is
     the administrator. A consultant has one, the one the office assigned
     them, so the menu would be a list of one and a way to make a second. */
  if (box) box.hidden = !Auth.isAdmin();
  if (reset) reset.hidden = !canPrepare;
  if (!canPrepare) {
    openProfiles(false);
    if (menu) menu.innerHTML = '';
    if (label) label.textContent = '';
    return;
  }
  const profiles = Store.profiles();
  const names = Object.keys(profiles).filter(name => Auth.owns(mergeDefaults(profiles[name]))).sort();

  if (label) label.textContent = activeProfile || '— Select a profile —';
  renderProfileCards();

  /* The button sits under the details it saves, and says what it will do
     beside it rather than in a tooltip nobody hovers for. No ellipsis: it
     asks nothing, it saves. */
  const save = document.getElementById('btnSaveProfile');
  const hint = document.getElementById('saveHint');
  if (save) save.textContent = activeProfile ? 'Save changes' : 'Save Profile';
  if (hint) {
    hint.textContent = activeProfile
      ? `Updates "${activeProfile}".`
      : 'Save once and reuse next month.';
  }

  if (!menu) return;
  menu.innerHTML = '';

  if (!names.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No profiles saved yet.';
    menu.appendChild(empty);
  }

  names.forEach(name => {
    const row = document.createElement('div');
    row.className = 'prow' + (name === activeProfile ? ' on' : '');

    // names are typed by people and arrive from other people over BDOS, so
    // they go in as text and never as markup
    const open = document.createElement('button');
    open.className = 'pload';
    open.textContent = name;
    open.title = `Open "${name}" and edit its details`;
    open.addEventListener('click', () => editProfile(name));

    const del = document.createElement('button');
    del.className = 'picon pdel';
    del.textContent = 'Delete';
    del.title = `Delete "${name}"`;
    del.addEventListener('click', () => removeProfile(name));

    row.append(open, del);
    menu.appendChild(row);
  });

  /* Only the administrator starts another set of details. To every screen
     here a second profile is a second person, and who that person is, is
     the office's to say. */
  if (!Auth.isAdmin()) return;
  const add = document.createElement('button');
  add.className = 'padd' + (names.length ? ' sep' : '');
  add.textContent = '+  Add new profile';
  add.title = 'Clear the form and start another set of details';
  add.addEventListener('click', newProfile);
  menu.appendChild(add);
}

/* The app lives behind the BDOS sign-in gate — boot() runs once it opens. */
document.addEventListener('DOMContentLoaded', () => Auth.start(boot));

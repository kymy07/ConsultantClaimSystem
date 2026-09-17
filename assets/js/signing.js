/* =======================================================================
   signing.js — the PA's two pages: Download, and Upload

   The PA's whole part in a claim is the HOD's signature. Some months it is
   drawn in the app; most months it is a piece of paper on a desk, and the
   app's job is to hand that paper over and take it back. So the PA does not
   get the status table with its five columns and its month picker — they
   get two pages, named for the two things they do:

     Download — every time sheet the HOD has approved and not yet signed.
               Print it, put it in front of him.
     Upload   — the same list, each with a box for the signed scan. Putting
               a scan on a card is not sending it: it can be looked at and
               swapped until it is right. One Submit at the bottom files
               every one of them and closes those months. That is the last
               step of the claim — nobody collects it afterwards, and what
               it leaves behind lives in History.

   The administrator keeps the full flow and gets these two as well, because
   the admin stands in everywhere.
   ======================================================================= */

let signingSubs = [];          // everything the last load returned
let signingBusy = false;

/* The status a time sheet has when it is sitting with the PA. */
const SIGNING_STATUS = 'pending_signature';

/** the time sheets waiting on the HOD's signature, newest month first */
function waitingSignature () {
  return signingSubs
    .filter(s => s.status === SIGNING_STATUS && kindOf(s) === 'claim')
    .slice()
    .sort(byMonthThenName);
}

/** the payment advices that have come back from the HOD to be filed */
function waitingAdvice () {
  return signingSubs
    .filter(s => s.status === SIGNING_STATUS && kindOf(s) === 'advice')
    .slice()
    .sort(byMonthThenName);
}

/**
 * One line per person and month, whichever of the two documents is waiting.
 *
 * The two do not arrive together: a time sheet comes back from the HOD while
 * the advice for the same month is still being written, and the advice comes
 * back after the sheet has been filed. A row is a month, not a document, so
 * either one on its own is still a row and the other cell says why it is
 * empty.
 */
function uploadRows () {
  const rows = new Map();
  const put = (item, key) => {
    const who = String(item.consultant || '').trim();
    const id = `${who}|${item.period_year}|${item.period_month}`;
    if (!rows.has(id)) {
      rows.set(id, {
        consultant: who,
        period_year: item.period_year,
        period_month: item.period_month,
        invoice_no: item.invoice_no || '',
        claim: null,
        advice: null
      });
    }
    const row = rows.get(id);
    row[key] = item;
    if (!row.invoice_no) row.invoice_no = item.invoice_no || '';
  };
  waitingSignature().forEach(x => put(x, 'claim'));
  waitingAdvice().forEach(x => put(x, 'advice'));

  /* A closed document takes a signed copy too. The month is closed by the
     HOD's approval, not by the scan arriving, and a scan can arrive late,
     or be replaced by a better one — so in every month on the page, every
     approved document of everybody on the roster is a place to put one,
     whether it is still waiting or already closed. */
  const months = new Set([...rows.values()].map(r => `${r.period_year}|${r.period_month}`));
  const now = currentSigningMonth();
  months.add(`${now.y}|${now.m}`);
  const closed = (who, y, m, kind) => signingSubs.filter(s =>
    kindOf(s) === kind && s.status === 'complete' &&
    String(s.consultant || '').trim() === who &&
    Number(s.period_year) === y && Number(s.period_month) === m)[0] || null;
  months.forEach(key => {
    const [y, m] = key.split('|').map(Number);
    signingRoster().forEach(name => {
      const who = String(name || '').trim();
      const id = `${who}|${y}|${m}`;
      if (!rows.has(id)) {
        rows.set(id, { consultant: who, period_year: y, period_month: m, invoice_no: '',
                       claim: null, advice: null });
      }
      const row = rows.get(id);
      ['claim', 'advice'].forEach(kind => {
        if (!row[kind]) row[kind] = closed(who, y, m, kind);
        if (row[kind] && !row.invoice_no) row.invoice_no = row[kind].invoice_no || '';
      });
    });
  });
  return [...rows.values()].sort(byMonthThenName);
}

/** the documents on the page whose signed copy is not on the record yet */
function copiesOwed (rows) {
  let n = 0;
  rows.forEach(r => ['claim', 'advice'].forEach(kind => {
    if (!r[kind]) return;
    const filed = typeof archiveFor === 'function'
      ? archiveFor(r.consultant, r.period_year, Number(r.period_month) - 1, kind) : null;
    if (!filed) n++;
  }));
  return n;
}

function byMonthThenName (a, b) {
  return (b.period_year - a.period_year) || (b.period_month - a.period_month) ||
    String(a.consultant || '').localeCompare(String(b.consultant || ''));
}

/** read what is with the PA, and what has been through them */
async function loadSigning (host, retry) {
  if (!Sync.on) {
    host.innerHTML = Sync.offlineNote(
      'The claims live in the shared database, which this browser cannot reach right now.');
    return false;
  }
  workflowMessage(host, 'Loading time sheets and signed copies…');
  host.setAttribute('aria-busy', 'true');
  try {
    signingSubs = await Sync.submissions('');
    if (typeof ensureArchive === 'function') await ensureArchive();
  } catch (err) {
    workflowMessage(host, 'Time sheets could not be loaded. ' +
      (err.message || 'Check your connection and try again.'), retry);
    return false;
  } finally {
    host.removeAttribute('aria-busy');
  }
  return true;
}

/* learnKinds() in approvals.js reads the table's own list; here the same
   rows are looked up so a row without a kind is not read as the wrong one */
async function learnSigningKinds () {
  const missing = signingSubs.filter(s => !Sync.kindOf(s) && !kindCache.has(s.id));
  await Promise.all(missing.slice(0, KIND_LOOKUP_MAX).map(async s => {
    try {
      const full = await Sync.submission(s.id);
      kindCache.set(s.id, Sync.kindOf(full) || 'claim');
    } catch (err) {
      kindCache.set(s.id, 'claim');
    }
  }));
}

/* -------------------------------------------------------------------
   The same table the record is read in

   A month is read the same way wherever it is read: a table per month, a
   row per person, and each document in its own column with its name, its
   reference and its actions under it.
   ------------------------------------------------------------------- */

/**
 * Draw rows as one collect-list table per month.
 *
 * @param {string[]} columns  the document columns after Consultant
 * @param {function} cells    sub -> one element per column
 * @param {object} options
 *   roster        everybody to list, whether or not they have a row
 *   fallbackMonth the month to draw when nothing is waiting
 *   missing       (name, month) -> cells, for somebody with no row
 *   lines         (name, sub, month) -> an array of cell-arrays, one per
 *                 line. A month is two documents for the PA, and the name
 *                 belongs to the person rather than to each of them, so it
 *                 is written on the first line and the rest run under it.
 */
function signingMonthTables (host, rows, columns, cells, options) {
  const opts = options || {};
  const months = new Map();
  rows.forEach(sub => {
    const key = periodOf(sub);
    if (!months.has(key)) {
      months.set(key, { y: Number(sub.period_year), m: Number(sub.period_month), subs: [] });
    }
    months.get(key).subs.push(sub);
  });
  /* Nothing waiting is still a month with people in it. The table is drawn
     for this month, so the list of everybody and where they have got is on
     the page even on a day nothing needs signing. */
  if (!months.size && opts.fallbackMonth) {
    const f = opts.fallbackMonth;
    months.set(periodOf({ period_year: f.y, period_month: f.m }), { y: f.y, m: f.m, subs: [] });
  }
  months.forEach((entry, month) => {
    const wrap = document.createElement('div');
    wrap.className = 'history-table-wrap';
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', month + ' time sheets');
    const table = document.createElement('table');
    table.className = 'history-table signingtable';
    const caption = document.createElement('caption');
    caption.textContent = month;
    table.appendChild(caption);
    const head = document.createElement('thead');
    const titles = document.createElement('tr');
    ['Consultant'].concat(columns).forEach(label => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = label;
      titles.appendChild(th);
    });
    head.appendChild(titles);
    table.appendChild(head);
    const body = document.createElement('tbody');

    /* Everybody on the roster first, then the rows handed in on top of them,
       so a person with a time sheet waiting gets its actions and a person
       without one still has a line saying where they have got. */
    const byName = new Map();
    (opts.roster || []).forEach(n => {
      const who = String(n || '').trim();
      if (who) byName.set(who, null);
    });
    entry.subs.forEach(sub => byName.set(String(sub.consultant || '').trim() || '(no name)', sub));

    [...byName.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([name, sub]) => {
        const lines = opts.lines
          ? opts.lines(name, sub, entry)
          : [sub ? cells(sub) : (opts.missing ? opts.missing(name, entry) : [])];
        /* A name with nothing under it, one letter off another, gets the
           administrator's note on its first line; see duplicateProfileNote. */
        if (!sub) {
          const dup = duplicateProfileNote(name, () => {
            const panel = document.querySelector('.panel.active');
            const id = panel && panel.id;
            if (id === 'p-advice') renderAdvice();
            else if (id === 'p-todownload') renderSignDownload();
            else if (id === 'p-toupload') renderSignUpload();
          });
          if (dup && lines[0] && lines[0][0]) {
            const first = document.createElement('div');
            first.className = 'signcell';
            first.appendChild(lines[0][0]);
            first.appendChild(dup);
            lines[0][0] = first;
          }
        }
        lines.forEach((content, n) => {
          const row = document.createElement('tr');
          if (!sub && !opts.lines) row.className = 'signrow-quiet';
          if (n) row.classList.add('signrow-under');
          const person = document.createElement('th');
          person.scope = 'row';
          person.className = 'signwho' + (n ? ' cont' : '');
          /* Written once. Repeating it under itself reads as two people,
             which is exactly what somebody scanning a column of names is
             counting. */
          person.textContent = n ? '' : name;
          row.appendChild(person);
          content.forEach((c, i) => {
            const td = document.createElement('td');
            td.setAttribute('data-label', columns[i]);
            td.appendChild(c);
            row.appendChild(td);
          });
          body.appendChild(row);
        });
      });
    table.appendChild(body);
    wrap.appendChild(table);
    host.appendChild(wrap);
  });
}

/** everybody with a profile, and anybody who has a time sheet in the system */
function signingRoster () {
  const names = new Set(typeof filingNames === 'function' ? filingNames() : []);
  signingSubs.forEach(s => {
    const who = String(s.consultant || '').trim();
    if (who && kindOf(s) === 'claim') names.add(who);
  });
  return [...names];
}

/** this month, for a table that has no waiting rows to take a month from */
function currentSigningMonth () {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
}

/**
 * Where one person's time sheet for a month has got, in words.
 *
 * "Not submitted" only when there is no time sheet at all. A claim sitting
 * with the project manager or the HOD has been submitted, and saying
 * otherwise would send somebody chasing a person who already did their part.
 */
function sheetStatusWords (name, y, m) {
  const sub = signingSubs
    .filter(s => String(s.consultant || '').trim() === name &&
      Number(s.period_year) === y && Number(s.period_month) === m && kindOf(s) === 'claim')
    .sort((a, b) => String(b.updated_at || b.created_at || '')
      .localeCompare(String(a.updated_at || a.created_at || '')))[0];
  if (!sub) return 'Not submitted';
  if (sub.status === SIGNING_STATUS) return 'Waiting for signature';
  if (sub.status === 'complete') return 'Closed';
  return (typeof STATUS_TEXT === 'object' && STATUS_TEXT[sub.status]) || sub.status;
}

/** a status as a small labelled pill, coloured by what it asks of the PA */
function statusBadge (words) {
  const badge = document.createElement('span');
  badge.className = 'signstatus' +
    (words === 'Not submitted' ? ' missing'
      : words === 'Waiting for signature' ? ' waiting'
      : /^Sent to /.test(words) ? ' done' : '');
  badge.textContent = words;
  return badge;
}

/** an empty cell that says it is empty, rather than looking forgotten */
function emptyCell () {
  const dash = document.createElement('span');
  dash.className = 'history-missing';
  dash.textContent = '\u2014';
  return dash;
}

/** a document as the collect table shows one: its name, its reference, its actions */
function signingDocument (name, meta, actions) {
  const item = document.createElement('div');
  item.className = 'history-document';
  const words = document.createElement('div');
  words.className = 'history-document-words';
  const title = document.createElement('span');
  title.className = 'history-document-name';
  title.textContent = name;
  words.appendChild(title);
  if (meta) {
    const line = document.createElement('span');
    line.className = 'history-document-meta';
    line.textContent = meta;
    words.appendChild(line);
  }
  words.title = [name, meta].filter(Boolean).join(' \u00b7 ');
  item.appendChild(words);
  if (actions && actions.length) {
    const acts = document.createElement('div');
    acts.className = 'history-document-actions';
    actions.forEach(a => acts.appendChild(a));
    item.appendChild(acts);
  }
  return item;
}

/** an icon with its word beside it, drawn the way the collect table draws them */
function labelledIcon (icon, text, label, onClick) {
  const b = iconButton(icon, label, 'ghost small history-icon', onClick);
  const word = document.createElement('span');
  word.textContent = text;
  b.appendChild(word);
  return b;
}

/* -------------------------------------------------------------------
   Her own signature

   Everything else here is somebody else's document passing through. This
   one thing is hers: the signature that goes in the Prepared by box of
   every payment advice she writes.

   It is the control the Profile step uses, because signing is one act
   wherever it happens, and it is kept where an approver's signature is
   kept — in this browser, never in the shared record until it is printed
   on a form.
   ------------------------------------------------------------------- */

function renderMySignature () {
  const host = document.getElementById('sigPa');
  if (!host) return;
  mountSignaturePicker(host, {
    get: () => myLastSignature(),
    set: url => rememberSignature(url || '')
  }, () => { renderAdvice(); });
}

/** a line saying the Prepared by box will print empty, and where to fix it */
function adviceSignatureWarning () {
  if (myLastSignature()) return null;
  const note = document.createElement('p');
  note.className = 'keynote warn';
  note.textContent = 'Add your signature on the Signature step so the Prepared by box does not print blank.';
  return note;
}

/* -------------------------------------------------------------------
   Download
   ------------------------------------------------------------------- */

async function renderSignDownload () {
  const host = document.getElementById('signDownloadList');
  if (!host) return;
  if (!(await loadSigning(host, renderSignDownload))) return;
  await learnSigningKinds();

  host.innerHTML = '';
  const rows = waitingSignature();

  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'emptynote';
    empty.textContent = 'No time sheets awaiting the HOD\u2019s signature. Document statuses are shown below.';
    host.appendChild(empty);
  } else {
    const count = document.createElement('p');
    count.className = 'historycount';
    count.setAttribute('role', 'status');
    count.textContent = `${rows.length} time sheet${rows.length === 1 ? '' : 's'} ready to download for signing.`;
    host.appendChild(count);
    const bar = document.createElement('div');
    bar.className = 'btnrow';
    const all = button(`Download all (${rows.length})`, 'small',
                       () => downloadAllForSigning(rows, all));
    bar.appendChild(all);
    host.appendChild(bar);
  }

  /* Two lines per person, because a month is two documents to print: the
     time sheet the HOD signs, and the payment advice he signs with it. The
     name is the same on both, so it is written once. */
  signingMonthTables(host, rows, ['Document', 'Status'], null, {
    roster: signingRoster(),
    fallbackMonth: currentSigningMonth(),
    lines: (name, sub, month) => [
      downloadLine(name, month, 'claim', sub),
      downloadLine(name, month, 'advice', null)
    ]
  });
}

/** one document of one person's month: what it is, and where it has got */
function downloadLine (name, month, kind, claim) {
  /* `month.m` is the month the API numbers from one, as every other table
     here reads it. Treating it as a JavaScript month index looked for
     October's records under September and found nobody. */
  const where = { consultant: name, period_year: month.y, period_month: month.m };
  const who = `${name || 'consultant'}, ${MONTHS[Math.max(0, month.m - 1)]} ${month.y}`;
  const label = kind === 'advice' ? 'Payment Advice' : 'Time sheet';

  /* Printable once the HOD has approved it, and still printable after the
     month is closed: a copy can be needed late, or again. What is not
     printable is a document that has not come back from the approvers. */
  const closedClaim = kind === 'claim' && !claim ? signingSubs.filter(s =>
    kindOf(s) === 'claim' && s.status === 'complete' &&
    String(s.consultant || '').trim() === String(name || '').trim() &&
    Number(s.period_year) === month.y && Number(s.period_month) === month.m)[0] || null : null;
  const doc = kind === 'claim' ? (claim || closedClaim) : null;
  const advice = kind === 'advice' ? adviceFor(where) : null;
  const printable = s => !!s && (s.status === SIGNING_STATUS || s.status === 'complete');
  /* An advice nobody edited is still printable: it is built from the
     invoice the HOD approved, and that is the whole of it. So the invoice
     stands in for it here, and the PDF is drawn as an advice. */
  const paidInvoice = kind === 'advice' && !advice
    ? monthInvoice(name, month.y, month.m) : null;
  const ready = kind === 'claim' ? (printable(doc) ? doc : null)
    : printable(advice) ? advice
      : (adviceUnlocked(paidInvoice) ? paidInvoice : null);
  const target = kind === 'claim' ? doc : (advice || paidInvoice);

  const words = kind === 'claim'
    ? sheetStatusWords(name, month.y, month.m)
    : advice ? adviceWords(advice)
      : adviceUnlocked(paidInvoice) ? 'Ready to download' : 'Not written yet';

  if (!ready) {
    const closed = target && target.status === 'complete';
    const quiet = signingDocument(label, closed ? 'Signed and filed' : 'Not ready to print yet',
      target ? [labelledIcon('view', 'View', `View the ${label.toLowerCase()} for ${who}`,
                             () => reviewSubmission(target.id))] : []);
    quiet.classList.add('signdoc-quiet');
    return [quiet, statusBadge(words)];
  }

  return [signingDocument(label, ready.invoice_no || '', [
    labelledIcon('view', 'View', `View the ${label.toLowerCase()} for ${who}`,
                 () => reviewSubmission(ready.id)),
    labelledIcon('download', 'Download', `Download the ${label.toLowerCase()} for ${who}`,
                 control => downloadForSigning(ready, control, kind))
  ]), statusBadge(words)];
}

/**
 * The document as it was approved, as a PDF for the printer.
 *
 * `as` says which document to draw, because one row can stand for another:
 * an advice nobody edited is drawn from the invoice it pays.
 */
async function signingPdf (sub, as) {
  const kind = as || kindOf(sub);
  if (kind === 'advice') {
    /* Hers goes on it as it is printed, so the sheet the HOD signs already
       carries the Prepared by signature rather than an empty box. */
    const state = await adviceStateFor(sub, kindOf(sub) === 'advice' ? sub : null);
    return { blob: (await buildAdvicePDF(state)).output('blob'),
             name: adviceFileBase(state) + '.pdf' };
  }
  const full = await Sync.submission(sub.id);
  if (!full || !full.data) throw new Error('That document could not be read.');
  const state = mergeDefaults(full.data);
  return { blob: (await buildClaimPDF(state)).output('blob'), name: claimFileBase(state) + '.pdf' };
}

async function downloadForSigning (sub, btn, as) {
  if (signingBusy) return;
  signingBusy = true;
  // an icon with its word would lose the icon if its text were swapped out
  const drawn = btn.classList && btn.classList.contains('iconbtn');
  const was = btn.textContent;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  if (!drawn) btn.textContent = 'Preparing…';
  try {
    const pdf = await signingPdf(sub, as);
    saveAs(pdf.blob, pdf.name);
  } catch (err) {
    toast(err.message || 'Could not download that.', true);
  } finally {
    signingBusy = false;
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    if (!drawn) btn.textContent = was;
  }
}

async function downloadAllForSigning (rows, btn) {
  if (signingBusy) return;
  signingBusy = true;
  const was = btn.textContent;
  btn.disabled = true;
  let saved = 0;
  const failed = [];
  try {
    for (let i = 0; i < rows.length; i++) {
      btn.textContent = `Downloading ${i + 1} of ${rows.length}…`;
      try {
        const pdf = await signingPdf(rows[i]);
        saveAs(pdf.blob, pdf.name);
        saved++;
        // the browser needs a breath between saves, or it drops some
        await new Promise(res => setTimeout(res, 250));
      } catch (err) {
        failed.push(`${rows[i].consultant || rows[i].id}: ${err.message}`);
      }
    }
  } finally {
    signingBusy = false;
    btn.disabled = false;
    btn.textContent = was;
  }
  toast(failed.length
    ? `${saved} saved. ${failed.length} could not be: ${failed[0]}`
    : `${saved} file${saved === 1 ? '' : 's'} saved to your Downloads folder.`, !!failed.length);
}

/* -------------------------------------------------------------------
   Upload

   Two acts, not one. Putting the scan on the card is the PA saying "this is
   the signed one" — it can be looked at, and swapped for a better scan.
   Submitting is the PA saying "these months are done", and that one cannot
   be taken back: it files the scans, closes the claims and hands the months
   to Group People & Finance. So the button that does it is by itself, at the
   bottom, after everything it is going to send.
   ------------------------------------------------------------------- */

/* The scans put on cards and not yet sent: submission id → File. */
const attached = new Map();

async function renderSignUpload () {
  const host = document.getElementById('signUploadList');
  if (!host) return;
  if (!(await loadSigning(host, renderSignUpload))) return;
  await learnSigningKinds();

  host.innerHTML = '';

  if (!Sync.archiveOn) {
    workflowMessage(host, 'Signed copy uploads are not available yet. Keep the files on your ' +
      'device and contact your administrator to enable signed copy storage.');
    return;
  }

  /* Only what is still waiting. A month that has gone to Group People &
     Finance is confirmed: it is not reopened from here, and it lives in
     History under that name and that month, one copy each. */
  const waiting = uploadRows();

  /* A scan is held in this browser until Submit sends it, so one put on a
     card that is no longer in the list has nowhere to go. */
  const live = new Set();
  waiting.forEach(r => {
    if (r.claim) live.add(r.claim.id);
    if (r.advice) live.add(r.advice.id);
  });
  [...attached.keys()].forEach(id => { if (!live.has(id)) attached.delete(id); });

  const count = copiesOwed(waiting);
  const h1 = document.createElement('h3');
  h1.textContent = `Awaiting signed copies (${count})`;
  host.appendChild(h1);

  if (!count) {
    const empty = document.createElement('p');
    empty.className = 'emptynote';
    empty.textContent = 'All signed copies are filed. You can replace a scan below.';
    host.appendChild(empty);
  }
  /* Two lines per person, the same two the Download page prints: the signed
     time sheet and the signed payment advice, each against the month it
     belongs to. Only the signed copies are asked for here — the unsigned
     forms are on the Download page, and a column of them on this one was a
     column nobody clicked. */
  const byMonth = new Map();
  waiting.forEach(r => byMonth.set(`${r.consultant}|${r.period_year}|${r.period_month}`, r));
  signingMonthTables(host, waiting, ['Document', 'Status', 'Signed copy'], null, {
    roster: signingRoster(),
    fallbackMonth: currentSigningMonth(),
    lines: (name, row, month) => {
      const found = row || byMonth.get(`${name}|${month.y}|${month.m}`) ||
        { consultant: name, period_year: month.y, period_month: month.m,
          claim: null, advice: null };
      return [uploadLine(found, 'claim'), uploadLine(found, 'advice')];
    }
  });

  host.appendChild(submitBar());
}

/**
 * One document of one person's month: what it is, whether its signed copy
 * is in, and the box to put that copy in.
 *
 * Both documents work the same way and neither is sent until Submit, so the
 * two lines are the same line told which document it is for.
 */
function uploadLine (row, kind) {
  const label = kind === 'advice' ? 'Payment Advice' : 'Time sheet';
  const filed = typeof archiveFor === 'function'
    ? archiveFor(row.consultant, row.period_year, Number(row.period_month) - 1, kind) : null;
  const target = row[kind];
  const held = target && attached.get(target.id);

  /* A closed document with no scan on the record says so on its own line,
     because "Closed" beside an empty box otherwise reads as finished. */
  const meta = target && target.status === 'complete' && !filed && !held
    ? [row.invoice_no, 'closed — signed copy not on the record yet'].filter(Boolean).join(' · ')
    : (row.invoice_no || '');
  const doc = signingDocument(label, meta, []);
  if (!target && !filed) doc.classList.add('signdoc-quiet');

  const words = held ? 'Ready to submit'
    : filed ? 'Uploaded'
      : target ? 'Not uploaded'
        : uploadWaitingWords(row, kind);
  const badge = statusBadge(words);
  if (filed && !held) badge.classList.add('done');

  return [doc, badge, uploadSlot(row, kind, filed, target, held)];
}

/** where a document that cannot be uploaded yet has got to */
function uploadWaitingWords (row, kind) {
  if (kind === 'claim') {
    return sheetStatusWords(row.consultant, Number(row.period_year), Number(row.period_month));
  }
  const a = adviceFor(row);
  if (!a) return 'Not written yet';
  if (a.status === 'complete') return 'Closed';
  return adviceWords(a);
}

/**
 * One box to put a signed scan in.
 *
 * Nothing is uploaded here. The file is held in this browser until Submit,
 * because filing a copy and closing a month are one act and half of it is
 * worse than neither.
 */
function uploadSlot (row, kind, filed, target, file) {
  const who = `${row.consultant || 'consultant'}, ${periodOf(row)}`;
  const what = kind === 'advice' ? 'payment advice' : 'time sheet';

  const cell = document.createElement('div');
  cell.className = 'signcell';

  if (!target) {
    /* Nothing to upload against yet. What is already on file still shows,
       because a copy filed last month is the answer to "did that go?". */
    if (filed) cell.appendChild(onFileNote(filed, row, kind, false));
    else cell.appendChild(emptyCell());
    return cell;
  }

  if (file) {
    /* Put on, not sent. The cell names the file it is holding, offers it to
       be looked at, and offers to let it go again — all three, because the
       only thing worse than the wrong scan is the wrong scan nobody read. */
    const ready = signingDocument(file.name,
      `${Math.max(1, Math.round(file.size / 1024))} KB \u00b7 Ready to submit`, [
        labelledIcon('view', 'View', `View the signed ${what} chosen for ${who}`,
                     () => openFilePreview(`${row.consultant || ''} \u2014 ${periodOf(row)}`,
                                           file.name, file)),
        button('Remove', 'ghost small', () => { attached.delete(target.id); renderSignUpload(); })
      ]);
    ready.classList.add('signready-doc');
    cell.appendChild(ready);
  } else {
    const pick = document.createElement('div');
    pick.className = 'signpick';
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.setAttribute('aria-label', `Signed ${what} for ${who}`);
    inp.accept = '.pdf,.png,.jpg,.jpeg,image/*,application/pdf';
    inp.addEventListener('change', () => {
      const picked = inp.files && inp.files[0];
      if (!picked) return;
      if (picked.size > ARCHIVE_MAX_BYTES) {
        toast(picked.name + ' is over the ' +
              Math.round(ARCHIVE_MAX_BYTES / 1048576) + ' MB limit.', true);
        inp.value = '';
        return;
      }
      attached.set(target.id, picked);
      renderSignUpload();
    });
    pick.appendChild(inp);
    const hint = document.createElement('small');
    hint.className = 'signhint';
    hint.textContent = (filed ? 'Replacement: ' : 'Signed copy: ') + 'PDF or image, up to 12 MB.';
    pick.appendChild(hint);
    cell.appendChild(pick);
  }

  if (filed) cell.appendChild(onFileNote(filed, row, kind, true));
  return cell;
}

/** the copy already on the record, and a way to look at it */
function onFileNote (filed, row, kind, replaceable) {
  const note = signingDocument('Copy on file',
    'uploaded by ' + (filed.created_by || 'somebody') +
    (filed.created_at ? ' on ' + new Date(filed.created_at).toLocaleDateString() : '') +
    (replaceable ? ' \u00b7 replaced when you submit' : ''), [
      labelledIcon('view', 'View', 'View the copy on file for ' + (row.consultant || ''),
                   () => viewFiled(filed, row))
    ]);
  note.classList.add('signonfile');
  return note;
}

/** look at the copy already on file, without downloading it first */
async function viewFiled (rec, sub) {
  try {
    const full = await Sync.storedOne(rec.id);
    const f = full && (full.files || [])[0];
    if (!f || !f.content) { toast('That file is not on the record.', true); return; }
    const type = f.type || 'application/pdf';
    const bytes = dataUrlToBytes('data:' + type + ';base64,' + f.content);
    openFilePreview((sub.consultant || '') + ' — ' + periodOf(sub) + ' — on file',
                    f.name || 'signed.pdf', new Blob([bytes], { type: type }));
  } catch (err) {
    toast(err.message || 'Could not open that file.', true);
  }
}

/**
 * The copies already on file for one document, person and month.
 *
 * Only that document's own finished copies. A record old enough not to say
 * which document it is covers the invoice as well, and taking it off the
 * record would take the invoice with it.
 */
function copiesOnFile (sub, kind) {
  const who = String(sub.consultant || '').trim();
  const want = kind || 'claim';
  return archive.filter(r =>
    String(r.consultant || '').trim() === who &&
    Number(r.period_year) === Number(sub.period_year) &&
    Number(r.period_month) === Number(sub.period_month) &&
    r.kind === want && stageOf(r) === ARCHIVE_FINAL);
}

/**
 * One month, one copy: take the replaced ones off the record.
 *
 * BDOS clears the slot itself when the new copy goes up, so once it has that
 * change these are already gone and the requests find nothing. Until then this
 * does it, for the copies this account is allowed to remove. A refusal is
 * left alone: the newer copy is the one every screen reads either way.
 */
async function dropSuperseded (before, kept) {
  const mine = myEmail();
  for (const r of before) {
    if (kept && r.id === kept.id) continue;
    if (!Auth.isAdmin() && String(r.created_by || '').toLowerCase() !== mine) continue;
    try { await Sync.unstore(r.id); } catch (err) { /* already gone, or not ours */ }
  }
}

/* -------------------------------------------------------------------
   Submitting
   ------------------------------------------------------------------- */

/* The claim ends here. Nobody collects it afterwards: submitting files the
   signed copy, closes the month, and History is where it lives from then on. */

function submitBar () {
  const bar = document.createElement('div');
  bar.className = 'signsubmit';

  const ready = attached.size;

  const said = document.createElement('p');
  said.className = 'signsaid';
  said.setAttribute('role', 'status');
  said.textContent = ready
    ? ready + ' signed cop' + (ready === 1 ? 'y' : 'ies') + ' ready. Submit to file in History and close the month. ' +
      'Submit before leaving or reloading.'
    : 'Choose signed copies above, then submit to close those months.';
  bar.appendChild(said);

  const row = document.createElement('div');
  row.className = 'btnrow';
  const go = button('Submit and close the month', 'primary', () => submitSigned(go));
  go.disabled = !ready;
  row.appendChild(go);
  bar.appendChild(row);
  return bar;
}

/**
 * Send everything that has been put on a card.
 *
 * The scan is filed first and the month closed second. A scan on record for
 * a month still open is a small oddity; a month closed with the scan lost to
 * a failed upload is a month nobody can produce. Once the month is closed
 * the copy it replaced is taken off the record, so a month keeps one.
 */
async function submitSigned (go) {
  if (signingBusy) return;
  const jobs = [...attached.entries()]
    .map(([id, file]) => ({ sub: signingSubs.filter(s => s.id === id)[0], file }))
    .filter(j => j.sub);
  if (!jobs.length) { toast('Nothing has been put on a card yet.', true); return; }

  if (!confirm(
    'Submit ' + jobs.length + ' signed cop' + (jobs.length === 1 ? 'y' : 'ies') + '?\n\n' +
    jobs.map(j => j.sub.consultant + ' · ' + periodOf(j.sub)).join('\n') +
    '\n\nThose months are confirmed. They move to History, and any earlier copy for them is replaced.')) return;

  signingBusy = true;
  const was = go.textContent;
  go.disabled = true;
  let done = 0;
  const failed = [];
  const by = (Auth.user() || {}).name || myEmail();

  try {
    for (let i = 0; i < jobs.length; i++) {
      const sub = jobs[i].sub;
      go.textContent = 'Sending ' + (i + 1) + ' of ' + jobs.length + '…';
      try {
        const full = await Sync.submission(sub.id);
        const state = mergeDefaults((full && full.data) || {});
        const kind = kindOf(sub);
        const payload = await Sync.readFile(jobs[i].file);
        payload.name = kindLabel(kind) + ' (signed) — ' + payload.name;
        // noted before the new copy goes up, since it is about to replace them
        const before = copiesOnFile(sub, kind);
        const kept = await Sync.store(state, [payload],
          kindLabel(kind) + ' signed by ' + by +
          (before.length ? ' · replaces the earlier copy' : ''), kind, SIGNING_STATUS);
        if (sub.status === SIGNING_STATUS) await Sync.act(sub.id, 'approve', '');
        await dropSuperseded(before, kept);
        attached.delete(sub.id);
        done++;
      } catch (err) {
        failed.push((sub.consultant || sub.id) + ': ' + err.message);
      }
    }
  } finally {
    signingBusy = false;
    go.disabled = false;
    go.textContent = was;
  }

  archiveLoaded = false;            // everybody else reads the newest copy
  toast(failed.length
    ? done + ' sent. ' + failed.length + ' could not be: ' + failed[0]
    : done + ' signed cop' + (done === 1 ? 'y' : 'ies') + ' filed. ' +
      (done === 1 ? 'That month is' : 'Those months are') + ' closed, and in History now.',
    !!failed.length);
  await renderSignUpload();
}

/* -------------------------------------------------------------------
   Filed — what this account has sent on

   Download and Upload are the job in front of you. This is the job
   behind: every signed time sheet that has gone through here, a row
   each, so somebody asked "did September go?" can answer without
   opening a queue that no longer holds it.

   It carries the leave as well. A signed sheet is the month's evidence,
   and the first thing anybody asks about a month after it is closed is
   how many days of it were not worked. That answer is inside the form
   the copy was filed against, so it is read from there rather than
   typed anywhere: nobody can get it wrong, and nobody has to.
   ------------------------------------------------------------------- */

const leaveByMonth = new Map();      // submission id → { pto, mc, ul } | null

/** the submission a filed copy belongs to, so its form can be read */
function submissionForRecord (r) {
  const who = String(r.consultant || '').trim();
  return signingSubs.filter(s =>
    String(s.consultant || '').trim() === who &&
    Number(s.period_year) === Number(r.period_year) &&
    Number(s.period_month) === Number(r.period_month) &&
    kindOf(s) === 'claim')[0] || null;
}

/**
 * Read the leave off the forms these copies were filed against.
 *
 * One request each, so it is bounded the way the status table bounds its
 * own lookups — a year of history must not turn opening a tab into a
 * download. A month that was not read says so rather than saying zero.
 */
async function learnLeave (ids) {
  const want = [...new Set(ids.filter(id => id && !leaveByMonth.has(id)))];
  await Promise.all(want.slice(0, KIND_LOOKUP_MAX).map(async id => {
    try {
      const full = await Sync.submission(id);
      const state = mergeDefaults((full && full.data) || {});
      leaveByMonth.set(id, monthLeaveCounts(state.timesheet));
    } catch (err) {
      leaveByMonth.set(id, null);
    }
  }));
}

/** the leave of one month, said in words — '' when it was never read */
function leaveWords (counts) {
  if (!counts) return '';
  const said = LEAVE_KINDS
    .map(mark => ({ mark: mark, days: Number(counts[LEAVE_KEYS[mark]]) || 0 }))
    .filter(x => x.days > 0)
    .map(x => `${x.days} ${x.mark}`);
  return said.length ? said.join(' · ') : 'None';
}

/** the copies this account filed — everything, for the account that stands in */
function filedRecords () {
  const mine = myEmail();
  return latestCopies(archive)
    .filter(r => (r.kind || 'claim') === 'claim' && stageOf(r) === ARCHIVE_FINAL)
    .filter(r => Auth.isAdmin() ||
                 String(r.created_by || '').toLowerCase() === mine)
    .sort((a, b) => (b.period_year - a.period_year) ||
                    (b.period_month - a.period_month) ||
                    String(a.consultant || '').localeCompare(String(b.consultant || '')));
}

async function renderFiled () {
  const host = document.getElementById('filedList');
  if (!host) return;
  if (!(await loadSigning(host, renderFiled))) return;
  await learnSigningKinds();

  if (!Sync.archiveOn) {
    workflowMessage(host, 'Filed documents are not available yet. Contact your administrator ' +
      'to enable signed copy storage.');
    return;
  }

  const rows = filedRecords();
  if (!rows.length) {
    host.innerHTML = '<p class="emptynote">No signed time sheets filed yet. Submit them on the Re-Upload step.</p>';
    return;
  }

  workflowMessage(host, 'Loading leave details from the time sheets…');
  const pairs = rows.map(r => ({ rec: r, sub: submissionForRecord(r) }));
  await learnLeave(pairs.map(p => p.sub && p.sub.id));

  host.innerHTML = '';
  const count = document.createElement('p');
  count.className = 'historycount';
  count.setAttribute('role', 'status');
  count.textContent = `${rows.length} signed time sheet${rows.length === 1 ? '' : 's'} filed.`;
  host.appendChild(count);
  host.appendChild(filedTable(pairs));
}

function filedTable (pairs) {
  const wrap = document.createElement('div');
  wrap.className = 'history-table-wrap';
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', 'Time sheets sent on');

  const table = document.createElement('table');
  table.className = 'history-table filedtable';

  const head = document.createElement('thead');
  const titles = document.createElement('tr');
  ['Month', 'Consultant', 'Leave that month', 'Signed copy'].forEach(label => {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    titles.appendChild(cell);
  });
  head.appendChild(titles);
  table.appendChild(head);

  const body = document.createElement('tbody');
  pairs.forEach(({ rec, sub }) => {
    const row = document.createElement('tr');

    const when = document.createElement('th');
    when.scope = 'row';
    const m = Number(rec.period_month) || 0;
    when.textContent = `${MONTHS[Math.max(0, m - 1)]} ${rec.period_year || ''}`.trim();
    row.appendChild(when);

    const who = document.createElement('td');
    who.setAttribute('data-label', 'Consultant');
    who.textContent = String(rec.consultant || '').trim() || '(no name)';
    row.appendChild(who);

    const leave = document.createElement('td');
    leave.setAttribute('data-label', 'Leave that month');
    const words = leaveWords(sub ? leaveByMonth.get(sub.id) : null);
    if (words) {
      leave.textContent = words;
      if (words === 'None') leave.className = 'history-missing';
    } else {
      leave.className = 'history-missing';
      leave.textContent = 'Not read';
      leave.title = 'The sheet this copy was filed against could not be read.';
    }
    row.appendChild(leave);

    const copy = document.createElement('td');
    copy.setAttribute('data-label', 'Signed copy');
    const item = document.createElement('div');
    item.className = 'history-document';
    const words2 = document.createElement('div');
    words2.className = 'history-document-words';
    const name = document.createElement('span');
    name.className = 'history-document-name';
    name.textContent = (rec.files || [])[0] && rec.files[0].name || 'Signed time sheet';
    words2.appendChild(name);
    const meta = document.createElement('span');
    meta.className = 'history-document-meta';
    meta.textContent = [rec.invoice_no || '',
      rec.created_at ? 'sent ' + new Date(rec.created_at).toLocaleDateString() : '']
      .filter(Boolean).join(' · ');
    words2.appendChild(meta);
    item.appendChild(words2);

    const acts = document.createElement('div');
    acts.className = 'history-document-actions';
    const label = `${rec.consultant || ''} — ${when.textContent}`;
    const view = iconButton('view', 'View the signed copy for ' + label,
      'ghost small history-icon', () => viewStored(rec, when.textContent));
    const viewLabel = document.createElement('span');
    viewLabel.textContent = 'View';
    view.appendChild(viewLabel);
    acts.appendChild(view);
    const download = iconButton('download', 'Download the signed copy for ' + label,
      'ghost small history-icon', control => saveStored(rec, control));
    const downloadLabel = document.createElement('span');
    downloadLabel.textContent = 'Download';
    download.appendChild(downloadLabel);
    acts.appendChild(download);
    /* The month itself, rather than the one document this row is about. */
    const whole = iconButton('download', 'Download all three documents for ' + label + ' as one zip',
      'ghost small history-icon', control => downloadMonthZip(rec, control));
    const wholeLabel = document.createElement('span');
    wholeLabel.textContent = 'Month zip';
    whole.appendChild(wholeLabel);
    acts.appendChild(whole);
    item.appendChild(acts);
    copy.appendChild(item);
    row.appendChild(copy);

    body.appendChild(row);
  });
  table.appendChild(body);
  wrap.appendChild(table);
  return wrap;
}

/** open the filed copy in the viewer the claims use */
async function viewStored (rec, label) {
  try {
    const full = await Sync.storedOne(rec.id);
    const f = full && (full.files || [])[0];
    if (!f || !f.content) { toast('That file is not on the record.', true); return; }
    const type = f.type || 'application/pdf';
    const bytes = dataUrlToBytes('data:' + type + ';base64,' + f.content);
    openFilePreview(`${rec.consultant || ''} — ${label}`,
                    f.name || 'signed.pdf', new Blob([bytes], { type: type }));
  } catch (err) {
    toast(err.message || 'Could not open that file.', true);
  }
}

/** and save a copy of it */
async function saveStored (rec, control) {
  if (control) control.disabled = true;
  try {
    const full = await Sync.storedOne(rec.id);
    const f = full && (full.files || [])[0];
    if (!f || !f.content) { toast('That file is not on the record.', true); return; }
    const type = f.type || 'application/octet-stream';
    const bytes = dataUrlToBytes('data:' + type + ';base64,' + f.content);
    saveAs(new Blob([bytes], { type: type }), archiveFileName(rec, f));
  } catch (err) {
    toast(err.message || 'Could not fetch that file.', true);
  } finally {
    if (control) control.disabled = false;
  }
}

/* -------------------------------------------------------------------
   Payment Advice — the office's own form

   The consultant's two documents are theirs: they write them and they sign
   them. This one is Uzma's. It pays an invoice the HOD has already
   approved, so it cannot exist before that, and it carries nothing the
   invoice does not already say.

   It travels the road the time sheet travels — the project manager, the
   HOD, then back here — and the last step is two signatures rather than
   one: the HOD's, in the box the form calls Approved by, and the PA's own,
   in the box it calls Prepared by.
   ------------------------------------------------------------------- */

/**
 * The invoices a payment advice could be written against.
 *
 * Every invoice that has been sent counts, not only the approved ones. The
 * advice is locked until the consultant sends the invoice, because there is
 * nothing to pay before that; once it is sent the PA can get the form ready
 * while it travels, and the row keeps saying where the invoice itself is.
 */
function invoicesSubmitted () {
  return signingSubs
    .filter(s => kindOf(s) === 'invoice')
    .slice()
    .sort(byMonthThenName);
}

/**
 * Can an advice be written for this invoice yet?
 *
 * One exception to "it has been sent": an invoice sent back to the consultant
 * is going to change, and its figures are the only figures this form has.
 * Writing one against it would be paying a bill somebody has already
 * disputed, so the row waits for it to come round again.
 */
function adviceUnlocked (invoice) {
  /* Only once the HOD has approved the invoice. The advice pays that bill,
     and its figures are the bill's; writing it against an invoice still
     being argued about would be writing it against a number that may
     change. An invoice finishes at the HOD, so approved means complete. */
  return !!invoice && invoice.status === 'complete';
}

/** the invoice for one person and month, whatever stage it has reached */
function monthInvoice (name, year, month) {
  const who = String(name || '').trim();
  return signingSubs.filter(s =>
    kindOf(s) === 'invoice' &&
    String(s.consultant || '').trim() === who &&
    Number(s.period_year) === Number(year) &&
    Number(s.period_month) === Number(month))[0] || null;
}

/** the advice for one person and month, whatever stage it has reached */
function adviceFor (sub) {
  const who = String(sub.consultant || '').trim();
  return signingSubs.filter(s =>
    kindOf(s) === 'advice' &&
    String(s.consultant || '').trim() === who &&
    Number(s.period_year) === Number(sub.period_year) &&
    Number(s.period_month) === Number(sub.period_month))[0] || null;
}

/** where one advice has got, in the words the page uses */
function adviceWords (advice) {
  if (!advice) return 'Ready to download';
  if (advice.status === 'complete') return 'Signed and filed';
  if (advice.status === SIGNING_STATUS) return 'Edited \u00b7 ready to download';
  if (advice.status === 'returned') return 'Sent back';
  return (typeof STATUS_TEXT === 'object' && STATUS_TEXT[advice.status]) || advice.status;
}

/**
 * One line for the Status column.
 *
 * Until the advice exists the interesting thing is the invoice, because that
 * is what the PA is waiting on; afterwards it is the advice, because that is
 * what she is working on. Saying "Not prepared" beside an invoice nobody has
 * sent yet would hide the reason it is not prepared.
 */
function adviceStatusWords (invoice, advice) {
  if (advice) return adviceWords(advice);
  if (!invoice) return 'Invoice not submitted';
  if (invoice.status === 'complete') return 'Invoice approved';
  const words = String((typeof STATUS_TEXT === 'object' && STATUS_TEXT[invoice.status]) ||
                       invoice.status);
  return 'Invoice \u00b7 ' + words.charAt(0).toLowerCase() + words.slice(1);
}

/** the cell for somebody whose invoice for that month has not arrived */
function adviceLockedCell () {
  const cell = document.createElement('div');
  cell.className = 'signcell';
  cell.appendChild(signingDocument('Locked', 'Available after HOD invoice approval', []));
  return cell;
}

async function renderAdvice () {
  const host = document.getElementById('adviceList');
  if (!host) return;
  if (!(await loadSigning(host, renderAdvice))) return;
  await learnSigningKinds();

  host.innerHTML = '';
  const rows = invoicesSubmitted();

  const count = document.createElement('p');
  count.className = 'historycount';
  count.setAttribute('role', 'status');
  const ready = rows.filter(sub => {
    const a = adviceFor(sub);
    return adviceUnlocked(sub) && (!a || a.status === SIGNING_STATUS);
  }).length;
  count.textContent = ready
    ? `${ready} payment advice${ready === 1 ? ' is' : 's are'} ready to download.`
    : 'Nothing is ready here yet.';
  host.appendChild(count);

  /* Everybody with a profile is on the table whether or not their invoice has
     arrived, so the page answers "who is left?" as well as "what can I do?" */
  signingMonthTables(host, rows, ['Status', 'Payment Advice'], sub => {
    const advice = adviceFor(sub);
    const who = `${sub.consultant || 'consultant'}, ${periodOf(sub)}`;
    const actions = [];

    if (advice) {
      actions.push(labelledIcon('view', 'View', 'View the payment advice for ' + who,
                                () => reviewSubmission(advice.id)));
    }

    const cell = document.createElement('div');
    cell.className = 'signcell';
    cell.appendChild(signingDocument(
      adviceUnlocked(sub) ? 'Payment Advice' : 'Locked',
      adviceUnlocked(sub) ? 'From invoice ' + (sub.invoice_no || '')
        : sub.status === 'returned' ? 'Awaiting invoice resubmission'
          : 'Available after HOD invoice approval',
      actions));

    /* Ready from the moment the HOD approves the invoice, whether or not
       anybody has opened it: Preview to read it, Edit to correct it. There
       is nothing to write and nothing to send — the Download step has it
       either way. */
    const bar = document.createElement('div');
    bar.className = 'btnrow';
    if (adviceUnlocked(sub) && (!advice || advice.status === SIGNING_STATUS)) {
      const look = button('Preview', 'ghost small', () => previewAdviceFor(sub, advice, look));
      bar.appendChild(look);
      const go = button('Edit', 'primary small', () => openAdviceEditor(sub, go));
      bar.appendChild(go);
    }
    if (bar.children.length) cell.appendChild(bar);

    return [statusBadge(adviceStatusWords(sub, advice)), cell];
  }, {
    roster: signingRoster(),
    fallbackMonth: currentSigningMonth(),
    missing: () => [statusBadge('Invoice not submitted'), adviceLockedCell()]
  });
}

/* -------------------------------------------------------------------
   Writing one

   It is filled in the way every other document here is filled in: on the
   form itself. The boxes are where the printed sheet puts them, so somebody
   who has filled one in on paper is not learning a new screen — they are
   looking at the same sheet with the typing done for them.

   Most of it is already known and none of that is offered: the vendor, the
   invoice it pays, the amount and the month come from the claim, because a
   payment advice that disagrees with its own invoice is the one mistake this
   form can make. What is left is the office's own, and what the profile
   already answers is answered.
   ------------------------------------------------------------------- */

/** a value the invoice decided: shown in its box, not offered for typing */
function advFixed (value, cls) {
  const cell = document.createElement('span');
  cell.className = 'adv-box adv-fixed' + (cls ? ' ' + cls : '');
  cell.textContent = value == null ? '' : String(value);
  return cell;
}

/** one of the office's own boxes, typed into where the sheet has it */
function advInput (value, onChange, opts) {
  const o = opts || {};
  const input = document.createElement('input');
  input.className = 'adv-box adv-in' + (o.cls ? ' ' + o.cls : '');
  input.value = value == null ? '' : String(value);
  if (o.placeholder) input.placeholder = o.placeholder;
  if (o.label) input.setAttribute('aria-label', o.label);
  if (o.numeric) { input.inputMode = 'numeric'; }
  const tell = () => onChange(input.value);
  input.addEventListener('input', tell);
  input.addEventListener('change', tell);
  return input;
}

/**
 * One of the form's tick boxes.
 *
 * They behave as the paper does: ticking Yes unticks No, because the sheet
 * has one answer and two boxes. A checkbox rather than a radio, so that
 * clicking the ticked one clears it back to unanswered, which is the state
 * the form starts in and a perfectly good answer for a box marked
 * "if applicable".
 */
function advTick (text, on, onPick) {
  const wrap = document.createElement('label');
  wrap.className = 'adv-tick';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!on;
  input.addEventListener('change', () => onPick(input.checked));
  const word = document.createElement('span');
  word.textContent = text;
  wrap.appendChild(input);
  wrap.appendChild(word);
  return wrap;
}

/** a labelled line of the form: the label on the left, the boxes beside it */
function advRow (label, nodes, cls) {
  const row = document.createElement('div');
  row.className = 'adv-row' + (cls ? ' ' + cls : '');
  const name = document.createElement('span');
  name.className = 'adv-label';
  name.textContent = label;
  row.appendChild(name);
  const rest = document.createElement('div');
  rest.className = 'adv-fields';
  nodes.forEach(n => rest.appendChild(typeof n === 'string' ? advWord(n) : n));
  row.appendChild(rest);
  return row;
}

function advWord (text, cls) {
  const span = document.createElement('span');
  span.className = 'adv-word' + (cls ? ' ' + cls : '');
  span.textContent = text;
  return span;
}

function advBand (text, quiet) {
  const band = document.createElement('div');
  band.className = 'adv-band';
  band.textContent = text;
  if (quiet) {
    const small = document.createElement('i');
    small.textContent = ' ' + quiet;
    band.appendChild(small);
  }
  return band;
}

/** the whole sheet, as a page somebody types on */
function adviceFormDoc (state, changed) {
  const F = adviceFields(state);
  const a = state.advice;
  const set = (key, value) => { a[key] = value; changed(); };

  const doc = document.createElement('div');
  doc.className = 'doc doc-advice';

  /* ---- the letterhead ---- */
  const head = document.createElement('div');
  head.className = 'adv-head';
  const titles = document.createElement('div');
  titles.className = 'adv-titles';
  const h = document.createElement('b');
  h.textContent = 'PAYMENT ADVICE';
  const sub = document.createElement('span');
  sub.textContent = '( To Vendor )';
  titles.appendChild(h);
  titles.appendChild(sub);
  const addr = document.createElement('div');
  addr.className = 'adv-letter';
  ['Uzma Engineering Sdn. Bhd.', 'Uzma Tower,', 'No 2, Jalan PJU 8/8A, Damansara Perdana,',
   '47820 Petaling Jaya, Selangor, Malaysia.', 'Tel : +603.7611.4000', 'Fax: +603.7611.4100']
    .forEach(line => {
      const p = document.createElement('span');
      p.textContent = line;
      addr.appendChild(p);
    });
  head.appendChild(titles);
  head.appendChild(addr);
  doc.appendChild(head);

  /* ---- primary details ---- */
  doc.appendChild(advBand('Primary Details'));
  doc.appendChild(advRow('Department Code', [advFixed(F.dept, 'w-sm')]));
  doc.appendChild(advRow('Vendor Name', [advFixed(F.vendor, 'w-full')]));
  doc.appendChild(advRow('Vendor Address', [advFixed(F.address, 'w-full adv-tall')]));
  doc.appendChild(advRow('Payment Term', [
    advInput(a.terms, v => set('terms', v),
             { cls: 'w-xs ta-c', placeholder: '30', label: 'Payment term in days', numeric: true }),
    advWord('Days'),
    advTick('Back-To-Back', !!a.backToBack, on => set('backToBack', on)),
    advTick('Advance Payment', a.advance !== false, on => set('advance', on))
  ]));

  /* ---- the documents this advice pays against ---- */
  const table = document.createElement('table');
  table.className = 'adv-docs';
  table.innerHTML = `
    <thead>
      <tr>
        <th>#</th><th>Invoice / Bill Number</th><th>Invoice / Bill Received Date</th>
        <th>PO Number<br><i>(if applicable)</i></th>
        <th>Project Code<br><i>(if applicable)</i></th><th>Amount</th>
      </tr>
      <tr class="adv-attach">
        <td></td><td>- Attach Invoice / Bill -</td><td></td>
        <td>- Attach PO -</td><td>- Attach PFS -</td><td></td>
      </tr>
    </thead>
    <tbody></tbody>`;
  const body = table.querySelector('tbody');
  for (let n = 1; n <= 5; n++) {
    const tr = document.createElement('tr');
    const idx = document.createElement('td');
    idx.textContent = String(n);
    idx.className = 'ta-c';
    tr.appendChild(idx);
    for (let c = 0; c < 5; c++) {
      const td = document.createElement('td');
      if (n === 1) {
        if (c === 0) td.appendChild(advFixed(F.invoiceNo, 'bare ta-c'));
        if (c === 1) td.appendChild(advFixed(F.received, 'bare ta-c'));
        if (c === 2) td.appendChild(advInput(a.poNo, v => set('poNo', v),
          { cls: 'bare ta-c', label: 'PO number' }));
        if (c === 3) td.appendChild(advInput(a.projectCode, v => set('projectCode', v),
          { cls: 'bare ta-c', label: 'Project code' }));
        if (c === 4) td.appendChild(advFixed('RM' + money(F.amount), 'bare ta-r'));
      }
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  const foot = document.createElement('tr');
  foot.className = 'adv-total';
  foot.innerHTML = `<td colspan="4"><i>Notes: Arrange the attachments in sequence start with
    Invoice, Bill, PO, PFS, TRF and others.</i></td><td class="ta-r">TOTAL</td>`;
  const total = document.createElement('td');
  total.className = 'ta-r';
  total.appendChild(advFixed('RM' + money(F.amount), 'bare ta-r strong'));
  foot.appendChild(total);
  body.appendChild(foot);
  doc.appendChild(advRow('Documents', [table], 'adv-docrow'));

  /* ---- other details: the left column, then the panels beside it ---- */
  doc.appendChild(advBand('Other Details', '(If applicable)'));
  const other = document.createElement('div');
  other.className = 'adv-other';

  const left = document.createElement('div');
  left.className = 'adv-otherleft';
  left.appendChild(advRow('Details of Payment', [advFixed(F.details, 'w-full adv-tall')]));
  const note = document.createElement('p');
  note.className = 'adv-note';
  note.textContent = 'For services paying to foreign beneficiary, please indicate whether ' +
    'services are rendered inside or outside Malaysia.';
  left.appendChild(note);
  left.appendChild(advRow('Staff/ Consultant', [
    advInput(a.staff, v => set('staff', v), { cls: 'w-md', label: 'Staff or consultant' }),
    advWord('- Attach TRF -', 'adv-attachword')
  ]));
  left.appendChild(advRow('Chargeable to Client', [
    advTick('Yes', a.chargeable === 'yes', on => set('chargeable', on ? 'yes' : '')),
    advTick('No', a.chargeable === 'no', on => set('chargeable', on ? 'no' : ''))
  ]));
  left.appendChild(advRow('Account Manager', [
    advInput(a.manager, v => set('manager', v), { cls: 'w-md', label: 'Account manager' })
  ]));
  left.appendChild(advRow('Cost Category',
    ADV_CATEGORIES.map(c => advTick(c, a.category === c, on => set('category', on ? c : '')))));
  other.appendChild(left);

  const right = document.createElement('div');
  right.className = 'adv-otherright';
  const gl = document.createElement('table');
  gl.className = 'adv-gl';
  gl.innerHTML = '<thead><tr><th>GL Code</th><th>Amount</th></tr></thead><tbody></tbody>';
  const glBody = gl.querySelector('tbody');
  ADV_GL.forEach(code => {
    const tr = document.createElement('tr');
    const c = document.createElement('td');
    c.textContent = code;
    c.className = 'ta-c';
    const v = document.createElement('td');
    v.className = 'ta-r';
    if (code === ADV_DEPT) v.textContent = 'RM' + money(F.amount);
    tr.appendChild(c);
    tr.appendChild(v);
    glBody.appendChild(tr);
  });
  const charge = document.createElement('div');
  charge.className = 'adv-charge';
  charge.appendChild(advWord('Charge Back To', 'adv-turn'));
  charge.appendChild(gl);
  right.appendChild(charge);

  const tax = document.createElement('div');
  tax.className = 'adv-tax';
  const taxHead = document.createElement('b');
  taxHead.textContent = 'Witholding Tax';
  tax.appendChild(taxHead);
  const pct = document.createElement('div');
  pct.className = 'adv-taxrow';
  pct.appendChild(advWord('Yes, percentage:'));
  pct.appendChild(advInput(a.withholding, v => set('withholding', v),
    { cls: 'w-xs ta-c', label: 'Withholding tax percentage', numeric: true }));
  pct.appendChild(advWord('%'));
  tax.appendChild(pct);
  ['Verified by:', 'Name :', 'Date  :'].forEach(line => {
    const p = document.createElement('div');
    p.className = 'adv-taxline';
    p.appendChild(advWord(line));
    tax.appendChild(p);
  });
  const dept = document.createElement('span');
  dept.className = 'adv-taxdept';
  dept.textContent = '(Tax Department)';
  tax.appendChild(dept);
  right.appendChild(tax);
  other.appendChild(right);
  doc.appendChild(other);

  /* ---- who prepared it, and who approved it ---- */
  doc.appendChild(advBand('Payment Advice Approval'));
  const sign = document.createElement('div');
  sign.className = 'adv-sign';
  const ink = state.sig || {};
  [
    ['Prepared by :', F.preparedName, F.preparedDate, '', ink.pa],
    ['Reviewed by :', '', '', '(if required)', ''],
    ['Approved by :', F.approvedName, F.approvedDate, '', ink.hod]
  ].forEach(col => {
    const cell = document.createElement('div');
    cell.className = 'adv-signcol';
    const title = document.createElement('b');
    title.textContent = col[0];
    cell.appendChild(title);
    if (col[3]) {
      const small = document.createElement('i');
      small.textContent = col[3];
      cell.appendChild(small);
    }
    /* Her signature, shown where it will print. It is put on the Signature
       step and carried here, so the box she is looking at is the box the
       HOD will be handed rather than a promise that it will be filled. */
    if (col[4]) {
      const mark = document.createElement('img');
      mark.className = 'adv-sig';
      mark.src = col[4];
      mark.alt = col[1] ? col[1] + '’s signature' : 'Signature';
      cell.appendChild(mark);
    }
    const rule = document.createElement('span');
    rule.className = 'adv-rule';
    cell.appendChild(rule);
    const name = document.createElement('div');
    name.className = 'adv-signline';
    name.appendChild(advWord('Name :'));
    name.appendChild(advFixed(col[1], 'bare'));
    cell.appendChild(name);
    const when = document.createElement('div');
    when.className = 'adv-signline';
    when.appendChild(advWord('Date  :'));
    when.appendChild(advFixed(col[2], 'bare'));
    cell.appendChild(when);
    sign.appendChild(cell);
  });
  doc.appendChild(sign);

  doc.appendChild(advBand('Finance Account Payable Department'));
  const fin = document.createElement('div');
  fin.className = 'adv-fin';
  fin.appendChild(advWord('Received by :'));
  fin.appendChild(advWord('Received Date :'));
  doc.appendChild(fin);

  const footer = document.createElement('div');
  footer.className = 'adv-foot';
  ['UZMA-FA01-IMS-OS01 (F01)', 'Rev. No. : 05', 'Rev. Date: 19 Jan 2018']
    .forEach(t => footer.appendChild(advWord(t)));
  doc.appendChild(footer);

  return doc;
}

/* The dialog's own state: which invoice is open, and the form built for it. */
let adviceOpen = null;
let adviceBackground = [];
let adviceScroll = '';
let adviceTrigger = null;

/**
 * Open one person's payment advice for the month.
 *
 * It opens as a page of its own rather than a panel under the table, because
 * it is a document being worked on and not a row being edited.
 */
/**
 * The payment advice's form, built from the invoice it pays.
 *
 * Everything on it that matters is the invoice's: the vendor, the number,
 * the amount, the month. What this adds is the dates, the two names, and
 * the PA's own signature — none of which the invoice knows and none of
 * which anybody should have to type. A saved advice keeps whatever was
 * typed into it; an unsaved one is this and nothing else, which is why it
 * can be downloaded without ever having been opened.
 */
async function adviceStateFor (invoiceSub, adviceSub) {
  const from = adviceSub || invoiceSub;
  const full = await Sync.submission(from.id);
  if (!full || !full.data) throw new Error('That document could not be read.');
  const state = mergeDefaults(full.data);

  /* The one number on this form that must never be blank. It is the
     invoice's own, and the row knows it even if the stored form does not. */
  if (!state.invoice.no) state.invoice.no = from.invoice_no || invoiceSub.invoice_no || '';

  const today = new Date().toISOString().slice(0, 10);
  state.advice = Object.assign({
    receivedDate: today,
    preparedDate: today,
    preparedName: (Auth.personFor('pa') || ''),
    approvedName: (Auth.personFor('boss') || '')
  }, state.advice || {});

  /* Hers, from the Signature step. The form carries it rather than asking
     for it again, which is the whole reason it is put there first. */
  state.sig = state.sig || {};
  if (myLastSignature()) state.sig.pa = myLastSignature();
  return state;
}

async function openAdviceEditor (sub, trigger) {
  const box = document.getElementById('adviceEditor');
  const host = document.getElementById('adviceEditorForm');
  if (!box || !host) return;

  adviceTrigger = trigger || document.activeElement;
  adviceOpen = null;
  host.innerHTML = '';
  const who = document.getElementById('adviceEditorWho');
  if (who) who.textContent = `${sub.consultant || ''} · ${periodOf(sub)}`;

  const loading = document.createElement('p');
  loading.className = 'signhint';
  loading.textContent = 'Reading the invoice…';
  host.appendChild(loading);
  showAdviceEditor(box);

  /* Whatever was saved for this month, or the invoice it would be built
     from. Either way the form opens filled in. */
  const saved = adviceFor(sub);
  let state;
  try {
    state = await adviceStateFor(sub, saved);
  } catch (err) {
    loading.textContent = err.message || 'That invoice could not be read.';
    return;
  }
  adviceOpen = { sub: sub, advice: saved, state: state };

  host.innerHTML = '';
  const warn = adviceSignatureWarning();
  if (warn) host.appendChild(warn);
  host.appendChild(adviceFormDoc(state, () => {}));
}

/** put the dialog up, and put the page behind it out of reach */
function showAdviceEditor (box) {
  box.hidden = false;
  adviceScroll = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  adviceBackground = Array.from(document.body.children)
    .filter(el => el !== box && el.tagName !== 'SCRIPT' && el.id !== 'toast')
    .map(el => { const was = el.inert; el.inert = true; return [el, was]; });
  const close = document.getElementById('adviceEditorClose');
  if (close) close.focus();
}

/** and take it down again */
function closeAdviceEditor (restoreFocus) {
  const box = document.getElementById('adviceEditor');
  if (!box || box.hidden) return;
  box.hidden = true;
  adviceOpen = null;
  adviceBackground.forEach(pair => { pair[0].inert = pair[1]; });
  adviceBackground = [];
  document.body.style.overflow = adviceScroll;
  if (restoreFocus !== false && adviceTrigger && adviceTrigger.isConnected) adviceTrigger.focus();
  adviceTrigger = null;
}

/** the advice for one month, drawn from whatever it is built from, in a tab */
async function previewAdviceFor (sub, advice, control) {
  if (signingBusy) return;
  const tab = window.open('', '_blank');
  signingBusy = true;
  if (control) { control.disabled = true; control.setAttribute('aria-busy', 'true'); }
  try {
    const state = await adviceStateFor(sub, advice);
    const doc = await buildAdvicePDF(state);
    const blob = doc.output('blob');
    if (tab && !tab.closed) {
      const url = URL.createObjectURL(blob);
      tab.location = url;
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } else {
      openFilePreview('Payment Advice \u00b7 ' + (sub.consultant || ''),
                      adviceFileBase(state) + '.pdf', blob, control);
      toast('Your browser blocked the new tab, so it opened here instead.');
    }
  } catch (err) {
    if (tab && !tab.closed) tab.close();
    toast(err.message || 'Could not draw it.', true);
  } finally {
    signingBusy = false;
    if (control) { control.disabled = false; control.removeAttribute('aria-busy'); }
  }
}

/**
 * The form as it stands, in a tab of its own.
 *
 * A tab rather than the in-app viewer, because this one is read beside the
 * boxes that fill it: somebody checking a payment advice wants the sheet on
 * one screen and the form on the other, and a dialog over the form they are
 * checking against is the one place it cannot be.
 *
 * The tab is opened on the click and pointed at the document afterwards. A
 * browser only allows a new tab while it can still see the click that asked
 * for one, and drawing the PDF takes long enough to lose it. If the tab was
 * blocked anyway, the viewer is still there to fall back on.
 */
async function previewAdvice (control) {
  if (signingBusy || !adviceOpen) return;
  const tab = window.open('', '_blank');
  signingBusy = true;
  if (control) { control.disabled = true; control.setAttribute('aria-busy', 'true'); }
  try {
    const doc = await buildAdvicePDF(adviceOpen.state);
    const name = adviceFileBase(adviceOpen.state) + '.pdf';
    const blob = doc.output('blob');
    if (tab && !tab.closed) {
      /* Revoked on a timer rather than at once: the tab has to have loaded
         it first, and there is no event here that says it has. */
      const url = URL.createObjectURL(blob);
      tab.location = url;
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } else {
      openFilePreview('Payment Advice · ' + (adviceOpen.sub.consultant || ''),
                      name, blob, control);
      toast('Your browser blocked the new tab, so it opened here instead.');
    }
  } catch (err) {
    if (tab && !tab.closed) tab.close();
    toast(err.message || 'Could not draw it.', true);
  } finally {
    signingBusy = false;
    if (control) { control.disabled = false; control.removeAttribute('aria-busy'); }
  }
}

/**
 * Keep what was typed.
 *
 * There is nothing to send: the approval this form needed was the
 * invoice's, and the HOD signs the printed copy rather than anything here.
 * So saving is saving — the first time it puts the advice on the record at
 * the stage that waits for the signed copy, and after that it replaces the
 * form on the one already there rather than making a second.
 *
 * Nothing has to be saved at all. An advice nobody opened is downloaded
 * from the invoice just the same; this is for when something on it needs
 * to be different.
 */
async function prepareAdvice (go) {
  if (signingBusy || !adviceOpen) return;
  const sub = adviceOpen.sub;
  const state = adviceOpen.state;

  signingBusy = true;
  const was = go.textContent;
  go.disabled = true;
  go.textContent = 'Saving\u2026';
  try {
    if (adviceOpen.advice) {
      await Sync.updateData(adviceOpen.advice.id, state);
    } else {
      await Sync.submit(state, 'Payment advice for ' + periodOf(sub), 'advice');
    }
    closeAdviceEditor();
    toast('Payment advice saved. It is ready on the Download step.');
    await renderAdvice();
  } catch (err) {
    toast(err.message || 'Could not save it.', true);
    go.disabled = false;
    go.textContent = was;
  } finally {
    signingBusy = false;
  }
}

/* -------------------------------------------------------------------
   A month, as one file

   A finished month is three documents: the time sheet that was signed on
   paper and scanned back, the invoice it justifies, and the payment advice
   that pays it. They were produced at different times by different people,
   and anybody asked for "September" wants all three.

   So they are gathered into one archive rather than merged into one
   document. A zip keeps each of them the file it already is — the scan
   stays the scan, and the two forms stay text somebody can search — which
   merging them into a single PDF would cost.
   ------------------------------------------------------------------- */

/** the submission of one kind for the person and month a filed copy is for */
function monthSubmission (rec, kind) {
  const who = String(rec.consultant || '').trim();
  return signingSubs.filter(s =>
    kindOf(s) === kind &&
    String(s.consultant || '').trim() === who &&
    Number(s.period_year) === Number(rec.period_year) &&
    Number(s.period_month) === Number(rec.period_month))[0] || null;
}

/**
 * One submission's form, drawn as the document it is — or as `as` says,
 * since an invoice stands in for an advice nobody edited.
 */
async function monthDocument (sub, as) {
  const kind = as || kindOf(sub);
  const state = kind === 'advice'
    ? await adviceStateFor(sub, kindOf(sub) === 'advice' ? sub : null)
    : mergeDefaults(((await Sync.submission(sub.id)) || {}).data || null);
  if (!state) throw new Error('That document could not be read.');
  const doc = kind === 'invoice' ? await buildInvoicePDF(state)
    : kind === 'advice' ? await buildAdvicePDF(state)
    : await buildClaimPDF(state);
  const base = kind === 'invoice' ? invoiceFileBase(state)
    : kind === 'advice' ? adviceFileBase(state)
    : claimFileBase(state);
  return { name: base + '.pdf', bytes: new Uint8Array(doc.output('arraybuffer')) };
}

/** the signed copy on the record for one document of a month, if there is one */
async function filedCopy (rec, kind) {
  const found = typeof archiveFor === 'function'
    ? archiveFor(rec.consultant, rec.period_year, Number(rec.period_month) - 1, kind) : null;
  if (!found) return null;
  const stored = await Sync.storedOne(found.id);
  const f = stored && (stored.files || [])[0];
  if (!f || !f.content) return null;
  const type = f.type || 'application/pdf';
  return { name: archiveFileName(found, f),
           bytes: dataUrlToBytes('data:' + type + ';base64,' + f.content) };
}

/**
 * Everything for one person and one month: the three documents, gathered.
 *
 * For each one the signed copy on the record is taken if there is one,
 * because a signed scan is the document and the generated form is only a
 * rendering of it; where nothing was scanned back, the form is drawn from
 * what was approved so the month is still whole.
 *
 * @returns {{ files: {name, bytes}[], missing: string[] }}
 */
async function gatherMonth (rec) {
  /* The administrator compiles from History, a page that never loads the
     submission list the PA's pages keep. Without it nothing could be drawn
     and a month came out as its scans alone. */
  if (!signingSubs.length) {
    try { signingSubs = await Sync.submissions(''); } catch (err) { /* then only what is filed */ }
  }
  const files = [];
  const missing = [];
  const wanted = [['claim', 'the time sheet'], ['invoice', 'the invoice'], ['advice', 'the payment advice']];
  for (const pair of wanted) {
    const kind = pair[0];
    try {
      const filed = await filedCopy(rec, kind);
      if (filed) { files.push(filed); continue; }
    } catch (err) { /* fall through to drawing it */ }
    /* An advice nobody edited is drawn from the invoice it pays, the way
       the Download step draws it, so a month is whole either way. */
    let sub = monthSubmission(rec, kind);
    if (!sub && kind === 'advice') {
      const paid = monthSubmission(rec, 'invoice');
      if (adviceUnlocked(paid)) sub = paid;
    }
    if (!sub) { missing.push(pair[1]); continue; }
    try {
      files.push(await monthDocument(sub, kind));
    } catch (err) {
      missing.push(pair[1]);
    }
  }
  return { files: files, missing: missing };
}

/** the month as a folder is named: September 2026 */
function monthFolder (rec) {
  const m = Number(rec.period_month) || 0;
  return `${MONTHS[Math.max(0, m - 1)]} ${rec.period_year || ''}`.trim();
}

/** hold a control while something long runs under it */
function whileBusy (control, work) {
  if (signingBusy) return Promise.resolve();
  signingBusy = true;
  if (control) { control.disabled = true; control.setAttribute('aria-busy', 'true'); }
  return work().finally(() => {
    signingBusy = false;
    if (control) { control.disabled = false; control.removeAttribute('aria-busy'); }
  });
}

/**
 * One person's month, as one zip.
 *
 * What is missing is said rather than quietly left out. A folder that is
 * quietly short a document is how somebody finds out a year later.
 */
function downloadMonthZip (rec, control) {
  return whileBusy(control, async () => {
    const got = await gatherMonth(rec);
    if (!got.files.length) { toast('Nothing could be gathered for that month.', true); return; }
    saveAs(zipFiles(got.files), safeFile(`${monthFolder(rec)} - ${rec.consultant || 'Consultant'}`) + '.zip');
    toast(got.missing.length
      ? `${got.files.length} of 3 saved. Not in it: ${got.missing.join(', ')}.`
      : 'All three documents saved as one zip.', !!got.missing.length);
  });
}

/**
 * Everybody's month, as one zip: a folder per person, three documents in
 * each. The month is what Finance is sent, and it is one file — not one
 * per person, and not one per document.
 *
 * Somebody with nothing at all in the month is left out rather than given
 * an empty folder, and named in the toast so the omission is a known one.
 *
 * @param {object}   month  { period_year, period_month }
 * @param {string[]} names  everybody who might have something in it
 */
async function compileMonth (month, names) {
  const files = [];
  const empty = [];
  const short = [];
  for (const name of names) {
    const rec = { consultant: name, period_year: month.period_year, period_month: month.period_month };
    const got = await gatherMonth(rec);
    if (!got.files.length) { empty.push(name); continue; }
    if (got.missing.length) short.push(`${name} (no ${got.missing.join(', no ')})`);
    const folder = safeFile(name) || 'Consultant';
    got.files.forEach(f => files.push({ name: folder + '/' + f.name, bytes: f.bytes }));
  }
  return { files: files, empty: empty, short: short, with: names.filter(n => empty.indexOf(n) < 0) };
}

function downloadEveryoneZip (month, names, control) {
  return whileBusy(control, async () => {
    const got = await compileMonth(month, names);
    if (!got.files.length) { toast('Nothing has been filed for that month by anybody yet.', true); return; }
    saveAs(zipFiles(got.files), safeFile(monthFolder(month)) + '.zip');
    const notes = [];
    if (got.short.length) notes.push('Short a document: ' + got.short.join('; ') + '.');
    if (got.empty.length) notes.push('Nothing yet for: ' + got.empty.join(', ') + '.');
    toast(`${got.with.length} ${got.with.length === 1 ? 'person' : 'people'} in the zip. ` + notes.join(' '),
          !!notes.length);
    return got;
  });
}

/* -------------------------------------------------------------------
   To Finance

   A finished month goes to Accounts Payable by e-mail, with the zip
   attached. This app has no mail server and should not have one — it
   would need somebody's mailbox credentials — so it does the two things
   a browser can do: put the zip in the downloads folder, and open the
   mail client on a message already addressed and written. Attaching the
   zip is the one step left to the person, and the toast says so.

   The addresses and the wording are the office's own, copied from the
   message Finance already receives, so nothing about it has to be
   remembered month to month.
   ------------------------------------------------------------------- */

const FINANCE_MAIL = {
  to: ['adib.azman@uzmagroup.com'],                         // Muhammad Adib Zharif Mohd Azman
  cc: ['afizah.ariffin@uzmagroup.com',                      // Afizah Ariffin
       'fadhli.jamaluddin@uzmagroup.com',                   // Mohammad Fadhli Jamaluddin
       'aisya.abas@uzmagroup.com'],                         // Aisya Azizah Abas
  dear: 'Adib',
  project: 'PSPJN'
};

/** the month as the message writes it: August 2026 */
function financeMonth (rec) {
  const m = Number(rec.period_month) || 0;
  return `${MONTHS[Math.max(0, m - 1)]} ${rec.period_year || ''}`.trim();
}

/** the people a message goes to, as a mail header writes them */
const FINANCE_NAMES = {
  'adib.azman@uzmagroup.com': 'Muhammad Adib Zharif Mohd Azman',
  'afizah.ariffin@uzmagroup.com': 'Afizah Ariffin',
  'fadhli.jamaluddin@uzmagroup.com': 'Mohammad Fadhli Jamaluddin',
  'aisya.abas@uzmagroup.com': 'Aisya Azizah Abas'
};
const mailAddress = addr => (FINANCE_NAMES[addr] ? `${FINANCE_NAMES[addr]} <${addr}>` : addr);

/**
 * The subject and the body, in the office's own words.
 *
 * The body ends at "Thank you." because the mail client adds the sender's
 * own signature block after it, and writing one here would put two on the
 * message. `rec.consultants` names everybody in the month; one name reads
 * as "our Consultant (Kamaliah)", the way Finance already receives it.
 */
function financeMessage (rec, project) {
  const names = Array.isArray(rec.consultants) ? rec.consultants : [rec.consultant];
  const firsts = names.map(n => String(n || '').trim().split(/\s+/)[0]).filter(Boolean);
  const who = firsts.join(', ') || 'the consultant';
  const plural = firsts.length > 1;
  const proj = project || FINANCE_MAIL.project;
  return {
    subject: `Payment Advice - ${proj} Consultant${plural ? 's' : ''}`,
    body: [
      `Dear ${FINANCE_MAIL.dear},`,
      '',
      `Please find the Payment Advice and related documents for ${financeMonth(rec)} payment ` +
        `to our Consultant${plural ? 's' : ''} (${who}) for ${proj} project. ` +
        'Kindly refer to the attachment for details.',
      '',
      'Appreciate your assistance on this.',
      '',
      'Thank you.'
    ]
  };
}

/** bytes as base64, folded at 76 columns the way a mail body wants it */
function base64Lines (bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/.{76}/g, '$&' + '\r\n');
}

/**
 * The message as a file the mail client opens as a draft.
 *
 * A browser cannot attach a file to a message it did not send, and a
 * mailto: link carries no attachment. An .eml can: it is the message
 * itself, headers, body and the zip inside it, and with X-Unsent set
 * Outlook opens it in a compose window rather than as something received
 * — every field filled, the attachment on it, one click from Send.
 */
function financeEml (rec, project, zipName, zipBytes) {
  const msg = financeMessage(rec, project);
  const boundary = '----=_ccs_' + Date.now().toString(36);
  const nl = '\r\n';
  const head = [
    'X-Unsent: 1',
    'To: ' + FINANCE_MAIL.to.map(mailAddress).join(', '),
    'Cc: ' + FINANCE_MAIL.cc.map(mailAddress).join(', '),
    'Subject: ' + msg.subject,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ''
  ];
  const text = [
    '--' + boundary,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    ''
  ].concat(msg.body, ['']);
  const file = [
    '--' + boundary,
    `Content-Type: application/zip; name="${zipName}"`,
    `Content-Disposition: attachment; filename="${zipName}"`,
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(zipBytes),
    '--' + boundary + '--',
    ''
  ];
  return head.concat(text, file).join(nl);
}

/** the project the month was for, off the claim itself; the usual one if it does not say */
async function financeProject (rec) {
  try {
    const sub = monthSubmission(rec, 'claim') || monthSubmission(rec, 'invoice');
    if (!sub) return '';
    const full = await Sync.submission(sub.id);
    const name = full && full.data && full.data.project && full.data.project.name;
    return String(name || '').trim();
  } catch (err) { return ''; }
}

/**
 * Compile everybody's month, put it in the message, and hand the message
 * over as a draft. Nothing is sent from here: the person opens the file,
 * reads what is about to go, and presses Send in their own mail client.
 */
function sendMonthToFinance (month, names, control) {
  return whileBusy(control, async () => {
    const got = await compileMonth(month, names);
    if (!got.files.length) { toast('Nothing has been filed for that month by anybody yet.', true); return; }
    const zipName = safeFile(monthFolder(month)) + '.zip';
    const zipBytes = new Uint8Array(await zipFiles(got.files).arrayBuffer());
    const first = { consultant: got.with[0], period_year: month.period_year, period_month: month.period_month };
    const project = await financeProject(first);
    const rec = { consultants: got.with, period_year: month.period_year, period_month: month.period_month };
    const eml = financeEml(rec, project, zipName, zipBytes);
    saveAs(new Blob([eml], { type: 'message/rfc822' }),
           safeFile(`${monthFolder(month)} - Payment Advice to Finance`) + '.eml');
    const notes = [];
    if (got.short.length) notes.push('Short a document: ' + got.short.join('; ') + '.');
    if (got.empty.length) notes.push('Nothing yet for: ' + got.empty.join(', ') + '.');
    toast('Open the .eml that just downloaded: it opens in Outlook as a draft to Finance with the ' +
          `zip attached (${got.with.length} ${got.with.length === 1 ? 'person' : 'people'}). ` +
          notes.join(' '), !!notes.length);
  });
}

/* -------------------------------------------------------------------
   One person, twice

   A name typed twice with one letter different is two profiles, and every
   table here then lists the same person twice. Nothing can merge them —
   the documents carry the name they were filed under, and rewriting that
   on a filed claim is not something this app should do — but when one of
   the two has nothing under it at all, it is not a second person: it is a
   slip, and the fix is to take the empty one off.

   So a row for a profile with nothing filed under it, whose name is a
   letter or two from another, says so to the administrator and offers
   that one thing. It never guesses about a profile that has documents.
   ------------------------------------------------------------------- */

/** how many single-letter edits turn one name into the other */
function nameDistance (a, b) {
  a = String(a || '').toLowerCase(); b = String(b || '').toLowerCase();
  if (a === b) return 0;
  let prev = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** true when nothing at all has been filed under this exact name */
function nothingFiledUnder (name) {
  return filedUnder(name).total === 0 && filedUnder(name).known;
}

/**
 * What is on the record under one exact spelling: submissions and filed
 * copies, counted off whichever lists this page has loaded. `known` is
 * false when no list has been loaded at all, because then the answer is
 * "not known" rather than "nothing" — nothing here may rest on an empty
 * cache.
 */
function filedUnder (name) {
  const who = String(name || '').trim();
  const mine = signingSubs || [];
  const theirs = (typeof subs !== 'undefined' && Array.isArray(subs)) ? subs : [];
  const known = !!(mine.length || theirs.length);
  const under = s => String(s.consultant || '').trim() === who;
  const seen = new Set();
  mine.concat(theirs).forEach(s => { if (under(s)) seen.add(s.id); });
  const filed = (typeof archive !== 'undefined' ? archive : []).filter(under).length;
  return { known: known, submissions: seen.size, filed: filed, total: seen.size + filed };
}

/** is there a profile on the shared list under this exact spelling? */
function profileUnder (name) {
  try { return Object.prototype.hasOwnProperty.call(Store.profiles(), String(name || '').trim()); }
  catch (err) { return false; }
}

/** the other name this one looks like a slip of, if there is one */
function likelyDuplicateOf (name, roster) {
  const who = String(name || '').trim();
  return (roster || signingRoster()).filter(n => n !== who && nameDistance(n, who) <= 2)[0] || '';
}

/**
 * One person, twice, and which of the two is the slip.
 *
 * The profile is the person: a spelling with a profile on the shared list
 * is somebody, and a spelling without one is a name that got onto the
 * record some other way. So there are two cases, and they point in
 * opposite directions:
 *
 *   an empty profile, a letter or two from a name that has documents
 *     — the profile is the slip; take the profile off;
 *   documents under a spelling with no profile, a letter or two from a
 *     name that has one — the documents are the slip; take them off.
 *
 * Anything else is left alone: two empty near-names, or two with
 * documents each, are two questions this cannot answer.
 *
 * @returns {{ kind: 'profile'|'documents', other: string, filed: object } | null}
 */
function duplicateCase (name) {
  const here = filedUnder(name);
  if (!here.known) return null;
  const other = likelyDuplicateOf(name);
  if (!other) return null;
  /* Both profiled, this one empty and the other documented: this one is
     the slip. If the other has no profile it is not the person — it is
     the slip, and the second case below says so on its own row. */
  if (profileUnder(name) && here.total === 0 && profileUnder(other) && filedUnder(other).total > 0) {
    return { kind: 'profile', other: other, filed: here };
  }
  if (!profileUnder(name) && here.total > 0 && profileUnder(other)) {
    return { kind: 'documents', other: other, filed: here };
  }
  return null;
}

/**
 * The note on a duplicate's row, and the one button.
 *
 * The note is for everybody: whoever is looking at two rows for one person
 * should be told why there are two. The button is for the two people who
 * keep the record — the administrator, and the PA, who is the one looking
 * at these tables — and does the one thing the case calls for. The server
 * checks the case again before anything goes.
 */
function duplicateProfileNote (name, after) {
  const found = duplicateCase(name);
  if (!found) return null;
  const may = typeof Auth !== 'undefined' && (Auth.isAdmin() || Auth.places());
  const n = found.filed;
  const count = `${n.submissions} submission${n.submissions === 1 ? '' : 's'} and ` +
    `${n.filed} filed cop${n.filed === 1 ? 'y' : 'ies'}`;

  const note = document.createElement('div');
  note.className = 'dupnote';
  const said = document.createElement('span');
  said.textContent = found.kind === 'profile'
    ? `Looks like a slip of \u201c${found.other}\u201d \u2014 this profile has nothing filed under it.`
    : `Looks like a slip of \u201c${found.other}\u201d \u2014 there is no profile under this spelling, ` +
      `only ${count} filed under it.`;
  if (!may) said.textContent += ' The administrator or the PA can take it off.';
  note.appendChild(said);
  if (!may) return note;

  const label = found.kind === 'profile' ? 'Remove this profile' : 'Remove those documents';
  note.appendChild(button(label, 'ghost small danger', async () => {
    const what = found.kind === 'profile'
      ? `Remove the empty profile \u201c${name}\u201d?`
      : `Remove ${count} filed under \u201c${name}\u201d?`;
    if (!confirm(`${what}` + '\n\n' +
                 `\u201c${found.other}\u201d stays as it is. This cannot be undone.`)) return;
    try {
      if (found.kind === 'profile') {
        Store.deleteProfile(name);
        await Sync.deleteProfile(name);
      } else {
        const gone = await Sync.removeStrayName(name);
        archiveLoaded = false;
        toast(`Removed ${gone.submissions} submission${gone.submissions === 1 ? '' : 's'} and ` +
              `${gone.filed} filed cop${gone.filed === 1 ? 'y' : 'ies'} under \u201c${name}\u201d.`);
      }
      if (after) after();
    } catch (err) {
      toast(err.message || 'Could not remove that.', true);
    }
  }));
  return note;
}

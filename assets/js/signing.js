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
 * @param {string[]} columns  the document columns after Consultant
 * @param {function} cells    sub -> one element per column
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
        const row = document.createElement('tr');
        if (!sub) row.className = 'signrow-quiet';
        const person = document.createElement('th');
        person.scope = 'row';
        person.textContent = name;
        row.appendChild(person);
        const content = sub ? cells(sub) : (opts.missing ? opts.missing(name, entry) : []);
        content.forEach((c, i) => {
          const td = document.createElement('td');
          td.setAttribute('data-label', columns[i]);
          td.appendChild(c);
          row.appendChild(td);
        });
        body.appendChild(row);
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
    empty.textContent = 'Nothing is waiting for the HOD\u2019s signature. Everybody is listed below ' +
      'with where their time sheet has got.';
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

  signingMonthTables(host, rows, ['Status', 'Time sheet'], sub => {
    const who = `${sub.consultant || 'consultant'}, ${periodOf(sub)}`;
    return [statusBadge('Waiting for signature'), signingDocument('Time sheet', sub.invoice_no || '', [
      labelledIcon('view', 'View', 'View the time sheet for ' + who, () => reviewSubmission(sub.id)),
      labelledIcon('download', 'Download', 'Download the time sheet for ' + who,
                   control => downloadForSigning(sub, control))
    ])];
  }, {
    roster: signingRoster(),
    fallbackMonth: currentSigningMonth(),
    missing: (name, month) => [statusBadge(sheetStatusWords(name, month.y, month.m)), emptyCell()]
  });
}

/** the time sheet as it was approved, as a PDF for the printer */
async function signingPdf (sub) {
  const full = await Sync.submission(sub.id);
  if (!full || !full.data) throw new Error('That document could not be read.');
  const state = mergeDefaults(full.data);
  return { blob: (await buildClaimPDF(state)).output('blob'), name: claimFileBase(state) + '.pdf' };
}

async function downloadForSigning (sub, btn) {
  if (signingBusy) return;
  signingBusy = true;
  // an icon with its word would lose the icon if its text were swapped out
  const drawn = btn.classList && btn.classList.contains('iconbtn');
  const was = btn.textContent;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  if (!drawn) btn.textContent = 'Preparing…';
  try {
    const pdf = await signingPdf(sub);
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
  const waiting = waitingSignature();

  /* A scan is held in this browser until Submit sends it, so one put on a
     card that is no longer in the list has nowhere to go. */
  const live = new Set(waiting.map(s => s.id));
  [...attached.keys()].forEach(id => { if (!live.has(id)) attached.delete(id); });

  const h1 = document.createElement('h3');
  h1.textContent = `Waiting for signed copies (${waiting.length})`;
  host.appendChild(h1);

  if (!waiting.length) {
    const empty = document.createElement('p');
    empty.className = 'emptynote';
    empty.textContent = 'Nothing is waiting. Every time sheet the HOD approved has been ' +
      'signed and sent on.';
    host.appendChild(empty);
  }
  signingMonthTables(host, waiting, ['Status', 'Time sheet', 'Signed copy'],
    sub => [statusBadge('Waiting for signature')].concat(uploadCells(sub)), {
      roster: signingRoster(),
      fallbackMonth: currentSigningMonth(),
      missing: (name, month) =>
        [statusBadge(sheetStatusWords(name, month.y, month.m)), emptyCell(), emptyCell()]
    });


  host.appendChild(submitBar());
}

/**
 * One time sheet waiting for its signed copy, as two cells of its row: the
 * sheet that was approved, and the signed copy put against it.
 */
function uploadCells (sub) {
  const who = `${sub.consultant || 'consultant'}, ${periodOf(sub)}`;
  const sheet = signingDocument('Time sheet', sub.invoice_no || '', [
    labelledIcon('view', 'View', 'View the time sheet for ' + who, () => reviewSubmission(sub.id))
  ]);

  const cell = document.createElement('div');
  cell.className = 'signcell';

  /* What is already on file, if anything. Whoever is about to replace a copy
     should be able to look at the copy they are replacing. */
  const filed = typeof archiveFor === 'function'
    ? archiveFor(sub.consultant, sub.period_year, Number(sub.period_month) - 1, 'claim') : null;
  const file = attached.get(sub.id);

  if (file) {
    /* Put on, not sent. The cell names the file it is holding, offers it to
       be looked at, and offers to let it go again — all three, because the
       only thing worse than the wrong scan is the wrong scan nobody read. */
    const ready = signingDocument(file.name,
      `${Math.max(1, Math.round(file.size / 1024))} KB \u00b7 Ready to submit`, [
        labelledIcon('view', 'View', 'View the signed copy chosen for ' + who,
                     () => openFilePreview(`${sub.consultant || ''} \u2014 ${periodOf(sub)}`, file.name, file)),
        button('Remove', 'ghost small', () => { attached.delete(sub.id); renderSignUpload(); })
      ]);
    ready.classList.add('signready-doc');
    cell.appendChild(ready);
  } else {
    const pick = document.createElement('div');
    pick.className = 'signpick';
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.setAttribute('aria-label', `Signed time sheet for ${who}`);
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
      attached.set(sub.id, picked);
      renderSignUpload();
    });
    pick.appendChild(inp);
    const hint = document.createElement('small');
    hint.className = 'signhint';
    hint.textContent = (filed ? 'Choose the replacement. ' : 'Choose the signed time sheet. ') +
      'PDF or image, up to 12 MB.';
    pick.appendChild(hint);
    cell.appendChild(pick);
  }

  if (filed) {
    const onFile = signingDocument('Copy on file',
      'uploaded by ' + (filed.created_by || 'somebody') +
      (filed.created_at ? ' on ' + new Date(filed.created_at).toLocaleDateString() : '') +
      ' \u00b7 replaced when you submit', [
        labelledIcon('view', 'View', 'View the copy on file for ' + who, () => viewFiled(filed, sub))
      ]);
    onFile.classList.add('signonfile');
    cell.appendChild(onFile);
  }
  return [sheet, cell];
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
 * The copies already on file for this time sheet's person and month.
 *
 * Only the time sheet's own finished copies. A record old enough not to say
 * which document it is covers the invoice as well, and taking it off the
 * record would take the invoice with it.
 */
function copiesOnFile (sub) {
  const who = String(sub.consultant || '').trim();
  return archive.filter(r =>
    String(r.consultant || '').trim() === who &&
    Number(r.period_year) === Number(sub.period_year) &&
    Number(r.period_month) === Number(sub.period_month) &&
    r.kind === 'claim' && stageOf(r) === ARCHIVE_FINAL);
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
    ? ready + ' signed cop' + (ready === 1 ? 'y is' : 'ies are') + ' ready. Submitting files ' +
      (ready === 1 ? 'it' : 'them') + ' and closes the month — the last step, after which it ' +
      'lives in History. Submit before leaving or reloading this page.'
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
        const payload = await Sync.readFile(jobs[i].file);
        payload.name = kindLabel('claim') + ' (signed) — ' + payload.name;
        // noted before the new copy goes up, since it is about to replace them
        const before = copiesOnFile(sub);
        const kept = await Sync.store(state, [payload],
          kindLabel('claim') + ' signed by ' + by +
          (before.length ? ' · replaces the earlier copy' : ''), 'claim', SIGNING_STATUS);
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
    host.innerHTML = '<p class="emptynote">Nothing has gone through here yet. ' +
      'A signed time sheet appears in this list once it is submitted on the Upload page.</p>';
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

/** the invoices the HOD has approved, newest month first */
function invoicesApproved () {
  return signingSubs
    .filter(s => s.status === 'complete' && kindOf(s) === 'invoice')
    .slice()
    .sort(byMonthThenName);
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
  if (!advice) return 'Not prepared';
  if (advice.status === 'complete') return 'Signed and closed';
  if (advice.status === SIGNING_STATUS) return 'Waiting for your signature';
  if (advice.status === 'returned') return 'Sent back';
  return (typeof STATUS_TEXT === 'object' && STATUS_TEXT[advice.status]) || advice.status;
}

async function renderAdvice () {
  const host = document.getElementById('adviceList');
  if (!host) return;
  if (!(await loadSigning(host, renderAdvice))) return;
  await learnSigningKinds();

  host.innerHTML = '';
  const rows = invoicesApproved();

  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'emptynote';
    empty.textContent = 'No approved invoices yet. A payment advice is prepared once the HOD has ' +
      'approved the invoice it pays, and one appears here for each month that reaches that point.';
    host.appendChild(empty);
    return;
  }

  const count = document.createElement('p');
  count.className = 'historycount';
  count.setAttribute('role', 'status');
  const waiting = rows.filter(sub => {
    const a = adviceFor(sub);
    return !a || a.status === SIGNING_STATUS;
  }).length;
  count.textContent = waiting
    ? `${waiting} payment advice${waiting === 1 ? '' : 's'} need${waiting === 1 ? 's' : ''} you.`
    : 'Nothing needs you here.';
  host.appendChild(count);

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
      advice ? 'Payment Advice' : 'Not prepared yet',
      advice ? (advice.invoice_no || sub.invoice_no || '') : 'Prepared from invoice ' + (sub.invoice_no || ''),
      actions));

    const bar = document.createElement('div');
    bar.className = 'btnrow';
    if (!advice) {
      const go = button('Prepare and send for approval', 'primary small',
                        () => prepareAdvice(sub, go));
      bar.appendChild(go);
    } else if (advice.status === SIGNING_STATUS) {
      const go = button('Sign and close', 'primary small', () => openAdviceSigning(advice, sub));
      bar.appendChild(go);
    }
    if (bar.children.length) cell.appendChild(bar);

    return [statusBadge(adviceWords(advice)), cell];
  }, {
    roster: [],
    fallbackMonth: currentSigningMonth(),
    missing: () => [statusBadge('Not prepared'), emptyCell()]
  });
}

/**
 * Prepare one, and send it round.
 *
 * Everything it says comes from the invoice it pays, so the form is built
 * from that claim's own stored state rather than from anything typed here.
 * The dates are the only thing this adds, and they are today's, because
 * today is when it was prepared.
 */
async function prepareAdvice (sub, go) {
  if (signingBusy) return;
  const who = `${sub.consultant || 'somebody'} \u00b7 ${periodOf(sub)}`;
  if (!confirm(`Prepare the payment advice for ${who}?\n\n` +
               'It is built from the approved invoice and goes to the project manager, then the ' +
               'HOD, then back here to be signed.')) return;

  signingBusy = true;
  const was = go.textContent;
  go.disabled = true;
  go.textContent = 'Preparing…';
  try {
    const full = await Sync.submission(sub.id);
    if (!full || !full.data) throw new Error('That invoice could not be read.');
    const state = mergeDefaults(full.data);
    const today = new Date().toISOString().slice(0, 10);
    state.advice = Object.assign({}, state.advice, {
      receivedDate: today,
      preparedDate: today,
      preparedName: (Auth.personFor('pa') || ''),
      approvedName: (Auth.personFor('boss') || '')
    });
    await Sync.submit(state, 'Payment advice for ' + periodOf(sub), 'advice');
    toast('Payment advice sent to the project manager.');
    await renderAdvice();
  } catch (err) {
    toast(err.message || 'Could not prepare it.', true);
    go.disabled = false;
    go.textContent = was;
  } finally {
    signingBusy = false;
  }
}

/**
 * The last step: two signatures on one form.
 *
 * The HOD approved this advice, and his signature is placed here the way it
 * is placed on a time sheet — by the PA, who holds it. Hers goes in the box
 * the form calls Prepared by, because she is the one who prepared it.
 */
function openAdviceSigning (advice, invoice) {
  const host = document.getElementById('adviceList');
  if (!host || document.getElementById('adviceSign')) return;

  const box = document.createElement('div');
  box.id = 'adviceSign';
  box.className = 'decidebox';

  const head = document.createElement('p');
  head.className = 'decidehead';
  head.textContent = 'Sign the payment advice';
  box.appendChild(head);

  const context = document.createElement('p');
  context.className = 'status-context';
  context.textContent = `${advice.consultant || ''} \u00b7 ${periodOf(advice)}`;
  box.appendChild(context);

  const pads = [
    { key: 'hod', title: 'The HOD\u2019s signature, for Approved by', value: myLastSignature() },
    { key: 'pa', title: 'Your own signature, for Prepared by', value: myLastSignature() }
  ];
  pads.forEach(pad => {
    const label = document.createElement('p');
    label.className = 'fieldlabel';
    label.textContent = pad.title;
    box.appendChild(label);
    const padHost = document.createElement('div');
    padHost.className = 'decidepad sigprofile';
    box.appendChild(padHost);
    mountSignaturePicker(padHost, { get: () => pad.value, set: url => { pad.value = url; } });
  });

  const bar = document.createElement('div');
  bar.className = 'btnrow';
  const go = button('Sign and close the advice', 'primary',
                    () => signAdvice(advice, pads, go));
  bar.appendChild(go);
  bar.appendChild(button('Cancel', 'ghost', () => box.remove()));
  box.appendChild(bar);
  host.appendChild(box);
  box.scrollIntoView({ block: 'nearest' });
}

async function signAdvice (advice, pads, go) {
  if (signingBusy) return;
  const missing = pads.filter(p => !p.value);
  if (missing.length) {
    toast('Both signatures are needed: the HOD\u2019s and your own.', true);
    return;
  }

  signingBusy = true;
  const was = go.textContent;
  go.disabled = true;
  go.textContent = 'Signing…';
  try {
    const full = await Sync.submission(advice.id);
    const state = mergeDefaults((full && full.data) || {});
    const today = new Date().toISOString().slice(0, 10);
    state.sig = state.sig || {};
    pads.forEach(p => { state.sig[p.key] = p.value; });
    state.advice = Object.assign({}, state.advice, {
      approvedDate: state.advice && state.advice.approvedDate ? state.advice.approvedDate : today,
      preparedDate: state.advice && state.advice.preparedDate ? state.advice.preparedDate : today
    });
    rememberSignature(pads[0].value);
    await Sync.act(advice.id, 'approve', '', state);
    const box = document.getElementById('adviceSign');
    if (box) box.remove();
    toast('Signed. That month is closed.');
    await renderAdvice();
  } catch (err) {
    toast(err.message || 'Could not sign it.', true);
    go.disabled = false;
    go.textContent = was;
  } finally {
    signingBusy = false;
  }
}

/* =======================================================================
   archive.js — the signed copies on file

   approvals.js holds a claim as software holds it: a form, a status, a
   trail of who moved it. This is the other half. A month is only really
   finished when somebody has the signed invoice and the signed time sheet
   as files — the ones with real signatures on them, scanned back in — and
   until now those lived in whichever person's Downloads folder happened
   to have them.

   So they are filed here instead, against the person and the month, and
   any month can be produced again a year later without asking anybody to
   go looking. The endpoints are in docs/BDOS-CCS-Endpoints.md.
   ======================================================================= */

/* Big enough for a scan of two pages, small enough that a mis-picked video
   is refused rather than uploaded. Base64 adds about a third on the way. */
const ARCHIVE_MAX_BYTES = 12 * 1024 * 1024;

/* The time sheet first, as everywhere else: it is the evidence, and the
   invoice is the bill that follows from it. */
const ARCHIVE_SLOTS = [
  { key: 'claim',   label: 'Signed time sheet' },
  { key: 'invoice', label: 'Signed invoice' }
];

let archive = [];
let archiveLoaded = false;
let archiveBusy = false;

async function renderArchive (force) {
  const host = document.getElementById('archiveList');
  if (!host) return;

  if (!Sync.on) {
    archiveLoaded = false;
    host.innerHTML = Sync.offlineNote(
      'Cannot connect to signed copies. Previously downloaded files remain on your device.');
    return;
  }

  if (force || !archiveLoaded) {
    workflowMessage(host, 'Loading signed copies…');
    host.setAttribute('aria-busy', 'true');
    try {
      archive = await Sync.stored('', '');
      archiveLoaded = true;
    } catch (err) {
      workflowMessage(host, 'Signed copies could not be loaded. ' +
        (err.message || 'Check your connection and try again.'), () => renderArchive(true));
      return;
    } finally {
      host.removeAttribute('aria-busy');
    }
  }

  /* The archive is newer than the rest of the storage and may not be
     deployed yet. "Nothing filed" would be a lie in that case, and the kind
     that has somebody hunting for files that were never uploaded. */
  if (!Sync.archiveOn) {
    workflowMessage(host, 'Signed copy storage is not available yet. Keep your signed files ' +
      'on your device and contact your administrator to enable uploads.');
    return;
  }
  paintArchive();
}

/**
 * Load the archive once, quietly, for anything that only wants to read it —
 * the status table asks whether a signed copy has come back yet, and that
 * question should not depend on somebody having opened this list first.
 */
async function ensureArchive () {
  if (!Sync.on || archiveLoaded) return;
  archive = await Sync.stored('', '');
  archiveLoaded = true;
}

/**
 * Has the signed copy of one person's document for one month come back?
 *
 * A record written before the archive knew about documents carries no kind
 * and is counted for both — it was filed for that month, and saying "not on
 * file" about a file that is on file is the worse mistake.
 */
/* The stage a record with no stage on it is read as. Everything filed before
   the project manager signed anything was the finished document. */
const ARCHIVE_FINAL = 'pending_signature';
const stageOf = r => r.stage || ARCHIVE_FINAL;

/**
 * One filed record for a person, a month and a document.
 * @param {string} [stage] which signing it came from; the finished one when
 *        left out, because that is what "is it on file" nearly always means
 */
function archiveFor (consultant, year, month, kind, stage) {
  const who = String(consultant || '').trim();
  const want = stage || ARCHIVE_FINAL;
  return archive.filter(r =>
    String(r.consultant || '').trim() === who &&
    Number(r.period_year) === Number(year) &&
    Number(r.period_month) === Number(month) + 1 &&
    (!r.kind || r.kind === kind) &&
    stageOf(r) === want).sort(newestFirst)[0] || null;
}

/* A copy uploaded again replaces the one before it — a better scan, or the
   wrong file put right — so wherever one copy stands for a document, it is
   the newest. The older records stay in the database; they just stop being
   the answer. */
const newestFirst = (a, b) =>
  String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
  String(b.id || '').localeCompare(String(a.id || ''));

/** one record per person, month, document and stage: the newest */
function latestCopies (rows) {
  const seen = new Set();
  return rows.slice().sort(newestFirst).filter(r => {
    const key = [String(r.consultant || '').trim(), r.period_year, r.period_month,
                 r.kind || '', stageOf(r)].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const archiveHas = (consultant, year, month, kind, stage) =>
  !!archiveFor(consultant, year, month, kind, stage);

/** who uploaded the signed copy back, and when — '' when nobody has */
function archiveBy (consultant, year, month, kind, stage) {
  const rec = archiveFor(consultant, year, month, kind, stage);
  if (!rec) return '';
  const when = rec.created_at ? new Date(rec.created_at).toLocaleDateString() : '';
  return (rec.created_by || 'somebody') + (when ? ' on ' + when : '');
}

/**
 * May the account that is signed in put documents on file?
 *
 * The signed paper never passes through the consultant's hands: they send
 * the form, the project manager and the HOD sign it, and the PA files what
 * comes back. Offering them the box asked them to do somebody else's job
 * with paper they do not have.
 */
function canFileSigned () {
  return Auth.places();
}

/**
 * The Status step's list: the month the table above is showing, and nothing
 * else. One month is the question that step asks — the whole record is the
 * History step, which is the administrator's.
 */
function paintArchive () {
  const host = document.getElementById('archiveList');
  if (!host) return;

  const when = (typeof statusMonth === 'object' && statusMonth)
    ? statusMonth : { y: S.timesheet.year, m: S.timesheet.month };

  const head = document.getElementById('archiveHead');
  if (head) head.textContent = `Signed copies on file — ${MONTHS[when.m]} ${when.y}`;

  host.innerHTML = '';

  // whoever is holding the signed paper: the consultant who prepared it, and
  // always the PA at the end, because placing the signature is their part
  if (canFileSigned()) host.appendChild(archiveUploadCard());

  const rows = latestCopies(archive)
    .filter(r => Number(r.period_year) === when.y && Number(r.period_month) === when.m + 1)
    // signed copies only: a bank statement is proof of payment, and lives in History
    .filter(r => r.kind !== BANK_KIND)
    // a consultant sees their own filed copies, the way they see their own rows
    .filter(r => Auth.seesEveryone() ||
                 String(r.consultant || '').trim() === String(S.consultant.name || '').trim())
    .slice()
    .sort((a, b) => String(a.consultant || '').localeCompare(String(b.consultant || '')));

  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'emptynote';
    empty.textContent = `No signed copies for ${MONTHS[when.m]} ${when.y} yet. ` +
      (canFileSigned() ? 'Upload them above.' : 'Check again after they are filed.');
    host.appendChild(empty);
    return;
  }

  let seen = null;
  rows.forEach(r => {
    const name = String(r.consultant || '').trim() || '(no name)';
    if (name !== seen) {
      seen = name;
      const h = document.createElement('h4');
      h.className = 'archiveperson';
      h.textContent = name;
      host.appendChild(h);
    }
    host.appendChild(archiveRow(r));
  });
}

/* =======================================================================
   The History step — everything, for the administrator

   Status answers "where is this month". Somebody has to be able to answer
   "where is last March" as well, and that is a different screen: no upload,
   no approvals, just every signed copy that has ever been filed, newest
   first, filtered by person and by year.
   ======================================================================= */

let historyWho = '';
let historyYear = '';
let downloading = false;

async function renderHistory (force) {
  const host = document.getElementById('historyList');
  if (!host) return;

  /* For the administrator this is the back of the filing cabinet. For
     whoever collects the forms it is the whole job, and the only screen they
     have — so it is named for what they came to do. */
  const collecting = Auth.keepsRecords() && !Auth.approves();
  const mine = !Auth.keepsRecords() && !Auth.approves() && !Auth.places();
  const head = document.getElementById('historyHead');
  const lead = document.getElementById('historyLead');
  if (head) head.textContent = collecting ? 'Documents to collect' : 'History';
  if (lead) {
    /* A consultant's history is their own: the database hands them their
       own records and nobody else's, and the page should say so rather
       than let them wonder whose are missing. */
    lead.textContent = collecting
      ? 'Filter signed documents, then view or download them as one ZIP.'
      : mine
        ? 'Your own signed documents, by year. Nobody else can be seen here. ' +
          'Add your bank statement for each paid month — black out your balance and other transactions first.'
        : 'Find signed documents by consultant and year.';
  }

  if (!Sync.on) {
    archiveLoaded = false;
    host.innerHTML = Sync.offlineNote(
      'Cannot connect to document history. Check your connection and try again.');
    return;
  }

  if (force) archiveLoaded = false;
  workflowMessage(host, 'Loading document history…');
  const download = document.getElementById('btnDownloadAll');
  if (download) download.disabled = true;
  host.setAttribute('aria-busy', 'true');
  try {
    await ensureArchive();
  } catch (err) {
    workflowMessage(host, 'Document history could not be loaded. ' +
      (err.message || 'Check your connection and try again.'), () => renderHistory(true));
    return;
  } finally {
    host.removeAttribute('aria-busy');
  }

  if (!Sync.archiveOn) {
    workflowMessage(host, 'History is not enabled yet. Ask your administrator to enable it. ' +
      'Keep your files on this device for now.');
    return;
  }
  paintHistory();
}

function paintHistory () {
  const host = document.getElementById('historyList');
  const who = document.getElementById('historyWho');
  const year = document.getElementById('historyYear');
  if (!host) return;

  if (who) {
    /* Everybody, not only those who have filed something. Narrowing to a
       person who has sent nothing is a fair question — the answer is the
       line of "Not available" that says so. */
    const names = filingNames();
    fillSelect(who, 'All consultants', names, names.map(n => n));
    who.value = names.indexOf(historyWho) >= 0 ? historyWho : '';
    historyWho = who.value;
    who.onchange = () => { historyWho = who.value; paintHistory(); };
  }
  if (year) {
    const years = [...new Set(archive.map(r => Number(r.period_year)).filter(Boolean))]
      .sort((a, b) => b - a);
    fillSelect(year, 'All years', years.map(String), years.map(String));
    year.value = years.map(String).indexOf(historyYear) >= 0 ? historyYear : '';
    historyYear = year.value;
    year.onchange = () => { historyYear = year.value; paintHistory(); };
  }

  const rows = historyRows();
  host.innerHTML = '';
  const count = document.createElement('p');
  count.className = 'historycount';
  count.setAttribute('role', 'status');
  const files = rows.reduce((n, r) => n + ((r.files || []).length), 0);
  count.textContent = rows.length
    ? `${rows.length} record${rows.length === 1 ? '' : 's'} · ${files} file${files === 1 ? '' : 's'} available`
    : '';
  const download = document.getElementById('btnDownloadAll');
  if (download) {
    download.disabled = !files || downloading;
    download.textContent = files ? `Download all (${files})` : 'Download all';
    download.title = 'Download the files matching these filters as one ZIP';
  }
  if (rows.length) host.appendChild(count);

  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'emptynote';
    empty.textContent = (historyWho || historyYear)
      ? 'No matching documents. Try another consultant or year.'
      : 'No signed documents filed yet.';
    host.appendChild(empty);
    if (historyWho || historyYear) host.appendChild(button('Clear filters', 'ghost small', () => {
      historyWho = '';
      historyYear = '';
      paintHistory();
      if (who) who.focus();
    }));
    return;
  }

  const months = new Map();
  rows.forEach(r => {
    const key = `${r.period_year}-${r.period_month}`;
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(r);
  });
  const roster = collectorRoster();
  months.forEach(records => host.appendChild(historyTable(records, roster)));
}

/**
 * Everybody who could have a document in a month, not only those who do.
 *
 * A list of what has arrived answers half the question. Whoever collects the
 * paper is chasing what has not, and a person who has handed in nothing is
 * invisible in a table built only from what was handed in — which is the one
 * person they needed to see.
 *
 * The profiles are shared through BDOS, so this is the same set of people on
 * every machine. Anybody who has filed something is added even if their
 * profile has gone, because the record outlives the profile.
 */
function filingNames () {
  const names = new Set();
  try {
    const all = Store.profiles();
    Object.keys(all).forEach(n => {
      const who = profileFiledName(n, all[n]);
      if (who && Auth.owns(mergeDefaults(all[n]))) names.add(who);
    });
  } catch (err) {
    // no profiles on this machine yet: the list is what has been filed
  }
  archive.forEach(r => {
    const who = String(r.consultant || '').trim();
    if (who) names.add(who);
  });
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** the people the table draws a line for — one of them once it is narrowed */
function collectorRoster () {
  return historyWho ? [historyWho] : filingNames();
}

/**
 * Keep the two document types together for each person in a month.
 * @param {string[]} [roster] everybody to list, whether or not they have
 *        filed anything — the ones who have not are the point of the list
 */
/* What each document is called, in the heading and in the label on its
   buttons. Three kinds now, and spelling them inline meant an expression
   that could only tell two apart. */
const HISTORY_COLUMN = { claim: 'Time sheet', invoice: 'Invoice', advice: 'Payment Advice' };

/* -------------------------------------------------------------------
   Bank statements

   The consultant's own proof that a month was paid, put beside the three
   documents that month went out as. It is not a signed copy and never
   stands for one: it is filed as a kind of its own at a stage of its own,
   so nothing that reads the signed copies — the zips, Finance, Re-Upload —
   ever picks it up.

   A statement carries far more than this needs: a balance, every other
   payment in and out, an account number. So the page asks for those to be
   blacked out before a file can even be chosen, because once it is here
   everybody who keeps the records can open it.
   ------------------------------------------------------------------- */
const BANK_KIND = 'bank';

/** the statement on file for one person and month: the newest, if there are two */
function bankFor (name, year, month) {
  const who = String(name || '').trim();
  return archive.filter(r => r.kind === BANK_KIND &&
    String(r.consultant || '').trim() === who &&
    Number(r.period_year) === Number(year) &&
    Number(r.period_month) === Number(month)).sort(newestFirst)[0] || null;
}

/**
 * May this account file one? Whoever prepares claims: a consultant files
 * their own — their History holds nobody else's — and the administrator,
 * who prepares claims too, files for anybody. Asked as what the account
 * does, not what it is called. BDOS holds the same rule, so this only
 * decides what the page offers.
 */
const mayFileBank = () => typeof Auth !== 'undefined' && Auth.prepares();

function bankCell (name, when) {
  const cell = document.createElement('td');
  cell.setAttribute('data-label', 'Bank Statement');
  const rec = bankFor(name, when.period_year, when.period_month);

  if (rec) {
    const f = (rec.files || [])[0] || {};
    const item = document.createElement('div');
    item.className = 'history-document';
    const words = document.createElement('div');
    words.className = 'history-document-words';
    const title = document.createElement('span');
    title.className = 'history-document-name';
    title.textContent = 'Bank statement';
    words.appendChild(title);
    const meta = document.createElement('span');
    meta.className = 'history-document-meta';
    meta.textContent = [rec.created_by ? 'by ' + rec.created_by : '',
      rec.created_at ? new Date(rec.created_at).toLocaleDateString() : ''].filter(Boolean).join(' \u00B7 ');
    words.appendChild(meta);
    words.title = f.name || '';
    item.appendChild(words);

    const actions = document.createElement('div');
    actions.className = 'history-document-actions';
    ['view', 'download'].forEach(action => {
      const control = iconButton(action,
        (action === 'view' ? 'View the bank statement \u2014 ' : 'Download the bank statement \u2014 ') + name,
        'ghost small history-icon', c => openHistoryFile(rec, 0, action, c));
      const text = document.createElement('span');
      text.textContent = action === 'view' ? 'View' : 'Download';
      control.appendChild(text);
      actions.appendChild(control);
    });
    item.appendChild(actions);
    cell.appendChild(item);
  } else if (!mayFileBank()) {
    const empty = document.createElement('span');
    empty.className = 'history-missing';
    empty.textContent = 'Not uploaded';
    cell.appendChild(empty);
  }

  if (mayFileBank()) cell.appendChild(bankUploader(name, when, !!rec));
  return cell;
}

/**
 * The way a statement gets here: a button, and behind it the reminder, a box
 * to tick, and only then the file. The file box stays closed until the box
 * is ticked, so the reminder is read at the one moment it can still help.
 */
function bankUploader (name, when, replacing) {
  const box = document.createElement('div');
  box.className = 'bankupload';
  const month = `${MONTHS[Math.max(0, Number(when.period_month) - 1)]} ${when.period_year}`;

  const open = button(replacing ? 'Replace statement' : 'Upload bank statement', 'ghost small', () => {
    panel.hidden = false;
    open.hidden = true;
    tick.focus();
  });
  box.appendChild(open);

  const panel = document.createElement('div');
  panel.className = 'bankpanel';
  panel.hidden = true;

  const warn = document.createElement('p');
  warn.className = 'bankwarn';
  warn.textContent = `Before you upload: black out your balance, every other transaction and ` +
    `your account number (the last four digits may stay). Leave only your name, the date and ` +
    `the payment for ${month}. The administrator and the PA can open this file.`;
  panel.appendChild(warn);

  const agree = document.createElement('label');
  agree.className = 'bankagree';
  const tick = document.createElement('input');
  tick.type = 'checkbox';
  agree.appendChild(tick);
  agree.appendChild(document.createTextNode(
    ' I have blacked out my balance, my other transactions and my account number.'));
  panel.appendChild(agree);

  const inp = document.createElement('input');
  inp.type = 'file';
  inp.disabled = true;
  inp.accept = '.pdf,.png,.jpg,.jpeg,image/*,application/pdf';
  inp.setAttribute('aria-label', `Bank statement for ${name}, ${month}`);
  tick.addEventListener('change', () => { inp.disabled = !tick.checked; });
  inp.addEventListener('change', () => {
    const picked = inp.files && inp.files[0];
    if (picked) uploadBankStatement(name, when, picked, inp);
  });
  panel.appendChild(inp);

  const hint = document.createElement('small');
  hint.className = 'signhint';
  hint.textContent = 'One file, PDF or image, up to 12 MB.' +
    (replacing ? ' It replaces the statement already here.' : '');
  panel.appendChild(hint);

  const cancel = button('Cancel', 'ghost small', () => {
    panel.hidden = true;
    open.hidden = false;
    tick.checked = false;
    inp.disabled = true;
    inp.value = '';
  });
  panel.appendChild(cancel);

  box.appendChild(panel);
  return box;
}

async function uploadBankStatement (name, when, file, control) {
  if (file.size > ARCHIVE_MAX_BYTES) {
    toast(file.name + ' is over the ' + Math.round(ARCHIVE_MAX_BYTES / 1048576) + ' MB limit.', true);
    control.value = '';
    return;
  }
  control.disabled = true;
  control.setAttribute('aria-busy', 'true');
  try {
    const payload = await Sync.readFile(file);
    payload.name = 'Bank statement \u2014 ' + payload.name;
    const rec = await Sync.storeBank(name, when.period_year, when.period_month, payload);
    /* A BDOS that does not know this kind yet stores it with none, and a
       record with no kind is read everywhere as every document of the month
       at once — somebody's bank statement would stand in for their signed
       time sheet. So anything that did not come back as a statement is taken
       straight off the record, and nothing is kept. */
    if (!rec || rec.kind !== BANK_KIND) {
      if (rec && rec.id) { try { await Sync.unstore(rec.id); } catch (e) { /* nothing more to do */ } }
      throw new Error('The server is not ready for bank statements yet, so nothing was kept. ' +
                      'Please try again later.');
    }
    toast('Bank statement uploaded.');
    await renderHistory(true);
  } catch (err) {
    toast(err.status === 403
      ? 'Only the consultant, or the administrator, can upload this bank statement.'
      : (err.message || 'Could not upload the bank statement.'), true);
    control.disabled = false;
    control.removeAttribute('aria-busy');
    control.value = '';
  }
}
const HISTORY_WHAT = { claim: 'time sheet', invoice: 'invoice', advice: 'payment advice' };

function historyTable (records, roster) {
  const wrap = document.createElement('div');
  wrap.className = 'history-table-wrap';
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  const first = records[0];
  const month = `${MONTHS[Math.max(0, Number(first.period_month) - 1)]} ${first.period_year || ''}`.trim();
  wrap.setAttribute('aria-label', month + ' documents');
  const table = document.createElement('table');
  table.className = 'history-table';
  const caption = document.createElement('caption');
  caption.textContent = month;
  table.appendChild(caption);

  /* The month is what Finance is sent, and it is one file: a folder per
     person, three documents in each, everybody at once. So the two buttons
     are the month's, on its heading, and not a row's. The people are read
     at click time, after the map below is built.

     Only for whoever sends it. A consultant reading their own record has
     nothing to compile and nobody to send it to. */
  const sends = typeof Auth !== 'undefined' && (Auth.keepsRecords() || Auth.places());
  const bar = document.createElement('div');
  bar.className = 'history-monthbar';
  const when = { period_year: first.period_year, period_month: first.period_month };
  const everyone = () => [...people.keys()];
  const zipAll = iconButton('download', `Compile every document for everybody in ${month} into one zip`,
    'ghost small history-icon', control => downloadEveryoneZip(when, everyone(), control));
  const zipWord = document.createElement('span'); zipWord.textContent = 'Compile month zip';
  zipAll.appendChild(zipWord); bar.appendChild(zipAll);
  const mail = iconButton('download', `Compile ${month} for everybody and open the e-mail to Finance`,
    'ghost small history-icon', control => sendMonthToFinance(when, everyone(), control));
  const mailWord = document.createElement('span'); mailWord.textContent = 'Email Finance';
  mail.appendChild(mailWord); bar.appendChild(mail);
  if (sends) wrap.appendChild(bar);
  const head = document.createElement('thead');
  const titles = document.createElement('tr');
  ['Consultant', 'Time Sheet', 'Invoice', 'Payment Advice', 'Bank Statement'].forEach(label => {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    titles.appendChild(cell);
  });
  head.appendChild(titles);
  table.appendChild(head);
  const body = document.createElement('tbody');
  const people = new Map();
  // everybody first, so somebody who has filed nothing still has a line
  (roster || []).forEach(name => people.set(name, []));
  records.forEach(r => {
    const name = String(r.consultant || '').trim() || '(no name)';
    if (!people.has(name)) people.set(name, []);
    people.get(name).push(r);
  });
  /* A Map keeps the order things were put into it, and re-setting a key it
     already has does not move it — so the order is made here rather than
     there. Alphabetical, which is how anybody looks for a name in a list. */
  [...people.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([name, copies]) => {
    const row = document.createElement('tr');
    const person = document.createElement('th');
    person.scope = 'row';
    person.textContent = name;
    row.appendChild(person);
    ['claim', 'invoice', 'advice'].forEach(kind => {
      const cell = document.createElement('td');
      cell.setAttribute('data-label', HISTORY_COLUMN[kind]);
      // Older records contained both documents and did not carry a kind.
      const matching = copies.filter(r => !r.kind || r.kind === kind);
      let fileCount = 0;
      matching.forEach(r => (r.files || []).forEach((f, index) => {
        fileCount++;
        const item = document.createElement('div');
        item.className = 'history-document';
        const words = document.createElement('div');
        words.className = 'history-document-words';

        /* Every document says what it is called. Two icons and a reference
           number tell somebody there is a file here; the name tells them
           which file, which is the thing they are looking for. It is cut
           off at the width of the column rather than wrapped into three
           lines, and the whole of it is in the tooltip. */
        const title = document.createElement('span');
        title.className = 'history-document-name';
        title.textContent = f.name || 'Document';
        words.appendChild(title);

        const description = document.createElement('span');
        description.className = 'history-document-meta';
        /* A record old enough to predate the two documents being told apart
           is worth saying. Everything else on this line is already in the
           column it sits under, and repeating it is how a table stops being
           readable — the list is finished copies only, so saying so under
           every one of them says nothing. */
        description.textContent = [
          r.invoice_no || '',
          !r.kind ? 'Combined record' : '',
          (r.files || []).length > 1 ? `File ${index + 1}` : ''
        ].filter(Boolean).join(' \u00B7 ');
        words.appendChild(description);
        words.title = [f.name, r.invoice_no, r.note].filter(Boolean).join(' \u00B7 ');
        const actions = document.createElement('div');
        actions.className = 'history-document-actions';
        const what = `${HISTORY_WHAT[kind]} \u2014 ${name}`;
        ['view', 'download'].forEach(action => {
          const label = (action === 'view' ? 'View the ' : 'Download the ') + what;
          const control = iconButton(action, label, 'ghost small history-icon',
            control => openHistoryFile(r, index, action, control));
          const text = document.createElement('span');
          text.textContent = action === 'view' ? 'View' : 'Download';
          control.appendChild(text);
          actions.appendChild(control);
        });
        if (Auth.isAdmin()) {
          const gone = iconButton('remove', 'Delete the ' + what + ' from the record',
            'ghost small history-icon danger', () => deleteStored(r, () => paintHistory()));
          const word = document.createElement('span');
          word.textContent = 'Delete';
          gone.appendChild(word);
          actions.appendChild(gone);
        }
        item.appendChild(words);
        item.appendChild(actions);
        cell.appendChild(item);
      }));
      if (!fileCount) {
        const empty = document.createElement('span');
        empty.className = 'history-missing';
        empty.textContent = 'Not available';
        cell.appendChild(empty);
      }
      row.appendChild(cell);
    });
    row.appendChild(bankCell(name, when));

    body.appendChild(row);
  });
  table.appendChild(body);

  wrap.appendChild(table);
  return wrap;
}

async function openHistoryFile (record, index, action, control) {
  control.disabled = true;
  control.setAttribute('aria-busy', 'true');
  try {
    const stored = await Sync.storedOne(record.id);
    const file = stored && (stored.files || [])[index];
    if (!file || !file.content) throw new Error('That file is not on the record. Refresh and try again.');
    const type = file.type || (/\.pdf$/i.test(file.name || '') ? 'application/pdf' : 'application/octet-stream');
    const bytes = dataUrlToBytes('data:' + type + ';base64,' + file.content);
    const blob = new Blob([bytes], { type });
    const filename = file.name || archiveFileName(record, file);
    if (action === 'view') openFilePreview(filename, filename, blob, control);
    else saveAs(blob, filename);
  } catch (err) {
    toast(err.message || 'Could not open that file. Please try again.', true);
  } finally {
    control.disabled = false;
    control.removeAttribute('aria-busy');
  }
}

/** what the History step is showing, after its three filters */
function historyRows () {
  return latestCopies(archive)
    .filter(r => !historyWho || String(r.consultant || '').trim() === historyWho)
    .filter(r => !historyYear || String(r.period_year) === historyYear)
    /* The finished copies, and only those: the ones the PA put back with the
       signatures on them, which is what anybody asking for "September"
       means. The project manager's reviewed copy is evidence that a claim
       was read on the way through, not a document to collect — it is still
       on the Status step, against the month it belongs to. */
    .filter(r => stageOf(r) === ARCHIVE_FINAL)
    .slice()
    .sort((a, b) =>
      (b.period_year - a.period_year) || (b.period_month - a.period_month) ||
      String(a.consultant || '').localeCompare(String(b.consultant || '')));
}

/**
 * Take a copy of everything listed, as one archive.
 *
 * Whoever keeps the records needs the whole month, not a file at a time. So
 * this walks what the filters are showing, fetches every file in it, names
 * each one for the person and the month rather than for whatever the
 * scanner called it, and puts the lot in a single zip.
 */
async function downloadAllHistory (btn) {
  if (downloading) return;
  const rows = historyRows();
  const note = document.getElementById('downloadNote');
  const say = (text, bad) => {
    if (!note) return;
    note.hidden = false;
    note.setAttribute('role', bad ? 'alert' : 'status');
    note.className = 'keynote' + (bad ? ' warn' : '');
    note.textContent = text;
  };

  if (!rows.length) { say('There is nothing listed to download.', true); return; }

  downloading = true;
  const was = btn.textContent;
  btn.disabled = true;
  const files = [];
  const failed = [];

  try {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      btn.textContent = `Fetching ${i + 1} of ${rows.length}…`;
      say(`${files.length} file${files.length === 1 ? '' : 's'} collected so far. ` +
          'Leave this step open until it finishes.');
      try {
        const rec = await Sync.storedOne(r.id);
        (rec && rec.files || []).forEach(f => {
          const type = f.type || 'application/octet-stream';
          files.push({
            name: archiveFileName(r, f),
            bytes: dataUrlToBytes('data:' + type + ';base64,' + (f.content || ''))
          });
        });
      } catch (err) {
        failed.push(`${r.consultant || r.id}: ${err.message}`);
      }
    }

    /* One archive, not one download each. The browser asks before saving
       several files in a row, and an afternoon's collecting turned on
       whether somebody read that prompt — say no by accident and nothing
       arrives, say yes and they land loose in Downloads among everything
       else. A folder is what was wanted all along. */
    if (files.length) {
      btn.textContent = 'Packing…';
      saveAs(zipFiles(files), archiveZipName(rows));
    }
  } finally {
    downloading = false;
    btn.disabled = false;
    btn.textContent = was;
  }

  const n = files.length;
  say(!n
    ? `Nothing could be fetched. ${failed[0] || ''}`.trim()
    : failed.length
      ? `${n} file${n === 1 ? '' : 's'} in one zip. ${failed.length} could not be fetched: ${failed[0]}`
      : `${n} file${n === 1 ? '' : 's'} saved to your Downloads folder, in one zip.`,
    !n || !!failed.length);
}

/**
 * What to call the archive.
 *
 * Named for what is in it, so three of them in a Downloads folder are told
 * apart without opening any: whoever it was narrowed to, the year, or the
 * month when everything listed happens to be one month.
 */
function archiveZipName (rows) {
  const parts = ['Signed copies'];
  if (historyWho) parts.push(historyWho);
  const months = new Set(rows.map(r => `${r.period_year}-${r.period_month}`));
  if (months.size === 1 && rows.length) {
    const m = Number(rows[0].period_month) || 0;
    parts.push(`${MONTHS[Math.max(0, m - 1)]} ${rows[0].period_year || ''}`.trim());
  } else if (historyYear) {
    parts.push(historyYear);
  }
  return safeFile(parts.join(' - ')) + '.zip';
}

/** named for the person and the month, not for whatever the scanner called it */
function archiveFileName (r, f) {
  const m = Number(r.period_month) || 0;
  const when = `${MON3[Math.max(0, m - 1)]} ${r.period_year || ''}`.trim();
  const who = safeFile(r.consultant) || 'Consultant';
  const dot = String(f.name || '').lastIndexOf('.');
  const ext = dot > 0 ? String(f.name).slice(dot) : '.pdf';
  const what = safeFile(kindLabel(r.kind || 'claim'));
  return `${when} - ${who} - ${what}${ext}`;
}

/** rebuild a <select> without losing the caller's placeholder */
function fillSelect (el, placeholder, values, labels) {
  el.innerHTML = '';
  const first = document.createElement('option');
  first.value = '';
  first.textContent = placeholder;
  el.appendChild(first);
  values.forEach((v, i) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = labels[i];        // names are typed by people, never markup
    el.appendChild(o);
  });
}

/**
 * One filed record.
 * @param {boolean} [namePerson] head it with the consultant rather than the
 *        month — History groups by month, so the month is already above it
 */
function archiveRow (r, namePerson) {
  const row = document.createElement('div');
  row.className = 'archrow';

  const head = document.createElement('div');
  head.className = 'archhead';
  const when = document.createElement('b');
  const m = Number(r.period_month) || 0;
  when.textContent = namePerson
    ? (String(r.consultant || '').trim() || '(no name)')
    : (MONTHS[Math.max(0, m - 1)] + ' ' + (r.period_year || '')).trim();
  head.appendChild(when);

  if (r.kind && typeof kindLabel === 'function') {
    const tag = document.createElement('span');
    tag.className = 'doctag ' + r.kind;
    tag.textContent = kindLabel(r.kind);
    head.appendChild(tag);
  }
  // a copy signed by the project manager on the way through is not the
  // finished article, and a list that did not say so would be misleading
  if (stageOf(r) !== ARCHIVE_FINAL) {
    const stage = document.createElement('span');
    stage.className = 'stagetag';
    stage.textContent = 'reviewed copy';
    head.appendChild(stage);
  }

  const meta = document.createElement('span');
  meta.textContent = [
    r.invoice_no || '',
    r.created_by ? 'filed by ' + r.created_by : '',
    r.created_at ? new Date(r.created_at).toLocaleDateString() : ''
  ].filter(Boolean).join(' · ');
  head.appendChild(meta);
  row.appendChild(head);

  if (r.note) {
    const note = document.createElement('p');
    note.className = 'subnote';
    note.textContent = r.note;
    row.appendChild(note);
  }

  const files = document.createElement('div');
  files.className = 'archfiles';
  (r.files || []).forEach((f, i) => {
    const b = button(f.name || ('Document ' + (i + 1)), 'ghost small',
                     () => downloadStored(r.id, i, f.name));
    b.setAttribute('aria-label', 'Download ' + (f.name || 'document') + ' for ' + (r.consultant || 'consultant'));
    b.title = f.size ? 'Download · ' + Math.round(f.size / 1024) + ' KB' : 'Download document';
    files.appendChild(b);
  });
  if (!(r.files || []).length) {
    const none = document.createElement('span');
    none.className = 'archnone';
    none.textContent = 'no files on this record';
    files.appendChild(none);
  }
  row.appendChild(files);

  /* Only the account that set the thing up, and only here: a copy that was
     filed by the process is evidence, and evidence is not tidied away. */
  if (Auth.isAdmin()) {
    const bar = document.createElement('div');
    bar.className = 'btnrow';
    bar.appendChild(button('Delete', 'ghost small danger', () => deleteStored(r, async () => {
      paintArchive();
      if (typeof renderApprovals === 'function') await renderApprovals();
    })));
    row.appendChild(bar);
  }
  return row;
}

/**
 * Take one filed copy off the record.
 *
 * The signed copy is the thing anybody will be asked for a year from now, so
 * this is the administrator's and nobody else's, and the confirmation names
 * the person, the month and the document before it goes. BDOS allows it for
 * the administrator and for whoever filed it, and refuses everybody else.
 *
 * It exists for copies that were never part of the process — the ones left
 * behind while the thing was being set up, which look exactly like real ones.
 */
async function deleteStored (r, after) {
  if (archiveBusy) return;
  const m = Number(r.period_month) || 0;
  const when = `${MONTHS[Math.max(0, m - 1)]} ${r.period_year || ''}`.trim();
  const what = r.kind === BANK_KIND ? 'bank statement'
    : (r.kind && typeof kindLabel === 'function' ? kindLabel(r.kind) : 'signed copy').toLowerCase();
  if (!confirm(
    `Delete the ${what} on file for ${when}?\n\n` +
    `${String(r.consultant || 'somebody').trim()}${r.invoice_no ? ' \u00b7 ' + r.invoice_no : ''}\n\n` +
    'The file goes from the database for everybody, and the claim it belongs to ' +
    'stops showing a copy on file. This cannot be undone.')) return;

  archiveBusy = true;
  try {
    await Sync.unstore(r.id);
    archive = archive.filter(x => x.id !== r.id);
    toast('The filed copy is gone.');
    if (typeof after === 'function') await after();
  } catch (err) {
    toast(err.message || 'Could not delete that copy.', true);
  } finally {
    archiveBusy = false;
  }
}

/** pull one filed document back down and hand it to the browser to save */
async function downloadStored (id, index, name) {
  try {
    const rec = await Sync.storedOne(id);
    const f = rec && (rec.files || [])[index];
    if (!f || !f.content) { toast('That file is not on the record.', true); return; }
    const type = f.type || 'application/octet-stream';
    const bytes = dataUrlToBytes('data:' + type + ';base64,' + f.content);
    saveAs(new Blob([bytes], { type: type }), name || f.name || 'document');
  } catch (err) {
    toast(err.message || 'Could not fetch that file.', true);
  }
}

/* -------------------------------------------------------------------
   Filing a month

   The card files whatever the earlier steps say this claim is: the
   profile that is open, the month on the sheet, the invoice number it
   carries. That is deliberate — there is no second place to type a name
   and a month, and so no second place to get them wrong.
   ------------------------------------------------------------------- */

function archiveUploadCard () {
  const card = document.createElement('div');
  card.className = 'archupload';

  const head = document.createElement('h4');
  head.textContent = 'File signed copies';
  card.appendChild(head);

  const lead = document.createElement('p');
  lead.className = 'archlead';
  lead.textContent =
    (String(S.consultant.name || '').trim() || 'Select a profile first') +
    ' · ' + MONTHS[S.timesheet.month] + ' ' + S.timesheet.year +
    (S.invoice.no ? ' · ' + S.invoice.no : '');
  card.appendChild(lead);

  const pickers = document.createElement('div');
  pickers.className = 'archpickers';
  const inputs = ARCHIVE_SLOTS.map(slot => {
    const label = document.createElement('label');
    label.className = 'archslot';
    const cap = document.createElement('span');
    cap.textContent = slot.label;
    label.appendChild(cap);
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.pdf,.png,.jpg,.jpeg,image/*,application/pdf';
    label.appendChild(inp);
    pickers.appendChild(label);
    return inp;
  });
  card.appendChild(pickers);

  const note = document.createElement('input');
  note.className = 'dinput archnote';
  note.placeholder = 'Add details about these copies';
  const noteLabel = document.createElement('label');
  noteLabel.className = 'fieldlabel';
  noteLabel.appendChild(document.createTextNode('Filing note (optional)'));
  noteLabel.appendChild(note);
  card.appendChild(noteLabel);

  const hint = document.createElement('p');
  hint.className = 'fieldhint';
  hint.textContent = 'PDF or image · max 12 MB each. Check the consultant and month; change them in the form if needed.';
  card.appendChild(hint);

  const bar = document.createElement('div');
  bar.className = 'btnrow';
  const go = button('File signed copies', 'primary', () => fileSigned(inputs, note, go));
  bar.appendChild(go);
  card.appendChild(bar);
  return card;
}

async function fileSigned (inputs, note, go) {
  if (archiveBusy) return;

  /* Which slot a file was put in is which document it is, and that is the
     whole of it — there is nothing to type and nothing to get wrong. Two
     files means two records, one per document, so the status table can say
     "the time sheet is back, the invoice is not". */
  const chosen = ARCHIVE_SLOTS
    .map((slot, i) => ({ kind: slot.key, file: inputs[i].files && inputs[i].files[0] }))
    .filter(x => x.file);

  if (!chosen.length) {
    toast('Choose the signed documents first.', true);
    return;
  }
  if (!String(S.consultant.name || '').trim()) {
    toast('Pick a profile first — the copies are filed against a person.', true);
    return;
  }
  const tooBig = chosen.filter(x => x.file.size > ARCHIVE_MAX_BYTES)[0];
  if (tooBig) {
    toast(tooBig.file.name + ' is ' + Math.round(tooBig.file.size / 1048576) + ' MB — ' +
          Math.round(ARCHIVE_MAX_BYTES / 1048576) + ' MB is the limit.', true);
    return;
  }

  archiveBusy = true;
  go.disabled = true;
  const was = go.textContent;
  go.textContent = 'Filing…';
  try {
    for (const one of chosen) {
      const payload = await Sync.readFile(one.file);
      payload.name = kindLabel(one.kind) + ' (signed) — ' + payload.name;
      await Sync.store(S, [payload], note.value.trim(), one.kind, ARCHIVE_FINAL);
    }
    toast(chosen.map(x => kindLabel(x.kind)).join(' and ') + ' filed for ' +
          MONTHS[S.timesheet.month] + ' ' + S.timesheet.year + '.');
    await renderArchive(true);
    if (typeof renderApprovals === 'function') await renderApprovals();
  } catch (err) {
    toast(err.message || 'Could not file them.', true);
  } finally {
    archiveBusy = false;
    go.disabled = false;
    go.textContent = was;
  }
}

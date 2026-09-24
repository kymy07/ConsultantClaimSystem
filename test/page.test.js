/* =======================================================================
   page.test.js — the checks that are about the page, not the JavaScript.

   A stubbed DOM cannot catch these. Both of the bugs below shipped once:
   the sign-in gate that could never be hidden and sat over the unlocked
   app forever, and the form that fell back to a native GET and put a
   password in the URL. Neither was visible to a unit test, because in a
   fake DOM `el.hidden = true` always works and forms never submit.

   Run:  node test/page.test.js
   ======================================================================= */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const css  = fs.readFileSync(path.join(ROOT, 'assets/css/style.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

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

/* -----------------------------------------------------------------------
   Overlays that JavaScript shows and hides with `el.hidden`.

   Each gives itself a `display` in the stylesheet. That is an author rule,
   so it beats the browser's own [hidden]{display:none} from the UA sheet,
   and `el.hidden = true` quietly does nothing — the overlay stays fixed
   over the app at its z-index with no way to dismiss it. Every one of them
   needs to say so explicitly.
   ----------------------------------------------------------------------- */
console.log('\nOverlays can actually be hidden');

['authgate', 'pdfview', 'profilemenu'].forEach(cls => {
  const setsDisplay = new RegExp('\\.' + cls + '\\s*\\{[^}]*display\\s*:', 'm').test(css);
  const answersHidden = new RegExp('\\.' + cls + '\\[hidden\\]\\s*\\{[^}]*display\\s*:\\s*none').test(css);
  check(`.${cls}`, !setsDisplay || answersHidden, true);
});

/* -----------------------------------------------------------------------
   The profile list. Each row acts on the profile it names, so the row has
   to carry the name as text — profiles arrive from other people over BDOS,
   and a name is not markup.
   ----------------------------------------------------------------------- */
console.log('\nThe profile list');

const appjs = fs.readFileSync(path.join(ROOT, 'assets/js/app.js'), 'utf8');
const archivejs = fs.readFileSync(path.join(ROOT, 'assets/js/archive.js'), 'utf8');
const authjs = fs.readFileSync(path.join(ROOT, 'assets/js/auth.js'), 'utf8');
check('the menu is in the page', /id="profileMenu"/.test(html), true);
check('its rows are built as text, never innerHTML',
  /menu\.innerHTML\s*=\s*['"]{2}/.test(appjs) &&
  !/prow[\s\S]{0,400}innerHTML\s*=\s*`/.test(appjs), true);
check('a row opens and deletes its own profile',
  /editProfile\(name\)/.test(appjs) && /removeProfile\(name\)/.test(appjs), true);
check('the list can start a new profile', /Add new profile/.test(appjs), true);

/* -----------------------------------------------------------------------
   The approvals screen. A claim is read by four people and signed by three
   of them, and the one thing that must never slip is which box each role
   signs — the project manager in the HOD's box would be an approval nobody
   gave, and nothing on the printed sheet would show it.
   ----------------------------------------------------------------------- */
console.log('\nThe approvals screen');

const approvals = fs.readFileSync(path.join(ROOT, 'assets/js/approvals.js'), 'utf8');
check('the panel is in the page', /id="p-approvals"/.test(html), true);

/* -----------------------------------------------------------------------
   Downloading the documents and sending the claim away are two different
   decisions, and they used to be one screen. Generating happens several
   times while a month is still being argued about; submitting happens once
   and cannot be taken back — so it has a step of its own, and the Generate
   step no longer offers it.
   ----------------------------------------------------------------------- */
console.log('\nSubmitting is its own step');

check('the submit panel is in the page', /id="p-submit"/.test(html), true);
check('and the step is in the flow', /id: 'submit'/.test(appjs), true);
check('the Generate step no longer submits',
  /id="p-generate"[\s\S]*?<\/section>/.exec(html)[0].includes('btnSubmitClaim'), false);
check('nor offers "Generate All"', /id="btnAll"/.test(html + appjs), false);
// The card is only offered once the database has answered: a claim that
// silently went nowhere is worse than one that was never sent.
check('the card waits for the database', /card.hidden = !canSend/.test(appjs), true);

/* -----------------------------------------------------------------------
   A month is two documents, and they are not the same document. The invoice
   is a bill; the time sheet is the evidence for it. Each goes for approval
   on its own, so an approver can be happy with one and not the other.
   ----------------------------------------------------------------------- */
console.log('\nTwo documents, two approvals');

const statejs = fs.readFileSync(path.join(ROOT, 'assets/js/state.js'), 'utf8');
const syncjs  = fs.readFileSync(path.join(ROOT, 'assets/js/sync.js'), 'utf8');
const geninvoice = fs.readFileSync(path.join(ROOT, 'assets/js/gen-invoice.js'), 'utf8');

check('the Submit step asks which ones go', /id="submitPick"/.test(html), true);
check('and a submission says which one it is', /kind:\s*which/.test(syncjs), true);
// The list endpoint hands back no `data`, so the kind has to be a field of
// its own for a table to be drawn without fetching every stored form.
check('the kind is also kept inside the form it stores',
  /payload\.submitKind\s*=\s*which/.test(syncjs), true);
check('one submission is sent per document',
  /for \(const kind of going\)/.test(appjs), true);
// Only the time sheet carries approver signature boxes. An invoice has one
// signature on it, the consultant's, and approving a bill does not sign it.
check('only the time sheet gets signed by an approver',
  /kindOf\(sub\) === 'claim' \? STAGE_SIGNS\[sub\.status\] : null/.test(approvals), true);
check('the stages are drawn in the order they happen',
  /'pending_manager'[\s\S]{0,200}'pending_boss'[\s\S]{0,200}'pending_signature'/
    .test(approvals), true);
/* The project manager puts their name to a time sheet before it goes any
   further — drawn in the app, or signed on paper and uploaded as a scan. An
   invoice is the exception: it carries the consultant's signature and nobody
   else's, so approving one asks for nothing to be uploaded. */
check('a stage that signs will not pass a time sheet on unsigned',
  /if \(signing && signs && pad\.isEmpty\(\) && !file\)/.test(approvals) &&
  /if \(signing && !signs && !file\)/.test(approvals), true);
check('but an invoice is approved, not signed',
  /function mustSign[\s\S]{0,80}kindOf\(sub\) === 'claim'/.test(approvals), true);
/* Nobody signs an invoice, so the HOD approving one is the last thing that
   happens to it — and the copy worth keeping is the invoice as approved.
   Waiting for a signed scan that will never exist is what kept approved
   invoices out of the list Group People & Finance collects from. */
check('and an approved invoice files itself',
  /async function fileApprovedInvoice/.test(approvals) &&
  /moved\.status !== 'complete'/.test(approvals), true);
check('on both the single decision and the bulk one',
  (approvals.match(/fileApprovedInvoice\(sub, moved\)/g) || []).length, 2);
check('and one approved before that can be put on file by hand',
  /async function fileInvoiceNow/.test(approvals) && /'File it'/.test(approvals), true);
check('and the project manager is one of them',
  /key: 'pending_manager',[\s\S]{0,120}filed: 'reviewed'/.test(approvals), true);
check('while the HOD signs nothing',
  /key: 'pending_boss',[^}]*filed:/.test(approvals), false);
check('a scan is filed against the signing it came from',
  /kind, sub\.status\)/.test(approvals), true);

/* -----------------------------------------------------------------------
   The money. A month is paid in full and the days that are not paid for are
   taken off it — the denominator is the calendar month, never a count of
   weekdays, because a monthly rate pays for the weekend too.
   ----------------------------------------------------------------------- */
console.log('\nThe calendar-month prorate');

check('the deduction is worked out over the calendar month',
  /rate \/ dim \* unpaid/.test(statejs), true);
check('and taken off the whole month', /rate - deduction/.test(statejs), true);

/* -----------------------------------------------------------------------
   Signed copies. The upload sends bytes somebody chose off their own disk,
   so the size is checked in the browser before any of it is read.
   ----------------------------------------------------------------------- */
console.log('\nThe archive');

check('the list is in the page', /id="archiveList"/.test(html), true);
check('a file too big is refused before it is read',
  /\.size > ARCHIVE_MAX_BYTES/.test(archivejs), true);
// Which slot a file was put in is which document it is: two files means two
// records, so the status table can say the sheet is back and the invoice is not.
check('a signed copy is filed against its own document',
  /Sync\.store\(S, \[payload\], note\.value\.trim\(\), one\.kind, ARCHIVE_FINAL\)/
    .test(archivejs), true);
check('and rows are built as text, never markup',
  /archiveperson[\s\S]{0,200}innerHTML/.test(archivejs), false);
// Which box is signed follows the stage the claim is at, not the role of
// whoever is looking — the admin stands in at any of them.
check('the REVIEWED BY box is signed when it is with the manager',
  /pending_manager:\s*\{\s*sig:\s*'pm'/.test(approvals), true);
check("the HOD's box is signed at the PA's step, by whoever is there",
  /pending_signature:\s*\{\s*sig:\s*'hod'/.test(approvals), true);
check('nothing is signed while it sits with the HOD',
  /pending_boss:\s*\{\s*sig:/.test(approvals), false);
// The admin fills claims in as well as approving them, so the wizard has to
// be drawn for them — the test is "does this account prepare claims", never
// "is it a consultant", which left the admin with an approvals screen and
// nothing else.
check('the wizard is hidden by what an account prepares, not by its role name',
  /Auth\.role\(\)\s*&&\s*!Auth\.prepares\(\)/.test(appjs), true);
// Every "can this account do X" has to ask what the account does, never what
// it is called. Comparing to a role name is how the admin ended up with less
// access than the people it administers.
check('nothing decides access by comparing to a role name',
  /Auth\.role\(\)\s*===/.test(appjs + approvals + archivejs), false);
// The PA places the HOD's signature, and some months that happens on paper —
// so the account that places it is the one that files the finished document.
check('placing a signature is a capability, not a name',
  /places:\s*\(\)\s*=>\s*places\(currentRole\(\)\)/
    .test(fs.readFileSync(path.join(ROOT, 'assets/js/auth.js'), 'utf8')), true);
check('and filing a signed copy asks for it',
  /Auth\.places\(\)/.test(archivejs), true);
check('a claim waits on the manager, then the HOD, then the PA',
  /pending_manager:\s*'manager'[\s\S]{0,160}pending_boss:\s*'boss'[\s\S]{0,160}pending_signature:\s*'pa'/
    .test(approvals), true);

/* -----------------------------------------------------------------------
   Credentials must never be able to leave in a URL. If the script that
   handles the sign-in form ever fails to bind its listener, the browser
   falls back to submitting the form itself — a GET carrying the password
   in the query string, into the address bar, history and the server log.
   ----------------------------------------------------------------------- */
console.log('\nThe sign-in form');

check('cannot submit natively',
  /id="authForm"[^>]*onsubmit="return false"/.test(html), true);
check('the password box is a password box',
  /id="authPassword"[^>]*type="password"|type="password"[^>]*id="authPassword"/.test(html), true);
check('and never remembers a typed password in the URL',
  /<form[^>]*id="authForm"[^>]*method=/.test(html), false);

/* -----------------------------------------------------------------------
   Script order: every file the app leans on has to be parsed before the
   one that calls into it.
   ----------------------------------------------------------------------- */
/* -----------------------------------------------------------------------
   The administrator's History step. Status answers "where is this month";
   somebody has to be able to answer "where is last March" as well, and only
   that account gets to.
   ----------------------------------------------------------------------- */
console.log('\nThe History step');

check('the panel is in the page', /id="p-history"/.test(html), true);
check('the step is marked for whoever keeps the records',
  /id: 'history',[^}]*records: true/.test(appjs), true);
check('and nothing else can reach it',
  /!s\.records \|\| Auth\.keepsRecords\(\)/.test(appjs), true);
// Reading the whole record back, and taking a copy of it away, is a job. The
// claim finishes with the PA and nobody collects it afterwards, so what it
// leaves behind is the administrator's to keep.
check('keeping records is a capability, not a name',
  /const keepsRecords = r => r === 'admin'/.test(authjs), true);
check('and Download all takes what the filters are showing',
  /function downloadAllHistory/.test(archivejs) && /historyRows\(\)/.test(archivejs), true);
/* Somebody who only collects the finished forms is not shown a queue of
   decisions that will never be theirs to make. Their whole app is the shelf
   the documents end up on. */
check('a collector gets the shelf and not the queue',
  /'approvals' && Auth\.approves\(\)/.test(appjs) &&
  /'history' && Auth\.keepsRecords\(\)/.test(appjs), true);
check('and approving is a capability too',
  /const approves = r => r === 'manager'/.test(authjs), true);
// Status and History only report. Gating them behind "pick a document first"
// asked an administrator opening the app to see whether Amila had sent
// September to choose a document they were never going to produce.
check('a reporting step is not gated behind the form',
  /const INFO_STEPS = \[[\s\S]{0,140}'advice', 'mysign'\]/.test(appjs) &&
  /!skipGuard && !reporting/.test(appjs), true);
check('the stage headings name who does the stage',
  /Auth\.personFor\(st\.who\)/.test(approvals), true);
check('and the approval block starts from the same list, not a second copy',
  /review: Auth\.personFor\('manager'\)/.test(appjs), true);

/* -----------------------------------------------------------------------
   On a phone. Four people approve claims on whatever is in their hand, and
   two of the failures that costs are invisible to a desktop browser: iOS
   zooms in on any field under 16px and never zooms back, and a seven-column
   table at 360px is a table nobody scrolls.
   ----------------------------------------------------------------------- */
console.log('\nOn a phone');

check('the page declares the device width',
  /name="viewport"[^>]*width=device-width/.test(html), true);
check('and never blocks pinch zoom',
  /(maximum-scale|user-scalable)/.test(html), false);
check('ordinary fields are 16px, so iOS does not zoom in on them',
  /@media\(max-width:700px\)\{[\s\S]{0,900}input,select,textarea\{font-size:16px\}/.test(css), true);
check('the status table becomes a card each',
  /\.statustable thead\{display:none\}/.test(css), true);
check('and every lamp can then say what it is',
  /\.statustable td\.stagecell::before\{[\s\S]{0,40}content:attr\(data-col\)/.test(css), true);
check('which means the cells carry it', /cell\.dataset\.col = head/.test(approvals), true);
check('the notch does not sit over the top bar',
  /env\(safe-area-inset-left\)/.test(css), true);

/* -----------------------------------------------------------------------
   Everybody has an account now, and a consultant sees their own work. Three
   things on a profile belong to the office rather than to the person — the
   number series, the count, and which sign-in owns it — and one person
   deciding they are 07 is how two people end up both being 07.
   ----------------------------------------------------------------------- */
console.log('\nWhose profile is whose');

check('a consultant does not see everybody',
  /const seesEveryone = r => r !== 'consultant'/.test(authjs), true);
check('and does not set the numbering',
  /const setsNumbering = r => r === 'admin'/.test(authjs), true);
check('the profile list is filtered by who owns it',
  /Auth\.owns\(mergeDefaults\(everything\[name\]\)\)/.test(appjs), true);
check('so is the status table', /Auth\.owns\(mergeDefaults\(all\[n\]\)\)/.test(approvals), true);
check('the three office fields are locked by capability, not by name',
  /\['c_uniqueId', 'c_claimSeq', 'c_email'\][\s\S]{0,200}Auth\.setsNumbering\(\)/
    .test(appjs) || /const may = Auth\.setsNumbering\(\)/.test(appjs), true);

/* -----------------------------------------------------------------------
   Step 1 is the step everything else reads from, so it is the step that has
   to be finished. A draft is not a profile: details typed in and never
   saved came back blank the next month.
   ----------------------------------------------------------------------- */
console.log('\nFinishing step 1');

check('a name, a number, a rate and a signature are all required',
  /'the full name'/.test(appjs) && /'the monthly rate'/.test(appjs) &&
  /'a signature'/.test(appjs), true);
check('the rate starts empty rather than at a figure nobody reads',
  /monthlyRate: 0/.test(statejs), true);
check('Next is not offered while there is a reason to refuse it',
  /next\.disabled = !!missing\.length \|\| profileDirty/.test(appjs), true);
check('and an unsaved edit is one of those reasons',
  /Press Save Profile first/.test(appjs), true);

/* -----------------------------------------------------------------------
   The signature. Drawn once or scanned once, then printed every month —
   and a scan is a whole page, so what was found on it is shown back before
   anything is kept.
   ----------------------------------------------------------------------- */
console.log('\nThe signature on the profile');

const sigjs = fs.readFileSync(path.join(ROOT, 'assets/js/signature.js'), 'utf8');
check('the block is in the page', /id="sigProfile"/.test(html), true);
check('a scan can be a PDF',
  /accept="\.pdf/.test(sigjs) && /pdfjsLib\.getDocument/.test(sigjs), true);
check('the ink on the page is found for you', /function detectInkBox/.test(sigjs), true);
check('and shown back before it is kept',
  /Use this signature/.test(sigjs) && /keep\(pending\)/.test(sigjs), true);
// pdf.js is a third of a megabyte and is used once per person, while the
// approvers — the ones most likely to be on a phone — never touch it
check('the PDF reader is fetched only when it is needed',
  !/pdf\.min\.js/.test(html) && /document\.createElement\('script'\)/.test(sigjs), true);
check('the daily rate is gone', /dailyRate|id="wrapDaily"|id="dailyWarn"/.test(html + appjs), false);

/* -----------------------------------------------------------------------
   A rejection is a job, not a status. The step carrying it appears by
   itself the moment something is sent back, and what goes up when it is
   sent round again is the form as it stands — sending the stored copy would
   hand the approver the very document they rejected.
   ----------------------------------------------------------------------- */
console.log('\nSent back');

const resubjs = fs.readFileSync(path.join(ROOT, 'assets/js/resubmit.js'), 'utf8');
check('the step is in the page', /id="p-resubmit"/.test(html), true);
check('and appears only while something has come back',
  /whenReturned: true/.test(appjs) && /returnedCount\(\) > 0/.test(appjs), true);
check('the tab counts them', /stepbadge/.test(appjs), true);
check('the reason is on the card, not in a tooltip',
  /back\.note \|\| 'No reason was given\.'/.test(resubjs), true);
check('what is sent is the form as it stands',
  /editing \? S : undefined/.test(resubjs), true);
/* One document back is the ordinary case, and making somebody press a button
   to be handed the thing they came for is a button for its own sake. But
   adopting replaces the form, so it is never done over the top of work that
   is not about this document. */
check('one document back opens by itself',
  /returned\.length === 1 && safeToOpen\(returned\[0\]\)/.test(resubjs), true);
/* The rows worth deleting look exactly like the rows that must never be, so
   the confirmation names the document, the month and the number — and only
   the account that set the thing up is offered it at all. */
check('only the administrator is offered a delete',
  /if \(Auth\.isAdmin\(\)\)[\s\S]{0,160}'Delete'/.test(approvals), true);
check('and it is offered on the Re-submit card too',
  /Auth\.isAdmin\(\)[\s\S]{0,200}'Delete'/.test(resubjs), true);
check('the confirmation names what is going',
  /Delete the \$\{what\} for \$\{periodOf\(sub\)\}/.test(approvals), true);
check('and deleting is not the same call as Reset All',
  /remove: deleteSubmission/.test(syncjs), true);

/* The document that came back is edited in the card that is about it. The
   step that draws it is moved in and moved back — moved, not copied, because
   the replica is bound to the state and a second copy would be a second form
   fighting the first over the same claim. */
check('the document is edited in the card, not on another step',
  /function borrowDocument/.test(resubjs) && /host\.appendChild\(el\)/.test(resubjs), true);
check('and the step it was borrowed from gets it back',
  /function releaseEditor/.test(resubjs) &&
  /step\.id !== 'resubmit'\) releaseEditor\(\)/.test(appjs), true);
check('before the card holding it is rebuilt',
  /renderingResubmit\) return;[\s\S]{0,60}releaseEditor\(\)/.test(resubjs), true);
/* Once it is open there is nothing to press: the form is on the card, with
   the reason above it and the way to send it again below it. A button that
   opens what is already open is a button for its own sake. */
check('and once open it is there, not behind a button',
  /if \(!open && mine\) bar\.appendChild\(button\('Open and fix'/.test(resubjs) &&
  !/Close the editor|Edit the \$\{/.test(resubjs), true);

check('but never over somebody else’s unsaved work',
  /if \(fixingId\(\)\) return false/.test(resubjs) &&
  /profileDirty\) return false/.test(resubjs) &&
  /here !== String\(sub\.consultant/.test(resubjs), true);
check('and the status table resubmits the same way',
  /fixingId\(\) === sub\.id/.test(approvals), true);

/* -----------------------------------------------------------------------
   The PA's two pages. Their part is a signature on paper: the time sheet
   goes out to be signed and comes back as a scan. So they get Download and
   Upload, not the status table — and a scan uploaded again replaces the one
   before it, for everybody.
   ----------------------------------------------------------------------- */
console.log('\nThe PA: download, then upload');

const signingjs = fs.readFileSync(path.join(ROOT, 'assets/js/signing.js'), 'utf8');
const previewjs = fs.readFileSync(path.join(ROOT, 'assets/js/preview.js'), 'utf8');
check('both pages are in the page',
  /id="p-todownload"/.test(html) && /id="p-toupload"/.test(html), true);
check('and the PA sees those two, their own run, and Status',
  /if \(Auth\.places\(\)\) return all\.filter\(s => s\.signs \|\| s\.id === 'approvals'\)/.test(appjs), true);
check('Download lists what is waiting for the HOD’s signature',
  /s\.status === SIGNING_STATUS && kindOf\(s\) === 'claim'/.test(signingjs), true);
/* Putting a scan on a card is not sending it. It can be looked at and taken
   off again; one Submit at the bottom is what closes the months and hands
   them to whoever collects the paper. */
check('a scan put on a card is held, not sent',
  /const attached = new Map\(\)/.test(signingjs) &&
  /attached\.set\(key, picked\)/.test(signingjs) &&
  /const key = target && target\.key/.test(signingjs), true);
/* And a payment advice takes one whether or not it was ever written. It did
   not have to be — it is the invoice's own figures, and Download prints it
   from there — so the approved invoice stands in for it on this page too,
   and the advice is written from that invoice when the scan is submitted.
   Without this a signed advice had nowhere to go until somebody opened the
   editor and saved a form they had nothing to change on. */
check('an advice nobody wrote still takes its signed copy',
  /function uploadTarget[\s\S]{0,400}kind === 'advice' && adviceUnlocked\(row\.invoice\)/
    .test(signingjs) &&
  /key: 'advice:' \+ row\.invoice\.id, standIn: true/.test(signingjs) &&
  /r\.invoice = monthInvoice\(r\.consultant/.test(signingjs), true);
check('and it is written from the invoice as it is filed',
  /if \(job\.standIn\) \{[\s\S]{0,320}Sync\.submit\(drawn, 'Payment advice for '/
    .test(signingjs) &&
  /const kind = job\.standIn \? 'advice' : kindOf\(sub\)/.test(signingjs) &&
  /attached\.delete\(job\.key\)/.test(signingjs), true);
check('and the line says where it will come from',
  /written from the invoice when you submit/.test(signingjs), true);
check('and can be read before it goes',
  /openFilePreview\(`\$\{row\.consultant/.test(signingjs) &&
  /function openFilePreview/.test(previewjs), true);
check('the copy already on file can be read too',
  /async function viewFiled/.test(signingjs), true);
/* Saving is not closing, and they were one button. A scan is safe on the
   record the moment somebody has it — holding a month's worth in this
   browser until the last person's arrives is how an afternoon is lost to a
   reload — but a month that is closed has been handed on. So Save files what
   is there and leaves the months open. */
check('Save files what has arrived and leaves the months open',
  /host\.appendChild\(submitBar\(waiting\)\)/.test(signingjs) &&
  /button\('Save', 'ghost', \(\) => saveSigned\(keep\)\)/.test(signingjs) &&
  /async function saveSigned/.test(signingjs) &&
  /async function fileSignedCopy[\s\S]{0,1400}await Sync\.store\(/.test(signingjs) &&
  (signingjs.match(/Sync\.act\(/g) || []).length === 1, true);
/* And Submit is not offered until nothing on the page is still waiting for
   a copy — chosen or already filed, every document that can have one has
   one. Green is the answer to "is this ready?" before the words are read. */
check('and Submit is offered, in green, only when none are missing',
  /const ready = !missing && closing.length > 0/.test(signingjs) &&
  /function copiesMissing[\s\S]{0,700}if \(attached\.has\(t\.key\)\) return/.test(signingjs) &&
  /button\('Submit and close the month', ready \? 'go' : ''/.test(signingjs) &&
  /go\.disabled = !ready/.test(signingjs) &&
  /\.btn\.go\{background:var\(--ok\)/.test(css), true);
check('and it closes the months saved on earlier days with them',
  /function closableSubs[\s\S]{0,460}if \(filed\) subs\.push\(t\.sub\)/.test(signingjs) &&
  /const already = closableSubs\(rows \|\| uploadRows\(\)\)/.test(signingjs), true);
/* The button says the name the office uses; the sentence above it says the
   whole name, for whoever does not know who that is. */
/* A button that is a drawing must be drawn, not typed. Whichever font the
   machine has decides what an emoji looks like, and on one of them the
   download arrow came out as a question mark. */
check('the view and download buttons are drawn, not typed',
  /function icon \(name\)/.test(approvals) &&
  /createElementNS/.test(approvals) &&
  !/\u\{1F441\}/.test(archivejs), true);
check('and each still carries the word for it',
  /b\.setAttribute\('aria-label', label\)/.test(approvals), true);
/* Nobody who cannot prepare a claim has a profile to pick or saved data of
   their own to erase, so neither control is drawn for them. */
/* A consultant has one set of details — the one the office assigned them —
   so the picker, and the way to start another, are the administrator's. */
check("the profile picker is the administrator's",
  /if \(box\) box\.hidden = !Auth\.isAdmin\(\)/.test(appjs) &&
  /if \(reset\) reset\.hidden = !canPrepare/.test(appjs), true);
check('and so is starting a new set of details',
  /if \(!Auth\.isAdmin\(\)\) return;[\s\S]{0,260}Add new profile/.test(appjs) &&
  /if \(Auth\.isAdmin\(\)\) \{[\s\S]{0,200}\+ New profile/.test(appjs), true);
/* A list of what has arrived answers half the question. Whoever collects
   the paper is chasing what has not, and somebody who has handed in nothing
   is invisible in a table built only from what was handed in. */
check('the collect table lists everybody, not only those who filed',
  /function collectorRoster/.test(archivejs) &&
  /\(roster \|\| \[\]\)\.forEach\(name => people\.set\(name, \[\]\)\)/.test(archivejs), true);
/* An invoice carries one signature, the consultant's own, and nobody
   approving a bill adds to it. Whether to print the one signature it is
   supposed to have is not a decision worth putting on a form. */
check('the invoice prints the consultant signature without being asked',
  !/showSig/.test(html + statejs + geninvoice), true);
check('and the note when an amount is typed over sits beside the amount',
  /id="amountOverride"[\s\S]{0,40}<\/p>/.test(html) &&
  /doc-underbar[\s\S]{0,400}id="amountOverride"/.test(html), true);
/* "Not connected" is true of an expired session, an account BDOS will not
   let into the claim system, missing routes and a dead network, and useful
   about none of them. The status code already knows which. */
check('the offline note says why, not just that',
  /function whyNot/.test(syncjs) &&
  /code === 401/.test(syncjs) && /code === 403/.test(syncjs) &&
  /code === 404/.test(syncjs), true);
check('and the screens show that reason',
  /syncProblem \? syncProblem/.test(syncjs), true);
/* The toolbar over the collect table sits on one baseline: two buttons and
   three pickers at the same height, each word left-aligned over its own
   control rather than centred over a box of a different width. */
check('the collect toolbar is a row of its own, not a button row',
  /<div class="archivebar">/.test(html) &&
  /\.archivebar\{[^}]*align-items:flex-end/.test(css), true);
check('and every control in it is the same height',
  /\.archivebar \.btn\{[^}]*height:38px/.test(css) &&
  /\.archivefilter select\{[^}]*height:38px/.test(css), true);
check('with each word left-aligned over its own picker',
  /\.archivefilter\{[^}]*align-items:flex-start/.test(css), true);
/* The collect list is the finished copies and nothing else, so the picker
   that offered to widen it offered a choice nobody made. */
check('the collect list is finished copies, with no filter for it',
  !/historyStage/.test(html + archivejs) &&
  /stageOf\(r\) === ARCHIVE_FINAL\)/.test(archivejs), true);
check('and the Who picker offers everybody, not only those who filed',
  /const names = filingNames\(\)/.test(archivejs), true);
/* Download all handed the browser one file at a time and the browser asked
   whether it could save several. Say no by accident and half a year of
   signed claims goes nowhere. */
check('Download all builds one archive',
  /saveAs\(zipFiles\(files\), archiveZipName\(rows\)\)/.test(archivejs) &&
  /function zipFiles/.test(fs.readFileSync(path.join(ROOT, 'assets/js/zip.js'), 'utf8')),
  true);
/* Status is not something you do after Submit — it is where you go to see
   where Submit got to. Numbering it made a question look like a stage and
   made the run look longer than the work. */
check('Status and History are places to look, not steps',
  /id: 'approvals',\s+label: 'Status', view: true/.test(appjs) &&
  /id: 'history',[^}]*view: true/.test(appjs), true);
check('so the bar keeps them apart from the numbered run',
  /className = 'stepgroup'/.test(appjs) && /className = 'stepviews'/.test(appjs) &&
  /\.stepgroup \.step:not\(:last-child\)::after/.test(css), true);
check('and the counter counts the work, not the bar',
  /list\.filter\(s => !s\.view\)\.length/.test(appjs), true);
check('the amount is worked out without a second box for the rate',
  !/calcFormula|wrapMonthly/.test(html + appjs), true);
/* The table is small enough to read whole, and a filter that hides most of
   it is one more thing to remember having left on. What is waiting is said
   in words beside the month, and the lights say it row by row. */
check('the status table has no waiting-on-me filter',
  !/onlyMine|statustoggle/.test(approvals + css + html), true);
check('and it still says what is waiting, in words',
  /Nothing is waiting on you\./.test(approvals), true);
/* Download and Upload are the job in front; this is the job behind. A
   signed sheet is a month's evidence, and the question asked about a closed
   month is how many days of it were not worked — which is inside the form
   the copy was filed against, not in anybody's note of it. */
check('the PA has a record of what went through',
  /id="p-filed"/.test(html) && /id: 'filed',[^}]*view: true/.test(appjs), true);
check('it is a table, with the leave read off the sheet',
  /function filedTable/.test(signingjs) &&
  /monthLeaveCounts\(state\.timesheet\)/.test(signingjs), true);
check('and the lookup is bounded, like every other one',
  /want\.slice\(0, KIND_LOOKUP_MAX\)/.test(signingjs), true);
check('each row can be read and taken away',
  /function viewStored/.test(signingjs) && /function saveStored/.test(signingjs), true);
/* Signing is one act wherever it happens, so it is one control. An approver
   was given a bare canvas and an image picker that could not read a PDF and
   kept a whole photographed page as a signature. */
check('the approval panel signs with the Profile control',
  /mountSignaturePicker\(padHost/.test(approvals) && !/function makePad/.test(approvals), true);
check('and Profile is that same control, keeping its value in the form',
  /function mountProfileSignature[\s\S]{0,80}return mountSignaturePicker\(/.test(sigjs), true);
check('a scan still goes through the box over the ink before it is kept',
  /buildCropper\(crop, canvas,\s*url => \{ store\.set\(url\)/.test(sigjs), true);
check('and the older way of calling the cropper still writes the form',
  /typeof target === 'function'[\s\S]{0,80}target\.sig\.personnel = url/.test(sigjs), true);
/* One month, one copy. Uploading again replaces what is on file rather than
   adding beside it, and once a month has gone to Group People & Finance it
   is confirmed and lives in History, not in the Upload queue. */
check('submitting takes the replaced copy off the record',
  /async function dropSuperseded/.test(signingjs) && /Sync\.unstore\(r\.id\)/.test(signingjs) &&
  /unstore: unstoreSigned/.test(syncjs), true);
check('and only a copy this account may remove',
  /!Auth\.isAdmin\(\) && String\(r\.created_by \|\| ''\)\.toLowerCase\(\) !== mine/.test(signingjs), true);
check('a combined record is never taken, since it covers the invoice too',
  /r\.kind === want && stageOf\(r\) === ARCHIVE_FINAL/.test(signingjs) &&
  /const want = kind \|\| 'claim'/.test(signingjs), true);
check("the PA's record of confirmed months is called History",
  /labelFor: \(\) => \(Auth\.keepsRecords\(\) \? 'Filed' : 'History'\)/.test(appjs) &&
  /label\.textContent = stepLabel\(s\)/.test(appjs), true);
/* Chrome's PDF viewer measures its frame when src is set. Set inside a dialog
   that was still display:none, it measured nothing, and fit to width opened a
   signed scan at 7840% — a blank page. */
check('the preview is shown before the document is loaded into it',
  /box\.hidden = false;[\s\S]{0,120}requestAnimationFrame[\s\S]{0,300}frame\.src = url/.test(
    fs.readFileSync(path.join(ROOT, 'assets/js/preview.js'), 'utf8')), true);
/* Fatin and Jiha look at the same months from either end of one step, so the
   PA's Download and Upload pages are the same table the collect list is. */
check("the PA's pages are tables, like the collect list",
  /signingMonthTables\(host, rows, \['Document', 'Status'\]/.test(signingjs) &&
  /signingMonthTables\(host, waiting, \['Document', 'Status', 'Signed copy'\]/.test(signingjs) &&
  /table\.className = 'history-table signingtable'/.test(signingjs), true);
/* A month is two documents on both of those pages, and the name belongs to
   the person rather than to each of them: repeated under itself it reads as
   two people, which is what somebody scanning a column of names counts. */
check('each person is one name and two document lines',
  /lines: \(name, sub, month\) => \[/.test(signingjs) &&
  /lines: \(name, row, month\) => \{/.test(signingjs) &&
  /person\.textContent = n \? '' : name/.test(signingjs), true);
/* Her own signature, before anything else: it goes in the Prepared by box
   of every advice she writes, and a form prepared before it exists prints
   that box with a name and no signature. */
/* And it is shown on the form where it will print, not only promised: the
   box she is looking at is the box the HOD will be handed. */
check('her signature is drawn in the Prepared by box',
  /\{ title: 'Prepared by :', name: 'preparedName', date: 'preparedDate', sig: ink\.pa \}/
    .test(signingjs) &&
  /mark\.className = 'adv-sig'/.test(signingjs) &&
  /\.doc-advice \.adv-sig\{/.test(css), true);
check("the PA puts her own signature on first",
  /\{ id: 'mysign'/.test(appjs) && /id="p-mysign"/.test(html) &&
  /function renderMySignature[\s\S]{0,240}mountSignaturePicker/.test(signingjs) &&
  /if \(Auth\.places\(\) && myLastSignature\(\)\) state\.sig\.pa = myLastSignature\(\)/
    .test(signingjs), true);
/* Hers, and only hers. Every approver's own signature is remembered on this
   machine under one key — it is how the project manager signs a time sheet
   without redrawing it every month — so an advice read from the status table
   drew whoever was looking into the PA's Prepared by box. */
check('and nobody else’s is borrowed for that box',
  /Only hers: the signature remembered on this machine/.test(signingjs), true);
/* And that table can read one at all now. An advice nobody wrote is the
   invoice's own figures, so the approved invoice stands in for it there
   exactly as it does on the PA's pages, and it opens in the same viewer —
   an approver checking what they approved does not download it first. */
/* One person, one row. The status table, the PA's pages and History all
   listed a profile under its card name, and its documents under the Full
   name on its form — so anybody whose two spellings differed was two
   people, one of them with nothing sent. They list the form's name now. */
check('a person is listed under the name their documents carry',
  /names\.add\(profileFiledName\(n, all\[n\]\)\)/.test(approvals) &&
  /const who = profileFiledName\(n, all\[n\]\)/.test(archivejs) &&
  /function profileFiledName/.test(statejs), true);
/* And the slip detector knows them by both. Asked by card name alone, that
   person had "no profile" under the name on their documents, and a near
   spelling anywhere else would have offered to take their real documents
   off the record. */
check('and is known by either of their two names',
  /function profileUnder[\s\S]{0,120}return !!profileKeyFor\(name\)/.test(signingjs) &&
  /const key = profileKeyFor\(name\) \|\| name;\s*Store\.deleteProfile\(key\)/.test(signingjs), true);
check('an approver can read an advice nobody has written',
  /const paid = kind === 'advice' && typeof previewAdviceFor === 'function'/.test(approvals) &&
  /button\('Preview', 'ghost small', \(\) => previewAdviceFor\(paid, null, look\)\)/
    .test(approvals) &&
  /paid && paid\.status === 'complete'/.test(approvals), true);
/* Everybody with a profile has a line, the way the collect list does, so
   the PA sees who has not sent anything as well as what is waiting. */
check("the PA's tables list everybody with a profile",
  /function signingRoster/.test(signingjs) &&
  (signingjs.match(/roster: signingRoster\(\)/g) || []).length === 3, true);
/* The payment advice is the third of those tables. It is the office's form,
   so a person with no invoice yet is shown locked rather than left out: the
   page answers "who is left?" as well as "what can I do?". */
check('the payment advice is a table of everybody, like the other two',
  /signingMonthTables\(host, rows, \['Status', 'Payment Advice'\]/.test(signingjs) &&
  /missing: \(\) => \[statusBadge\('Invoice not submitted'\), adviceLockedCell\(\)\]/
    .test(signingjs), true);
/* An invoice sent back is going to change, and its figures are the only
   figures the advice has, so that row locks again rather than paying a
   disputed bill. */
check('an invoice is paid only once the HOD has approved it',
  /function adviceUnlocked[\s\S]{0,420}invoice\.status === 'complete'/.test(signingjs) &&
  !/It goes to the project manager, then the HOD, then back here/.test(signingjs), true);
/* And from that moment it is ready, whether or not anybody opened it: the
   form is the invoice's own figures, so there is nothing to write. The row
   offers Preview and Edit; the Download step draws it from the invoice when
   nothing was saved, and saving replaces the form rather than making a
   second advice. */
check('the advice is ready without being written',
  /if \(adviceUnlocked\(sub\) && \(!advice \|\| advice\.status === SIGNING_STATUS\)\)/.test(signingjs) &&
  /button\('Preview'[\s\S]{0,120}button\('Edit'/.test(signingjs) &&
  /id="adviceEditorSend">Save</.test(html), true);
check('and drawn from the invoice wherever it is asked for',
  /async function adviceStateFor/.test(signingjs) &&
  /const paidInvoice = kind === 'advice' && !advice/.test(signingjs) &&
  /if \(!sub && kind === 'advice'\)/.test(signingjs) &&
  /await Sync\.updateData\(adviceOpen\.advice\.id, state\)/.test(signingjs) &&
  /updateData: updateSubmissionData/.test(syncjs), true);
/* The Download step's View on the advice line opened the invoice, and
   offered it before the HOD had approved anything. It shows the advice,
   and only once there is one. */
check("the Download step's advice View shows the advice, not the invoice",
  /advice \|\| \(ready \? paidInvoice : null\)/.test(signingjs) &&
  /kind === 'advice'\s*\? previewAdviceFor\(/.test(signingjs) &&
  !/reviewSubmission\(target\.id\)|reviewSubmission\(ready\.id\)/.test(signingjs), true);
check('and every sent invoice is on the table, saying where it has got',
  /function invoicesSubmitted[\s\S]{0,200}kindOf\(s\) === 'invoice'/.test(signingjs) &&
  !/function invoicesApproved/.test(signingjs), true);
/* Nothing on the form may be retyped: it is the invoice's own figures or it
   is nothing, so the panel offers only the boxes the claim knows nothing
   about, and shows the rest as facts. */
/* The allowance was a constant, so everybody was on twelve days whatever
   they had actually agreed. It is the person's terms, so it lives with the
   profile — and only the administrator, who sets the other terms, may
   change it. */
const tsjs = fs.readFileSync(path.join(ROOT, 'assets/js/timesheet.js'), 'utf8');
/* A dash is how the paper sheet writes a day that is nobody's — a weekend,
   mostly. It prints, and it says the day was looked at; it does not change
   what the day is worth: a dashed Saturday is still the paid weekend. */
/* One dash on the grid, not two. The blank placeholder was an en dash, a
   different character from the one somebody puts on a day on purpose and
   all but identical on screen — two marks that looked alike and meant
   opposite things, one warned about and one not. */
check('an unmarked day shows nothing, so the only dash is the one somebody put there',
  /button\.textContent = manual \|\| shown \|\| '';/.test(tsjs) &&
  !/–/.test(tsjs), true);
check('a day can be dashed, as the paper sheet does',
  /const CYCLE = \['', '\/', 'PH', 'PTO', 'MC', 'UL', '-'\]/.test(tsjs) &&
  /not a working day/.test(html), true);
check('and a dash is no mark for pay, so a dashed weekend stays paid',
  /act\.days\[d\] !== DASH\) return act\.days\[d\]/.test(statejs) &&
  /dayMarkOf\(ts, d\) === '' && !dashedDay\(ts, d\)/.test(statejs), true);
/* A date belongs to a signature. The project manager's and the HOD's boxes
   were dated today from the moment the consultant opened the form, which
   said those two had signed on a day neither had seen it; each is written
   now when its own signature is placed. */
check('a signing date is written when the signature is',
  /const APP_DATES = \{ 'timesheet\.prepDate': 'prep' \};/.test(appjs) &&
  /const want = APP_DATES\[path\] \? today : '';/.test(appjs) &&
  /data\.timesheet\[signs\.date\] = todayDotted\(\);/.test(approvals), true);
check('the leave allowance is read from the profile, not from a constant',
  /function leaveAllowance/.test(statejs) &&
  /const limit = leaveAllowance\(S, mark\)/.test(statejs) &&
  !/const limit = LEAVE_LIMITS\[mark\]/.test(statejs), true);
check('twelve days is still what everybody is on until it is changed',
  /allowance: \{ pto: LEAVE_LIMITS\.PTO, mc: LEAVE_LIMITS\.MC \}/.test(statejs) &&
  /\? n : LEAVE_LIMITS\[mark\]/.test(statejs), true);
check('unpaid leave is never capped, whatever is stored against it',
  /if \(typeof LEAVE_LIMITS\[mark\] !== 'number'\) return null;/.test(statejs) &&
  /if \(leaveAllowance\(S, mark\) === null\) return true;/.test(statejs), true);
/* The other figure on that card nobody can work out from the sheet: days
   taken before this app was counting — a month never submitted here, or
   before the person's first claim. Without it a balance is wrong for
   anybody who did not start in January. */
check('the administrator can also set what was taken before this app',
  /function leaveOpening/.test(statejs) &&
  /const y = year != null \? Number\(year\) : Number\(\(S\.timesheet \|\| \{\}\)\.year\);\s*if \(!o \|\| Number\(o\.year\) !== y\) return 0;/.test(statejs) &&
  /return n \+ opening;/.test(statejs) &&
  /Already taken in \$\{S\.timesheet\.year\}, before this app:/.test(tsjs), true);
/* A card is asked where a person stands, and answered it from whichever
   grid was last left in that browser's copy of the profile: September sent
   from the consultant's own laptop was not in it, and a day marked on a
   draft that never went was. It reads the record now — the sent sheets —
   and every browser brings its copies up to date from them. */
check('a profile card is the balance on record, not the grid left open',
  /LEAVE_KINDS\.map\(mark => leaveOnRecord\(p, mark, year\)\)/.test(appjs) &&
  !/leaveStandings\(p\)/.test(appjs) &&
  /async function reconcileLeave/.test(appjs) &&
  /reconcileLeave\(\)\.then\(changed =>/.test(appjs), true);
check('and it says which months the days came from',
  /const where = L\.from\.map/.test(appjs), true);
check('and it is said apart from what the submitted months come to',
  /carriedLeave\(S, mark\) - leaveOpening\(S, mark\)/.test(tsjs) &&
  /Set by the administrator as taken earlier: /.test(tsjs), true);
check('only the administrator sees the boxes that set it',
  /function mountLeaveAllowance/.test(tsjs) &&
  /!Auth\.setsNumbering\(\)\) return;/.test(tsjs), true);
/* A half-typed "1" of "18" would otherwise cut the allowance to one day and
   repaint the card under the cursor. */
check('the allowance is taken on change, not on every keystroke',
  /input\.addEventListener\('change'/.test(tsjs) &&
  !/input\.addEventListener\('input'[\s\S]{0,200}allowance/.test(tsjs), true);

/* The position was a column in the item table, identical on every line. It
   is the person's, so it is said once with the rest of who the invoice is
   from. */
const invjs = geninvoice;
check('the invoice says the position under the IC number',
  /\['IC No\.:', C\.ic\],\s*\n\s*\['Position:', C\.position\]/.test(invjs) &&
  /\['IC No\.:', C\.ic\], \['Position:', C\.position\]/.test(invjs), true);
check('and no longer as a column on every line',
  !/'#', 'Description', 'Position'/.test(invjs) &&
  !/it\.position/.test(invjs) &&
  !/data-f="position"/.test(appjs), true);
check('the editable invoice moved it too',
  /dlabel">Position:<[\s\S]{0,120}data-bind="consultant\.position"/.test(html) &&
  !/<th style="width:20%">Position<\/th>/.test(html), true);

/* It is filled in on the form itself, the way the claim and the invoice are,
   and in a page of its own rather than a panel under the table. */
check('the advice opens as a page, drawn as the sheet it is',
  /function openAdviceEditor/.test(signingjs) &&
  /function adviceFormDoc/.test(signingjs) &&
  /id="adviceEditor"/.test(html) &&
  /doc\.className = 'doc doc-advice'/.test(signingjs), true);
/* Every box on it takes a cursor. The invoice's own figures are what it
   opens with, so an advice nobody edited still agrees with the invoice it
   pays — but this is the office's sheet, the office answers for what it
   says, and a form that cannot be corrected is a form somebody retypes in
   Excel. Nothing on it is shown as text that cannot be reached. */
check('every box on it is typed into',
  !/function advFixed/.test(signingjs) &&
  /advInput\(F\.vendor/.test(signingjs) && /advArea\(F\.address/.test(signingjs) &&
  /advInput\(row\.no/.test(signingjs) && /advDate\(row\.received/.test(signingjs) &&
  /advCash\(row\.amount/.test(signingjs) && /advInput\(F\[col\.name\]/.test(signingjs) &&
  /advInput\(a\.terms/.test(signingjs) && /advInput\(a\.withholding/.test(signingjs), true);
/* Two of them the system already knows. The rest stay blank: a payment term
   nobody agreed, printed as though somebody had, is not a time-saver. */
/* And nothing else is guessed at. Staff/Consultant and Account Manager are
   the office's to answer; a name printed there because it was the nearest
   one the system held is a name nobody put there. */
check('nothing on it is guessed',
  !/adviceFromProfile/.test(signingjs) &&
  !/a\.staff = /.test(signingjs) && !/a\.manager = /.test(signingjs), true);
/* And it is read in the viewer every other document here is read in, over
   the table it was asked for from. A tab of its own put the sheet somewhere
   the app could not close again, and a pop-up blocker put it nowhere at all;
   the viewer carries Open in new tab on its own bar for anybody who wants
   one. The editor has no preview of its own: the sheet on screen is the
   sheet that prints. */
check('the preview opens in the viewer, not a tab',
  /async function previewAdviceFor[\s\S]{0,420}openFilePreview\('Payment Advice/
    .test(signingjs) &&
  !/window\.open/.test(signingjs) &&
  !/adviceEditorPreview/.test(html) && !/adviceEditorPreview/.test(appjs), true);
/* The office's own PDF is US Letter set in Calibri, with the content
   running 21.34mm to 194.01mm. Drawn on A4 in Helvetica, every row landed
   a few millimetres from where the paper expects it; these are the numbers
   read off that PDF, and the form is drawn to them. */
const genadvice = fs.readFileSync(path.join(ROOT, 'assets/js/gen-advice.js'), 'utf8');
const logojs = fs.readFileSync(path.join(ROOT, 'assets/js/logo.js'), 'utf8');
check('the payment advice is drawn on Letter, in Calibri metrics',
  /format: 'letter'/.test(genadvice) && /addCarlito\(doc\)/.test(genadvice) &&
  /const ADV_FONT = 'Carlito'/.test(genadvice), true);
check('to the geometry measured off the office’s own sheet',
  /L: 21\.34, R: 194\.01/.test(genadvice) &&
  /docCols: \[45\.68, 50\.29, 77\.89, 111\.00, 139\.07, 166\.41, 194\.01\]/.test(genadvice) &&
  /bands: \{ primary: 31\.50, other: 122\.22, approval: 193\.93, finance: 243\.21 \}/
    .test(genadvice), true);
/* A changed mark stayed the old mark: the images carried no cache key, so
   the browser kept its copy for four hours and Cloudflare, in front of the
   server, for as long as it liked. They carry the script's own key now. */
check('the artwork is fetched under the app’s cache key',
  /const LOGO_KEY = /.test(logojs) && /img\.src = withKey\(src\)/.test(logojs) &&
  /document\.currentScript\.src/.test(logojs), true);
check('with the mark its template prints, not the claim form’s wordmark',
  /loadLogo\('uzmaAdvice'\)/.test(genadvice) &&
  /uzmaAdvice: \['assets\/img\/logo-uzma-advice\.png'\]/.test(logojs) &&
  fs.existsSync(path.join(ROOT, 'assets/img/logo-uzma-advice.png')), true);
check('the dialog can be closed, and hides when it is',
  /function closeAdviceEditor/.test(signingjs) &&
  /\.editdlg\[hidden\]\{display:none\}/.test(css), true);
check('somebody with no time sheet that month reads Not submitted',
  /if \(!sub\) return 'Not submitted'/.test(signingjs), true);
check('but a claim still with the project manager or the HOD is not called that',
  /STATUS_TEXT\[sub\.status\]/.test(signingjs), true);
check('and the cards they replaced are gone',
  !/archrow signcard|function monthGroups|function uploadCard/.test(signingjs), true);
check('and an icon with its word keeps its icon while it downloads',
  /if \(!drawn\) btn\.textContent = 'Preparing…'/.test(signingjs), true);
/* A signed copy is what anybody will be asked for a year from now, so taking
   one off the record is the administrator's alone — and it exists for the
   copies that were never part of the process. */
check('a filed copy can be taken off the record',
  /async function deleteStored/.test(archivejs) && /Sync\.unstore\(r\.id\)/.test(archivejs), true);
check('by the administrator and nobody else',
  (archivejs.match(/if \(Auth\.isAdmin\(\)\)/g) || []).length >= 2, true);
check('and it names what is going before it goes',
  /Delete the \$\{what\} on file for \$\{when\}/.test(archivejs), true);
/* The claim ends with the PA. Submitting is the last step: it files the
   signed copy, closes the month, and hands it to nobody. */
/* Finance is where the e-mail goes, not a role in the app: no account, no
   approval stage. The month is closed here and mailed afterwards. */
check('submitting closes the month rather than passing it on',
  /'Submit and close the month'/.test(signingjs) &&
  !/finance/.test(authjs) && !/pending_finance|'finance'/.test(signingjs), true);
check('and it files the scan before it closes the month',
  /remember\(await fileSignedCopy\(jobs\[i\], by\)\)[\s\S]{0,420}if \(sub\.status === SIGNING_STATUS\) await Sync\.act\(sub\.id, 'approve'/
    .test(signingjs), true);
/* The month is closed by the HOD's approval, not by the scan arriving. A
   scan can arrive late, or be replaced by a better one, so a closed document
   still has a box for it; what is gone is the old card that re-offered the
   whole month for approval. */
check('and is still printable from the Download page',
  /const printable = s => !!s && \(s\.status === SIGNING_STATUS \|\| s\.status === 'complete'\)/
    .test(signingjs), true);
check('a closed document still takes its signed copy',
  !/uploadCard\(/.test(signingjs) &&
  /function uploadRows[\s\S]{0,900}waitingSignature\(\)\.forEach/.test(signingjs) &&
  /s\.status === 'complete' &&[\s\S]{0,120}Number\(s\.period_month\) === m/.test(signingjs) &&
  /function copiesOwed/.test(signingjs), true);
check('and the newest copy is the one everybody reads',
  /sort\(newestFirst\)\[0\]/.test(archivejs) &&
  /latestCopies\(archive\)/.test(archivejs), true);
check('the first paint waits for the database rather than calling it absent',
  /get connecting \(\)/.test(syncjs) && /if \(!r\.adopted\) showStep\(\)/.test(appjs), true);

/* -----------------------------------------------------------------------
   The PA places the HOD's signature, and an invoice has no HOD signature on
   it — so an invoice has nothing for them to do and should never reach
   them. Routing it there anyway was a bill sitting in somebody's queue for
   ever, waiting on a thing that does not exist.
   ----------------------------------------------------------------------- */
console.log('\nWhat the PA actually signs');

/* -----------------------------------------------------------------------
   The Payment Advice. Uzma's own form for paying an approved invoice:
   prepared by the PA, approved by the project manager and the HOD, signed
   by the PA in both boxes, and never seen by the consultant.
   ----------------------------------------------------------------------- */
console.log('\nThe Payment Advice');

check('the form is drawn to the template it copies',
  /function buildAdvicePDF/.test(genadvice) &&
  /UZMA-FA01-IMS-OS01 \(F01\)/.test(genadvice), true);
/* What is typed stands in for what the claim would have said, box by box,
   so a figure typed over is the figure that prints. */
check('and what was typed is what prints',
  /function advPick[\s\S]{0,140}value === undefined \|\| value === null \? fallback : value/
    .test(genadvice) &&
  /vendor: advPick\(a\.vendor/.test(genadvice) &&
  /dept: advPick\(a\.dept, ADV_DEPT\)/.test(genadvice) &&
  /F\.rows\.forEach/.test(genadvice), true);
/* TOTAL is the exception, because it is not a box: it is what the five
   document lines come to, and it follows them as they are typed. */
check('except the total, which is added up',
  /function adviceTotal[\s\S]{0,160}reduce/.test(genadvice) &&
  /totalBox\.textContent = 'RM' \+ money\(sum\)/.test(signingjs), true);
check('and nothing on it has to be retyped',
  /no:          advPick\(r\.no,          first \? \(S\.invoice\.no \|\| ''\) : ''\)/
    .test(genadvice) &&
  /amount:      advPick\(r\.amount,      first \? adviceAmount\(S\) : ''\)/.test(genadvice) &&
  /Payment for Consultancy Service Fee- \$\{adviceMonth\(S\)\}/.test(genadvice), true);
check('it is a document a month can carry',
  /advice:  \{ label: 'Payment Advice'/.test(statejs), true);
check('the office sees it and the consultant does not',
  /const seesOfficeDocuments = r => !!r && r !== 'consultant'/.test(authjs) &&
  /Auth\.seesOfficeDocuments\(\) \? KIND_ORDER\.concat\('advice'\)/.test(approvals), true);
check('the PA prepares it from the approved invoice',
  /async function prepareAdvice/.test(signingjs) &&
  /Sync\.submit\(state, 'Payment advice for '/.test(signingjs), true);
/* The HOD signs it on paper, the way he signs a time sheet, so the last
   thing that happens to an advice happens on the Upload step: the signed
   scan is filed and the month closes. Writing it and filing it are separate
   steps because they are separate days. */
check('the HOD signs it on paper and the PA files the scan',
  !/async function signAdvice/.test(signingjs) &&
  !/openAdviceSigning/.test(signingjs) &&
  /function waitingAdvice[\s\S]{0,200}kindOf\(s\) === 'advice'/.test(signingjs), true);
/* Every document on that step went out of this app first and is coming
   back signed, so it is called what it is. */
check('the upload step is called Re-Upload',
  /id: 'toupload',\s+label: 'Re-Upload'/.test(appjs) &&
  /<h2>Re-upload the signed copies<\/h2>/.test(html) &&
  !/<b>Upload<\/b>/.test(html), true);
check('and the two are separate steps, in the order the job happens',
  /\{ id: 'mysign'[\s\S]{0,140}\{ id: 'advice'[\s\S]{0,140}\{ id: 'todownload'[\s\S]{0,400}\{ id: 'toupload'/
    .test(appjs), true);
/* Three documents produced weeks apart is one folder to anybody who was
   asked for "September", so the administrator's record compiles one. */
check('the administrator compiles a month into one zip, everybody at once',
  /Compile month zip/.test(archivejs) &&
  /downloadEveryoneZip\(when, everyone\(\), control\)/.test(archivejs) &&
  /async function compileMonth/.test(signingjs) &&
  /name: folder \+ '\/' \+ f\.name/.test(signingjs) &&
  /async function filedCopy/.test(signingjs), true);
/* The month goes to Accounts Payable by e-mail. A browser cannot attach a
   file to a message it did not send, so the app does the two things it can:
   the zip to the downloads folder, and the mail client opened on a message
   already addressed and written — the office's own wording and addresses. */
/* One person typed twice, a letter apart, is two rows everywhere. Nothing can
   merge them — the documents carry the name they were filed under — but an
   empty one is a slip, and the administrator is offered to take it off. Only
   the administrator, only when nothing is filed under it, and never on the
   strength of an empty cache. */
/* The profile is the person. An empty profile beside a documented near-name
   is the slip; documents under a spelling with no profile, beside a name
   that has one, are the slip. The two point in opposite directions, and the
   button on the row does the one thing the case calls for — for the
   administrator and the PA, who keep the record. */
/* The signed paper never passes through the consultant's hands: they send
   the form, the approvers sign it, the PA files what comes back. */
check('only the PA files signed copies',
  /function canFileSigned \(\) \{[\s\S]{0,40}return Auth\.places\(\);/.test(archivejs), true);
/* And a consultant can read their own part of the record. The database
   hands them their own records and nobody else's, so the step is the same
   step; what differs is what comes back, and what can be done with it. */
check('a consultant can read their own history, and only read it',
  /reads: true/.test(appjs) &&
  /\(!s\.records \|\| Auth\.keepsRecords\(\) \|\| \(s\.reads && Auth\.prepares\(\)\)\)/.test(appjs) &&
  /const sends = typeof Auth !== 'undefined' && \(Auth\.keepsRecords\(\) \|\| Auth\.places\(\)\);/.test(archivejs) &&
  /if \(sends\) wrap\.appendChild\(bar\);/.test(archivejs) &&
  /Nobody else can be seen here/.test(archivejs), true);
check('a duplicate is pointed out to everybody, and the slip is the one without the person',
  /function duplicateCase/.test(signingjs) &&
  /if \(profileUnder\(name\) && here\.total === 0 && profileUnder\(other\) && filedUnder\(other\)\.total > 0\)/.test(signingjs) &&
  /if \(!profileUnder\(name\) && here\.total > 0 && profileUnder\(other\)\)/.test(signingjs) &&
  /Auth\.isAdmin\(\) \|\| Auth\.places\(\)/.test(signingjs) &&
  /Sync\.removeStrayName\(name\)/.test(signingjs) &&
  /removeStrayName: removeStrayName/.test(syncjs), true);
check('and never on the strength of an empty cache',
  /if \(!here\.known\) return null;/.test(signingjs) &&
  /const known = !!\(mine\.length \|\| theirs\.length\);/.test(signingjs), true);
check('the note is on the PA’s tables and the Status table alike',
  /const dup = duplicateProfileNote\(name, \(\) => \{/.test(signingjs) &&
  /duplicateProfileNote\(name, \(\) => renderApprovals\(\)\)/.test(approvals), true);
/* Re-Upload is the month's three documents. Two are scanned after the HOD
   signs them on paper; the invoice finishes in the app and has nothing to
   scan, so the approved one is simply there — and it never holds a month
   open, because there is nothing it could be waiting for. */
check('Re-Upload shows all three documents, the invoice added automatically',
  /return \[uploadLine\(found, 'claim'\), invoiceUploadLine\(found\), uploadLine\(found, 'advice'\)\]/
    .test(signingjs) &&
  /function invoiceUploadLine \(row\)/.test(signingjs) &&
  /'added automatically \\u2014 nothing to upload'/.test(signingjs) &&
  /the approved invoice is added automatically/.test(html), true);
check('and only the two scanned documents are counted as owed',
  /function copiesOwed \(rows\) \{[\s\S]{0,120}\['claim', 'advice'\]\.forEach/.test(signingjs) &&
  /function copiesMissing \(rows\) \{[\s\S]{0,120}\['claim', 'advice'\]\.forEach/.test(signingjs), true);
/* One file a document: uploading again is how a wrong scan is put right,
   and only the latest is kept. The page says so where the choice is made. */
check('uploading again replaces the file, and the page says so',
  /only the latest file is kept/.test(signingjs) &&
  /a new upload replaces it when saved/.test(signingjs) &&
  /const before = copiesOnFile\(sub, kind\);[\s\S]{0,300}await dropSuperseded\(before, kept\);/
    .test(signingjs), true);
/* A consultant files their bank statement for a paid month in History. It is
   a kind of its own at a stage of its own, so it never stands for a signed
   copy; the file box stays shut until the blacking-out is confirmed; and a
   server that stored it as anything else has it taken straight back. */
check('a bank statement is filed as its own kind, behind the redaction reminder',
  /kind:\s+'bank',\s*stage:\s+'statement'/.test(syncjs) &&
  /storeBank: storeBankStatement/.test(syncjs) &&
  /inp\.disabled = true;[\s\S]{0,400}tick\.addEventListener\('change', \(\) => \{ inp\.disabled = !tick\.checked; \}\)/
    .test(archivejs) &&
  /black out your balance, every other transaction/.test(archivejs) &&
  /if \(!rec \|\| rec\.kind !== BANK_KIND\) \{[\s\S]{0,120}Sync\.unstore\(rec\.id\)/.test(archivejs) &&
  /const mayFileBank = \(\) => typeof Auth !== 'undefined' && Auth\.prepares\(\);/.test(archivejs) &&
  /'Bank Statement'\]\.forEach/.test(archivejs) &&
  /filedDocument\('Bank Statement',/.test(signingjs), true);
/* History recorded a month as its signed time sheet alone, so a month that
   went to Finance as three documents read here as one. Each of the three is
   on the row now, with its own View and Download, and the month one zip. */
check('History shows the month’s three documents',
  /\['Month', 'Consultant', 'Leave that month', 'Documents'\]/.test(signingjs) &&
  /filedDocument\('Time sheet',/.test(signingjs) &&
  /filedDocument\('Invoice', \['approved invoice'/.test(signingjs) &&
  /filedDocument\('Payment Advice',\s*\['signed copy'/.test(signingjs) &&
  /archiveFor\(rec\.consultant, rec\.period_year, Number\(rec\.period_month\) - 1, 'advice'\)/
    .test(signingjs) &&
  /control => downloadMonthZip\(rec, control\)/.test(signingjs), true);
/* A copy on the record is the answer, so it comes first and looks finished.
   The file box sat on top of it, and a cell that opens with "Choose File"
   reads as a job not done. Replacing it is one click away, behind a button
   that says so. */
check('a filed copy reads as done, and replacing it is asked for',
  /if \(filed\) cell\.appendChild\(filedCard\(filed, row, kind\)\);/.test(signingjs) &&
  /pick\.hidden = true;\s*const swap = button\('Replace file', 'ghost small'/.test(signingjs) &&
  /function filedCard \(filed, row, kind\)/.test(signingjs) &&
  /card\.classList\.add\('signfiled'\)/.test(signingjs) &&
  /\.signfiled\{/.test(css), true);
/* The PA asked to read the invoice where she prints the other two: it is
   the bill the payment advice pays. Read whenever there is one, downloaded
   once the HOD has approved it, and drawn as an invoice, not as a sheet. */
check('the Download step has a line for the invoice',
  /downloadLine\(name, month, 'claim', sub, ready\),\s*downloadLine\(name, month, 'invoice', null, ready\),\s*downloadLine\(name, month, 'advice', null, ready\)/
    .test(signingjs) &&
  /if \(kind === 'invoice'\) \{\s*const inv = monthInvoice\(name, month\.y, month\.m\);/.test(signingjs) &&
  /labelledIcon\('view', 'View', `View the invoice for \$\{who\}`,\s*\(\) => reviewSubmission\(inv\.id\)\)/
    .test(signingjs), true);
check('and an invoice is drawn as an invoice',
  /if \(kind === 'invoice'\) \{\s*return \{ blob: \(await buildInvoicePDF\(state\)\)/.test(signingjs), true);
/* Download all saved one PDF after another, only the time sheets, and the
   browser asked whether the page could save several files. It is one zip
   now, of exactly what the page shows as ready. */
check('Download all is one zip of everything ready on the page',
  /const all = button\('Download all as zip', 'small', \(\) => downloadAllAsZip\(ready, all\)\)/
    .test(signingjs) &&
  /if \(collect\) collect\.push\(\{ sub: ready, kind: kind, name: name, month: month \}\)/.test(signingjs) &&
  /saveAs\(zipFiles\(files\), zipName\)/.test(signingjs) &&
  !/function downloadAllForSigning/.test(signingjs), true);
/* Sending the month was two buttons on the heading of a table in the
   record. Whoever files the signed copies had to know the last part of
   their job lived on a page about the past, so it is a step of its own at
   the end of the run it belongs to — the PA's, and the admin's after it. */
check('sending the month to Finance is a step of its own',
  /\{ id: 'tofinance',  label: 'Send to Finance', signs: true \}/.test(appjs) &&
  /id="p-tofinance"/.test(html) && /id="financeList"/.test(html) &&
  /if \(step\.id === 'tofinance'\) renderToFinance\(\)/.test(appjs) &&
  /\{ id: 'toupload',   label: 'Re-Upload', signs: true \},\s*\/\*[\s\S]{0,400}\{ id: 'tofinance'/.test(appjs),
  true);
/* It says what the zip will hold before it is built: the signed copy where
   one was filed, the drawn document where one was not, and by name what is
   missing — a month is never sent short without it being said. */
check('and says what the zip will hold before building it',
  /function financeState \(name, month, kind\)/.test(signingjs) &&
  /return \{ word: 'Signed copy', how: 'filed' \}/.test(signingjs) &&
  /return \{ word: 'From the app', how: 'drawn' \}/.test(signingjs) &&
  /return \{ word: 'Missing', how: 'none' \}/.test(signingjs) &&
  /still short a document/.test(signingjs), true);
check('the same two buttons do the work, and hold themselves while they run',
  /const zip = button\('Download zip', 'ghost', \(\) => downloadEveryoneZip\(when, names, zip\)\)/
    .test(signingjs) &&
  /const mail = button\('Email Finance', 'primary', \(\) => sendMonthToFinance\(when, names, mail\)\)/
    .test(signingjs), true);
check('and the addresses are on the page, not only inside the file',
  /'To ' \+ FINANCE_MAIL\.to\.join\(', '\) \+ ' · Cc ' \+ FINANCE_MAIL\.cc\.join\(', '\)/
    .test(signingjs) &&
  /adlishah\.sharilfudin@uzmagroup\.com/.test(signingjs), true);
check('the administrator sends a month to Finance',
  /Email Finance/.test(archivejs) && /sendMonthToFinance\(when, everyone\(\), control\)/.test(archivejs) &&
  /const FINANCE_MAIL = /.test(signingjs) && /adib\.azman@uzmagroup\.com/.test(signingjs) &&
  /function financeEml/.test(signingjs) && /'X-Unsent: 1'/.test(signingjs) &&
  /Content-Disposition: attachment; filename=/.test(signingjs) &&
  /type: 'message\/rfc822'/.test(signingjs), true);
check('and it prefers the signed copy over a redrawn one',
  /const filed = await filedCopy\(rec, kind\);[\s\S]{0,80}files\.push\(filed\)/
    .test(signingjs), true);
/* One name per person, not one per document: the rows under it are the same
   person's, and repeating the name three times reads as three people. */
check('the status table names each person once',
  /who' \+ \(first \? '' : ' cont'\)/.test(approvals), true);

/* The time sheet reaches the PA for the HOD's signature, and the payment
   advice reaches her for both his and her own. The invoice reaches nobody
   there: it carries one signature, the consultant's, already on it. */
check('an invoice has no signature stage',
  /const hasSignatureStage = sub => kindOf\(sub\) !== 'invoice'/.test(approvals), true);
check('so it never lands in the PA queue',
  /pending_signature' && !hasSignatureStage\(sub\)\) return Auth\.isAdmin\(\)/.test(approvals), true);
check('and the column says so rather than waiting for ever',
  /lampCell\('na'/.test(approvals), true);
check('nothing is asked of a signature that is not owed',
  /function mustSign/.test(approvals) &&
  !/signingStage\(sub\.status\)[\s\S]{0,40}const file/.test(approvals), true);

/* -----------------------------------------------------------------------
   Cache keys. GitHub Pages serves this page and everything it loads with
   max-age=600. A reload fetches the page again but keeps the old JavaScript
   for up to ten minutes, which is indistinguishable from a fix that did not
   work — so every local file carries a stamp that changes when it does.
   ----------------------------------------------------------------------- */
console.log('\nCache keys');

const localAssets = [...html.matchAll(/(?:src|href)="((?:assets|vendor)\/[^"]+)"/g)]
  .map(m => m[1]);
const unstamped = localAssets.filter(u => !/\?v=/.test(u));
check('every local file carries one', unstamped.length, 0);
check('and they all carry the same one',
  new Set(localAssets.map(u => u.split('?v=')[1])).size, 1);

console.log('\nScript order');

// the ?v= cache key is part of the URL, and not part of which file this is
const scripts = [...html.matchAll(/<script src="(assets\/js\/[^"?]+)/g)].map(m => m[1]);
const at = f => scripts.indexOf('assets/js/' + f);

check('every app script is loaded', scripts.length >= 8, true);
check('auth.js comes before app.js',    at('auth.js') < at('app.js'), true);
check('sync.js comes before app.js',    at('sync.js') < at('app.js'), true);
check('state.js comes before sync.js',  at('state.js') < at('sync.js'), true);
check('preview.js comes before app.js', at('preview.js') < at('app.js'), true);
check('the generators come before preview.js',
  at('gen-invoice.js') < at('preview.js') && at('gen-claim.js') < at('preview.js'), true);
// approvals.js rebuilds a submitted claim with the generator and shows it in
// the viewer, so both have to be parsed before it
check('approvals.js comes after the generator and the viewer',
  at('gen-claim.js') < at('approvals.js') && at('preview.js') < at('approvals.js'), true);
check('and before app.js, which calls into it', at('approvals.js') < at('app.js'), true);
// signing.js reads the status table's helpers and the archive's
// archive.js packs the archive with it
check('zip.js comes before archive.js', at('zip.js') < at('archive.js'), true);
check('signing.js comes after approvals.js and archive.js, before app.js',
  at('approvals.js') < at('signing.js') && at('archive.js') < at('signing.js') &&
  at('signing.js') < at('app.js'), true);
// holidays.js is read by the time sheet when it fills a month in
check('holidays.js comes before timesheet.js', at('holidays.js') < at('timesheet.js'), true);
// archive.js borrows button() from approvals.js and is called from app.js
check('archive.js sits between approvals.js and app.js',
  at('approvals.js') < at('archive.js') && at('archive.js') < at('app.js'), true);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('All tests passed.');

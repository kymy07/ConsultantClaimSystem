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
  /if \(!open\) bar\.appendChild\(button\('Open and fix'/.test(resubjs) &&
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
check('and the PA sees those two and nothing else',
  /if \(Auth\.places\(\)\) return all\.filter\(s => s\.signs\)/.test(appjs), true);
check('Download lists what is waiting for the HOD’s signature',
  /s\.status === SIGNING_STATUS && kindOf\(s\) === 'claim'/.test(signingjs), true);
/* Putting a scan on a card is not sending it. It can be looked at and taken
   off again; one Submit at the bottom is what closes the months and hands
   them to whoever collects the paper. */
check('a scan put on a card is held, not sent',
  /const attached = new Map\(\)/.test(signingjs) &&
  /attached\.set\(target\.id, picked\)/.test(signingjs), true);
check('and can be read before it goes',
  /openFilePreview\(`\$\{row\.consultant/.test(signingjs) &&
  /function openFilePreview/.test(previewjs), true);
check('the copy already on file can be read too',
  /async function viewFiled/.test(signingjs), true);
check('one Submit at the bottom sends them',
  /host\.appendChild\(submitBar\(\)\)/.test(signingjs) &&
  /go\.disabled = !ready/.test(signingjs), true);
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
check("the PA puts her own signature on first",
  /\{ id: 'mysign'/.test(appjs) && /id="p-mysign"/.test(html) &&
  /function renderMySignature[\s\S]{0,240}mountSignaturePicker/.test(signingjs) &&
  /if \(myLastSignature\(\)\) state\.sig\.pa = myLastSignature\(\)/.test(signingjs), true);
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
check('an invoice sent back locks the row again',
  /function adviceUnlocked[\s\S]{0,120}invoice\.status !== 'returned'/.test(signingjs) &&
  /if \(adviceUnlocked\(sub\)\) \{[\s\S]{0,40}button\('Edit'/.test(signingjs), true);
check('and it unlocks on the invoice being sent, not on it being approved',
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
/* Nothing the invoice decided may be retyped: it is the invoice's own
   figures or it is nothing, so those sit in their boxes as text and only the
   office's own boxes take a cursor. */
check('only the office boxes are typed into',
  /function advFixed/.test(signingjs) && /function advInput/.test(signingjs) &&
  /advFixed\(F\.vendor/.test(signingjs) && /advFixed\(F\.invoiceNo/.test(signingjs) &&
  /advInput\(a\.terms/.test(signingjs) && /advInput\(a\.withholding/.test(signingjs) &&
  !/advInput\(F\./.test(signingjs), true);
/* Two of them the system already knows. The rest stay blank: a payment term
   nobody agreed, printed as though somebody had, is not a time-saver. */
/* And nothing else is guessed at. Staff/Consultant and Account Manager are
   the office's to answer; a name printed there because it was the nearest
   one the system held is a name nobody put there. */
check('nothing on it is guessed',
  !/adviceFromProfile/.test(signingjs) &&
  !/a\.staff = /.test(signingjs) && !/a\.manager = /.test(signingjs), true);
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
check('submitting closes the month rather than passing it on',
  /'Submit and close the month'/.test(signingjs) &&
  !/finance/.test(authjs + signingjs), true);
check('and it files the scan before it closes the month',
  /await Sync\.store\([\s\S]{0,220}if \(sub\.status === SIGNING_STATUS\) await Sync\.act\(sub\.id, 'approve'/.test(signingjs), true);
check('a confirmed month is not offered for upload again',
  !/uploadCard\(/.test(signingjs) &&
  /function uploadRows[\s\S]{0,900}waitingSignature\(\)\.forEach/.test(signingjs), true);
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

const genadvice = fs.readFileSync(path.join(ROOT, 'assets/js/gen-advice.js'), 'utf8');
check('the form is drawn to the template it copies',
  /function buildAdvicePDF/.test(genadvice) &&
  /UZMA-FA01-IMS-OS01 \(F01\)/.test(genadvice), true);
check('and nothing on it is retyped',
  /invoiceNo: S\.invoice\.no/.test(genadvice) &&
  /amount: adviceAmount\(S\)/.test(genadvice) &&
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
check('and the two are separate steps, in the order the job happens',
  /\{ id: 'mysign'[\s\S]{0,140}\{ id: 'advice'[\s\S]{0,140}\{ id: 'todownload'[\s\S]{0,120}\{ id: 'toupload'/
    .test(appjs), true);
/* Three documents produced weeks apart is one folder to anybody who was
   asked for "September", so the administrator's record compiles one. */
check('the administrator compiles a month into one zip',
  /Compile zip/.test(archivejs) &&
  /downloadMonthZip\(anchor, control\)/.test(archivejs) &&
  /async function filedCopy/.test(signingjs), true);
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

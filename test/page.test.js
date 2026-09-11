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
/* The project manager puts their name to a document before it goes any
   further — drawn in the app where there is a box, uploaded as a scan where
   there is not. Approving without either was how a bill reached the HOD with
   nobody's name on it. */
check('a stage that signs will not pass anything on unsigned',
  /if \(signing && signs && pad\.isEmpty\(\) && !file\)/.test(approvals) &&
  /if \(signing && !signs && !file\)/.test(approvals), true);
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
// Reading the whole record back, and taking a copy of it away, is a job —
// the administrator's and Finance's. Neither of them approves anything.
check('keeping records is a capability, not a name',
  /const keepsRecords = r => r === 'admin' \|\| r === 'finance'/.test(authjs), true);
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
  /const INFO_STEPS = \['approvals', 'history', 'resubmit'\]/.test(appjs) &&
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
  /Use this signature/.test(sigjs) && /S\.sig\.personnel = pending/.test(sigjs), true);
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
   The PA places the HOD's signature, and an invoice has no HOD signature on
   it — so an invoice has nothing for them to do and should never reach
   them. Routing it there anyway was a bill sitting in somebody's queue for
   ever, waiting on a thing that does not exist.
   ----------------------------------------------------------------------- */
console.log('\nWhat the PA actually signs');

check('an invoice has no signature stage',
  /const hasSignatureStage = sub => kindOf\(sub\) === 'claim'/.test(approvals), true);
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

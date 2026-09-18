/* =======================================================================
   generate.test.js — test suite with zero npm dependencies.

   Loads the application code into a Node VM context behind a minimal
   browser stub, then generates all four documents and checks the results.

   Run:  node test/generate.test.js
   ======================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-test-'));

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

function checkFile (name, minBytes, magic) {
  const p = path.join(OUT, name);
  if (!fs.existsSync(p)) {
    failures.push(`${name} was not generated`);
    console.log(`  FAIL  ${name} was not generated`);
    return;
  }
  const buf = fs.readFileSync(p);
  const head = buf.slice(0, magic.length).toString('binary');
  if (buf.length < minBytes) {
    failures.push(`${name} too small (${buf.length} bytes)`);
    console.log(`  FAIL  ${name} is only ${buf.length} bytes`);
    return;
  }
  if (head !== magic) {
    failures.push(`${name} wrong magic bytes (${head})`);
    console.log(`  FAIL  ${name} magic bytes "${head}"`);
    return;
  }
  passed++;
  console.log(`  ok    ${name} — ${buf.length} bytes`);
}

/* ---------------- minimal browser stub ---------------- */

const ctx = {
  console,
  Blob: class Blob { constructor (parts) { this.parts = parts; } },
  atob: b64 => Buffer.from(b64, 'base64').toString('binary'),
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  Image: class { set src (v) { setTimeout(() => this.onerror && this.onerror(), 0); } },
  document: {
    createElement: () => ({ style: {}, appendChild () {}, removeChild () {}, setAttribute () {},
                            getContext: () => null, contentWindow: null }),
    documentElement: { style: {}, appendChild () {}, removeChild () {} },
    body: { appendChild () {}, removeChild () {}, style: {} },
    addEventListener () {}, createTextNode: () => ({})
  },
  navigator: { userAgent: 'node' },
  Buffer, process, TextEncoder, TextDecoder, URL,
  setTimeout, clearTimeout, Math, Date, JSON,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  saveAs (blob, name) {
    const buf = Buffer.isBuffer(blob)
      ? blob
      : Buffer.concat(blob.parts.map(p => Buffer.isBuffer(p)
          ? p : Buffer.from(p instanceof ArrayBuffer ? new Uint8Array(p) : p)));
    fs.writeFileSync(path.join(OUT, name), buf);
  }
};
ctx.window = ctx;
ctx.self = ctx;
vm.createContext(ctx);

const load = f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });

[ 'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js', 'vendor/carlito.js',
  'vendor/exceljs.min.js',
  'vendor/docx.umd.js', 'assets/js/state.js', 'assets/js/holidays.js',
  'assets/js/logo.js', 'assets/js/timesheet.js' ].forEach(load);

// signature.js and app.js need a real DOM — substitute the few helpers they export
vm.runInContext(`
  function normalizeSignature () { return Promise.resolve(null); }
  function dataUrlToBytes (u) {
    const b = atob(String(u).split(',')[1] || '');
    const a = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return a;
  }
  function toast () {}
`, ctx);

[ 'assets/js/gen-invoice.js', 'assets/js/gen-claim.js',
  'assets/js/gen-advice.js' ].forEach(load);

// JSZip has no Blob support under Node — use toBuffer for tests only
ctx.docx.Packer.toBlob = ctx.docx.Packer.toBuffer.bind(ctx.docx.Packer);

/* ---------------- fixture ---------------- */

vm.runInContext(`
  const S = defaultState();
  Object.assign(S.consultant, {
    name: 'Ahmad bin Abdullah', ic: '010203-04-0567',
    addr1: 'No 12, Jalan Contoh 1,', addr2: 'Taman Contoh, 40000 Shah Alam, Selangor',
    position: 'Full Stack Developer', position2: 'FULL STACK DEVELOPER (CONSULTANT)',
    workLoc: 'UZMA TOWER', assignPeriod: 'Aug-26',
    bank: 'RHB BANK Berhad', accName: 'Ahmad bin Abdullah', accNo: '1-23456-0001234-5'
  });
  Object.assign(S.invoice, {
    no: 'INV-2026-08-026', date: '2026-08-26', due: '2026-08-31',
    pStart: '2026-08-24', pEnd: '2026-08-31', mode: 'monthly', monthlyRate: 3500
  });
  S.timesheet.month = 7;           // August
  S.timesheet.year = 2026;
  S.timesheet.activities[0].name = 'Developing Platform (August 2026)';
  [24, 26, 27, 28].forEach(d => S.timesheet.activities[0].days[d] = '/');
  [25, 31].forEach(d => S.timesheet.activities[0].days[d] = 'PH');
  S.timesheet.activities[0].days[20] = 'PTO';   // paid time off
  S.timesheet.activities[0].days[21] = 'MC';    // medical leave
  S.timesheet.activities[0].days[19] = 'UL';    // unpaid leave
  S.timesheet.reviewName = 'Muhammad Hanis Rashidan';
  S.timesheet.reviewDate = '26.8.2026';
  S.leave = { year: 2026, pto: 10, mc: 12, ul: 0 };   // taken earlier in the year
  S.timesheet.prepName = 'Ahmad bin Abdullah';
  S.timesheet.prepDate = '26.8.2026';
  S.invoice.items = [];
  globalThis.__S = S;
  globalThis.__calc = computeAmount(S);
  globalThis.__tot = timesheetTotals(S.timesheet);
  globalThis.__addrFits = splitAddressLines('No 12, Jalan Contoh 1,', 'Taman Contoh');
  globalThis.__addrOver = splitAddressLines(
    'No 5, Lorong Solok Imam Tahir, Kg Solok Duku, 78300 Masjid Tanah', '');
  // everything saved before the two-line rule existed still holds one long
  // line, and it has to be reflowed when it is read back, not only when typed
  const stale = mergeDefaults({ consultant: {
    name: 'Adlishah Hakimi bin Sharilfuddin',
    addr1: 'No 5, Lorong Solok Imam Tahir, Kg Solok Duku, 78300, Masjid Tanah, Melaka',
    addr2: '' } });
  globalThis.__loadedLine1 = stale.consultant.addr1;
  globalThis.__loadedLine2 = stale.consultant.addr2;
  globalThis.__reloaded    = mergeDefaults(stale).consultant.addr1;
  globalThis.__addrJoin = splitAddressLines(
    'No 5, Lorong Solok Imam Tahir, Kg Solok Duku, 78300', 'Melaka');
  globalThis.__al   = dayValue(S.timesheet, S.timesheet.activities[0], 20);
  globalThis.__worked = workedDays(S.timesheet);
  globalThis.__unmarked = unmarkedDays(S.timesheet);
  globalThis.__ulDay  = dayMarkOf(S.timesheet, 19);
  globalThis.__satDay = dayMarkOf(S.timesheet, 29);
  /* Everybody here is on a monthly rate, and a daily one used to be offered
     as well. A draft saved while it was gets read as monthly rather than as
     an unknown mode worth nothing — the amount is the month's, not zero. */
  globalThis.__stale = mergeDefaults(Object.assign({}, JSON.parse(JSON.stringify(S)), {
    invoice: Object.assign({}, S.invoice, { mode: 'daily', dailyRate: 200 })
  }));
  globalThis.__staleMode = __stale.invoice.mode;
  globalThis.__staleRate = __stale.invoice.dailyRate;

  /* A second activity row must not make the weekend count twice: the days
     belong to the month, and the rows have to keep adding up to the total. */
  const two = mergeDefaults(JSON.parse(JSON.stringify(S)));
  two.timesheet.activities.push(newActivity('Something else'));
  two.timesheet.activities[1].days[18] = '/';        // a Tuesday nobody had marked
  globalThis.__twoTotal = timesheetTotals(two.timesheet).A;
  globalThis.__twoRows  = rowPaidDays(two.timesheet, 0) + rowPaidDays(two.timesheet, 1);
  globalThis.__pto  = leaveStanding(S, 'PTO');
  globalThis.__mc   = leaveStanding(S, 'MC');
  globalThis.__ul   = leaveStanding(S, 'UL');
  globalThis.__lastYear = leaveStanding(
    Object.assign({}, S, { leave: { year: 2025, pto: 9, mc: 9, ul: 9 } }), 'PTO');
  globalThis.__sat = dayValue(S.timesheet, S.timesheet.activities[0], 29);
  globalThis.__sun = dayValue(S.timesheet, S.timesheet.activities[0], 30);

  /* ---- the invoice number ---- */
  const num = defaultState();
  num.timesheet.year = 2026;
  num.consultant.name = 'Nur Amila Zulfa';
  num.consultant.uniqueId = '3';
  globalThis.__numPlain = invoiceNumberOf(num);          // padded to two digits
  num.consultant.claimSeq = 12;
  globalThis.__numTwelfth = invoiceNumberOf(num);
  const seeded = defaultState();
  seeded.timesheet.year = 2026;
  seeded.consultant.uniqueId = '01';
  seeded.consultant.name = 'Adlishah Hakimi bin Sharilfuddin';
  globalThis.__numSeeded = invoiceNumberOf(seeded);      // one already sent on paper
  const noId = defaultState();
  noId.consultant.name = 'Somebody Else';
  globalThis.__numNone = invoiceNumberOf(noId);

  /* ---- Assignment Period is Month / Year said another way ---- */
  globalThis.__mlShort = parseMonthLabel('Sep-26');
  globalThis.__mlLong  = parseMonthLabel('September 2026');
  globalThis.__mlIso   = parseMonthLabel('2026-09');
  globalThis.__mlHalf  = parseMonthLabel('Sep');
  globalThis.__mlRound = monthLabel({ month: 8, year: 2026 });

  /* ---- leave carries itself forward ---- */
  const car = defaultState();
  car.timesheet.year = 2026;
  car.timesheet.month = 8;                               // September
  car.leave = { year: 2026, pto: 0, mc: 0, ul: 0, counted: {
    '2026-07': { pto: 4, mc: 1, ul: 0 },
    '2026-08': { pto: 3, mc: 0, ul: 0 },
    '2025-11': { pto: 9, mc: 9, ul: 9 }                  // another year entirely
  } };
  car.timesheet.activities[0].days[2] = 'PTO';
  globalThis.__carried      = leaveStanding(car, 'PTO').earlier;
  globalThis.__carriedTaken = leaveStanding(car, 'PTO').taken;
  globalThis.__carriedLeft  = leaveStanding(car, 'PTO').left;

  // the month on the sheet is what is being decided, so it is never also
  // counted as one of the months that went before it
  const twice = JSON.parse(JSON.stringify(car));
  twice.leave.counted['2026-09'] = { pto: 1, mc: 0, ul: 0 };
  globalThis.__notTwice = leaveStanding(twice, 'PTO').taken;

  // and filing the same month again replaces it rather than adding to it
  recordLeaveTaken(car);
  recordLeaveTaken(car);
  globalThis.__filed = car.leave.counted['2026-09'].pto;

  /* ---- a spent allowance is not offered ---- */
  const spent = defaultState();
  spent.timesheet.year = 2026;
  spent.timesheet.month = 8;
  spent.leave = { year: 2026, pto: 0, mc: 0, ul: 0, counted: {
    '2026-01': { pto: 12, mc: 0, ul: 0 }
  } };
  globalThis.__spentLeft = leaveStanding(spent, 'PTO').left;
  globalThis.__spentPto  = canMarkLeave(spent, 'PTO', false);
  globalThis.__spentMc   = canMarkLeave(spent, 'MC', false);
  globalThis.__spentPh   = canMarkLeave(spent, 'PH', false);
  globalThis.__spentNext = nextDayMark(spent, 'PH').value;    // PTO is skipped

  /* ---- the month fills itself in ---- */
  const auto = defaultState();
  auto.timesheet.year = 2026;
  auto.timesheet.month = 8;                                   // September 2026
  globalThis.__autoBefore = timesheetIsAuto(auto);
  autoFillMonth(auto);
  const grid = auto.timesheet.activities[0].days;
  globalThis.__autoWorked  = workedDays(auto.timesheet);
  globalThis.__autoPaid    = paidDays(auto.timesheet);
  globalThis.__autoPH      = grid[16];                        // 16 Sep, Malaysia Day
  globalThis.__autoBlank   = unmarkedDays(auto.timesheet).length;
  globalThis.__autoWeekend = grid[5] === undefined;           // 5 Sep is a Saturday
  globalThis.__autoFlag    = auto.timesheet.autoFilled;
  auto.timesheet.activities[0].days[3] = 'PTO';
  auto.timesheet.autoFilled = false;
  globalThis.__autoAfter = timesheetIsAuto(auto);
  globalThis.__holKnown = holidaysKnown(2026) && !holidaysKnown(2099);
`, ctx);

/* ---------------- run ---------------- */

(async () => {
  console.log('\nCalculations');
  // RM 3500 / 31 days in August x 8 calendar days (24-31) = RM 903.23
  /* A month's pay is the month less what is not paid for. August 2026 holds
     10 weekend days; the sheet adds 4 worked, 2 public holidays, 1 PTO and
     1 MC, and leaves one day to unpaid leave and the rest of the first three
     weeks unmarked. 18 days are paid, and the money follows them. */
  check('invoice amount (RM)', ctx.__calc.amount, 2032.26);
  check('TOTAL DAYS [A] counts every paid day', ctx.__tot.A, 18);
  check('the days worked are still counted', ctx.__worked, 4);
  /* There is one way of working a month out, so there is nothing to choose.
     A draft saved while there was gets both the method and the rate that
     went with it stripped on the way in. */
  check('a draft carrying a calculation method loses it', ctx.__staleMode, 'undefined');
  check('and the daily rate with it', ctx.__staleRate, 'undefined');
  check('unpaid leave is not a paid day', ctx.__ulDay, 'UL');
  check('the weekend fills itself in', ctx.__satDay, 'SAT');
  check('a working day nobody marked is unpaid', ctx.__unmarked.includes(18), true);
  check('and there are 12 of them here', ctx.__unmarked.length, 12);
  check('a second activity row does not double the weekend', ctx.__twoTotal, 19);
  check('and the rows still add up to the total', ctx.__twoRows, ctx.__twoTotal);
  check('20 Aug 2026 leave mark', ctx.__al, 'PTO');

  /* Leave comes out of a yearly allowance: what the grid holds this month
     plus what was taken earlier, against the 12 days each kind gets. */
  console.log('\nLeave against the year');
  check('this month counted from the grid', ctx.__pto.month, 1);
  check('added to what went before',        ctx.__pto.taken, 11);
  check('leaving the rest of the twelve',   ctx.__pto.left, 1);
  check('inside the allowance is not over', ctx.__pto.over, false);
  check('the twelfth day is still allowed', ctx.__mc.taken, 13);
  check('the thirteenth is over',           ctx.__mc.over, true);
  check('and says by how much',             ctx.__mc.left, -1);
  check('leave never taken starts at zero', ctx.__ul.earlier, 0);
  check('a balance from another year is not this one', ctx.__lastYear.earlier, 0);
  check('BALANCE [B-(A+C)]', ctx.__tot.balance, -18);
  check('29 Aug 2026 auto-label', ctx.__sat, 'SAT');
  check('30 Aug 2026 auto-label', ctx.__sun, 'SUN');

  // Line 1 is only as long as the invoice can print (66 mm, 46 characters):
  // an address longer than that carries on into line 2 instead of running
  // into the column beside it, and it breaks between words, never inside one
  check('a line that fits is left alone', ctx.__addrFits.moved, '');
  check('a line that fits keeps line 2', ctx.__addrFits.line2, 'Taman Contoh');
  check('the overflow breaks between words',
        ctx.__addrOver.line1, 'No 5, Lorong Solok Imam Tahir, Kg Solok Duku,');
  check('the overflow lands on line 2', ctx.__addrOver.line2, '78300 Masjid Tanah');
  check('the overflow joins what line 2 held', ctx.__addrJoin.line2, '78300, Melaka');
  check('a line saved before the rule is reflowed on load',
        ctx.__loadedLine1, 'No 5, Lorong Solok Imam Tahir, Kg Solok Duku,');
  check('and what would not fit is on line 2',
        ctx.__loadedLine2, '78300, Masjid Tanah, Melaka');
  check('loading it again moves nothing further', ctx.__reloaded, ctx.__loadedLine1);

  /* -----------------------------------------------------------------------
     The invoice number. 2026-01-003 reads as the year, the person, and the
     third claim they have sent, so all three have to be right — and a
     profile with no unique ID gets no number rather than a guessed one.
     ----------------------------------------------------------------------- */
  console.log('\nThe invoice number');
  check('a single digit is padded to two',       ctx.__numPlain, '2026-03-001');
  check('the count is padded to three',          ctx.__numTwelfth, '2026-03-012');
  check('claims already sent on paper carry on', ctx.__numSeeded, '2026-01-002');
  check('no unique ID means no number',          ctx.__numNone, '');

  console.log('\nAssignment Period and Month / Year are one fact');
  check('Sep-26 is a month',       JSON.stringify(ctx.__mlShort), '{"y":2026,"m":8}');
  check('so is September 2026',    JSON.stringify(ctx.__mlLong),  '{"y":2026,"m":8}');
  check('and so is 2026-09',       JSON.stringify(ctx.__mlIso),   '{"y":2026,"m":8}');
  check('half a month is not one', ctx.__mlHalf, 'null');
  check('and it round-trips',      ctx.__mlRound, 'Sep-26');

  /* -----------------------------------------------------------------------
     Leave carries itself forward out of the months that have been submitted,
     so nobody types last month's figure in — and an allowance that is spent
     stops being offered, rather than being warned about after the fact.
     ----------------------------------------------------------------------- */
  console.log('\nLeave carries itself forward');
  check('earlier months add up',                  ctx.__carried, 7);
  check('another year is not this one',           ctx.__carriedTaken, 8);
  check('and the rest of the twelve is left',     ctx.__carriedLeft, 4);
  check('the month on the sheet is not carried',  ctx.__notTwice, 8);
  check('filing it twice files it once',          ctx.__filed, 1);
  check('a spent allowance has nothing left',     ctx.__spentLeft, 0);
  check('and cannot be marked',                   ctx.__spentPto, false);
  check('while another kind still can',           ctx.__spentMc, true);
  check('a public holiday spends no allowance',   ctx.__spentPh, true);
  check('so clicking past PH lands on MC',        ctx.__spentNext, 'MC');

  /* -----------------------------------------------------------------------
     Almost every month is every working day worked, so that is what an
     untouched month starts as — and one click on any cell makes it the
     consultant's sheet, never to be rewritten underneath them again.
     ----------------------------------------------------------------------- */
  console.log('\nThe month fills itself in');
  check('an empty sheet is an automatic one',   ctx.__autoBefore, true);
  check('September 2026 has 21 working days',   ctx.__autoWorked, 21);
  check('and every one of its 30 days is paid', ctx.__autoPaid, 30);
  check('Malaysia Day is marked PH',            ctx.__autoPH, 'PH');
  check('nothing is left unaccounted for',      ctx.__autoBlank, 0);
  check('the weekend is left to the calendar',  ctx.__autoWeekend, true);
  check('and the sheet knows it is automatic',  ctx.__autoFlag, true);
  check('one click and it is not any more',     ctx.__autoAfter, false);
  check('a year with no gazette says so',       ctx.__holKnown, true);

  console.log('\nDocument generation');
  const jobs = [
    ['Invoice PDF', ctx.generateInvoicePDF], ['Invoice Excel', ctx.generateInvoiceXLSX],
    ['Claim PDF', ctx.generateClaimPDF],     ['Claim Word', ctx.generateClaimDOCX]
  ];
  for (const [label, fn] of jobs) {
    try { await fn(ctx.__S); }
    catch (e) {
      failures.push(`${label} threw: ${e.message}`);
      console.log(`  FAIL  ${label}: ${e.message}`);
    }
  }

  /* -----------------------------------------------------------------------
     One person, one row. A profile is kept under the name on its card and
     sends everything under the Full name on its form; a list that took the
     card name for the person drew anybody whose two spellings differed
     twice — once with nothing sent, once with everything.
     ----------------------------------------------------------------------- */
  console.log('\nWho a profile is');
  const who = expr => vm.runInContext(expr, ctx);
  check('a profile is the name its documents carry',
    who(`profileFiledName('Anir Syazwan Sharbirin',
                          { consultant: { name: 'Anir Syazwan bin Sharbirin' } })`),
    'Anir Syazwan bin Sharbirin');
  check('and its card name only when the form has none yet',
    who(`profileFiledName('Someone New', { consultant: { name: '  ' } })`), 'Someone New');

  /* -----------------------------------------------------------------------
     Leave on record. The sent time sheets are the record: each month once,
     the newest copy, and a browser's own memory of it put right from them.
     ----------------------------------------------------------------------- */
  console.log('\nLeave on record');
  const lv = expr => vm.runInContext(expr, ctx);
  lv(`
    globalThis.__sheet = (y, m, marks) => {
      const t = defaultState().timesheet;
      t.year = y; t.month = m;
      Object.keys(marks).forEach(d => { t.activities[0].days[d] = marks[d]; });
      return t;
    };
    /* newest first, as the list is sorted: a resubmitted September with one
       PTO, then the first September with two, then August */
    globalThis.__rec = leaveFromSheets([
      { consultant: 'Anir Syazwan bin Sharbirin', data: { timesheet: __sheet(2026, 8, { 4: 'PTO', 10: 'MC' }) } },
      { consultant: 'Anir Syazwan bin Sharbirin', data: { timesheet: __sheet(2026, 8, { 4: 'PTO', 5: 'PTO' }) } },
      { consultant: 'Anir Syazwan bin Sharbirin', data: { timesheet: __sheet(2026, 7, { 12: 'MC' }) } }
    ]);
  `);
  check('a month on record is its newest copy',
    lv(`__rec['Anir Syazwan bin Sharbirin']['2026-09'].pto`), 1);
  check('with every kind of leave it marks',
    lv(`__rec['Anir Syazwan bin Sharbirin']['2026-09'].mc`), 1);

  lv(`
    /* what the administrator's browser held: nothing for September, and a
       day of unpaid leave filed from a claim that was taken off since */
    globalThis.__card = defaultState();
    __card.leave.counted = { '2026-06': { pto: 0, mc: 0, ul: 1 } };
    globalThis.__moved = applyLeaveRecord(__card, __rec['Anir Syazwan bin Sharbirin']);
  `);
  check('what was sent is put onto the card', lv('__moved'), true);
  check('and PTO comes off', lv(`leaveOnRecord(__card, 'PTO', 2026).left`), 11);
  check('and MC comes off, both months of it', lv(`leaveOnRecord(__card, 'MC', 2026).left`), 10);
  check('a month with no claim behind it is not counted',
    lv(`leaveOnRecord(__card, 'UL', 2026).taken`), 0);
  check('the card says where the days came from',
    lv(`leaveOnRecord(__card, 'MC', 2026).from.map(x => x.month).join()`), '2026-08,2026-09');
  lv(`
    globalThis.__other = defaultState();
    __other.leave.counted = { '2025-03': { pto: 2, mc: 0, ul: 0 } };
    applyLeaveRecord(__other, { '2026-09': { pto: 1, mc: 0, ul: 0 } });
  `);
  check('a year with nothing on record is left as it was',
    lv(`__other.leave.counted['2025-03'].pto`), 2);

  /* -----------------------------------------------------------------------
     The payment advice. It is the office's own form and every box on it can
     be typed over, so what has to hold is that it opens as the invoice it
     pays, and that what somebody typed is what comes out the other end.
     ----------------------------------------------------------------------- */
  console.log('\nThe payment advice');
  const adv = expr => vm.runInContext(expr, ctx);
  adv(`
    globalThis.__adv = JSON.parse(JSON.stringify(__S));
    __adv.invoice.items = [{ desc: 'Consultancy Service Fee', amount: 3500 }];
    globalThis.__advF = adviceFields(__adv);
  `);
  check('it opens as the invoice it pays',    adv('__advF.invoiceNo'), 'INV-2026-08-026');
  check('for the vendor the claim names',     adv('__advF.vendor'), 'Ahmad bin Abdullah');
  check('worth what that invoice is worth',   adv('__advF.amount'), 3500);
  check('charged to the department',          adv('__advF.gl.D030'), 3500);
  check('and the four lines under it empty',
        adv('__advF.rows.slice(1).every(r => r.amount === "" && r.no === "")'), true);

  adv(`
    __adv.advice = {
      vendor: 'Somebody Else Sdn. Bhd.', dept: 'D099', details: 'Paid in full',
      rows: [{ no: 'INV-1', amount: 1000 }, { no: 'INV-2', amount: 250.5 }]
    };
    globalThis.__advE = adviceFields(__adv);
  `);
  check('a box typed over prints what was typed', adv('__advE.vendor'), 'Somebody Else Sdn. Bhd.');
  check('including the department code',          adv('__advE.dept'), 'D099');
  check('a second line is a second line',         adv('__advE.rows[1].no'), 'INV-2');
  check('the total is what the lines come to',    adv('__advE.amount'), 1250.5);
  check('and the charge-back line follows it',  adv('__advE.gl.D030'), 1250.5);
  check('unless a figure is put on its own line',
        adv('(__adv.advice.gl = { D030: 99 }, adviceFields(__adv).gl.D030)'), 99);
  adv('__adv.advice.vendor = "";');
  check('a box typed empty stays empty',          adv('adviceFields(__adv).vendor === ""'), true);

  /* Saving it has to keep it. Every screen that reads a saved advice puts it
     through mergeDefaults() first, and that carries over the keys
     defaultState() has and drops the rest — so until the state had a key for
     the advice, everything typed on the form was stored and then thrown away
     on the way back in. Save looked like it worked and changed nothing. */
  adv(`
    globalThis.__sent = JSON.parse(JSON.stringify(__adv));
    globalThis.__back = mergeDefaults(JSON.parse(JSON.stringify(__sent)));
  `);
  check('a saved advice survives being read back', adv('__back.advice.dept'), 'D099');
  check('with the document lines it was given',    adv('__back.advice.rows[1].no'), 'INV-2');
  check('and the figures on them',                 adv('adviceFields(__back).amount'), 1250.5);
  check('and the figure put on a charge-back line', adv('adviceFields(__back).gl.D030'), 99);
  check('a form that never had one still has the key',
        adv('JSON.stringify(mergeDefaults({}).advice)'), '{}');

  adv('globalThis.__advDoc = buildAdvicePDF(__adv);');
  try {
    const doc = await ctx.__advDoc;
    const bytes = new Uint8Array(doc.output('arraybuffer'));
    check('the advice draws as a PDF', String.fromCharCode(...bytes.slice(0, 4)), '%PDF');
    check('with all five of its lines on it', bytes.length > 20000, true);
  } catch (e) {
    failures.push(`Payment Advice PDF threw: ${e.message}`);
    console.log(`  FAIL  Payment Advice PDF: ${e.message}`);
  }

  /* -----------------------------------------------------------------------
     Fidelity to the printed Uzma sheet. These are not taste: every value is
     lifted out of the reference PDF's own font table and drawing operators,
     so a change here means the generated form has stopped matching the one
     finance receives.
     ----------------------------------------------------------------------- */
  console.log('\nMatching the printed form');
  const claimSrc = fs.readFileSync(path.join(ROOT, 'assets/js/gen-claim.js'), 'utf8');
  // Section C carries four approvers now — the project manager reviews before
  // the HOD approves — and the order on the sheet is the order of the flow.
  // `const` inside a vm script is lexical, not a property of the context —
  // these have to be evaluated in there rather than read off the object
  const inApp = expr => vm.runInContext(expr, ctx);
  check('section C has four approver columns', inApp('C_HEADS.length'), 4);
  check('the project manager reviews second', inApp('C_HEADS[1][0]'), 'REVIEWED BY');
  check('and signs in their own box',         inApp('C_HEADS[1][2]'), 'pm');
  check('the label column keeps the workbook width', inApp('C_LABEL'), 0.152243);
  check('the sheet is set in Calibri metrics', /const FONT = 'Carlito'/.test(claimSrc), true);
  check('the fills are the template grey',     /GREY = \[242, 242, 242\]/.test(claimSrc), true);
  check('the orange is the template orange',   /ORANGE = \[237, 125, 49\]/.test(claimSrc), true);
  check('no Helvetica is left in the sheet',   /helvetica/i.test(claimSrc), false);

  const inv = 'INV-2026-08-026 - Ahmad bin Abdullah';
  const clm = 'Claim Aug 2026 - Ahmad bin Abdullah';
  checkFile(`${inv}.pdf`,  8000,  '%PDF');   // PDF
  checkFile(`${inv}.xlsx`, 5000,  'PK');     // OOXML = zip archive
  checkFile(`${clm}.pdf`,  20000, '%PDF');
  // The font has to actually reach the file, not merely be asked for —
  // and only that file: the invoice is not set in Calibri and should not be
  // paying for a face it never draws with.
  check('the Claim PDF embeds the font',
    fs.readFileSync(path.join(OUT, `${clm}.pdf`)).includes('Carlito'), true);
  check('the Invoice PDF does not',
    fs.readFileSync(path.join(OUT, `${inv}.pdf`)).includes('Carlito'), false);
  checkFile(`${clm}.docx`, 8000,  'PK');

  fs.rmSync(OUT, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('All tests passed.');
})();

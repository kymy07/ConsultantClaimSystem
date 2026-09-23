/* =======================================================================
   state.js — data model, defaults, helpers and localStorage persistence
   ======================================================================= */

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
const MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function defaultState () {
  const now = new Date();
  return {
    mode: '',                          // '' | 'invoice' | 'claim' | 'both'
    /* Work on the claim form or the invoice that has not been saved to the
       person's profile yet. It travels with the draft, so a reload does not
       forget it; saving the profile is what clears it. */
    unsaved: false,
    consultant: {
      name: '', ic: '', addr1: '', addr2: '',
      position: '', position2: '', workLoc: 'UZMA TOWER', empCode: '',
      /* Whose account this profile is. A consultant sees their own and
         nobody else's, and this is what "their own" means — stamped when
         they save it, and settable by the administrator, who is the one
         who knows which address belongs to which person. */
      email: '',
      assignPeriod: '',
      /* Two numbers that make an invoice number: who this is, and how many
         claims they have sent. 2026-01-003 is the third claim of 2026 from
         person 01. Both live on the profile, so they follow the person.
         `claimSeq` is null until somebody says otherwise — see claimSeqOf(),
         which is where "everybody starts at 1" is decided. */
      uniqueId: '',
      claimSeq: null,
      /* Which number each month's claim was given, once it has been sent:
         { '2026-09': 3 }. A month is two documents and they are one claim, so
         the number is fixed when the first of them goes and the second finds
         it already there — otherwise the invoice and the time sheet backing
         it would arrive at Finance under different numbers. */
      claimNos: {},
      bank: '', accName: '', accNo: ''
    },
    company: {
      name: 'Geospatial AI Sdn Bhd',
      regNo: '200901001789 (844716-P)',
      addr1: 'Uzma Tower, No 2, Jalan PJU 8/8A',
      addr2: 'Damansara Perdana, 47820 Petaling Jaya, Selangor'
    },
    project: {
      name: '', client: '', charge: '', profit: '', code: '', dept: '', invClient: ''
    },
    invoice: {
      no: '', date: '', due: '', pStart: '', pEnd: '',
      /* The number writes itself from the profile's unique ID and the count
         of claims sent. Typing over it turns that off — for this claim only,
         and it is said on the page rather than happening silently. */
      autoNo: true,
      taxPct: 0,
      /* No starting figure. A rate that arrives already filled in is a rate
         nobody reads, and every consultant here is on a different one — so
         it is asked for, and the form will not go past step 1 without it. */
      monthlyRate: 0,
      /* The pay is worked out from the rate and the days that are paid for.
         Typing over it puts the figure here, so the calculation stops
         overwriting it — a month can be settled at something else, and the
         form should not argue. null means "whatever the sum says". */
      override: null,
      items: [],
      note: 'Invoice submitted with original timesheet signed by Consultant as per Clause 7.1 of the Service Agreement.'
    },
    timesheet: {
      month: now.getMonth(),           // 0-11
      year: now.getFullYear(),
      activities: [ newActivity('') ],
      /* True while the grid holds nothing but what the calendar put there:
         every working day ticked, the public holidays marked PH. One click
         on any cell makes it the consultant's sheet instead, and the month
         stops being refilled underneath them. */
      autoFilled: false,
      prepName: '', prepDate: '',
      reviewName: '', reviewDate: '',   // the project manager, who reviews first
      apprName: '', apprDate: '',
      verifName: '', verifDate: '',
      /* Which of the three dates in section C are still the app's, and which
         somebody typed over. An untouched one is today's, every time the
         form is opened: a claim started on the 9th and sent on the 11th is
         dated the 11th, because the 11th is when it was sent. Filling them
         in only when they were empty meant the first date a profile ever
         saw was the date it carried for ever. */
      dateAuto: { prep: true, review: true, appr: true },
      /* The calendar month in which somebody last picked this sheet's month
         by hand: '2026-10'. A form still on a month that has ended is moved
         on to the new one when it is opened — unless it was put there on
         purpose this month, which is somebody finishing a late claim. */
      chosenIn: ''
    },
    sig: { personnel: '', pm: '', hod: '', verified: '' },
    /* The office's own boxes on the payment advice: the department code, the
       document lines, the charge-back figures, the names and dates on it.
       It is empty here because an advice nobody edited has nothing of its
       own — every box on it comes from the invoice it pays, and the form
       fills itself in from there.
       It has to be a key of this object even so. A saved form is read back
       through mergeDefaults(), which carries over the keys it knows about
       and drops the rest: without this line everything typed on an advice
       was stored, and then thrown away the moment it was read again. */
    advice: {},
    /* Leave already counted this year, one entry per month that has been
       sent for approval: { '2026-09': { pto: 1, mc: 0, ul: 0 } }. It is
       written when a claim goes off, so the balance carries forward on its
       own — nobody types it in, and nobody needs every earlier sheet to
       hand. Keying it by month is what makes resubmitting a claim that came
       back cost nothing: the same month is written again, not added again. */
    /* `allowance` is the terms this person is on, not a running total:
       twelve days each unless the administrator agreed otherwise. It lives
       with the profile because it belongs to the person, and it travels with
       the claim so an approver reads the same numbers the consultant did. */
    /* `opening` is what was taken before this app knew about it: leave from
       a month that was never submitted here, or from before the person's
       first claim. The sheet cannot work it out — nothing it can read says
       so — and without it a balance is wrong for anybody who did not start
       in January. The administrator sets it, and it is per year. */
    leave: { year: now.getFullYear(), pto: 0, mc: 0, ul: 0, counted: {},
             allowance: { pto: LEAVE_LIMITS.PTO, mc: LEAVE_LIMITS.MC },
             opening: { year: now.getFullYear(), pto: 0, mc: 0, ul: 0 } }
  };
}

function newActivity (name) {
  return { name: name || '', jobId: '', days: {}, allocated: 0, pastClaim: 0 };
}

/* ---------------- date & number helpers ---------------- */

const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

/** 0 = Sunday .. 6 = Saturday */
const dowOf = (y, m, d) => new Date(y, m, d).getDay();

const isWeekend = (y, m, d) => { const w = dowOf(y, m, d); return w === 0 || w === 6; };

/** the key a month is filed under: 2026, 8 -> '2026-09' */
const monthKey = (y, m) => `${y}-${String(Number(m) + 1).padStart(2, '0')}`;

/** compact month/year label, as the printed form writes it: 'Aug-26' */
function monthLabel (ts) {
  return `${MON3[ts.month]}-${String(ts.year).slice(2)}`;
}

/**
 * Read a month back out of whatever somebody typed into Assignment Period.
 * 'Sep-26', 'Sep 2026', 'September 2026' and '2026-09' all mean the same
 * month, and all of them are things people write in that box.
 *
 * @returns {{y: number, m: number}|null} null when it is not a month yet —
 *          which is most of the time, because it is read on every keystroke.
 */
function parseMonthLabel (text) {
  const str = String(text == null ? '' : text).trim();
  if (!str) return null;

  // 2026-09 / 2026/9
  let m = str.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m) {
    const mon = Number(m[2]) - 1;
    return (mon >= 0 && mon <= 11) ? { y: Number(m[1]), m: mon } : null;
  }

  // Sep-26 / September 2026 / Sep 2026
  m = str.match(/^([A-Za-z]{3,})[\s\-/,]+(\d{2}|\d{4})$/);
  if (!m) return null;
  const name = m[1].toLowerCase();
  const idx = MONTHS.findIndex(x => x.toLowerCase() === name) >= 0
    ? MONTHS.findIndex(x => x.toLowerCase() === name)
    : MON3.findIndex(x => x.toLowerCase() === name.slice(0, 3));
  if (idx < 0) return null;

  const yr = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return (yr >= 2000 && yr <= 2100) ? { y: yr, m: idx } : null;
}

/** '2026-08-26' -> '26-Aug-26' */
function fmtDMY (iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return iso;
  return `${String(d).padStart(2, '0')}-${MON3[m - 1]}-${String(y).slice(2)}`;
}

/** '2026-08-24' + '2026-08-31' -> '24 Aug 2026 – 31 Aug 2026' */
function fmtPeriod (a, b) {
  if (!a && !b) return '';
  const one = iso => {
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${MON3[m - 1]} ${y}`;
  };
  if (a && b) return `${one(a)} – ${one(b)}`;
  return one(a || b);
}

/** '2026-08-24' + '2026-08-31' -> '24 - 31 Aug 2026' (compact, for item rows) */
function fmtPeriodShort (a, b) {
  if (!a || !b) return fmtPeriod(a, b);
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  if (ay === by && am === bm) return `${ad} - ${bd} ${MON3[am - 1]} ${ay}`;
  if (ay === by) return `${ad} ${MON3[am - 1]} - ${bd} ${MON3[bm - 1]} ${ay}`;
  return fmtPeriod(a, b);
}

/** '2026-08-24' -> { y: 2026, m: 7 }; null when the date is missing */
function periodMonth (iso) {
  if (!iso) return null;
  const [y, m] = iso.split('-').map(Number);
  return (y && m) ? { y, m: m - 1 } : null;
}

/** number of calendar days, both ends inclusive */
function calendarDays (a, b) {
  if (!a || !b) return 0;
  const d1 = new Date(a + 'T00:00:00'), d2 = new Date(b + 'T00:00:00');
  return Math.max(0, Math.round((d2 - d1) / 86400000) + 1);
}

const money = n => (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

/** strip characters that are not legal in a file name */
const safeFile = s => String(s || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();

/* ---------------- address lines ---------------- */

/* The invoice gives the address 66 mm before it would run into the column
   beside it, and 66 mm is 46 characters of an ordinary address at the 8.5 pt
   the invoice is set in — measured with the PDF's own metrics, not guessed.
   Past that the line has to carry on somewhere, and line 2 is where. */
const ADDR_LINE_MAX = 46;

/**
 * Keep line 1 inside what the invoice prints and move what does not fit to
 * the front of line 2. The break falls on the last space that still fits, so
 * a word is never cut in half; a single word longer than the whole line has
 * nowhere better to break and breaks at the limit.
 *
 * @returns {{line1: string, line2: string, moved: string}} `moved` is what
 *          crossed over, and is empty when line 1 already fitted.
 */
function splitAddressLines (line1, line2) {
  const one = String(line1 == null ? '' : line1);
  const two = String(line2 == null ? '' : line2);
  if (one.length <= ADDR_LINE_MAX) return { line1: one, line2: two, moved: '' };

  const space = one.lastIndexOf(' ', ADDR_LINE_MAX);
  const at = space > 0 ? space : ADDR_LINE_MAX;
  const head = one.slice(0, at).replace(/\s+$/, '');
  const moved = one.slice(at).trim();
  if (!moved) return { line1: head, line2: two, moved: '' };

  // the address already punctuates itself where it was cut, or it needs a comma
  const join = two ? (/[,;]$/.test(moved) ? ' ' : ', ') : '';
  return { line1: head, line2: moved + join + two, moved };
}

/* ---------------- leave ---------------- */

/* What a day off is called on the sheet. Only '/' is a day worked and only
   '/' is claimed; these three say why a day is not.

   Two of them come out of an allowance. Unpaid leave does not, and that is
   the point of it: nobody is being paid for the day, so there is nothing for
   the company to ration. It is still counted and still shown — a month with
   nine unpaid days is worth noticing — it just cannot be "over".

   PH is in none of these lists: a public holiday is the calendar's doing,
   not the consultant's, so nothing counts down for it. */
const LEAVE_KINDS  = ['PTO', 'MC', 'UL'];
const LEAVE_LIMITS = { PTO: 12, MC: 12 };                    // UL is uncapped
const LEAVE_MAX    = 366;                                    // a year of days
const LEAVE_NAMES  = { PTO: 'Paid time off', MC: 'Medical leave', UL: 'Unpaid leave' };
const LEAVE_KEYS   = { PTO: 'pto', MC: 'mc', UL: 'ul' };     // mark -> where it is carried

/** the days in this month's grid carrying one mark */
function leaveDaysInMonth (ts, mark) {
  const days = new Set();
  (ts.activities || []).forEach(a => Object.keys(a.days || {}).forEach(d => {
    if (a.days[d] === mark) days.add(Number(d));
  }));
  return [...days].sort((x, y) => x - y);
}

/** the leave this month's grid holds, ready to be filed against the year */
function monthLeaveCounts (ts) {
  const out = {};
  LEAVE_KINDS.forEach(mark => {
    out[LEAVE_KEYS[mark]] = leaveDaysInMonth(ts, mark).length;
  });
  return out;
}

/**
 * How much of one kind of leave this year has already spent, not counting
 * the month on the sheet — the sheet itself is what is being decided.
 *
 * Months are filed one at a time as claims go off for approval, so this is a
 * sum and never a figure anybody types. A saved form from before that
 * existed carries three running totals instead, and those are read as the
 * year's balance so an old profile is not silently reset to zero.
 */
/**
 * Days of this taken before the app was keeping count, for the sheet's year.
 *
 * Nought unless somebody set it, and nought for a year it was not set for:
 * an opening balance is a statement about one year, and carrying it into
 * the next would quietly spend an allowance nobody had touched.
 */
function leaveOpening (S, mark, year) {
  const o = ((S && S.leave) || {}).opening;
  const y = year != null ? Number(year) : Number((S.timesheet || {}).year);
  if (!o || Number(o.year) !== y) return 0;
  const n = Math.floor(Number(o[LEAVE_KEYS[mark]]));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function carriedLeave (S, mark) {
  const ts = S.timesheet;
  const L = S.leave || {};
  const here = monthKey(ts.year, ts.month);
  const counted = L.counted;
  const opening = leaveOpening(S, mark);

  if (counted && typeof counted === 'object' && Object.keys(counted).length) {
    let n = 0;
    Object.keys(counted).forEach(k => {
      if (k === here) return;                                  // not "earlier"
      if (Number(String(k).slice(0, 4)) !== ts.year) return;   // another year
      n += Math.max(0, Number((counted[k] || {})[LEAVE_KEYS[mark]]) || 0);
    });
    return n + opening;
  }
  // a balance carried from another year is not this year's balance
  return ((L.year === ts.year) ? Math.max(0, Number(L[LEAVE_KEYS[mark]]) || 0) : 0) + opening;
}

/**
 * File this month's leave against the year, so the next month opens with the
 * balance already carried. Writing the same month twice replaces it rather
 * than adding it again, which is what makes resubmitting a returned claim
 * cost nothing.
 */
function recordLeaveTaken (S) {
  const ts = S.timesheet;
  if (!S.leave || typeof S.leave !== 'object') S.leave = { year: ts.year, pto: 0, mc: 0, ul: 0, counted: {} };
  if (!S.leave.counted || typeof S.leave.counted !== 'object') S.leave.counted = {};
  S.leave.counted[monthKey(ts.year, ts.month)] = monthLeaveCounts(ts);
  return S.leave.counted;
}

/**
 * How many days of this a year the person is entitled to.
 *
 * Twelve is the standard, and the standard is what everybody is on until an
 * administrator says otherwise \u2014 so the figure is read from the profile
 * and falls back to the standard rather than being written into every
 * profile that never needed changing. Unpaid leave is never capped, whatever
 * is stored against it: there is nothing to ration when nobody is paying.
 */
function leaveAllowance (S, mark) {
  if (typeof LEAVE_LIMITS[mark] !== 'number') return null;
  const set = ((S && S.leave && S.leave.allowance) || {})[LEAVE_KEYS[mark]];
  const n = Math.floor(Number(set));
  return Number.isFinite(n) && n >= 0 && n <= LEAVE_MAX ? n : LEAVE_LIMITS[mark];
}

/**
 * Where one kind of leave stands for the year the sheet is in.
 *
 * `limit` and `left` are null for a kind that has no allowance, which is
 * unpaid leave — null rather than Infinity because it is printed, and
 * "Infinity days left" is not a thing anybody wants to read.
 *
 * @returns {{mark, name, days, month, earlier, taken, limit, left, over}}
 */
function leaveStanding (S, mark) {
  const ts = S.timesheet;
  const days = leaveDaysInMonth(ts, mark);
  const carried = carriedLeave(S, mark);
  const taken = carried + days.length;
  const limit = leaveAllowance(S, mark);
  const capped = limit !== null;
  return {
    mark: mark, name: LEAVE_NAMES[mark], days: days,
    month: days.length, earlier: carried, taken: taken,
    limit: capped ? limit : null,
    left: capped ? limit - taken : null,
    over: capped ? taken > limit : false
  };
}

/**
 * Where one kind of leave stands on the record for a year: the months that
 * were sent, and the opening balance. Not whatever grid happens to be open.
 *
 * leaveStanding() is the sheet's question — "if I send this month as it is,
 * where am I?" — and it rightly counts the grid on screen. A profile card
 * asks something else: where does this person stand. Answered with
 * leaveStanding(), the card counted whichever month was last left in that
 * browser's copy of the profile, sent or not: a September sent from the
 * consultant's own laptop was nowhere in it, and a day marked on a draft
 * that never went was.
 *
 * `from` names the months the days came from, so a surprising figure can
 * be read off the card rather than argued about.
 */
function leaveOnRecord (S, mark, year) {
  const L = (S && S.leave) || {};
  const y = Number(year);
  const key = LEAVE_KEYS[mark];
  const counted = L.counted && typeof L.counted === 'object' ? L.counted : {};
  const opening = leaveOpening(S, mark, y);
  let from = [];
  let taken;
  if (Object.keys(counted).length) {
    from = Object.keys(counted)
      .filter(k => Number(String(k).slice(0, 4)) === y)
      .sort()
      .map(k => ({ month: k, days: Math.max(0, Number((counted[k] || {})[key]) || 0) }))
      .filter(x => x.days > 0);
    taken = from.reduce((t, x) => t + x.days, 0) + opening;
  } else {
    // a profile from before months were filed carries running totals instead
    taken = (Number(L.year) === y ? Math.max(0, Number(L[key]) || 0) : 0) + opening;
  }
  const limit = leaveAllowance(S, mark);
  const capped = limit !== null;
  return {
    mark: mark, name: LEAVE_NAMES[mark], year: y, taken: taken, opening: opening, from: from,
    limit: capped ? limit : null,
    left: capped ? limit - taken : null,
    over: capped ? taken > limit : false
  };
}

/**
 * The leave a person's sent time sheets hold, month by month.
 *
 * Given the forms themselves, newest first, it takes each month once — the
 * newest copy, which is the one a resubmission replaced the first with — and
 * counts what that sheet marks. This is the record: what somebody actually
 * sent, rather than what one browser remembered them sending.
 *
 * @param {Array<{consultant:string, data:object}>} forms newest first
 * @returns {Object<string, Object<string, {pto,mc,ul}>>} person → month → counts
 */
function leaveFromSheets (forms) {
  const out = {};
  (forms || []).forEach(f => {
    const who = String((f && f.consultant) || '').trim();
    const ts = f && f.data && f.data.timesheet;
    if (!who || !ts || ts.year == null || ts.month == null) return;
    const month = monthKey(Number(ts.year), Number(ts.month));
    out[who] = out[who] || {};
    if (!out[who][month]) out[who][month] = monthLeaveCounts(ts);
  });
  return out;
}

/**
 * Put what was sent onto what a browser remembers.
 *
 * A month on the record replaces the same month here. And for a year with
 * anything on the record at all, a month here that the record does not have
 * is dropped: it was filed from a claim that no longer exists — a test row
 * taken off while this was being set up, or a claim deleted since — and
 * leaving it is how a day of unpaid leave nobody took stays on a card.
 * A year with nothing on the record is left exactly as it is, because that
 * says nothing: the documents may be filed under another spelling.
 *
 * @returns {boolean} whether anything changed
 */
function applyLeaveRecord (S, months) {
  if (!S || !months) return false;
  if (!S.leave || typeof S.leave !== 'object') return false;
  const before = JSON.stringify(S.leave.counted || {});
  const counted = Object.assign({}, S.leave.counted || {});
  const years = new Set(Object.keys(months).map(k => String(k).slice(0, 4)));
  Object.keys(counted).forEach(k => {
    if (years.has(String(k).slice(0, 4)) && !months[k]) delete counted[k];
  });
  Object.keys(months).forEach(k => { counted[k] = Object.assign({}, months[k]); });
  S.leave.counted = counted;
  return JSON.stringify(counted) !== before;
}

/** every kind of leave, in the order they appear on the sheet */
function leaveStandings (S) {
  return LEAVE_KINDS.map(mark => leaveStanding(S, mark));
}

/** days of this kind still available — null when there is no allowance */
function leaveLeft (S, mark) {
  const L = leaveStanding(S, mark);
  return L.limit == null ? null : Math.max(0, L.left);
}

/**
 * May one more day be marked with this? A day already carrying the mark is
 * asking to keep it, not to spend another one, so it always may.
 */
function canMarkLeave (S, mark, alreadyThisMark) {
  // PH comes out of nobody's allowance, and neither does unpaid leave
  if (leaveAllowance(S, mark) === null) return true;
  if (alreadyThisMark) return true;
  return leaveStanding(S, mark).left > 0;
}

/* ---------------- timesheet totals ---------------- */

/* Which days are paid. A day is claimed when it was worked, and also when it
   was a day off that is paid: the weekend, a public holiday, paid time off or
   medical leave. Two things are not — unpaid leave, and a working day nobody
   marked at all, which is somebody who was not there and did not say why.

   A dash is not a mark in this sense. It is how the paper sheet writes a
   day that is nobody's — a weekend, mostly — so for pay it is read as no
   mark at all: a dashed Saturday is still the paid weekend it was, and a
   dashed Tuesday is still a day not claimed. What it changes is the word
   printed in the box, and that it was put there on purpose. */
const PAID_MARKS = { '/': 1, SAT: 1, SUN: 1, PH: 1, PTO: 1, MC: 1 };
const DASH = '-';

/**
 * What one day of the month is, taken across the whole sheet: a mark anybody
 * made, or else what the calendar says. The mark wins — a Saturday worked is
 * a Saturday worked.
 */
function dayMarkOf (ts, d) {
  for (const act of ts.activities || []) {
    if (act.days && act.days[d] && act.days[d] !== DASH) return act.days[d];
  }
  /* A dash is a day the person was not on this claim at all — somebody who
     started on the 14th, or left mid-month. It is not paid, and that holds
     for a Saturday as much as for a Tuesday: the weekends before a start
     date were being paid because the calendar was asked instead of the
     sheet, and a mid-month starter was paid four days he had not begun. */
  if (dashedDay(ts, d)) return DASH;
  const w = dowOf(ts.year, ts.month, d);
  return w === 6 ? 'SAT' : w === 0 ? 'SUN' : '';
}

/** the days of this month that are paid — this is TOTAL DAYS [A] */
function paidDays (ts) {
  let n = 0;
  for (let d = 1, dim = daysInMonth(ts.year, ts.month); d <= dim; d++) {
    if (PAID_MARKS[dayMarkOf(ts, d)]) n++;
  }
  return n;
}

/** the days actually worked — what a daily rate multiplies */
function workedDays (ts) {
  const days = new Set();
  (ts.activities || []).forEach(a => Object.keys(a.days || {}).forEach(d => {
    if (a.days[d] === '/') days.add(Number(d));
  }));
  return days.size;
}

/** has somebody put a dash on this day, on any row? that is a reason given */
function dashedDay (ts, d) {
  return (ts.activities || []).some(a => a.days && a.days[d] === DASH);
}

/** working days nobody marked at all: not worked, and no reason given */
function unmarkedDays (ts) {
  const out = [];
  for (let d = 1, dim = daysInMonth(ts.year, ts.month); d <= dim; d++) {
    if (dayMarkOf(ts, d) === '' && !dashedDay(ts, d)) out.push(d);
  }
  return out;
}

/** the paid days one activity row carries in its own cells */
function activityTotal (act) {
  return Object.values(act.days || {}).filter(v => PAID_MARKS[v]).length;
}

/**
 * The days a row is worth on the printed sheet. Weekends belong to the month
 * rather than to any one activity, so they are counted once, against the
 * first row — which keeps the rows adding up to the TOTAL beneath them.
 */
function rowPaidDays (ts, index) {
  const own = activityTotal(ts.activities[index] || {});
  if (index !== 0) return own;
  let weekends = 0;
  for (let d = 1, dim = daysInMonth(ts.year, ts.month); d <= dim; d++) {
    const m = dayMarkOf(ts, d);
    if (m === 'SAT' || m === 'SUN') weekends++;
  }
  return own + weekends;
}

/** totals across every activity */
function timesheetTotals (ts) {
  let b = 0, c = 0;
  ts.activities.forEach(act => {
    b += Number(act.allocated) || 0;
    c += Number(act.pastClaim) || 0;
  });
  const a = paidDays(ts);
  return { A: a, B: b, C: c, balance: round2(b - (a + c)) };
}

/* ---------------- invoice amount ---------------- */

/** has anybody marked anything on the sheet? then it is the sheet that decides */
function timesheetMarked (ts) {
  return (ts.activities || []).some(a => Object.keys(a.days || {}).length > 0);
}

/**
 * A month's pay, prorated across the calendar month.
 *
 * The month is paid in full and the days that are not paid for are taken off
 * it — which is how payroll states it, and how somebody reading an invoice
 * checks it:
 *
 *     deduction = unpaid days ÷ days in the month × monthly rate
 *     amount    = monthly rate − deduction
 *
 * The denominator is the calendar month, 28, 30 or 31, not a count of
 * weekdays: a consultant on a monthly rate is paid for the weekend as much as
 * for the Tuesday, so the weekend cannot be missing from the divisor without
 * quietly cutting the rate. Which days are unpaid is the sheet's answer, not
 * this function's — see PAID_MARKS.
 *
 * @returns {{dim, paid, unpaid, rate, deduction, amount, formula}}
 */
function prorateMonth (S) {
  const ts = S.timesheet;
  const rate = Number(S.invoice.monthlyRate) || 0;
  const dim = daysInMonth(ts.year, ts.month);
  const paid = paidDays(ts);
  const unpaid = Math.max(0, dim - paid);
  const deduction = round2(rate / dim * unpaid);
  const amount = round2(rate - deduction);

  const formula = unpaid
    ? `RM ${money(rate)} − (${unpaid} unpaid day${unpaid > 1 ? 's' : ''} ÷ ${dim} days ` +
      `(${MONTHS[ts.month]} ${ts.year}) × RM ${money(rate)}) = RM ${money(rate)} − ` +
      `RM ${money(deduction)} = RM ${money(amount)}`
    : `RM ${money(rate)} − nothing to deduct: all ${dim} days of ` +
      `${MONTHS[ts.month]} ${ts.year} are paid = RM ${money(amount)}`;

  return { dim, paid, unpaid, rate, deduction, amount, formula };
}

/**
 * What this month comes to.
 *
 * There is one way of working it out, so there is nothing to choose. A
 * calculation method used to be a dropdown with three entries; two of them
 * were never picked, and the third was the right answer every time. A month
 * settled at some other figure is still typed straight over the amount in
 * the item table, which is a clearer way of saying "not the usual" than
 * switching the sum off.
 */
function computeAmount (S) {
  const inv = S.invoice, ts = S.timesheet;
  const rate = Number(inv.monthlyRate) || 0;

  /* A month's pay is the month, less the days that are not paid. The sheet
     already says which those are, so when it has been filled in it decides
     the figure — that is what makes unpaid leave show up in the money
     without anybody working it out by hand. */
  if (timesheetMarked(ts)) {
    const pr = prorateMonth(S);
    return { amount: pr.amount, formula: pr.formula, prorate: pr };
  }

  // nothing ticked — an invoice on its own, where the period is all there is
  const ref = periodMonth(inv.pStart) || { y: ts.year, m: ts.month };
  const dim = daysInMonth(ref.y, ref.m);
  const cal = calendarDays(inv.pStart, inv.pEnd);
  const amt = round2(rate / dim * cal);
  return { amount: amt,
           formula: `RM ${money(rate)} ÷ ${dim} days (${MONTHS[ref.m]} ${ref.y}) × ${cal} calendar days = RM ${money(amt)}` };
}

function invoiceTotals (S, items) {
  const list = items || S.invoice.items;
  const sub = round2(list.reduce((t, it) => t + (Number(it.amount) || 0), 0));
  const tax = round2(sub * (Number(S.invoice.taxPct) || 0) / 100);
  return { sub, tax, total: round2(sub + tax) };
}

/* -------------------------------------------------------------------
   One document per person, per month, per kind

   A month should hold one invoice, and usually does. It holds two when the
   same one was sent twice -- a second tab, a browser that retried, a claim
   sent again by hand -- and then every screen has to pick one. They picked
   differently: the status table took the first the list happened to return
   and the payment advice page took the last, so the same invoice read as
   approved on one screen and "with the project manager" on the other, and
   an advice that was ready sat there locked.

   So the choice is made in one place and it is the same choice everywhere:
   the copy that has got furthest, and the newest of those if two are level.
   A decision already taken is the one that counts; a duplicate left behind
   at an earlier stage does not undo it.
   ------------------------------------------------------------------- */

const SUBMISSION_RANK = {
  complete: 5,
  pending_signature: 4,
  pending_boss: 3,
  pending_manager: 2,
  returned: 1
};

/** how far along one submission is, as a number that can be compared */
const submissionRank = sub => SUBMISSION_RANK[String((sub || {}).status || '')] || 0;

/** when it last moved, for two that are level */
const submissionWhen = sub =>
  String((sub || {}).updated_at || (sub || {}).created_at || '');

/**
 * The one of these that speaks for the month.
 * @param {Array} list submissions that are already the same person, month
 *        and kind — this only decides between them
 */
function furthestAlong (list) {
  return (list || []).reduce((best, sub) => {
    if (!best) return sub;
    const d = submissionRank(sub) - submissionRank(best);
    if (d > 0) return sub;
    if (d < 0) return best;
    return submissionWhen(sub) > submissionWhen(best) ? sub : best;
  }, null) || null;
}

/* ---------------- what is being sent for approval ---------------- */

/* A month is two documents, and they are not the same document. The invoice
   is a bill; the time sheet is the evidence for it. An approver can be happy
   with one and not the other, so each goes for approval on its own and
   carries its own status the whole way. */
const SUBMIT_KINDS = {
  claim:   { label: 'Time sheet',     short: 'CLAIM', mode: 'claim' },
  invoice: { label: 'Invoice',        short: 'INV',   mode: 'invoice' },
  /* The office's own form, prepared for the consultant rather than by them.
     It carries no `mode`: nobody chooses it on the Document step, because it
     is not theirs to produce and never theirs to read. */
  advice:  { label: 'Payment Advice', short: 'PA',    office: true }
};

/* The time sheet comes first, everywhere. It is the evidence, and the invoice
   is the bill that follows from it: the days are counted, then they are
   charged for. Filling the invoice in first meant working out the amount from
   a grid that had not been ticked yet. */
const KIND_ORDER = ['claim', 'invoice'];

/** the documents the chosen mode produces, in the order they are worked on */
function kindsForMode (mode) {
  if (mode === 'invoice') return ['invoice'];
  if (mode === 'claim') return ['claim'];
  return KIND_ORDER.slice();
}

/** what one document is called where somebody has to read it */
const kindLabel = k => (SUBMIT_KINDS[k] && SUBMIT_KINDS[k].label) || 'Document';

/* ---------------- the invoice number ---------------- */

/* 2026-01-003 reads as: the year, the person, and the third claim they have
   sent. The year comes from the sheet, the person from their profile, and
   the count goes up by one each time a claim is submitted for approval. */

/**
 * Where somebody's count starts. Everybody begins at 1 — except the claims
 * that were already sent on paper before this app existed, which are
 * written down here so the numbering carries on rather than restarting.
 * Matched on the name saved in the profile.
 */
const CLAIM_SEQ_START = [
  [/adlishah\s+hakimi/i, 2]
];

/** where this person's numbering begins: what they typed, or the seed */
function startingSeq (S) {
  const saved = S.consultant.claimSeq;
  if (saved != null && Number(saved) >= 1) return Math.floor(Number(saved));
  const name = String(S.consultant.name || '');
  const seed = CLAIM_SEQ_START.find(([re]) => re.test(name));
  return seed ? seed[1] : 1;
}

/**
 * The number this claim is.
 *
 * A month that has already been sent keeps the number it was sent under —
 * including when the second of its two documents goes days later, and
 * including when one comes back and is sent again. Only a month that has
 * never gone takes the next number.
 */
function claimSeqOf (S) {
  const nos = S.consultant.claimNos;
  const key = monthKey(S.timesheet.year, S.timesheet.month);
  const already = nos && Number(nos[key]);
  if (already >= 1) return Math.floor(already);
  return startingSeq(S);
}

/**
 * Fix this month's number, if it does not have one yet, and say what the next
 * month should start from. Called when a claim is first sent.
 *
 * @returns {number|null} the number to put in the profile's "next" box, or
 *          null when this month already had one and nothing moves.
 */
function assignClaimNo (S) {
  if (!S.consultant.claimNos || typeof S.consultant.claimNos !== 'object') {
    S.consultant.claimNos = {};
  }
  const key = monthKey(S.timesheet.year, S.timesheet.month);
  if (Number(S.consultant.claimNos[key]) >= 1) return null;    // the other document
  const used = claimSeqOf(S);
  S.consultant.claimNos[key] = used;
  return used + 1;
}

/** the profile's unique ID, as it is printed: two digits, '01' not '1' */
function uniqueIdOf (S) {
  const raw = String(S.consultant.uniqueId || '').trim();
  if (!raw) return '';
  return /^\d+$/.test(raw) ? raw.padStart(2, '0') : raw;
}

/**
 * The invoice number this claim should carry, or '' when the profile has no
 * unique ID yet — there is no sensible number without one, and inventing a
 * digit would put two people on the same series.
 */
function invoiceNumberOf (S) {
  const id = uniqueIdOf(S);
  if (!id) return '';
  return `${S.timesheet.year}-${id}-${String(claimSeqOf(S)).padStart(3, '0')}`;
}

/* ---------------- storage ---------------- */

const STORE_KEY   = 'ccs.current';
const PROFILE_KEY = 'ccs.profiles';
/* Deleting a profile has to be remembered, not only done. Every browser keeps
   its own copy of the list, so without a note of what was deleted on purpose
   the next sync puts it straight back and the name appears twice again. */
const BURIED_KEY  = 'ccs.profiles.deleted';
/* And a profile saved while BDOS was unreachable has to be remembered too,
   so that it, and only it, is sent up when the connection comes back. */
const UNSENT_KEY  = 'ccs.profiles.unsent';

const Store = {
  saveCurrent (S) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); return true; }
    catch (e) { return false; }          // quota exceeded / private mode
  },
  /** erase everything this app stores (current form + every profile) */
  clearAll () {
    try {
      localStorage.removeItem(STORE_KEY);
      localStorage.removeItem(PROFILE_KEY);
      localStorage.removeItem(BURIED_KEY);
      localStorage.removeItem(UNSENT_KEY);
      return true;
    } catch (e) { return false; }
  },

  /** a list of names kept under one key, read defensively */
  nameList (key) {
    try {
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(list) ? list.map(String) : [];
    } catch (e) { return []; }
  },
  putNameList (key, list) {
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { /* ignore */ }
  },
  addName (key, name) {
    const list = Store.nameList(key);
    if (list.indexOf(String(name)) === -1) list.push(String(name));
    Store.putNameList(key, list);
  },
  dropName (key, name) {
    Store.putNameList(key, Store.nameList(key).filter(n => n !== String(name)));
  },

  /** the profile names deleted here on purpose, which must not come back */
  buried: () => Store.nameList(BURIED_KEY),
  isBuried: name => Store.nameList(BURIED_KEY).indexOf(String(name)) !== -1,

  /** profiles saved here that BDOS has not taken yet */
  unsent: () => Store.nameList(UNSENT_KEY),
  markUnsent: name => Store.addName(UNSENT_KEY, name),
  markSent: name => Store.dropName(UNSENT_KEY, name),
  loadCurrent () {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      return mergeDefaults(JSON.parse(raw));
    } catch (e) { return null; }
  },
  profiles () {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}'); } catch (e) { return {}; }
  },
  saveProfile (name, S) {
    const p = Store.profiles();
    p[name] = JSON.parse(JSON.stringify(S));
    Store.dropName(BURIED_KEY, name);       // saving it again is meaning it
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); return true; } catch (e) { return false; }
  },
  /**
   * Drop a local copy of a profile the shared list no longer has.
   *
   * Not a deletion: no note is kept, because this browser did not decide
   * anything — somebody else took the profile off, and this copy is stale.
   * A note here would have the next sync take it off the shared list again
   * if somebody saved it back on purpose.
   */
  forgetProfile (name) {
    const p = Store.profiles();
    delete p[name];
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
  },
  deleteProfile (name) {
    const p = Store.profiles();
    delete p[name];
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
    Store.addName(BURIED_KEY, name);
    Store.markSent(name);
  }
};

/**
 * The name a saved profile's documents are filed under.
 *
 * A profile is kept under the name on its card, and everything it sends goes
 * out under the Full name typed on the form. Usually they are one spelling.
 * When they are not — a card saved as "Anir Syazwan Sharbirin" for a person
 * whose form says "Anir Syazwan bin Sharbirin" — every list that took the
 * card name for the person drew them twice: once under the card, with
 * nothing sent, and once under the form's name, with everything they had.
 * The person is the form's name; the card name is only where it is kept.
 */
function profileFiledName (key, profile) {
  const full = String(((profile || {}).consultant || {}).name || '').trim();
  return full || String(key || '').trim();
}

/** the card a person's profile is kept under, by either of its two names */
function profileKeyFor (name) {
  const who = String(name || '').trim();
  if (!who) return '';
  const all = Store.profiles();
  if (Object.prototype.hasOwnProperty.call(all, who)) return who;
  return Object.keys(all).filter(k => profileFiledName(k, all[k]) === who)[0] || '';
}

/** merge a stored object over the defaults so newly added fields are never lost */
function mergeDefaults (saved) {
  const d = defaultState();
  const out = JSON.parse(JSON.stringify(d));
  Object.keys(d).forEach(k => {
    if (!saved || saved[k] === undefined) return;
    if (typeof d[k] === 'object' && d[k] !== null) {
      if (typeof saved[k] === 'object' && saved[k] !== null) Object.assign(out[k], saved[k]);
    } else {
      out[k] = saved[k];                      // scalars, e.g. mode
    }
  });
  if (!Array.isArray(out.invoice.items)) out.invoice.items = [];
  if (!Array.isArray(out.timesheet.activities) || !out.timesheet.activities.length) {
    out.timesheet.activities = [ newActivity('') ];
  }
  if (!out.leave.counted || typeof out.leave.counted !== 'object') out.leave.counted = {};
  if (!out.timesheet.dateAuto || typeof out.timesheet.dateAuto !== 'object') {
    // a form saved before the dates knew how to keep up: treat them as the
    // app's, which is what they were — nobody had typed one
    out.timesheet.dateAuto = { prep: true, review: true, appr: true };
  }
  // drafts saved while there was a calculation method to choose
  delete out.invoice.mode;
  delete out.invoice.dailyRate;
  if (!out.consultant.claimNos || typeof out.consultant.claimNos !== 'object') {
    out.consultant.claimNos = {};
  }

  /* An address longer than the invoice can print is reflowed here as well as
     while it is typed. Everything saved before that rule existed — every
     profile, every stored draft — still holds a line 1 that runs off the end
     of the page, and nobody is going to retype them. Splitting on the way in
     costs nothing and is safe to repeat: a line that already fits is left
     exactly as it is. */
  const addr = splitAddressLines(out.consultant.addr1, out.consultant.addr2);
  out.consultant.addr1 = addr.line1;
  out.consultant.addr2 = addr.line2;

  return out;
}

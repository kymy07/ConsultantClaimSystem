/* =======================================================================
   timesheet.js — Section (B) of the Personnel Time Sheet, rendered as the
   same table that gets printed: activity, job id, days 1..31, A, B, C and
   the balance. Day cells are clickable.
   ======================================================================= */

/* Values a day cell cycles through when clicked. Only '/' is a day worked
   and only '/' is counted into [A] — the rest say why a day is not claimed.
   PTO, MC and UL come out of a yearly allowance (see leaveAllowance); PH does
   not, because a public holiday is the calendar's doing. */
const CYCLE = ['', '/', 'PH', 'PTO', 'MC', 'UL', '-'];   // '-' last: a day that is nobody's
const MARKS = { PH: 'ph', PTO: 'pto', MC: 'mc', UL: 'ul' };      // tick -> cell style
const MARK_NAMES = Object.assign({ PH: 'Public Holiday' }, LEAVE_NAMES);

/**
 * The value shown for one day, and the value exported to the documents.
 * A manual tick ('/', 'PH', 'PTO', 'MC' or 'UL') overrides the weekend label.
 */
function dayValue (ts, act, d) {
  const v = act.days[d];
  if (v) return v;
  const w = dowOf(ts.year, ts.month, d);
  if (w === 6) return 'SAT';
  if (w === 0) return 'SUN';
  return '';
}

/* -----------------------------------------------------------------------
   Filling the month in

   Almost every month is the same month: every working day worked, the
   public holidays marked PH, the weekend already labelled by the calendar.
   Typing that in twenty-two times is twenty-two chances to miss one, so the
   app does it and the consultant corrects it — which is one click per day
   that was not ordinary.

   The moment any cell is clicked the sheet stops being automatic and is
   left alone: changing the month afterwards will not quietly rewrite
   somebody's corrections.
   ----------------------------------------------------------------------- */

/** is the grid still the calendar's work rather than somebody's? */
function timesheetIsAuto (S) {
  return S.timesheet.autoFilled ||
         S.timesheet.activities.every(a => Object.keys(a.days || {}).length === 0);
}

/**
 * Tick every working day of the month on the first activity row, and mark
 * the Selangor public holidays PH. Weekends are left blank because the grid
 * labels them SAT and SUN from the calendar already.
 *
 * @returns {{holidays: Object, known: boolean}} which days were made PH, and
 *          whether the holiday table actually knows this year
 */
function autoFillMonth (S) {
  const ts = S.timesheet;
  if (!ts.activities.length) ts.activities.push(newActivity(''));
  const act = ts.activities[0];
  const dim = daysInMonth(ts.year, ts.month);
  const hol = typeof holidaysInMonth === 'function' ? holidaysInMonth(ts.year, ts.month) : {};

  ts.activities.forEach(a => { a.days = {}; });
  for (let d = 1; d <= dim; d++) {
    if (isWeekend(ts.year, ts.month, d)) continue;
    act.days[d] = hol[d] ? 'PH' : '/';
  }
  ts.autoFilled = true;
  return {
    holidays: hol,
    known: typeof holidaysKnown === 'function' ? holidaysKnown(ts.year) : false
  };
}

/**
 * The next mark a cell takes when it is clicked, skipping any kind of leave
 * whose allowance for the year is already spent. A balance of zero is not a
 * warning after the fact — the sheet simply will not offer the day.
 *
 * @returns {{value: string, skipped: string[]}}
 */
function nextDayMark (S, cur) {
  const at = CYCLE.indexOf(cur);
  const skipped = [];
  for (let step = 1; step <= CYCLE.length; step++) {
    const v = CYCLE[(at + step) % CYCLE.length];
    if (canMarkLeave(S, v, false)) return { value: v, skipped: skipped };
    skipped.push(v);
  }
  return { value: '', skipped: skipped };
}

const B_HEADS = [
  'TOTAL DAYS<br>(current month claim)<br>[A]',
  'ALLOCATED<br>PROJECTED DAYS<br>[B]',
  'PAST CLAIM<br>(excluding current month)<br>[C]',
  'BALANCE<br><br>[B-(A+C)]'
];

function renderTimesheet (S, onChange) {
  const host = document.getElementById('activities');
  const ts = S.timesheet;
  const dim = daysInMonth(ts.year, ts.month);

  const table = document.createElement('table');
  table.className = 'uz-grid';
  table.setAttribute('aria-label', `Activity timesheet for ${MONTHS[ts.month]} ${ts.year}`);
  table.setAttribute('aria-describedby', 'timesheetHelp');

  /* ---- header ---- */
  let days = '';
  for (let d = 1; d <= 31; d++) days += `<th scope="col" class="c-day">${d}</th>`;
  table.innerHTML = `
    <thead><tr>
      <th scope="col" class="c-act">WORK ACTIVITY &amp; DATE</th>
      <th scope="col" class="c-job">JOB ID<br>NUMBER</th>
      ${days}
      ${B_HEADS.map(h => `<th scope="col" class="c-tot">${h}</th>`).join('')}
      <th scope="col" class="c-del"><span class="sr-only">Actions</span></th>
    </tr></thead>
    <tbody></tbody>`;
  const tbody = table.querySelector('tbody');

  /* ---- one row per activity ---- */
  ts.activities.forEach((act, ai) => {
    const tr = document.createElement('tr');

    const tdAct = document.createElement('td');
    tdAct.className = 'c-act';
    tdAct.innerHTML = `<input class="dinput" aria-label="Activity ${ai + 1}: description" placeholder="e.g. Developing Platform (${MONTHS[ts.month]} ${ts.year})">`;
    tdAct.querySelector('input').value = act.name;
    tdAct.querySelector('input').addEventListener('input', e => {
      act.name = e.target.value;
      tr.querySelectorAll('.day-toggle').forEach(button => paintDay(button.parentNode, ts, act, Number(button.dataset.day)));
      onChange();
    });
    tr.appendChild(tdAct);

    const tdJob = document.createElement('td');
    tdJob.className = 'c-job';
    tdJob.innerHTML = `<input class="dinput" aria-label="Activity ${ai + 1}: job ID" placeholder="if any">`;
    tdJob.querySelector('input').value = act.jobId;
    tdJob.querySelector('input').addEventListener('input', e => { act.jobId = e.target.value; onChange(); });
    tr.appendChild(tdJob);

    for (let d = 1; d <= 31; d++) {
      const td = document.createElement('td');
      td.className = 'c-day dcell';
      if (d > dim) {
        td.className = 'c-day';
        td.style.background = '#f0f2f4';
        td.title = `${MONTHS[ts.month]} ${ts.year} has only ${dim} days`;
      } else {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'day-toggle';
        button.dataset.day = String(d);
        button.dataset.activity = String(ai);
        // One tab stop per row; arrow keys reach the rest of the calendar.
        button.tabIndex = d === 1 ? 0 : -1;
        button.addEventListener('focus', () => {
          tr.querySelectorAll('.day-toggle').forEach(day => { day.tabIndex = day === button ? 0 : -1; });
        });
        button.addEventListener('click', () => {
          const cur = act.days[d] || '';
          const step = nextDayMark(S, cur);
          if (step.value) act.days[d] = step.value; else delete act.days[d];
          // the consultant has had a say now, so the month is theirs
          ts.autoFilled = false;
          paintDay(td, ts, act, d);
          updateRow(tr, S, act, ai);
          if (step.skipped.length) {
            const names = step.skipped.map(k => `${k} (${LEAVE_NAMES[k]})`).join(' and ');
            toast(`No ${names} left for ${ts.year} — skipped.`, true);
          }
          onChange();
        });
        td.appendChild(button);
        paintDay(td, ts, act, d);
      }
      tr.appendChild(td);
    }

    const tdA = document.createElement('td');
    tdA.className = 'c-tot cellA';
    tr.appendChild(tdA);

    const tdB = document.createElement('td');
    tdB.className = 'c-tot';
    tdB.innerHTML = `<input class="dinput" type="number" inputmode="decimal" step="0.5" aria-label="Activity ${ai + 1}: allocated projected days" placeholder="0">`;
    tdB.querySelector('input').value = act.allocated || '';
    tdB.querySelector('input').addEventListener('input', e => {
      act.allocated = Number(e.target.value) || 0; updateRow(tr, S, act, ai); onChange();
    });
    tr.appendChild(tdB);

    const tdC = document.createElement('td');
    tdC.className = 'c-tot';
    tdC.innerHTML = `<input class="dinput" type="number" inputmode="decimal" step="0.5" aria-label="Activity ${ai + 1}: past claimed days" placeholder="0">`;
    tdC.querySelector('input').value = act.pastClaim || '';
    tdC.querySelector('input').addEventListener('input', e => {
      act.pastClaim = Number(e.target.value) || 0; updateRow(tr, S, act, ai); onChange();
    });
    tr.appendChild(tdC);

    const tdBal = document.createElement('td');
    tdBal.className = 'c-tot cellBal';
    tr.appendChild(tdBal);

    const tdDel = document.createElement('td');
    tdDel.className = 'c-del';
    tdDel.innerHTML = `<button type="button" class="rowdel" title="Delete this row" aria-label="Delete activity ${ai + 1}">&times;</button>`;
    tdDel.querySelector('button').addEventListener('click', () => {
      if (ts.activities.length === 1) { toast('At least one activity row is required.', true); return; }
      ts.activities.splice(ai, 1);
      renderTimesheet(S, onChange);
      onChange();
      const rows = host.querySelectorAll('.c-act input');
      const focus = rows[Math.min(ai, rows.length - 1)];
      if (focus) focus.focus();
      toast('Activity row removed.');
    });
    tr.appendChild(tdDel);

    updateRow(tr, S, act, ai);
    tbody.appendChild(tr);
  });

  /* ---- TOTAL row ---- */
  const t = timesheetTotals(ts);
  const total = document.createElement('tr');
  total.className = 'totalrow';
  total.innerHTML =
    `<td class="c-act" style="text-align:left;padding-left:4px">TOTAL</td><td class="c-job"></td>` +
    Array(31).fill('<td class="c-day"></td>').join('') +
    `<td class="c-tot">${t.A}</td><td class="c-tot">${t.B}</td>` +
    `<td class="c-tot">${t.C}</td><td class="c-tot">${t.balance}</td><td class="c-del"></td>`;
  tbody.appendChild(total);

  table.addEventListener('keydown', e => {
    const button = e.target.closest('.day-toggle');
    if (!button || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    let day = Number(button.dataset.day);
    let row = Number(button.dataset.activity);
    if (e.key === 'ArrowLeft') day--;
    else if (e.key === 'ArrowRight') day++;
    else if (e.key === 'ArrowUp') row--;
    else if (e.key === 'ArrowDown') row++;
    else if (e.key === 'Home') day = 1;
    else if (e.key === 'End') day = dim;
    else return;
    e.preventDefault();
    day = Math.max(1, Math.min(dim, day));
    row = Math.max(0, Math.min(ts.activities.length - 1, row));
    const target = table.querySelector(`.day-toggle[data-activity="${row}"][data-day="${day}"]`);
    if (target) target.focus();
  });

  host.innerHTML = '';
  host.appendChild(table);
  renderSummary(S);
}

function paintDay (td, ts, act, d) {
  const manual = act.days[d] || '';
  const shown = dayValue(ts, act, d);
  td.className = 'c-day dcell';
  const weekend = isWeekend(ts.year, ts.month, d);
  if (manual === '/') td.classList.add('work');
  else if (MARKS[manual]) td.classList.add(MARKS[manual]);
  else if (weekend) td.classList.add('we');        // a dashed weekend keeps its shade
  const button = td.querySelector('.day-toggle');
  const what = MARK_NAMES[manual] ||
    (manual === '/' ? 'worked'
      : manual === '-' ? (weekend ? 'not a working day' : 'not claimed')
        : shown === 'SAT' ? 'Saturday' : shown === 'SUN' ? 'Sunday' : 'unmarked');
  const label = `${d} ${MONTHS[ts.month]} ${ts.year}: ${what}`;
  if (button) {
    /* An unmarked day shows nothing. It used to show an en dash, which is
       a different character from the dash somebody puts on a day on
       purpose and all but identical on screen — two marks that looked
       alike and meant opposite things, one warned about and one not.
       The cell is a 44px target either way. */
    button.textContent = manual || shown || '';
    button.setAttribute('aria-label', `${act.name || 'Activity ' + (Number(button.dataset.activity) + 1)}, ${label}. Activate to change.`);
    button.title = label + ' — select to change';
  }
  td.title = label;
}

function updateRow (tr, S, act, index) {
  const a = rowPaidDays(S.timesheet, index == null ? S.timesheet.activities.indexOf(act) : index);
  const bal = round2((Number(act.allocated) || 0) - (a + (Number(act.pastClaim) || 0)));
  tr.querySelector('.cellA').textContent = a;
  tr.querySelector('.cellBal').textContent = bal;

  // keep the printed TOTAL row and the summary bar in step
  const totalRow = tr.parentNode && tr.parentNode.querySelector('.totalrow');
  if (totalRow) {
    const t = timesheetTotals(S.timesheet);
    const cells = totalRow.querySelectorAll('.c-tot');
    if (cells.length === 4) {
      cells[0].textContent = t.A; cells[1].textContent = t.B;
      cells[2].textContent = t.C; cells[3].textContent = t.balance;
    }
  }
  renderSummary(S);
}

function renderSummary (S) {
  const t = timesheetTotals(S.timesheet);
  const ts = S.timesheet;

  /* Every day of the month is either paid for or not, so the bar says which:
     what is claimed, what was worked inside that, and what is not being paid
     — separating the days somebody accounted for from the ones nobody did. */
  const dim = daysInMonth(ts.year, ts.month);
  const blank = unmarkedDays(ts);
  document.getElementById('tsSummary').innerHTML = `
    <div>Month<b>${MONTHS[ts.month]} ${ts.year}</b></div>
    <div>Paid days [A]<b>${t.A} <small>of ${dim}</small></b></div>
    <div>Worked<b>${workedDays(ts)}</b></div>
    <div>Not paid<b>${dim - t.A}</b></div>
    <div>Allocated [B]<b>${t.B}</b></div>
    <div>Balance<b>${t.balance}</b></div>`;

  /* Which days the calendar put a PH on, and — more usefully — when it could
     not, because the movable holidays for that year have not been added yet.
     Silence there would read as "there are none". */
  /* The public holidays are not a warning and not an instruction: they are
     the calendar saying which days of this month are which kind of day. So
     they are drawn as the days themselves — one chip per holiday, in the
     same orange the PH cells in the grid above are — rather than as another
     paragraph of prose in a box that looks like every other box. */
  const holNote = document.getElementById('tsHolidays');
  if (holNote && typeof holidaysInMonth === 'function') {
    const hol = holidaysInMonth(ts.year, ts.month);
    const days = Object.keys(hol).map(Number).sort((a, b) => a - b);
    const known = typeof holidaysKnown === 'function' ? holidaysKnown(ts.year) : false;

    holNote.hidden = false;
    holNote.className = 'holidays' + (known ? '' : ' unsure');
    holNote.innerHTML = '';

    const head = document.createElement('b');
    head.textContent = days.length
      ? `Public holidays in ${MONTHS[ts.month]}`
      : `No public holiday falls in ${MONTHS[ts.month]}`;
    holNote.appendChild(head);

    if (days.length) {
      const list = document.createElement('span');
      list.className = 'holchips';
      days.forEach(d => {
        const chip = document.createElement('i');
        chip.className = 'holchip';
        const when = document.createElement('b');
        when.textContent = `${d} ${MON3[ts.month]}`;
        chip.appendChild(when);
        chip.appendChild(document.createTextNode(hol[d]));   // gazetted names, as text
        list.appendChild(chip);
      });
      holNote.appendChild(list);
    }

    if (!known) {
      const warn = document.createElement('span');
      warn.className = 'holwarn';
      warn.textContent =
        `Only fixed-date holidays are available for ${ts.year}. Check the gazette and mark any missing holidays PH.`;
      holNote.appendChild(warn);
    }
  }

  const warn = document.getElementById('tsWarn');
  if (warn) {
    // an unmarked working day is not paid, and that is almost never what
    // somebody meant — it is a day they forgot to account for
    warn.hidden = !blank.length;
    if (blank.length) {
      warn.textContent =
        `${blank.length} working day${blank.length > 1 ? 's are' : ' is'} unmarked ` +
        `(${blank.join(', ')}). Unmarked days are unpaid. Select “/” for work or another day mark.`;
    }
  }

  renderLeave(S);
}

/**
 * The year's leave, one row per kind: what this month's grid holds, and what
 * is left of the allowance.
 *
 * Nothing here is typed any more. What earlier months used up is added up
 * from the months that have actually been sent for approval, so the balance
 * carries itself forward and the column that used to ask somebody to
 * remember it is gone.
 */
function renderLeave (S, hostId) {
  // the same table appears twice: under the grid, and on the profile step
  // where somebody is choosing whose claim this is
  const host = document.getElementById(hostId || 'leaveBox');
  if (!host) return;
  const ts = S.timesheet;

  /* What the submitted months come to, on their own. `carriedLeave` counts
     the administrator's opening balance in with them — that is what a
     balance is — but this line names where the days came from, and saying
     a figure somebody typed came "from submitted months" would be wrong. */
  const carried = LEAVE_KINDS
    .map(mark => ({ mark: mark, n: carriedLeave(S, mark) - leaveOpening(S, mark) }))
    .filter(x => x.n > 0);

  /* The allowance is said rather than assumed, because it is no longer the
     same for everybody: the administrator sets what each person is on. */
  const pto = leaveAllowance(S, 'PTO');
  const mc = leaveAllowance(S, 'MC');
  const days = n => `${n} day${n === 1 ? '' : 's'}`;
  const helpOpen = !!host.querySelector('.help-disclosure[open]');

  host.innerHTML = `
    <div class="leavehead">
      <b>Leave in ${ts.year}</b>
      <span>Yearly allowance: <b>PTO</b> ${days(pto)} &middot; <b>MC</b> ${days(mc)}.</span>
    </div>
    <div class="leaveset" hidden></div>
    <table class="leavetable">
      <thead><tr>
        <th>Leave</th><th>${MONTHS[ts.month]}</th>
        <th>Taken in ${ts.year}</th><th>Left</th>
      </tr></thead>
      <tbody></tbody>
    </table>
    <p class="leavefoot"></p>
    ${hostId === 'leaveBoxProfile' ? `<details class="help-disclosure"${helpOpen ? ' open' : ''}>
      <summary><span class="help-symbol" aria-hidden="true">?</span><span>Leave guide</span></summary>
      <div class="help-content">
        <p><b>PTO and MC</b> are paid and count towards [A]. You cannot add more once the yearly allowance is used.</p>
        <p><b>UL</b> is unpaid, has no limit and does not count towards [A]. Balances include leave from submitted months.</p>
      </div>
    </details>` : ''}`;

  const opening = LEAVE_KINDS
    .map(mark => ({ mark: mark, n: leaveOpening(S, mark) }))
    .filter(x => x.n > 0);
  const said = [];
  if (carried.length) {
    said.push('From submitted months: ' + carried.map(x => `${x.n} ${x.mark}`).join(', ') + '.');
  }
  /* Said apart from the rest, because it is the one figure on this card
     nobody can check against a submitted month. */
  if (opening.length) {
    said.push('Set by the administrator as taken earlier: ' +
              opening.map(x => `${x.n} ${x.mark}`).join(', ') + '.');
  }
  const foot = host.querySelector('.leavefoot');
  foot.textContent = said.length ? said.join(' ') : `No leave carried forward in ${ts.year}.`;

  mountLeaveAllowance(S, host);

  const tbody = host.querySelector('tbody');
  leaveStandings(S).forEach(L => tbody.appendChild(leaveRow(S, L.mark)));
}

/**
 * The boxes the administrator sets, on the card that shows what they do.
 *
 * Two rows, because there are two different questions on this card and
 * neither can be worked out from the sheet. How many days a year the person
 * is on is their terms. How many they had already taken when this app
 * started counting is history — leave from a month that was never submitted
 * here, or from before their first claim — and without it a balance is
 * wrong for anybody who did not start in January.
 *
 * They are here rather than buried with the other administered fields
 * because this is where the numbers are read: somebody looking at "3 left"
 * is the person who wants to know it should have been 18. Everybody else
 * reads the sentence above and sees no boxes at all.
 */
function mountLeaveAllowance (S, host) {
  const bar = host.querySelector('.leaveset');
  if (!bar || typeof Auth === 'undefined' || !Auth.setsNumbering()) return;
  bar.hidden = false;
  bar.innerHTML = '';

  /* Only on change, not on every keystroke: a half-typed "1" of "18" would
     otherwise cut the figure to one and repaint the card underneath the
     cursor. A number that will not do is put back rather than argued with. */
  const boxes = (words, marks, read, write) => {
    const row = document.createElement('div');
    row.className = 'leaveset-row';
    const label = document.createElement('span');
    label.className = 'leaveset-said';
    label.textContent = words;
    row.appendChild(label);

    marks.forEach(mark => {
      const wrap = document.createElement('label');
      const tag = document.createElement('span');
      tag.className = 'lmark ' + MARKS[mark];
      tag.textContent = mark;
      wrap.appendChild(tag);

      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = String(LEAVE_MAX);
      input.step = '1';
      input.value = String(read(mark));
      input.setAttribute('aria-label', `${LEAVE_NAMES[mark]}, ${words.replace(/:$/, '')}`);
      input.addEventListener('change', () => {
        const n = Math.floor(Number(input.value));
        if (!Number.isFinite(n) || n < 0 || n > LEAVE_MAX) {
          input.value = String(read(mark));
          return;
        }
        write(mark, n);
        leaveAllowanceChanged(S);
      });
      wrap.appendChild(input);
      row.appendChild(wrap);
    });
    bar.appendChild(row);
  };

  boxes('Days a year for this person:', ['PTO', 'MC'],
        mark => leaveAllowance(S, mark),
        (mark, n) => {
          S.leave = S.leave || {};
          S.leave.allowance = Object.assign({}, S.leave.allowance);
          S.leave.allowance[LEAVE_KEYS[mark]] = n;
        });

  /* Unpaid leave is here too. It has no allowance to spend, but it is
     counted and shown, and a year that began part-way through should say
     so for all three. */
  boxes(`Already taken in ${S.timesheet.year}, before this app:`, LEAVE_KINDS,
        mark => leaveOpening(S, mark),
        (mark, n) => {
          S.leave = S.leave || {};
          S.leave.opening = Object.assign({ year: S.timesheet.year },
                                          S.leave.opening, { year: S.timesheet.year });
          S.leave.opening[LEAVE_KEYS[mark]] = n;
        });

  const note = document.createElement('span');
  note.className = 'leaveset-note';
  note.textContent = 'Saved with the profile. The months already submitted are counted on top.';
  bar.appendChild(note);
}

/**
 * An allowance changed: everything that counted against it is now counted
 * against a different number, so both copies of the card are drawn again and
 * the change is saved the way any other edit to the form is.
 */
function leaveAllowanceChanged (S) {
  if (typeof afterTimesheetChange === 'function') afterTimesheetChange();
  renderLeave(S);
  renderLeave(S, 'leaveBoxProfile');
}

/** one leave row: this month, the year so far, and what is left of it */
function leaveRow (S, mark) {
  const L = leaveStanding(S, mark);
  const tr = document.createElement('tr');
  if (L.over) tr.className = 'over';

  const name = document.createElement('td');
  name.innerHTML = `<span class="lmark ${MARKS[mark]}"></span>`;
  name.querySelector('.lmark').textContent = mark;
  name.appendChild(document.createTextNode(' ' + LEAVE_NAMES[mark]));
  tr.appendChild(name);

  const cell = (text, cls) => {
    const td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    return td;
  };

  /* How many days of it this month, and — in the tooltip — which days.
     The dates used to be a column of their own, and were a column of dashes
     eleven months of the year. They say more hung off the count they belong
     to, and the grid above is where anybody actually looks for them. */
  const month = cell(String(L.month));
  if (L.days.length) {
    month.title = `${L.name} on ${L.days.join(', ')} ${MONTHS[S.timesheet.month]}`;
  }
  tr.appendChild(month);

  tr.appendChild(cell(L.limit == null ? String(L.taken) : `${L.taken} of ${L.limit}`));
  tr.appendChild(cell(
    L.limit == null ? 'no limit'
      : L.over ? `${L.left} — over by ${L.taken - L.limit}`
      : String(L.left),
    L.limit == null ? 'nolimit' : (L.over || L.left === 0) ? 'bad' : (L.left <= 2 ? 'low' : '')
  ));

  return tr;
}

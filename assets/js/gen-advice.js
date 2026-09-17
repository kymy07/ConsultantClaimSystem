/* =======================================================================
   gen-advice.js — the Payment Advice, as the office's own form

   The claim and the invoice are the consultant's: they write them and they
   sign them. This one is not. It is Uzma's internal form for paying the
   bill, prepared by the PA and approved by the HOD, and the consultant
   never sees it.

   So it is drawn rather than asked for: everything on it is already known
   by the time it exists — who is being paid, which invoice, how much, and
   for which month — and it opens filled in with the invoice's own figures,
   which is the only way a payment advice can be sure of agreeing with the
   invoice it pays. Every box on it can still be typed over, because it is
   the office's sheet and the office answers for what it says.

   The layout follows UZMA-FA01-IMS-OS01 (F01) Rev. 05 as it is printed.
   ======================================================================= */

/* Read off the office's own PDF rather than matched by eye: the rules are
   black, the section bands are #BFBFBF, the note and tax panels a lighter
   #D9D9D9, and what somebody filled in is pure blue. */
const ADV_LINE = [0, 0, 0];           // the rules the form is drawn with
const ADV_BAND = [191, 191, 191];     // the grey section bands
const ADV_NOTE = [217, 217, 217];     // the quieter grey of the two panels
const ADV_INK  = [0, 0, 0];
const ADV_FILL = [0, 0, 255];         // what somebody filled in, in blue

/* The GL codes the form lists, in the order it lists them. The month is
   charged to the department that engaged the consultant. */
const ADV_GL = ['AD01', 'WS00', 'CP01', 'CS01', 'D030'];
const ADV_DEPT = 'D030';

const ADV_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 27-Aug-26, which is how every date on this form is written */
function adviceDay (value) {
  const d = value instanceof Date ? value : (value ? new Date(value) : new Date());
  if (isNaN(d.getTime())) return String(value || '');
  return `${String(d.getDate()).padStart(2, '0')}-${ADV_MON[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
}

/** the same, except a box nobody filled stays empty rather than saying today */
function adviceDate (value) {
  return value ? adviceDay(value) : '';
}

/** the month this advice pays for, as the form writes it: Aug 2026 */
function adviceMonth (S) {
  const ts = S.timesheet || {};
  const m = Number(ts.month);
  return `${ADV_MON[isNaN(m) ? 0 : m]} ${ts.year || ''}`.trim();
}

/** what the advice is worth: the invoice's own total, never retyped */
function adviceAmount (S) {
  return (invoiceTotals(S) || {}).total || 0;
}

/* The sheet has five document lines: the invoice this advice pays, and four
   more for whatever came with it. */
const ADV_ROWS = 5;

/** what somebody typed, or what the claim says where they typed nothing */
function advPick (value, fallback) {
  return value === undefined || value === null ? fallback : value;
}

/**
 * The five lines of the documents table.
 *
 * The first is the invoice's own — its number, the day it arrived, what it
 * is worth — until somebody types over it, and then it is theirs.
 * `S.advice.rows` holds what was typed; a line nobody touched falls back to
 * the claim, which is why an advice nobody opened still prints the invoice
 * it pays.
 */
function adviceRows (S) {
  const a = S.advice || {};
  const saved = Array.isArray(a.rows) ? a.rows : [];
  const rows = [];
  for (let i = 0; i < ADV_ROWS; i++) {
    const r = saved[i] || {};
    const first = i === 0;
    rows.push({
      no:          advPick(r.no,          first ? (S.invoice.no || '') : ''),
      received:    advPick(r.received,    first ? (a.receivedDate || '') : ''),
      poNo:        advPick(r.poNo,        first ? (a.poNo || '') : ''),
      projectCode: advPick(r.projectCode, first ? (a.projectCode || '') : ''),
      amount:      advPick(r.amount,      first ? adviceAmount(S) : '')
    });
  }
  return rows;
}

/** what the sheet comes to: its own lines added up, whatever they now say */
function adviceTotal (rows) {
  return round2(rows.reduce((t, r) => t + (Number(r.amount) || 0), 0));
}

function adviceFileBase (S) {
  const who = safeFile(S.consultant.name) || 'Consultant';
  return `Payment Advice ${adviceMonth(S)} - ${who}`;
}

/** the four boxes the form offers under Cost Category, in its own order */
const ADV_CATEGORIES = ['Cost of Sales', 'Opex', 'Fixed Asset', 'Inventory'];

/**
 * Everything the form says, gathered in one place.
 *
 * The claim answers most of it — the vendor, the invoice, the amount, the
 * month — and that is what the form opens filled in with, so an advice
 * nobody touched can never disagree with the invoice it pays. But it is the
 * office's own sheet and the office has the last word on every box: anything
 * `S.advice` carries is what somebody typed there, and it stands in for what
 * the claim would have said. A box typed empty stays empty; a box never
 * touched follows the claim.
 */
function adviceFields (S) {
  const a = S.advice || {};
  const pa = (typeof Auth !== 'undefined' && Auth.personFor('pa')) || '';
  const boss = (typeof Auth !== 'undefined' && Auth.personFor('boss')) || '';
  const today = new Date().toISOString().slice(0, 10);
  const rows = adviceRows(S);
  const total = adviceTotal(rows);
  const gl = {};
  ADV_GL.forEach(code => {
    gl[code] = advPick((a.gl || {})[code], code === ADV_DEPT ? total : '');
  });
  return {
    dept: advPick(a.dept, ADV_DEPT),
    vendor: advPick(a.vendor, S.consultant.name || ''),
    address: advPick(a.address,
                     [S.consultant.addr1, S.consultant.addr2].filter(Boolean).join(', ')),
    rows: rows,
    gl: gl,
    invoiceNo: rows[0].no,
    received: adviceDate(rows[0].received),
    amount: total,
    details: advPick(a.details, `Payment for Consultancy Service Fee- ${adviceMonth(S)}`),
    foreign: a.foreign || '',
    preparedName: advPick(a.preparedName, pa),
    preparedDate: adviceDate(advPick(a.preparedDate, today)),
    reviewedName: a.reviewedName || '',
    reviewedDate: adviceDate(a.reviewedDate),
    approvedName: advPick(a.approvedName, boss),
    approvedDate: adviceDate(advPick(a.approvedDate, today)),
    taxName: a.taxName || '',
    taxDate: adviceDate(a.taxDate),
    financeName: a.financeName || '',
    financeDate: adviceDate(a.financeDate),
    // the office's own boxes, blank on the form until somebody fills them
    terms: a.terms || '',
    backToBack: !!a.backToBack,
    advance: a.advance !== false,
    poNo: rows[0].poNo,
    projectCode: rows[0].projectCode,
    staff: a.staff || '',
    chargeable: a.chargeable || '',
    manager: a.manager || '',
    category: a.category || '',
    withholding: a.withholding || ''
  };
}

/* ============================ PDF ============================ */

/* Calibri, like the workbook this form is. Carlito is metrically identical
   to it and open-licensed — the claim form is drawn with it too. */
const ADV_FONT = 'Carlito';

/* Every number below was measured off the office's own PDF with the form
   filled in, not matched by eye: the page is US Letter, the content runs
   from 21.34mm to 194.01mm, the label column ends at 45.68 and every rule
   is a 0.25mm black line. A page printed from here can be laid over one
   printed from the workbook and the boxes line up.
   The three sizes the sheet sets: 7.33pt for its own words, 8.17pt for
   what somebody filled in, 6.61pt for the small print. */
const ADV = {
  L: 21.34, R: 194.01,
  label: 21.67,                        // where the left-hand labels start
  field: 45.68,                        // where the field column begins
  detailsR: 127.80,                    // Details of Payment ends here
  turnX: 141.32,                       // the sideways "Charge Back To"
  glX: 145.50, glSplit: 166.41,        // the charge-back table
  whX: 139.19, whTop: 160.87, whRows: 8, whRow: 3.894,
  docCols: [45.68, 50.29, 77.89, 111.00, 139.07, 166.41, 194.01],
  bands: { primary: 31.50, other: 122.22, approval: 193.93, finance: 243.21 },
  bandH: 5.63,
  signX: [21.67, 72.73, 133.43]
};

async function buildAdvicePDF (S) {
  const { jsPDF } = window.jspdf;
  /* Letter, not A4. The workbook is set for it, and on A4 every row of the
     form lands a few millimetres from where the paper expects it. */
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' });
  addCarlito(doc);
  const F = adviceFields(S);
  const { L, R, label: labelX, field: fieldX, docCols: cols } = ADV;
  const W = R - L;

  const rule = () => doc.setDrawColor(...ADV_LINE).setLineWidth(0.25);
  const ink = (size, style) =>
    doc.setTextColor(...ADV_INK).setFont(ADV_FONT, style || 'normal').setFontSize(size);
  const filled = (size, style) =>
    doc.setTextColor(...ADV_FILL).setFont(ADV_FONT, style || 'normal').setFontSize(size);

  /* The sheet gives a baseline, not a box, so text is placed from the top of
     its line the way the spreadsheet places it: roughly four fifths of the
     size below the top edge of the run. */
  const at = (text, x, y, opts) => doc.text(String(text), x, y, opts);

  const box = (x, y, w, h, value, o) => {
    const opt = o || {};
    rule();
    doc.rect(x, y, w, h);
    if (value) {
      filled(opt.size || 8.17);
      const cx = opt.align === 'right' ? x + w - 1.2
        : opt.align === 'center' ? x + w / 2
          : x + 0.9;
      at(value, cx, y + h / 2 + 1.05, opt.align ? { align: opt.align } : undefined);
    }
  };

  /** one of the form's grey section headings, with its quieter half */
  const band = (y, text, quiet) => {
    doc.setFillColor(...ADV_BAND);
    doc.rect(L, y, W, ADV.bandH, 'F');
    ink(8.17);
    const wide = doc.getTextWidth(text);
    ink(6.61);
    const tailW = quiet ? doc.getTextWidth(' ' + quiet) : 0;
    const startX = L + W / 2 - (wide + tailW) / 2;
    ink(8.17);
    at(text, startX, y + 4.05);
    if (quiet) {
      ink(6.61);
      at(' ' + quiet, startX + wide, y + 4.05);
    }
  };

  /* The tick boxes are drawn a shade heavier than the field rules, as the
     sheet draws them. */
  const tick = (x, y, w, h, on) => {
    doc.setDrawColor(...ADV_INK).setLineWidth(0.5);
    doc.rect(x, y, w, h);
    if (on) {
      filled(9, 'normal');
      doc.setTextColor(...ADV_INK);
      at('/', x + w / 2, y + h - 0.9, { align: 'center' });
    }
    rule();
  };

  /* ---- the letterhead ---- */
  try {
    const uzma = await loadLogo('uzmaAdvice');
    if (uzma) {
      /* The artwork arrives trimmed of its margin, so it is placed where the
         mark itself sits on the sheet — 22.96 to 58.69 across, 10.00 to
         27.04 down, measured off the template's own image — rather than in
         the box the untrimmed picture was dropped into. */
      /* Deflated, or jsPDF writes the image stream raw: at the resolution
         the mark is kept for print, that raw stream is fifteen megabytes on
         a form that is otherwise sixty kilobytes. Flat two-colour art packs
         down to almost nothing. */
      doc.addImage(uzma.url, 'PNG', 22.96, 10.00, 35.74, 17.03, undefined, 'SLOW');
    }
  } catch (err) { /* the form prints without it */ }

  ink(14.77, 'bold');
  at('PAYMENT ADVICE', 108.4, 17.3, { align: 'center' });
  ink(13.09, 'bold');
  at('( To Vendor )', 108.8, 23.9, { align: 'center' });
  ink(6.61);
  [
    'Uzma Engineering Sdn. Bhd.', 'Uzma Tower,',
    'No 2, Jalan PJU 8/8A, Damansara Perdana,',
    '47820 Petaling Jaya, Selangor, Malaysia.',
    'Tel : +603.7611.4000', 'Fax: +603.7611.4100'
  ].forEach((line, i) => at(line, 193.48, 11.5 + i * 3.09, { align: 'right' }));

  /* ---- primary details ---- */
  band(ADV.bands.primary, 'Primary Details');

  ink(7.33);
  at('Department Code', labelX, 43.0);
  box(fieldX, 38.86, 32.47, 5.84, F.dept, { align: 'center' });

  ink(7.33);
  at('Vendor Name', labelX, 50.5);
  box(fieldX, 46.36, R - fieldX, 5.84, F.vendor);

  ink(7.33);
  at('Vendor Address', labelX, 61.5);
  box(fieldX, 53.85, R - fieldX, 12.78, '');
  if (F.address) {
    filled(8.17);
    doc.text(doc.splitTextToSize(F.address, R - fieldX - 2), fieldX + 0.9, 57.6);
  }

  ink(7.33);
  at('Payment Term', labelX, 71.5);
  box(45.55, 68.16, 12.96, 4.28, F.terms, { align: 'center' });
  ink(8.17);
  at(' Days', 58.76, 71.5);
  /* Back-To-Back is a box to tick on this sheet, not a box to write in. */
  tick(68.58, 67.86, 7.45, 4.57, F.backToBack);
  ink(8.17);
  at(' Back-To-Back', 78.53, 71.5);
  tick(102.79, 67.86, 4.19, 4.57, F.advance);
  ink(8.17);
  at('Advance Payment', 111.63, 71.5);

  /* ---- the documents this advice pays against ---- */
  ink(7.33);
  at('Documents', labelX, 84.2);

  const top = 73.96;
  const headH = 7.24, attachH = 3.55, rowH = 5.588;
  rule();
  doc.rect(L === L ? cols[0] : cols[0], top, cols[6] - cols[0], headH + attachH + rowH * 5);
  for (let i = 1; i < 6; i++) doc.line(cols[i], top, cols[i], top + headH + attachH + rowH * 5);
  doc.line(cols[0], top + headH + attachH, cols[6], top + headH + attachH);
  for (let n = 1; n <= 5; n++) {
    const y = top + headH + attachH + rowH * n;
    doc.line(cols[0], y, cols[6], y);
  }
  // the attach line only rules under the two columns that ask for one
  doc.line(cols[1], top + headH, cols[2], top + headH);
  doc.line(cols[3], top + headH, cols[5], top + headH);

  const mid = i => (cols[i] + cols[i + 1]) / 2;
  ink(7.33);
  at('#', mid(0), 80.4, { align: 'center' });      // the one heading the sheet sets regular
  ink(7.33, 'bold');
  at('Invoice / Bill Number', mid(1), 78.7, { align: 'center' });
  at('Invoice / Bill Received Date', mid(2), 80.4, { align: 'center' });
  at('PO Number', mid(3), 77.0, { align: 'center' });
  at('(if applicable)', mid(3), 80.35, { align: 'center' });
  at('Project Code', mid(4), 77.0, { align: 'center' });
  at(' (if applicable)', mid(4), 80.35, { align: 'center' });   // the sheet's own leading space
  at('Amount', mid(5), 80.4, { align: 'center' });

  ink(7.33, 'bolditalic');
  at('- Attach Invoice / Bill -', mid(1), 84.1, { align: 'center' });
  at('- Attach PO -', mid(3), 84.1, { align: 'center' });
  at('- Attach PFS -', mid(4), 84.1, { align: 'center' });

  F.rows.forEach((row, i) => {
    const y = top + headH + attachH + rowH * i;
    ink(7.33);
    at(String(i + 1), mid(0), y + 3.8, { align: 'center' });
    filled(8.17);
    if (row.no) at(row.no, mid(1), y + 3.85, { align: 'center' });
    if (row.received) at(adviceDate(row.received), mid(2), y + 3.85, { align: 'center' });
    if (row.poNo) at(row.poNo, mid(3), y + 3.85, { align: 'center' });
    if (row.projectCode) at(row.projectCode, mid(4), y + 3.85, { align: 'center' });
    if (row.amount !== '' && row.amount != null) {
      at('RM' + money(row.amount), cols[6] - 1.3, y + 3.85, { align: 'right' });
    }
  });

  ink(6.61, 'bolditalic');
  at('Notes: Arrange the attachments in sequence start with Invoice, Bill, PO, PFS, TRF and others.',
     46.23, 118.9);
  ink(8.17, 'bold');
  at('TOTAL ', 151.98, 118.8);
  filled(9.01, 'bold');
  at('RM' + money(F.amount), 192.36, 118.8, { align: 'right' });

  /* ---- other details ---- */
  band(ADV.bands.other, 'Other Details ', '(If applicable)');

  ink(7.33);
  at('Details of Payment', labelX, 132.9);
  box(fieldX, 129.58, ADV.detailsR - fieldX, 11.94, '');
  filled(8.17);
  doc.text(doc.splitTextToSize(F.details, ADV.detailsR - fieldX - 2), fieldX + 0.9, 132.9);

  /* The note runs from the left margin, not from the field column: the sheet
     gives it the whole width of the left half. */
  doc.setFillColor(...ADV_NOTE);
  doc.rect(L, 145.29, 106.38, 15.62, 'F');
  ink(7.33);
  at('For services paying to foreign beneficiary, please indicate whether services are rendered ' +
     'inside or ', labelX, 148.7);
  at('outside Malaysia.', labelX, 152.05);
  box(fieldX, 152.95, ADV.detailsR - fieldX, 8.04, F.foreign);

  ink(7.33);
  at('Staff/ Consultant', labelX, 167.9);
  box(fieldX, 164.63, 65.57, 4.15, F.staff);
  ink(7.33, 'bolditalic');
  at('- Attach TRF -', 112.10, 168.3);

  ink(7.33);
  at('Chargeable to Client', labelX, 175.7);
  tick(45.55, 172.30, 5.12, 4.40, F.chargeable === 'yes');
  ink(7.33);
  at(' Yes', 50.89, 175.85);
  tick(72.01, 172.30, 6.27, 4.40, F.chargeable === 'no');
  ink(7.33);
  at(' No', 78.49, 175.85);

  ink(7.33);
  at('Account Manager', labelX, 183.5);
  box(fieldX, 180.21, 65.57, 4.15, F.manager);

  ink(7.33);
  at('Cost Category', labelX, 191.4);
  /* Three of the four labels carry a leading space on the sheet and one
     does not; the text is the sheet's own, space and all. */
  [
    ['Cost of Sales', ' Cost of Sales', 45.64, 4.66, 50.88],
    ['Opex', ' Opex', 72.35, 5.71, 78.49],
    ['Fixed Asset', 'Fixed Asset', 88.90, 4.02, 95.72],
    ['Inventory', ' Inventory', 115.40, 4.28, 121.84]
  ].forEach(c => {
    tick(c[2], 187.28, c[3], 4.85, F.category === c[0]);
    ink(7.33);
    at(c[1], c[4], 191.4);
  });

  /* ---- the right-hand column: where it is charged, and the tax on it ---- */
  ink(7.33);
  // rotated text is anchored at its foot; the sheet's runs 129.5 to 146.2
  at('Charge Back To ', ADV.turnX + 2.2, 146.18, { angle: 90 });
  const glTop = 129.58, glRow = 3.894;
  rule();
  doc.rect(ADV.glX, glTop, R - ADV.glX, glRow * 6);
  doc.line(ADV.glSplit, glTop, ADV.glSplit, glTop + glRow * 6);
  for (let i = 1; i < 6; i++) doc.line(ADV.glX, glTop + glRow * i, R, glTop + glRow * i);
  ink(7.33);
  at('GL Code', (ADV.glX + ADV.glSplit) / 2, glTop + 2.95, { align: 'center' });
  at('Amount', R - 0.6, glTop + 2.95, { align: 'right' });
  ADV_GL.forEach((code, i) => {
    const ry = glTop + glRow * (i + 1);
    ink(7.33);
    at(code, (ADV.glX + ADV.glSplit) / 2, ry + 2.95, { align: 'center' });
    const charged = F.gl[code];
    if (charged !== '' && charged != null) {
      filled(8.17);
      at('RM' + money(charged), R - 1.5, ry + 2.95, { align: 'right' });
    }
  });

  // the withholding panel, on its own grey ground as the sheet prints it
  doc.setFillColor(...ADV_NOTE);
  doc.rect(ADV.whX, ADV.whTop, R - ADV.whX - 0.08, ADV.whRow * ADV.whRows, 'F');
  ink(7.33, 'bold');
  at('Witholding Tax', 139.66, 164.4);
  ink(7.33);
  at('Yes, percentage:', 139.66, 168.05);
  doc.setFillColor(255, 255, 255);
  rule();
  doc.rect(ADV.glSplit, 164.63, R - ADV.glSplit, 4.15, 'FD');
  filled(7.33);
  if (F.withholding) at(String(F.withholding), ADV.glSplit + 1, 168.05);
  at('%', 191.56, 168.05);
  ink(6.61);
  at('Verified by:', 139.62, 180.1);
  rule();
  doc.line(153.88, 180.36, 193.93, 180.36);
  at('(Tax Department)', 188.66, 184.0, { align: 'right' });
  at('Name :', 139.62, 187.5);
  at('Date   :', 139.62, 191.4);
  filled(6.61);
  if (F.taxName) at(F.taxName, 150.30, 187.5);
  if (F.taxDate) at(F.taxDate, 150.30, 191.4);

  /* ---- who prepared it, and who approved it ---- */
  band(ADV.bands.approval, 'Payment Advice Approval');

  /* The dotted rule under each signature runs under the name cell, not
     from the label, and each is its own length — measured off the sheet,
     where they are 118 dots of 0.19mm at a 0.34mm pitch. Drawn from the
     label and given one length, the first ran into the second. */
  const columns = [
    { title: 'Prepared by :', name: F.preparedName, date: F.preparedDate, sig: (S.sig || {}).pa,
      rule: [32.50, 72.24] },
    { title: 'Reviewed by :', name: F.reviewedName, date: F.reviewedDate,
      note: ' (if required)', rule: [84.43, 127.72] },
    { title: 'Approved by :', name: F.approvedName, date: F.approvedDate, sig: (S.sig || {}).hod,
      rule: [145.62, 193.79] }
  ];

  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    const x = ADV.signX[i];
    ink(7.33);
    at(c.title, x, 206.0);
    if (c.note) {
      ink(4.92);
      at(c.note, x - 0.1, 208.6);
    }
    if (c.sig) {
      try {
        const sig = await normalizeSignature(c.sig);
        if (sig) {
          /* Centred over the dotted rule it is signed on, and sat just above
             it, the way a hand puts a signature on a line — not tucked into
             the corner under the label. */
          const maxW = 34, maxH = 12;
          const sc = Math.min(maxW / sig.w, maxH / sig.h);
          const w = sig.w * sc, h = sig.h * sc;
          const mid = (c.rule[0] + c.rule[1]) / 2;
          doc.addImage(sig.url, 'PNG', mid - w / 2, 229.4 - h, w, h);
        }
      } catch (err) { /* the name and the date still stand */ }
    }
    doc.setDrawColor(...ADV_INK).setLineWidth(0.315);
    doc.setLineDashPattern([0.19, 0.15], 0);
    doc.line(c.rule[0], 230.6, c.rule[1], 230.6);
    doc.setLineDashPattern([], 0);
    rule();
    ink(7.33);
    at('Name :', x, 234.6);
    at('Date   :', x, 239.9);
    /* The sheet's Approved by cell starts a shade further from its label
       than the other two; the value offset follows the sheet, not a rule. */
    const vx = x + (i === 2 ? 12.66 : 11.2);
    if (c.name) {
      filled(c.name.length > 26 ? 6.61 : 7.33);
      at(c.name.toUpperCase(), vx, 234.6);
    }
    if (c.date) {
      filled(7.33);
      at(c.date, vx, 239.9);
    }
  }

  /* ---- and where it goes afterwards ---- */
  band(ADV.bands.finance, 'Finance Account Payable Department');
  ink(7.33);
  at('Received by :', labelX, 253.8);
  at('Received Date :', 84.92, 253.8);
  filled(8.17);
  if (F.financeName) at(F.financeName, labelX + 19.60, 253.8);
  if (F.financeDate) at(F.financeDate, 84.92 + 24.60, 253.8);

  /* ---- the form's own footer ---- */
  ink(6.61);
  at('UZMA-FA01-IMS-OS01 (F01)', 21.63, 270.3);
  at('Rev. No. : 05', 100.20, 270.3);
  at('Rev. Date: 19 Jan 2018', 193.44, 270.3, { align: 'right' });

  return doc;
}

/* =======================================================================
   gen-advice.js — the Payment Advice, as the office's own form

   The claim and the invoice are the consultant's: they write them and they
   sign them. This one is not. It is Uzma's internal form for paying the
   bill, prepared by the PA and approved by the HOD, and the consultant
   never sees it.

   So it is drawn here rather than filled in anywhere: everything on it is
   already known by the time it exists — who is being paid, which invoice,
   how much, and for which month. Nobody retypes a figure that the invoice
   already carries, because a payment advice that disagrees with the invoice
   it pays is the one mistake this form can make.

   The layout follows UZMA-FA01-IMS-OS01 (F01) Rev. 05 as it is printed.
   ======================================================================= */

const ADV_LINE = [130, 130, 130];     // the rules the form is drawn with
const ADV_BAND = [217, 217, 217];     // the grey section bands
const ADV_INK  = [0, 0, 0];
const ADV_FILL = [0, 32, 156];        // what somebody filled in, in blue

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

function adviceFileBase (S) {
  const who = safeFile(S.consultant.name) || 'Consultant';
  return `Payment Advice ${adviceMonth(S)} - ${who}`;
}

/** the four boxes the form offers under Cost Category, in its own order */
const ADV_CATEGORIES = ['Cost of Sales', 'Opex', 'Fixed Asset', 'Inventory'];

/**
 * Everything the form says, gathered in one place.
 *
 * `S.advice` carries only what the form cannot work out for itself — the
 * dates somebody wrote, and the handful of boxes that belong to the office
 * rather than to the claim: the payment term, a PO or project code if there
 * is one, who the account manager is, and the tax. Everything else is read
 * from the claim, so the two can never drift apart.
 */
function adviceFields (S) {
  const a = S.advice || {};
  const pa = (typeof Auth !== 'undefined' && Auth.personFor('pa')) || '';
  const boss = (typeof Auth !== 'undefined' && Auth.personFor('boss')) || '';
  return {
    dept: ADV_DEPT,
    vendor: S.consultant.name || '',
    address: [S.consultant.addr1, S.consultant.addr2].filter(Boolean).join(', '),
    invoiceNo: S.invoice.no || '',
    received: adviceDay(a.receivedDate),
    amount: adviceAmount(S),
    details: `Payment for Consultancy Service Fee- ${adviceMonth(S)}`,
    preparedName: a.preparedName || pa,
    preparedDate: adviceDay(a.preparedDate),
    approvedName: a.approvedName || boss,
    approvedDate: adviceDay(a.approvedDate),
    // the office's own boxes, blank on the form until somebody fills them
    terms: a.terms || '',
    backToBack: a.backToBack || '',
    advance: a.advance !== false,
    poNo: a.poNo || '',
    projectCode: a.projectCode || '',
    staff: a.staff || '',
    chargeable: a.chargeable || '',
    manager: a.manager || '',
    category: a.category || '',
    withholding: a.withholding || ''
  };
}

/* ============================ PDF ============================ */

/* The geometry is the form's own, measured off the printed sheet: the table
   runs from 21mm to 189mm, the labels sit at the left margin, and the field
   column starts at 44mm. Every column edge below is where the paper puts it,
   so a page printed from here can be laid over one printed from the
   spreadsheet and the boxes line up. */
const ADV = {
  L: 21, R: 189,
  label: 21, field: 44,
  detailsR: 124,                       // Details of Payment ends here
  turnX: 137.6,                        // the sideways "Charge Back To"
  glX: 141, glSplit: 163,              // the charge-back table
  whX: 135.5,                          // the withholding panel
  docCols: [44, 48, 75.5, 108.5, 136, 162, 189]
};

async function buildAdvicePDF (S) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const F = adviceFields(S);
  const { L, R, label: labelX, field: fieldX, docCols: cols } = ADV;
  const W = R - L;

  const grey = () => doc.setDrawColor(...ADV_LINE).setLineWidth(0.2);
  const ink = (size, bold) =>
    doc.setTextColor(...ADV_INK).setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size);
  const filled = (size, bold) =>
    doc.setTextColor(...ADV_FILL).setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size);
  const italic = size =>
    doc.setTextColor(...ADV_INK).setFont('helvetica', 'bolditalic').setFontSize(size);

  const box = (x, y, w, h, value, opts) => {
    const o = opts || {};
    grey();
    doc.rect(x, y, w, h);
    if (value) {
      filled(o.size || 8);
      /* jsPDF aligns about the x given, so a centred value needs the middle
         of the box and not its left edge, or half of it hangs outside. */
      const at = o.align === 'right' ? x + w - 1.5
        : o.align === 'center' ? x + w / 2
          : x + 1.5;
      doc.text(String(value), at, y + h / 2 + 1.1, o.align ? { align: o.align } : undefined);
    }
  };

  /** one of the form's grey section headings, with its quieter half */
  const band = (y, text, quiet) => {
    doc.setFillColor(...ADV_BAND);
    doc.rect(L, y, W, 4.4, 'F');
    ink(8.5, true);
    const wide = doc.getTextWidth(text);
    const tail = quiet ? ' ' + quiet : '';
    const tailW = quiet ? (ink(7), doc.getTextWidth(tail)) : 0;
    const startX = L + W / 2 - (wide + tailW) / 2;
    ink(8.5, true);
    doc.text(text, startX, y + 3.1);
    if (quiet) {
      ink(7);
      doc.text(tail, startX + wide, y + 3.1);
    }
    return y + 4.4;
  };

  const tick = (x, y, on) => {
    grey();
    doc.rect(x, y, 5.4, 4.4);
    if (on) {
      filled(10, true);
      doc.text('/', x + 2.7, y + 3.5, { align: 'center' });
    }
  };

  /* ---- the letterhead ---- */
  try {
    const uzma = await loadLogo('uzma');
    if (uzma) {
      const lw = 26, lh = uzma.h * (lw / uzma.w);
      doc.addImage(uzma.url, 'PNG', L + 22, 9, lw, lh);
    }
  } catch (err) { /* the form prints without it */ }

  ink(15, true);
  doc.text('PAYMENT ADVICE', L + W / 2, 16.5, { align: 'center' });
  ink(12, true);
  doc.text('( To Vendor )', L + W / 2, 23.5, { align: 'center' });
  ink(6.3);
  [
    'Uzma Engineering Sdn. Bhd.', 'Uzma Tower,',
    'No 2, Jalan PJU 8/8A, Damansara Perdana,',
    '47820 Petaling Jaya, Selangor, Malaysia.',
    'Tel : +603.7611.4000', 'Fax: +603.7611.4100'
  ].forEach((line, i) => doc.text(line, R, 10.6 + i * 2.8, { align: 'right' }));

  /* ---- primary details ---- */
  band(35, 'Primary Details');

  ink(7.4);
  doc.text('Department Code', labelX, 44.8);
  box(fieldX, 41.5, 32, 5.8, F.dept);

  ink(7.4);
  doc.text('Vendor Name', labelX, 52.8);
  box(fieldX, 49.5, R - fieldX, 5.8, F.vendor);

  ink(7.4);
  doc.text('Vendor Address', labelX, 61.5);
  box(fieldX, 58, R - fieldX, 12, '');
  if (F.address) {
    filled(8);
    doc.text(doc.splitTextToSize(F.address, R - fieldX - 3), fieldX + 1.5, 61.6);
  }

  ink(7.4);
  doc.text('Payment Term', labelX, 75.7);
  box(fieldX, 72.4, 13, 4.8, F.terms, { align: 'center' });
  ink(8);
  doc.text('Days', fieldX + 14.5, 75.7);
  box(fieldX + 25, 72.4, 13, 4.8, F.backToBack, { align: 'center' });
  ink(8);
  doc.text('Back-To-Back', fieldX + 39.5, 75.7);
  tick(fieldX + 63, 72.4, F.advance);
  ink(8);
  doc.text('Advance Payment', fieldX + 70, 75.7);

  /* ---- the documents this advice pays against ---- */
  ink(7.4);
  doc.text('Documents', labelX, 86);

  let y = 79.5;
  const head = ['#', 'Invoice / Bill Number', 'Invoice / Bill Received Date',
                'PO Number\n(if applicable)', 'Project Code\n(if applicable)', 'Amount'];
  ink(7.1, true);
  head.forEach((text, i) => {
    grey();
    doc.rect(cols[i], y, cols[i + 1] - cols[i], 9);
    const lines = text.split('\n');
    const top = lines.length > 1 ? 3.6 : 5.4;
    lines.forEach((line, n) =>
      doc.text(line, (cols[i] + cols[i + 1]) / 2, y + top + n * 2.9, { align: 'center' }));
  });
  y += 9;

  const attach = ['', '- Attach Invoice / Bill -', '', '- Attach PO -', '- Attach PFS -', ''];
  italic(6.2);
  attach.forEach((text, i) => {
    grey();
    doc.rect(cols[i], y, cols[i + 1] - cols[i], 4.2);
    if (text) doc.text(text, (cols[i] + cols[i + 1]) / 2, y + 2.9, { align: 'center' });
  });
  y += 4.2;

  for (let n = 1; n <= 5; n++) {
    for (let i = 0; i < 6; i++) {
      grey();
      doc.rect(cols[i], y, cols[i + 1] - cols[i], 5.4);
    }
    ink(7.4);
    doc.text(String(n), (cols[0] + cols[1]) / 2, y + 3.6, { align: 'center' });
    if (n === 1) {
      filled(8);
      doc.text(F.invoiceNo, (cols[1] + cols[2]) / 2, y + 3.6, { align: 'center' });
      doc.text(F.received, (cols[2] + cols[3]) / 2, y + 3.6, { align: 'center' });
      if (F.poNo) doc.text(F.poNo, (cols[3] + cols[4]) / 2, y + 3.6, { align: 'center' });
      if (F.projectCode) doc.text(F.projectCode, (cols[4] + cols[5]) / 2, y + 3.6, { align: 'center' });
      doc.text('RM' + money(F.amount), cols[6] - 1.5, y + 3.6, { align: 'right' });
    }
    y += 5.4;
  }

  italic(6.2);
  doc.text('Notes: Arrange the attachments in sequence start with Invoice, Bill, PO, PFS, TRF and others.',
           cols[1], y + 3.6);
  ink(8.5, true);
  doc.text('TOTAL', cols[5] - 2, y + 3.6, { align: 'right' });
  filled(9, true);
  doc.text('RM' + money(F.amount), R - 1.5, y + 3.6, { align: 'right' });

  /* ---- other details ---- */
  band(131, 'Other Details', '(If applicable)');

  ink(7.4);
  doc.text('Details of Payment', labelX, 140.5);
  box(fieldX, 137.5, ADV.detailsR - fieldX, 13.5, '');
  filled(8);
  doc.text(doc.splitTextToSize(F.details, ADV.detailsR - fieldX - 3), fieldX + 1.5, 141.5);

  doc.setFillColor(...ADV_BAND);
  doc.rect(fieldX, 154.5, ADV.detailsR - fieldX, 7.8, 'F');
  ink(7);
  doc.text(doc.splitTextToSize(
    'For services paying to foreign beneficiary, please indicate whether services are rendered ' +
    'inside or outside Malaysia.', ADV.detailsR - fieldX - 3), fieldX + 1.5, 157.5);
  box(fieldX, 163.8, ADV.detailsR - fieldX, 6.5, '');

  ink(7.4);
  doc.text('Staff/ Consultant', labelX, 178.5);
  box(fieldX, 175.2, 62, 5.5, F.staff);
  italic(6.4);
  doc.text('- Attach TRF -', fieldX + 64, 178.5);

  /* the longest label on the sheet: a shade smaller so it clears the tick */
  ink(6.8);
  doc.text('Chargeable to Client', labelX, 186.9);
  tick(fieldX, 183.6, F.chargeable === 'yes');
  ink(8);
  doc.text('Yes', fieldX + 7, 186.9);
  tick(fieldX + 27, 183.6, F.chargeable === 'no');
  ink(8);
  doc.text('No', fieldX + 34, 186.9);

  ink(7.4);
  doc.text('Account Manager', labelX, 195.3);
  box(fieldX, 192, 62, 5.5, F.manager);

  ink(7.4);
  doc.text('Cost Category', labelX, 203.8);
  // the sheet spaces these four tighter, and the last must clear the panel
  [['Cost of Sales', 0], ['Opex', 24], ['Fixed Asset', 41], ['Inventory', 64]].forEach(([text, dx]) => {
    tick(fieldX + dx, 200.5, F.category === text);
    ink(8);
    doc.text(text, fieldX + dx + 7, 203.8);
  });

  /* ---- the right-hand column: where it is charged, and the tax on it ---- */
  ink(6.6, true);
  doc.text('Charge Back To', ADV.turnX, 152, { angle: 90 });
  const glTop = 137.5;
  ink(7.3, true);
  grey();
  doc.rect(ADV.glX, glTop, ADV.glSplit - ADV.glX, 4.3);
  doc.rect(ADV.glSplit, glTop, R - ADV.glSplit, 4.3);
  doc.text('GL Code', (ADV.glX + ADV.glSplit) / 2, glTop + 3, { align: 'center' });
  doc.text('Amount', R - 1.5, glTop + 3, { align: 'right' });
  ADV_GL.forEach((code, i) => {
    const ry = glTop + 4.3 + i * 4.3;
    grey();
    doc.rect(ADV.glX, ry, ADV.glSplit - ADV.glX, 4.3);
    doc.rect(ADV.glSplit, ry, R - ADV.glSplit, 4.3);
    ink(7.3);
    doc.text(code, (ADV.glX + ADV.glSplit) / 2, ry + 3, { align: 'center' });
    if (code === ADV_DEPT) {
      filled(7.5);
      doc.text('RM' + money(F.amount), R - 1.5, ry + 3, { align: 'right' });
    }
  });

  // the withholding panel, on its own grey ground as the sheet prints it
  doc.setFillColor(...ADV_BAND);
  doc.rect(ADV.whX, 171.5, R - ADV.whX, 34, 'F');
  ink(7.5, true);
  doc.text('Witholding Tax', ADV.whX + 1.5, 175.5);
  ink(7.3);
  doc.text('Yes, percentage:', ADV.whX + 1.5, 180.5);
  doc.setFillColor(255, 255, 255);
  doc.rect(ADV.whX + 26, 177.4, R - ADV.whX - 27.5, 4.6, 'FD');
  filled(7.3);
  if (F.withholding) doc.text(String(F.withholding), ADV.whX + 27.5, 180.5);
  doc.text('%', R - 3, 180.5, { align: 'right' });
  ink(7.3);
  doc.text('Verified by:', ADV.whX + 1.5, 189.5);
  grey();
  doc.line(ADV.whX + 17, 190, R - 1.5, 190);
  ink(6.4);
  doc.text('(Tax Department)', R - 1.5, 193.5, { align: 'right' });
  ink(7.3);
  doc.text('Name :', ADV.whX + 1.5, 198.5);
  doc.text('Date  :', ADV.whX + 1.5, 203);

  /* ---- who prepared it, and who approved it ---- */
  band(207.5, 'Payment Advice Approval');

  const colW = W / 3;
  const columns = [
    { title: 'Prepared by :', name: F.preparedName, date: F.preparedDate, sig: (S.sig || {}).pa },
    { title: 'Reviewed by :', name: '', date: '', note: '(if required)' },
    { title: 'Approved by :', name: F.approvedName, date: F.approvedDate, sig: (S.sig || {}).hod }
  ];

  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    const x = L + i * colW;
    ink(8);
    doc.text(c.title, x, 217.5);
    if (c.note) {
      ink(6.3);
      doc.text(c.note, x, 220.5);
    }
    if (c.sig) {
      try {
        const sig = await normalizeSignature(c.sig);
        if (sig) {
          const maxW = 40, maxH = 17;
          const sc = Math.min(maxW / sig.w, maxH / sig.h);
          doc.addImage(sig.url, 'PNG', x, 224, sig.w * sc, sig.h * sc);
        }
      } catch (err) { /* the name and the date still stand */ }
    }
    grey();
    doc.setLineDashPattern([0.6, 0.6], 0);
    doc.line(x, 244, x + colW - 6, 244);
    doc.setLineDashPattern([], 0);
    ink(7.5);
    doc.text('Name :', x, 248.6);
    doc.text('Date  :', x, 253.4);
    if (c.name) {
      filled(7);
      doc.text(c.name.toUpperCase(), x + 12, 248.6);
    }
    if (c.date) {
      filled(7);
      doc.text(c.date, x + 12, 253.4);
    }
  }

  /* ---- and where it goes afterwards ---- */
  band(260.5, 'Finance Account Payable Department');
  ink(8);
  doc.text('Received by :', L, 269.5);
  doc.text('Received Date :', L + colW, 269.5);

  /* ---- the form's own footer ---- */
  ink(6.3);
  doc.text('UZMA-FA01-IMS-OS01 (F01)', L, 287);
  doc.text('Rev. No. : 05', L + W / 2, 287, { align: 'center' });
  doc.text('Rev. Date: 19 Jan 2018', R, 287, { align: 'right' });

  return doc;
}

/** build it and hand it to the browser to save */
async function downloadAdvicePDF (S) {
  const doc = await buildAdvicePDF(S);
  doc.save(`${adviceFileBase(S)}.pdf`);
}

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

/**
 * Everything the form says, gathered in one place.
 *
 * `S.advice` carries only what the form cannot work out for itself — the
 * dates somebody actually wrote. Everything else is read from the claim, so
 * the two can never drift apart.
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
    approvedDate: adviceDay(a.approvedDate)
  };
}

/* ============================ PDF ============================ */

async function buildAdvicePDF (S) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const F = adviceFields(S);

  const L = 12, R = 198, W = R - L;
  const grey = () => doc.setDrawColor(...ADV_LINE).setLineWidth(0.2);
  const ink = (size, bold) =>
    doc.setTextColor(...ADV_INK).setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size);
  const filled = (size, bold) =>
    doc.setTextColor(...ADV_FILL).setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size);

  /** a boxed cell, optionally with what somebody put in it */
  const box = (x, y, w, h, value, opts) => {
    const o = opts || {};
    grey();
    doc.rect(x, y, w, h);
    if (value) {
      (o.plain ? ink : filled)(o.size || 8, o.bold);
      doc.text(String(value), o.align === 'right' ? x + w - 1.6 : x + 1.6, y + h / 2 + 1.1,
               o.align ? { align: o.align } : undefined);
    }
  };

  /** one of the form's grey section headings */
  const band = (y, text) => {
    doc.setFillColor(...ADV_BAND);
    doc.rect(L, y, W, 5.4, 'F');
    ink(8.5, true);
    doc.text(text, L + W / 2, y + 3.7, { align: 'center' });
    return y + 5.4;
  };

  /** an empty tick box, and the one the form has ticked */
  const tick = (x, y, on) => {
    grey();
    doc.rect(x, y, 5.6, 4.6);
    if (on) {
      filled(9, true);
      doc.text('/', x + 2, y + 3.5, { align: 'center' });
    }
  };

  /* ---- the letterhead ---- */
  try {
    const uzma = await loadLogo('uzma');
    if (uzma) {
      const lw = 30, lh = uzma.h * (lw / uzma.w);
      doc.addImage(uzma.url, 'PNG', L + 12, 10, lw, lh);
    }
  } catch (err) { /* the form prints without it */ }

  ink(15, true);
  doc.text('PAYMENT ADVICE', L + W / 2, 15, { align: 'center' });
  ink(12, true);
  doc.text('( To Vendor )', L + W / 2, 21.5, { align: 'center' });

  ink(6.4);
  [
    'Uzma Engineering Sdn. Bhd.', 'Uzma Tower,',
    'No 2, Jalan PJU 8/8A, Damansara Perdana,',
    '47820 Petaling Jaya, Selangor, Malaysia.',
    'Tel : +603.7611.4000', 'Fax: +603.7611.4100'
  ].forEach((line, i) => doc.text(line, R, 10.5 + i * 2.9, { align: 'right' }));

  /* ---- primary details ---- */
  let y = band(30, 'Primary Details');
  y += 3;

  const labelX = L + 2, fieldX = L + 46;
  ink(8);
  doc.text('Department Code', labelX, y + 3.4);
  box(fieldX, y, 40, 5.4, F.dept);
  y += 9;

  ink(8);
  doc.text('Vendor Name', labelX, y + 3.4);
  box(fieldX, y, R - fieldX, 5.4, F.vendor);
  y += 9;

  ink(8);
  doc.text('Vendor Address', labelX, y + 4.8);
  box(fieldX, y, R - fieldX, 10, '');
  if (F.address) {
    filled(8);
    doc.text(doc.splitTextToSize(F.address, R - fieldX - 4), fieldX + 1.6, y + 3.6);
  }
  y += 13.5;

  ink(8);
  doc.text('Payment Term', labelX, y + 3.4);
  box(fieldX, y, 14, 4.6, '');
  ink(8);
  doc.text('Days', fieldX + 15.5, y + 3.4);
  box(fieldX + 26, y, 14, 4.6, '');
  ink(8);
  doc.text('Back-To-Back', fieldX + 41.5, y + 3.4);
  tick(fieldX + 68, y, true);
  ink(8);
  doc.text('Advance Payment', fieldX + 75, y + 3.4);
  y += 8.5;

  /* ---- the documents this advice pays against ---- */
  ink(8);
  doc.text('Documents', labelX, y + 5);

  // six columns, so seven edges: #, number, received, PO, project, amount
  const cols = [0, 8, 38, 70, 94, 118, 140].map(dx => fieldX + dx);
  const head = ['#', 'Invoice / Bill Number', 'Invoice / Bill Received Date',
                'PO Number\n(if applicable)', 'Project Code\n(if applicable)', 'Amount'];
  const headH = 8.4;
  ink(7.2, true);
  head.forEach((text, i) => {
    grey();
    doc.rect(cols[i], y, cols[i + 1] - cols[i], headH);
    const lines = text.split('\n');
    lines.forEach((line, n) =>
      doc.text(line, (cols[i] + cols[i + 1]) / 2, y + 3.4 + n * 2.9, { align: 'center' }));
  });
  y += headH;

  // the italic line under the headings, naming what is attached to each
  const attach = ['', '- Attach Invoice / Bill -', '', '- Attach PO -', '- Attach PFS -', ''];
  doc.setFont('helvetica', 'bolditalic').setFontSize(6.4).setTextColor(...ADV_INK);
  attach.forEach((text, i) => {
    grey();
    doc.rect(cols[i], y, cols[i + 1] - cols[i], 4.2);
    if (text) doc.text(text, (cols[i] + cols[i + 1]) / 2, y + 2.9, { align: 'center' });
  });
  y += 4.2;

  for (let n = 1; n <= 5; n++) {
    const rowH = 5.6;
    for (let i = 0; i < 6; i++) {
      grey();
      doc.rect(cols[i], y, cols[i + 1] - cols[i], rowH);
    }
    ink(7.6);
    doc.text(String(n), (cols[0] + cols[1]) / 2, y + 3.7, { align: 'center' });
    if (n === 1) {
      filled(8);
      doc.text(F.invoiceNo, (cols[1] + cols[2]) / 2, y + 3.7, { align: 'center' });
      doc.text(F.received, (cols[2] + cols[3]) / 2, y + 3.7, { align: 'center' });
      doc.text('RM' + money(F.amount), cols[6] - 1.6, y + 3.7, { align: 'right' });
    }
    y += rowH;
  }

  doc.setFont('helvetica', 'bolditalic').setFontSize(5.4).setTextColor(...ADV_INK);
  doc.text('Notes: Arrange the attachments in sequence start with Invoice, Bill, PO, PFS, TRF and others.',
           cols[0], y + 4);
  ink(8.5, true);
  doc.text('TOTAL', cols[5] - 2, y + 4, { align: 'right' });
  filled(9, true);
  doc.text('RM' + money(F.amount), R - 1.6, y + 4, { align: 'right' });
  y += 7.5;

  /* ---- other details ---- */
  y = band(y, 'Other Details (If applicable)');
  y += 3;

  const rightX = R - 62;
  ink(8);
  doc.text('Details of Payment', labelX, y + 4);
  box(fieldX, y, rightX - fieldX - 10, 13, '');
  filled(8);
  doc.text(doc.splitTextToSize(F.details, rightX - fieldX - 14), fieldX + 1.6, y + 4);

  /* the charge-back table, sideways label and all */
  ink(6.6, true);
  doc.text('Charge Back To', rightX - 2.5, y + 14, { angle: 90 });
  const glX = rightX + 2, glW = R - glX;
  ink(7.4, true);
  grey();
  doc.rect(glX, y, glW * 0.42, 4.4);
  doc.rect(glX + glW * 0.42, y, glW * 0.58, 4.4);
  doc.text('GL Code', glX + glW * 0.21, y + 3.1, { align: 'center' });
  doc.text('Amount', R - 1.6, y + 3.1, { align: 'right' });
  ADV_GL.forEach((code, i) => {
    const ry = y + 4.4 + i * 4.4;
    grey();
    doc.rect(glX, ry, glW * 0.42, 4.4);
    doc.rect(glX + glW * 0.42, ry, glW * 0.58, 4.4);
    ink(7.4);
    doc.text(code, glX + glW * 0.21, ry + 3.1, { align: 'center' });
    if (code === ADV_DEPT) {
      filled(7.6);
      doc.text('RM' + money(F.amount), R - 1.6, ry + 3.1, { align: 'right' });
    }
  });

  /* The charge-back table is a heading and five codes, 4.4mm each, drawn
     from this same y. The withholding block starts under it. */
  const rightTop = y + 4.4 * 6 + 5;
  y += 16;

  doc.setFillColor(...ADV_BAND);
  doc.rect(fieldX, y, rightX - fieldX - 10, 9, 'F');
  ink(7);
  doc.text(doc.splitTextToSize(
    'For services paying to foreign beneficiary, please indicate whether services are rendered ' +
    'inside or outside Malaysia.', rightX - fieldX - 14), fieldX + 1.6, y + 3.4);
  y += 10;
  box(fieldX, y, rightX - fieldX - 10, 6, '');
  y += 10;

  ink(8);
  doc.text('Staff/ Consultant', labelX, y + 3.4);
  box(fieldX, y, rightX - fieldX - 34, 5.4, '');
  doc.setFont('helvetica', 'bolditalic').setFontSize(6.6).setTextColor(...ADV_INK);
  doc.text('- Attach TRF -', rightX - 42, y + 3.4);
  y += 9;

  ink(8);
  doc.text('Chargeable to Client', labelX, y + 3.4);
  tick(fieldX, y, false);
  ink(8);
  doc.text('Yes', fieldX + 7, y + 3.4);
  tick(fieldX + 24, y, false);
  ink(8);
  doc.text('No', fieldX + 31, y + 3.4);
  y += 9;

  ink(8);
  doc.text('Account Manager', labelX, y + 3.4);
  box(fieldX, y, rightX - fieldX - 34, 5.4, '');
  y += 9;

  ink(8);
  doc.text('Cost Category', labelX, y + 3.4);
  [['Cost of Sales', 0], ['Opex', 34], ['Fixed Asset', 58], ['Inventory', 90]].forEach(([text, dx]) => {
    tick(fieldX + dx, y, false);
    ink(8);
    doc.text(text, fieldX + dx + 7, y + 3.4);
  });
  y += 8;

  /* The right-hand column keeps its own cursor. Sharing the left one is how
     the withholding block ended up walking down into Cost Category. */
  let ry = rightTop;
  ink(7.6, true);
  doc.text('Witholding Tax', glX, ry);
  ry += 4;
  ink(7.4);
  doc.text('Yes, percentage:', glX, ry + 3.4);
  box(glX + 26, ry, R - glX - 26, 4.6, '%', { align: 'right', size: 7.4 });
  ry += 9;
  ink(7.4);
  doc.text('Verified by:', glX, ry + 3.4);
  grey();
  doc.line(glX + 16, ry + 4, R, ry + 4);
  ry += 7;
  ink(6.6);
  doc.text('(Tax Department)', R, ry, { align: 'right' });
  ry += 5;
  ink(7.4);
  doc.text('Name :', glX, ry);
  doc.text('Date  :', glX, ry + 4.4);
  ry += 8;

  y = Math.max(y, ry);

  /* ---- who prepared it, and who approved it ---- */
  y = band(y, 'Payment Advice Approval');
  y += 5;

  const colW = W / 3;
  const columns = [
    { title: 'Prepared by :', name: F.preparedName, date: F.preparedDate, sig: (S.sig || {}).pa },
    { title: 'Reviewed by :', name: '', date: '', note: '(if required)' },
    { title: 'Approved by :', name: F.approvedName, date: F.approvedDate, sig: (S.sig || {}).hod }
  ];

  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    const x = L + i * colW + 2;
    ink(8);
    doc.text(c.title, x, y);
    if (c.note) {
      ink(6.4);
      doc.text(c.note, x, y + 3);
    }
    if (c.sig) {
      try {
        const sig = await normalizeSignature(c.sig);
        if (sig) {
          const maxW = 42, maxH = 16;
          const sc = Math.min(maxW / sig.w, maxH / sig.h);
          doc.addImage(sig.url, 'PNG', x, y + 4, sig.w * sc, sig.h * sc);
        }
      } catch (err) { /* the name and the date still stand */ }
    }
    grey();
    doc.setLineDashPattern([0.7, 0.7], 0);
    doc.line(x, y + 24, x + colW - 8, y + 24);
    doc.setLineDashPattern([], 0);
    ink(7.6);
    doc.text('Name :', x, y + 27.5);
    doc.text('Date  :', x, y + 32);
    if (c.name) {
      filled(7.2);
      doc.text(c.name.toUpperCase(), x + 12, y + 27.5);
    }
    if (c.date) {
      filled(7.2);
      doc.text(c.date, x + 12, y + 32);
    }
  }
  y += 38;

  /* ---- and where it goes afterwards ---- */
  y = band(y, 'Finance Account Payable Department');
  y += 5;
  ink(8);
  doc.text('Received by :', L + 2, y);
  doc.text('Received Date :', L + colW + 2, y);

  /* ---- the form's own footer ---- */
  ink(6.4);
  doc.text('UZMA-FA01-IMS-OS01 (F01)', L, 288);
  doc.text('Rev. No. : 05', L + W / 2, 288, { align: 'center' });
  doc.text('Rev. Date: 19 Jan 2018', R, 288, { align: 'right' });

  return doc;
}

/** build it and hand it to the browser to save */
async function downloadAdvicePDF (S) {
  const doc = await buildAdvicePDF(S);
  doc.save(`${adviceFileBase(S)}.pdf`);
}

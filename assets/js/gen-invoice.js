/* =======================================================================
   gen-invoice.js — renders the Invoice as PDF (jsPDF) and Excel (ExcelJS)
   ======================================================================= */

const NAVY = [31, 56, 100];      // #1F3864
const BAR  = [47, 85, 151];      // #2F5597
const LBL  = [46, 92, 153];      // label blue
const ALT  = [242, 242, 242];    // alternating row
const LINE = [166, 178, 199];

/** the item list; when empty, build one item automatically from the invoice data */
function invoiceItems (S) {
  if (S.invoice.items.length) return S.invoice.items;
  const calc = computeAmount(S);
  return [{
    desc: 'Consultancy Service Fee',
    position: S.consultant.position,
    period: fmtPeriodShort(S.invoice.pStart, S.invoice.pEnd),
    amount: calc.amount || 0
  }];
}

function invoiceFileBase (S) {
  const no = safeFile(S.invoice.no) || 'INVOICE';
  const nm = safeFile(S.consultant.name);
  return nm ? `${no} - ${nm}` : no;
}

/* ============================ PDF ============================ */

/* Building and delivering are separate so the same page can be previewed
   on screen or written to disk, and the two can never drift apart. */
async function buildInvoicePDF (S) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  const L = 15, R = 195, W = R - L;
  const C = S.consultant, CO = S.company, IV = S.invoice;
  const items = invoiceItems(S);
  const T = invoiceTotals(S, items);

  /* ---- title band ---- */
  doc.setFillColor(...NAVY);
  doc.rect(L, 12, W, 28, 'F');
  doc.setTextColor(255, 255, 255).setFont('helvetica', 'bold').setFontSize(26);
  doc.text('INVOICE', R - 6, 31, { align: 'right' });

  /* ---- left / right detail block ---- */
  let y = 50;
  const RH = 5.6;
  const label = (t, x, yy) => {
    doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(...LBL);
    doc.text(t, x, yy);
  };
  const value = (t, x, yy, align) => {
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(30, 30, 30);
    doc.text(String(t || ''), x, yy, align ? { align } : undefined);
  };

  /**
   * Draw label/value rows, wrapping any value that is wider than `maxW`
   * onto further lines instead of letting it run into the next column.
   * Returns the y just past the block.
   */
  const LH = 4;                                     // wrapped-line spacing
  const drawRows = (rows, labelX, valueX, maxW, startY, align) => {
    let yy = startY;
    rows.forEach(r => {
      if (r[0]) label(r[0], labelX, yy);
      doc.setFont('helvetica', 'normal').setFontSize(8.5);
      const lines = doc.splitTextToSize(String(r[1] || ''), maxW);
      lines.forEach((ln, k) => value(ln, valueX, yy + k * LH, align));
      yy += RH + Math.max(0, lines.length - 1) * LH;
    });
    return yy;
  };

  const VAL_X = L + 30;                             // where values start
  const RIGHT_LBL_X = L + 100;                      // where the right column starts
  const LEFT_W = RIGHT_LBL_X - VAL_X - 4;           // 66 mm before it would collide
  const RIGHT_W = R - RIGHT_LBL_X - 24;

  const leftEnd = drawRows([
    ['Consultant:', C.name],
    ['IC No.:', C.ic],
    ['Position:', C.position],
    ['Address:', C.addr1],
    ['', C.addr2]
  ], L, VAL_X, LEFT_W, y);

  const rightEnd = drawRows([
    ['Invoice No.:', IV.no],
    ['Invoice Date:', fmtDMY(IV.date)],
    ['Period:', fmtPeriod(IV.pStart, IV.pEnd)],
    ['Due Date:', fmtDMY(IV.due)]
  ], RIGHT_LBL_X, R, RIGHT_W, y, 'right');

  y = Math.max(leftEnd, rightEnd) + 3;

  /* ---- BILL TO ---- */
  const bar = (text, yy) => {
    doc.setFillColor(...BAR);
    doc.rect(L, yy, W, 5.6, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(255, 255, 255);
    doc.text(text, L + 2, yy + 3.9);
  };
  bar('BILL TO', y);
  y += 9.5;
  y = drawRows([
    ['Company:', CO.name], ['Company No.:', CO.regNo],
    ['Address:', CO.addr1], ['', CO.addr2]
  ], L, VAL_X, R - VAL_X, y) + 3;

  /* ---- item table ---- */
  /* No Position column: it was the same on every line, and it is now said
     once at the top with the rest of who the invoice is from. */
  const rows = items.map((it, i) => [
    String(i + 1), it.desc || '', it.period || '',
    it.amount === '' || it.amount == null ? '' : money(it.amount)
  ]);
  while (rows.length < 4) rows.push(['', '', '', '']);   // blank rows, as in the template

  doc.autoTable({
    startY: y,
    head: [['#', 'Description', 'Period', 'Amount (RM)']],
    body: rows,
    theme: 'grid',
    margin: { left: L, right: 210 - R },
    tableWidth: W,
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.8, lineColor: LINE, lineWidth: 0.2,
              textColor: [30, 30, 30], overflow: 'linebreak', valign: 'middle', minCellHeight: 7 },
    headStyles: { fillColor: BAR, textColor: 255, fontStyle: 'bold', halign: 'center', fontSize: 8.5 },
    alternateRowStyles: { fillColor: ALT },
    columnStyles: {
      0: { cellWidth: 18, halign: 'center' },
      1: { cellWidth: 84 },
      2: { cellWidth: 44 },
      3: { cellWidth: 34, halign: 'right' }
    }
  });
  y = doc.lastAutoTable.finalY + 4;

  /* ---- totals summary ---- */
  const boxX = R - 40, boxW = 40, rowH = 6;
  const totRow = (lab, val, filled) => {
    doc.setFont('helvetica', filled ? 'bold' : 'normal').setFontSize(8.5);
    doc.setTextColor(...(filled ? [255, 255, 255] : LBL));
    if (filled) { doc.setFillColor(...NAVY); doc.rect(boxX - 42, y, 42 + boxW, rowH, 'F'); }
    doc.text(lab, boxX - 2, y + 4.2, { align: 'right' });
    if (!filled) {
      doc.setFillColor(...ALT); doc.setDrawColor(...LINE);
      doc.rect(boxX, y, boxW, rowH, 'FD');
      doc.setTextColor(30, 30, 30);
    }
    doc.text(String(val), boxX + boxW - 2, y + 4.2, { align: 'right' });
    y += rowH;
  };
  totRow('Subtotal', money(T.sub), false);
  totRow(`Tax (${Number(IV.taxPct) || 0}%)`, money(T.tax), false);
  totRow('TOTAL DUE', money(T.total), true);
  y += 6;

  /* ---- payment details ---- */
  bar('PAYMENT DETAILS', y);
  y += 9.5;
  y = drawRows([
    ['Bank:', C.bank], ['Account Name:', C.accName], ['Account No.:', C.accNo]
  ], L, VAL_X, R - VAL_X, y) + 6;

  /* ---- the consultant's signature ----

     The one signature an invoice carries. Nobody approving a bill signs it,
     so this is not a choice to be offered: an invoice from somebody who has
     a signature on their profile goes out with it on. */
  if (S.sig.personnel) {
    const sig = await normalizeSignature(S.sig.personnel);
    if (sig) {
      const maxW = 45, maxH = 18;
      const sc = Math.min(maxW / sig.w, maxH / sig.h);
      doc.addImage(sig.url, 'PNG', L, y, sig.w * sc, sig.h * sc);
      y += maxH + 1;
      doc.setDrawColor(120, 120, 120).setLineWidth(0.2).line(L, y, L + 55, y);
      y += 4;
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(30, 30, 30);
      doc.text(C.name || '', L, y);
      doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(110, 110, 110);
      doc.text('Consultant', L, y + 3.6);
      y += 10;
    }
  }

  /* ---- note ---- */
  if (IV.note) {
    doc.setFont('helvetica', 'italic').setFontSize(7.5).setTextColor(110, 110, 110);
    doc.text(doc.splitTextToSize(IV.note, W), L, Math.max(y, 262));
  }

  return doc;
}

async function generateInvoicePDF (S) {
  const doc = await buildInvoicePDF(S);
  doc.save(`${invoiceFileBase(S)}.pdf`);
}

/* ============================ EXCEL ============================ */

async function generateInvoiceXLSX (S) {
  const C = S.consultant, CO = S.company, IV = S.invoice;
  const items = invoiceItems(S);
  const T = invoiceTotals(S, items);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sistem Consultant Claim';
  wb.created = new Date();
  const ws = wb.addWorksheet('Invoice', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
                 margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } }
  });

  ws.columns = [
    { width: 6 }, { width: 16 }, { width: 20 }, { width: 14 },
    { width: 14 }, { width: 14 }, { width: 16 }
  ];

  const ARGB = { navy: 'FF1F3864', bar: 'FF2F5597', lbl: 'FF2E5C99', alt: 'FFF2F2F2', line: 'FFA6B2C7' };
  const thin = { style: 'thin', color: { argb: ARGB.line } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };

  const put = (addr, val, opt) => {
    const c = ws.getCell(addr);
    c.value = val;
    if (opt) Object.assign(c, opt);
    return c;
  };
  const labelCell = (addr, text) => put(addr, text, {
    font: { bold: true, size: 9, color: { argb: ARGB.lbl } }, alignment: { vertical: 'middle' }
  });
  const valueCell = (addr, text, align) => put(addr, text == null ? '' : text, {
    font: { size: 9 },
    alignment: { vertical: 'middle', horizontal: align || 'left', wrapText: true }
  });
  const barRow = (row, text) => {
    ws.mergeCells(`A${row}:G${row}`);
    put(`A${row}`, text, {
      font: { bold: true, size: 9, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.bar } },
      alignment: { vertical: 'middle' }
    });
    ws.getRow(row).height = 16;
  };

  /* ---- title band ---- */
  ws.mergeCells('A1:G3');
  put('A1', 'INVOICE', {
    font: { bold: true, size: 26, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.navy } },
    alignment: { vertical: 'middle', horizontal: 'right' }
  });
  ws.getRow(1).height = 22; ws.getRow(2).height = 22; ws.getRow(3).height = 22;

  /* ---- details ---- */
  const left = [['Consultant:', C.name], ['IC No.:', C.ic], ['Position:', C.position],
                ['Address:', C.addr1], ['', C.addr2]];
  const right = [['Invoice No.:', IV.no], ['Invoice Date:', fmtDMY(IV.date)],
                 ['Period:', fmtPeriod(IV.pStart, IV.pEnd)], ['Due Date:', fmtDMY(IV.due)]];
  left.forEach((r, i) => {
    const row = 5 + i;
    if (r[0]) labelCell(`A${row}`, r[0]);
    ws.mergeCells(`B${row}:D${row}`);
    valueCell(`B${row}`, r[1]);
  });
  right.forEach((r, i) => {
    const row = 5 + i;
    labelCell(`E${row}`, r[0]);
    ws.mergeCells(`F${row}:G${row}`);
    valueCell(`F${row}`, r[1], 'right');
  });

  barRow(10, 'BILL TO');
  [['Company:', CO.name], ['Company No.:', CO.regNo], ['Address:', CO.addr1], ['', CO.addr2]]
    .forEach((r, i) => {
      const row = 11 + i;
      if (r[0]) labelCell(`A${row}`, r[0]);
      ws.mergeCells(`B${row}:G${row}`);
      valueCell(`B${row}`, r[1]);
    });

  /* ---- item table ---- */
  const headRow = 16;
  const heads = ['#', 'Description', 'Period', 'Amount (RM)'];
  ws.mergeCells(`B${headRow}:D${headRow}`);
  ws.mergeCells(`E${headRow}:F${headRow}`);
  [['A', heads[0]], ['B', heads[1]], ['E', heads[2]], ['G', heads[3]]]
    .forEach(([col, txt]) => put(`${col}${headRow}`, txt, {
      font: { bold: true, size: 9, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.bar } },
      alignment: { horizontal: 'center', vertical: 'middle' }, border: box
    }));
  ws.getRow(headRow).height = 16;
  ['C', 'D', 'F'].forEach(c => { ws.getCell(`${c}${headRow}`).border = box; });

  const bodyRows = Math.max(4, items.length);
  for (let i = 0; i < bodyRows; i++) {
    const row = headRow + 1 + i;
    const it = items[i];
    ws.mergeCells(`B${row}:D${row}`);
    ws.mergeCells(`E${row}:F${row}`);
    const shade = i % 2 === 1
      ? { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.alt } } : undefined;
    const cells = {
      A: it ? i + 1 : '', B: it ? (it.desc || '') : '',
      E: it ? (it.period || '') : '', G: it ? Number(it.amount) || 0 : ''
    };
    ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach(col => {
      const c = ws.getCell(`${col}${row}`);
      if (cells[col] !== undefined) c.value = cells[col];
      c.font = { size: 9 };
      c.border = box;
      if (shade) c.fill = shade;
      if (col === 'A') c.alignment = { horizontal: 'center' };
      if (col === 'G') { c.alignment = { horizontal: 'right' }; c.numFmt = '#,##0.00'; }
    });
  }

  /* ---- totals ---- */
  let r = headRow + bodyRows + 1;
  const totalsDef = [
    ['Subtotal', T.sub, false],
    [`Tax (${Number(IV.taxPct) || 0}%)`, T.tax, false],
    ['TOTAL DUE', T.total, true]
  ];
  totalsDef.forEach(([lab, val, strong]) => {
    ws.mergeCells(`E${r}:F${r}`);
    put(`E${r}`, lab, {
      font: { bold: strong, size: 9, color: { argb: strong ? 'FFFFFFFF' : ARGB.lbl } },
      alignment: { horizontal: 'right', vertical: 'middle' },
      fill: strong ? { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.navy } } : undefined
    });
    put(`G${r}`, val, {
      font: { bold: strong, size: 9, color: { argb: strong ? 'FFFFFFFF' : 'FF1B2330' } },
      alignment: { horizontal: 'right', vertical: 'middle' },
      numFmt: '#,##0.00', border: box,
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: strong ? ARGB.navy : ARGB.alt } }
    });
    ws.getRow(r).height = 15;
    r++;
  });

  /* ---- payment details ---- */
  r += 1;
  barRow(r, 'PAYMENT DETAILS');
  r++;
  [['Bank:', C.bank], ['Account Name:', C.accName], ['Account No.:', C.accNo]].forEach(([l, v]) => {
    labelCell(`A${r}`, l);
    ws.mergeCells(`B${r}:G${r}`);
    valueCell(`B${r}`, v);
    r++;
  });

  /* ---- the consultant's signature, as on the PDF ---- */
  if (S.sig.personnel) {
    const sig = await normalizeSignature(S.sig.personnel);
    if (sig) {
      r += 1;
      const imgId = wb.addImage({ base64: sig.url, extension: 'png' });
      const scale = Math.min(170 / sig.w, 60 / sig.h);
      ws.addImage(imgId, { tl: { col: 0, row: r - 1 }, ext: { width: sig.w * scale, height: sig.h * scale } });
      r += 4;
      put(`A${r}`, C.name || '', { font: { bold: true, size: 9 } });
      put(`A${r + 1}`, 'Consultant', { font: { size: 8, color: { argb: 'FF6B7686' } } });
      r += 2;
    }
  }

  /* ---- note ---- */
  r += 1;
  ws.mergeCells(`A${r}:G${r}`);
  put(`A${r}`, IV.note || '', {
    font: { italic: true, size: 8, color: { argb: 'FF6B7686' } },
    alignment: { wrapText: true, vertical: 'top' }
  });
  ws.getRow(r).height = 24;

  const buf = await wb.xlsx.writeBuffer();
  saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
         `${invoiceFileBase(S)}.xlsx`);
}

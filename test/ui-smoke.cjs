/* Local UI smoke audit. Run with Node 24 and an installed Chromium browser.
 * All data is synthetic; external browser requests are blocked. No npm deps.
 * Screenshots and the JSON report are written to an OS temporary directory.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUTPUT = fs.mkdtempSync(path.join(os.tmpdir(), 'claim-ui-audit-'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const option = name => process.argv.find(arg => arg.startsWith('--' + name + '='))?.split('=').slice(1).join('=');
const cropOnly = process.argv.includes('--crop-only');
const fixtures = `
window.fetch = async () => { throw new Error('External requests disabled in local UI audit'); };
if (new URLSearchParams(location.search).get('role') !== 'login') {
  const auditRole = new URLSearchParams(location.search).get('role') || 'admin';
  const auditEmail = ['admin', 'consultant'].includes(auditRole) ? 'demo@example.test' : auditRole + '@example.test';
  currentRole = () => auditRole;
  storedUser = () => ({ name: 'Demo ' + auditRole, email: auditEmail });
  Auth.user = storedUser;
  Auth.token = () => 'LOCAL-UI-AUDIT';
  Auth.role = currentRole;
  Auth.email = () => auditEmail;
  Auth.owns = p => auditRole !== 'consultant' || p.consultant.email === 'demo@example.test';
  Auth.start = boot => {
    document.getElementById('authGate').hidden = true;
    document.body.classList.remove('locked');
    const who = document.getElementById('authWho');
    who.textContent = 'Demo ' + Auth.roleName(); who.hidden = false;
    document.getElementById('btnSignOut').hidden = false;
    boot();
  };
  const demo = defaultState();
  Object.assign(demo.consultant, {
    name: 'Aiman Abdullah', email: 'demo@example.test', uniqueId: '01', claimSeq: 1,
    ic: '010203-04-0567', position: 'Geospatial Consultant', position2: 'CONSULTANT',
    addr1: '12 Example Road', addr2: '40000 Shah Alam, Selangor',
    bank: 'Example Bank', accName: 'Aiman Abdullah', accNo: '0000 0000 0000'
  });
  demo.mode = 'both';
  demo.invoice.monthlyRate = 4500;
  demo.project.name = 'Coastal Mapping Programme';
  demo.project.client = 'Example Client';
  demo.timesheet.activities[0].name = 'GIS analysis and project coordination';
  demo.timesheet.month = 8; demo.timesheet.year = 2026;
  const signatureCanvas = document.createElement('canvas');
  signatureCanvas.width = 220; signatureCanvas.height = 65;
  const ink = signatureCanvas.getContext('2d');
  ink.font = 'italic 30px serif'; ink.fillText('Aiman', 18, 43);
  demo.sig.personnel = signatureCanvas.toDataURL();
  Store.clearAll(); Store.saveProfile(demo.consultant.name, demo); Store.saveCurrent(demo);
  const statuses = ['pending_manager', 'pending_boss', 'pending_signature', 'complete', 'returned'];
  const demoSubs = statuses.map((status, index) => {
    const data = structuredClone(demo);
    const name = ['Aiman Abdullah', 'Farah Syahirah', 'Nur Aisyah', 'Muhammad Daniel', 'Aiman Abdullah'][index];
    data.consultant.name = name;
    if (index > 0 && index < 4) data.consultant.email = 'other' + index + '@example.test';
    Store.saveProfile(name, data);
    return {
      id: index + 1, consultant: name, kind: index === 4 ? 'invoice' : 'claim', status,
      consultant_email: data.consultant.email, email: data.consultant.email,
      period_month: 9, period_year: 2026, invoice_no: '2026-01-00' + (index + 1),
      submitted_by: 'demo@example.test', created_by: 'demo@example.test', created_at: '2026-09-12T04:00:00Z',
      updated_at: '2026-09-13T04:00:00Z', total: 4500, amount: 4500,
      note: 'September consulting services', return_note: 'Please confirm the invoice date before resubmitting.',
      history: [{ action: 'return', note: 'Please confirm the invoice date before resubmitting.', at: '2026-09-13T04:00:00Z' }],
      data
    };
  });
  const demoArchive = [{
    id: 1, consultant: 'Muhammad Daniel', period_month: 9, period_year: 2026,
    kind: 'claim', stage: 'pending_signature', invoice_no: '2026-01-004', submission_id: 4,
    created_by: 'pa@example.test',
    created_at: '2026-09-13T04:00:00Z', updated_at: '2026-09-13T04:00:00Z',
    files: [{ name: 'September 2026 - Muhammad Daniel - Signed time sheet.pdf', type: 'application/pdf', content: 'JVBERi0xLjQKJSBsb2NhbCBhdWRpdAo=' }],
    data: demoSubs[3].data
  }];
  demoArchive.push({ ...demoArchive[0], id: 2, kind: 'invoice', files: [{
    ...demoArchive[0].files[0], name: 'September 2026 - Muhammad Daniel - Approved invoice.pdf'
  }] });
  Object.assign(Sync, {
    init: async () => { syncOn = true; probed = true; return { on: true, adopted: false, gained: 0 }; },
    submissions: async status => demoSubs.filter(s => !status || s.status === status),
    submission: async id => demoSubs.find(s => String(s.id) === String(id)),
    stored: async () => demoArchive,
    storedOne: async () => demoArchive[0],
    history: async () => [], me: async () => ({ role: auditRole }),
    pushDraft: () => {}, pushProfile: () => {}, deleteProfile: async () => {},
    recordClaim: async () => {}, submit: async () => { throw new Error('Submission disabled in UI audit'); },
    act: async () => { throw new Error('Approval disabled in UI audit'); },
    store: async () => { throw new Error('Archive writes disabled in UI audit'); }
  });
}
`;

async function auditCropper({ command, evaluate, pressKey, width, report }) {
  const mobile = width < 500;
  const check = (test, passed, detail = {}) => {
    const result = { width, input: mobile ? 'touch' : 'mouse', test, passed, ...detail };
    report.interactions.push(result);
    console.log(JSON.stringify({ width, input: result.input, test, passed }));
  };
  await command('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 1 });
  await evaluate(`(() => {
    const panel = document.querySelector('.panel.active');
    panel.innerHTML = '<h2>Signature crop interaction audit</h2><div id="cropAudit"></div>';
    window.auditSignatureState = { sig: { personnel: '' } };
    window.auditSignatureSaved = 0;
    window.auditCanvas = document.createElement('canvas');
    auditCanvas.width = 960; auditCanvas.height = 640;
    const context = auditCanvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, 960, 640);
    context.strokeStyle = '#172d46'; context.lineWidth = 12;
    context.beginPath(); context.moveTo(300, 320); context.lineTo(350, 245);
    context.lineTo(420, 360); context.lineTo(480, 250); context.lineTo(580, 350);
    context.lineTo(660, 270); context.stroke();
    buildCropper(document.getElementById('cropAudit'), auditCanvas, auditSignatureState, () => auditSignatureSaved++);
    window.auditPointerTrace = [];
    const cropWrap = document.querySelector('#cropAudit .cropwrap');
    for (const type of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture']) {
      for (const capture of [true, false]) cropWrap.addEventListener(type, event => {
        const record = { type, phase: capture ? 'before' : 'after', pointerId: event.pointerId,
          tag: event.target.tagName, cls: event.target.className,
          handle: event.target.closest('[data-resize]')?.dataset.resize || '',
          x: event.clientX, y: event.clientY, hasCapture: cropWrap.hasPointerCapture(event.pointerId),
          dragging: cropWrap.classList.contains('dragging') };
        if (type === 'pointerdown' && capture) window.auditPointerLast = record;
        auditPointerTrace.push(record);
      }, capture);
    }
    document.getElementById('toast').className = 'toast';
    document.querySelector('.cropwrap').scrollIntoView({ block: 'center' });
  })()`);
  const waitPreview = async () => {
    for (let i = 0; i < 80; i++) {
      if (await evaluate('!!document.querySelector("#cropAudit .croppreview img").getAttribute("src") && !document.querySelector("#cropAudit [data-a=use]").disabled')) return true;
      await delay(25);
    }
    return false;
  };
  await waitPreview();
  const rects = () => evaluate(`(() => {
    const box = document.querySelector('#cropAudit .cropbox').getBoundingClientRect();
    const canvas = auditCanvas.getBoundingClientRect();
    return {
      x: box.left - canvas.left, y: box.top - canvas.top, w: box.width, h: box.height,
      left: box.left, top: box.top, cx: box.left + box.width / 2, cy: box.top + box.height / 2,
      canvas: { left: canvas.left, top: canvas.top, w: canvas.width, h: canvas.height },
      disabled: document.querySelector('#cropAudit [data-a=use]').disabled,
      pointer: window.auditPointerLast, hitBefore: window.auditHitBefore, trace: window.auditPointerTrace.slice(-30)
    };
  })()`);
  const pointer = async (phase, x, y) => {
    if (phase === 'start') await evaluate(`(() => { auditPointerTrace=[]; const el=document.elementFromPoint(${x},${y}); window.auditHitBefore={x:${x},y:${y},tag:el?.tagName,cls:el?.className,handle:el?.closest('[data-resize]')?.dataset.resize || ''}; })()`);
    if (mobile) {
      await command('Input.dispatchTouchEvent', {
        type: { start: 'touchStart', move: 'touchMove', end: 'touchEnd', cancel: 'touchCancel' }[phase],
        touchPoints: phase === 'end' || phase === 'cancel' ? [] : [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }]
      });
    } else {
      await command('Input.dispatchMouseEvent', {
        type: { start: 'mousePressed', move: 'mouseMoved', end: 'mouseReleased' }[phase],
        x, y, button: 'left', buttons: phase === 'end' ? 0 : 1,
        clickCount: phase === 'move' ? 0 : 1
      });
    }
  };
  const drag = async (from, to) => {
    await pointer('start', from.x, from.y);
    await pointer('move', to.x, to.y);
    await pointer('end', to.x, to.y);
    await waitPreview();
  };
  const sameBox = (a, b) => ['x', 'y', 'w', 'h'].every(key => Math.abs(a[key] - b[key]) < 1.5);
  const inside = box => box.x >= -1 && box.y >= -1 && box.x + box.w <= box.canvas.w + 1 && box.y + box.h <= box.canvas.h + 1;
  const handles = await evaluate('[...document.querySelectorAll("#cropAudit [data-resize]")].map(el => el.dataset.resize).sort()');
  check('Eight accessible resize handles', handles.join(',') === 'e,n,ne,nw,s,se,sw,w' && await evaluate('[...document.querySelectorAll("#cropAudit [data-resize]")].every(el => el.tagName === "BUTTON" && !!el.getAttribute("aria-label"))'), { handles });

  let before = await rects();
  await pointer('start', before.cx, before.cy);
  await pointer('end', before.cx, before.cy);
  await waitPreview();
  check('Tap preserves selected rectangle', sameBox(before, await rects()));

  before = await rects();
  await pointer('start', before.cx, before.cy);
  check('Use is disabled during a gesture', (await rects()).disabled);
  await pointer('move', before.cx + 15, before.cy + 12);
  await pointer('end', before.cx + 15, before.cy + 12);
  await waitPreview();
  let after = await rects();
  check('Drag inside moves without resizing', Math.abs(after.x - before.x - 15) < 2 && Math.abs(after.y - before.y - 12) < 2 && Math.abs(after.w - before.w) < 1.5 && Math.abs(after.h - before.h) < 1.5, { before, after });

  for (const handle of ['e', 'w', 'n', 's', 'nw', 'ne', 'sw', 'se']) {
    before = await rects();
    const point = await evaluate(`(() => { const r = document.querySelector('#cropAudit [data-resize="${handle}"]').getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()`);
    const dx = handle.includes('e') ? 5 : handle.includes('w') ? -5 : 0;
    const dy = handle.includes('s') ? 5 : handle.includes('n') ? -5 : 0;
    await drag(point, { x: point.x + dx, y: point.y + dy });
    after = await rects();
    check('Resize ' + handle.toUpperCase() + ' changes the intended edges',
      (!dx || after.w > before.w + 2) && (!dy || after.h > before.h + 2) &&
      (dx || Math.abs(after.w - before.w) < 1.5) && (dy || Math.abs(after.h - before.h) < 1.5) && inside(after), { before, after });
  }

  before = await rects();
  const outside = { x: before.canvas.left + 8, y: before.canvas.top + 8 };
  await pointer('start', outside.x, outside.y);
  await pointer('end', outside.x, outside.y);
  await waitPreview();
  check('Tap outside preserves the existing rectangle', sameBox(before, await rects()));
  const drawTo = { x: outside.x + before.canvas.w * .23, y: outside.y + before.canvas.h * .19 };
  await drag(outside, drawTo);
  after = await rects();
  check('Dragging outside creates a new rectangle', Math.abs(after.x - 8) < 2 && Math.abs(after.y - 8) < 2 && after.w < before.w && after.h < before.h);

  before = await rects();
  const boundTo = { x: before.canvas.left + before.canvas.w + 40, y: before.canvas.top + before.canvas.h + 40 };
  await drag({ x: before.cx, y: before.cy }, boundTo);
  after = await rects();
  check('Moving reaches the image bounds and preserves size', inside(after) && Math.abs(after.x + after.w - after.canvas.w) < 2 && Math.abs(after.y + after.h - after.canvas.h) < 2 && Math.abs(after.w - before.w) < 1.5 && Math.abs(after.h - before.h) < 1.5, { before, after });

  before = await rects();
  await pointer('start', before.cx, before.cy);
  await pointer('move', before.cx - 25, before.cy - 25);
  await pressKey('Escape', 'Escape', 27);
  await pointer('end', before.cx - 25, before.cy - 25);
  await waitPreview();
  check('Escape restores the rectangle before a gesture', sameBox(before, await rects()));
  if (mobile) {
    before = await rects();
    await pointer('start', before.cx, before.cy);
    await pointer('move', before.cx - 20, before.cy - 20);
    await pointer('cancel', before.cx - 20, before.cy - 20);
    await waitPreview();
    check('Touch cancellation restores the original rectangle', sameBox(before, await rects()));
  }

  before = await rects();
  const thinFrom = { x: before.canvas.left + before.canvas.w * .2, y: before.canvas.top + before.canvas.h * .6 };
  await drag(thinFrom, { x: thinFrom.x + Math.min(160, before.canvas.w * .45), y: thinFrom.y + 18 });
  before = await rects();
  await drag({ x: before.cx, y: before.cy }, { x: before.cx + 10, y: before.cy - 6 });
  after = await rects();
  check('The center of a thin crop remains draggable between overlapping handles',
    Math.abs(after.x - before.x - 10) < 2 && Math.abs(after.y - before.y + 6) < 2 &&
    Math.abs(after.w - before.w) < 1.5 && Math.abs(after.h - before.h) < 1.5, { before, after });

  before = await rects();
  await evaluate('document.querySelector("#cropAudit .cropbox").focus()');
  await pressKey('ArrowLeft', 'ArrowLeft', 37);
  await waitPreview();
  after = await rects();
  check('Keyboard arrow moves the selection', after.x < before.x && Math.abs(after.w - before.w) < 1.5);
  before = after;
  await pressKey('ArrowLeft', 'ArrowLeft', 37, 8);
  await waitPreview();
  after = await rects();
  check('Shift arrow resizes the selection', after.w < before.w && Math.abs(after.x - before.x) < 1.5);
  before = after;
  await evaluate('document.querySelector("#cropAudit [data-resize=w]").focus()');
  await pressKey('ArrowRight', 'ArrowRight', 39);
  await waitPreview();
  after = await rects();
  check('Resize handle keyboard changes its edge', after.x > before.x && after.w < before.w);

  const resizedWidth = mobile ? 360 : 1100;
  before = await rects();
  await command('Emulation.setDeviceMetricsOverride', { width: resizedWidth, height: mobile ? 844 : 960, deviceScaleFactor: 1, mobile });
  await delay(100);
  after = await rects();
  check('Viewport resize keeps the crop aligned to the image', ['x', 'y', 'w', 'h'].every(key => Math.abs(before[key] / before.canvas.w - after[key] / after.canvas.w) < .006));
  await command('Emulation.setDeviceMetricsOverride', { width, height: mobile ? 844 : 960, deviceScaleFactor: 1, mobile });
  await delay(100);

  // Leave the visual artifact on the synthetic ink rather than the blank
  // corner used for the boundary checks.
  before = await rects();
  await drag({ x: before.canvas.left + before.canvas.w * .28, y: before.canvas.top + before.canvas.h * .33 },
    { x: before.canvas.left + before.canvas.w * .73, y: before.canvas.top + before.canvas.h * .6 });

  const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const filename = width + '-signature-crop.png';
  fs.writeFileSync(path.join(OUTPUT, filename), Buffer.from(screenshot.data, 'base64'));
  report.screens.push({ width, role: 'admin', panel: 'signature-crop', screenshot: filename,
    documentWidth: await evaluate('document.documentElement.scrollWidth'), unnamedButtons: [], unlabeledFields: [] });
  // Resolve two preview jobs out of order to reproduce a slow image decode.
  // The replacement returns only synthetic swatches in this isolated fixture.
  await evaluate(`(() => {
    window.auditPreviewJobs = [];
    cropToSignature = () => new Promise(resolve => {
      const swatch = document.createElement('canvas'); swatch.width = 40; swatch.height = 20;
      const ctx = swatch.getContext('2d');
      ctx.fillStyle = auditPreviewJobs.length ? '#187d48' : '#8f2530';
      ctx.fillRect(0, 0, 40, 20);
      auditPreviewJobs.push({ resolve, url: swatch.toDataURL() });
    });
    document.querySelector('#cropAudit .cropbox').focus();
  })()`);
  const waitJobs = async count => {
    for (let i = 0; i < 80; i++) {
      if (await evaluate('auditPreviewJobs.length >= ' + count)) return true;
      await delay(25);
    }
    return false;
  };
  await pressKey('ArrowLeft', 'ArrowLeft', 37);
  const firstJob = await waitJobs(1);
  check('Use is disabled while a replacement preview is pending', firstJob && (await rects()).disabled);
  await evaluate('document.querySelector("#cropAudit [data-a=use]").click()');
  check('Pending preview cannot save an earlier crop', await evaluate('auditSignatureSaved === 0'));
  await pressKey('ArrowUp', 'ArrowUp', 38);
  await delay(35);
  const concurrentJobs = await evaluate('auditPreviewJobs.length > 1');
  if (firstJob && !concurrentJobs) {
    await evaluate('auditPreviewJobs[0].resolve(auditPreviewJobs[0].url)');
    await delay(25);
    check('A superseded preview stays unavailable while the latest crop renders',
      await evaluate('document.querySelector("#cropAudit .croppreview img").src !== auditPreviewJobs[0].url && document.querySelector("#cropAudit [data-a=use]").disabled'));
  }
  const secondJob = await waitJobs(2);
  if (firstJob && secondJob) {
    await evaluate('auditPreviewJobs[1].resolve(auditPreviewJobs[1].url)');
    await waitPreview();
    if (concurrentJobs) await evaluate('auditPreviewJobs[0].resolve(auditPreviewJobs[0].url)');
    await delay(30);
    check('Late preview completion cannot replace the newest selection', await evaluate('document.querySelector("#cropAudit .croppreview img").src === auditPreviewJobs[1].url'));
  } else {
    check('Two separate crop changes schedule fresh previews', false, { firstJob, secondJob });
  }
  const kept = await evaluate(`(() => {
    const expected = document.querySelector('#cropAudit .croppreview img').src;
    document.querySelector('#cropAudit [data-a=use]').click();
    return { samePreview: auditSignatureState.sig.personnel === expected, saves: auditSignatureSaved };
  })()`);
  check('Use saves exactly the displayed preview once', kept.samePreview && kept.saves === 1, kept);

  await evaluate(`(() => {
    const host = document.createElement('div'); host.id = 'signatureLifecycleAudit';
    document.querySelector('.panel.active').appendChild(host);
    window.auditOldUploadState = { sig: { personnel: '' } };
    window.auditReplacementState = { sig: { personnel: '' } };
    window.auditLifecycleSaves = 0;
    uploadToCanvas = () => new Promise(resolve => { window.auditResolveUpload = resolve; });
    mountProfileSignature(host, auditOldUploadState, () => auditLifecycleSaves++);
    const input = host.querySelector('input[type=file]');
    const files = new DataTransfer();
    files.items.add(new File(['synthetic input'], 'local-crop-audit.png', { type: 'image/png' }));
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    window.auditOldCrop = host.querySelector('.sigcrop');
    mountProfileSignature(host, auditReplacementState, () => auditLifecycleSaves++);
    auditResolveUpload(auditCanvas);
  })()`);
  await delay(50);
  check('An upload finishing after the signature panel is rebuilt stays discarded', await evaluate(`(() => {
    const host = document.getElementById('signatureLifecycleAudit');
    return host.isConnected && !auditOldCrop.isConnected && !auditOldCrop.querySelector('.cropwrap') &&
      !host.querySelector('.cropwrap') && host.querySelector('.sigcrop').hidden &&
      !auditOldUploadState.sig.personnel && !auditReplacementState.sig.personnel && auditLifecycleSaves === 0;
  })()`));
}

async function auditDisclosures({ evaluate, pressKey, width, role, panel, report }) {
  const check = (test, passed, detail = {}) => {
    report.interactions.push({ width, role, panel, test, passed, ...detail });
    console.log(JSON.stringify({ width, role, panel, test, passed }));
  };
  const scope = panel === 'login' ? '.auth-card' : '.panel.active';
  const helpSelector = scope + ' details.help-disclosure';
  const help = await evaluate(`(() => {
    return [...document.querySelectorAll(${JSON.stringify(helpSelector)})].map((details, index) => ({
      index,
      name: details.querySelector('summary')?.textContent.trim(),
      visible: details.querySelector('summary')?.checkVisibility() || false,
      closed: !details.open,
      contentHidden: !!details.querySelector('.help-content') && !details.querySelector('.help-content').checkVisibility()
    })).filter(item => item.visible);
  })()`);
  if (['login', 'consultant', 'invoice', 'claim'].includes(panel)) {
    check('Contextual help is available', help.length > 0);
  }
  for (const item of help) {
    const target = `document.querySelectorAll(${JSON.stringify(helpSelector)})[${item.index}]`;
    check(item.name + ' starts collapsed', item.closed && item.contentHidden);
    await evaluate(`${target}.querySelector('summary').focus()`);
    await pressKey('Enter', 'Enter', 13);
    const opened = await evaluate(`(() => {
      const details = ${target};
      const summary = details.querySelector('summary');
      const content = details.querySelector('.help-content');
      const rect = content.getBoundingClientRect();
      return {
        open: details.open,
        visible: content.checkVisibility(),
        focused: document.activeElement === summary,
        left: rect.left, right: rect.right, contentRectWidth: rect.width,
        contentWidth: content.scrollWidth, availableWidth: content.clientWidth,
        documentWidth: document.documentElement.scrollWidth, viewport: innerWidth
      };
    })()`);
    check(item.name + ' opens with Enter', opened.open && opened.visible && opened.focused, opened);
    check(item.name + ' expanded content fits the viewport',
      opened.contentRectWidth > 0 && opened.left >= -2 && opened.right <= opened.viewport + 2 &&
      opened.contentWidth <= opened.availableWidth + 2 && opened.documentWidth <= opened.viewport + 2,
      opened);
    await pressKey(' ', 'Space', 32);
    const closed = await evaluate(`(() => {
      const details = ${target};
      return { closed: !details.open, hidden: !details.querySelector('.help-content').checkVisibility(),
        focused: document.activeElement === details.querySelector('summary') };
    })()`);
    check(item.name + ' closes with Space', closed.closed && closed.hidden && closed.focused, closed);
    // A failed interaction must not leave another screenshot expanded.
    await evaluate(`${target}.open = false`);
  }

  if (panel === 'consultant') {
    const leave = await evaluate(`(() => {
      const host = document.getElementById('leaveBoxProfile');
      const table = host?.querySelector('.leavetable');
      if (!host?.checkVisibility() || !table) return { passed: false, missingLeaveTable: true };
      const bounds = host.getBoundingClientRect();
      const left = bounds.left + host.clientLeft;
      const right = left + host.clientWidth;
      const fits = rect => rect.width > 0 && rect.left >= left - 1 && rect.right <= right + 1;
      const tableRect = table.getBoundingClientRect();
      const lastColumn = [...table.querySelectorAll('tr > :last-child')].map(cell => {
        const rect = cell.getBoundingClientRect();
        const text = document.createRange();
        text.selectNodeContents(cell);
        const textRect = text.getBoundingClientRect();
        return { label: cell.textContent.trim(), left: rect.left, right: rect.right,
          textRight: textRect.right, fits: fits(rect) && fits(textRect) };
      });
      const tableFits = fits(tableRect) && table.scrollWidth <= host.clientWidth + 1;
      return { left, right, tableRight: tableRect.right, tableFits, lastColumn,
        passed: tableFits && lastColumn.length >= 4 && lastColumn.every(cell => cell.fits) };
    })()`);
    check('Profile leave table and final column remain inside their card', leave.passed, leave);
  }

  if (panel !== 'generate') return;
  const formats = [
    { card: 'card_claim', preview: 'btnClaimPreview', buttons: ['btnClaimPdf', 'btnClaimDocx'] },
    { card: 'card_inv', preview: 'btnInvPreview', buttons: ['btnInvPdf', 'btnInvXlsx'] }
  ];
  for (const format of formats) {
    const selector = '#' + format.card + ' details.download-options';
    const initial = await evaluate(`(() => {
      const card = document.getElementById(${JSON.stringify(format.card)});
      const details = document.querySelector(${JSON.stringify(selector)});
      const buttons = ${JSON.stringify(format.buttons)}.map(id => document.getElementById(id));
      return { visible: card.checkVisibility(), exists: !!details, closed: !!details && !details.open,
        previewVisible: document.getElementById(${JSON.stringify(format.preview)}).checkVisibility(),
        buttonsPreserved: buttons.every(button => !!button && details?.contains(button)),
        downloadsHidden: buttons.every(button => !!button && !button.checkVisibility()) };
    })()`);
    if (!initial.visible) continue;
    check(format.card + ' keeps preview visible and download choices collapsed',
      initial.exists && initial.closed && initial.previewVisible && initial.buttonsPreserved && initial.downloadsHidden,
      initial);
    if (!initial.exists) continue;
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).querySelector('summary').focus()`);
    await pressKey('Enter', 'Enter', 13);
    const expanded = await evaluate(`(() => {
      const details = document.querySelector(${JSON.stringify(selector)});
      const buttons = ${JSON.stringify(format.buttons)}.map(id => document.getElementById(id));
      return { open: details.open, buttonsVisible: buttons.every(button => button.checkVisibility() && !button.disabled),
        fitsViewport: buttons.every(button => {
          const rect = button.getBoundingClientRect();
          return rect.left >= -2 && rect.right <= innerWidth + 2;
        }) };
    })()`);
    check(format.card + ' exposes existing download buttons', expanded.open && expanded.buttonsVisible && expanded.fitsViewport, expanded);
    const reached = [];
    for (const id of format.buttons) {
      await pressKey('Tab', 'Tab', 9);
      reached.push(await evaluate('document.activeElement.id'));
    }
    check(format.card + ' download choices are keyboard reachable',
      reached.every((id, index) => id === format.buttons[index]), { expected: format.buttons, reached });
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).querySelector('summary').focus()`);
    await pressKey(' ', 'Space', 32);
    const hiddenAgain = await evaluate(`!document.querySelector(${JSON.stringify(selector)}).open &&
      ${JSON.stringify(format.buttons)}.every(id => !document.getElementById(id).checkVisibility())`);
    check(format.card + ' hides download choices again with Space', hiddenAgain);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).open = false`);
  }
}

async function auditProfileValidation({ evaluate, width, report }) {
  const result = await evaluate(`(() => {
    goToStep(activeSteps().findIndex(step => step.id === 'consultant'), true);
    const details = document.getElementById('profileSettings');
    const field = document.getElementById('c_uniqueId');
    if (!details || !field) return { passed: false, missingSettings: true };
    const savedId = S.consultant.uniqueId;
    const wasOpen = details.open;
    let openedBeforeFocus = false;
    const onFocus = () => { openedBeforeFocus = details.open && field.checkVisibility(); };
    field.addEventListener('focus', onFocus);
    try {
      details.open = false;
      document.getElementById('c_name').focus();
      S.consultant.uniqueId = '';
      mirror('consultant.uniqueId');
      const initiallyHidden = !field.checkVisibility();
      const blocked = !canLeave('consultant');
      const focused = document.activeElement === field;
      const warningVisible = document.getElementById('profileGate').checkVisibility();
      return { initiallyHidden, blocked, openedBeforeFocus, focused, warningVisible,
        passed: initiallyHidden && blocked && openedBeforeFocus && focused && warningVisible };
    } finally {
      field.removeEventListener('focus', onFocus);
      S.consultant.uniqueId = savedId;
      mirror('consultant.uniqueId');
      paintProfileGate();
      details.open = wasOpen;
      document.getElementById('toast').className = 'toast';
    }
  })()`);
  const test = 'Missing Unique ID opens settings before focusing its field';
  report.interactions.push({ width, role: 'admin', test, ...result });
  console.log(JSON.stringify({ width, role: 'admin', test, passed: result.passed }));
}

async function auditReturnedEditor({ evaluate, width, report }) {
  const result = await evaluate(`(() => {
    const originalPanel = document.querySelector('.panel.active');
    const source = document.getElementById('p-invoice');
    const heading = source.querySelector('.panel-heading');
    const fields = [...source.querySelectorAll('[data-bind]')];
    const note = source.querySelector('[data-bind="invoice.note"]');
    if (!heading || !fields.length || !note) return { passed: false, missingInvoiceEditor: true };
    const savedNote = S.invoice.note;
    const temporaryPanel = document.createElement('section');
    temporaryPanel.className = 'panel active';
    const temporaryHeading = document.createElement('h2');
    temporaryHeading.textContent = 'Returned invoice audit';
    const host = document.createElement('div');
    host.className = 'edithost';
    host.hidden = true;
    temporaryPanel.append(temporaryHeading, host);
    originalPanel.classList.remove('active');
    document.getElementById('main-content').appendChild(temporaryPanel);
    let restore = null;
    try {
      restore = borrowDocument('invoice', host);
      const movedSameFields = fields.every(field => host.contains(field) && !source.contains(field));
      const singleHeading = document.querySelectorAll('.panel.active h2').length === 1 &&
        source.contains(heading) && !host.querySelector('.panel-heading');
      const visibleEditor = note.checkVisibility();
      note.value = 'Synthetic returned invoice edit';
      note.dispatchEvent(new Event('input', { bubbles: true }));
      const bindingWhileBorrowed = S.invoice.note === note.value;
      restore();
      restore = null;
      const restoredSameFields = host.hidden && !host.querySelector('[data-bind]') &&
        fields.every(field => source.contains(field));
      note.value = 'Synthetic restored invoice edit';
      note.dispatchEvent(new Event('input', { bubbles: true }));
      const bindingAfterRestore = S.invoice.note === note.value;
      return { movedSameFields, singleHeading, visibleEditor, bindingWhileBorrowed, restoredSameFields, bindingAfterRestore,
        passed: movedSameFields && singleHeading && visibleEditor && bindingWhileBorrowed && restoredSameFields && bindingAfterRestore };
    } finally {
      if (restore) restore();
      S.invoice.note = savedNote;
      mirror('invoice.note');
      persist();
      temporaryPanel.remove();
      originalPanel.classList.add('active');
    }
  })()`);
  const test = 'Returned invoice editor moves and restores live fields without a duplicate heading';
  report.interactions.push({ width, role: 'admin', test, ...result });
  console.log(JSON.stringify({ width, role: 'admin', test, passed: result.passed }));
}

async function main() {
  const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const file = path.resolve(ROOT, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    try {
      let content = fs.readFileSync(file);
      if (path.basename(file) === 'index.html') {
        content = content.toString().replace(/(<script src="assets\/js\/app\.js[^>]*>)/,
          '<script>' + fixtures + '</script>$1');
      }
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
        'Content-Security-Policy': "connect-src 'self'; frame-src 'self' blob:; img-src 'self' data: blob:; font-src 'self' data:;" });
      res.end(content);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  console.log('LOCAL_SERVER=' + origin);
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--remote-debugging-port=0', '--user-data-dir=' + path.join(OUTPUT, 'browser-profile'), 'about:blank'
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome CDP startup timed out: ' + stderr)), 15000);
    chrome.on('error', reject);
    chrome.stderr.on('data', chunk => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  console.log('CHROME_READY');
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const callbacks = new Map();
  const runtimeErrors = [];
  socket.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.id) {
      const cb = callbacks.get(data.id);
      if (cb) { callbacks.delete(data.id); data.error ? cb.reject(new Error(data.error.message)) : cb.resolve(data.result || {}); }
    } else if (data.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { callbacks.delete(id); reject(new Error('CDP command timed out: ' + method)); }, 15000);
    callbacks.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  console.log('TARGET_READY');
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const command = (method, params) => send(method, params, sessionId);
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const pressKey = async (key, code, keyCode, modifiers = 0) => {
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode,
      ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : key === ' ' ? { text: ' ', unmodifiedText: ' ' } : {}) });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  };
  try {
    await command('Page.enable'); await command('Runtime.enable'); await command('Network.enable');
    await command('Network.setBlockedURLs', { urls: ['https://*', 'http://bdos.*'] });
    const report = { output: OUTPUT, screens: [], interactions: [], runtimeErrors };
    const roles = cropOnly ? ['admin', 'consultant'] : option('roles')?.split(',') || ['login', 'admin', 'consultant', 'manager', 'boss', 'pa'];
    for (const width of [1440, 390]) {
      const height = width === 390 ? 844 : 960;
      await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
      for (const role of roles) {
        await command('Page.navigate', { url: origin + '/?role=' + role });
        for (let i = 0; i < 60; i++) {
          await delay(100);
          if (await evaluate('document.readyState === "complete" && (new URLSearchParams(location.search).get("role") === "login" || document.querySelectorAll("#stepper button").length > 0)')) break;
        }
        if (cropOnly) {
          if (role === 'admin') await auditCropper({ command, evaluate, pressKey, width, report });
          else {
            await evaluate('goToStep(activeSteps().findIndex(s => s.id === "claim"), true)');
            const signatures = await evaluate(`(() => {
              const slots = ['pm','hod','verified'].map(key => {
                const slot = document.querySelector('#p-claim [data-sig="' + key + '"]');
                return { key, readOnly: !!slot && !slot.querySelector('canvas, button, input[type=file]'),
                  hint: slot?.querySelector('.sighint')?.textContent || '' };
              });
              const own = document.querySelector('#p-claim [data-sig="personnel"]');
              return { slots, ownEditable: !!own?.querySelector('canvas') && !!own?.querySelector('[data-a=upload]') && !!own?.querySelector('[data-a=clear]'),
                ownSignaturePreserved: !!S.sig.personnel };
            })()`);
            report.interactions.push({ width, test: 'Consultant approval signatures are read-only and own signature stays editable', ...signatures,
              passed: signatures.slots.every(slot => slot.readOnly && slot.hint) && signatures.ownEditable && signatures.ownSignaturePreserved });
            console.log(JSON.stringify(report.interactions[report.interactions.length - 1]));
          }
          continue;
        }
        let panels = role === 'login' ? ['login'] : await evaluate('activeSteps().map(s => s.id)');
        if (option('panels')) panels = panels.filter(panel => option('panels').split(',').includes(panel));
        if (option('inject-css')) await evaluate('document.head.appendChild(Object.assign(document.createElement("style"), {textContent:' + JSON.stringify(option('inject-css')) + '}))');
        if (role === 'login') {
          const passwordResult = await evaluate(`(() => {
            const input = document.getElementById('authPassword');
            const button = document.getElementById('authPasswordToggle');
            if (!button) return { test: 'Show password', skipped: true };
            input.value = 'synthetic UI test';
            const hidden = input.type === 'password';
            button.click();
            const shown = input.type === 'text';
            button.click();
            const hiddenAgain = input.type === 'password';
            input.value = '';
            return { test: 'Show password', passed: hidden && shown && hiddenAgain };
          })()`);
          report.interactions.push({ width, ...passwordResult });
        }
        for (const panel of panels) {
          if (panel !== 'login') {
            await evaluate('goToStep(activeSteps().findIndex(s => s.id === ' + JSON.stringify(panel) + '), true)');
            await delay(250);
          }
          const result = await evaluate(`(() => {
            const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
            const name = el => el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent.trim();
            const controls = [...document.querySelectorAll('button, input, select, textarea, a[href]')].filter(visible);
            return {
              title: document.querySelector('.panel.active h2')?.textContent || document.querySelector('.auth-card h1')?.textContent,
              viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
              sheetGeometry: [...document.querySelectorAll('.panel.active .sheetwrap, .panel.active .doc-claim, .panel.active .uz-gridwrap, .panel.active .uz-grid, .panel.active .doc-invoice')].map(el => ({ cls: el.className, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, width: Math.round(el.getBoundingClientRect().width), overflowX: getComputedStyle(el).overflowX })),
              unnamedButtons: controls.filter(el => el.tagName === 'BUTTON' && !name(el)).map(el => el.outerHTML.slice(0, 180)),
              unlabeledFields: controls.filter(el => /INPUT|SELECT|TEXTAREA/.test(el.tagName) && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !el.labels?.length).map(el => ({ id: el.id, html: el.outerHTML.slice(0, 180) })),
              tinyControls: controls.filter(el => { const r = el.getBoundingClientRect(); return r.width < 24 || r.height < 24; }).map(el => ({ name: name(el).slice(0, 45), width: Math.round(el.getBoundingClientRect().width), height: Math.round(el.getBoundingClientRect().height) })).slice(0, 10),
              horizontalOverflow: [...document.querySelectorAll('body *')].filter(visible).filter(el => { const r = el.getBoundingClientRect(); return (r.right > innerWidth + 2 || r.left < -2) && !el.closest('.ts-scroll, .stepper, .table-scroll, .statustable-wrap, .tswrap, .sheetwrap, .uz-gridwrap'); }).slice(0, 12).map(el => ({ tag: el.tagName, id: el.id, cls: el.className, width: Math.round(el.getBoundingClientRect().width) }))
            };
          })()`);
          const filename = width + '-' + role + '-' + panel + '.png';
          await evaluate('document.getElementById("toast").className = "toast"');
          await evaluate('window.scrollTo(0,0)');
          const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
          fs.writeFileSync(path.join(OUTPUT, filename), Buffer.from(screenshot.data, 'base64'));
          report.screens.push({ role, panel, width, screenshot: filename, ...result });
          console.log(JSON.stringify({ role, panel, width, documentWidth: result.documentWidth,
            unnamed: result.unnamedButtons.length, unlabeled: result.unlabeledFields.length, tiny: result.tinyControls.length }));
          await auditDisclosures({ evaluate, pressKey, width, role, panel, report });
        }
        if (role === 'admin') {
          await auditProfileValidation({ evaluate, width, report });
          await auditReturnedEditor({ evaluate, width, report });
          const focusResult = await evaluate(`(() => {
            const trigger = document.getElementById('btnProfiles');
            trigger.focus();
            const blob = new jspdf.jsPDF().output('blob');
            openFilePreview('Local audit document', 'audit.pdf', blob);
            const focusedClose = document.activeElement.id === 'pdfViewClose';
            const backgroundInert = document.getElementById('main-content').inert;
            const dialogRole = document.getElementById('pdfView').getAttribute('role');
            const dialog = document.getElementById('pdfView');
            const first = dialog.querySelector('a[href]');
            first.focus();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
            const wrapsFocus = dialog.contains(document.activeElement) && document.activeElement.id === 'pdfViewFrame';
            document.getElementById('pdfViewClose').focus();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            return { test: 'PDF dialog focus and Escape', focusedClose, backgroundInert, dialogRole, wrapsFocus,
              focusRestored: document.activeElement === trigger, closed: dialog.hidden,
              backgroundRestored: !document.getElementById('main-content').inert };
          })()`);
          focusResult.passed = focusResult.focusedClose && focusResult.backgroundInert && focusResult.dialogRole === 'dialog' && focusResult.wrapsFocus && focusResult.focusRestored && focusResult.closed && focusResult.backgroundRestored;
          report.interactions.push({ width, ...focusResult });
          await evaluate('goToStep(activeSteps().findIndex(s => s.id === "generate"), true); document.getElementById("btnInvPreview").focus(); document.getElementById("btnInvPreview").click();');
          for (let i = 0; i < 50; i++) {
            await delay(100);
            if (await evaluate('!document.getElementById("pdfView").hidden')) break;
          }
          const generatedPreview = await evaluate(`(() => {
            const opened = !document.getElementById('pdfView').hidden;
            const focusedClose = document.activeElement.id === 'pdfViewClose';
            document.getElementById('pdfViewClose').click();
            return { test: 'Generated PDF restores its preview button', opened, focusedClose,
              restoredElement: document.activeElement.id, passed: opened && focusedClose && document.activeElement.id === 'btnInvPreview' };
          })()`);
          report.interactions.push({ width, ...generatedPreview });

          await evaluate('goToStep(activeSteps().findIndex(s => s.id === "claim"), true); document.querySelector(".day-toggle[data-day=\\"1\\"]").focus();');
          await pressKey('ArrowRight', 'ArrowRight', 39);
          const dayAfterArrow = await evaluate('document.activeElement.dataset.day');
          const beforeMark = await evaluate('document.activeElement.textContent');
          await pressKey('Enter', 'Enter', 13);
          const afterEnter = await evaluate('document.activeElement.textContent');
          await pressKey(' ', 'Space', 32);
          const afterSpace = await evaluate('document.activeElement.textContent');
          await pressKey('End', 'End', 35);
          const dayAfterEnd = await evaluate('document.activeElement.dataset.day');
          await pressKey('Home', 'Home', 36);
          const dayAfterHome = await evaluate('document.activeElement.dataset.day');
          report.interactions.push({ width, test: 'Timesheet native keyboard', dayAfterArrow, beforeMark, afterEnter, afterSpace, dayAfterEnd, dayAfterHome,
            passed: dayAfterArrow === '2' && beforeMark !== afterEnter && afterEnter !== afterSpace && dayAfterEnd === '30' && dayAfterHome === '1' });
        }
      }
    }
    fs.writeFileSync(path.join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2));
    console.log('AUDIT_OUTPUT=' + OUTPUT);
    console.log('RUNTIME_ERRORS=' + JSON.stringify(runtimeErrors));
    console.log('INTERACTIONS=' + JSON.stringify({ passed: report.interactions.filter(r => r.passed).length,
      failures: report.interactions.filter(r => r.passed === false).map(({ width, test }) => ({ width, test })) }));
    if (runtimeErrors.length || report.interactions.some(r => r.passed === false) || report.screens.some(s => s.documentWidth > s.width + 2 || s.unnamedButtons.length || s.unlabeledFields.length)) process.exitCode = 1;
  } finally {
    try { await send('Browser.close'); } catch {}
    socket.close(); chrome.kill(); server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

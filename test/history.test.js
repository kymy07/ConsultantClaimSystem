const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; }
  appendChild(el) { this.children.push(el); }
  setAttribute(k,v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener() {}
  focus() {}
}
let saved = 0, viewed = 0, errors = 0, adminNow = false, sendsNow = false, roleNow = '';
const ctx = vm.createContext({
  document: { createElement: tag => new Element(tag),
              createTextNode: text => Object.assign(new Element('#text'), {textContent:text}) },
  MONTHS: ['January'], Blob,
  button: (text, cls, handler) => Object.assign(new Element('button'), {textContent:text, className:cls, handler}),
  // approvals.js draws these; archive.js only asks for one
  iconButton: (name, label, cls, handler) => Object.assign(new Element('button'),
    {icon:name, title:label, className:cls, handler}),
  Sync: { storedOne: async () => ({files:[{name:'signed.pdf',type:'application/pdf',content:'YQ=='}]}) },
  dataUrlToBytes: () => new Uint8Array([97]),
  /* Only the administrator may take a filed copy off the record, and only
     whoever sends a month to Finance gets the buttons that compile it — a
     consultant reading their own history has neither. */
  Auth: { isAdmin: () => adminNow, keepsRecords: () => sendsNow, places: () => false,
          prepares: () => adminNow || roleNow === 'consultant' },
  openFilePreview: () => viewed++, saveAs: () => saved++, toast: () => errors++
});
vm.runInContext(fs.readFileSync('assets/js/archive.js','utf8'),ctx);
const record = {id:1,consultant:'Person <A>',period_month:1,period_year:2026,kind:'claim',files:[{name:'signed.pdf'}]};
sendsNow = true;                      // the month's own buttons, for whoever sends it on
const wrap = ctx.historyTable([record,{...record,id:2,kind:'invoice'}]);
// everybody on the roster gets a line, even with nothing filed
const full = ctx.historyTable([record],['Zulkifli','Person <A>']);
const fullBody = full.children[1].children[2];
assert.equal(fullBody.children.length,2);
assert.equal(fullBody.children[0].children[0].textContent,'Person <A>');
assert.equal(fullBody.children[1].children[0].textContent,'Zulkifli');
assert.equal(fullBody.children[1].children[1].children[0].textContent,'Not available');
const body = wrap.children[1].children[2];
assert.equal(body.children.length,1);
// name, three documents and the bank statement; the month's zip is the month's, on its heading
assert.equal(body.children[0].children.length,5);
assert.equal(body.children[0].children[0].textContent,'Person <A>');
const monthbar = wrap.children[0];
assert.equal(monthbar.className,'history-monthbar');
assert.equal(monthbar.children[0].children[0].textContent,'Compile month zip');
assert.equal(monthbar.children[1].children[0].textContent,'Email Finance');
/* And a consultant, who has nothing to compile and nobody to send it to,
   gets the table without them — the first child is the table itself. */
sendsNow = false;
const readOnly = ctx.historyTable([record]);
assert.equal(readOnly.children.length,1);
assert.equal(readOnly.children[0].tag,'table');
sendsNow = true;
const missing = ctx.historyTable([record]).children[1].children[2].children[0].children[2];
assert.equal(missing.children[0].textContent,'Not available');
// every document that is there says what it is called
const cell = body.children[0].children[1];
assert.equal(cell.children[0].children[0].children[0].textContent,'signed.pdf');
// a signed copy is evidence, so only the administrator is offered its removal
const icons = node => { const out=[]; (function walk(n){ n.children.forEach(c=>{ if(c.icon) out.push(c.icon); walk(c); }); })(node); return out; };
assert.ok(!icons(ctx.historyTable([record])).includes('remove'));
adminNow = true;
assert.ok(icons(ctx.historyTable([record])).includes('remove'));
adminNow = false;
(async()=>{
 const control = new Element('button');
 await ctx.openHistoryFile(record,0,'view',control);
 assert.equal(viewed,1); assert.equal(saved,0); assert.equal(control.disabled,false);
 await ctx.openHistoryFile(record,0,'download',control);
 assert.equal(saved,1);
 await ctx.openHistoryFile(record,9,'view',control);
 assert.equal(errors,1); assert.equal(control.disabled,false);
 /* A bank statement is the consultant's proof of payment, filed as a kind
    and a stage of its own. It must never be read as a signed copy — not by
    archiveFor, which the zips and Re-Upload use, and not by History's own
    list of finished copies — and a newer one stands for the month. */
 vm.runInContext(`archive = [
   {id:'s1',consultant:'Nizar',period_month:9,period_year:2026,kind:'claim',stage:'pending_signature',
    created_at:'2026-09-20T00:00:00Z',files:[{name:'sheet.pdf'}]},
   {id:'b1',consultant:'Nizar',period_month:9,period_year:2026,kind:'bank',stage:'statement',
    created_at:'2026-09-21T00:00:00Z',files:[{name:'old statement.pdf'}]},
   {id:'b2',consultant:'Nizar',period_month:9,period_year:2026,kind:'bank',stage:'statement',
    created_at:'2026-09-22T00:00:00Z',files:[{name:'statement.pdf'}]}];`, ctx);
 assert.equal(vm.runInContext("bankFor('Nizar', 2026, 9).id", ctx), 'b2');
 assert.equal(vm.runInContext("bankFor('Nizar', 2026, 8)", ctx), null);
 ['claim','invoice','advice'].forEach(kind =>
   assert.equal(vm.runInContext(`(archiveFor('Nizar', 2026, 8, '${kind}') || {}).kind`, ctx),
                kind === 'claim' ? 'claim' : undefined, kind));
 assert.ok(!vm.runInContext("historyRows().some(r => r.kind === 'bank')", ctx));

 // who is offered the upload: the consultant and the administrator, nobody else
 const offers = () => icons0(ctx.bankCell('Nizar', {period_year:2026, period_month:9}));
 const icons0 = node => { const out=[]; (function walk(n){ (n.children||[]).forEach(c=>{ if(c.textContent) out.push(c.textContent); walk(c); }); })(node); return out; };
 roleNow = 'consultant'; adminNow = false;
 assert.ok(offers().includes('Replace statement'), 'a consultant replaces their own');
 roleNow = 'pa';
 assert.ok(!offers().includes('Replace statement'), 'the PA only reads it');
 roleNow = ''; adminNow = true;
 assert.ok(offers().includes('Replace statement'), 'the administrator stands in');
 // and nobody chooses a file before ticking that it is blacked out
 const box = ctx.bankUploader('Nizar', {period_year:2026, period_month:9}, false);
 const panel = box.children[1];
 const file = panel.children.find(c => c.type === 'file');
 assert.equal(file.disabled, true);
 adminNow = false; roleNow = '';
 console.log('History grouping, missing documents, preview, download and error recovery passed.');
 console.log('Bank statements: kept apart from the signed copies, newest wins, offered to the consultant and the administrator only.');
})().catch(e=>{console.error(e);process.exitCode=1;});

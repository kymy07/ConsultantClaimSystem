const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; }
  appendChild(el) { this.children.push(el); }
  setAttribute(k,v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
}
let saved = 0, viewed = 0, errors = 0, adminNow = false, sendsNow = false;
const ctx = vm.createContext({
  document: { createElement: tag => new Element(tag) },
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
  Auth: { isAdmin: () => adminNow, keepsRecords: () => sendsNow, places: () => false },
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
// name and three documents; the month's zip is the month's, on its heading
assert.equal(body.children[0].children.length,4);
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
 console.log('History grouping, missing documents, preview, download and error recovery passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});

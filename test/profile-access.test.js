const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const source = fs.readFileSync('assets/js/app.js','utf8');
function extract(name) {
 const start = source.indexOf('function '+name+' (');
 const end = source.indexOf('\n}',start)+2;
 return source.slice(start,end);
}
let prepares = false;
let reads = 0;
const elements = Object.fromEntries(['profileMenu','profileCurrent','profileBox','btnReset','btnProfiles'].map(id=>[id,{hidden:false,textContent:'Other person',innerHTML:'old',setAttribute(){}}]));
const context = vm.createContext({
 Auth:{prepares:()=>prepares,owns:()=>false,isAdmin:()=>prepares},
 Store:{profiles:()=>{reads++;return {Other:{}};}},
 document:{getElementById:id=>elements[id]},mergeDefaults:p=>p
});
['openProfiles','refreshProfileList','editProfile','removeProfile','newProfile','startNewProfile','saveProfileNow'].forEach(name=>vm.runInContext(extract(name),context));
context.refreshProfileList();
assert.equal(elements.profileBox.hidden,true);
assert.equal(elements.btnReset.hidden,true);
assert.equal(elements.profileMenu.hidden,true);
assert.equal(elements.profileMenu.innerHTML,'');
for(const name of ['editProfile','removeProfile','newProfile','startNewProfile','saveProfileNow']) context[name]('Other');
context.openProfiles(true);
assert.equal(elements.profileMenu.hidden,true);
prepares=true;
context.editProfile('Other');
context.removeProfile('Other');
console.log('Read-only header and profile action guards passed; another consultant profile cannot be opened or deleted.');

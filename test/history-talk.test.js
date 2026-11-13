const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('historical grid uses call-record talk consistently across modes and grand totals',()=>{
 const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
 const ctx={BENCH:36000,ORDER:['Inbound','Manual','Blended'],titleCase:s=>s.charAt(0).toUpperCase()+s.slice(1).toLowerCase()};vm.createContext(ctx);
 vm.runInContext(html.slice(html.indexOf('function build('),html.indexOf('function render(')),ctx);
 ctx.rows=[{agentId:'SRF132',agentName:'Harsha',mode:'Manual',login:13540,talk:1322},{agentId:'SRF132',agentName:'Harsha',mode:'Blended',login:17638,talk:2940}];
 ctx.calls=[{agentId:'SRF132',mode:'Manual',calls:71,connected:18,talk:1433},{agentId:'SRF132',mode:'Blended',calls:110,connected:36,talk:7030}];
 const result=vm.runInContext('build(rows,calls)',ctx);
 assert.equal(result.list[0].modes.Manual.talk,1433);assert.equal(result.list[0].modes.Blended.talk,7030);
 assert.equal(result.grand.tot.talk,8463);assert.equal(result.grand.tot.calls,181);assert.equal(result.grand.tot.connected,54);assert.equal(result.grand.tot.login,31178);
 assert.equal(vm.runInContext('build(rows,undefined)',ctx).grand.tot.talk,4262);
});

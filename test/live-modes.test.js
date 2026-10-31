const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('Blended login is prominent while call-type totals retain their recorded classification', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const nodes = Object.fromEntries(['dateTitle','kpis','main','summary'].map(id => ['#'+id, {}]));
  const context = {nodes, document:{querySelector: s => nodes[s]},
    ORDER:['Inbound','Manual','Progressive','Blended'], CLS:{},
    $:s=>nodes[s], hms:s=>String(s||0), pct:(a,b)=>b ? String(a/b*100)+'%' : '0%',
    esc:s=>String(s).replace(/[&<>"']/g, c=>'&#'+c.charCodeAt(0)+';'),
    titleCase:s=>s.charAt(0).toUpperCase()+s.slice(1).toLowerCase(), cls:()=> 'oth', fmtDate:s=>s};
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('function stClass('), html.indexOf('// ---- Agent filter')), context);
  context.data = {blended:{available:true,rows:[{agentId:'SRF675',calls:1,connected:1,talk:9,complete:true}]},date:'2026-10-31',statusComplete:true,
    status:[{agentId:'SRF675',agentName:'Mansi',mode:'Blended',state:'Busy',loggedIn:true}],
    rows:[{agentId:'SRF675',agentName:'Mansi',mode:'Manual',calls:28,connected:16,talk:4403,wrapup:0,lastCall:'14:20:47'},
      {agentId:'SRF675',agentName:'Mansi',mode:'InBound',calls:1,connected:1,talk:9,wrapup:0,lastCall:'14:21:00'}]};
  vm.runInContext('renderLive(data)',context);
  assert.match(nodes['#main'].innerHTML,/current-mode blended">Blended<\/span>/);
  assert.match(nodes['#main'].innerHTML,/Current Agent Mode/);
  assert.match(nodes['#main'].innerHTML,/Call Type.*Manual/);
  assert.doesNotMatch(nodes['#main'].innerHTML,/Call Type[^<]*Blended/);
  assert.match(nodes['#main'].innerHTML,/class="b-tot bold">29<\/td>/);
  assert.match(nodes['#main'].innerHTML,/Blended.*Agent Mode/);
  assert.match(nodes['#main'].innerHTML,/class="b-blended">1<\/td>/);
  assert.match(nodes['#main'].innerHTML,/Call Type.*Manual/);
  assert.doesNotMatch(nodes['#main'].innerHTML,/Blended<\/span> Â· /);
  const escaped = vm.runInContext('currentMode({mode:"<img>",since:"<script>"})',context);
  assert.doesNotMatch(escaped,/<img>|<script>/);
  context.data.blended = {available:false,rows:[]};
  vm.runInContext('renderLive(data)',context);
  assert.match(nodes['#main'].innerHTML,/Agent mode history is incomplete/);
  assert.doesNotMatch(nodes['#main'].innerHTML,/class="b-blended">0<\/td>/);
  context.data.blended = {available:true,rows:[]};
  vm.runInContext('renderLive(data)',context);
  assert.match(nodes['#main'].innerHTML,/Agent mode history is incomplete/);
});

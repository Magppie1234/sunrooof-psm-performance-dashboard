const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createReader}=require('../lib/login-status');
const at=1793257000000;
const response=(list,time=at,field='data')=>({http:200,j:{status:'success',[field]:list,integration:{complete:true,sampledAt:time/1000}}});
const agent=(id,state='READY')=>({AgentId:id,AgentName:'Agent '+id,AgentState:state,Mode:'Manual'});
test('cold start includes all logged-in agents, including unconfigured zero-call agents',async()=>{
 let requests=0;
 const read=createReader({now:()=>at,query:async(path,body)=>{requests++;assert.equal(path,'/ca_apis/getAgentLogins');assert.deepEqual(body,{});return response(Array.from({length:12},(_,i)=>agent('A'+i,i===11?'AUX':'READY')));}});
 const result=await read({A0:'Agent 0'},['OFF']);
 assert.equal(requests,1);assert.equal(result.status.filter(s=>s.loggedIn).length,12);
 assert.equal(result.status.find(s=>s.agentId==='OFF').loggedIn,false);
 assert.equal(result.statusComplete,true);assert.ok(!JSON.stringify(result).includes('PhoneNumber'));
});
test('successful empty snapshot means zero online, not number of agents who made calls',async()=>{
 const read=createReader({now:()=>at,query:async()=>response([])});
 const r=await read({A:'Agent A'});assert.equal(r.statusComplete,true);assert.equal(r.status[0].loggedIn,false);
});
test('failure and malformed response never become logout; retry recovers',async()=>{
 let time=at,good=false;
 const read=createReader({now:()=>time,query:async()=>good?response([agent('A')],time,'message'):{http:200,j:{status:'error',message:'Max limit exceeded'}}});
 let r=await read({A:'A'});assert.equal(r.statusComplete,false);assert.equal(r.status[0].loggedIn,null);assert.equal(r.status[0].state,'UNKNOWN');
 good=true;time+=31000;r=await read({A:'A'});assert.equal(r.statusComplete,true);assert.equal(r.status[0].loggedIn,true);
});
test('old snapshot and failed refresh cannot report current login totals',async()=>{
 let time=at,fail=false;
 const read=createReader({now:()=>time,query:async()=>{if(fail)throw Error('network');return response([agent('A')]);}});
 await read();time+=130000;let r=await read();assert.equal(r.statusComplete,false);assert.equal(r.status[0].loggedIn,null);
 fail=true;time+=31000;r=await read();assert.equal(r.status[0].state,'READY');assert.equal(r.status[0].stale,true);
});
test('concurrent reads share one request, cached reads respect refresh spacing',async()=>{
 let requests=0;
 const read=createReader({now:()=>at,query:async()=>{requests++;await Promise.resolve();return response([agent('A')]);}});
 const results=await Promise.all([read(),read(),read()]);await read();assert.equal(requests,1);assert.ok(results.every(x=>x.statusComplete));
});
test('missing sample timestamp or malformed agent is not a complete roster',async()=>{
 for(const reply of [{http:200,j:{status:'success',data:[],integration:{complete:true}}},response([{}])]){
  const read=createReader({now:()=>at,query:async()=>reply});assert.equal((await read()).statusComplete,false);
 }
});

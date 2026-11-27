'use strict';
const assert=require('node:assert/strict');
const {createPoller}=require('./ritnome-poller');
const {createPendingReader}=require('./ritnome-pending-reader');
async function run(){
 const stamp='2027-01-01T00:00:00.123456+00:00', A={stripe_event_id:'evt_A',received_at:stamp},B={stripe_event_id:'evt_B',received_at:stamp};
 function fixture(){
  let time=0,seq=0;const timers=new Map(),calls=[],queries=[],logs=[];
  const f={rows:[A,B],answer:'committed',calls,queries,logs,timers};
  f.poller=createPoller({intervalMs:1000,batchSize:2,clock:()=>time,setTimer:(fn,delay)=>{const id=++seq;timers.set(id,{fn,delay});return id},clearTimer:id=>timers.delete(id),log:x=>logs.push(x),listPending:async q=>{queries.push(q);if(f.readError)throw Error('read');return f.rows},worker:{one:async id=>{calls.push(id);if(f.hold)await f.hold;if(f.failId===id)throw Error('worker');return f.answer}}});
  f.tick=async()=>{assert.equal(timers.size,1);const [id,t]=timers.entries().next().value;timers.delete(id);time+=t.delay;t.fn();for(let i=0;i<30;i++)await Promise.resolve();};
  return f;
 }
 let f=fixture();assert.equal(f.timers.size,0);assert.equal(f.poller.start(),true);assert.equal(f.poller.start(),false);await f.tick();assert.equal(f.calls.join(','),'evt_A,evt_B');assert.equal(f.timers.size,1);f.rows=[];await f.tick();assert.equal(f.queries[1].after.stripe_event_id,'evt_B');await f.tick();assert.equal(f.queries[2].after,null);await f.poller.stop();assert.equal(f.timers.size,0);assert.equal(f.poller.isRunning(),false);
 f=fixture();f.rows=[A];f.answer='await_admin_binding';f.poller.start();await f.tick();await f.tick();assert.equal(f.calls.length,1);await f.tick();assert.equal(f.calls.length,2);await f.poller.stop();
 f=fixture();f.failId='evt_A';f.poller.start();await f.tick();assert.equal(f.calls.join(','),'evt_A,evt_B');assert.equal(f.logs.length,1);await f.poller.stop();
 f=fixture();f.readError=true;f.poller.start();await f.tick();assert.equal(f.logs.length,1);assert.equal(f.timers.size,1);f.readError=false;await f.tick();assert.equal(f.calls.length,2);await f.poller.stop();
 f=fixture();let release;f.hold=new Promise(r=>{release=r});f.poller.start();await f.tick();assert.equal(f.timers.size,0);const stopped=f.poller.stop();assert.equal(f.poller.start(),false);release();await stopped;assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);
 const ops=[];let response={data:[A],error:null};const q={};for(const name of ['select','eq','is','or','order'])q[name]=(...args)=>{ops.push([name,...args]);return q};q.limit=async n=>{ops.push(['limit',n]);return response};const reader=createPendingReader({livemode:false,base:{from:t=>{ops.push(['from',t]);return q}}});
 assert.equal((await reader({limit:2,after:A}))[0].stripe_event_id,'evt_A');assert.equal(ops.find(x=>x[0]==='eq')[2],false);assert.equal(ops.find(x=>x[0]==='is')[2],null);assert.equal(ops.filter(x=>x[0]==='order').map(x=>x[1]).join(','),'received_at,stripe_event_id');assert.equal(ops.find(x=>x[0]==='or')[1],'received_at.gt.'+stamp+',and(received_at.eq.'+stamp+',stripe_event_id.gt.evt_A)');
 await assert.rejects(()=>reader({limit:101}),/Invalid pending limit/);await assert.rejects(()=>reader({limit:2,after:{...A,stripe_event_id:'evt_A,evil'}}),/Invalid pending cursor/);response={data:null,error:true};await assert.rejects(()=>reader({limit:2}),/Pending event read failed/);
 console.log('Scheduler and pending reader assertions passed');
}
run().catch(e=>{console.error(e);process.exitCode=1;});

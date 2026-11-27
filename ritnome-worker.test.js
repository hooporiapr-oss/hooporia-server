'use strict';
const assert=require('node:assert/strict');
const {createWorker}=require('./ritnome-worker');
async function run(){
 const now=1795787498, stop=now+30*86400, date=new Date(stop*1000).toISOString();
 function fixture(){
  const f={e:{livemode:false,stripe_event_id:'evt_fixture',subscription_id:'sub_fixture',processed_at:null},b:{livemode:false,stripe_subscription_id:'sub_fixture',stripe_customer_id:'cus_fixture',stripe_price_id:'price_fixture',license_id:null,paid_through:null,billing_status:'pending',revision:0},s:{id:'sub_fixture',livemode:false,customer:'cus_fixture',status:'active',items:{has_more:false,data:[{id:'si_fixture',price:'price_fixture',quantity:1}]}},i:{status:'paid',livemode:false,customer:'cus_fixture',subscription:'sub_fixture',currency:'usd',amount_paid:16614,billing_reason:'subscription_cycle',lines:{has_more:false,data:[{price:'price_fixture',subscription_item:'si_fixture',quantity:1,proration:false,amount:14900,period:{start:now, end:stop}}]}},calls:[],reads:0,replies:[],verified:true};
  f.base={from(table){const filters={};return {select(){return this},eq(k,v){filters[k]=v;return this},async maybeSingle(){assert.equal(filters.livemode,false);const event=table==='ritnome_stripe_inbox';assert.equal(event?filters.stripe_event_id:filters.stripe_subscription_id,event?'evt_fixture':'sub_fixture');return {data:event?f.e:f.b,error:event?f.eError:f.bError}}}},async rpc(name,p){assert.equal(name,'ritnome_commit_decision');f.calls.push(p);const answer=f.replies.shift()||'committed';if(answer==='retry'&&f.b)f.b.revision++;return {data:answer,error:f.rpcError}}};
  f.worker=createWorker({base:f.base,source:{async readVerifiedSnapshot(){f.reads++;if(f.sourceError)throw Error('source unavailable');return {verified:f.verified,subscription:f.s,invoice:f.i}}},priceId:'price_fixture',livemode:false,clock:()=>now+60});
  return f;
 }
 const call=f=>f.worker.one('evt_fixture');
 let f=fixture();assert.equal(await call(f),'committed');assert.equal(f.calls[0].p_paid_through,date);assert.equal(f.calls[0].p_mode,false);
 f=fixture();f.e.processed_at=date;assert.equal(await call(f),'duplicate');assert.equal(f.reads,0);
 f=fixture();f.e=null;assert.equal(await call(f),'missing_event');
 f=fixture();f.b=null;assert.equal(await call(f),'await_admin_binding');assert.equal(f.calls.length,0);
 f=fixture();f.replies=['retry','committed'];assert.equal(await call(f),'committed');assert.equal(f.reads,2);assert.equal(f.calls[1].p_revision,1);
 f=fixture();f.replies=['retry','retry','retry'];assert.equal(await call(f),'retry_later');assert.equal(f.reads,3);
 f=fixture();f.s.status='past_due';f.i.status='open';f.b.paid_through=date;assert.equal(await call(f),'committed');assert.equal(f.calls[0].p_paid_through,date);assert.equal(f.calls[0].p_status,'past_due');
 f=fixture();f.s.status='canceled';assert.equal(await call(f),'committed');assert.equal(f.calls[0].p_decision,'review');assert.equal(f.calls[0].p_paid_through,null);
 f=fixture();f.s.status='canceled';f.i.status='open';f.b.paid_through=date;assert.equal(await call(f),'committed');assert.equal(f.calls[0].p_status,'canceled');assert.equal(f.calls[0].p_paid_through,date);
 f=fixture();f.verified=false;await assert.rejects(()=>call(f),/Unverified/);assert.equal(f.calls.length,0);
 f=fixture();f.sourceError=true;await assert.rejects(()=>call(f),/source unavailable/);assert.equal(f.calls.length,0);
 f=fixture();f.eError=true;await assert.rejects(()=>call(f),/Inbox read failed/);
 f=fixture();f.bError=true;await assert.rejects(()=>call(f),/Binding read failed/);
 f=fixture();f.rpcError=true;await assert.rejects(()=>call(f),/Atomic commit failed/);
 f=fixture();f.e.livemode=true;await assert.rejects(()=>call(f),/Event identity mismatch/);
 f=fixture();f.b.livemode=true;await assert.rejects(()=>call(f),/Invalid binding/);
 f=fixture();f.b.stripe_price_id='price_other';await assert.rejects(()=>call(f),/Invalid binding/);
 f=fixture();f.replies=['unexpected'];await assert.rejects(()=>call(f),/Unexpected commit result/);
 f=fixture();await assert.rejects(()=>f.worker.one('invalid'),/Invalid event ID/);
 console.log('19 worker scenarios passed');
}
run().catch(e=>{console.error(e);process.exitCode=1;});

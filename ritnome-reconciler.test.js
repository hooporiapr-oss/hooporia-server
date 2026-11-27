'use strict';
const assert=require('node:assert/strict');
const {createReconciler}=require('./ritnome-reconciler');
async function run(){
 let processed=new Set(), decisions=[], bound=true, verified=true, reads=0, fail=false;
 const binding={livemode:false,stripe_subscription_id:'sub_a',stripe_customer_id:'cus_a',stripe_price_id:'price_a',paid_through:null};
 const subscription={id:'sub_a',livemode:false,customer:'cus_a',status:'active',items:{data:[{id:'si_a',quantity:1,price:'price_a'}],has_more:false}};
 const store={async withSubscriptionLock(mode,id,fn){
  assert.equal(mode,false);assert.equal(id,'sub_a');
  const p=new Set(processed),d=[...decisions];
  const out=await fn({isProcessed:async x=>p.has(x),getBinding:async()=>bound?binding:null,recordDecision:async x=>{d.push(x);if(fail)throw Error('write failure')},markProcessed:async x=>p.add(x)});
  processed=p;decisions=d;return out;
 }};
 const source={async readVerifiedSnapshot(){reads++;return {verified,subscription,invoice:null}}};
 const f=createReconciler({store,source,priceId:'price_a',livemode:false,clock:()=>1800000000});
 const e={livemode:false,subscription_id:'sub_a',stripe_event_id:'evt_a'};
 assert.equal(await f(e),'reconcile');assert.equal(decisions.length,1);
 assert.equal(await f(e),'duplicate');assert.equal(reads,1);
 await assert.rejects(()=>f({...e,livemode:true}));
 bound=false;assert.equal(await f({...e,stripe_event_id:'evt_b'}),'await_admin_binding');assert.equal(processed.has('evt_b'),false);
 bound=true;verified=false;await assert.rejects(()=>f({...e,stripe_event_id:'evt_b'}));assert.equal(processed.has('evt_b'),false);
 verified=true;fail=true;await assert.rejects(()=>f({...e,stripe_event_id:'evt_b'}));assert.equal(processed.has('evt_b'),false);assert.equal(decisions.length,1);
 fail=false;assert.equal(await f({...e,stripe_event_id:'evt_b'}),'reconcile');assert.equal(decisions.length,2);
 console.log('Reconciler mock tests passed');
}
module.exports=run;if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});

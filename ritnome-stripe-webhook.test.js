'use strict';
const assert = require('node:assert/strict');
const { createWebhook, subscriptionId } = require('./ritnome-stripe-webhook');
async function run() {
  const priceId = 'price_ritnome', subId = 'sub_ritnome';
  const base = { id: 'evt_example', type: 'invoice.paid', livemode: false,
    created: 12345, data: { object: { subscription: subId } } };
  const seen = new Map(); let calls=0; let tracked=false; let fail=false;
  let price=priceId;
  const stripe = {
    webhooks: { constructEvent: (body, signature, secret) => {
      if (signature !== 'valid' || secret !== 'whsec_mock') throw new Error('bad signature');
      return body;
    }},
    subscriptions: { retrieve: async id => { calls++; return {
      id, livemode:false, items:{data:[{price:{id:price}}],has_more:false}
    }; }}
  };
  const inbox={ isTracked:async()=>tracked, enqueue:async e=>{
    if(fail) throw new Error('storage failed');
    seen.set(e.stripe_event_id,e);
  }};
  const handler=createWebhook({stripe,secret:'whsec_mock',priceId,livemode:false,inbox,log:{error(){}}});
  const invoke=async (event,signature='valid')=>{
    const res={code:0,status(n){this.code=n;return this},send(s){this.body=s;return this}};
    await handler({body:event,headers:{'stripe-signature':signature}},res);return res;
  };
  assert.equal((await invoke(base,'bad')).code,400);
  assert.equal(seen.size,0);
  assert.equal((await invoke({...base,livemode:true})).code,400);
  assert.equal((await invoke({...base,account:'acct_other'})).code,400);
  assert.equal((await invoke({...base,type:'charge.succeeded'})).body,'Ignored');
  assert.equal((await invoke({...base,data:{object:{}}})).body,'Ignored');
  price='price_other';
  assert.equal((await invoke(base)).body,'Ignored');
  assert.equal(seen.size,0);
  price=priceId;
  assert.equal((await invoke(base)).body,'Accepted');
  assert.equal((await invoke(base)).code,200);
  assert.equal(seen.size,1);
  assert.deepEqual(Object.keys(seen.get(base.id)).sort(),['event_created','event_type','livemode','stripe_event_id','subscription_id'].sort());
  const modern={...base,id:'evt_modern',data:{object:{parent:{subscription_details:{subscription:{id:subId}}}}}};
  assert.equal(subscriptionId(modern),subId);
  assert.equal((await invoke(modern)).code,200);
  tracked=true;price='price_other';const previous=calls;
  const deleted={...base,id:'evt_deleted',type:'customer.subscription.deleted',data:{object:{id:subId}}};
  assert.equal((await invoke(deleted)).body,'Accepted');
  assert.equal(calls,previous);
  fail=true;
  assert.equal((await invoke({...base,id:'evt_retry'})).code,503);
  assert.equal(seen.has('evt_retry'),false);
  assert.throws(()=>createWebhook({stripe,secret:'',priceId,livemode:false,inbox}));
  console.log('Ritnome intake tests passed (mock signature and persistence; no network)');
}
module.exports=run;
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});

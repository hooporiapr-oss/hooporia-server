'use strict';
// Temporary opt-in SANDBOX-only test runner. Fixed synthetic IDs, no public route.
const idOf=x=>typeof x==='string'?x:x?.id;
const check=(ok)=>{if(!ok)throw Error('Sandbox billing fixture mismatch');};
async function settleRenewal({stripe,base,priceId}){
 const sub='sub_1UgRuxEAmtgiDmNe3TEy5Ipy',customer='cus_Vhre6t1ftZja9y',clock='clock_1UgRujEAmtgiDmNe3iV0T8ie',invoice='in_1UgRwREAmtgiDmNesUrf3RLr',pm='pm_1UgRurEAmtgiDmNeEMrLVEk2';
 const b=await base.from('ritnome_subscription_registry').select('livemode,stripe_subscription_id,stripe_customer_id,stripe_price_id,license_id,paid_through,revision').eq('livemode',false).eq('stripe_subscription_id',sub).maybeSingle();
 check(!b.error&&b.data?.livemode===false&&b.data.stripe_subscription_id===sub&&b.data.stripe_customer_id===customer&&b.data.stripe_price_id===priceId&&b.data.license_id===null&&b.data.revision>=1&&Date.parse(b.data.paid_through)>=Date.parse('2026-11-25T12:00:00Z'));
 const s=await stripe.subscriptions.retrieve(sub);
 check(s.id===sub&&s.livemode===false&&idOf(s.customer)===customer&&idOf(s.test_clock)===clock&&s.metadata?.ritnome_test==='phase_12e_renewal'&&idOf(s.latest_invoice)===invoice&&idOf(s.default_payment_method)===pm&&s.items?.has_more===false&&s.items?.data?.length===1&&idOf(s.items.data[0].price)===priceId&&s.items.data[0].quantity===1);
 const tc=await stripe.testHelpers.testClocks.retrieve(clock);
 check(tc.id===clock&&tc.livemode===false&&tc.status==='ready'&&tc.frozen_time===1795795200);
 const i=await stripe.invoices.retrieve(invoice);
 check(i.id===invoice&&i.livemode===false&&idOf(i.customer)===customer&&(idOf(i.subscription)||idOf(i.parent?.subscription_details?.subscription))===sub&&i.currency==='usd'&&i.billing_reason==='subscription_cycle'&&i.subtotal===14900&&i.total===14900&&i.automatic_tax?.enabled===true&&i.automatic_tax?.status==='complete'&&i.lines?.data?.length===1&&i.lines.data[0].period?.start===1795608000&&i.lines.data[0].period?.end===1798200000);
 if(i.status==='paid'){check(i.amount_paid===14900&&i.amount_remaining===0&&i.paid_out_of_band!==true);return 'already_paid';}
 check(i.status==='open'&&i.amount_paid===0&&i.amount_remaining===14900);
 const paid=await stripe.invoices.pay(invoice,{payment_method:pm},{idempotencyKey:'ritnome-renewal-fixture-006-pay'});
 check(paid.id===invoice&&paid.livemode===false&&paid.status==='paid'&&paid.amount_paid===14900&&paid.amount_remaining===0&&paid.paid_out_of_band!==true);
 return 'paid';
}
async function verifyReplay({stripe,base,secret,port}){
 const eventId='evt_1UgRKiEAmtgiDmNe6SDsekMQ',sub='sub_1UgRKgEAmtgiDmNepkoDERmu';
 const inbox=async()=>base.from('ritnome_stripe_inbox').select('stripe_event_id,livemode,subscription_id,processed_at').eq('livemode',false).eq('stripe_event_id',eventId).maybeSingle();
 const registry=async()=>base.from('ritnome_subscription_registry').select('livemode,billing_status,revision,paid_through,license_id').eq('livemode',false).eq('stripe_subscription_id',sub).maybeSingle();
 const audit=async()=>base.from('ritnome_decision_audit').select('stripe_event_id,revision,reason').eq('livemode',false).eq('stripe_event_id',eventId).maybeSingle();
 const [old,oldB,oldA]=await Promise.all([inbox(),registry(),audit()]);
 check(!old.error&&!oldB.error&&!oldA.error&&old.data?.subscription_id===sub&&old.data.livemode===false&&old.data.processed_at&&oldA.data?.stripe_event_id===eventId&&oldB.data?.livemode===false&&oldB.data.billing_status==='review'&&oldB.data.license_id===null);
 const e=await stripe.events.retrieve(eventId);
 const inv=e.data?.object;
 check(e.id===eventId&&e.livemode===false&&e.type==='invoice.paid'&&(idOf(inv?.subscription)||idOf(inv?.parent?.subscription_details?.subscription))===sub);
 const body=JSON.stringify(e);
 for(let n=0;n<2;n++){
  const sig=stripe.webhooks.generateTestHeaderString({payload:body,secret});
  const res=await fetch('http://127.0.0.1:'+port+'/ritnome/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':sig},body});
  check(res.status===200&&await res.text()==='Accepted');
 }
 const [now,nowB,nowA]=await Promise.all([inbox(),registry(),audit()]);
 check(!now.error&&!nowB.error&&!nowA.error&&now.data?.processed_at===old.data.processed_at&&nowB.data?.revision===oldB.data.revision&&nowB.data.billing_status==='review'&&nowA.data?.revision===oldA.data.revision);
 return 'passed';
}
module.exports={settleRenewal,verifyReplay};

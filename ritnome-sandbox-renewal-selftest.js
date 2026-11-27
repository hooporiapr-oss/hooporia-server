'use strict';
// One-shot test-clock runner. Hard-limited to the dedicated sandbox renewal fixture.
async function advanceRenewal({stripe,base,priceId}){
 const subId='sub_1UgRuxEAmtgiDmNe3TEy5Ipy',customer='cus_Vhre6t1ftZja9y',clockId='clock_1UgRujEAmtgiDmNe3iV0T8ie';
 const target=1795780800; // 2026-11-27 12:00 UTC; after renewal, before wall time.
 const requireOk=(x)=>{if(!x)throw Error('Sandbox renewal fixture mismatch');};
 const binding=await base.from('ritnome_subscription_registry').select('livemode,stripe_subscription_id,stripe_customer_id,stripe_price_id,license_id,paid_through,revision').eq('livemode',false).eq('stripe_subscription_id',subId).maybeSingle();
 requireOk(!binding.error&&binding.data?.livemode===false&&binding.data.stripe_subscription_id===subId&&binding.data.stripe_customer_id===customer&&binding.data.stripe_price_id===priceId&&binding.data.license_id===null&&binding.data.revision>=1&&Date.parse(binding.data.paid_through)>=Date.parse('2026-11-25T12:00:00Z'));
 const s=await stripe.subscriptions.retrieve(subId);
 requireOk(s.id===subId&&s.livemode===false&&s.customer===customer&&s.test_clock===clockId&&s.metadata?.ritnome_test==='phase_12e_renewal'&&s.items?.has_more===false&&s.items?.data?.length===1&&s.items.data[0].price?.id===priceId&&s.items.data[0].quantity===1);
 const c=await stripe.testHelpers.testClocks.retrieve(clockId);
 requireOk(c.id===clockId&&c.livemode===false&&Number.isSafeInteger(c.frozen_time)&&target<=Math.floor(Date.now()/1000));
 if(c.frozen_time>=target)return 'already_advanced';
 requireOk(c.status==='ready'&&c.frozen_time===1792929600);
 const advanced=await stripe.testHelpers.testClocks.advance(clockId,{frozen_time:target},{idempotencyKey:'ritnome-renewal-fixture-006'});
 requireOk(advanced.id===clockId&&advanced.livemode===false&&['advancing','ready'].includes(advanced.status));
 return advanced.status;
}
module.exports={advanceRenewal};

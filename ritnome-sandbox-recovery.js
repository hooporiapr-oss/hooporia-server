'use strict';
// Opt-in one-shot SANDBOX recovery test. No public route, no live credentials.
// The caller must first pass the sandbox server's environment and price checks.
const idOf=x=>typeof x==='string'?x:x?.id;
const check=(ok)=>{if(!ok)throw Error('Sandbox recovery fixture mismatch');};
async function recoverFixture({stripe,base,priceId,subscriptionId,invoiceId}){
 check(/^sub_[A-Za-z0-9]+$/.test(subscriptionId||'')&&/^in_[A-Za-z0-9]+$/.test(invoiceId||''));
 const b=await base.from('ritnome_subscription_registry').select('livemode,stripe_customer_id,stripe_subscription_id,stripe_price_id,license_id,paid_through').eq('livemode',false).eq('stripe_subscription_id',subscriptionId).maybeSingle();
 check(!b.error&&b.data?.livemode===false&&b.data.stripe_subscription_id===subscriptionId&&b.data.stripe_price_id===priceId&&b.data.license_id===null);
 const s=await stripe.subscriptions.retrieve(subscriptionId);
 check(s.id===subscriptionId&&s.livemode===false&&idOf(s.customer)===b.data.stripe_customer_id&&s.metadata?.ritnome_test==='phase_12c_failed_initial_payment'&&idOf(s.latest_invoice)===invoiceId&&s.items?.has_more===false&&s.items?.data?.length===1&&idOf(s.items.data[0].price)===priceId&&s.items.data[0].quantity===1);
 const i=await stripe.invoices.retrieve(invoiceId);
 check(i.id===invoiceId&&i.livemode===false&&idOf(i.customer)===b.data.stripe_customer_id&&(idOf(i.subscription)||idOf(i.parent?.subscription_details?.subscription))===subscriptionId&&i.currency==='usd'&&i.subtotal===14900&&i.total===16614&&i.automatic_tax?.enabled===true&&i.automatic_tax?.status==='complete');
 if(i.status==='paid'){check(i.amount_paid===16614&&i.amount_remaining===0&&i.paid_out_of_band!==true);return 'already_paid';}
 check(s.status==='incomplete'&&b.data.paid_through===null&&i.status==='open'&&i.amount_paid===0&&i.amount_remaining===16614&&i.attempted===true&&i.billing_reason==='subscription_create');
 const pm=await stripe.paymentMethods.attach('pm_card_visa',{customer:b.data.stripe_customer_id},{idempotencyKey:'ritnome-fixture-recovery-method-'+subscriptionId});
 check(pm.livemode===false&&idOf(pm.customer)===b.data.stripe_customer_id&&/^pm_[A-Za-z0-9]+$/.test(pm.id));
 const paid=await stripe.invoices.pay(invoiceId,{payment_method:pm.id},{idempotencyKey:'ritnome-fixture-recovery-pay-'+invoiceId});
 check(paid.id===invoiceId&&paid.livemode===false&&paid.status==='paid'&&paid.amount_paid===16614&&paid.amount_remaining===0&&paid.paid_out_of_band!==true);
 return 'paid';
}
module.exports={recoverFixture};

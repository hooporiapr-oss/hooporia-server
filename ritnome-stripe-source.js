'use strict';
// Staged adapter: uses a dedicated, injected Stripe client, never the existing Cada Punto client.
// Supports legacy invoice.payment_intent and modern invoicePayments via a compatible SDK.
const idOf=x=>typeof x==='string'?x:x?.id;
const invoiceSub=i=>idOf(i.parent?.subscription_details?.subscription)||idOf(i.subscription);
const requireEvidence=(ok,reason)=>{if(!ok)throw Error('Ritnome payment evidence: '+reason);};
function createStripeSource({stripe,priceId,livemode}){
 requireEvidence(typeof livemode==='boolean'&&typeof priceId==='string'&&priceId.startsWith('price_')&&stripe?.subscriptions?.retrieve&&stripe?.invoices?.retrieve&&stripe?.paymentIntents?.retrieve,'configuration');
 return {async readVerifiedSnapshot(binding){
  requireEvidence(binding?.livemode===livemode&&binding.stripe_price_id===priceId,'binding mode or price');
  const s=await stripe.subscriptions.retrieve(binding.stripe_subscription_id);
  requireEvidence(s.id===binding.stripe_subscription_id&&s.livemode===livemode&&idOf(s.customer)===binding.stripe_customer_id,'subscription identity');
  requireEvidence(!s.items?.has_more&&s.items?.data?.length===1&&idOf(s.items.data[0].price)===priceId&&s.items.data[0].quantity===1,'subscription items');
  const invoiceId=idOf(s.latest_invoice);
  if(!invoiceId)return {verified:true,subscription:s,invoice:null};
  const i=await stripe.invoices.retrieve(invoiceId);
  requireEvidence(i.id===invoiceId&&i.livemode===livemode&&idOf(i.customer)===binding.stripe_customer_id&&invoiceSub(i)===s.id&&i.currency==='usd','invoice identity');
  if(i.status!=='paid')return {verified:true,subscription:s,invoice:i};
  requireEvidence(i.paid_out_of_band!==true&&['subscription_create','subscription_cycle'].includes(i.billing_reason)&&i.subtotal===14900&&Number.isSafeInteger(i.total)&&i.total>=14900&&i.amount_paid===i.total&&i.amount_due===i.total&&i.amount_remaining===0,'invoice settlement');
  requireEvidence(i.automatic_tax?.enabled===true&&i.automatic_tax?.status==='complete','automatic tax');
  requireEvidence(i.starting_balance===0&&i.ending_balance===0&&Array.isArray(i.total_discount_amounts)&&i.total_discount_amounts.length===0&&i.pre_payment_credit_notes_amount===0&&i.post_payment_credit_notes_amount===0,'credits or discounts');
  requireEvidence(!i.lines?.has_more&&i.lines?.data?.length===1&&i.lines.data[0].amount===14900,'invoice lines');
  let piId=idOf(i.payment_intent);
  if(!piId){
   requireEvidence(typeof stripe.invoicePayments?.list==='function','modern invoice payments SDK unavailable');
   const list=await stripe.invoicePayments.list({invoice:i.id,limit:100});
   requireEvidence(list.has_more===false&&list.data?.length===1,'payment count');
   const p=list.data[0];
   requireEvidence(p.livemode===livemode&&idOf(p.invoice)===i.id&&p.status==='paid'&&p.amount_paid===i.total&&p.currency==='usd'&&p.payment?.type==='payment_intent','invoice payment');
   piId=idOf(p.payment.payment_intent);
  }
  requireEvidence(typeof piId==='string'&&piId.startsWith('pi_'),'payment intent reference');
  const pi=await stripe.paymentIntents.retrieve(piId,{expand:['latest_charge']});
  const ch=pi.latest_charge;
  requireEvidence(pi.id===piId&&pi.livemode===livemode&&idOf(pi.customer)===binding.stripe_customer_id&&pi.currency==='usd'&&pi.status==='succeeded'&&pi.amount_received===i.total,'payment intent');
  requireEvidence(ch&&typeof ch==='object'&&ch.livemode===livemode&&idOf(ch.payment_intent)===piId&&idOf(ch.customer)===binding.stripe_customer_id&&ch.currency==='usd'&&ch.status==='succeeded'&&ch.paid===true&&ch.captured===true&&ch.amount_captured===i.total&&ch.refunded===false&&ch.amount_refunded===0&&ch.disputed===false,'charge or reversal');
  return {verified:true,subscription:s,invoice:i};
 }};
}
module.exports={createStripeSource};

'use strict';
// Pure reconciliation candidate. No database writes, no license creation.
const idOf=x=>typeof x==='string'?x:x?.id;
const validTime=x=>Number.isSafeInteger(x)&&x>0&&x<253402300800;
const invoiceSub=i=>idOf(i.parent?.subscription_details?.subscription)||idOf(i.subscription);
const linePrice=l=>idOf(l.pricing?.price_details?.price)||idOf(l.price);
const lineItem=l=>idOf(l.parent?.subscription_item_details?.subscription_item)||idOf(l.subscription_item);
function evaluate({binding,subscription,invoice,priceId,now}) {
 if(!validTime(now)) throw new Error('Invalid clock');
 if(!binding||!subscription||!priceId) throw new Error('Missing binding or Stripe snapshot');
 const old=binding.paid_through==null?0:Date.parse(binding.paid_through)/1000;
 if(old!==0&&!validTime(old)) throw new Error('Invalid existing entitlement');
 const review=reason=>({decision:'review',reason,billingStatus:'review',paidThrough:old?new Date(old*1000).toISOString():null,access:'unchanged'});
 if(binding.livemode!==subscription.livemode||binding.stripe_subscription_id!==subscription.id||
    binding.stripe_customer_id!==idOf(subscription.customer)||binding.stripe_price_id!==priceId) return review('binding_mismatch');
 const items=subscription.items?.data;
 if(!Array.isArray(items)||subscription.items.has_more||items.length!==1) return review('unsupported_items');
 const item=items[0];
 if(idOf(item.price)!==priceId||item.quantity!==1) return review('price_or_quantity_mismatch');
 const status=subscription.status;
 if(!['active','past_due','unpaid','canceled','incomplete','incomplete_expired','trialing','paused'].includes(status)) return review('unknown_status');
 let end=old;
 // Only a paid, positive-value regular monthly invoice can extend a bound entitlement.
 // Credits, discounts, manual/offline settlement, refunds and disputes need separate review.
 if(invoice&&invoice.status==='paid'){
  if(invoice.livemode!==binding.livemode||idOf(invoice.customer)!==binding.stripe_customer_id||
     invoiceSub(invoice)!==subscription.id||invoice.currency!=='usd') return review('invoice_mismatch');
  if(invoice.paid_out_of_band===true||invoice.amount_paid<=0||!Number.isSafeInteger(invoice.amount_paid)||
     !['subscription_create','subscription_cycle'].includes(invoice.billing_reason)) return review('nonstandard_payment');
  const lines=invoice.lines?.data;
  if(!Array.isArray(lines)||invoice.lines.has_more||lines.length!==1) return review('unsupported_invoice_lines');
  const line=lines[0];
  const proration=line.parent?.subscription_item_details?.proration??line.proration;
  const start=line.period?.start, stop=line.period?.end;
  if(linePrice(line)!==priceId||lineItem(line)!==item.id||line.quantity!==1||
     proration!==false||line.amount!==14900||!validTime(start)||!validTime(stop)||
     stop<=start||stop-start>32*86400||start>now) return review('invalid_paid_period');
  end=Math.max(old,stop);
 }
 // Free trial (owner-approved 2026-11-28): only a first entitlement, only while Stripe says 'trialing', only up to 14 days + 1 day of slack,
 // and never extended by a trial again once a paid period exists. A trial cannot stack with or follow a paid period.
 const TRIAL_MAX=15*86400;
 let trial=false;
 if(status==='trialing'){
  const ts=subscription.trial_start,te=subscription.trial_end,created=subscription.created;
  if(!validTime(ts)||!validTime(te)||!validTime(created)||te<=ts||te-ts>TRIAL_MAX||ts<created-86400||ts>now) return review('invalid_trial_period');
  if(old!==0&&old!==te) return review('trial_after_paid_period');   // the same trial may be re-read; a different period may not
  end=te;trial=true;
 }
 const eligible=end>now&&(trial||['active','past_due','unpaid','canceled'].includes(status));
 const hasLicense=Boolean(binding.license_id);
 return {decision:'reconcile',billingStatus:status,paidThrough:end?new Date(end*1000).toISOString():null,
   access:!binding.livemode?'test_only':!hasLicense?'await_admin_binding':eligible?'eligible':'suspend',
   reason:eligible?(trial?'verified_trial_period':'verified_paid_period'):'no_current_paid_period'};
}
module.exports={evaluate};

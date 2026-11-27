'use strict';
// Staged worker; not mounted or scheduled. Dedicated sandbox client only until release approval.
const {evaluate}=require('./ritnome-entitlement');
function createWorker({base,source,priceId,livemode,clock=()=>Math.floor(Date.now()/1000),maxRetries=3}){
 if(typeof livemode!=='boolean'||!priceId||typeof base?.from!=='function'||typeof base?.rpc!=='function'||typeof source?.readVerifiedSnapshot!=='function'||!Number.isInteger(maxRetries)||maxRetries<1||maxRetries>5)throw Error('Invalid worker configuration');
 async function one(eventId){
  if(typeof eventId!=='string'||!/^evt_[A-Za-z0-9]+$/.test(eventId))throw Error('Invalid event ID');
  for(let n=0;n<maxRetries;n++){
   const e=await base.from('ritnome_stripe_inbox').select('livemode,stripe_event_id,subscription_id,processed_at').eq('livemode',livemode).eq('stripe_event_id',eventId).maybeSingle();
   if(e.error)throw Error('Inbox read failed');
   if(!e.data)return 'missing_event';
   if(e.data.livemode!==livemode||e.data.stripe_event_id!==eventId)throw Error('Event identity mismatch');
   if(e.data.processed_at)return 'duplicate';
   const sub=e.data.subscription_id;
   const b=await base.from('ritnome_subscription_registry').select('livemode,stripe_subscription_id,stripe_customer_id,stripe_price_id,license_id,paid_through,billing_status,revision').eq('livemode',livemode).eq('stripe_subscription_id',sub).maybeSingle();
   if(b.error)throw Error('Binding read failed');
   if(!b.data)return 'await_admin_binding';
   const binding=b.data;
   if(binding.livemode!==livemode||binding.stripe_subscription_id!==sub||binding.stripe_price_id!==priceId||!Number.isSafeInteger(binding.revision)||binding.revision<0)throw Error('Invalid binding');
   const snap=await source.readVerifiedSnapshot(binding);
   if(snap?.verified!==true)throw Error('Unverified payment evidence');
   const result=(binding.billing_status==='review'||snap.reversal===true) ? {decision:'review',billingStatus:'review',paidThrough:binding.paid_through,reason:snap.reversal===true?'payment_reversal_review':'existing_review_hold'} : evaluate({binding,subscription:snap.subscription,invoice:snap.invoice,priceId,now:clock()});
   // SQL prohibits non-active extensions. Hold ambiguous paid/non-active cases for review.
   if(result.decision==='reconcile'&&result.billingStatus!=='active'&&(result.paidThrough==null?null:Date.parse(result.paidThrough))!==(binding.paid_through==null?null:Date.parse(binding.paid_through))){
    result.decision='review';result.billingStatus='review';result.paidThrough=binding.paid_through;result.reason='nonactive_paid_extension_review';
   }
   const reply=await base.rpc('ritnome_commit_decision',{p_mode:livemode,p_event:eventId,p_subscription:sub,p_revision:binding.revision,p_status:result.billingStatus,p_paid_through:result.paidThrough,p_decision:result.decision,p_reason:result.reason});
   if(reply.error)throw Error('Atomic commit failed');
   if(reply.data==='retry')continue; // reread binding and authoritative Stripe data
   if(!['committed','duplicate','await_admin_binding'].includes(reply.data))throw Error('Unexpected commit result');
   return reply.data;
  }
  return 'retry_later';
 }
 return {one};
}
module.exports={createWorker};

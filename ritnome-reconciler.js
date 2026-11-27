'use strict';
// Review-only worker. No live route, scheduler or license writes.
const {evaluate}=require('./ritnome-entitlement');
function createReconciler({store,source,priceId,livemode,clock=()=>Math.floor(Date.now()/1000)}){
 if(typeof livemode!=='boolean'||!priceId||typeof store?.withSubscriptionLock!=='function'||typeof source?.readVerifiedSnapshot!=='function')throw Error('Missing reconciliation configuration');
 return async function reconcile(event){
  if(event.livemode!==livemode)throw Error('Unexpected mode');
  return store.withSubscriptionLock(livemode,event.subscription_id,async tx=>{
   if(await tx.isProcessed(event.stripe_event_id))return 'duplicate';
   const binding=await tx.getBinding();
   if(!binding)return 'await_admin_binding'; // retain inbox event
   // Source contract: fresh authoritative Stripe state, including actual payment
   // and reversal checks; reject unverifiable evidence rather than grant access.
   const snapshot=await source.readVerifiedSnapshot(binding);
   if(snapshot.verified!==true)throw Error('Payment evidence not verified');
   const result=evaluate({binding,subscription:snapshot.subscription,invoice:snapshot.invoice,priceId,now:clock()});
   // Atomic transaction, including audit; no production license updates here.
   await tx.recordDecision({eventId:event.stripe_event_id,result});
   await tx.markProcessed(event.stripe_event_id);
   return result.decision;
  });
 };
}
module.exports={createReconciler};

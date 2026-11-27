'use strict';
// Backend only: pass a dedicated server-side Supabase client, never a browser client.
function createInbox(base) {
  if (typeof base?.from !== 'function') throw new Error('Missing database client');
  return {
    async isTracked(subscriptionId, livemode) {
      const {data,error}=await base.from('ritnome_subscription_registry')
        .select('id').eq('livemode',livemode).eq('stripe_subscription_id',subscriptionId).maybeSingle();
      if(error) throw new Error('Registry lookup failed');
      return data !== null;
    },
    async enqueue(event) {
      const {error}=await base.from('ritnome_stripe_inbox').upsert({
        livemode:event.livemode,stripe_event_id:event.stripe_event_id,
        subscription_id:event.subscription_id,event_type:event.event_type,event_created:event.event_created
      },{onConflict:'livemode,stripe_event_id',ignoreDuplicates:true});
      if(error) throw new Error('Inbox persistence failed');
    }
  };
}
module.exports={createInbox};

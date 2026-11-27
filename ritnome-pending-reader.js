'use strict';
// Backend-only pending event retrieval, fixed mode, deterministic keyset order.
// Preserve the exact Postgres timestamp (including microseconds) in cursor.
function createPendingReader({base,livemode}){
 if(typeof livemode!=='boolean'||typeof base?.from!=='function')throw Error('Invalid pending reader configuration');
 return async function listPending({limit,after=null}){
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid pending limit');
  let q=base.from('ritnome_stripe_inbox').select('stripe_event_id,received_at').eq('livemode',livemode).is('processed_at',null);
  if(after!==null){
   const t=after.received_at,id=after.stripe_event_id;
   if(typeof t!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(t)||!Number.isFinite(Date.parse(t))||typeof id!=='string'||!/^evt_[A-Za-z0-9]+$/.test(id))throw Error('Invalid pending cursor');
   q=q.or('received_at.gt.'+t+',and(received_at.eq.'+t+',stripe_event_id.gt.'+id+')');
  }
  const {data,error}=await q.order('received_at',{ascending:true}).order('stripe_event_id',{ascending:true}).limit(limit);
  if(error||!Array.isArray(data)||data.length>limit)throw Error('Pending event read failed');
  return data;
 };
}
module.exports={createPendingReader};

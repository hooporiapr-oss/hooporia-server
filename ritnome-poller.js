'use strict';
// Staged scheduler. Explicit start/stop; no side effects on import.
// Single process polling; database revision checks protect atomic commits across workers.
function createPoller({listPending,worker,log=()=>{},intervalMs=15000,batchSize=25,clock=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
 if(typeof listPending!=='function'||typeof worker?.one!=='function'||!Number.isInteger(intervalMs)||intervalMs<1000||!Number.isInteger(batchSize)||batchSize<1||batchSize>100)throw Error('Invalid poller configuration');
 let running=false,timer=null,inFlight=null,cursor=null;
 const deferred=new Map();
 const report=(message)=>{try{log(message)}catch{}};
 async function cycle(){
  const rows=await listPending({limit:batchSize,after:cursor});
  if(!Array.isArray(rows)||rows.length>batchSize)throw Error('Invalid pending batch');
  if(!rows.length){cursor=null;return;}
  const now=clock();
  for(const [id,entry] of deferred)if(entry.until+86400000<now)deferred.delete(id);
  for(const row of rows){
   if(!running)break;
   if(!/^evt_[A-Za-z0-9]+$/.test(row.stripe_event_id)||typeof row.received_at!=='string'||!Number.isFinite(Date.parse(row.received_at)))throw Error('Invalid pending row');
   cursor={received_at:row.received_at,stripe_event_id:row.stripe_event_id};
   const id=row.stripe_event_id, previous=deferred.get(id);
   if(previous&&previous.until>clock())continue;
   try{
    const result=await worker.one(id);
    if(['committed','duplicate','missing_event'].includes(result)){deferred.delete(id);continue;}
    if(!['await_admin_binding','retry_later'].includes(result))throw Error('Unexpected worker result');
   }catch{report('Ritnome event processing deferred');}
   const attempts=Math.min((previous?.attempts||0)+1,10);
   if(deferred.size>=10000&&!deferred.has(id))deferred.delete(deferred.keys().next().value);
   deferred.set(id,{attempts,until:clock()+Math.min(900000,intervalMs*2**attempts)});
  }
  if(rows.length<batchSize)cursor=null;
 }
 function schedule(delay){
  if(!running)return;
  timer=setTimer(()=>{timer=null;if(!running)return;inFlight=cycle().catch(()=>report('Ritnome polling failed')).finally(()=>{inFlight=null;schedule(intervalMs)});},delay);
 }
 return {start(){if(running||inFlight)return false;running=true;schedule(0);return true;},async stop(){running=false;if(timer!==null){clearTimer(timer);timer=null;}if(inFlight)await inFlight;},isRunning(){return running;}};
}
module.exports={createPoller};

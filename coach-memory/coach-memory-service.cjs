// Server-only development module. NOT a deployed endpoint. No credentials in source.
// A trusted host must supply a dedicated database connection and Supabase configuration.
'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(status)=>Object.assign(new Error('Request rejected'),{status});
function validUuid(v){return typeof v==='string'&&UUID.test(v)}
function createMemoryService({supabaseUrl,publishableKey,withTransaction,fetchImpl=globalThis.fetch,now=()=>Date.now()}){
 const url=new URL(supabaseUrl);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||!publishableKey||typeof withTransaction!=='function')throw new Error('Invalid server configuration');
 async function authenticate(authorization){
  if(typeof authorization!=='string'||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization)||authorization.length>8192)throw fail(401);
  // Supabase Auth validates the exact token; decoded claims alone are never proof.
  let res;try{res=await fetchImpl(new URL('/auth/v1/user',url),{headers:{Authorization:authorization,apikey:publishableKey},redirect:'error',signal:AbortSignal.timeout(5000)})}catch{throw fail(503)}
  if(!res.ok)throw fail(res.status===401||res.status===403?401:503);
  let user,claims;try{user=await res.json();claims=JSON.parse(Buffer.from(authorization.split('.')[1],'base64url').toString('utf8'))}catch{throw fail(401)}
  if(!validUuid(user.id)||user.id!==claims.sub||user.is_anonymous!==false||claims.is_anonymous!==false||claims.role!=='authenticated'||!validUuid(claims.session_id)||!Number.isFinite(claims.exp)||claims.exp*1000<=now()||claims.iss!==url.origin+'/auth/v1')throw fail(401);
  return {actor:user.id,session:claims.session_id,expires:claims.exp};
 }
 async function run(authorization,input){
  const principal=await authenticate(authorization);
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail(400);
  if(input.action==='list_enrollments'){
   const size=input.page_size??25;
   if(Object.keys(input).some(k=>!['action','after_id','page_size'].includes(k))||!Number.isInteger(size)||size<1||size>100||(input.after_id!=null&&!validUuid(input.after_id)))throw fail(400);
   try{return await withTransaction(async db=>{
    const q=await db.query('select * from coach_memory_private.server_list_enrollments($1::uuid,$2::uuid,$3::bigint,$4::uuid,$5::integer)',[principal.actor,principal.session,principal.expires,input.after_id??null,size]);
    if(!Array.isArray(q.rows)||q.rows.length>size||q.rows.some(r=>!validUuid(r.membership_id)||typeof r.program_key!=='string'||!r.program_key.trim()||r.program_key.length>200||(r.label!=null&&(typeof r.label!=='string'||r.label.length>80))))throw fail(503);
    return {enrollments:q.rows.map(r=>({membership_id:r.membership_id,program_key:r.program_key,label:r.label??null}))};
   })}catch(e){if(e.status)throw e;if(e.code==='28000')throw fail(401);if(e.code==='42501')throw fail(403);if(e.code==='22023')throw fail(400);throw fail(503)}
  }
  if(!validUuid(input.membership_id))throw fail(400);
  const goal=input.action==='save_goal',read=input.action==='read',save=input.action==='save_plan',submit=input.action==='submit_bpm',confirm=input.action==='confirm_bpm',bound=input.action==='save_bpm_plan',lookup=input.action==='get_bpm_plan';
  if(!goal&&!read&&!save&&!submit&&!confirm&&!bound&&!lookup)throw fail(400);
  const common=['action','membership_id'];
  const keys=common.concat(goal?['request_id','effective_on','goal']:lookup?['plan_id','station']:read?['page_size','before_time','before_id']:submit?['request_id','bpm','measured_at']:confirm?['request_id','measurement_id']:bound?['request_id','effective_on','plan','confirmation_id']:['request_id','effective_on','plan']);
  if(Object.keys(input).some(k=>!keys.includes(k)))throw fail(400);
  if(!read&&!lookup&&!validUuid(input.request_id))throw fail(400);
  if(lookup&&(!validUuid(input.plan_id)||!['recall','recognition','replay','fortress','zn','zr','enc','ritnome'].includes(input.station)))throw fail(400);
  if(submit&&(!Number.isInteger(input.bpm)||input.bpm<1||input.bpm>1000||typeof input.measured_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(input.measured_at)||!Number.isFinite(Date.parse(input.measured_at))))throw fail(400);
  if(confirm&&!validUuid(input.measurement_id))throw fail(400);
  if(bound&&!validUuid(input.confirmation_id))throw fail(400);
  if((save||bound)&&(typeof input.effective_on!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.effective_on)||!input.plan||typeof input.plan!=='object'||Array.isArray(input.plan)||Buffer.byteLength(JSON.stringify(input.plan))>32768))throw fail(400);
  if(bound&&Object.hasOwn(input.plan,'bpm'))throw fail(400);
  if(save&&input.plan.bpm!==null)throw fail(400);
  if(goal){const p=input.goal;if(typeof input.effective_on!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.effective_on)||!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).length!==3||!['active_days','reaction_bpm','recall','recognition','replay','fortress'].includes(p.metric)||!Number.isInteger(p.baseline)||!Number.isInteger(p.target)||p.baseline<0||p.target<=p.baseline||p.target>99999||(p.metric==='active_days'&&p.target>7))throw fail(400);}
  const size=input.page_size??25;
  if(read&&(!Number.isInteger(size)||size<1||size>100||(input.before_time==null)!==(input.before_id==null)||(input.before_id!=null&&(!validUuid(input.before_id)||typeof input.before_time!=='string'||!Number.isFinite(Date.parse(input.before_time))))))throw fail(400);
  try{return await withTransaction(async db=>{
   // Only restricted private wrappers are accessible to the future server login.
   const base=[principal.actor,principal.session,principal.expires,input.membership_id];
   let q;
   if(lookup){
    const q=await db.query('select coach_memory_private.server_get_bpm_plan($1::uuid,$2::uuid,$3::bigint,$4::uuid,$5::uuid,$6::text) as prescription',[...base,input.plan_id,input.station]);
    const p=q.rows[0]?.prescription;
    if(q.rows.length!==1||!p||p.plan_id!==input.plan_id||p.membership_id!==input.membership_id||p.station!==input.station||!validUuid(p.confirmation_id)||!Number.isInteger(p.bpm)||p.bpm<1||p.bpm>1000||typeof p.effective_on!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.effective_on)||!['5-6','7-8','9-10','11-12','13-14','15-17','other'].includes(p.stage))throw fail(503);
    return {prescription:{plan_id:p.plan_id,membership_id:p.membership_id,confirmation_id:p.confirmation_id,bpm:p.bpm,station:p.station,effective_on:p.effective_on,stage:p.stage}};
   }
   if(submit)q=await db.query('select coach_memory_private.server_submit_bpm($1::uuid,$2::uuid,$3::bigint,$4::uuid,$5::uuid,$6::integer,$7::timestamptz) as id',[...base,input.request_id,input.bpm,input.measured_at]);
   else if(confirm)q=await db.query('select coach_memory_private.server_confirm_bpm($1::uuid,$2::uuid,$3::bigint,$4::uuid,$5::uuid,$6::uuid) as id',[...base,input.measurement_id,input.request_id]);
   else if(bound)q=await db.query('select coach_memory_private.server_save_bpm_plan($1::uuid,$2::uuid,$3::bigint,$4::uuid,$5::uuid,$6::date,$7::uuid,$8::jsonb) as id',[...base,input.confirmation_id,input.effective_on,input.request_id,JSON.stringify(input.plan)]);
   if(submit||confirm||bound){if(!validUuid(q.rows[0]?.id))throw fail(503);return {id:q.rows[0].id}}
   if(goal){
    const q=await db.query('select coach_memory_private.server_save_goal($1::uuid,$2::uuid,$3::bigint,$4::uuid,$5::date,$6::uuid,$7::jsonb) as id',[...base,input.effective_on,input.request_id,JSON.stringify(input.goal)]);
    if(!validUuid(q.rows[0]?.id))throw fail(503);return {id:q.rows[0].id};
   }
   if(save){
    const q=await db.query('select coach_memory_private.server_save_plan($1::uuid,$2::uuid,$3::bigint,$4::uuid,$5::date,$6::uuid,$7::jsonb) as id',[principal.actor,principal.session,principal.expires,input.membership_id,input.effective_on,input.request_id,JSON.stringify(input.plan)]);
    if(!validUuid(q.rows[0]?.id))throw fail(503);return {id:q.rows[0].id};
   }
   q=await db.query('select * from coach_memory_private.server_read_memory($1::uuid,$2::uuid,$3::bigint,$4::uuid,$5::integer,$6::timestamptz,$7::uuid)',[principal.actor,principal.session,principal.expires,input.membership_id,size,input.before_time??null,input.before_id??null]);return {records:q.rows};
  })}catch(e){if(e.status)throw e;if(e.code==='28000')throw fail(401);if(e.code==='42501')throw fail(403);if(e.code==='22023'||e.code==='22007'||e.code==='22008')throw fail(400);throw fail(503)}
 }
 return {run};
}
module.exports={createMemoryService};

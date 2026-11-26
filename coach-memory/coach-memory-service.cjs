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
  if(!input||typeof input!=='object'||Array.isArray(input)||!validUuid(input.membership_id))throw fail(400);
  const read=input.action==='read',save=input.action==='save_plan';
  if(!read&&!save)throw fail(400);
  const keys=read?['action','membership_id','page_size','before_time','before_id']:['action','membership_id','request_id','effective_on','plan'];
  if(Object.keys(input).some(k=>!keys.includes(k)))throw fail(400);
  if(save&&(!validUuid(input.request_id)||typeof input.effective_on!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.effective_on)||!input.plan||typeof input.plan!=='object'||Array.isArray(input.plan)||Buffer.byteLength(JSON.stringify(input.plan))>32768))throw fail(400);
  const size=input.page_size??25;
  if(read&&(!Number.isInteger(size)||size<1||size>100||(input.before_time==null)!==(input.before_id==null)||(input.before_id!=null&&(!validUuid(input.before_id)||typeof input.before_time!=='string'||!Number.isFinite(Date.parse(input.before_time))))))throw fail(400);
  try{return await withTransaction(async db=>{
   // Only restricted private wrappers are accessible to the future server login.
   if(save){
    const q=await db.query('select coach_memory_private.server_save_plan($1::uuid,$2::uuid,$3::bigint,$4::uuid,$5::date,$6::uuid,$7::jsonb) as id',[principal.actor,principal.session,principal.expires,input.membership_id,input.effective_on,input.request_id,JSON.stringify(input.plan)]);
    if(!validUuid(q.rows[0]?.id))throw fail(503);return {id:q.rows[0].id};
   }
   const q=await db.query('select * from coach_memory_private.server_read_memory($1::uuid,$2::uuid,$3::bigint,$4::uuid,$5::integer,$6::timestamptz,$7::uuid)',[principal.actor,principal.session,principal.expires,input.membership_id,size,input.before_time??null,input.before_id??null]);return {records:q.rows};
  })}catch(e){if(e.status)throw e;if(e.code==='28000')throw fail(401);if(e.code==='42501')throw fail(403);if(e.code==='22023'||e.code==='22007'||e.code==='22008')throw fail(400);throw fail(503)}
 }
 return {run};
}
module.exports={createMemoryService};

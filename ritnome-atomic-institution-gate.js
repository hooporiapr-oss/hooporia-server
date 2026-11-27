'use strict';
// Server-side candidate; mode is chosen by trusted runtime, never by the request.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function createAtomicInstitutionGate({auth,base,priceId,livemode}){
 if(typeof livemode!=='boolean'||typeof auth?.getUser!=='function'||typeof base?.rpc!=='function'||!/^price_[A-Za-z0-9_]+$/.test(priceId||''))throw Error('Invalid access gate configuration');
 async function authorize(header){
  const deny=status=>({status,allowed:false});
  if(typeof header!=='string'||header.length>8192||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(header))return deny(401);
  const token=header.slice(7);
  const {data,error}=await auth.getUser(token);
  if(error){if([400,401,403].includes(error.status))return deny(401);throw Error('Authentication unavailable');}
  const user=data?.user;
  if(!user||!uuid.test(user.id)||user.role!=='authenticated'||user.is_anonymous===true)return deny(401);
  // Claims are inspected only after Supabase Auth verifies the same token.
  let claims;try{claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));}catch{return deny(401);}
  if(claims.sub!==user.id||claims.role!=='authenticated'||!uuid.test(claims.session_id||'')||!Number.isFinite(claims.exp)||claims.exp<=Date.now()/1000)return deny(401);
  const result=await base.rpc('ritnome_institution_authorized',{p_mode:livemode,p_user:user.id,p_session:claims.session_id,p_price:priceId});
  if(result.error||typeof result.data!=='boolean')throw Error('Authorization unavailable');
  return result.data?{status:200,allowed:true}:deny(403);
 }
 async function handler(req,res){
  res.set('Cache-Control','no-store');
  try{const r=await authorize(req.headers?.authorization);return res.status(r.status).json({allowed:r.allowed});}
  catch{return res.status(503).json({allowed:false});}
 }
 return {authorize,handler};
}
module.exports={createAtomicInstitutionGate};

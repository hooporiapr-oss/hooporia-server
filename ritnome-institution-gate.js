'use strict';
// Unmounted candidate. Auth client must be separate from privileged database client.
const {evaluateInstitutionAccess}=require('./ritnome-institution-access');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function createInstitutionGate({auth,base,priceId,clock=Date.now}){
 if(typeof auth?.getUser!=='function'||typeof base?.from!=='function'||typeof priceId!=='string'||!priceId.startsWith('price_'))throw Error('Invalid gate configuration');
 async function authorize(header){
  const denied=status=>({status,allowed:false});
  if(typeof header!=='string'||header.length>8192||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(header))return denied(401);
  const {data,error}=await auth.getUser(header.slice(7));
  if(error){if([400,401,403].includes(error.status))return denied(401);throw Error('Authentication unavailable');}
  const user=data?.user;
  if(!user||!uuid.test(user.id)||user.is_anonymous===true||user.role!=='authenticated')return denied(401);
  const m=await base.from('ritnome_institution_memberships').select('livemode,user_id,facility_id,active').eq('livemode',true).eq('user_id',user.id).maybeSingle();
  if(m.error)throw Error('Membership lookup failed');
  if(!m.data||m.data.livemode!==true||m.data.user_id!==user.id||m.data.active!==true||!uuid.test(m.data.facility_id))return denied(403);
  const facilityId=m.data.facility_id;
  const b=await base.from('ritnome_subscription_registry').select('livemode,facility_id,stripe_price_id,license_id,billing_status,paid_through').eq('livemode',true).eq('facility_id',facilityId).maybeSingle();
  if(b.error)throw Error('Binding lookup failed');
  if(!b.data||b.data.livemode!==true||b.data.facility_id!==facilityId||!uuid.test(b.data.license_id||''))return denied(403);
  const l=await base.from('licenses').select('id,product,active,expires_at').eq('id',b.data.license_id).maybeSingle();
  if(l.error)throw Error('License lookup failed');
  const result=evaluateInstitutionAccess({binding:b.data,license:l.data,facilityId,priceId,now:clock()});
  return result.allowed?{status:200,allowed:true,facilityId,userId:user.id}:denied(403);
 }
 async function handler(req,res){
  res.set('Cache-Control','no-store');
  try{
   const result=await authorize(req.headers?.authorization);
   return res.status(result.status).json({allowed:result.allowed});
  }catch{return res.status(503).json({allowed:false});}
 }
 return {authorize,handler};
}
module.exports={createInstitutionGate};

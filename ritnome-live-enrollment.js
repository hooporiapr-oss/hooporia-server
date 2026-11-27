'use strict';
// Dedicated live candidate. Owner and license are preapproved by an administrator. Never accepts customer, price or facility ID from the browser.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf=x=>typeof x==='string'?x:x?.id;
const checkoutPattern=/^cs_live_[A-Za-z0-9]+$/;
function createEnrollment({stripe,base,auth,priceId,portalConfig,returnUrl,livemode}){
 if(livemode!==true||priceId!=='price_1UgP8ZCuedlcmwMmeEZr9ev2'||!/^bpc_[A-Za-z0-9]+$/.test(portalConfig)||returnUrl!=='https://institutional.ritnome.com/enroll')throw Error('Invalid live enrollment configuration');
 const fail=(status,message)=>Object.assign(Error(message),{status});
 const ensure=(ok)=>{if(!ok)throw fail(503,'verification_required');};
 async function owner(header){
  if(typeof header!=='string'||header.length>8192||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(header))throw fail(401,'sign_in');
  const token=header.slice(7),r=await auth.getUser(token);
  if(r.error){if([400,401,403].includes(r.error.status))throw fail(401,'sign_in');throw fail(503,'unavailable');}
  const user=r.data?.user;
  let c;try{c=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));}catch{throw fail(401,'sign_in');}
  if(!user||!uuid.test(user.id)||user.role!=='authenticated'||user.is_anonymous||c.sub!==user.id||c.role!=='authenticated'||!uuid.test(c.session_id||'')||!Number.isFinite(c.exp)||c.exp<=Date.now()/1000)throw fail(401,'sign_in');
  const valid=await base.rpc('ritnome_owner_session',{p_user:user.id,p_session:c.session_id});
  ensure(!valid.error&&typeof valid.data==='boolean');
  if(!valid.data)throw fail(401,'sign_in');
  return {id:user.id,session:c.session_id};
 }
 async function lookup(o){
  const r=await base.from('ritnome_enrollment').select('*').eq('livemode',true).eq('owner_id',o.id).maybeSingle();
  ensure(!r.error);
  if(!r.data||r.data.livemode!==true||r.data.owner_id!==o.id||r.data.enabled!==true||!uuid.test(r.data.approved_license_id||''))throw fail(403,'invitation_required');
  return r.data;
 }
 async function binding(e){
  const r=await base.from('ritnome_subscription_registry').select('livemode,facility_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,license_id,billing_status,paid_through').eq('livemode',true).eq('facility_id',e.facility_id).maybeSingle();
  ensure(!r.error);
  if(r.data)ensure(r.data.livemode===true&&r.data.facility_id===e.facility_id&&r.data.stripe_price_id===priceId&&r.data.stripe_customer_id===e.stripe_customer_id&&r.data.license_id===e.approved_license_id);
  return r.data;
 }
 function hosted(url,host){try{const u=new URL(url);ensure(u.protocol==='https:'&&u.hostname===host&&!u.username&&!u.password&&!u.port);return u.href;}catch{throw fail(503,'verification_required');}}
 async function inspect(e,session){
  ensure(session.id===e.checkout_session_id&&session.livemode===true&&session.mode==='subscription'&&session.client_reference_id===e.facility_id&&session.metadata?.ritnome_facility===e.facility_id&&session.automatic_tax?.enabled===true);
  const lines=await stripe.checkout.sessions.listLineItems(session.id,{limit:2});
  ensure(lines.has_more===false&&lines.data?.length===1&&idOf(lines.data[0].price)===priceId&&lines.data[0].quantity===1&&lines.data[0].amount_subtotal===14900);
  return session;
 }
 async function status(o,e){
  let b=await binding(e);
  if(!b&&e.checkout_session_id){
   const session=await inspect(e,await stripe.checkout.sessions.retrieve(e.checkout_session_id));
   if(session.status==='expired')return {facility:e.facility_name,state:'expired'};
   if(session.status==='complete'&&session.payment_status==='paid'){
    const subId=idOf(session.subscription),customer=idOf(session.customer);
    ensure(/^sub_[A-Za-z0-9]+$/.test(subId||'')&&/^cus_[A-Za-z0-9]+$/.test(customer||''));
    const sub=await stripe.subscriptions.retrieve(subId);
    ensure(sub.id===subId&&sub.livemode===true&&idOf(sub.customer)===customer&&sub.metadata?.ritnome_facility===e.facility_id&&sub.items?.has_more===false&&sub.items?.data?.length===1&&idOf(sub.items.data[0].price)===priceId&&sub.items.data[0].quantity===1);
    const result=await base.rpc('ritnome_live_bind_checkout',{p_owner:o.id,p_session:o.session,p_checkout:session.id,p_customer:customer,p_subscription:subId,p_price:priceId});
    ensure(!result.error&&['bound','already_bound'].includes(result.data));
    e=await lookup(o);b=await binding(e);ensure(b);
   }else if(session.status==='complete')return {facility:e.facility_name,state:'payment_pending'};
   else if(session.status==='open')return {facility:e.facility_name,state:'ready'};
   else throw fail(503,'verification_required');
  }
  if(!b)return {facility:e.facility_name,state:'ready'};
  const access=await base.rpc('ritnome_institution_authorized',{p_mode:true,p_user:o.id,p_session:o.session,p_price:priceId});
  ensure(!access.error&&typeof access.data==='boolean');
  return {facility:e.facility_name,state:access.data?'active':b.billing_status==='review'?'review':'payment_pending',paidThrough:b.paid_through,billingAvailable:true};
 }
 async function start(o,e){
  if(await binding(e))throw fail(409,'already_enrolled');
  const claim=await base.rpc('ritnome_live_claim_checkout',{p_owner:o.id,p_session:o.session});
  ensure(!claim.error);
  const row=claim.data?.[0];if(!row)throw fail(409,'enrollment_unavailable');
  ensure(row.livemode===true&&row.owner_id===o.id&&row.facility_id===e.facility_id&&row.enabled===true&&row.approved_license_id===e.approved_license_id);
  if(row.checkout_session_id){
   const s=await inspect(row,await stripe.checkout.sessions.retrieve(row.checkout_session_id));
   if(s.status!=='open')throw fail(409,s.status==='expired'?'expired':'check_status');
   return {url:hosted(s.url,'checkout.stripe.com')};
  }
  // Stripe retains idempotency keys for at least 24 hours. Do not create a second session after an uncertain older attempt.
  const age=Date.now()-Date.parse(row.checkout_started_at);ensure(Number.isFinite(age)&&age>=-60000&&age<20*3600000);
  const s=await stripe.checkout.sessions.create({mode:'subscription',line_items:[{price:priceId,quantity:1}],payment_method_types:['card'],automatic_tax:{enabled:true},billing_address_collection:'required',allow_promotion_codes:false,client_reference_id:row.facility_id,metadata:{ritnome_facility:row.facility_id},subscription_data:{metadata:{ritnome_facility:row.facility_id}},success_url:returnUrl+'?checkout=complete',cancel_url:returnUrl+'?checkout=canceled'},{idempotencyKey:'ritnome-enrollment-'+row.facility_id});
  ensure(checkoutPattern.test(s.id)&&s.livemode===true&&s.mode==='subscription'&&s.client_reference_id===row.facility_id&&s.status==='open');
  const saved=await base.from('ritnome_enrollment').update({checkout_session_id:s.id}).eq('livemode',true).eq('owner_id',o.id).eq('enabled',true).is('checkout_session_id',null).select('checkout_session_id').maybeSingle();
  ensure(!saved.error);const current=await lookup(o);ensure(current.checkout_session_id===s.id);
  return {url:hosted(s.url,'checkout.stripe.com')};
 }
 async function portal(o,e){
  const b=await binding(e);
  if(!b||!e.stripe_customer_id)throw fail(409,'billing_unavailable');
  // Checkout created a new customer exclusively for this enrollment.
  const c=await stripe.customers.retrieve(e.stripe_customer_id);
  ensure(c.id===e.stripe_customer_id&&c.livemode===true&&!c.deleted);
  const s=await stripe.billingPortal.sessions.create({customer:c.id,configuration:portalConfig,return_url:returnUrl});
  ensure(s.livemode===true&&s.customer===c.id&&s.configuration===portalConfig);
  return {url:hosted(s.url,'billing.stripe.com')};
 }
 function handler(action){return async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{const o=await owner(req.headers?.authorization),e=await lookup(o);const result=await ({status,start,portal}[action])(o,e);return res.status(200).json(result);}
  catch(err){const code=[401,403,409,503].includes(err?.status)?err.status:503;return res.status(code).json({error:code===503?'unavailable':err.message});}
 };}
 return {handler};
}
module.exports={createEnrollment};

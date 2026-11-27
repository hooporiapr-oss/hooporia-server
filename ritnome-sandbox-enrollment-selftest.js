'use strict';
// Temporary opt-in self-test for real sandbox Auth, enrollment HTTP and hosted Stripe session.
const {randomUUID,randomBytes}=require('node:crypto');
async function verifyEnrollment({base,signInClient,stripe,priceId,port}){
 const email='ritnome-enrollment-fixture-'+randomUUID()+'@example.invalid',password='Aa1!'+randomBytes(32).toString('hex');
 let uid,sessionId,stage='create user',checks=0;
 const check=(ok,name)=>{stage=name;if(!ok)throw Error('Sandbox enrollment test failed: '+stage);checks++;};
 const call=async(action,token,method='GET')=>{
  const r=await fetch('http://127.0.0.1:'+port+'/ritnome/sandbox/enrollment/'+action,{method,headers:token?{Authorization:'Bearer '+token}:{}});
  return {status:r.status,data:await r.json(),cache:r.headers.get('cache-control')};
 };
 const row=async()=>base.from('ritnome_enrollment').select('*').eq('livemode',false).eq('owner_id',uid).maybeSingle();
 try{
  const create=await base.auth.admin.createUser({email,password,email_confirm:true});
  check(!create.error&&create.data?.user?.id,'create user');uid=create.data.user.id;
  const signed=await signInClient.auth.signInWithPassword({email,password});
  check(!signed.error&&signed.data?.session?.access_token,'sign in');const token=signed.data.session.access_token;
  const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
  check((await call('status')).status===401,'missing token');
  check((await call('status','invalid.token.signature')).status===401,'bad token');
  check((await call('status',token)).status===403,'uninvited owner');
  const inserted=await base.from('ritnome_enrollment').insert({livemode:false,owner_id:uid,facility_name:'SYNTHETIC-ENROLLMENT-ONLY',facility_type:'residence'}).select('facility_id').single();
  check(!inserted.error&&inserted.data?.facility_id,'approved enrollment');
  const st=await call('status',token);check(st.status===200&&st.data.state==='ready'&&st.data.facility==='SYNTHETIC-ENROLLMENT-ONLY'&&st.cache==='no-store','approved owner status');
  check((await call('portal',token,'POST')).status===409,'unpaid portal denied');
  const first=await call('start',token,'POST');check(first.status===200&&first.data.url?.startsWith('https://checkout.stripe.com/'),'hosted checkout');
  const a=await row();sessionId=a.data?.checkout_session_id;check(!a.error&&typeof sessionId==='string'&&sessionId.startsWith('cs_test_'),'stored checkout identity');
  const second=await call('start',token,'POST');const b=await row();check(second.status===200&&second.data.url===first.data.url&&b.data?.checkout_session_id===sessionId,'checkout reuse');
  const s=await stripe.checkout.sessions.retrieve(sessionId);check(s.livemode===false&&s.mode==='subscription'&&s.status==='open'&&s.payment_status==='unpaid'&&s.client_reference_id===inserted.data.facility_id&&s.automatic_tax?.enabled===true,'provider checkout identity');
  const lines=await stripe.checkout.sessions.listLineItems(sessionId,{limit:2});check(lines.has_more===false&&lines.data?.length===1&&lines.data[0].price?.id===priceId&&lines.data[0].quantity===1&&lines.data[0].amount_subtotal===14900,'fixed line item');
  const denied=await base.rpc('ritnome_bind_checkout',{p_owner:uid,p_session:claims.session_id,p_checkout:'cs_test_wrong',p_customer:'cus_wrong',p_subscription:'sub_wrong',p_price:priceId});check(!denied.error&&denied.data==='denied','mismatched session bind denied');
  const reg=await base.from('ritnome_subscription_registry').select('id').eq('livemode',false).eq('facility_id',inserted.data.facility_id).maybeSingle();check(!reg.error&&reg.data===null,'no unpaid entitlement');
  const expired=await stripe.checkout.sessions.expire(sessionId);check(expired.livemode===false&&expired.status==='expired','expire test checkout');
  check((await call('status',token)).data.state==='expired','expired status');
  check((await call('start',token,'POST')).status===409,'no duplicate after expiry');
  const revoked=await signInClient.auth.signOut({scope:'global'});check(!revoked.error,'sign out');
  check((await call('status',token)).status===401,'revoked owner session');
  return checks;
 }catch(_){throw Error('Sandbox enrollment test failed: '+stage);}
 finally{
  if(uid){
   try{if(sessionId){const s=await stripe.checkout.sessions.retrieve(sessionId);if(s.livemode===false&&s.status==='open')await stripe.checkout.sessions.expire(sessionId);}}catch{}
   const disabled=await base.from('ritnome_enrollment').update({enabled:false}).eq('livemode',false).eq('owner_id',uid);
   if(disabled.error)throw Error('Sandbox enrollment fixture disable failed');
  }
 }
}
module.exports={verifyEnrollment};

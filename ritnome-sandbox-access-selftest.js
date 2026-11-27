'use strict';
// One-shot integration test using an ephemeral, synthetic Supabase Auth user.
// No token, password, email, user ID or raw provider error is printed.
const {randomUUID,randomBytes}=require('node:crypto');
const fixture={paid:'30000000-0000-4000-8000-000000000001',recovered:'30000000-0000-4000-8000-000000000004',refund:'30000000-0000-4000-8000-000000000003',dispute:'30000000-0000-4000-8000-000000000005'};
async function verifyAccess({base,signInClient,port}){
 let userId,stage='create fixture',checks=0;
 const check=(ok,name)=>{stage=name;if(!ok)throw Error('Sandbox access self-test failed: '+stage);checks++;};
 const request=async(token,expected)=>{
 for(const endpoint of ['access-check','activity-desk']){
  const res=await fetch('http://127.0.0.1:'+port+'/ritnome/sandbox/'+endpoint,{headers:token?{Authorization:'Bearer '+token}:{}});
  const data=await res.json();
  check((Array.isArray(expected)?expected.includes(res.status):res.status===expected)&&data.allowed===(res.status===200)&&res.headers.get('cache-control')==='no-store','HTTP access '+String(expected));
 if(endpoint==='activity-desk')check(res.status===200?Array.isArray(data.plans)&&data.plans.length>0:!('plans' in data),'protected activity content');
 }
 };
 try{
  const email='ritnome-fixture-'+randomUUID()+'@example.invalid',password='Aa1!'+randomBytes(32).toString('hex');
  const created=await base.auth.admin.createUser({email,password,email_confirm:true});
  check(!created.error&&Boolean(created.data?.user?.id),'create fixture');userId=created.data.user.id;
  stage='sign in fixture';const signed=await signInClient.auth.signInWithPassword({email,password});
  check(!signed.error&&Boolean(signed.data?.session?.access_token),'sign in fixture');
  const token=signed.data.session.access_token;
  await request(null,401);await request('invalid.token.signature',401);await request(token,403);
  const inserted=await base.from('ritnome_institution_memberships').insert({livemode:false,user_id:userId,facility_id:fixture.paid,active:true});
  check(!inserted.error,'insert membership');await request(token,200);
  const update=async(values)=>{const r=await base.from('ritnome_institution_memberships').update(values).eq('livemode',false).eq('user_id',userId);check(!r.error,'update membership');};
  await update({active:false});await request(token,403);
  await update({active:true,facility_id:fixture.refund});await request(token,403);
  await update({facility_id:fixture.dispute});await request(token,403);
  await update({facility_id:fixture.recovered});await request(token,200);
  stage='revoke session';const revoked=await signInClient.auth.signOut({scope:'global'});check(!revoked.error,'revoke session');
  await request(token,[401,403]);
  return checks;
 }catch(_){throw Error('Sandbox access self-test failed: '+stage);}
 finally{
  if(userId){const deleted=await base.auth.admin.deleteUser(userId);if(deleted.error)throw Error('Sandbox access fixture cleanup failed');}
 }
}
module.exports={verifyAccess};

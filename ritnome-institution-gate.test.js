'use strict';
const assert=require('node:assert/strict');
const {createInstitutionGate}=require('./ritnome-institution-gate');
async function run(){
 const uid='10000000-0000-4000-8000-000000000001',fid='30000000-0000-4000-8000-000000000001',lid='20000000-0000-4000-8000-000000000001',other='30000000-0000-4000-8000-000000000002',header='Bearer fixture.token.signature';
 function fixture(){
  const f={user:{id:uid,role:'authenticated',is_anonymous:false,user_metadata:{facility_id:other}},m:{livemode:true,user_id:uid,facility_id:fid,active:true},b:{livemode:true,facility_id:fid,stripe_price_id:'price_fixture',license_id:lid,billing_status:'active',paid_through:'2027-01-27T13:51:38Z'},l:{id:lid,product:'ritnome_institutional',active:true,expires_at:null},calls:[],authCalls:0};
  const tables={ritnome_institution_memberships:'m',ritnome_subscription_registry:'b',licenses:'l'};
  const base={from(table){const filters={};return {select(){return this},eq(k,v){filters[k]=v;return this},async maybeSingle(){f.calls.push({table,filters});return {data:f[tables[table]],error:f.dbError===table?{message:'fixture error'}:null}}}}};
  f.gate=createInstitutionGate({auth:{async getUser(token){f.authCalls++;assert.equal(token,'fixture.token.signature');if(f.authThrows)throw Error('unavailable');return {data:{user:f.user},error:f.authError}}},base,priceId:'price_fixture',clock:()=>Date.parse('2027-01-01T00:00:00Z')});
  f.request=async(h=header)=>{const result={};const res={set(k,v){result[k]=v;return this},status(n){result.status=n;return this},json(body){result.body=body;return this}};await f.gate.handler({headers:{authorization:h},body:{facility_id:other},query:{facility_id:other}},res);assert.equal(result['Cache-Control'],'no-store');assert.equal(Object.keys(result.body).join(','),'allowed');return result};
  return f;
 }
 const cases=[
 ['valid staff',()=>{},200],
 ['unknown user',f=>f.user=null,401],
 ['anonymous user',f=>f.user.is_anonymous=true,401],
 ['wrong user role',f=>f.user.role='service_role',401],
 ['invalid user ID',f=>f.user.id='invalid',401],
 ['invalid token',f=>f.authError={status:401},401],
 ['auth outage',f=>f.authError={status:503},503],
 ['auth exception',f=>f.authThrows=true,503],
 ['no membership',f=>f.m=null,403],
 ['inactive membership',f=>f.m.active=false,403],
 ['sandbox membership',f=>f.m.livemode=false,403],
 ['different membership user',f=>f.m.user_id=other,403],
 ['no binding',f=>f.b=null,403],
 ['sandbox binding',f=>f.b.livemode=false,403],
 ['other facility binding',f=>f.b.facility_id=other,403],
 ['missing license assignment',f=>f.b.license_id=null,403],
 ['wrong price',f=>f.b.stripe_price_id='price_other',403],
 ['expired paid period',f=>f.b.paid_through='2027-01-01T00:00:00Z',403],
 ['review status',f=>f.b.billing_status='review',403],
 ['paid canceled subscription',f=>f.b.billing_status='canceled',200],
 ['paid past-due subscription',f=>f.b.billing_status='past_due',200],
 ['no license',f=>f.l=null,403],
 ['wrong license',f=>f.l.id=other,403],
 ['unrelated product',f=>f.l.product='hooporia',403],
 ['disabled license',f=>f.l.active=false,403],
 ['manual expiration',f=>f.l.expires_at='2026-12-31',403],
 ['membership database failure',f=>f.dbError='ritnome_institution_memberships',503],
 ['registry database failure',f=>f.dbError='ritnome_subscription_registry',503],
 ['license database failure',f=>f.dbError='licenses',503]
 ];
 for(const [name,change,status] of cases){const f=fixture();change(f);const r=await f.request();assert.equal(r.status,status,name);assert.equal(r.body.allowed,status===200,name);}
 const f=fixture();await f.request();assert.equal(f.calls[0].filters.user_id,uid);assert.equal(f.calls[0].filters.livemode,true);assert.equal(f.calls[1].filters.facility_id,fid);assert.equal(f.calls[1].filters.livemode,true);assert.equal(f.calls[2].filters.id,lid);
 for(const h of ['', 'Basic abc','Bearer invalid','Bearer '+ 'a'.repeat(8192)]){const f=fixture();assert.equal((await f.request(h)).status,401);assert.equal(f.authCalls,0);assert.equal(f.calls.length,0);}
 console.log('33 gate scenarios and server-derived identity checks passed');
}
run().catch(e=>{console.error(e);process.exitCode=1;});

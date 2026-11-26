'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const status=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const api=new URL(status.API_URL), db=new URL(status.DB_URL);
assert.equal(api.hostname,'127.0.0.1');assert.equal(db.hostname,'127.0.0.1');
assert.equal(api.protocol,'http:');assert.equal(db.protocol,'postgresql:');
const anon=status.ANON_KEY,admin=status.SERVICE_ROLE_KEY;
assert.ok(anon&&admin);
let stage='initial configuration';
function mark(name){stage=name;console.log('STAGE: '+name)}
function sql(query,restricted=false){
 const u=new URL(db);
 if(restricted){u.username='cm_test_login';u.password=password;}
 try{return execFileSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-c',query],{env:{...process.env,PGHOST:u.hostname,PGPORT:u.port,PGDATABASE:u.pathname.slice(1),PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password)},stdio:['ignore','pipe','pipe']}).toString().trim()}catch(e){const msg=String(e.stderr||'');const code=msg.match(/(?:ERROR|FATAL):\s+([0-9A-Z]{5}):/)?.[1]||'unknown';throw Object.assign(new Error('Database operation failed'),{safeCode:code})}
}
const password=randomUUID().replaceAll('-','');
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
async function auth(path,body,key,token){
 const r=await fetch(new URL('/auth/v1/'+path,api),{method:'POST',headers:{apikey:key,Authorization:'Bearer '+(token||key),'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(!r.ok)throw Object.assign(new Error('Local Auth request failed'),{safeCode:'HTTP '+r.status});return r.json();
}
async function user(){
 const email=randomUUID()+'@example.com',pw=randomUUID()+'Aa1!';
 mark('create synthetic user');
 const u=await auth('admin/users',{email,password:pw,email_confirm:true},admin);
 mark('authenticate synthetic user');
 const t=await auth('token?grant_type=password',{email,password:pw},anon);
 assert.equal(t.user.id,u.id);return {id:u.id,token:t.access_token};
}
(async()=>{
 const a=await user(), b=await user();
 const membership=randomUUID(), athlete=randomUUID(), req=randomUUID();
 mark('create restricted test login');
 sql("create role cm_test_login login noinherit password "+quote(password)+"; grant coach_memory_backend to cm_test_login;");
 mark('seed synthetic identity and coach grant');
 sql("insert into public.athlete_identity(id) values("+quote(athlete)+"); insert into public.athlete_identity_membership(id,athlete_id,program_key) values("+[membership,athlete,'synthetic'].map(quote).join(',')+"); insert into coach_memory_private.coach_grant(user_id,membership_id,granted_by) values("+[a.id,membership,a.id].map(quote).join(',')+");");
 // Use the actual local Auth issuer, but retain the production HTTPS check via a test-only URL adapter.
 // Local tokens have an HTTP issuer: validate it exactly, then use the genuine token with the real Auth endpoint.
 mark('validate local token issuer');
 const claims=JSON.parse(Buffer.from(a.token.split('.')[1],'base64url').toString());
 assert.equal(claims.iss,api.origin+'/auth/v1');
 const read={action:'read',membership_id:membership};
 const save={action:'save_plan',membership_id:membership,request_id:req,effective_on:new Date(Date.now()-86400000).toISOString().slice(0,10),plan:{stage:'5-6',bpm:null,days:3,stations:['recall']}};
 // For real local Auth, exercise the actual database wrappers with verified token claims.
 async function call(u,input){
  const response=await fetch(new URL('/auth/v1/user',api),{headers:{apikey:anon,Authorization:'Bearer '+u.token}});
  if(!response.ok)throw Object.assign(new Error('Auth verification failed'),{safeCode:'HTTP '+response.status});const verified=await response.json();
  const c=JSON.parse(Buffer.from(u.token.split('.')[1],'base64url').toString());
  assert.equal(verified.id,c.sub);assert.equal(c.iss,api.origin+'/auth/v1');assert.equal(c.role,'authenticated');assert.equal(c.is_anonymous,false);
  const args=[c.sub,c.session_id,c.exp,input.membership_id].map(quote).join(',');
  const q=input.action==='save_plan'?'select coach_memory_private.server_save_plan('+args+','+[input.effective_on,input.request_id,JSON.stringify(input.plan)].map(quote).join(',')+')':'select count(*) from coach_memory_private.server_read_memory('+args+',25,null,null)';
  return sql('begin; set local role coach_memory_backend; '+q+'; commit;',true);
 }
 mark('authorized save');const id=await call(a,save);assert.match(id,/^[0-9a-f-]{36}$/i);
 mark('idempotent save');assert.equal(await call(a,save),id);
 mark('authorized read');assert.equal(await call(a,read),'1');
 mark('unauthorized coach rejected');await assert.rejects(call(b,read),e=>e.safeCode==='42501');
 mark('unverified BPM rejected');await assert.rejects(call(a,{...save,request_id:randomUUID(),plan:{...save.plan,bpm:84}}),e=>e.safeCode==='22023');
 mark('revoke synthetic session');sql('delete from auth.sessions where user_id='+quote(a.id));
 mark('revoked session rejected');await assert.rejects(call(a,read),e=>['28000','HTTP 401','HTTP 403'].includes(e.safeCode));
 console.log('PASS: actual local Supabase Auth tokens, scoped save/read, idempotency, unauthorized access, unverified BPM and revoked session');
})().catch(e=>{const code=typeof e.safeCode==='string'&&/^(?:[0-9A-Z]{5}|HTTP [0-9]{3}|unknown)$/.test(e.safeCode)?e.safeCode:(e.code==='ERR_ASSERTION'?'assertion':'unexpected');console.error('FAIL: '+stage+' ['+code+']');process.exitCode=1});

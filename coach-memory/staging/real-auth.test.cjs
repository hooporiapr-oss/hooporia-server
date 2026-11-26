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
 try{return execFileSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-c',query],{env:{...process.env,PGHOST:u.hostname,PGPORT:u.port,PGDATABASE:u.pathname.slice(1),PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password)},stdio:['ignore','pipe','pipe']}).toString().trim()}catch(e){const msg=String(e.stderr||'');const code=msg.match(/(?:ERROR|FATAL):\s+([0-9A-Z]{5}):/)?.[1]||'unknown';const reason=code==='42501'?(msg.match(/permission denied for (?:schema|table|function|relation|database) (?:auth|public|coach_memory_private|users|sessions|athlete_identity_membership|coach_grant|event|server_save_plan|server_read_memory|active_session|lock_memory_access|append_memory|valid_memory_payload|read_memory|postgres)\b/)?.[0]||(/permission denied to set role/.test(msg)?'role switch denied':/Access denied/.test(msg)?'coach scope denied':'permission denied (unclassified)')):undefined;throw Object.assign(new Error('Database operation failed'),{safeCode:code,safeReason:reason})}
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
  const routes={
   save_goal:['server_save_goal',[input.effective_on,input.request_id,JSON.stringify(input.goal)]],
   get_bpm_plan:['server_get_bpm_plan',[input.plan_id,input.station]],
   save_plan:['server_save_plan',[input.effective_on,input.request_id,JSON.stringify(input.plan)]],
   submit_bpm:['server_submit_bpm',[input.request_id,input.bpm,input.measured_at]],
   confirm_bpm:['server_confirm_bpm',[input.measurement_id,input.request_id]],
   save_bpm_plan:['server_save_bpm_plan',[input.confirmation_id,input.effective_on,input.request_id,JSON.stringify(input.plan)]]
  };
  const route=routes[input.action];
  if(!route&&input.action!=='read')throw Error('Unknown test action');
  const q=route?'select coach_memory_private.'+route[0]+'('+args+','+route[1].map(quote).join(',')+')':'select count(*) from coach_memory_private.server_read_memory('+args+',25,null,null)';
  return sql('begin; set local role coach_memory_backend; '+q+'; commit;',true);
 }
 // Check named capabilities separately before exercising the wrappers.
 mark('restricted login role switch');
 assert.equal(sql("begin; set local role coach_memory_backend; select current_user; commit;",true),'coach_memory_backend');
 mark('restricted wrapper execution privileges');
 assert.equal(sql("begin; set local role coach_memory_backend; select has_schema_privilege(current_user,'coach_memory_private','USAGE') and has_function_privilege(current_user,'coach_memory_private.server_save_plan(uuid,uuid,bigint,uuid,date,uuid,jsonb)','EXECUTE'); commit;",true),'t');
 mark('executor auth schema usage');
 assert.equal(sql("select has_schema_privilege('coach_memory_executor','auth','USAGE')"),'t');
 mark('executor session column privileges');
 assert.equal(sql("select has_column_privilege('coach_memory_executor','auth.users','id','SELECT') and has_column_privilege('coach_memory_executor','auth.users','is_anonymous','SELECT') and has_column_privilege('coach_memory_executor','auth.sessions','id','SELECT') and has_column_privilege('coach_memory_executor','auth.sessions','user_id','SELECT') and has_column_privilege('coach_memory_executor','auth.sessions','not_after','SELECT')"),'t');
 mark('authorized save');const id=await call(a,save);assert.match(id,/^[0-9a-f-]{36}$/i);
 mark('idempotent save');assert.equal(await call(a,save),id);
 mark('authorized read');assert.equal(await call(a,read),'1');
 mark('unauthorized coach rejected');await assert.rejects(call(b,read),e=>e.safeCode==='42501');
 mark('unverified BPM rejected');await assert.rejects(call(a,{...save,request_id:randomUUID(),plan:{...save.plan,bpm:84}}),e=>e.safeCode==='22023');
 const measurement={action:'submit_bpm',membership_id:membership,request_id:randomUUID(),bpm:84,measured_at:new Date().toISOString()};
 mark('authenticated BPM submission');const mid=await call(a,measurement);assert.match(mid,/^[0-9a-f-]{36}$/i);
 mark('idempotent BPM submission');assert.equal(await call(a,measurement),mid);
 mark('unauthorized BPM submission rejected');await assert.rejects(call(b,{...measurement,request_id:randomUUID()}),e=>e.safeCode==='42501');
 mark('BPM retry alteration rejected');await assert.rejects(call(a,{...measurement,bpm:85}),e=>e.safeCode==='22023');
 const confirmation={action:'confirm_bpm',membership_id:membership,measurement_id:mid,request_id:randomUUID()};
 mark('authenticated BPM confirmation');const cid=await call(a,confirmation);assert.match(cid,/^[0-9a-f-]{36}$/i);
 mark('idempotent BPM confirmation');assert.equal(await call(a,confirmation),cid);
 mark('unauthorized BPM confirmation rejected');await assert.rejects(call(b,{...confirmation,request_id:randomUUID()}),e=>e.safeCode==='42501');
 const today=sql("select (clock_timestamp() at time zone 'America/Puerto_Rico')::date");
 const bound={action:'save_bpm_plan',membership_id:membership,confirmation_id:cid,effective_on:today,request_id:randomUUID(),plan:{stage:'9-10',days:3,stations:['recall','ritnome']}};
 mark('authenticated confirmed BPM plan');const pid=await call(a,bound);assert.match(pid,/^[0-9a-f-]{36}$/i);
 mark('idempotent confirmed BPM plan');assert.equal(await call(a,bound),pid);
 mark('confirmed BPM stored with exact source');assert.equal(sql("select (e.payload->>'bpm')||':'||b.confirmation_id::text from coach_memory_private.event e join coach_memory_private.plan_bpm_binding b on b.event_id=e.id where e.id="+quote(pid)),'84:'+cid);
 mark('caller BPM override rejected');await assert.rejects(call(a,{...bound,request_id:randomUUID(),plan:{...bound.plan,bpm:85}}),e=>e.safeCode==='22023');
 mark('unauthorized BPM plan rejected');await assert.rejects(call(b,{...bound,request_id:randomUUID()}),e=>e.safeCode==='42501');
 mark('authorized read includes bound plan');assert.equal(await call(a,read),'2');
 const lookup={action:'get_bpm_plan',membership_id:membership,plan_id:pid,station:'ritnome'};
 mark('real authenticated exact Ritnome prescription');assert.deepEqual(JSON.parse(await call(a,lookup)),{plan_id:pid,membership_id:membership,confirmation_id:cid,bpm:84,station:'ritnome',effective_on:today,stage:'9-10'});
 mark('unassigned station rejected');await assert.rejects(call(a,{...lookup,station:'fortress'}),e=>e.safeCode==='22023');
 mark('wrong plan rejected');await assert.rejects(call(a,{...lookup,plan_id:id}),e=>e.safeCode==='22023');
 mark('unauthorized Ritnome lookup rejected');await assert.rejects(call(b,lookup),e=>e.safeCode==='42501');
 mark('wrong membership rejected');await assert.rejects(call(a,{...lookup,membership_id:randomUUID()}),e=>e.safeCode==='42501');

 const goal={action:'save_goal',membership_id:membership,request_id:randomUUID(),effective_on:today,goal:{metric:'active_days',baseline:2,target:4}};
 mark('authenticated goal save');const gid=await call(a,goal);assert.match(gid,/^[0-9a-f-]{36}$/i);
 mark('idempotent goal save');assert.equal(await call(a,goal),gid);
 mark('goal retry alteration denied');await assert.rejects(call(a,{...goal,goal:{...goal.goal,target:5}}),e=>e.safeCode==='22023');
 mark('unauthorized goal denied');await assert.rejects(call(b,{...goal,request_id:randomUUID()}),e=>e.safeCode==='42501');
 mark('invalid weekly target denied');await assert.rejects(call(a,{...goal,request_id:randomUUID(),goal:{...goal.goal,target:8}}),e=>e.safeCode==='22023');
 mark('goal retained in history');assert.equal(await call(a,read),'3');
 assert.equal(sql("select payload->>'target' from coach_memory_private.event where id="+quote(gid)),'4');

 // Cross-repository integration: actual client adapter, real local Auth and
 // restricted SQL lookup behind the actual HTTP handler. The local-only service
 // shim is needed because the production service rejects HTTP Auth issuers.
 mark('authenticated Personal BPM client integration');
 const {createAuthPersonalBpmHost}=require(require('node:path').join(process.argv[3],'auth-personal-bpm-host.cjs'));
 const {createMemoryHandler}=require('../coach-memory-http.cjs');
 const http=require('node:http');
 const handler=createMemoryHandler({enabled:true,service:{async run(authorization,input){
  if(typeof authorization!=='string'||!authorization.startsWith('Bearer '))throw Object.assign(Error('Unauthorized'),{status:401});
  if(input.action!=='get_bpm_plan')throw Object.assign(Error('Invalid action'),{status:400});
  try{return {prescription:JSON.parse(await call({token:authorization.slice(7)},input))}}
  catch(e){throw Object.assign(Error('Lookup denied'),{status:({42501:403,22023:400,28000:401,'HTTP 401':401,'HTTP 403':401})[e.safeCode]||503})}
 }}});
 const server=http.createServer(handler);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 let authCallback,requests=0;
 const localEndpoint='http://127.0.0.1:'+server.address().port+'/v1/coach-memory';
 const localAuth={
  onAuthStateChange(fn){authCallback=fn;return {data:{subscription:{unsubscribe(){authCallback=null}}}}},
  async getUser(token){
   const response=await fetch(new URL('/auth/v1/user',api),{headers:{apikey:anon,Authorization:'Bearer '+token}});
   return response.ok?{data:{user:await response.json()},error:null}:{data:{user:null},error:Error('Authentication rejected')};
  }
 };
 const adapter=createAuthPersonalBpmHost({auth:localAuth,enabled:true,endpoint:'https://example.invalid/v1/coach-memory',fetchImpl:(url,options)=>{
  assert.equal(String(url),'https://example.invalid/v1/coach-memory');
  requests++;
  return fetch(localEndpoint,{...options,headers:{...options.headers,Origin:'https://hooporia.mobi'}});
 }});
 async function signIn(account){
  const claims=JSON.parse(Buffer.from(account.token.split('.')[1],'base64url').toString());
  authCallback('SIGNED_IN',{user:{id:account.id},access_token:account.token,expires_at:claims.exp});
  const deadline=Date.now()+5000;
  while(adapter.getSession()?.userId!==account.id&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
  assert.equal(adapter.getSession()?.userId,account.id);
  adapter.host.select({membershipId:membership,planId:pid});
 }
 try{
  await signIn(a);
  assert.deepEqual((await adapter.host.client.request('get_bpm_plan',{plan_id:pid,station:'ritnome'})).prescription,{plan_id:pid,membership_id:membership,confirmation_id:cid,bpm:84,station:'ritnome',effective_on:today,stage:'9-10'});
  mark('authenticated client rejects unauthorized coach');
  await signIn(b);
  await assert.rejects(adapter.host.client.request('get_bpm_plan',{plan_id:pid,station:'ritnome'}),e=>e.code==='forbidden');
  mark('authenticated client logout blocks transport');
  authCallback('SIGNED_OUT',null);
  const before=requests;
  await assert.rejects(adapter.host.client.request('get_bpm_plan',{plan_id:pid,station:'ritnome'}));
  assert.equal(requests,before);
  await signIn(a);
  mark('authenticated client verifies revoked session');
  sql('delete from auth.sessions where user_id='+quote(a.id));
  await assert.rejects(adapter.host.client.request('get_bpm_plan',{plan_id:pid,station:'ritnome'}));
  console.log('PASS: verified Personal BPM client through real local Auth, HTTP handler and restricted prescription lookup');
 }finally{adapter.dispose();await new Promise(r=>server.close(r))}

 mark('revoke synthetic session');sql('delete from auth.sessions where user_id='+quote(a.id));
 mark('revoked session rejected');await assert.rejects(call(a,read),e=>['28000','HTTP 401','HTTP 403'].includes(e.safeCode));
 mark('revoked session goal rejected');await assert.rejects(call(a,{...goal,request_id:randomUUID()}),e=>['28000','HTTP 401','HTTP 403'].includes(e.safeCode));
 mark('revoked session BPM rejected');await assert.rejects(call(a,{...measurement,request_id:randomUUID()}),e=>['28000','HTTP 401','HTTP 403'].includes(e.safeCode));
 mark('revoked session Ritnome lookup rejected');await assert.rejects(call(a,lookup),e=>['28000','HTTP 401','HTTP 403'].includes(e.safeCode));
 console.log('PASS: exact Ritnome prescription through real local Auth and restricted database role');
 console.log('PASS: actual local Supabase Auth, scoped storage, confirmed BPM plan binding, idempotency, unauthorized access, override and revoked session rejection');
})().catch(e=>{const code=typeof e.safeCode==='string'&&/^(?:[0-9A-Z]{5}|HTTP [0-9]{3}|unknown)$/.test(e.safeCode)?e.safeCode:(e.code==='ERR_ASSERTION'?'assertion':'unexpected');console.error('FAIL: '+stage+' ['+code+']'+(e.safeReason?' '+e.safeReason:''));process.exitCode=1});

'use strict';
const assert=require('node:assert/strict');
const {createMemoryService}=require('./coach-memory-service.cjs');
const actor='10000000-0000-4000-8000-000000000001',session='10000000-0000-4000-8000-000000000002',membership='10000000-0000-4000-8000-000000000003',request='10000000-0000-4000-8000-000000000004';
const now=1700000000000,origin='https://example.invalid';
const claims={sub:actor,session_id:session,exp:now/1000+600,role:'authenticated',is_anonymous:false,iss:origin+'/auth/v1'};
const token=(patch={})=>'Bearer e30.'+Buffer.from(JSON.stringify({...claims,...patch})).toString('base64url')+'.synthetic';
let queries=[],allowed=true,http=200,anonymous=false,dbError=null;
const svc=createMemoryService({supabaseUrl:origin,publishableKey:'synthetic-only',now:()=>now,fetchImpl:async(url,opts)=>{assert.equal(String(url),origin+'/auth/v1/user');assert.equal(opts.redirect,'error');return {ok:http===200,status:http,json:async()=>({id:actor,is_anonymous:anonymous})}},withTransaction:async fn=>fn({query:async(sql,args)=>{queries.push({sql,args});if(!allowed)throw Object.assign(new Error('session denied'),{code:'28000'});assert.match(sql,/coach_memory_private\.server_(save_plan|read_memory|submit_bpm|confirm_bpm|save_bpm_plan)/);if(dbError)throw Object.assign(new Error('synthetic'),{code:dbError});return {rows:[{id:request}]}}})});
const read={action:'read',membership_id:membership};
const save={action:'save_plan',membership_id:membership,request_id:request,effective_on:'2026-11-25',plan:{stage:'5-6',bpm:null,days:3,stations:['recall']}};
async function rejects(auth,input,status){await assert.rejects(svc.run(auth,input),e=>e.status===status)}
(async()=>{assert.deepEqual(await svc.run(token(),save),{id:request});assert.equal(queries[0].args[0],actor);assert.equal(queries[0].args[3],membership);assert.deepEqual(await svc.run(token(),read),{records:[{id:request}]});
await rejects('',read,401);await rejects(token({exp:now/1000-1}),read,401);await rejects(token({sub:membership}),read,401);await rejects(token({is_anonymous:true}),read,401);await rejects(token({iss:'https://other.invalid/auth/v1'}),read,401);
anonymous=true;await rejects(token(),read,401);anonymous=false;http=401;await rejects(token(),read,401);http=200;
await rejects(token(),{...read,actor:membership},400);await rejects(token(),{...read,page_size:101},400);await rejects(token(),{...read,before_id:request},400);
allowed=false;const count=queries.length;await rejects(token(),save,401);assert.equal(queries.length,count+1);allowed=true;
dbError='42501';await rejects(token(),read,403);dbError='22023';await rejects(token(),save,400);dbError='XX000';await rejects(token(),save,503);
dbError=null;
const measurement='10000000-0000-4000-8000-000000000005',confirmation='10000000-0000-4000-8000-000000000006';
const submit={action:'submit_bpm',membership_id:membership,request_id:request,bpm:84,measured_at:'2026-11-25T12:00:00Z'};
const confirm={action:'confirm_bpm',membership_id:membership,request_id:request,measurement_id:measurement};
const bound={action:'save_bpm_plan',membership_id:membership,request_id:request,confirmation_id:confirmation,effective_on:'2026-11-25',plan:{stage:'11-12',days:3,stations:['zn','recall']}};
for(const [input,name,tail] of [[submit,'submit_bpm',[request,84,submit.measured_at]],[confirm,'confirm_bpm',[measurement,request]],[bound,'save_bpm_plan',[confirmation,bound.effective_on,request,JSON.stringify(bound.plan)]]]){
 assert.deepEqual(await svc.run(token(),input),{id:request});
 assert.ok(queries.at(-1).sql.includes('server_'+name+'('));
 assert.deepEqual(queries.at(-1).args,[actor,session,claims.exp,membership,...tail]);
}
const before=queries.length;
for(const input of [{...submit,bpm:0},{...submit,bpm:84.5},{...submit,measured_at:'2026-11-25'},{...submit,actor:membership},{...confirm,measurement_id:'invalid'},{...bound,confirmation_id:null},{...bound,plan:{...bound.plan,bpm:99}},{...save,plan:{...save.plan,bpm:84}}])await rejects(token(),input,400);
assert.equal(queries.length,before);
allowed=false;await rejects(token(),submit,401);allowed=true;
dbError='42501';await rejects(token(),confirm,403);dbError='22023';await rejects(token(),bound,400);dbError=null;
console.log('PASS: personal BPM operation routing, authenticated parameter binding, invalid input and override rejection');
console.log('PASS: mocked authentication, session denial, actor binding, input validation, SQL error mapping');
})().catch(e=>{console.error(e);process.exitCode=1});

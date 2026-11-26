// Real handler + real restricted pool + real SQL on a disposable PostgreSQL, fake Auth on loopback.
// Usage: COACH_MEMORY_TEST_DATABASE_URL=postgres://... node coach-memory/local-integration.test.cjs
'use strict';
const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');const {execFileSync}=require('node:child_process');
const {start}=require('./local-harness.cjs');
const DB=process.env.COACH_MEMORY_TEST_DATABASE_URL;if(!DB){console.log('SKIP: set COACH_MEMORY_TEST_DATABASE_URL');process.exit(0)}
const psql=q=>execFileSync('psql',[process.env.COACH_MEMORY_TEST_ADMIN_URL||DB.replace(/\/\/[^@]*@/,'//postgres@'),'-X','-qAt','-v','ON_ERROR_STOP=1','-c',q],{env:process.env}).toString().trim();
const asAdmin=(uid,q)=>psql(`begin; set local role authenticated; set local request.jwt.claim.sub='${uid}'; ${q}; commit;`);
let pass=0,fail=0;const ok=(n,v)=>{v?pass++:fail++;console.log((v?'✔ ':'✘ ')+n)};
(async()=>{const h=await start({databaseUrl:DB,sql:async q=>psql(q)});
 try{
  const admin=randomUUID();psql(`insert into auth.users(id,email) values('${admin}','admin-${admin.slice(0,8)}@example.test'); insert into public.admins values('${admin}');`);
  const A='coach-a-'+randomUUID().slice(0,8)+'@example.test',B='coach-b-'+randomUUID().slice(0,8)+'@example.test';
  await h.register(A,'pw-A-1234');await h.register(B,'pw-B-1234');
  asAdmin(admin,`select public.cm_admin_bootstrap('Local Program')`);
  const m1=asAdmin(admin,`select public.cm_admin_enroll('Local Program','Team 8 · #23')`),m2=asAdmin(admin,`select public.cm_admin_enroll('Local Program','Team 8 · #7')`);
  asAdmin(admin,`select public.cm_admin_grant_coach('${m1}','${A}')`);asAdmin(admin,`select public.cm_admin_grant_coach('${m2}','${B}')`);
  const sa=await h.signIn(A,'pw-A-1234'),sb=await h.signIn(B,'pw-B-1234');
  const call=async(token,body,origin='https://hooporia.mobi')=>{const r=await fetch(h.apiUrl+'/v1/coach-memory',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)}};
  let r=await call(sa.access_token,{action:'list_enrollments'});
  ok('A lists exactly her enrollment with its label',r.status===200&&r.body.enrollments.length===1&&r.body.enrollments[0].membership_id===m1&&r.body.enrollments[0].label==='Team 8 · #23');
  r=await call(sb.access_token,{action:'list_enrollments'});ok('B lists only his',r.status===200&&r.body.enrollments.length===1&&r.body.enrollments[0].membership_id===m2);
  const req1=randomUUID();r=await call(sa.access_token,{action:'save_plan',membership_id:m1,request_id:req1,effective_on:'2026-11-26',plan:{stage:'7-8',days:3,stations:['recall','fortress'],bpm:null}});
  ok('A saves a plan',r.status===200&&typeof r.body.id==='string');const planId=r.body?.id;
  r=await call(sa.access_token,{action:'save_plan',membership_id:m1,request_id:req1,effective_on:'2026-11-26',plan:{stage:'7-8',days:3,stations:['recall','fortress'],bpm:null}});
  ok('Same request again → same id (no duplicate)',r.status===200&&r.body.id===planId);
  r=await call(sa.access_token,{action:'save_plan',membership_id:m1,request_id:req1,effective_on:'2026-11-26',plan:{stage:'7-8',days:4,stations:['recall'],bpm:null}});
  ok('Same request id with a different plan → rejected',r.status===400);
  r=await call(sa.access_token,{action:'save_goal',membership_id:m1,request_id:randomUUID(),effective_on:'2026-11-26',goal:{metric:'recall',baseline:3,target:5}});ok('A saves a goal',r.status===200);
  r=await call(sa.access_token,{action:'read',membership_id:m1});ok('A reads 2 records, newest first',r.status===200&&r.body.records.length===2&&r.body.records[0].kind==='goal'&&r.body.records[1].kind==='training_plan');
  r=await call(sb.access_token,{action:'read',membership_id:m1});ok('B cannot read A\'s athlete (403)',r.status===403);
  r=await call(sb.access_token,{action:'save_plan',membership_id:m1,request_id:randomUUID(),effective_on:'2026-11-26',plan:{stage:'7-8',days:3,stations:['recall'],bpm:null}});ok('B cannot write to A\'s athlete (403)',r.status===403);
  r=await call(null,{action:'read',membership_id:m1});ok('No token → 401',r.status===401);
  r=await call(sa.access_token,{action:'read',membership_id:m1},'https://evil.example');ok('Wrong origin → 403',r.status===403);
  r=await call(sa.access_token,{action:'save_plan',membership_id:m1,request_id:randomUUID(),effective_on:'2026-11-26',plan:{stage:'7-8',days:3,stations:['recall'],bpm:120}});ok('Plan with an unverified BPM → rejected',r.status===400);
  asAdmin(admin,`select public.cm_admin_revoke_coach('${m1}','${A}')`);
  r=await call(sa.access_token,{action:'read',membership_id:m1});ok('Revoked grant → 403 immediately',r.status===403);
  r=await call(sa.access_token,{action:'list_enrollments'});ok('Revoked grant → enrollment gone from the list',r.status===200&&r.body.enrollments.length===0);
  asAdmin(admin,`select public.cm_admin_end_membership('${m2}')`);
  r=await call(sb.access_token,{action:'read',membership_id:m2});ok('Ended membership → 403',r.status===403);
  h.revoke(sb.access_token);r=await call(sb.access_token,{action:'list_enrollments'});ok('Signed-out token → 401',r.status===401);
  ok('History is still on file after revoke/end (nothing deleted)',psql(`select count(*) from coach_memory_private.event where membership_id='${m1}'`)==='2');
 }finally{await h.stop()}
 console.log('PASS',pass,'FAIL',fail);process.exit(fail?1:0)})().catch(e=>{console.error('CRASH',e.message);process.exit(1)});

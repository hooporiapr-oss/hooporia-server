'use strict';
// Reporting service end to end against a disposable local Postgres (security-review/test/apply-local.sh <db>).
// Env: RITNOME_TEST_DATABASE_URL (superuser or owner of the local db). Never points at a hosted project.
const assert=require('node:assert/strict');
const http=require('node:http');
const crypto=require('node:crypto');
const express=require('express');
const {Client}=require('pg');
const {createReporting,mountReporting}=require('./ritnome-reporting');
const catalog=require('./ritnome-activity-catalog');
const url=process.env.RITNOME_TEST_DATABASE_URL;
if(!url){console.log('skip: RITNOME_TEST_DATABASE_URL not set');process.exit(0);}
const PRICE='price_1UgP8ZCuedlcmwMmeEZr9ev2';
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt=(sub,session)=>b64({alg:'HS256'})+'.'+b64({sub,role:'authenticated',session_id:session,exp:Math.floor(Date.now()/1000)+3600})+'.'+b64({s:1});
let pass=0;const ok=(name,cond)=>{assert.ok(cond,name);pass++;console.log('✔ '+name);};
(async()=>{
 const db=new Client({connectionString:url});await db.connect();
 const U={ownerA:'11111111-1111-1111-1111-111111111111',staffA:'22222222-2222-2222-2222-222222222222',ownerB:'33333333-3333-3333-3333-333333333333'};
 const S={ownerA:'aaaa1111-0000-0000-0000-000000000001',staffA:'aaaa2222-0000-0000-0000-000000000002',ownerB:'bbbb3333-0000-0000-0000-000000000003'};
 const P=[U.ownerA,U.staffA,U.ownerB,S.ownerA,S.staffA,S.ownerB,PRICE];
  await db.query(`INSERT INTO auth.users(id,email) VALUES ($1,'o@a'),($2,'s@a'),($3,'o@b') ON CONFLICT DO NOTHING`,[P[0],P[1],P[2]]);
  await db.query(`INSERT INTO auth.sessions(id,user_id) VALUES ($4,$1),($5,$2),($6,$3) ON CONFLICT DO NOTHING`,[P[0],P[1],P[2],P[3],P[4],P[5]]);
  await db.query(`INSERT INTO public.licenses(id,code,school_name,product) VALUES ('aaaaaaaa-0000-0000-0000-0000000000aa','LIC-A','A','ritnome_institutional'),('bbbbbbbb-0000-0000-0000-0000000000bb','LIC-B','B','ritnome_institutional') ON CONFLICT DO NOTHING`,[]);
  await db.query(`INSERT INTO public.ritnome_enrollment(livemode,owner_id,facility_id,facility_name,facility_type,approved_license_id,checkout_session_id,stripe_customer_id) VALUES
   (true,$1,'facaaaaa-0000-0000-0000-00000000000a','A','residence','aaaaaaaa-0000-0000-0000-0000000000aa','cs_live_A1','cus_A1'),(true,$2,'facbbbbb-0000-0000-0000-00000000000b','B','assisted','bbbbbbbb-0000-0000-0000-0000000000bb','cs_live_B1','cus_B1') ON CONFLICT DO NOTHING`,[P[0],P[2]]);
  await db.query(`INSERT INTO public.ritnome_subscription_registry(livemode,facility_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,license_id,billing_status,paid_through) VALUES
   (true,'facaaaaa-0000-0000-0000-00000000000a','cus_A1','sub_A1',$1,'aaaaaaaa-0000-0000-0000-0000000000aa','active',now()+interval '20 days'),(true,'facbbbbb-0000-0000-0000-00000000000b','cus_B1','sub_B1',$1,'bbbbbbbb-0000-0000-0000-0000000000bb','active',now()+interval '20 days') ON CONFLICT DO NOTHING`,[P[6]]);
  await db.query(`INSERT INTO public.ritnome_institution_memberships(livemode,user_id,facility_id,active,role) VALUES (true,$1,'facaaaaa-0000-0000-0000-00000000000a',true,'owner'),(true,$2,'facaaaaa-0000-0000-0000-00000000000a',true,'facilitator'),(true,$3,'facbbbbb-0000-0000-0000-00000000000b',true,'owner') ON CONFLICT DO NOTHING`,[P[0],P[1],P[2]]);
 // base.rpc through the real database as service_role; auth.getUser from the fixture users.
 const base={async rpc(name,params){const keys=Object.keys(params||{});const sql=`SELECT * FROM public.${name}(${keys.map((k,i)=>k+' => $'+(i+1)+(k==='p_payload'?'::jsonb':k==='p_month'?'::date':'')).join(',')})`;
  try{await db.query('BEGIN');await db.query('SET LOCAL ROLE service_role');const r=await db.query(sql,keys.map(k=>typeof params[k]==='object'&&params[k]!==null?JSON.stringify(params[k]):params[k]));await db.query('COMMIT');
   const rows=r.rows;if(rows.length===1&&r.fields.length===1&&rows[0][r.fields[0].name]!==undefined&&!name.endsWith('_check')&&!name.endsWith('_open')&&!name.endsWith('_exchange')&&!name.endsWith('_report')&&!name.endsWith('_handles')&&!name.endsWith('_purge'))return {data:rows[0][r.fields[0].name]};
   return {data:rows};}catch(e){await db.query('ROLLBACK').catch(()=>{});return {error:e};}}};
 const users=new Map([[jwt(U.ownerA,S.ownerA),U.ownerA],[jwt(U.staffA,S.staffA),U.staffA],[jwt(U.ownerB,S.ownerB),U.ownerB]]);
 const auth={async getUser(t){const id=users.get(t);return id?{data:{user:{id,role:'authenticated',is_anonymous:false}}}:{error:{status:401}};}};
 catalog.byKey.get('conga-party').available=true;
 const app=express();app.disable('x-powered-by');mountReporting(app,express,createReporting({base,auth,priceId:PRICE,livemode:true,secureCookies:false,log:{error(){}}}));
 const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 const api=async(path,{method='GET',body,headers={},cookie,origin}={})=>{const h={...headers};if(body)h['Content-Type']='application/json';if(cookie)h.Cookie=cookie;if(origin)h.Origin=origin;const r=await fetch('http://127.0.0.1:'+port+path,{method,headers:h,body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>({}));return {status:r.status,body:j,cookie:(r.headers.get('set-cookie')||'').split(';')[0],acao:r.headers.get('access-control-allow-origin')};};
 const tok=k=>'Bearer '+[...users.entries()].find(([,v])=>v===U[k])[0];
 // sessions
 let r=await api('/reporting/session',{method:'POST',headers:{Authorization:'Bearer bad'}});ok('bad bearer → 401',r.status===401);
 r=await api('/reporting/session',{method:'POST',headers:{Authorization:tok('staffA')}});ok('facilitator session opens with HttpOnly cookie',r.status===200&&r.body.role==='facilitator'&&/^ritnome_fs=[0-9a-f-]{36}$/.test(r.cookie));const cStaff=r.cookie;
 r=await api('/reporting/session',{method:'POST',headers:{Authorization:tok('ownerA')}});const cOwner=r.cookie;ok('owner session opens',r.status===200&&r.body.role==='owner');
 r=await api('/reporting/session',{method:'POST',headers:{Authorization:tok('ownerB')}});const cOwnerB=r.cookie;ok('facility B owner session opens',r.status===200);
 r=await api('/reporting/me');ok('no cookie → 401',r.status===401);
 r=await api('/reporting/me',{cookie:'ritnome_fs='+crypto.randomUUID()});ok('forged session id → 401',r.status===401);
 r=await api('/reporting/library',{cookie:cStaff});ok('library lists only verified activities',r.status===200&&r.body.activities.length===1&&r.body.activities[0].key==='conga-party');
 // launch + exchange
 r=await api('/reporting/launch',{method:'POST',cookie:cStaff,body:{activity:'recall'}});ok('unverified activity cannot be launched',r.status===404);
 r=await api('/reporting/launch',{method:'POST',cookie:cStaff,body:{activity:'conga-party'}});ok('launch returns a fragment URL on the activity host',r.status===200&&r.body.url.startsWith('https://ritnome.com/conga-party.html#rl=')&&r.body.expires_in===60);
 const code=r.body.url.split('#rl=')[1];
 r=await api('/reporting/exchange',{method:'POST',body:{code},origin:'https://evil.test'});ok('exchange from an unlisted origin refused (no CORS)',r.status===403&&!r.acao);
 r=await api('/reporting/exchange',{method:'POST',body:{code},origin:'https://hooporia.mobi'});ok('exchange from the wrong listed origin refused by the database',r.status===401&&r.body.reason==='origin');
 r=await api('/reporting/launch',{method:'POST',cookie:cStaff,body:{activity:'conga-party'}});const code2=r.body.url.split('#rl=')[1];
 r=await api('/reporting/exchange',{method:'POST',body:{code:code2},origin:'https://ritnome.com'});ok('exchange ok returns token and activity only',r.status===200&&/^[A-Za-z0-9_-]{40,48}$/.test(r.body.token)&&r.body.activity==='conga-party'&&!('facility' in r.body)&&r.acao==='https://ritnome.com');const token=r.body.token;
 r=await api('/reporting/exchange',{method:'POST',body:{code:code2},origin:'https://ritnome.com'});ok('replayed code refused',r.status===401&&r.body.reason==='used');
 // reporting
 const run=crypto.randomUUID();const rep=(seq,kind,payload,t=token,origin='https://ritnome.com')=>api('/reporting/report',{method:'POST',headers:{Authorization:'Bearer '+t},origin,body:{run,seq,kind,payload}});
 r=await rep(1,'start',{mode:'group',headcount:9,device_class:'tablet'});ok('start accepted',r.status===200&&r.body.outcome==='accepted');
 r=await rep(1,'start',{mode:'group',headcount:9});ok('retry is duplicate (200, idempotent)',r.status===200&&r.body.outcome==='duplicate'&&r.body.high_seq===1);
 r=await rep(3,'checkpoint',{participations:9});ok('gap → 409 with high-water mark',r.status===409&&r.body.high_seq===1);
 r=await rep(2,'checkpoint',{participations:9,interactions:300,resident_name:'x'});ok('unknown payload key → 409 invalid',r.status===409&&r.body.outcome==='invalid');
 r=await rep(2,'checkpoint',{participations:9,interactions:300});ok('checkpoint accepted',r.status===200);
 r=await rep(3,'checkpoint',{},'x'.repeat(43));ok('unknown token → 401',r.status===401);
 r=await rep(3,'checkpoint',{},token,'https://vreaction.com');ok('valid token from another listed origin → 401',r.status===401);
 r=await rep(3,'end',{participations:10});ok('end accepted',r.status===200);
 // views and isolation
 r=await api('/reporting/facilitator',{cookie:cStaff});ok('facilitator view shows the run',r.status===200&&r.body.today.sessions===1&&r.body.today.participations===10);
 r=await api('/reporting/facilitator',{cookie:cOwnerB});ok('facility B sees nothing of A',r.status===200&&r.body.today.sessions===0);
 r=await api('/reporting/management',{cookie:cStaff});ok('facilitator cannot open management → 403',r.status===403);
 r=await api('/reporting/management',{cookie:cOwner});ok('owner management summary',r.status===200&&r.body.summary.sessions===1&&r.body.summary.participations===10&&r.body.summary.unique_participants_tracked===false&&r.body.summary.unique_participants===null&&Array.isArray(r.body.trend));
 r=await api('/reporting/management?month=2026-13',{cookie:cOwner});ok('bad month → 400',r.status===400);
 r=await api('/reporting/plan',{method:'POST',cookie:cStaff,body:{sessions_per_week:7}});ok('facilitator cannot set plan → 403',r.status===403);
 r=await api('/reporting/plan',{method:'POST',cookie:cOwner,body:{sessions_per_week:7,handles_enabled:true}});ok('owner sets plan',r.status===200);
 r=await api('/reporting/handles',{method:'POST',cookie:cOwner});ok('owner creates a handle',r.status===200&&/^[0-9a-f-]{36}$/.test(r.body.handle_id));const handle=r.body.handle_id;
 r=await api('/reporting/handles',{method:'POST',cookie:cOwnerB});ok('opted-out facility cannot create handles → 403',r.status===403);
 r=await api('/reporting/individual?handle='+handle,{cookie:cOwnerB});ok('facility B cannot read A handle → 403',r.status===403);
 r=await api('/reporting/individual?handle='+handle,{cookie:cOwner});ok('owner reads individual progress (empty)',r.status===200&&r.body.participation.runs===0);
 // session end revokes token immediately
 r=await api('/reporting/session/end',{method:'POST',cookie:cStaff});ok('session end clears cookie',r.status===200&&r.cookie==='ritnome_fs=');
 const run2=crypto.randomUUID();r=await api('/reporting/report',{method:'POST',headers:{Authorization:'Bearer '+token},origin:'https://ritnome.com',body:{run:run2,seq:1,kind:'start',payload:{}}});ok('token of an ended session cannot report → 401',r.status===401);
 r=await api('/reporting/me',{cookie:cStaff});ok('ended session → 401',r.status===401);
 server.close();await db.query(`DELETE FROM public.ritnome_enrollment WHERE facility_id IN ('facaaaaa-0000-0000-0000-00000000000a','facbbbbb-0000-0000-0000-00000000000b')`).catch(()=>{});await db.end();
 console.log('PASS '+pass);
})().catch(e=>{console.error('✘ '+e.message);process.exit(1);});

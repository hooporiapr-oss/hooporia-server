'use strict';
// Phase 4 gate: every onboarded activity must (a) behave as before without a launch code and make zero calls to the
// institutional service, (b) in institutional mode start a run, never touch the shared athlete database or any other host,
// report a completed game, and close the run. Env: RITNOME_TEST_DATABASE_URL, RITNOME_BPM_DIR, RITNOME_RV_DIR, RITNOME_MOBI_DIR.
const assert=require('node:assert/strict');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const express=require('express');const {Client}=require('pg');const {chromium,devices}=require('playwright');
const {createReporting,mountReporting}=require('./ritnome-reporting');const catalog=require('./ritnome-activity-catalog');
const url=process.env.RITNOME_TEST_DATABASE_URL;
const dirs={'https://ritnome.com':process.env.RITNOME_BPM_DIR,'https://vreaction.com':process.env.RITNOME_RV_DIR,'https://hooporia.mobi':process.env.RITNOME_MOBI_DIR};
if(!url){console.log('skip: RITNOME_TEST_DATABASE_URL not set');process.exit(0);}
const PRICE='price_1UgP8ZCuedlcmwMmeEZr9ev2';
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt=(sub,session)=>b64({alg:'HS256'})+'.'+b64({sub,role:'authenticated',session_id:session,exp:Math.floor(Date.now()/1000)+3600})+'.'+b64({s:1});
let pass=0;const ok=(n,c)=>{assert.ok(c,n);pass++;console.log('✔ '+n);};
// Per-activity script: how to reach "one game finished" from a fresh page, plus what must be true in institutional mode.
const GATE={
 'reaction-speed':{athleteMode:async p=>{await p.goto('https://vreaction.com/vr-reaction-speed.html');},
  inst:async p=>({nameHidden:await p.isHidden('#playerNameInputMain'),preset:await p.evaluate(()=>document.documentElement.classList.contains('comfort')),hub:await p.evaluate(()=>[...document.querySelectorAll('a')].some(a=>/institutional\.ritnome\.com\/desk/.test(a.href)))}),
  finishGame:async p=>{await p.evaluate(()=>{document.getElementById('endBpm').textContent='72';document.getElementById('end').hidden=false;});}},
 'swipe-it':{athleteMode:async p=>{await p.goto('https://vreaction.com/vr-swipe-it.html');},
  inst:async p=>({nameHidden:await p.isHidden('#playerNameInputMain'),preset:await p.evaluate(()=>!document.getElementById('startBtn').disabled&&document.getElementById('bpmInput').value==='60'),hub:await p.evaluate(()=>[...document.querySelectorAll('a')].some(a=>/institutional\.ritnome\.com\/desk/.test(a.href)))}),
  finishGame:async p=>{await p.evaluate(()=>{document.getElementById('endHits').textContent='66';document.getElementById('end').hidden=false;});}}
};
const only=(process.env.RITNOME_ACTIVITIES||Object.keys(GATE).join(',')).split(',');
(async()=>{
 const db=new Client({connectionString:url});await db.connect();
 const U='22222222-2222-2222-2222-222222222222',S='aaaa2222-0000-0000-0000-000000000002',O='11111111-1111-1111-1111-111111111111',SO='aaaa1111-0000-0000-0000-000000000001';
 for(const [q,p] of [
  [`INSERT INTO auth.users(id,email) VALUES ($1,'o@a'),($2,'s@a') ON CONFLICT DO NOTHING`,[O,U]],
  [`INSERT INTO auth.sessions(id,user_id) VALUES ($1,$2),($3,$4) ON CONFLICT DO NOTHING`,[SO,O,S,U]],
  [`INSERT INTO public.licenses(id,code,school_name,product) VALUES ('aaaaaaaa-0000-0000-0000-0000000000aa','LIC-A','A','ritnome_institutional') ON CONFLICT DO NOTHING`,[]],
  [`INSERT INTO public.ritnome_enrollment(livemode,owner_id,facility_id,facility_name,facility_type,approved_license_id,checkout_session_id,stripe_customer_id) VALUES (true,$1,'facaaaaa-0000-0000-0000-00000000000a','A','residence','aaaaaaaa-0000-0000-0000-0000000000aa','cs_live_A1','cus_A1') ON CONFLICT DO NOTHING`,[O]],
  [`INSERT INTO public.ritnome_subscription_registry(livemode,facility_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,license_id,billing_status,paid_through) VALUES (true,'facaaaaa-0000-0000-0000-00000000000a','cus_A1','sub_A1',$1,'aaaaaaaa-0000-0000-0000-0000000000aa','active',now()+interval '20 days') ON CONFLICT DO NOTHING`,[PRICE]],
  [`INSERT INTO public.ritnome_institution_memberships(livemode,user_id,facility_id,active,role) VALUES (true,$1,'facaaaaa-0000-0000-0000-00000000000a',true,'owner'),(true,$2,'facaaaaa-0000-0000-0000-00000000000a',true,'facilitator') ON CONFLICT DO NOTHING`,[O,U]]])await db.query(q,p);
 const base={async rpc(name,params){const keys=Object.keys(params||{});const sql=`SELECT * FROM public.${name}(${keys.map((k,i)=>k+' => $'+(i+1)+(k==='p_payload'?'::jsonb':k==='p_month'?'::date':'')).join(',')})`;
  try{await db.query('BEGIN');await db.query('SET LOCAL ROLE service_role');const r=await db.query(sql,keys.map(k=>typeof params[k]==='object'&&params[k]!==null?JSON.stringify(params[k]):params[k]));await db.query('COMMIT');
   const rows=r.rows;if(rows.length===1&&r.fields.length===1&&!/_(check|open|exchange|report|handles|purge|list)$/.test(name))return {data:rows[0][r.fields[0].name]};return {data:rows};}catch(e){await db.query('ROLLBACK').catch(()=>{});return {error:e};}}};
 const tok=jwt(U,S);const auth={async getUser(t){return t===tok?{data:{user:{id:U,role:'authenticated',is_anonymous:false}}}:{error:{status:401}};}};
 for(const k of only)catalog.byKey.get(k).available=true;
 const app=express();app.disable('x-powered-by');
 mountReporting(app,express,createReporting({base,auth,priceId:PRICE,livemode:true,secureCookies:false,log:{error(){}}}));
 const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const SERVICE='http://127.0.0.1:'+server.address().port;
 let r=await fetch(SERVICE+'/reporting/session',{method:'POST',headers:{Authorization:'Bearer '+tok}});const cookie=(r.headers.get('set-cookie')||'').split(';')[0];assert.equal(r.status,200);
 const launch=async a=>{const x=await fetch(SERVICE+'/reporting/launch',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({activity:a})});return (await x.json()).url;};
 const browser=await chromium.launch();const errs=[];
 for(const key of only){
  const act=catalog.byKey.get(key),site=dirs[act.origin];if(!site){console.log('skip '+key+': no checkout dir for '+act.origin);continue;}
  const g=GATE[key];assert.ok(g,'gate script for '+key);
  const ctx=await browser.newContext({...devices['iPad (gen 7)'],deviceScaleFactor:1});const calls={inst:0,other:[]};
  await ctx.route(/^https?:\/\//,async rt=>{const u=new URL(rt.request().url());
   if(dirs[u.origin]){const f=path.join(dirs[u.origin],u.pathname.slice(1)||'index.html');return fs.existsSync(f)?rt.fulfill({path:f}):rt.fulfill({status:404,body:''});}
   if(u.origin==='https://institutional.ritnome.com'){if(u.pathname==='/ritnome-institutional.js')return rt.fulfill({path:path.join(__dirname,'ritnome-institutional.js'),contentType:'application/javascript'});
    calls.inst++;const resp=await rt.fetch({url:SERVICE+u.pathname+u.search});return rt.fulfill({response:resp});}
   calls.other.push(u.href);return rt.abort();});
  // athlete mode untouched: the page must not call the institutional service at all (it may try its own hosts, which are blocked here)
  let p=await ctx.newPage();p.on('pageerror',e=>errs.push(key+': '+e.message));await g.athleteMode(p);await p.waitForTimeout(800);
  ok(key+': no launch code → zero calls to the institutional service',calls.inst===0);
  await p.close();calls.other.length=0;
  // institutional launch
  const code=(await launch(key)).split('#rl=')[1];p=await ctx.newPage();p.on('pageerror',e=>errs.push(key+': '+e.message));
  await p.goto(act.origin+act.path+'#rl='+code);await p.waitForTimeout(1500);
  ok(key+': code stripped, headcount prompt shown before play',await p.evaluate(()=>location.hash===''&&!!document.querySelector('.ri-overlay .ri-num')));
  await p.click('.ri-overlay .ri-go');await p.waitForTimeout(900);
  const st=await g.inst(p);
  ok(key+': run started in individual mode (banner shown)',await p.evaluate(()=>window.RitnomeInstitutional.mode==='active'&&!!document.querySelector('.ri-banner')));
  ok(key+': no player name asked, senior preset applied, exits go to the desk',st.nameHidden&&st.preset&&st.hub);
  await g.finishGame(p);await p.waitForTimeout(900);
  let row=(await db.query(`SELECT r.mode,r.status,(SELECT max((e.payload->>'games_completed')::int) FROM public.ritnome_activity_event e WHERE e.run_id=r.run_id) AS games FROM public.ritnome_activity_run r WHERE r.activity_key=$1 ORDER BY r.started_at DESC LIMIT 1`,[key])).rows[0];
  ok(key+': completed game reported (games_completed 1, mode individual)',row&&row.mode==='individual'&&row.games===1&&row.status==='open');
  await p.click('.ri-banner button');await p.waitForTimeout(900);
  row=(await db.query(`SELECT status FROM public.ritnome_activity_run WHERE activity_key=$1 ORDER BY started_at DESC LIMIT 1`,[key])).rows[0];
  ok(key+': finish closes the run',row.status==='closed');
  ok(key+': no request to the athlete database or any other host while institutional',calls.other.length===0);
  await ctx.close();
 }
 ok('no page errors',errs.length===0);
 await browser.close();server.close();await db.end();console.log('PASS '+pass);
})().catch(e=>{console.error('✘ '+e.message);process.exit(1);});

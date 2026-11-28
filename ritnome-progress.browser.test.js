'use strict';
// Phase 5: participant handles at the station → Individual Progress on the desk.
// Env: RITNOME_TEST_DATABASE_URL, RITNOME_RV_DIR (reaction-velocity checkout). Playwright required.
const assert=require('node:assert/strict');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const express=require('express');const {Client}=require('pg');const {chromium,devices}=require('playwright');
const {createReporting,mountReporting}=require('./ritnome-reporting');const catalog=require('./ritnome-activity-catalog');
const url=process.env.RITNOME_TEST_DATABASE_URL,rv=process.env.RITNOME_RV_DIR;
if(!url||!rv){console.log('skip: RITNOME_TEST_DATABASE_URL / RITNOME_RV_DIR not set');process.exit(0);}
const PRICE='price_1UgP8ZCuedlcmwMmeEZr9ev2';
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt=(sub,session)=>b64({alg:'HS256'})+'.'+b64({sub,role:'authenticated',session_id:session,exp:Math.floor(Date.now()/1000)+3600})+'.'+b64({s:1});
let pass=0;const ok=(n,c)=>{assert.ok(c,n);pass++;console.log('✔ '+n);};
(async()=>{
 const db=new Client({connectionString:url});await db.connect();
 const O='11111111-1111-1111-1111-111111111111',SO='aaaa1111-0000-0000-0000-000000000001';
 for(const [q,p] of [
  [`INSERT INTO auth.users(id,email) VALUES ($1,'owner@a') ON CONFLICT DO NOTHING`,[O]],
  [`INSERT INTO auth.sessions(id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,[SO,O]],
  [`INSERT INTO public.licenses(id,code,school_name,product) VALUES ('aaaaaaaa-0000-0000-0000-0000000000aa','LIC-A','A','ritnome_institutional') ON CONFLICT DO NOTHING`,[]],
  [`INSERT INTO public.ritnome_enrollment(livemode,owner_id,facility_id,facility_name,facility_type,approved_license_id,checkout_session_id,stripe_customer_id) VALUES (true,$1,'facaaaaa-0000-0000-0000-00000000000a','A','residence','aaaaaaaa-0000-0000-0000-0000000000aa','cs_live_A1','cus_A1') ON CONFLICT DO NOTHING`,[O]],
  [`INSERT INTO public.ritnome_subscription_registry(livemode,facility_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,license_id,billing_status,paid_through) VALUES (true,'facaaaaa-0000-0000-0000-00000000000a','cus_A1','sub_A1',$1,'aaaaaaaa-0000-0000-0000-0000000000aa','active',now()+interval '20 days') ON CONFLICT DO NOTHING`,[PRICE]],
  [`INSERT INTO public.ritnome_institution_memberships(livemode,user_id,facility_id,active,role) VALUES (true,$1,'facaaaaa-0000-0000-0000-00000000000a',true,'owner') ON CONFLICT DO NOTHING`,[O]]])await db.query(q,p);
 const base={async rpc(name,params){const keys=Object.keys(params||{});const sql=`SELECT * FROM public.${name}(${keys.map((k,i)=>k+' => $'+(i+1)+(k==='p_payload'?'::jsonb':k==='p_month'?'::date':'')).join(',')})`;
  try{await db.query('BEGIN');await db.query('SET LOCAL ROLE service_role');const r=await db.query(sql,keys.map(k=>typeof params[k]==='object'&&params[k]!==null?JSON.stringify(params[k]):params[k]));await db.query('COMMIT');
   const rows=r.rows;if(rows.length===1&&r.fields.length===1&&!/_(check|open|exchange|report|handles|purge|list)$/.test(name))return {data:rows[0][r.fields[0].name]};return {data:rows};}catch(e){await db.query('ROLLBACK').catch(()=>{});return {error:e};}}};
 const tok=jwt(O,SO);const tokens=new Map([[tok,{id:O}]]);
 const auth={async getUser(t){const u=tokens.get(t);return u?{data:{user:{id:u.id,role:'authenticated',is_anonymous:false}}}:{error:{status:401}};},admin:{}};
 const app=express();app.disable('x-powered-by');
 app.get('/desk',(_q,res)=>res.sendFile(path.join(__dirname,'ritnome-desk.html')));app.get('/desk.js',(_q,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'ritnome-desk.js')));
 let SERVICE='';app.get('/enroll-config',(_q,res)=>res.json({url:SERVICE+'/fakeauth',publicKey:'sb_publishable_test'}));
 app.post('/fakeauth/auth/v1/token',express.json(),(req,res)=>req.body?.email==='owner@a'&&req.body?.password==='pw'?res.json({access_token:tok}):res.status(400).json({error:'invalid_grant'}));
 mountReporting(app,express,createReporting({base,auth,priceId:PRICE,livemode:true,secureCookies:false,log:{error(){}}}));
 const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));SERVICE='http://127.0.0.1:'+server.address().port;
 // owner: session, handles on, two handles
 let r=await fetch(SERVICE+'/reporting/session',{method:'POST',headers:{Authorization:'Bearer '+tok}});const cookie=(r.headers.get('set-cookie')||'').split(';')[0];assert.equal(r.status,200);
 const call=(p,body)=>fetch(SERVICE+p,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}).then(x=>x.json());
 await call('/reporting/plan',{sessions_per_week:5,handles_enabled:true});
 await call('/reporting/handles',{});await call('/reporting/handles',{});
 const hs=(await call('/reporting/handles')).handles;ok('two handles with six-character labels',hs.length===2&&hs.every(h=>/^[0-9A-F]{6}$/.test(h.label)));
 const launch=async a=>(await call('/reporting/launch',{activity:a})).url;
 const browser=await chromium.launch();const errs=[];
 const ctx=await browser.newContext({...devices['iPad (gen 7)'],deviceScaleFactor:1});const other=[];
 await ctx.route(/^https?:\/\//,async rt=>{const u=new URL(rt.request().url());
  if(u.origin==='https://vreaction.com'){const f=path.join(rv,u.pathname.slice(1));return fs.existsSync(f)?rt.fulfill({path:f}):rt.fulfill({status:404,body:''});}
  if(u.origin==='https://institutional.ritnome.com'){if(u.pathname==='/ritnome-institutional.js')return rt.fulfill({path:path.join(__dirname,'ritnome-institutional.js'),contentType:'application/javascript'});const resp=await rt.fetch({url:SERVICE+u.pathname+u.search});return rt.fulfill({response:resp});}
  if(u.origin===SERVICE)return rt.continue();if(/^fonts\./.test(u.host))return rt.abort();other.push(u.href);return rt.abort();});
 catalog.byKey.get('reaction-speed').available=true;
 const code=(await launch('reaction-speed')).split('#rl=')[1];
 const p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));await p.goto('https://vreaction.com/vr-reaction-speed.html#rl='+code);await p.waitForTimeout(1500);
 await p.click('.ri-overlay .ri-go');await p.waitForTimeout(400);
 ok('after headcount, the station asks who is playing (two handles + "no handle")',await p.evaluate(()=>document.querySelectorAll('.ri-overlay button[data-h]').length===2&&!!document.querySelector('.ri-overlay .ri-none')));
 ok('no name, no personal data on screen: labels only',await p.evaluate(()=>[...document.querySelectorAll('.ri-overlay button[data-h]')].every(b=>/^[0-9A-F]{6}$/.test(b.textContent))));
 await p.click('.ri-overlay button[data-h] >> nth=0');await p.waitForTimeout(900);
 ok('game starts with the participant shown in the banner',await p.evaluate(()=>window.RitnomeInstitutional.mode==='active'&&!!window.RitnomeInstitutional.handle&&/Participante: [0-9A-F]{6}/.test(document.querySelector('.ri-banner').textContent)));
 // two finished games for participant 1
 for(const bpm of ['70','74']){await p.evaluate(b=>{document.getElementById('endBpm').textContent=b;document.getElementById('end').hidden=false;},bpm);await p.waitForTimeout(600);await p.evaluate(()=>{document.getElementById('end').hidden=true;});await p.waitForTimeout(200);}
 await p.waitForTimeout(800);
 let rows=(await db.query(`SELECT handle_id,setting,personal_bpm,result FROM public.ritnome_participant_progress ORDER BY recorded_at`)).rows;
 ok('two progress rows for participant 1 with BPM and setting',rows.length===2&&rows.every(x=>x.handle_id===hs[0].handle_id&&x.setting==='comfort')&&Number(rows[0].personal_bpm)===70&&Number(rows[1].personal_bpm)===74);
 // switch participant from the banner, one more game
 await p.click('.ri-banner .ri-who');await p.waitForTimeout(300);await p.click('.ri-overlay button[data-h] >> nth=1');await p.waitForTimeout(400);
 await p.evaluate(()=>{document.getElementById('endBpm').textContent='61';document.getElementById('end').hidden=false;});await p.waitForTimeout(900);
 rows=(await db.query(`SELECT handle_id FROM public.ritnome_participant_progress ORDER BY recorded_at`)).rows;
 ok('participant switched at the station: third row belongs to participant 2',rows.length===3&&rows[2].handle_id===hs[1].handle_id);
 ok('facility run still counts 3 games',(await db.query(`SELECT max((payload->>'games_completed')::int) g FROM public.ritnome_activity_event`)).rows[0].g===3);
 ok('no request to any other host',other.length===0);
 await p.close();
 // desk: Individual Progress shows the participant's runs, baseline and latest
 const d=await ctx.newPage();d.on('pageerror',e=>errs.push(e.message));await d.goto(SERVICE+'/desk');await d.fill('#email','owner@a');await d.fill('#password','pw');await d.click('#form button[type=submit]');await d.waitForTimeout(900);
 await d.click('[data-tab=progress]');await d.waitForTimeout(600);await d.click('[data-card=journey]');await d.waitForTimeout(300);
 ok('handles table shows labels and one recorded activity each (both played in the same run)',await d.evaluate(()=>{const tds=[...document.querySelectorAll('#handlesTable tr')].slice(1).map(r=>[...r.children].map(c=>c.textContent.trim()));return tds.length===2&&/^[0-9A-F]{6}$/.test(tds[0][0])&&tds[0][2]==='1'&&tds[1][2]==='1';}));
 await d.click('#handlesTable button[data-view] >> nth=0');await d.waitForTimeout(700);
 ok('Individual Progress: Reaction Speed, comfort setting, baseline 70 → latest 74',await d.evaluate(()=>{const tx=document.getElementById('individual').textContent;return /Reaction Speed/.test(tx)&&/comfort/.test(tx)&&/bpm: 70/.test(tx)&&/bpm: 74/.test(tx)&&/70 → 74/.test(tx);}));
 ok('no page errors',errs.length===0);
 await browser.close();server.close();await db.end();console.log('PASS '+pass);
})().catch(e=>{console.error('✘ '+e.message);process.exit(1);});

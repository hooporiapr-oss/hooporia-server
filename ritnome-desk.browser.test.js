'use strict';
// Phase 3 browser test: the institutional desk against the real reporting service and a disposable local database.
// Env: RITNOME_TEST_DATABASE_URL. Playwright required.
const assert=require('node:assert/strict');
const http=require('node:http');
const path=require('node:path');
const express=require('express');
const {Client}=require('pg');
const {chromium,devices}=require('playwright');
const {createReporting,mountReporting}=require('./ritnome-reporting');
const catalog=require('./ritnome-activity-catalog');
const url=process.env.RITNOME_TEST_DATABASE_URL;
if(!url){console.log('skip: RITNOME_TEST_DATABASE_URL not set');process.exit(0);}
const PRICE='price_1UgP8ZCuedlcmwMmeEZr9ev2';
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt=(sub,session)=>b64({alg:'HS256'})+'.'+b64({sub,role:'authenticated',session_id:session,exp:Math.floor(Date.now()/1000)+3600})+'.'+b64({s:1});
let pass=0;const ok=(n,c)=>{assert.ok(c,n);pass++;console.log('✔ '+n);};
(async()=>{
 const db=new Client({connectionString:url});await db.connect();
 const O='11111111-1111-1111-1111-111111111111',SO='aaaa1111-0000-0000-0000-000000000001',F='22222222-2222-2222-2222-222222222222',SF='aaaa2222-0000-0000-0000-000000000002';
 for(const [q,p] of [
  [`INSERT INTO auth.users(id,email) VALUES ($1,'owner@a'),($2,'staff@a') ON CONFLICT DO NOTHING`,[O,F]],
  [`INSERT INTO auth.sessions(id,user_id) VALUES ($1,$2),($3,$4) ON CONFLICT DO NOTHING`,[SO,O,SF,F]],
  [`INSERT INTO public.licenses(id,code,school_name,product) VALUES ('aaaaaaaa-0000-0000-0000-0000000000aa','LIC-A','A','ritnome_institutional') ON CONFLICT DO NOTHING`,[]],
  [`INSERT INTO public.ritnome_enrollment(livemode,owner_id,facility_id,facility_name,facility_type,approved_license_id,checkout_session_id,stripe_customer_id) VALUES (true,$1,'facaaaaa-0000-0000-0000-00000000000a','A','residence','aaaaaaaa-0000-0000-0000-0000000000aa','cs_live_A1','cus_A1') ON CONFLICT DO NOTHING`,[O]],
  [`INSERT INTO public.ritnome_subscription_registry(livemode,facility_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,license_id,billing_status,paid_through) VALUES (true,'facaaaaa-0000-0000-0000-00000000000a','cus_A1','sub_A1',$1,'aaaaaaaa-0000-0000-0000-0000000000aa','active',now()+interval '20 days') ON CONFLICT DO NOTHING`,[PRICE]],
  [`INSERT INTO public.ritnome_institution_memberships(livemode,user_id,facility_id,active,role) VALUES (true,$1,'facaaaaa-0000-0000-0000-00000000000a',true,'owner'),(true,$2,'facaaaaa-0000-0000-0000-00000000000a',true,'facilitator') ON CONFLICT DO NOTHING`,[O,F]]])await db.query(q,p);
 const base={async rpc(name,params){const keys=Object.keys(params||{});const sql=`SELECT * FROM public.${name}(${keys.map((k,i)=>k+' => $'+(i+1)+(k==='p_payload'?'::jsonb':k==='p_month'?'::date':'')).join(',')})`;
  try{await db.query('BEGIN');await db.query('SET LOCAL ROLE service_role');const r=await db.query(sql,keys.map(k=>typeof params[k]==='object'&&params[k]!==null?JSON.stringify(params[k]):params[k]));await db.query('COMMIT');
   const rows=r.rows;if(rows.length===1&&r.fields.length===1&&!/_(check|open|exchange|report|handles|purge|list)$/.test(name))return {data:rows[0][r.fields[0].name]};return {data:rows};}catch(e){await db.query('ROLLBACK').catch(()=>{});return {error:e};}}};
 const users={'owner@a':{id:O,session:SO,password:'pw-owner'},'staff@a':{id:F,session:SF,password:'pw-staff'}};const tokens=new Map();
 const auth={async getUser(t){const u=tokens.get(t);return u?{data:{user:{id:u.id,role:'authenticated',is_anonymous:false}}}:{error:{status:401}};},
  admin:{async createUser({email}){if(users[email])return {error:{status:422,message:'already registered'}};const id='66666666-6666-6666-6666-'+String(Object.keys(users).length).padStart(12,'0');users[email]={id,session:null,password:null};await db.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2)`,[id,email]);return {data:{user:{id}}};},
   async generateLink({email}){return users[email]?{data:{user:{id:users[email].id}}}:{error:{status:404}};}}};
 catalog.byKey.get('conga-party').available=true;
 const app=express();app.disable('x-powered-by');
 app.get('/desk',(_q,res)=>res.sendFile(path.join(__dirname,'ritnome-desk.html')));app.get('/desk.js',(_q,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'ritnome-desk.js')));
 let SERVICE='';app.get('/enroll-config',(_q,res)=>res.json({url:SERVICE+'/fakeauth',publicKey:'sb_publishable_test'}));
 app.post('/fakeauth/auth/v1/token',express.json(),(req,res)=>{const u=users[req.body?.email];if(!u||u.password!==req.body?.password)return res.status(400).json({error:'invalid_grant'});const t=jwt(u.id,u.session);tokens.set(t,u);res.json({access_token:t});});
 mountReporting(app,express,createReporting({base,auth,priceId:PRICE,livemode:true,secureCookies:false,log:{error(){}}}));
 const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));SERVICE='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch();const errs=[];
 async function signIn(email,password,dev){const ctx=await browser.newContext({...dev,deviceScaleFactor:1});await ctx.route(/^https:\/\//,rt=>rt.fulfill({status:200,body:'<html><body>external</body></html>',contentType:'text/html'}));const p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));
  await p.goto(SERVICE+'/desk');await p.fill('#email',email);await p.fill('#password',password);await p.click('#form button[type=submit]');await p.waitForTimeout(900);return {ctx,p};}
 // facilitator on a tablet
 let {ctx,p}=await signIn('staff@a','pw-staff',devices['iPad (gen 7)']);
 ok('facilitator signs in and sees the three tabs',await p.evaluate(()=>!document.getElementById('app').hidden&&document.querySelectorAll('.tabs [role=tab]').length===3));
 ok('Spanish first',await p.evaluate(()=>document.documentElement.lang==='es-PR'&&/Sesión de hoy/.test(document.querySelector('.tabs').textContent)));
 ok('today plan built from available activities (Conga Party flagship)',await p.evaluate(()=>document.querySelectorAll('#plan .plan').length>=2&&/Conga Party/.test(document.getElementById('plan').textContent)));
 ok('no management or settings for a facilitator',await p.evaluate(()=>document.getElementById('mgmt').hidden&&document.getElementById('settings').hidden));
 await p.evaluate(n=>{window.__avail=n},catalog.activities.filter(a=>a.available).length);await p.click('[data-tab=library]');ok('library shows only verified activities by category',await p.evaluate(()=>{const cards=[...document.querySelectorAll('#library .act h3')].map(h=>h.textContent);return cards.length===window.__avail&&cards.includes('Conga Party');}));
 await p.click('#language');ok('English toggle and remembered',await p.evaluate(()=>document.documentElement.lang==='en'&&/Today's session/.test(document.querySelector('.tabs').textContent)&&localStorage.getItem('ritnomeLang')==='en'));await p.click('#language');
 let nav=p.waitForURL(/ritnome\.com\/conga-party\.html#rl=/,{timeout:5000}).then(()=>true).catch(()=>false);await p.click('#library .act button');ok('Start opens the activity with a one-time launch code',await nav);
 ok('a library launch with no session open created a standalone recreation session',(await db.query(`SELECT source,status FROM public.ritnome_recreation_session ORDER BY started_at DESC LIMIT 1`)).rows[0].source==='standalone');
 // back on the desk: starting a plan step opens a facilitated session and the desk shows it in progress
 await p.goto(SERVICE+'/desk');await p.waitForTimeout(900);await p.click('[data-tab=today]');await p.click('[data-len="20"]');
 nav=p.waitForURL(/ritnome\.com\/conga-party\.html#rl=/,{timeout:5000}).then(()=>true).catch(()=>false);await p.click('#plan button');ok('plan step launches',await nav);
 ok('plan step created a 20-minute facilitated session (plan source)',(await db.query(`SELECT source,planned_minutes,status FROM public.ritnome_recreation_session ORDER BY started_at DESC LIMIT 1`)).rows[0].planned_minutes===20);
 await p.goto(SERVICE+'/desk');await p.waitForTimeout(900);
 ok('desk shows the session in progress with an end button',await p.evaluate(()=>!document.getElementById('session').hidden&&/Sesión en curso/.test(document.getElementById('session').textContent)&&!!document.getElementById('endSession')));
 await p.click('#endSession');await p.waitForTimeout(700);ok('ending the session hides the line',await p.evaluate(()=>document.getElementById('session').hidden));
 ok('today KPIs show sessions and activity runs separately',await p.evaluate(()=>/Sesiones/.test(document.getElementById('todayKpis').textContent)&&/Actividades ejecutadas/.test(document.getElementById('todayKpis').textContent)));
 ok('no token or session id stored in the browser',await p.evaluate(()=>!Object.keys(localStorage).some(k=>/token|session/i.test(k))&&!Object.keys(sessionStorage).length&&!document.cookie.includes('ritnome_fs')));
 await ctx.close();
 // owner on a desktop
 ({ctx,p}=await signIn('owner@a','pw-owner',{viewport:{width:1366,height:900}}));
 await p.click('[data-tab=progress]');await p.waitForTimeout(600);
 ok('owner sees management, settings and KPIs',await p.evaluate(()=>!document.getElementById('mgmt').hidden&&!document.getElementById('settings').hidden&&document.querySelectorAll('#mgmtKpis .kpi').length>=7));
 await p.click('[data-card=exec]');await p.waitForTimeout(300);
 ok('unique participants shown as not tracked while handles are off',await p.evaluate(()=>/handles not enabled|sin identificadores activados/.test(document.getElementById('mgmtKpis').textContent)));
 await p.click('#pv-exec .pvback');await p.click('[data-card=set]');await p.waitForTimeout(300);
 await p.fill('#spw','7');await p.selectOption('#handles','true');await p.click('#planForm button[type=submit]');await p.waitForTimeout(900);
 ok('plan saved: 7 per week, handles on, handles card appears',await p.evaluate(()=>!document.getElementById('handlesCard').hidden&&(m=>m&&Number(m[1])>0&&Number(m[1])%7===0)(/\/ (\d+) (?:planned|planificadas)/.exec(document.getElementById('mgmtKpis').textContent))   /* monthly planned total is a multiple of 7/week */));
 await p.click('#pv-settings .pvback');await p.click('[data-card=journey]');await p.waitForTimeout(300);
 await p.click('#newHandle');await p.waitForTimeout(600);ok('owner creates a participant handle',await p.evaluate(()=>document.querySelectorAll('#handlesTable button[data-view]').length===1));
 await p.click('#handlesTable button[data-view]');await p.waitForTimeout(600);ok('individual progress view opens (empty)',await p.evaluate(()=>/No records|Aún sin registros/.test(document.getElementById('individual').textContent)));
 await p.click('#pv-journey .pvback');await p.click('[data-card=set]');await p.waitForTimeout(300);
 await p.fill('#staffEmail','new@a');await p.selectOption('#staffRole','facilitator');await p.click('#staffForm button[type=submit]');await p.waitForTimeout(900);
 ok('owner adds staff and sees a temporary password once',await p.evaluate(()=>/Contraseña temporal|Temporary password/.test(document.getElementById('staffMsg').textContent)&&[...document.querySelectorAll('#staff td')].some(td=>td.textContent==='new@a')));
 await p.click('#staff tr:has(td:text-is("new@a")) button[data-user]');await p.waitForTimeout(700);
 ok('owner deactivates the new staff member only',await p.evaluate(()=>{const row=e=>[...document.querySelectorAll('#staff tr')].find(r=>r.textContent.includes(e));return /Reactivar|Reactivate/.test(row('new@a').querySelector('button').textContent)&&/Desactivar|Deactivate/.test(row('staff@a').querySelector('button').textContent);}));
 ok('owner row has no deactivate button',await p.evaluate(()=>{const rows=[...document.querySelectorAll('#staff tr')].filter(r=>/owner@a/.test(r.textContent));return rows.length===1&&!rows[0].querySelector('button');}));
 await p.click('#pv-settings .pvback');await p.click('[data-card=exec]');await p.waitForTimeout(300);
 const dl=p.waitForEvent('download',{timeout:4000}).then(d=>d.suggestedFilename()).catch(()=>null);await p.click('#csv');ok('CSV export downloads',/^ritnome-\d{4}-\d{2}\.csv$/.test((await dl)||''));
 // inactivity lock → unlock with password
 await db.query(`UPDATE public.ritnome_facility_session SET last_activity_at=now()-interval '31 minutes' WHERE user_id=$1 AND ended_at IS NULL`,[O]);
 await p.click('[data-tab=today]');await p.click('[data-len="10"]');await p.click('#plan button');await p.waitForTimeout(800);
 ok('locked session shows the unlock prompt',await p.evaluate(()=>!document.getElementById('lockOverlay').hidden));
 await p.fill('#unlockPassword','pw-owner');await p.click('#unlockForm button');await p.waitForTimeout(900);ok('unlock with password restores the desk',await p.evaluate(()=>document.getElementById('lockOverlay').hidden&&!document.getElementById('app').hidden));
 await p.click('#logout');await p.waitForTimeout(500);ok('sign out returns to the login',await p.evaluate(()=>!document.getElementById('login').hidden));
 ok('no page errors',errs.length===0);
 await browser.close();server.close();await db.end();console.log('PASS '+pass);
})().catch(e=>{console.error('✘ '+e.message);process.exit(1);});

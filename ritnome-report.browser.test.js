'use strict';
// R2: Institutional Executive Report against the real service and a disposable database (fictional fixtures).
const assert=require('node:assert/strict');
const http=require('node:http'),path=require('node:path'),fs=require('node:fs');
const express=require('express');const {Client}=require('pg');const {chromium}=require('playwright');
const {createReporting,mountReporting}=require('./ritnome-reporting');
const url=process.env.RITNOME_TEST_DATABASE_URL;if(!url){console.log('skip: RITNOME_TEST_DATABASE_URL not set');process.exit(0);}
const PRICE='price_1UgP8ZCuedlcmwMmeEZr9ev2';
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt=(sub,session)=>b64({alg:'HS256'})+'.'+b64({sub,role:'authenticated',session_id:session,exp:Math.floor(Date.now()/1000)+3600})+'.'+b64({s:1});
let pass=0;const ok=(n,c)=>{assert.ok(c,n);pass++;console.log('✔ '+n);};
(async()=>{
 const db=new Client({connectionString:url});await db.connect();
 const O='11111111-1111-1111-1111-111111111111',SO='aaaa1111-0000-0000-0000-000000000001',F='22222222-2222-2222-2222-222222222222',SF='aaaa2222-0000-0000-0000-000000000002',FAC='facaaaaa-0000-0000-0000-00000000000a';
 for(const [q,p] of [
  [`INSERT INTO auth.users(id,email) VALUES ($1,'owner@a'),($2,'staff@a') ON CONFLICT DO NOTHING`,[O,F]],
  [`INSERT INTO auth.sessions(id,user_id) VALUES ($1,$2),($3,$4) ON CONFLICT DO NOTHING`,[SO,O,SF,F]],
  [`INSERT INTO public.licenses(id,code,school_name,product) VALUES ('aaaaaaaa-0000-0000-0000-0000000000aa','LIC-A','A','ritnome_institutional') ON CONFLICT DO NOTHING`,[]],
  [`INSERT INTO public.ritnome_enrollment(livemode,owner_id,facility_id,facility_name,facility_type,approved_license_id,checkout_session_id,stripe_customer_id) VALUES (true,$1,$2,'Residencia Prueba (ficticia)','residence','aaaaaaaa-0000-0000-0000-0000000000aa','cs_live_A1','cus_A1') ON CONFLICT DO NOTHING`,[O,FAC]],
  [`INSERT INTO public.ritnome_subscription_registry(livemode,facility_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,license_id,billing_status,paid_through) VALUES (true,$2,'cus_A1','sub_A1',$1,'aaaaaaaa-0000-0000-0000-0000000000aa','active',now()+interval '20 days') ON CONFLICT DO NOTHING`,[PRICE,FAC]],
  [`INSERT INTO public.ritnome_institution_memberships(livemode,user_id,facility_id,active,role) VALUES (true,$1,$3,true,'owner'),(true,$2,$3,true,'facilitator') ON CONFLICT DO NOTHING`,[O,F,FAC]],
  [`INSERT INTO public.ritnome_facility_plan(livemode,facility_id,sessions_per_week) VALUES (true,$1,5) ON CONFLICT DO NOTHING`,[FAC]],
  [`INSERT INTO public.ritnome_facility_session(id,livemode,facility_id,user_id,auth_session,role) VALUES ('5e551099-0000-0000-0000-00000000000f',true,$1,$2,$3,'facilitator')`,[FAC,F,SF]]])await db.query(q,p);
 // fixtures: this month, 3 facilitated sessions (one with three activities), Puerto Rico times
 const pr=t=>`(('${t}'::timestamp) AT TIME ZONE 'America/Puerto_Rico')`;
 const ym=new Date().toISOString().slice(0,7);const day=n=>`${ym}-${String(n).padStart(2,'0')}`;
 const todayPR=(await db.query(`SELECT public.ritnome_pr_today() d`)).rows[0].d;const dnum=Math.max(3,Math.min(Number(String(todayPR).slice(8,10)),28));
 const mk=async(d,acts)=>{const rs=(await db.query(`INSERT INTO public.ritnome_recreation_session(livemode,facility_id,session_id,facilitator_user_id,source,planned_minutes,status,started_at,ended_at) VALUES (true,$1,'5e551099-0000-0000-0000-00000000000f',$2,'plan',20,'closed',${pr(d+' 10:00')},${pr(d+' 10:20')}) RETURNING id`,[FAC,F])).rows[0].id;
  let m=0;for(const [a,mins,head] of acts){await db.query(`INSERT INTO public.ritnome_activity_run(run_id,livemode,facility_id,session_id,facilitator_user_id,activity_key,recreation_session_id,started_at,last_event_at,ended_at,status,headcount,participations,mode) VALUES (gen_random_uuid(),true,$1,'5e551099-0000-0000-0000-00000000000f',$2,$3,$4,${pr(d+' 10:00')}+interval '${m} minutes',${pr(d+' 10:00')}+interval '${m+mins} minutes',${pr(d+' 10:00')}+interval '${m+mins} minutes','closed',$5,$5,'group')`,[FAC,F,a,rs,head]);m+=mins;}};
 await mk(day(Math.max(1,dnum-2)),[['conga-party',5,8],['la-marquesina',10,8],['recall',5,6]]);await mk(day(Math.max(1,dnum-1)),[['conga-party',10,12]]);await mk(day(dnum),[['conga-party',10,10],['the-reset',3,10]]);
 const base={async rpc(name,params){const keys=Object.keys(params||{});const sql=`SELECT * FROM public.${name}(${keys.map((k,i)=>k+' => $'+(i+1)+(k==='p_payload'?'::jsonb':/p_(month|from|to_excl)/.test(k)?'::date':'')).join(',')})`;
  try{await db.query('BEGIN');await db.query('SET LOCAL ROLE service_role');const r=await db.query(sql,keys.map(k=>typeof params[k]==='object'&&params[k]!==null?JSON.stringify(params[k]):params[k]));await db.query('COMMIT');
   const rows=r.rows;if(rows.length===1&&r.fields.length===1&&!/_(check|open|exchange|report|handles|purge|list)$/.test(name))return {data:rows[0][r.fields[0].name]};return {data:rows};}catch(e){await db.query('ROLLBACK').catch(()=>{});return {error:e};}}};
 const tokO=jwt(O,SO),tokF=jwt(F,SF);const tokens=new Map([[tokO,{id:O}],[tokF,{id:F}]]);
 const auth={async getUser(t){const u=tokens.get(t);return u?{data:{user:{id:u.id,role:'authenticated',is_anonymous:false}}}:{error:{status:401}};},admin:{}};
 const app=express();app.disable('x-powered-by');
 app.get('/report',(_q,res)=>res.sendFile(path.join(__dirname,'ritnome-report.html')));app.get('/report.js',(_q,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'ritnome-report.js')));
 app.get('/desk',(_q,res)=>res.sendFile(path.join(__dirname,'ritnome-desk.html')));app.get('/desk.js',(_q,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'ritnome-desk.js')));
 let SERVICE='';app.get('/enroll-config',(_q,res)=>res.json({url:SERVICE+'/fakeauth',publicKey:'x'}));
 app.post('/fakeauth/auth/v1/token',express.json(),(req,res)=>{const t=req.body?.email==='owner@a'?tokO:req.body?.email==='staff@a'?tokF:null;t?res.json({access_token:t}):res.status(400).json({error:'invalid_grant'});});
 mountReporting(app,express,createReporting({base,auth,priceId:PRICE,livemode:true,secureCookies:false,log:{error(){}}}));
 const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));SERVICE='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch();const errs=[];
 const ctx=await browser.newContext({viewport:{width:1100,height:1500},deviceScaleFactor:1});const p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));
 // owner signs in on the desk (cookie), then opens the report
 await p.goto(SERVICE+'/desk');await p.fill('#email','owner@a');await p.fill('#password','pw');await p.click('#form button[type=submit]');await p.waitForTimeout(900);
 await p.click('[data-tab=progress]');await p.waitForTimeout(500);
 ok('desk links to the executive report for the chosen month',await p.evaluate(()=>/\/report/.test(document.getElementById('execReport').getAttribute('href'))));
 await p.goto(SERVICE+'/report?period='+ym);await p.waitForTimeout(1200);
 const st=await p.evaluate(()=>({fac:document.getElementById('facility').textContent,kpis:document.getElementById('kpisHero').textContent+' '+document.getElementById('kpis').textContent,narr:document.getElementById('narrative').textContent,sample:document.getElementById('sampleTag').classList.contains('hidden'),mgmtNoPrint:document.getElementById('mgmt').classList.contains('noprint'),util:document.getElementById('util').textContent,weeklyBars:document.querySelectorAll('#weekly rect').length,trendPts:document.querySelectorAll('#trend circle').length,acts:document.querySelectorAll('#activities tr').length-1,lang:document.documentElement.lang}));
 ok('real facility name, Spanish first, no sample label',st.fac==='Residencia Prueba (ficticia)'&&st.lang==='es-PR'&&st.sample);
 ok('KPIs: 3 facilitated sessions, 6 activity runs, 43 minutes (20+10+13)',/^3/.test(st.kpis.trim())&&/6\s*Actividades ejecutadas/.test(st.kpis)&&/43\s*·/.test(st.kpis));
 ok('narrative reconciles with the KPIs (3 sessions, 6 activities, 43 minutes, Conga Party most conducted)',/realizó 3 sesiones facilitadas de recreación con 6 actividades ejecutadas/.test(st.narr)&&/43 minutos/.test(st.narr)&&/más realizada fue Conga Party \(3 veces\)/.test(st.narr));
 ok('no comparable previous period is stated, not invented',/No hay un período anterior comparable/.test(st.narr));
 ok('charts and table drawn',st.weeklyBars>=2&&st.trendPts===6&&st.acts>=3);
 // ---- reconciliation (independent review items)
 const ex=await p.evaluate(async y=>{const r=await fetch('/reporting/executive?period='+y,{credentials:'same-origin'});return r.json();},ym);
 const mg=await p.evaluate(async y=>{const r=await fetch('/reporting/management?month='+y,{credentials:'same-origin'});return r.json();},ym);
 const sumP=ex.activities.reduce((a,x)=>a+Number(x.participations),0),sumR=ex.activities.reduce((a,x)=>a+Number(x.runs),0);
 ok('activity-level participations and runs sum to the institutional totals (same period, same definitions)',sumP===Number(ex.summary.participations)&&sumR===Number(ex.summary.activity_runs)&&sumP===54&&sumR===6);
 const wk=ex.weekly.reduce((a,x)=>a+Number(x.planned),0);
 ok('weekly planned targets (prorated by day) add up to the period planned target',Math.abs(wk-Number(ex.summary.planned_sessions))<=0.05*ex.weekly.length+0.05&&ex.weekly.some(x=>x.partial&&Number(x.planned)<5));
 ok('average line distinguishes participations per session from recorded attendees',await p.evaluate(()=>/participaciones/.test(document.getElementById('narrative').textContent)&&/asistentes registrados \(máximo por sesión\)/.test(document.getElementById('narrative').textContent)));
 ok('attendees per session is the max headcount per session (8, 12, 10 → 10.0), not participations ÷ sessions (18.0)',Number(ex.avg_headcount)===10&&Math.round(Number(ex.summary.participations)/Number(ex.summary.sessions)*10)/10===18);
 ok('dashboard (management) and executive report share identical summary totals',['sessions','activity_runs','participations','recreation_minutes','estimated_participant_minutes','activity_variety','active_days','planned_sessions'].every(k=>String(mg.summary[k])===String(ex.summary[k])));
 const numsEs=(await p.evaluate(()=>document.getElementById('narrative').textContent)).match(/\d+(?:[.,]\d+)?/g);await p.click('#language');await p.waitForTimeout(300);const numsEn=(await p.evaluate(()=>document.getElementById('narrative').textContent)).match(/\d+(?:[.,]\d+)?/g);await p.click('#language');await p.waitForTimeout(200);
 ok('Spanish and English narratives carry the same numbers in the same order',JSON.stringify(numsEs)===JSON.stringify(numsEn));
 ok('terminology: participant-minutes and activity runs labeled as agreed',await p.evaluate(()=>/Minutos-participante estimados/.test(document.getElementById('kpis').textContent)&&/Actividades ejecutadas/.test(document.getElementById('kpis').textContent)&&/no recopila nombres de residentes ni información médica/.test(document.getElementById('scope').textContent)));
 ok('utilization block is management-only and excluded from print by default',st.mgmtNoPrint&&/\$149/.test(st.util)&&/\$49\.67/.test(st.util));
 await p.click('#withMgmt');ok('owner can choose to include utilization in print',await p.evaluate(()=>!document.getElementById('mgmt').classList.contains('noprint')));await p.click('#withMgmt');
 await p.click('#language');await p.waitForTimeout(300);
 ok('English version reconciles too',await p.evaluate(()=>/conducted 3 facilitated recreation sessions with 6 activity runs/.test(document.getElementById('narrative').textContent)&&document.documentElement.lang==='en'));
 await p.click('#language');
 const pdf=path.join(process.env.RITNOME_OUT||'/tmp','ritnome-report-test.pdf');await p.pdf({path:pdf,format:'Letter',printBackground:true,preferCSSPageSize:true});
 let pages=null;try{const buf=fs.readFileSync(pdf);pages=(buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)||[]).length;}catch{}
 ok('prints to exactly one US Letter page',pages===1);
 // CSV from the desk reconciles with the same totals
 await p.goto(SERVICE+'/desk');await p.waitForTimeout(900);await p.click('[data-tab=progress]');await p.waitForTimeout(700);
 const dl=p.waitForEvent('download',{timeout:5000});await p.click('#csv');const d=await dl;const csvPath=path.join(process.env.RITNOME_OUT||'/tmp','ritnome-mgmt-test.csv');await d.saveAs(csvPath);const csv=fs.readFileSync(csvPath,'utf8');
 const cell=k=>{const m=csv.split(/\r?\n/).find(l=>l.replace(/"/g,'').startsWith(k+','));return m?m.replace(/"/g,'').split(',')[1]:null;};
 ok('CSV export carries the same sessions, activity runs, participations and planned target as the report',Number(cell('sessions'))===Number(ex.summary.sessions)&&Number(cell('activity_runs'))===Number(ex.summary.activity_runs)&&Number(cell('participations'))===Number(ex.summary.participations)&&Number(cell('planned_sessions'))===Number(ex.summary.planned_sessions));
 // facilitator: page loads, data refused
 const ctx2=await browser.newContext({viewport:{width:1100,height:1500}});const f=await ctx2.newPage();f.on('pageerror',e=>errs.push(e.message));
 await f.goto(SERVICE+'/desk');await f.fill('#email','staff@a');await f.fill('#password','pw');await f.click('#form button[type=submit]');await f.waitForTimeout(900);
 await f.goto(SERVICE+'/report?period='+ym);await f.waitForTimeout(900);
 ok('facilitator is told the report is for the owner or a manager',await f.evaluate(()=>/propietario o gerente/.test(document.getElementById('msg').textContent)&&document.getElementById('kpisHero').textContent===''));
 // sample mode is explicitly labeled
 await p.goto(SERVICE+'/report?sample=1&period=2026-10');await p.waitForTimeout(600);
 ok('sample mode shows the SAMPLE DATA watermark and tag',await p.evaluate(()=>!document.getElementById('sampleTag').classList.contains('hidden')&&!document.getElementById('sampleMark').classList.contains('hidden')&&/ficticia/.test(document.getElementById('facility').textContent)));
 ok('no page errors',errs.length===0);
 await browser.close();server.close();await db.end();console.log('PASS '+pass);
})().catch(e=>{console.error('✘ '+e.message);process.exit(1);});

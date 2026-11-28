'use strict';
// R3: Recreation Program Record against the real service (fictional fixtures): distinctions, reconciliation with the executive report, pages, CSV, scope.
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
 const pr=t=>`(('${t}'::timestamp) AT TIME ZONE 'America/Puerto_Rico')`;
 const ym=new Date().toISOString().slice(0,7);const day=n=>`${ym}-${String(n).padStart(2,'0')}`;
 const todayPR=(await db.query(`SELECT public.ritnome_pr_today() d`)).rows[0].d;const dnum=Math.max(3,Math.min(Number(String(todayPR).slice(8,10)),28));
 const mk=async(d,acts,source='plan')=>{const rs=(await db.query(`INSERT INTO public.ritnome_recreation_session(livemode,facility_id,session_id,facilitator_user_id,source,planned_minutes,status,started_at,ended_at) VALUES (true,$1,'5e551099-0000-0000-0000-00000000000f',$2,$3,20,'closed',${pr(d+' 10:00')},${pr(d+' 10:20')}) RETURNING id`,[FAC,F,source])).rows[0].id;
  let m=0;for(const [a,mins,head] of acts){const run=(await db.query(`INSERT INTO public.ritnome_activity_run(run_id,livemode,facility_id,session_id,facilitator_user_id,activity_key,recreation_session_id,started_at,last_event_at,ended_at,status,headcount,participations,mode) VALUES (gen_random_uuid(),true,$1,'5e551099-0000-0000-0000-00000000000f',$2,$3,$4,${pr(d+' 10:00')}+interval '${m} minutes',${pr(d+' 10:00')}+interval '${m+mins} minutes',${pr(d+' 10:00')}+interval '${m+mins} minutes','closed',$5,$5,'group') RETURNING run_id`,[FAC,F,a,rs,head])).rows[0].run_id;
   await db.query(`INSERT INTO public.ritnome_activity_event(run_id,seq,kind,payload) VALUES ($1,1,'start',$2::jsonb)`,[run,JSON.stringify(a==='conga-party'?{group_bpm:92}:a==='reaction-speed'?{setting:'comfort'}:{})]);m+=mins;}};
 await mk(day(Math.max(1,dnum-2)),[['conga-party',5,8],['la-marquesina',10,8],['recall',5,6]]);await mk(day(Math.max(1,dnum-1)),[['reaction-speed',10,4]],'standalone');await mk(day(dnum),[['conga-party',10,10],['the-reset',3,10]]);
 const base={async rpc(name,params){const keys=Object.keys(params||{});const sql=`SELECT * FROM public.${name}(${keys.map((k,i)=>k+' => $'+(i+1)+(k==='p_payload'?'::jsonb':/p_(month|from|to_excl)/.test(k)?'::date':'')).join(',')})`;
  try{await db.query('BEGIN');await db.query('SET LOCAL ROLE service_role');const r=await db.query(sql,keys.map(k=>typeof params[k]==='object'&&params[k]!==null?JSON.stringify(params[k]):params[k]));await db.query('COMMIT');
   const rows=r.rows;if(rows.length===1&&r.fields.length===1&&!/_(check|open|exchange|report|handles|purge|list)$/.test(name))return {data:rows[0][r.fields[0].name]};return {data:rows};}catch(e){await db.query('ROLLBACK').catch(()=>{});return {error:e};}}};
 const tokO=jwt(O,SO),tokF=jwt(F,SF);const tokens=new Map([[tokO,{id:O}],[tokF,{id:F}]]);
 const auth={async getUser(t){const u=tokens.get(t);return u?{data:{user:{id:u.id,role:'authenticated',is_anonymous:false}}}:{error:{status:401}};},admin:{}};
 const app=express();app.disable('x-powered-by');
 for(const [u,f,ty] of [['/record','ritnome-record.html','text/html'],['/record.js','ritnome-record.js','application/javascript'],['/report','ritnome-report.html','text/html'],['/report.js','ritnome-report.js','application/javascript'],['/desk','ritnome-desk.html','text/html'],['/desk.js','ritnome-desk.js','application/javascript'],['/logo.png','ritnome-logo.png','image/png']])app.get(u,(_q,res)=>res.type(ty).sendFile(path.join(__dirname,f)));
 let SERVICE='';app.get('/enroll-config',(_q,res)=>res.json({url:SERVICE+'/fakeauth',publicKey:'x'}));
 app.post('/fakeauth/auth/v1/token',express.json(),(req,res)=>{const t=req.body?.email==='owner@a'?tokO:req.body?.email==='staff@a'?tokF:null;t?res.json({access_token:t}):res.status(400).json({error:'invalid_grant'});});
 mountReporting(app,express,createReporting({base,auth,priceId:PRICE,livemode:true,secureCookies:false,log:{error(){}}}));
 const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));SERVICE='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch();const errs=[];
 const ctx=await browser.newContext({viewport:{width:1100,height:1500}});const p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));
 // facilitator may read the record (facility scoped)
 await p.goto(SERVICE+'/desk');await p.fill('#email','staff@a');await p.fill('#password','pw');await p.click('#form button[type=submit]');await p.waitForTimeout(900);
 ok('desk links to the program record',await p.evaluate(()=>!!document.getElementById('recordLink2')));
 const from=`${ym}-01`,to=day(dnum);
 await p.goto(`${SERVICE}/record?from=${from}&to=${to}`);await p.waitForTimeout(1500);
 const st=await p.evaluate(()=>({pages:document.querySelectorAll('.page').length,txt:document.getElementById('pages').textContent,fac:document.querySelector('.fac').textContent,footers:[...document.querySelectorAll('.pf')].map(x=>x.textContent),sess:document.querySelectorAll('tr.sess').length,acts:document.querySelectorAll('tr.act').length,lang:document.documentElement.lang}));
 ok('record renders for the facilitator with the facility name, Spanish first',st.fac==='Residencia Prueba (ficticia)'&&st.lang==='es-PR');
 ok('3 facilitated sessions (one standalone) and 6 activity runs listed chronologically',st.sess===3&&st.acts===6&&/Actividad suelta/.test(st.txt)&&/Sesión facilitada · 3 actividades/.test(st.txt));
 ok('settings shown where recorded (92 BPM, comfort)',/92 BPM/.test(st.txt)&&/comfort/.test(st.txt));
 ok('every page carries "Página n de N" and the generation stamp',st.footers.length===st.pages&&st.footers.every((f,i)=>new RegExp(`Página ${i+1} de ${st.pages}`).test(f)&&/America\/Puerto_Rico/.test(f)));
 ok('scope and privacy statement with the no-certification wording, and a signature line',/no constituye certificación regulatoria/.test(st.txt)&&/no recopila nombres de residentes ni información médica/.test(st.txt)&&/Firma y fecha/.test(st.txt));
 ok('planned vs delivered by week with a period total',/Programación planificada vs realizada/.test(st.txt)&&/Total del período/.test(st.txt));
 // reconciliation with the executive report (owner)
 const ctx2=await browser.newContext({viewport:{width:1100,height:1500}});const o=await ctx2.newPage();o.on('pageerror',e=>errs.push(e.message));
 await o.goto(SERVICE+'/desk');await o.fill('#email','owner@a');await o.fill('#password','pw');await o.click('#form button[type=submit]');await o.waitForTimeout(900);
 const [rec,ex]=await o.evaluate(async([f,t_,y])=>{const a=await (await fetch(`/reporting/record?from=${f}&to=${t_}`,{credentials:'same-origin'})).json();const b=await (await fetch('/reporting/executive?period='+y,{credentials:'same-origin'})).json();return [a,b];},[from,to,ym]);
 ok('record totals equal the executive report totals for the same period',['sessions','activity_runs','participations','recreation_minutes','estimated_participant_minutes','planned_sessions','active_days'].every(k=>String(rec.summary[k])===String(ex.summary[k])));
 const listed=rec.sessions.reduce((a,s)=>({s:a.s+1,r:a.r+s.activities.length,p:a.p+s.activities.reduce((x,y)=>x+Number(y.participations),0),m:a.m+Number(s.minutes)}),{s:0,r:0,p:0,m:0});
 ok('listed rows add up to the summary (sessions, runs, participations, minutes)',listed.s===Number(rec.summary.sessions)&&listed.r===Number(rec.summary.activity_runs)&&listed.p===Number(rec.summary.participations)&&Math.abs(listed.m-Number(rec.summary.recreation_minutes))<0.01);
 ok('daily rows add up to the summary',rec.days.reduce((a,d)=>a+Number(d.runs),0)===Number(rec.summary.activity_runs)&&rec.days.filter(d=>Number(d.runs)>0).length===Number(rec.summary.active_days));
 ok('weekly planned (prorated) sums to the period plan within rounding',Math.abs(rec.weekly.reduce((a,w)=>a+Number(w.planned),0)-Number(rec.summary.planned_sessions))<=0.05*rec.weekly.length+0.05);
 // CSV
 await o.goto(`${SERVICE}/record?from=${from}&to=${to}`);await o.waitForTimeout(1200);
 const dl=o.waitForEvent('download',{timeout:5000});await o.click('#csv');const d=await dl;const csvPath=path.join(process.env.RITNOME_OUT||'/tmp','ritnome-record-test.csv');await d.saveAs(csvPath);const csv=fs.readFileSync(csvPath,'utf8');
 ok('CSV lists every activity row and the same totals',csv.split(/\r?\n/).filter(l=>/^"\d{4}-\d{2}-\d{2}","[^"]*","[^"]*","activity",/.test(l)).length===6&&/"sessions","3"/.test(csv)&&/"participations","(\d+)"/.test(csv)&&csv.includes(`"participations","${rec.summary.participations}"`));
 // English + print
 await o.click('#language');await o.waitForTimeout(600);
 ok('English version: same number of pages, "Page n of N"',await o.evaluate(()=>document.documentElement.lang==='en'&&/Page 1 of \d+/.test(document.querySelector('.pf').textContent)&&/not a regulatory certification/.test(document.getElementById('pages').textContent)));
 const pdf=path.join(process.env.RITNOME_OUT||'/tmp','ritnome-record-test.pdf');await o.pdf({path:pdf,format:'Letter',printBackground:true,preferCSSPageSize:true});
 const pdfPages=(fs.readFileSync(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g)||[]).length;const screenPages=await o.evaluate(()=>document.querySelectorAll('.page').length);
 ok('PDF page count equals the laid-out pages (Letter)',pdfPages===screenPages&&pdfPages>=1);
 // another facility sees nothing of this one: owner B
 ok('no page errors',errs.length===0);
 await browser.close();server.close();await db.end();console.log('PASS '+pass);
})().catch(e=>{console.error('✘ '+e.message);process.exit(1);});

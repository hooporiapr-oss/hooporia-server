'use strict';
// R5: Mi Trayectoria against the real service (fictional fixtures): access, facts reconcile to rows, ≥3-observation rule, no ranking/clinical wording, pages, both languages, print.
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
 const H1='9a7b2c00-0000-0000-0000-00000000aa01',H2='9a7b2c00-0000-0000-0000-00000000aa02';
 for(const [q,p] of [
  [`INSERT INTO auth.users(id,email) VALUES ($1,'owner@a'),($2,'staff@a') ON CONFLICT DO NOTHING`,[O,F]],
  [`INSERT INTO auth.sessions(id,user_id) VALUES ($1,$2),($3,$4) ON CONFLICT DO NOTHING`,[SO,O,SF,F]],
  [`INSERT INTO public.licenses(id,code,school_name,product) VALUES ('aaaaaaaa-0000-0000-0000-0000000000aa','LIC-A','A','ritnome_institutional') ON CONFLICT DO NOTHING`,[]],
  [`INSERT INTO public.ritnome_enrollment(livemode,owner_id,facility_id,facility_name,facility_type,approved_license_id,checkout_session_id,stripe_customer_id) VALUES (true,$1,$2,'Residencia Prueba (ficticia)','residence','aaaaaaaa-0000-0000-0000-0000000000aa','cs_live_A1','cus_A1') ON CONFLICT DO NOTHING`,[O,FAC]],
  [`INSERT INTO public.ritnome_subscription_registry(livemode,facility_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,license_id,billing_status,paid_through) VALUES (true,$2,'cus_A1','sub_A1',$1,'aaaaaaaa-0000-0000-0000-0000000000aa','active',now()+interval '20 days') ON CONFLICT DO NOTHING`,[PRICE,FAC]],
  [`INSERT INTO public.ritnome_institution_memberships(livemode,user_id,facility_id,active,role) VALUES (true,$1,$3,true,'owner'),(true,$2,$3,true,'facilitator') ON CONFLICT DO NOTHING`,[O,F,FAC]],
  [`INSERT INTO public.ritnome_facility_plan(livemode,facility_id,sessions_per_week,handles_enabled) VALUES (true,$1,5,true) ON CONFLICT (livemode,facility_id) DO UPDATE SET handles_enabled=true`,[FAC]],
  [`INSERT INTO public.ritnome_participant_handle(handle_id,livemode,facility_id) VALUES ($1,true,$3),($2,true,$3) ON CONFLICT DO NOTHING`,[H1,H2,FAC]],
  [`INSERT INTO public.ritnome_facility_session(id,livemode,facility_id,user_id,auth_session,role) VALUES ('5e551099-0000-0000-0000-00000000000f',true,$1,$2,$3,'facilitator')`,[FAC,F,SF]]])await db.query(q,p);
 // fixture: one run per entry, each with a progress row for H1; one older conga entry (before the window) so "new activities" excludes conga
 const entries=[ // [daysAgo, activity, setting, bpm, result, minutes]
  [40,'conga-party','default',null,{completed:1},5],
  [12,'conga-party','default',null,{completed:1},5],[9,'conga-party','default',null,{completed:1},5],[6,'conga-party','default',null,{completed:1},5],[2,'conga-party','default',null,{completed:1},5],
  [8,'reaction-speed','comfort',60,{bpm:60},5],[3,'reaction-speed','comfort',62,{bpm:62},5],[11,'reaction-speed','comfort',64,{bpm:64},5],[4,'reaction-speed','comfort',62,{bpm:62},5],
  [10,'reaction-speed','default',70,{bpm:70},5],[1,'reaction-speed','default',72,{bpm:72},5],
  [7,'recall','default',null,{level:2},5],[1,'recall','default',null,{level:5},5],
  [5,'la-marquesina','default',null,{completed:1},10]];
 for(const [ago,a,setting,bpm,result,mins] of entries){
  const run=(await db.query(`INSERT INTO public.ritnome_activity_run(run_id,livemode,facility_id,session_id,facilitator_user_id,activity_key,started_at,last_event_at,ended_at,status,headcount,participations,mode) VALUES (gen_random_uuid(),true,$1,'5e551099-0000-0000-0000-00000000000f',$2,$3,now()-make_interval(days=>$4),now()-make_interval(days=>$4)+interval '5 minutes',now()-make_interval(days=>$4)+interval '5 minutes','closed',1,1,'individual') RETURNING run_id`,[FAC,F,a,ago])).rows[0].run_id;
  if(a==='conga-party')await db.query(`INSERT INTO public.ritnome_activity_event(run_id,seq,kind,payload) VALUES ($1,1,'start','{"group_bpm":92,"mode":"group"}'::jsonb)`,[run]);
  await db.query(`INSERT INTO public.ritnome_participant_progress(handle_id,run_id,seq,activity_key,setting,personal_bpm,minutes,result,recorded_at) VALUES ($1,$2,1,$3,$4,$5,$6,$7::jsonb,now()-make_interval(days=>$8)+interval '5 minutes')`,[H1,run,a,setting,bpm,mins,JSON.stringify(result),ago]);}
 const base={async rpc(name,params){const keys=Object.keys(params||{});const sql=`SELECT * FROM public.${name}(${keys.map((k,i)=>k+' => $'+(i+1)+(k==='p_payload'?'::jsonb':/p_(month|from|to_excl)/.test(k)?'::date':'')).join(',')})`;
  try{await db.query('BEGIN');await db.query('SET LOCAL ROLE service_role');const r=await db.query(sql,keys.map(k=>typeof params[k]==='object'&&params[k]!==null?JSON.stringify(params[k]):params[k]));await db.query('COMMIT');
   const rows=r.rows;if(rows.length===1&&r.fields.length===1&&!/_(check|open|exchange|report|handles|purge|list)$/.test(name))return {data:rows[0][r.fields[0].name]};return {data:rows};}catch(e){await db.query('ROLLBACK').catch(()=>{});return {error:e};}}};
 const tokO=jwt(O,SO),tokF=jwt(F,SF);const tokens=new Map([[tokO,{id:O}],[tokF,{id:F}]]);
 const auth={async getUser(t){const u=tokens.get(t);return u?{data:{user:{id:u.id,role:'authenticated',is_anonymous:false}}}:{error:{status:401}};},admin:{}};
 const app=express();app.disable('x-powered-by');
 for(const [u,f,ty] of [['/journey','ritnome-journey.html','text/html'],['/journey.js','ritnome-journey.js','application/javascript'],['/desk','ritnome-desk.html','text/html'],['/desk.js','ritnome-desk.js','application/javascript'],['/logo.png','ritnome-logo.png','image/png']])app.get(u,(_q,res)=>res.type(ty).sendFile(path.join(__dirname,f)));
 let SERVICE='';app.get('/enroll-config',(_q,res)=>res.json({url:SERVICE+'/fakeauth',publicKey:'x'}));
 app.post('/fakeauth/auth/v1/token',express.json(),(req,res)=>{const t=req.body?.email==='owner@a'?tokO:req.body?.email==='staff@a'?tokF:null;t?res.json({access_token:t}):res.status(400).json({error:'invalid_grant'});});
 mountReporting(app,express,createReporting({base,auth,priceId:PRICE,livemode:true,secureCookies:false,log:{error(){}}}));
 const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));SERVICE='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch();const errs=[];
 const d=new Date();const iso=x=>x.toISOString().slice(0,10);const to=iso(d),from=iso(new Date(d.getTime()-30*864e5));
 // facilitator: no access
 const ctxF=await browser.newContext({viewport:{width:1100,height:1500}});const pf=await ctxF.newPage();pf.on('pageerror',e=>errs.push(e.message));
 await pf.goto(SERVICE+'/desk');await pf.fill('#email','staff@a');await pf.fill('#password','pw');await pf.click('#form button[type=submit]');await pf.waitForTimeout(900);
 await pf.goto(`${SERVICE}/journey?handle=${H1}&from=${from}&to=${to}`);await pf.waitForTimeout(1200);
 ok('facilitator cannot open an individual journey (owner/manager only)',/Solo el propietario o gerente/.test(await pf.textContent('#msg'))&&(await pf.evaluate(()=>document.querySelectorAll('.page .hero').length))===0);
 // owner
 const ctx=await browser.newContext({viewport:{width:1100,height:1500}});const p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));
 await p.goto(SERVICE+'/desk');await p.fill('#email','owner@a');await p.fill('#password','pw');await p.click('#form button[type=submit]');await p.waitForTimeout(1500);
 ok('desk handles table links each handle to its journey',await p.evaluate(h=>!!document.querySelector(`#handlesTable a[data-journey="${h}"][href^="/journey?handle="]`),H1));
 await p.goto(`${SERVICE}/journey?handle=${H1}&from=${from}&to=${to}`);await p.waitForTimeout(1500);
 const sm=await p.evaluate(()=>({pages:document.querySelectorAll('.page').length,tables:document.querySelectorAll('.page table').length,motto:document.querySelector('.motto')?.textContent,pf:document.querySelector('.pf').textContent,csvHidden:document.getElementById('csv').classList.contains('hidden'),tiles:[...document.querySelectorAll('.hero .kpi span')].map(x=>x.textContent)}));
 ok('Personal Summary: exactly one page, no tables, CSV hidden',sm.pages===1&&sm.tables===0&&sm.csvHidden);
 ok('philosophy statement is prominent on the summary',sm.motto==='Cada persona tiene su propio ritmo. Cada participación cuenta.');
 ok('summary footer carries the full scope: pseudonymous, facility-controlled sharing, group tempo never attributed, not better or worse, not therapy',/control(a)? con quién se comparte/.test(sm.pf)&&/nunca se atribuye a la persona/.test(sm.pf)&&/no es mejor ni peor/.test(sm.pf)&&/no tratamiento médico ni terapia/.test(sm.pf)&&/Resumen personal/.test(sm.pf));
 ok('recorded individual minutes shown as a tile when available',sm.tiles.includes('Minutos de recreación registrados'));
 await p.goto(`${SERVICE}/journey?handle=${H1}&from=${from}&to=${to}&view=detailed`);await p.waitForTimeout(1500);
 const j=await p.evaluate(async([h,f,t])=>(await (await fetch(`/reporting/journey?handle=${h}&from=${f}&to=${t}`,{credentials:'same-origin'})).json()),[H1,from,to]);
 const st=await p.evaluate(()=>({pages:document.querySelectorAll('.page').length,txt:document.getElementById('pages').textContent,hero:[...document.querySelectorAll('.hero .kpi b')].map(x=>x.textContent),who:document.querySelector('.title .who').textContent,footers:[...document.querySelectorAll('.pf')].map(x=>x.textContent),lang:document.documentElement.lang,hist:document.querySelectorAll('table tbody tr').length,story:document.querySelector('.story').textContent,acc:[...document.querySelectorAll('.acc div')].map(x=>x.textContent)}));
 ok('journey renders Spanish-first with the pseudonymous handle label (no name)',st.lang==='es-PR'&&st.who.includes(H1.slice(0,6).toUpperCase())&&!/owner@a|staff@a/.test(st.txt));
 ok('hero reconciles to the window: 13 entries, 4 distinct activities, 13 sessions, 70 recorded minutes',st.hero[1]==='13'&&st.hero[2]==='4'&&st.hero[0]==='13'&&st.hero[4]==='70'&&j.summary.entries===13&&j.summary.activities===4&&Number(j.summary.minutes)===70);
 ok('older entry (before the window) counted in lifetime, not in the period; conga is not "new"',j.lifetime.entries===14&&j.summary.new_activities===3&&/3 de ellas por primera vez/.test(st.story));
 ok('story states the measured tempo range as facts (60–72 BPM, 6 occasions) — group-mode conga adds none',/entre 60 y 72 BPM en 6 ocasiones/.test(st.story)&&j.summary.tempo_n===6);
 ok('typical tempo only with ≥3 observations at the same setting: comfort mode (4) shown, default setting (2) marked insufficient',/Mi tempo típico en Reaction Speed \(modo cómodo\): 62 BPM/.test(st.acc.join(' '))&&!/típico en Reaction Speed: /.test(st.acc.join(' '))&&/menos de tres observaciones comparables/.test(st.txt));
 ok('group tempo is never attributed to the person: conga rows show the group tempo (92) and no personal measurement',j.history.filter(x=>x.activity==='conga-party').every(x=>x.bpm===null&&Number(x.activity_bpm)===92)&&/Tempo del grupo/.test(st.txt)&&/Mi tempo \(medido\)/.test(st.txt)&&!/típico en Conga Party/.test(st.acc.join(' ')));
 ok('history count stated and complete (13 of 13)',/Se muestran 13 de 13 registros/.test(st.txt)&&j.history_total===13);
 ok('by-activity rows: first/typical/latest tempo at the same setting, level reached in Recall',/Reaction Speed\s*modo cómodo\s*4\s*64 BPM\s*62 BPM\s*62 BPM/.test(st.txt)&&/Llegué al nivel 5 en Recall/.test(st.acc.join(' ')));
 ok('explored activities list the 4 played out of the available catalog',/Conga Party · Ritmo/.test(st.txt)&&/Recall · Memoria/.test(st.txt)&&/La Marquesina · Recreación PR/.test(st.txt)&&/4 de \d+ actividades disponibles/.test(st.txt));
 ok('chronological history lists every entry in the window (13 rows + 5 by-activity rows)',st.hist===18&&j.history.length===13&&j.history.every((x,i,a)=>i===0||a[i-1].at>=x.at));
 const banned=/\b(mejor que|peor que|ranking|clasificaci[oó]n|percentil|terapia ocupacional|diagn[oó]stico|cognitiv|d[eé]ficit|deterioro|puntuaci[oó]n|m[aá]s r[aá]pido es mejor)\b/i;
 ok('no ranking, comparative or clinical wording',!banned.test(st.txt)&&/no es mejor ni peor/.test(st.txt)&&/su propio ritmo/.test(st.txt)&&/no tratamiento médico ni terapia/.test(st.txt));
 ok('every page carries "Página n de N" and the generation stamp; later pages carry the abbreviated scope',st.footers.length===st.pages&&st.pages>=2&&st.footers.every((f,i)=>new RegExp(`Página ${i+1} de ${st.pages}`).test(f)&&/America\/Puerto_Rico/.test(f)&&/Historial detallado/.test(f))&&st.footers.slice(1).every(f=>/no atribuido a la persona/.test(f)&&f.length<st.footers[0].length));
 const dl=p.waitForEvent('download',{timeout:5000});await p.click('#csv');const dd=await dl;const csvPath=path.join(process.env.RITNOME_OUT||'/tmp','ritnome-journey-test.csv');await dd.saveAs(csvPath);const csv=fs.readFileSync(csvPath,'utf8');
 ok('history CSV: every record, group tempo and measured tempo in separate columns',csv.split(/\r?\n/).filter(l=>/^"\d{4}-\d{2}-\d{2}",/.test(l)).length===13&&/"activity_bpm","personal_bpm_measured"/.test(csv)&&/"Conga Party","individual","","92",""/.test(csv));
 // empty handle
 await p.goto(`${SERVICE}/journey?handle=${H2}&from=${from}&to=${to}`);await p.waitForTimeout(1200);
 ok('a handle with no entries shows an honest empty state',/Sin actividades registradas/.test(await p.textContent('#pages')));
 // English + print
 await p.goto(`${SERVICE}/journey?handle=${H1}&from=${from}&to=${to}&view=detailed`);await p.waitForTimeout(1200);await p.click('#language');await p.waitForTimeout(600);
 const en=await p.evaluate(()=>({lang:document.documentElement.lang,txt:document.getElementById('pages').textContent,pf:document.querySelector('.pf').textContent}));
 ok('English version: same facts, "Page n of N", neither-better-nor-worse statement',en.lang==='en'&&/Page 1 of \d+/.test(en.pf)&&/between 60 and 72 BPM on 6 occasions/.test(en.txt)&&/Everyone has their own rhythm\. Every participation counts\./.test(en.txt)&&/Group tempo/.test(en.txt)&&/neither better nor worse/.test(en.txt)&&/fewer than three comparable observations/.test(en.txt)&&!/\b(better than|worse than|ranking|percentile|cognitive|deficit|decline|score)\b/i.test(en.txt));
 const pdf=path.join(process.env.RITNOME_OUT||'/tmp','ritnome-journey-test.pdf');await p.pdf({path:pdf,format:'Letter',printBackground:true,preferCSSPageSize:true});
 const pdfPages=(fs.readFileSync(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g)||[]).length;const screenPages=await p.evaluate(()=>document.querySelectorAll('.page').length);
 ok('PDF page count equals the laid-out pages (Letter)',pdfPages===screenPages&&pdfPages>=1);
 // sample is explicitly fictional
 await p.goto(`${SERVICE}/journey?sample=1`);await p.waitForTimeout(1200);
 ok('sample is labelled fictional on the cover and every footer',await p.evaluate(()=>/PARTICIPANTE FICTICIO|FICTIONAL PARTICIPANT/.test(document.querySelector('.page').textContent)&&[...document.querySelectorAll('.pf')].every(f=>/DATOS DE MUESTRA|SAMPLE DATA/.test(f.textContent))));
 ok('no page errors',errs.length===0);
 await browser.close();server.close();await db.end();console.log('PASS '+pass);
})().catch(e=>{console.error('✘ '+e.message);process.exit(1);});

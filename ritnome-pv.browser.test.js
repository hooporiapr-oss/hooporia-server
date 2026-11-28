'use strict';
// Progress View landing (R6): six cards by role, weekly reconciliation across desk / Executive Report / Program Record / CSV,
// mid-week month boundaries, Puerto Rico date boundary, trial card states, labels and complete English. Data: the demo-facility script.
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
 const O='0d0d0d0d-0000-0000-0000-000000000001',M='0d0d0d0d-0000-0000-0000-000000000002',F='0d0d0d0d-0000-0000-0000-000000000003';
 const SO='5e5e0000-0000-0000-0000-000000000001',SM='5e5e0000-0000-0000-0000-000000000002',SF='5e5e0000-0000-0000-0000-000000000003';
 await db.query(`INSERT INTO auth.users(id,email) VALUES ($1,'gostardigital@gmail.com'),($2,'manager@demo'),($3,'staff@demo')`,[O,M,F]);
 await db.query(`INSERT INTO auth.sessions(id,user_id) VALUES ($1,$2),($3,$4),($5,$6)`,[SO,O,SM,M,SF,F]);
 await db.query(fs.readFileSync(path.join(__dirname,'security-review/ritnome-demo-facility.sql'),'utf8'));
 const FAC=(await db.query(`SELECT facility_id FROM public.ritnome_enrollment WHERE owner_id=$1`,[O])).rows[0].facility_id;
 await db.query(`INSERT INTO public.ritnome_institution_memberships(livemode,user_id,facility_id,active,role) VALUES (true,$1,$3,true,'manager'),(true,$2,$3,true,'facilitator')`,[M,F,FAC]);
 // Puerto Rico date boundary: a session at 23:30 PR on the last day of the previous month (03:30 UTC on the 1st)
 const today=(await db.query(`SELECT public.ritnome_pr_today()::text d`)).rows[0].d;
 const m0=today.slice(0,8)+'01';const prevLast=(await db.query(`SELECT ($1::date-1)::text d`,[m0])).rows[0].d;const prevMonth=prevLast.slice(0,7);
 const FS=(await db.query(`SELECT id FROM public.ritnome_facility_session WHERE facility_id=$1 LIMIT 1`,[FAC])).rows[0].id;
 const rs=(await db.query(`INSERT INTO public.ritnome_recreation_session(livemode,facility_id,session_id,facilitator_user_id,source,status,started_at,ended_at) VALUES (true,$1,$2,$3,'plan','closed',($4::timestamp+time '23:30') AT TIME ZONE 'America/Puerto_Rico',($4::timestamp+time '23:40') AT TIME ZONE 'America/Puerto_Rico') RETURNING id`,[FAC,FS,O,prevLast])).rows[0].id;
 await db.query(`INSERT INTO public.ritnome_activity_run(run_id,livemode,facility_id,session_id,facilitator_user_id,activity_key,mode,started_at,last_event_at,ended_at,status,headcount,participations,recreation_session_id) VALUES (gen_random_uuid(),true,$1,$2,$3,'the-reset','group',($4::timestamp+time '23:30') AT TIME ZONE 'America/Puerto_Rico',($4::timestamp+time '23:40') AT TIME ZONE 'America/Puerto_Rico',($4::timestamp+time '23:40') AT TIME ZONE 'America/Puerto_Rico','closed',7,7,$5)`,[FAC,FS,O,prevLast,rs]);
 const base={async rpc(name,params){const keys=Object.keys(params||{});const sql=`SELECT * FROM public.${name}(${keys.map((k,i)=>k+' => $'+(i+1)+(k==='p_payload'?'::jsonb':/p_(month|from|to_excl)/.test(k)?'::date':'')).join(',')})`;
  try{await db.query('BEGIN');await db.query('SET LOCAL ROLE service_role');const r=await db.query(sql,keys.map(k=>typeof params[k]==='object'&&params[k]!==null?JSON.stringify(params[k]):params[k]));await db.query('COMMIT');
   const rows=r.rows;if(rows.length===1&&r.fields.length===1&&!/_(check|open|exchange|report|handles|purge|list)$/.test(name))return {data:rows[0][r.fields[0].name]};return {data:rows};}catch(e){await db.query('ROLLBACK').catch(()=>{});return {error:e};}}};
 const toks={'gostardigital@gmail.com':jwt(O,SO),'manager@demo':jwt(M,SM),'staff@demo':jwt(F,SF)};const ids={[toks['gostardigital@gmail.com']]:O,[toks['manager@demo']]:M,[toks['staff@demo']]:F};
 const auth={async getUser(t){return ids[t]?{data:{user:{id:ids[t],role:'authenticated',is_anonymous:false}}}:{error:{status:401}};},admin:{}};
 const app=express();for(const [u,f,ty] of [['/desk','ritnome-desk.html','text/html'],['/desk.js','ritnome-desk.js','application/javascript'],['/logo.png','ritnome-logo.png','image/png']])app.get(u,(_q,res)=>res.type(ty).sendFile(path.join(__dirname,f)));
 let SERVICE='';app.get('/enroll-config',(_q,res)=>res.json({url:SERVICE+'/fakeauth',publicKey:'x'}));
 app.post('/fakeauth/auth/v1/token',express.json(),(req,res)=>{const t=toks[req.body?.email];t?res.json({access_token:t}):res.status(400).json({error:'invalid_grant'});});
 mountReporting(app,express,createReporting({base,auth,priceId:PRICE,livemode:true,secureCookies:false,log:{error(){}}}));
 const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));SERVICE='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch();const errs=[];
 const signIn=async(email,vp={width:1280,height:900})=>{const ctx=await browser.newContext({viewport:vp,acceptDownloads:true});const p=await ctx.newPage();p.on('pageerror',e=>errs.push(email+': '+e.message));
  await p.goto(SERVICE+'/desk');await p.fill('#email',email);await p.fill('#password','x');await p.click('#form button[type=submit]');await p.waitForTimeout(1500);await p.click('[data-tab=progress]');await p.waitForTimeout(400);return p;};
 const cards=p=>p.evaluate(()=>[...document.querySelectorAll('#pvCards [data-card]')].map(c=>c.dataset.card));
 const get=(p,u)=>p.evaluate(async u=>await (await fetch(u,{credentials:'same-origin'})).json(),u);
 // ---- owner
 const o=await signIn('gostardigital@gmail.com');
 ok('owner sees all six cards in order',JSON.stringify(await cards(o))===JSON.stringify(['fac','exec','rec','trial','journey','set']));
 ok('landing shows the official logo and three columns on desktop',await o.evaluate(()=>!!document.querySelector('.pvlogo img[src="/logo.png"]')&&getComputedStyle(document.getElementById('pvCards')).gridTemplateColumns.split(' ').length===3));
 ok('trial card marked as historical after conversion',/Informe histórico de la prueba/.test(await o.textContent('[data-card=trial]')));
 ok('report cards link to the existing pages',await o.evaluate(()=>document.querySelector('[data-card=rec]').getAttribute('href')==='/record'&&document.querySelector('[data-card=trial]').getAttribute('href')==='/report?period=trial'));
 ok('only the landing is visible until a card is opened',await o.evaluate(()=>[...document.querySelectorAll('#tab-progress .pvview')].filter(v=>!v.hidden).map(v=>v.id).join()==='pv-home'));
 // reconciliation: desk weekly = desk monthly = Executive Report = Program Record = CSV, for three months (partial current, previous, first month starting mid-month)
 const months=[today.slice(0,7),prevMonth,(await db.query(`SELECT to_char(($1::date-interval '2 months'),'YYYY-MM') m`,[m0])).rows[0].m];
 for(const ym of months){const mg=await get(o,'/reporting/management?month='+ym);const ex=await get(o,'/reporting/executive?period='+ym);
  const last=(await db.query(`SELECT least((($1||'-01')::date+interval '1 month'-interval '1 day')::date,public.ritnome_pr_today())::text d`,[ym])).rows[0].d;
  const rec=await get(o,`/reporting/record?from=${ym}-01&to=${last}`);
  const wsum=mg.weekly.reduce((a,w)=>a+Number(w.sessions),0),rsum=rec.weekly.reduce((a,w)=>a+Number(w.sessions),0),xsum=ex.weekly.reduce((a,w)=>a+Number(w.sessions),0);
  const wplan=mg.weekly.reduce((a,w)=>a+Number(w.planned),0);
  ok(`${ym}: desk weekly (${wsum}) = desk month (${mg.summary.sessions}) = Executive Report (${ex.summary.sessions}) = Program Record (${rec.summary.sessions}) and their weekly rows`,wsum===Number(mg.summary.sessions)&&Number(mg.summary.sessions)===Number(ex.summary.sessions)&&Number(ex.summary.sessions)===Number(rec.summary.sessions)&&rsum===wsum&&xsum===wsum);
  ok(`${ym}: weekly planned adds up to the monthly plan within rounding, weeks stay inside the month`,Math.abs(wplan-Number(mg.summary.planned_sessions))<=0.05*mg.weekly.length+0.05&&mg.weekly.every(w=>w.from>=ym+'-01'&&w.to<=last&&w.from<=w.to));
  const firstDow=new Date(ym+'-01T12:00:00Z').getUTCDay();ok(`${ym}: a month starting mid-week opens with a partial week`,firstDow===1?mg.weekly[0].partial===false||mg.weekly[0].from===ym+'-01':mg.weekly[0].partial===true&&mg.weekly[0].from===ym+'-01');}
 const prevRec=await get(o,`/reporting/record?from=${prevMonth}-01&to=${prevLast}`);const curRec=await get(o,`/reporting/record?from=${m0}&to=${today}`);
 ok('Puerto Rico boundary: a session at 23:30 PR on the last day counts in that month, not the next',prevRec.sessions.some(s=>s.day===prevLast&&s.activities.some(a=>a.activity==='the-reset'&&a.headcount===7))&&!curRec.sessions.some(s=>s.activities.some(a=>a.headcount===7&&a.activity==='the-reset'&&s.day===m0)));
 // executive card view
 await o.click('[data-card=exec]');await o.waitForTimeout(500);
 const ev=await o.evaluate(()=>({period:document.getElementById('mgmtPeriod').textContent,rows:[...document.querySelectorAll('#weekly tr')].slice(1).map(r=>[...r.children].map(c=>c.textContent.trim())),kpis:document.getElementById('mgmtKpis').textContent,month:document.getElementById('month').value,href:document.getElementById('execReport').getAttribute('href')}));
 const total=ev.rows.pop();ok('desk weekly table rows add up to its "Month total" and to the monthly figure',ev.rows.reduce((a,r)=>a+Number(r[1]),0)===Number(total[1])&&new RegExp('^'+total[1]+' / ').test(ev.kpis));
 ok('calendar-month period stated, month picker set, printable report linked',/^Mes calendario: /.test(ev.period)&&ev.month===today.slice(0,7)&&ev.href==='/report?period='+today.slice(0,7));
 ok('previous-period figure labelled as the same period last month',/Mismo período del mes anterior \(1–\d+ /.test(ev.kpis));
 ok('tracked unique participants labelled as such',/Participantes únicos con seguimiento/.test(ev.kpis));
 const dl=o.waitForEvent('download',{timeout:5000});await o.click('#csv');const csvPath=path.join(process.env.RITNOME_OUT||'/tmp','ritnome-pv-test.csv');await (await dl).saveAs(csvPath);const csv=fs.readFileSync(csvPath,'utf8');
 const wrows=csv.split('\n').filter(l=>/^"\d{4}-\d{2}-\d{2}","\d{4}-\d{2}-\d{2}","(yes|no)"/.test(l));const csvSessions=Number((/"sessions","(\d+)"/.exec(csv)||[])[1]);
 ok('desk CSV: weekly rows (with dates and partial flag) add up to the monthly sessions',wrows.length===ev.rows.length&&wrows.reduce((a,l)=>a+Number(l.split(',')[3].replace(/"/g,'')),0)===csvSessions&&/"activity","activity_runs","participations"/.test(csv));
 // facilitator view card
 await o.click('#pv-exec .pvback');await o.click('[data-card=fac]');await o.waitForTimeout(400);
 const fv=await o.evaluate(()=>({period:document.getElementById('facPeriod').textContent,sess:document.querySelectorAll('#history tr.sess').length,acts:document.querySelectorAll('#history tr.run').length}));
 const fac=await get(o,'/reporting/facilitator');
 ok('Facilitator View states the last-30-days period',/^Últimos 30 días: /.test(fv.period));
 ok('history grouped by facilitated session with its activity runs beneath',fv.sess===fac.sessions.length&&fv.acts===fac.history.length&&fv.sess>0);
 // Mi Trayectoria card
 await o.click('#pv-fac .pvback');await o.click('[data-card=journey]');await o.waitForTimeout(400);
 ok('participants list: recorded activities column, summary and detailed links',await o.evaluate(()=>/Actividades registradas/.test(document.querySelector('#handlesTable tr').textContent)&&document.querySelectorAll('#handlesTable a[href*="view=detailed"]').length===6&&document.querySelectorAll('#handlesTable a[data-journey]').length===6));
 // settings card (owner can edit)
 await o.click('#pv-journey .pvback');await o.click('[data-card=set]');await o.waitForTimeout(400);
 ok('owner: settings editable, staff form shown',await o.evaluate(()=>!document.getElementById('spw').disabled&&!document.getElementById('staffForm').hidden&&document.getElementById('settingsNote').hidden));
 // English: every table, role, button and date
 await o.click('#language');await o.waitForTimeout(500);
 const en=await o.evaluate(()=>{document.querySelectorAll('#tab-progress .pvview').forEach(v=>v.hidden=false);return document.getElementById('app').innerText+' '+document.getElementById('who').textContent;});
 const spanish=en.match(/\b(Correo|Rol|Activo|Propietario|Gerente|Facilitador|Identificador|Creado|Ver progreso|Retirar|Resumen personal|Historial detallado|Sesiones|Actividades|Semana|Realizadas|Planificadas|Mes calendario|Últimos|a\. m\.|p\. m\.|Desactivar|Guardar|Añadir|Configuración|Vista del facilitador|Informe)\b/g);
 ok('English: staff, participant and report tables, roles, buttons, settings and dates fully translated',!spanish&&/Owner/.test(en)&&/Recorded activities/.test(en)&&/Tracked unique participants/.test(en)&&/Calendar month: /.test(en)&&/Last 30 days: /.test(en)&&/Same period last month/.test(en));
 await o.click('#language');await o.waitForTimeout(300);
 // ---- manager
 const m=await signIn('manager@demo');
 ok('manager sees the six cards',JSON.stringify(await cards(m))===JSON.stringify(['fac','exec','rec','trial','journey','set']));
 await m.click('[data-card=set]');await m.waitForTimeout(400);
 ok('manager: settings are read-only (no new owner privileges)',await m.evaluate(()=>document.getElementById('spw').disabled&&document.getElementById('handles').disabled&&document.getElementById('planForm').querySelector('button').hidden&&document.getElementById('staffForm').hidden&&!document.getElementById('settingsNote').hidden&&!document.querySelector('#staff button[data-user]')));
 ok('manager settings card labelled read only',/Solo lectura/.test(await m.textContent('[data-card=set]')));
 const mp=await m.evaluate(async()=>(await fetch('/reporting/plan',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessions_per_week:9,handles_enabled:true})})).status);
 ok('manager cannot change the plan on the server either (403)',mp===403);
 // ---- facilitator
 const f=await signIn('staff@demo');
 ok('facilitator sees only Facilitator View and Program Record',JSON.stringify(await cards(f))===JSON.stringify(['fac','rec']));
 await f.click('[data-card=fac]');await f.waitForTimeout(400);ok('facilitator opens Facilitator View',await f.evaluate(()=>!document.getElementById('pv-fac').hidden&&document.querySelectorAll('#history tr.sess').length>0));
 const fs403=await f.evaluate(async()=>[(await fetch('/reporting/management',{credentials:'same-origin'})).status,(await fetch('/reporting/executive?period=trial',{credentials:'same-origin'})).status,(await fetch('/reporting/staff',{credentials:'same-origin'})).status]);
 ok('facilitator still refused by the server for management, trial report and staff',fs403.every(s=>s===403));
 // ---- trial in progress: card is first and prominent
 await db.query(`UPDATE public.ritnome_subscription_registry SET billing_status='trialing',paid_through=now()+interval '6 days',created_at=now()-interval '8 days' WHERE facility_id=$1`,[FAC]);
 await o.reload();await o.waitForTimeout(1500);await o.click('[data-tab=progress]');await o.waitForTimeout(500);
 ok('during the trial the Trial Value Report card comes first with days left',(await cards(o))[0]==='trial'&&/Prueba activa · \d+ días restantes/.test(await o.textContent('[data-card=trial]'))&&await o.evaluate(()=>document.querySelector('[data-card=trial]').classList.contains('featured')));
 // ---- responsive: two columns on tablet, one on phone, no sideways scrolling
 for(const [w,cols] of [[820,2],[390,1]]){await o.setViewportSize({width:w,height:900});await o.waitForTimeout(200);
  ok(`${w}px: ${cols} column(s), no horizontal scroll`,await o.evaluate(c=>getComputedStyle(document.getElementById('pvCards')).gridTemplateColumns.split(' ').length===c&&document.documentElement.scrollWidth<=document.documentElement.clientWidth,cols));}
 ok('no page errors',errs.length===0);
 await browser.close();server.close();await db.end();console.log('PASS '+pass);
})().catch(e=>{console.error('✘ '+e.message);process.exit(1);});

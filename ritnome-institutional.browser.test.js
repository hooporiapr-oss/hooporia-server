'use strict';
// Phase 2 browser test: the shared script + Conga Party against the real reporting service and a disposable local database.
// Env: RITNOME_TEST_DATABASE_URL, RITNOME_BPM_DIR (checkout of ritnome-bpm with the institutional glue). Playwright must be installed.
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const {Client}=require('pg');
const {chromium,devices}=require('playwright');
const {createReporting,mountReporting}=require('./ritnome-reporting');
const catalog=require('./ritnome-activity-catalog');
const url=process.env.RITNOME_TEST_DATABASE_URL,site=process.env.RITNOME_BPM_DIR;
if(!url||!site){console.log('skip: RITNOME_TEST_DATABASE_URL / RITNOME_BPM_DIR not set');process.exit(0);}
const PRICE='price_1UgP8ZCuedlcmwMmeEZr9ev2';
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt=(sub,session)=>b64({alg:'HS256'})+'.'+b64({sub,role:'authenticated',session_id:session,exp:Math.floor(Date.now()/1000)+3600})+'.'+b64({s:1});
let pass=0;const ok=(n,c)=>{assert.ok(c,n);pass++;console.log('✔ '+n);};
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
   const rows=r.rows;if(rows.length===1&&r.fields.length===1&&!/_(check|open|exchange|report|handles|purge)$/.test(name))return {data:rows[0][r.fields[0].name]};return {data:rows};}catch(e){await db.query('ROLLBACK').catch(()=>{});return {error:e};}}};
 const tok=jwt(U,S);const auth={async getUser(t){return t===tok?{data:{user:{id:U,role:'authenticated',is_anonymous:false}}}:{error:{status:401}};}};
 const conga=catalog.byKey.get('conga-party');conga.available=true;
 // service on 127.0.0.1 (the shared script accepts a 127.0.0.1 origin as its service when served from it)
 const app=express();app.disable('x-powered-by');
 app.get('/ritnome-institutional.js',(_q,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'ritnome-institutional.js')));
 mountReporting(app,express,createReporting({base,auth,priceId:PRICE,livemode:true,secureCookies:false,log:{error(){}}}));
 const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const SERVICE='http://127.0.0.1:'+server.address().port;
 // facilitator session + launch (as the library will do)
 let r=await fetch(SERVICE+'/reporting/session',{method:'POST',headers:{Authorization:'Bearer '+tok}});const cookie=(r.headers.get('set-cookie')||'').split(';')[0];assert.equal(r.status,200);
 const launch=async()=>{const x=await fetch(SERVICE+'/reporting/launch',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({activity:'conga-party'})});return (await x.json()).url;};
 const browser=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
 const ctx=await browser.newContext({...devices['iPad (gen 7)'],deviceScaleFactor:1});
 const calls={inst:0,other:[]};let block=false;
 await ctx.route(/^https?:\/\//,async rt=>{const u=new URL(rt.request().url());
  if(u.origin==='https://ritnome.com'){const f=path.join(site,u.pathname.slice(1)||'index.html');return fs.existsSync(f)?rt.fulfill({path:f}):rt.fulfill({status:404,body:''});}
  if(u.origin==='https://institutional.ritnome.com'){if(u.pathname==='/ritnome-institutional.js')return rt.fulfill({path:path.join(__dirname,'ritnome-institutional.js'),contentType:'application/javascript'});
   if(block&&u.pathname==='/reporting/report'){calls.blocked=(calls.blocked||0)+1;return rt.abort('internetdisconnected');}
   calls.inst++;const resp=await rt.fetch({url:SERVICE+u.pathname+u.search});return rt.fulfill({response:resp});}
  calls.other.push(u.href);return rt.abort();});
 const errs=[];
 // A) no launch code: nothing institutional happens
 let p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));await p.goto('https://ritnome.com/conga-party.html');await p.waitForTimeout(800);
 ok('no launch code: mode none, no banner, no overlay',await p.evaluate(()=>window.RitnomeInstitutional.mode==='none'&&!document.querySelector('.ri-banner')&&!document.querySelector('.ri-overlay')));
 await p.click('#drums button >> nth=0');await p.waitForTimeout(300);
 ok('no launch code: zero calls to the institutional service',calls.inst===0);
 await p.close();
 // B) launch code: exchange, headcount, start, taps, checkpoint, end
 // The script is served with its service origin pointed at the local test service.
 const u1=await launch();const code=u1.split('#rl=')[1];
 p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));
 await p.goto('https://ritnome.com/conga-party.html#rl='+code);await p.waitForTimeout(1200);
 ok('launch code removed from the URL immediately',await p.evaluate(()=>location.hash===''));
 ok('institutional mode decided before play: headcount overlay shown',await p.evaluate(()=>!!document.querySelector('.ri-overlay .ri-num')&&window.RitnomeInstitutional.mode==='pending'));
 await p.click('.ri-overlay button[data-d="1"]');await p.click('.ri-overlay button[data-d="1"]');await p.click('.ri-overlay .ri-go');await p.waitForTimeout(800);
 ok('run started with headcount 8 and banner shown',await p.evaluate(()=>window.RitnomeInstitutional.mode==='active'&&window.RitnomeInstitutional.headcount===8&&!!document.querySelector('.ri-banner')));
 for(let i=0;i<10;i++){await p.click('#drums button >> nth='+(i%3));}await p.waitForTimeout(900);
 let row=(await db.query(`SELECT headcount,participations,interactions,status,last_seq FROM public.ritnome_activity_run WHERE facility_id='facaaaaa-0000-0000-0000-00000000000a' ORDER BY started_at DESC LIMIT 1`)).rows[0];
 ok('server has the run: headcount 8, participations 8, 10 interactions after the checkpoint',row&&row.headcount===8&&row.participations===8&&row.interactions===10&&row.status==='open');
 // network interruption: reports queue in memory and flush in order when the connection returns
 block=true;for(let i=0;i<10;i++){await p.click('#drums button >> nth='+(i%3));}await p.waitForTimeout(600);
 ok('offline: report attempted and failed, nothing lost',calls.blocked>=1&&(await db.query(`SELECT interactions FROM public.ritnome_activity_run WHERE facility_id='facaaaaa-0000-0000-0000-00000000000a' ORDER BY started_at DESC LIMIT 1`)).rows[0].interactions===10);
 block=false;await p.waitForTimeout(4500);
 row=(await db.query(`SELECT interactions,last_seq FROM public.ritnome_activity_run WHERE facility_id='facaaaaa-0000-0000-0000-00000000000a' ORDER BY started_at DESC LIMIT 1`)).rows[0];
 ok('back online: queued checkpoint delivered in order (20 interactions, seq 3)',row.interactions===20&&row.last_seq===3);
 await p.click('.ri-banner button');await p.waitForTimeout(900);
 row=(await db.query(`SELECT status,ended_at,interactions FROM public.ritnome_activity_run WHERE facility_id='facaaaaa-0000-0000-0000-00000000000a' ORDER BY started_at DESC LIMIT 1`)).rows[0];
 ok('finish closes the run on the server',row.status==='closed'&&row.ended_at!==null);
 ok('page shows finished state and refuses further reports',await p.evaluate(()=>window.RitnomeInstitutional.mode==='finished'&&window.RitnomeInstitutional.checkpoint({})===false));
 // C) replayed / stale code → session ended screen, no athlete fallback, no reports
 const before=calls.inst;await p.goto('about:blank');await p.goto('https://ritnome.com/conga-party.html#rl='+code);await p.waitForTimeout(1200);
 ok('replayed code: "session ended" screen, mode ended, game not started',await p.evaluate(()=>window.RitnomeInstitutional.mode==='ended'&&/Sesión finalizada/.test(document.querySelector('.ri-overlay').textContent)));
 ok('replayed code: only the exchange call went out',calls.inst-before===1);
 ok('no requests to any other host at any point',calls.other.length===0);
 ok('no page errors',errs.length===0);
 await browser.close();server.close();await db.end();console.log('PASS '+pass);
})().catch(e=>{console.error('✘ '+e.message);process.exit(1);});

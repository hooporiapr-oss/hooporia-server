'use strict';
// Institutional reporting service (Phase 1). Facility and user always come from the server-side session; never from the request.
// Facilitator session: HttpOnly cookie on institutional.ritnome.com. Activity token: bearer held in memory by the game page only.
const crypto=require('node:crypto');
const catalog=require('./ritnome-activity-catalog');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Participant handle label: pseudonymous, derived from the id, same everywhere (desk and station).
const label=id=>String(id).replace(/-/g,'').slice(0,6).toUpperCase();
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const rnd=()=>crypto.randomBytes(32).toString('base64url');
const COOKIE='ritnome_fs';
function parseCookies(h){const out={};for(const part of String(h||'').split(';')){const i=part.indexOf('=');if(i>0)out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());}return out;}
function createReporting({base,auth,priceId,livemode,secureCookies=true,now=()=>Date.now(),log=console}){
 if(livemode!==true||typeof base?.rpc!=='function'||typeof auth?.getUser!=='function'||!/^price_[A-Za-z0-9_]+$/.test(priceId||''))throw Error('Invalid reporting configuration');
 const fail=(status,message)=>Object.assign(Error(message),{status});
 async function rpc(name,params){const r=await base.rpc(name,params);if(r.error)throw fail(503,'unavailable');return r.data;}
 // Verify a Supabase Auth bearer and return {id, session}; same checks as the enrollment code.
 async function verifyUser(header){
  if(typeof header!=='string'||header.length>8192||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(header))throw fail(401,'sign_in');
  const token=header.slice(7),r=await auth.getUser(token);
  if(r.error){if([400,401,403].includes(r.error.status))throw fail(401,'sign_in');throw fail(503,'unavailable');}
  const user=r.data?.user;let c;try{c=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));}catch{throw fail(401,'sign_in');}
  if(!user||!uuid.test(user.id)||user.role!=='authenticated'||user.is_anonymous||c.sub!==user.id||c.role!=='authenticated'||!uuid.test(c.session_id||'')||!Number.isFinite(c.exp)||c.exp<=now()/1000)throw fail(401,'sign_in');
  return {id:user.id,session:c.session_id};
 }
 const sessionOf=req=>{const id=parseCookies(req.headers?.cookie)[COOKIE];return uuid.test(id||'')?id:null;};
 const setCookie=(res,id,maxAge)=>res.set('Set-Cookie',`${COOKIE}=${id}; Path=/reporting; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookies?'; Secure':''}`);
 const noStore=res=>{res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');res.set('X-Content-Type-Options','nosniff');};
 const originOf=req=>{const o=req.headers?.origin;return typeof o==='string'&&catalog.origins.includes(o)?o:null;};
 const cors=(req,res)=>{const o=originOf(req);if(o){res.set('Access-Control-Allow-Origin',o);res.set('Vary','Origin');res.set('Access-Control-Allow-Headers','Authorization, Content-Type');res.set('Access-Control-Allow-Methods','POST, OPTIONS');res.set('Access-Control-Max-Age','600');}return o;};
 const wrap=fn=>async(req,res)=>{noStore(res);try{await fn(req,res);}catch(e){const s=e.status||503;if(s>=500)log.error('reporting: '+(e.message||'error'));res.status(s).json({ok:false,reason:s===503?'unavailable':e.message});}};
 async function requireSession(req,touch=true){
  const id=sessionOf(req);if(!id)throw fail(401,'sign_in');
  const rows=await rpc('ritnome_rep_session_check',{p_session:id,p_price:priceId,p_touch:touch});const c=Array.isArray(rows)?rows[0]:rows;
  if(!c||c.ok!==true)throw fail(c&&c.reason==='locked'?423:401,c?c.reason:'sign_in');
  return {id,...c};
 }
 const h={};
 // Facilitator session lifecycle
 h.sessionOpen=wrap(async(req,res)=>{
  const u=await verifyUser(req.headers?.authorization);
  const rows=await rpc('ritnome_rep_session_open',{p_mode:true,p_user:u.id,p_auth_session:u.session,p_price:priceId});const s=Array.isArray(rows)?rows[0]:rows;
  if(!s||!uuid.test(s.session_id||''))throw fail(403,'not_authorized');
  const maxAge=Math.max(60,Math.floor((new Date(s.expires_at).getTime()-now())/1000));
  setCookie(res,s.session_id,maxAge);
  res.status(200).json({ok:true,role:s.role,expires_at:s.expires_at,handles_enabled:s.handles_enabled===true,inactivity_minutes:30});
 });
 h.sessionUnlock=wrap(async(req,res)=>{
  const id=sessionOf(req);if(!id)throw fail(401,'sign_in');
  const u=await verifyUser(req.headers?.authorization);
  const ok=await rpc('ritnome_rep_session_unlock',{p_session:id,p_user:u.id,p_auth_session:u.session,p_price:priceId});
  if(ok!==true)throw fail(401,'sign_in');
  res.status(200).json({ok:true});
 });
 h.sessionEnd=wrap(async(req,res)=>{const id=sessionOf(req);if(id)await rpc('ritnome_rep_session_end',{p_session:id});setCookie(res,'',0);res.status(200).json({ok:true});});
 h.me=wrap(async(req,res)=>{const c=await requireSession(req,false);const cur=await rpc('ritnome_rep_recsession_current',{p_session:c.id,p_price:priceId});res.status(200).json({ok:true,role:c.role,handles_enabled:c.handles_enabled===true,current:cur||null});});
 // Facilitated recreation session (Today's Session): parent of the activity runs that follow. No data entry beyond the chosen length.
 h.recStart=wrap(async(req,res)=>{const c=await requireSession(req,true);const pm=Number(req.body?.planned_minutes);const id=await rpc('ritnome_rep_recsession_start',{p_session:c.id,p_price:priceId,p_planned_minutes:Number.isInteger(pm)&&pm>0&&pm<=240?pm:null,p_source:'plan'});if(!uuid.test(id||''))throw fail(403,'sign_in');res.status(200).json({ok:true,id});});
 h.recEnd=wrap(async(req,res)=>{const c=await requireSession(req,true);const ok=await rpc('ritnome_rep_recsession_end',{p_session:c.id,p_price:priceId});if(ok!==true)throw fail(403,'sign_in');res.status(200).json({ok:true});});
 // Library and launch
 h.library=wrap(async(req,res)=>{const c=await requireSession(req,false);
  res.status(200).json({ok:true,role:c.role,categories:catalog.categories,activities:catalog.activities.filter(a=>a.available).map(({key,es,en,category,mode,seated,minutes,flagship})=>({key,es,en,category,mode,seated,minutes,flagship:!!flagship}))});});
 h.launch=wrap(async(req,res)=>{
  const c=await requireSession(req,true);
  const a=catalog.byKey.get(String(req.body?.activity||''));
  if(!a||!a.available)throw fail(404,'activity_unavailable');
  const code=rnd();
  const rs=String(req.body?.recreation_session||'');
  const ok=await rpc('ritnome_rep_launch_create',{p_session:c.id,p_price:priceId,p_activity:a.key,p_origin:a.origin,p_code_hash:sha(code),p_recsession:uuid.test(rs)?rs:null});
  if(ok!==true)throw fail(401,'sign_in');
  // The code travels in the URL fragment only (never sent to any server, stripped by the game script on load), lives 60 s, single use.
  res.status(200).json({ok:true,url:a.origin+a.path+'#rl='+code,expires_in:60});
 });
 h.preflight=(req,res)=>{noStore(res);if(!cors(req,res))return res.status(403).end();res.status(204).end();};
 h.exchange=wrap(async(req,res)=>{
  const origin=cors(req,res);if(!origin)throw fail(403,'origin');
  const code=String(req.body?.code||'');if(!/^[A-Za-z0-9_-]{40,48}$/.test(code))throw fail(400,'invalid');
  const token=rnd();
  const rows=await rpc('ritnome_rep_launch_exchange',{p_code_hash:sha(code),p_origin:origin,p_token_hash:sha(token),p_price:priceId});const x=Array.isArray(rows)?rows[0]:rows;
  if(!x||x.ok!==true)throw fail(401,x?x.reason:'invalid');
  let handles=[];
  if(x.handles_enabled===true){const hs=await rpc('ritnome_rep_token_handles',{p_token_hash:sha(token),p_origin:origin,p_price:priceId});handles=(Array.isArray(hs)?hs:[]).map(h=>({id:h.handle_id,label:label(h.handle_id)}));}
  res.status(200).json({ok:true,token,activity:x.activity_key,expires_at:x.expires_at,handles_enabled:x.handles_enabled===true,language:x.language,handles});
 });
 h.report=wrap(async(req,res)=>{
  const origin=cors(req,res);if(!origin)throw fail(403,'origin');
  const hdr=req.headers?.authorization;if(typeof hdr!=='string'||!/^Bearer [A-Za-z0-9_-]{40,48}$/.test(hdr))throw fail(401,'token');
  const b=req.body||{};const run=String(b.run||''),seq=Number(b.seq),kind=String(b.kind||''),payload=b.payload;
  if(!uuid.test(run)||!Number.isInteger(seq)||seq<1||seq>100000||!['start','checkpoint','end','progress'].includes(kind)||!payload||typeof payload!=='object'||Array.isArray(payload)||JSON.stringify(payload).length>3000)throw fail(400,'invalid');
  const rows=await rpc('ritnome_rep_report',{p_token_hash:sha(hdr.slice(7)),p_origin:origin,p_price:priceId,p_run:run,p_seq:seq,p_kind:kind,p_payload:payload});const r=Array.isArray(rows)?rows[0]:rows;
  if(!r)throw fail(503,'unavailable');
  const status=r.outcome==='denied'?401:['accepted','duplicate'].includes(r.outcome)?200:409;
  res.status(status).json({ok:status===200,outcome:r.outcome,high_seq:r.high_seq});
 });
 // Reports
 h.facilitator=wrap(async(req,res)=>{const c=await requireSession(req,true);res.status(200).json(await rpc('ritnome_rep_facilitator_view',{p_session:c.id,p_price:priceId}));});
 // Executive report data: month (YYYY-MM) or quarter (YYYY-Qn). Management-only utilization is computed here from the subscription price and labeled as such.
 h.executive=wrap(async(req,res)=>{
  const c=await requireSession(req,true);
  const q=String(req.query?.period||'');let from,to;
  let m=/^(\d{4})-(0[1-9]|1[0-2])$/.exec(q),qq=/^(\d{4})-Q([1-4])$/.exec(q);
  if(m){from=`${m[1]}-${m[2]}-01`;const d=new Date(Date.UTC(+m[1],+m[2],1));to=d.toISOString().slice(0,10);}
  else if(qq){const mm=(qq[2]-1)*3+1;from=`${qq[1]}-${String(mm).padStart(2,'0')}-01`;const d=new Date(Date.UTC(+qq[1],mm+2,1));to=d.toISOString().slice(0,10);}
  else if(q==='trial'){const w=await rpc('ritnome_rep_trial_window',{p_session:c.id,p_price:priceId});if(!w||w.ok!==true)throw fail(w&&w.reason==='role'?403:400,w?w.reason:'invalid');from=w.from;to=w.to_excl;var trial=w;}
  else throw fail(400,'invalid');
  const d=await rpc('ritnome_rep_executive',{p_session:c.id,p_price:priceId,p_from:from,p_to_excl:to});
  if(!d||d.ok!==true)throw fail(d&&d.reason==='role'?403:400,d?d.reason:'invalid');
  const cats={};for(const a of catalog.activities)cats[a.key]={es:a.es,en:a.en,category:a.category};
  const months=qq?3:1;const s=d.summary;
  d.available_activities=catalog.activities.filter(a=>a.available).length;
  d.period=q;d.period_kind=trial?'trial':qq?'quarter':'month';if(trial)d.trial={trialing:trial.trialing===true,trial_end:trial.trial_end,days_left:trial.days_left,from:trial.from,to:trial.to_excl};d.catalog=cats;d.categories=catalog.categories;
  // Subscription utilization: subscription-only figures (not program cost, not savings). Management-only; the page excludes them from print by default.
  d.utilization={subscription_usd:149*months,months,per_session:s.sessions>0?Math.round(149*months/s.sessions*100)/100:null,per_participation:s.participations>0?Math.round(149*months/s.participations*100)/100:null,per_recreation_hour:Number(s.recreation_minutes)>0?Math.round(149*months/(Number(s.recreation_minutes)/60)*100)/100:null,note:'subscription_only'};
  res.status(200).json(d);
 });
 // Recreation Program Record: chronological documentation for a date range (any facility role; facility scoped by the session).
 h.record=wrap(async(req,res)=>{
  const c=await requireSession(req,true);
  const from=String(req.query?.from||''),to=String(req.query?.to||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))throw fail(400,'invalid');
  const toExcl=new Date(Date.UTC(+to.slice(0,4),+to.slice(5,7)-1,+to.slice(8,10)+1)).toISOString().slice(0,10);
  const d=await rpc('ritnome_rep_record',{p_session:c.id,p_price:priceId,p_from:from,p_to_excl:toExcl});
  if(!d||d.ok!==true)throw fail(400,d?d.reason:'invalid');
  const cats={};for(const a of catalog.activities)cats[a.key]={es:a.es,en:a.en,category:a.category};
  d.catalog=cats;d.categories=catalog.categories;res.status(200).json(d);
 });
 h.management=wrap(async(req,res)=>{const c=await requireSession(req,true);const m=String(req.query?.month||'');if(m&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(m))throw fail(400,'invalid');
  const d=await rpc('ritnome_rep_management',{p_session:c.id,p_price:priceId,p_month:m?m+'-01':null});if(d?.ok!==true)throw fail(d?.reason==='role'?403:401,d?.reason||'sign_in');res.status(200).json(d);});
 h.plan=wrap(async(req,res)=>{const c=await requireSession(req,true);const b=req.body||{};
  const spw=b.sessions_per_week==null?null:Number(b.sessions_per_week);const he=b.handles_enabled==null?null:b.handles_enabled===true;
  if(spw!=null&&(!Number.isInteger(spw)||spw<0||spw>50))throw fail(400,'invalid');
  const ok=await rpc('ritnome_rep_set_plan',{p_session:c.id,p_price:priceId,p_sessions_per_week:spw,p_handles_enabled:he});if(ok!==true)throw fail(403,'role');res.status(200).json({ok:true});});
 h.handles=wrap(async(req,res)=>{const c=await requireSession(req,false);const rows=await rpc('ritnome_rep_handles',{p_session:c.id,p_price:priceId})||[];res.status(200).json({ok:true,handles:rows.map(r=>({...r,label:label(r.handle_id)}))});});
 h.handleCreate=wrap(async(req,res)=>{const c=await requireSession(req,true);const id=await rpc('ritnome_rep_handle_create',{p_session:c.id,p_price:priceId});if(!uuid.test(id||''))throw fail(403,'handles_off');res.status(200).json({ok:true,handle_id:id});});
 h.handleRetire=wrap(async(req,res)=>{const c=await requireSession(req,true);const id=String(req.body?.handle_id||'');if(!uuid.test(id))throw fail(400,'invalid');const ok=await rpc('ritnome_rep_handle_retire',{p_session:c.id,p_price:priceId,p_handle:id});res.status(ok===true?200:404).json({ok:ok===true});});
 h.individual=wrap(async(req,res)=>{const c=await requireSession(req,true);const id=String(req.query?.handle||'');if(!uuid.test(id))throw fail(400,'invalid');const d=await rpc('ritnome_rep_individual',{p_session:c.id,p_price:priceId,p_handle:id});if(d?.ok!==true)throw fail(403,d?.reason||'handles_off');res.status(200).json(d);});
 // Staff (owner only): create or attach an account in the dedicated project and give it a role. A temporary password is shown once to the owner.
 h.staffList=wrap(async(req,res)=>{const c=await requireSession(req,false);if(!['owner','manager'].includes(c.role))throw fail(403,'role');res.status(200).json({ok:true,staff:await rpc('ritnome_rep_staff_list',{p_session:c.id,p_price:priceId})||[]});});
 h.staffAdd=wrap(async(req,res)=>{
  const c=await requireSession(req,true);if(c.role!=='owner')throw fail(403,'role');
  const email=String(req.body?.email||'').trim().toLowerCase(),role=String(req.body?.role||'facilitator');
  if(!/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email)||!['manager','facilitator'].includes(role))throw fail(400,'invalid');
  if(typeof auth.admin?.createUser!=='function')throw fail(503,'unavailable');
  let userId=null,temp=null;
  const pw=crypto.randomBytes(9).toString('base64url');
  const made=await auth.admin.createUser({email,password:pw,email_confirm:true});
  if(!made.error&&made.data?.user?.id){userId=made.data.user.id;temp=pw;}
  else{if(typeof auth.admin.generateLink!=='function')throw fail(503,'unavailable');const link=await auth.admin.generateLink({type:'magiclink',email});if(link.error||!link.data?.user?.id)throw fail(503,'unavailable');userId=link.data.user.id;}
  const r=await rpc('ritnome_rep_staff_add',{p_session:c.id,p_price:priceId,p_user:userId,p_role:role});
  if(r!=='ok')throw fail(r==='other_facility'?409:r==='denied'?403:400,r);
  res.status(200).json({ok:true,user_id:userId,role,temporary_password:temp});
 });
 h.staffActive=wrap(async(req,res)=>{const c=await requireSession(req,true);if(c.role!=='owner')throw fail(403,'role');const id=String(req.body?.user_id||'');if(!uuid.test(id)||typeof req.body?.active!=='boolean')throw fail(400,'invalid');
  const ok=await rpc('ritnome_rep_staff_set_active',{p_session:c.id,p_price:priceId,p_user:id,p_active:req.body.active});res.status(ok===true?200:404).json({ok:ok===true});});
 h.retention=async()=>{try{const r=await rpc('ritnome_rep_retention_purge',{});return Array.isArray(r)?r[0]:r;}catch(e){log.error('retention purge failed');return null;}};
 return h;
}
function mountReporting(app,express,reporting){
 const json=express.json({limit:'8kb'});
 app.post('/reporting/session',json,reporting.sessionOpen);
 app.post('/reporting/session/unlock',json,reporting.sessionUnlock);
 app.post('/reporting/session/end',json,reporting.sessionEnd);
 app.get('/reporting/me',reporting.me);
 app.get('/reporting/library',reporting.library);
 app.post('/reporting/launch',json,reporting.launch);
 app.post('/reporting/recreation-session',json,reporting.recStart);
 app.post('/reporting/recreation-session/end',json,reporting.recEnd);
 app.options('/reporting/exchange',reporting.preflight);
 app.options('/reporting/report',reporting.preflight);
 app.post('/reporting/exchange',json,reporting.exchange);
 app.post('/reporting/report',json,reporting.report);
 app.get('/reporting/facilitator',reporting.facilitator);
 app.get('/reporting/management',reporting.management);
 app.get('/reporting/executive',reporting.executive);
 app.get('/reporting/record',reporting.record);
 app.post('/reporting/plan',json,reporting.plan);
 app.get('/reporting/handles',reporting.handles);
 app.post('/reporting/handles',json,reporting.handleCreate);
 app.post('/reporting/handles/retire',json,reporting.handleRetire);
 app.get('/reporting/individual',reporting.individual);
 app.get('/reporting/staff',reporting.staffList);
 app.post('/reporting/staff',json,reporting.staffAdd);
 app.post('/reporting/staff/active',json,reporting.staffActive);
}
module.exports={createReporting,mountReporting,COOKIE};

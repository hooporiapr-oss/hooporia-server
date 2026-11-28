'use strict';
// Isolated composition. Does not mount on the legacy server or open a listener.
// Dedicated live process; not mounted on the existing legacy server.
const {createWebhook}=require('./ritnome-stripe-webhook');
const {createInbox}=require('./ritnome-stripe-inbox');
const {createStripeSource}=require('./ritnome-stripe-source');
const {createWorker}=require('./ritnome-worker');
const {createPendingReader}=require('./ritnome-pending-reader');
const {createPoller}=require('./ritnome-poller');
const {createAtomicInstitutionGate}=require('./ritnome-atomic-institution-gate');
const {createEnrollment}=require('./ritnome-live-enrollment');
const {createActivityDesk}=require('./ritnome-activity-desk');
const {createReporting,mountReporting}=require('./ritnome-reporting');
const path=require('node:path');
function createLiveRuntime({express,stripe,base,auth,secret,priceId,portalConfig,supabaseUrl,publishableKey,livemode,enabled,log=console,pollerOptions={}}){
 if(enabled!==true||livemode!==true)throw Error('Only explicitly enabled live runtime is supported');
 if(typeof express!=='function'||typeof express.raw!=='function'||!stripe?.webhooks||typeof base?.rpc!=='function')throw Error('Missing isolated runtime dependencies');
 if(!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(supabaseUrl||'')||/sdaphocueugzfvjovuxd|ogmpndblmcmpqzjoxnfu/.test(supabaseUrl)||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey||''))throw Error('Dedicated public Auth configuration required');
 const inbox=createInbox(base);
 const source=createStripeSource({stripe,priceId,livemode:true});
 const worker=createWorker({base,source,priceId,livemode:true});
 const listPending=createPendingReader({base,livemode:true});
 const poller=createPoller({...pollerOptions,listPending,worker,log:message=>log.error(message)});
 const app=express();
 app.disable('x-powered-by');
 // Raw bytes must be received before any JSON parser.
 app.post('/ritnome/stripe/webhook',express.raw({type:'application/json',limit:'256kb'}),createWebhook({stripe,secret,priceId,livemode:true,inbox,log}));
 app.get('/ritnome-institutional.js',(_req,res)=>{res.set('Cache-Control','public, max-age=300');res.set('X-Content-Type-Options','nosniff');res.type('application/javascript');res.sendFile(path.join(__dirname,'ritnome-institutional.js'));});
 app.get('/healthz',(_req,res)=>res.status(200).json({service:'ritnome-institutional',running:poller.isRunning()}));
 // Verify every request against the live registry, membership and session.
 let reporting=null;
 if(auth){const gate=createAtomicInstitutionGate({auth,base,priceId,livemode:true});app.get('/access-check',gate.handler);app.get('/activity-desk',createActivityDesk(gate));
  reporting=createReporting({base,auth,priceId,livemode:true,log});mountReporting(app,express,reporting);}
 if(auth&&portalConfig){
  const enrollment=createEnrollment({stripe,base,auth,priceId,portalConfig,livemode:true,returnUrl:'https://institutional.ritnome.com/enroll'});
  const pageHeaders=res=>{res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');res.set('X-Content-Type-Options','nosniff');res.set('X-Robots-Tag','noindex, nofollow');res.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' "+supabaseUrl+"; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");};
  app.get('/enroll-config',(_req,res)=>{res.set('Cache-Control','no-store');res.json({url:supabaseUrl,publicKey:publishableKey});});
  app.get('/enroll',(_req,res)=>{pageHeaders(res);res.sendFile(path.join(__dirname,'ritnome-live-enroll.html'));});
  app.get('/enroll.js',(_req,res)=>{pageHeaders(res);res.sendFile(path.join(__dirname,'ritnome-live-enroll.js'));});
  app.get('/desk',(_req,res)=>{pageHeaders(res);res.sendFile(path.join(__dirname,'ritnome-desk.html'));});
  app.get('/report',(_req,res)=>{pageHeaders(res);res.sendFile(path.join(__dirname,'ritnome-report.html'));});
  app.get('/logo.png',(_req,res)=>{res.set('Cache-Control','public, max-age=86400');res.type('image/png');res.sendFile(path.join(__dirname,'ritnome-logo.png'));});
  app.get('/record',(_req,res)=>{pageHeaders(res);res.sendFile(path.join(__dirname,'ritnome-record.html'));});
  app.get('/record.js',(_req,res)=>{res.set('Cache-Control','no-store');res.type('application/javascript');res.sendFile(path.join(__dirname,'ritnome-record.js'));});
  app.get('/journey',(_req,res)=>{pageHeaders(res);res.sendFile(path.join(__dirname,'ritnome-journey.html'));});
  app.get('/journey.js',(_req,res)=>{res.set('Cache-Control','no-store');res.type('application/javascript');res.sendFile(path.join(__dirname,'ritnome-journey.js'));});
  app.get('/report.js',(_req,res)=>{res.set('Cache-Control','no-store');res.type('application/javascript');res.sendFile(path.join(__dirname,'ritnome-report.js'));});
  app.get('/desk.js',(_req,res)=>{pageHeaders(res);res.sendFile(path.join(__dirname,'ritnome-desk.js'));});
  app.get('/enrollment/status',enrollment.handler('status'));
  app.post('/enrollment/start',enrollment.handler('start'));
  app.post('/enrollment/portal',enrollment.handler('portal'));
 }
 app.use((_req,res)=>res.status(404).json({error:'not_found'}));
 let retentionTimer=null;
 const startRetention=()=>{if(!reporting||retentionTimer)return;const tick=async()=>{const r=await reporting.retention();if(r)log.error('retention purge: '+JSON.stringify(r));};retentionTimer=setInterval(tick,24*3600*1000);if(typeof retentionTimer.unref==='function')retentionTimer.unref();};
 const stopRetention=()=>{if(retentionTimer){clearInterval(retentionTimer);retentionTimer=null;}};
 return {app,start:()=>{startRetention();return poller.start();},stop:()=>{stopRetention();return poller.stop();},isRunning:()=>poller.isRunning()};
}
module.exports={createLiveRuntime};

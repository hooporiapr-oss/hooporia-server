'use strict';
// Isolated composition. Does not mount on the legacy server or open a listener.
// Only sandbox operation is supported at this stage. No live access gate.
const {createWebhook}=require('./ritnome-stripe-webhook');
const {createInbox}=require('./ritnome-stripe-inbox');
const {createStripeSource}=require('./ritnome-stripe-source');
const {createWorker}=require('./ritnome-worker');
const {createPendingReader}=require('./ritnome-pending-reader');
const {createPoller}=require('./ritnome-poller');
const {createAtomicInstitutionGate}=require('./ritnome-atomic-institution-gate');
const {createEnrollment}=require('./ritnome-enrollment');
const {createActivityDesk}=require('./ritnome-activity-desk');
const path=require('node:path');
function createRuntime({express,stripe,base,auth,secret,priceId,portalConfig,livemode,enabled,log=console,pollerOptions={}}){
 if(enabled!==true||livemode!==false)throw Error('Only explicitly enabled sandbox runtime is supported');
 if(typeof express!=='function'||typeof express.raw!=='function'||!stripe?.webhooks||typeof base?.rpc!=='function')throw Error('Missing isolated runtime dependencies');
 const inbox=createInbox(base);
 const source=createStripeSource({stripe,priceId,livemode:false});
 const worker=createWorker({base,source,priceId,livemode:false});
 const listPending=createPendingReader({base,livemode:false});
 const poller=createPoller({...pollerOptions,listPending,worker,log:message=>log.error(message)});
 const app=express();
 app.disable('x-powered-by');
 // Raw bytes must be received before any JSON parser.
 app.post('/ritnome/stripe/webhook',express.raw({type:'application/json',limit:'256kb'}),createWebhook({stripe,secret,priceId,livemode:false,inbox,log}));
 app.get('/healthz',(_req,res)=>res.status(200).json({service:'ritnome-sandbox',running:poller.isRunning()}));
 // Sandbox check returns only a test authorization boolean. Never grants real content.
 if(auth){const gate=createAtomicInstitutionGate({auth,base,priceId,livemode:false});app.get('/ritnome/sandbox/access-check',gate.handler);app.get('/ritnome/sandbox/activity-desk',createActivityDesk(gate));}
 if(auth&&portalConfig){
  const enrollment=createEnrollment({stripe,base,auth,priceId,portalConfig,livemode:false,returnUrl:'https://ritnome-sandbox-api.onrender.com/ritnome/sandbox/enroll'});
  const pageHeaders=res=>{res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');res.set('X-Content-Type-Options','nosniff');res.set('X-Robots-Tag','noindex, nofollow');res.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' https://ogmpndblmcmpqzjoxnfu.supabase.co; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");};
  app.get('/ritnome/sandbox/enroll',(_req,res)=>{pageHeaders(res);res.sendFile(path.join(__dirname,'ritnome-enroll.html'));});
  app.get('/ritnome/sandbox/enroll.js',(_req,res)=>{pageHeaders(res);res.sendFile(path.join(__dirname,'ritnome-enroll.js'));});
  app.get('/ritnome/sandbox/enrollment/status',enrollment.handler('status'));
  app.post('/ritnome/sandbox/enrollment/start',enrollment.handler('start'));
  app.post('/ritnome/sandbox/enrollment/portal',enrollment.handler('portal'));
 }
 app.use((_req,res)=>res.status(404).json({error:'not_found'}));
 return {app,start:()=>poller.start(),stop:()=>poller.stop(),isRunning:()=>poller.isRunning()};
}
module.exports={createRuntime};

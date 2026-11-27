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
const path=require('node:path');
function createLiveRuntime({express,stripe,base,auth,secret,priceId,portalConfig,livemode,enabled,log=console,pollerOptions={}}){
 if(enabled!==true||livemode!==true)throw Error('Only explicitly enabled live runtime is supported');
 if(typeof express!=='function'||typeof express.raw!=='function'||!stripe?.webhooks||typeof base?.rpc!=='function')throw Error('Missing isolated runtime dependencies');
 const inbox=createInbox(base);
 const source=createStripeSource({stripe,priceId,livemode:true});
 const worker=createWorker({base,source,priceId,livemode:true});
 const listPending=createPendingReader({base,livemode:true});
 const poller=createPoller({...pollerOptions,listPending,worker,log:message=>log.error(message)});
 const app=express();
 app.disable('x-powered-by');
 // Raw bytes must be received before any JSON parser.
 app.post('/ritnome/stripe/webhook',express.raw({type:'application/json',limit:'256kb'}),createWebhook({stripe,secret,priceId,livemode:true,inbox,log}));
 app.get('/healthz',(_req,res)=>res.status(200).json({service:'ritnome-institutional',running:poller.isRunning()}));
 // Verify every request against the live registry, membership and session.
 if(auth){const gate=createAtomicInstitutionGate({auth,base,priceId,livemode:true});app.get('/access-check',gate.handler);app.get('/activity-desk',createActivityDesk(gate));}
 if(auth&&portalConfig){
  const enrollment=createEnrollment({stripe,base,auth,priceId,portalConfig,livemode:true,returnUrl:'https://institutional.ritnome.com/enroll'});
  const pageHeaders=res=>{res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');res.set('X-Content-Type-Options','nosniff');res.set('X-Robots-Tag','noindex, nofollow');res.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' https://sdaphocueugzfvjovuxd.supabase.co; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");};
  app.get('/enroll',(_req,res)=>{pageHeaders(res);res.sendFile(path.join(__dirname,'ritnome-live-enroll.html'));});
  app.get('/enroll.js',(_req,res)=>{pageHeaders(res);res.sendFile(path.join(__dirname,'ritnome-live-enroll.js'));});
  app.get('/enrollment/status',enrollment.handler('status'));
  app.post('/enrollment/start',enrollment.handler('start'));
  app.post('/enrollment/portal',enrollment.handler('portal'));
 }
 app.use((_req,res)=>res.status(404).json({error:'not_found'}));
 return {app,start:()=>poller.start(),stop:()=>poller.stop(),isRunning:()=>poller.isRunning()};
}
module.exports={createLiveRuntime};

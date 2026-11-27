'use strict';
// Isolated composition. Does not mount on the legacy server or open a listener.
// Only sandbox operation is supported at this stage. No live access gate.
const {createWebhook}=require('./ritnome-stripe-webhook');
const {createInbox}=require('./ritnome-stripe-inbox');
const {createStripeSource}=require('./ritnome-stripe-source');
const {createWorker}=require('./ritnome-worker');
const {createPendingReader}=require('./ritnome-pending-reader');
const {createPoller}=require('./ritnome-poller');
function createRuntime({express,stripe,base,secret,priceId,livemode,enabled,log=console,pollerOptions={}}){
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
 // No customer access endpoint in this runtime: sandbox registry cannot bind live licenses.
 app.use((_req,res)=>res.status(404).json({error:'not_found'}));
 return {app,start:()=>poller.start(),stop:()=>poller.stop(),isRunning:()=>poller.isRunning()};
}
module.exports={createRuntime};

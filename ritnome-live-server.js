'use strict';
// Dedicated live candidate. Never starts the legacy server or uses sandbox environment variables.
const express=require('express');
const Stripe=require('stripe');
const {createClient}=require('@supabase/supabase-js');
const {createLiveRuntime}=require('./ritnome-live-runtime');
const required=name=>{const v=process.env[name];if(!v)throw Error('Missing '+name);return v;};
async function main(){
 const port=Number(process.env.PORT||10000);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');
 if(process.env.RITNOME_LIVE_ENABLED!=='true'){
  const app=express();app.disable('x-powered-by');
  app.get('/healthz',(_req,res)=>res.status(200).json({service:'ritnome-institutional',mode:'setup',running:false}));
  app.use((_req,res)=>res.status(503).json({error:'institutional_not_enabled'}));
  app.listen(port,'0.0.0.0',()=>console.log('Ritnome institutional setup only'));
  return;
 }
 const url=required('RITNOME_LIVE_SUPABASE_URL');
 if(url!=='https://sdaphocueugzfvjovuxd.supabase.co')throw Error('Unexpected live database');
 const key=required('RITNOME_LIVE_STRIPE_KEY');
 if(!/^(sk|rk)_live_/.test(key))throw Error('Live Stripe credential required');
 const priceId=required('RITNOME_LIVE_PRICE_ID');
 if(priceId!=='price_1UgP8ZCuedlcmwMmeEZr9ev2')throw Error('Unexpected live price ID');
 const secret=required('RITNOME_LIVE_WEBHOOK_SECRET');
 if(!/^whsec_[A-Za-z0-9]+$/.test(secret))throw Error('Invalid signing secret');
 const stripe=new Stripe(key,{apiVersion:'2024-06-20',timeout:10000,maxNetworkRetries:1});
 const serviceKey=required('RITNOME_LIVE_SUPABASE_SERVICE_KEY');
 const client=()=>createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const base=client(),auth=client().auth;
 const price=await stripe.prices.retrieve(priceId);
 if(price.id!==priceId||price.livemode!==true||price.active!==true||price.currency!=='usd'||price.unit_amount!==14900||price.recurring?.interval!=='month'||price.recurring?.interval_count!==1||price.tax_behavior!=='exclusive')throw Error('Unexpected live price');
 const portalConfig=required('RITNOME_LIVE_PORTAL_CONFIG'),portal=await stripe.billingPortal.configurations.retrieve(portalConfig);
 if(portal.id!==portalConfig||portal.livemode!==true||portal.active!==true||portal.features?.subscription_update?.enabled!==false||portal.features?.subscription_cancel?.mode!=='at_period_end'||portal.features?.payment_method_update?.enabled!==true||portal.features?.invoice_history?.enabled!==true)throw Error('Unexpected live portal');
 // Both new schema and legacy RLS release must be verified by the DB readiness RPC.
 const ready=await base.rpc('ritnome_live_release_ready');
 if(ready.error||ready.data!==true)throw Error('Database release not ready');
 const runtime=createLiveRuntime({express,stripe,base,auth,secret,priceId,portalConfig,livemode:true,enabled:true});
 const server=runtime.app.listen(port,'0.0.0.0',()=>{runtime.start();console.log('Ritnome institutional ready');});
 let stopping=false;
 async function shutdown(){if(stopping)return;stopping=true;const deadline=setTimeout(()=>process.exit(1),20000);deadline.unref();server.close();await runtime.stop();clearTimeout(deadline);process.exit(0);}
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
}
if(require.main===module)main().catch(()=>{console.error('Ritnome institutional startup blocked');process.exitCode=1;});
module.exports={main};

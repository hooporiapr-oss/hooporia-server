'use strict';
// Separate sandbox entry point. Never falls back to production environment variables.
const express=require('express');
const Stripe=require('stripe');
const {createClient}=require('@supabase/supabase-js');
const {createRuntime}=require('./ritnome-runtime');
const {recoverFixture}=require('./ritnome-sandbox-recovery');
const required=name=>{const v=process.env[name];if(!v)throw Error('Missing '+name);return v;};
let stage='startup';
async function main(){
 if(process.env.RITNOME_SANDBOX_ENABLED==='false'){
  const app=express();app.disable('x-powered-by');
  app.get('/healthz',(_req,res)=>res.status(200).json({service:'ritnome-sandbox',mode:'setup',running:false}));
  app.use((_req,res)=>res.status(503).json({error:'sandbox_not_enabled'}));
  const port=Number(process.env.PORT||10000);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');
  app.listen(port,'0.0.0.0',()=>console.log('Ritnome sandbox setup only'));
  return;
 }
 if(process.env.RITNOME_SANDBOX_ENABLED!=='true')throw Error('Sandbox not enabled');
 stage='sandbox database URL';
 const url=required('RITNOME_SANDBOX_SUPABASE_URL');
 if(url!=='https://ogmpndblmcmpqzjoxnfu.supabase.co')throw Error('Unexpected sandbox database');
 stage='Stripe test key format';
 const key=required('RITNOME_SANDBOX_STRIPE_KEY');
 if(!/^(sk|rk)_test_/.test(key))throw Error('Test Stripe credentials required');
 stage='sandbox price ID';
 const priceId=required('RITNOME_SANDBOX_PRICE_ID');
 stage='webhook signing secret format';
 const secret=required('RITNOME_SANDBOX_WEBHOOK_SECRET');
 if(!/^whsec_[A-Za-z0-9]+$/.test(secret))throw Error('Invalid webhook secret');
 stage='Stripe SDK initialization';
 const stripe=new Stripe(key,{apiVersion:'2024-06-20',timeout:10000,maxNetworkRetries:1});
 stage='Supabase client initialization';
 const base=createClient(url,required('RITNOME_SANDBOX_SUPABASE_SERVICE_KEY'),{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 stage='Stripe price retrieval';
 const price=await stripe.prices.retrieve(priceId);
 stage='Stripe price verification';
 if(price.livemode!==false||price.active!==true||price.currency!=='usd'||price.unit_amount!==14900||price.recurring?.interval!=='month'||price.recurring?.interval_count!==1||price.tax_behavior!=='exclusive')throw Error('Unexpected sandbox price');
 stage='sandbox database connectivity';
 const probe=await base.from('ritnome_subscription_registry').select('id').limit(1);
 if(probe.error)throw Error('Database probe failed');
 stage='runtime initialization';
 const runtime=createRuntime({express,stripe,base,secret,priceId,livemode:false,enabled:true});
 const port=Number(process.env.PORT||10000);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');
 stage='HTTP listener';
 const server=runtime.app.listen(port,'0.0.0.0',()=>{runtime.start();console.log('Ritnome sandbox ready');
 if(process.env.RITNOME_SANDBOX_RECOVERY==='true')recoverFixture({stripe,base,priceId,subscriptionId:process.env.RITNOME_SANDBOX_RECOVERY_SUBSCRIPTION,invoiceId:process.env.RITNOME_SANDBOX_RECOVERY_INVOICE}).then(result=>console.log('Ritnome sandbox recovery: '+result)).catch(()=>console.error('Ritnome sandbox recovery failed'));
 });
 let stopping=false;
 async function shutdown(){if(stopping)return;stopping=true;const deadline=setTimeout(()=>process.exit(1),20000);deadline.unref();server.close();await runtime.stop();clearTimeout(deadline);process.exit(0);}
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
}
if(require.main===module)main().catch(err=>{const status=Number.isInteger(err?.statusCode)?err.statusCode:null;console.error('Ritnome sandbox startup failed at: '+stage+(status?' (HTTP '+status+')':''));process.exitCode=1;});

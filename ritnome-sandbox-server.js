'use strict';
// Separate sandbox entry point. Never falls back to production environment variables.
const express=require('express');
const Stripe=require('stripe');
const {createClient}=require('@supabase/supabase-js');
const {createRuntime}=require('./ritnome-runtime');
const required=name=>{const v=process.env[name];if(!v)throw Error('Missing '+name);return v;};
async function main(){
 if(process.env.RITNOME_SANDBOX_ENABLED!=='true')throw Error('Sandbox not enabled');
 const url=required('RITNOME_SANDBOX_SUPABASE_URL');
 if(url!=='https://ogmpndblmcmpqzjoxnfu.supabase.co')throw Error('Unexpected sandbox database');
 const key=required('RITNOME_SANDBOX_STRIPE_KEY');
 if(!/^(sk|rk)_test_/.test(key))throw Error('Test Stripe credentials required');
 const priceId=required('RITNOME_SANDBOX_PRICE_ID');
 const secret=required('RITNOME_SANDBOX_WEBHOOK_SECRET');
 const stripe=new Stripe(key,{apiVersion:'2024-06-20',timeout:10000,maxNetworkRetries:1});
 const base=createClient(url,required('RITNOME_SANDBOX_SUPABASE_SERVICE_KEY'),{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const price=await stripe.prices.retrieve(priceId);
 if(price.livemode!==false||price.active!==true||price.currency!=='usd'||price.unit_amount!==14900||price.recurring?.interval!=='month'||price.recurring?.interval_count!==1||price.tax_behavior!=='exclusive')throw Error('Unexpected sandbox price');
 const runtime=createRuntime({express,stripe,base,secret,priceId,livemode:false,enabled:true});
 const port=Number(process.env.PORT||10000);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');
 const server=runtime.app.listen(port,'0.0.0.0',()=>{runtime.start();console.log('Ritnome sandbox ready')});
 let stopping=false;
 async function shutdown(){if(stopping)return;stopping=true;const deadline=setTimeout(()=>process.exit(1),20000);deadline.unref();server.close();await runtime.stop();clearTimeout(deadline);process.exit(0);}
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
}
if(require.main===module)main().catch(()=>{console.error('Ritnome sandbox startup failed; verify sandbox configuration');process.exitCode=1;});

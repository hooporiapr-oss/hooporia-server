'use strict';
const assert=require('node:assert/strict');
const {createRuntime}=require('./ritnome-runtime');
async function run(){
 const priceId='price_fixture',sub='sub_fixture',customer='cus_fixture',now=Math.floor(Date.now()/1000),end=now+2592000;
 const rows=new Map(),commits=[],routes={},timers=new Map();let seq=0;
 const b={id:'binding',livemode:false,stripe_subscription_id:sub,stripe_customer_id:customer,stripe_price_id:priceId,license_id:null,paid_through:null,revision:0};
 const base={from(table){const filters={};const q={select(){return q},eq(k,v){filters[k]=v;return q},is(){return q},order(){return q},or(){return q},async limit(){return {data:[...rows.values()].filter(e=>!e.processed_at&&e.livemode===filters.livemode),error:null}},async maybeSingle(){return {data:table==='ritnome_subscription_registry'?(filters.livemode===false&&filters.stripe_subscription_id===sub?b:null):rows.get(filters.stripe_event_id)||null,error:null}},async upsert(e){if(!rows.has(e.stripe_event_id))rows.set(e.stripe_event_id,{...e,received_at:new Date().toISOString(),processed_at:null});return {error:null}}};return q},async rpc(name,p){assert.equal(name,'ritnome_commit_decision');assert.equal(p.p_mode,false);assert.equal(p.p_revision,b.revision);commits.push(p);b.revision++;b.paid_through=p.p_paid_through;rows.get(p.p_event).processed_at=new Date().toISOString();return {data:'committed',error:null}}};
 const subscription={id:sub,livemode:false,customer,status:'active',latest_invoice:'in_fixture',items:{has_more:false,data:[{id:'si_fixture',price:priceId,quantity:1}]}};
 const invoice={id:'in_fixture',livemode:false,customer,subscription:sub,currency:'usd',status:'paid',billing_reason:'subscription_create',subtotal:14900,total:16614,amount_paid:16614,amount_due:16614,amount_remaining:0,automatic_tax:{enabled:true,status:'complete'},starting_balance:0,ending_balance:0,total_discount_amounts:[],pre_payment_credit_notes_amount:0,post_payment_credit_notes_amount:0,payment_intent:'pi_fixture',lines:{has_more:false,data:[{price:priceId,subscription_item:'si_fixture',quantity:1,proration:false,amount:14900,period:{start:now-60,end}}]}};
 const stripe={webhooks:{constructEvent(body,sig,secret){if(sig!=='valid'||secret!=='whsec_fixture')throw Error('signature');return body}},subscriptions:{retrieve:async()=>subscription},invoices:{retrieve:async()=>invoice},paymentIntents:{retrieve:async()=>({id:'pi_fixture',livemode:false,customer,currency:'usd',status:'succeeded',amount_received:16614,latest_charge:{livemode:false,payment_intent:'pi_fixture',customer,currency:'usd',status:'succeeded',paid:true,captured:true,amount_captured:16614,refunded:false,amount_refunded:0,disputed:false}})}};
 function express(){return {disable(k){assert.equal(k,'x-powered-by')},post(p,raw,handler){routes[p]={raw,handler}},get(p,handler){routes[p]={handler}},use(handler){routes.fallback={handler}}}}
 express.raw=options=>options;
 const config={express,stripe,base,secret:'whsec_fixture',priceId,livemode:false,enabled:true,log:{error(){}},pollerOptions:{setTimer:(fn,d)=>{timers.set(++seq,{fn,d});return seq},clearTimer:id=>timers.delete(id)}};
 for(const patch of [{enabled:false},{livemode:true},{livemode:undefined}])assert.throws(()=>createRuntime({...config,...patch}),/sandbox runtime/);
 const runtime=createRuntime(config);
 assert.equal(timers.size,0);
 assert.equal(routes['/ritnome/stripe/webhook'].raw.type,'application/json');
 assert.equal(routes['/ritnome/stripe/webhook'].raw.limit,'256kb');
 assert.equal(Object.keys(routes).length,3);
 const call=async(path,req={})=>{const result={};const res={status(n){result.status=n;return this},send(body){result.body=body;return this},json(body){result.body=body;return this}};await routes[path].handler(req,res);return result};
 assert.equal((await call('/healthz')).body.running,false);
 const event={id:'evt_fixture',livemode:false,type:'invoice.paid',created:now,data:{object:{subscription:sub}}};
 const deliver=(body,sig='valid')=>call('/ritnome/stripe/webhook',{body,headers:{'stripe-signature':sig}});
 assert.equal((await deliver(event,'invalid')).status,400);
 assert.equal((await deliver({...event,livemode:true})).status,400);
 assert.equal((await deliver({...event,account:'acct_fixture'})).status,400);
 assert.equal((await deliver({...event,type:'charge.succeeded'})).body,'Ignored');
 assert.equal((await deliver(event)).status,200);assert.equal((await deliver(event)).status,200);assert.equal(rows.size,1);assert.equal(commits.length,0);
 assert.equal(runtime.start(),true);assert.equal(runtime.start(),false);assert.equal((await call('/healthz')).body.running,true);
 const [id,t]=timers.entries().next().value;timers.delete(id);t.fn();for(let i=0;i<100;i++)await Promise.resolve();
 assert.equal(commits.length,1);assert.equal(commits[0].p_status,'active');assert.equal(commits[0].p_paid_through,new Date(end*1000).toISOString());assert.equal(b.revision,1);
 await runtime.stop();assert.equal(timers.size,0);assert.equal((await call('/healthz')).body.running,false);assert.equal((await call('fallback')).status,404);
 console.log('Integrated sandbox runtime assertions passed');
}
run().catch(e=>{console.error(e);process.exitCode=1;});

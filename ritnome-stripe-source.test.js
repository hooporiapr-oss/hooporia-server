'use strict';
const assert=require('node:assert/strict');
const {createStripeSource}=require('./ritnome-stripe-source');
async function run(){
 const b={livemode:false,stripe_price_id:'price_fixture',stripe_subscription_id:'sub_fixture',stripe_customer_id:'cus_fixture'};
 const fixture=()=>({s:{id:b.stripe_subscription_id,livemode:false,customer:b.stripe_customer_id,latest_invoice:'in_fixture',items:{has_more:false,data:[{price:{id:b.stripe_price_id},quantity:1}]}},i:{id:'in_fixture',livemode:false,customer:b.stripe_customer_id,parent:{subscription_details:{subscription:b.stripe_subscription_id}},currency:'usd',status:'paid',billing_reason:'subscription_cycle',subtotal:14900,total:16614,amount_due:16614,amount_paid:16614,amount_remaining:0,automatic_tax:{enabled:true,status:'complete'},starting_balance:0,ending_balance:0,total_discount_amounts:[],pre_payment_credit_notes_amount:0,post_payment_credit_notes_amount:0,lines:{has_more:false,data:[{amount:14900}]}},p:{has_more:false,data:[{livemode:false,invoice:'in_fixture',status:'paid',amount_paid:16614,currency:'usd',payment:{type:'payment_intent',payment_intent:'pi_fixture'}}]},pi:{id:'pi_fixture',livemode:false,customer:b.stripe_customer_id,currency:'usd',status:'succeeded',amount_received:16614,latest_charge:{livemode:false,payment_intent:'pi_fixture',customer:b.stripe_customer_id,currency:'usd',status:'succeeded',paid:true,captured:true,amount_captured:16614,refunded:false,amount_refunded:0,disputed:false}}});
 const read=(f,binding=b,modern=true)=>createStripeSource({livemode:false,priceId:b.stripe_price_id,stripe:{subscriptions:{retrieve:async()=>f.s},invoices:{retrieve:async()=>f.i},paymentIntents:{retrieve:async()=>f.pi},...(modern?{invoicePayments:{list:async()=>f.p}}:{})}}).readVerifiedSnapshot(binding);
 assert.equal((await read(fixture())).verified,true);
 let f=fixture();f.i.payment_intent='pi_fixture';assert.equal((await read(f,b,false)).verified,true);
 f=fixture();f.i.status='open';f.i.amount_paid=0;assert.equal((await read(f,b,false)).invoice.status,'open');
 const cases=[
  ['wrong binding mode',f=>{}, {...b,livemode:true}],
  ['wrong subscription mode',f=>f.s.livemode=true],
  ['wrong price',f=>f.s.items.data[0].price.id='price_other'],
  ['wrong invoice customer',f=>f.i.customer='cus_other'],
  ['wrong invoice subscription',f=>f.i.parent.subscription_details.subscription='sub_other'],
  ['offline payment',f=>f.i.paid_out_of_band=true],
  ['underpaid',f=>f.i.amount_paid=14900],
  ['credit',f=>f.i.starting_balance=-100],
  ['discount',f=>f.i.total_discount_amounts=[{amount:100}]],
  ['credit note',f=>f.i.post_payment_credit_notes_amount=100],
  ['incomplete tax',f=>f.i.automatic_tax.status='failed'],
  ['partial invoice payment',f=>f.p.data[0].amount_paid=100],
  ['paginated payments',f=>f.p.has_more=true],
  ['wrong invoice payment',f=>f.p.data[0].invoice='in_other'],
  ['declined payment',f=>f.pi.status='requires_payment_method'],
  ['wrong intent customer',f=>f.pi.customer='cus_other'],
  ['uncaptured',f=>f.pi.latest_charge.captured=false]
 ];
 for(const [name,mutate,binding] of cases){f=fixture();mutate(f);await assert.rejects(()=>read(f,binding||b),/Ritnome payment evidence/,name);}
 for(const mutate of [f=>f.pi.latest_charge.amount_refunded=100,f=>f.pi.latest_charge.refunded=true,f=>f.pi.latest_charge.disputed=true]){f=fixture();mutate(f);assert.equal((await read(f)).reversal,true);}
 await assert.rejects(()=>read(fixture(),b,false),/SDK unavailable/);
 // trial start: $0 subscription_create invoice on a trialing subscription is not payment evidence → invoice omitted, no payment lookups
 const trial=()=>{const f=fixture();f.s.status='trialing';Object.assign(f.i,{billing_reason:'subscription_create',total:0,subtotal:0,amount_paid:0,amount_due:0,amount_remaining:0,starting_balance:0,ending_balance:0});f.pi=null;f.p=null;return f;};
 const tr=await read(trial());assert.equal(tr.verified,true);assert.equal(tr.invoice,null);assert.equal(tr.subscription.status,'trialing');
 f=trial();f.s.status='active';await assert.rejects(()=>read(f),/Ritnome payment evidence/,'$0 invoice outside a trial is not accepted');
 f=trial();f.i.billing_reason='subscription_cycle';await assert.rejects(()=>read(f),/Ritnome payment evidence/,'$0 cycle invoice is not accepted');
 f=trial();f.i.total=14900;f.i.amount_paid=0;await assert.rejects(()=>read(f),/Ritnome payment evidence/,'unpaid non-zero total during trial is not accepted');
 console.log('30 Stripe source checks passed');
}
run().catch(e=>{console.error(e);process.exitCode=1;});

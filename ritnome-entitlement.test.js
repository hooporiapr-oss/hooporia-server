'use strict';
const assert=require('node:assert/strict');
const {evaluate}=require('./ritnome-entitlement');
const now=1800000000, stop=now+30*86400;
const binding={livemode:true,stripe_subscription_id:'sub_a',stripe_customer_id:'cus_a',stripe_price_id:'price_a',license_id:'fixture',paid_through:null};
const subscription={id:'sub_a',customer:'cus_a',livemode:true,status:'active',items:{has_more:false,data:[{id:'si_a',quantity:1,price:{id:'price_a'}}]}};
const invoice={livemode:true,customer:'cus_a',subscription:'sub_a',status:'paid',currency:'usd',amount_paid:14900,billing_reason:'subscription_create',paid_out_of_band:false,lines:{has_more:false,data:[{price:'price_a',subscription_item:'si_a',quantity:1,proration:false,amount:14900,period:{start:now,end:stop}}]}};
const base={binding,subscription,invoice,priceId:'price_a',now};
const e=x=>evaluate({...base,...x});
function run(){
 assert.equal(e({}).access,'eligible');
 assert.equal(e({}).paidThrough,new Date(stop*1000).toISOString());
 assert.equal(e({invoice:null}).access,'suspend');
 assert.equal(e({binding:{...binding,license_id:null}}).access,'await_admin_binding');
 assert.equal(e({subscription:{...subscription,customer:'cus_other'}}).decision,'review');
 assert.equal(e({subscription:{...subscription,livemode:false}}).decision,'review');
 assert.equal(e({subscription:{...subscription,items:{data:[{...subscription.items.data[0],quantity:2}],has_more:false}}}).decision,'review');
 assert.equal(e({invoice:{...invoice,amount_paid:0}}).decision,'review');
 assert.equal(e({invoice:{...invoice,paid_out_of_band:true}}).decision,'review');
 assert.equal(e({invoice:{...invoice,lines:{...invoice.lines,has_more:true}}}).decision,'review');
 const paid={...binding,paid_through:new Date(stop*1000).toISOString()};
 assert.equal(e({binding:paid,invoice:null,subscription:{...subscription,status:'past_due'}}).access,'eligible');
 assert.equal(e({binding:paid,invoice:null,subscription:{...subscription,status:'canceled'}}).access,'eligible');
 assert.equal(e({binding:paid,invoice:null,now:stop,subscription:{...subscription,status:'canceled'}}).access,'suspend');
 assert.equal(e({binding:{...paid,paid_through:new Date((stop+86400)*1000).toISOString()}}).paidThrough,new Date((stop+86400)*1000).toISOString());
 assert.equal(e({binding:{...binding,livemode:false,license_id:null},subscription:{...subscription,livemode:false},invoice:{...invoice,livemode:false}}).access,'test_only');
 const modern={...invoice,subscription:null,parent:{subscription_details:{subscription:'sub_a'}},lines:{has_more:false,data:[{...invoice.lines.data[0],price:null,subscription_item:null,proration:null,pricing:{price_details:{price:'price_a'}},parent:{subscription_item_details:{subscription_item:'si_a',proration:false}}}]}};
 assert.equal(e({invoice:modern}).access,'eligible');
 // 14-day trial: first entitlement only, judged from the subscription, no invoice evidence
 const trialing={...subscription,status:'trialing',created:now-60,trial_start:now-60,trial_end:now-60+14*86400};
 const t=e({invoice:null,subscription:trialing});
 assert.equal(t.access,'eligible');assert.equal(t.reason,'verified_trial_period');assert.equal(t.billingStatus,'trialing');
 assert.equal(t.paidThrough,new Date((now-60+14*86400)*1000).toISOString());
 assert.equal(e({invoice:null,subscription:{...trialing,trial_end:now-60+16*86400}}).decision,'review');            // longer than allowed
 assert.equal(e({invoice:null,subscription:{...trialing,trial_start:now+600}}).decision,'review');                  // starts in the future
 assert.equal(e({invoice:null,subscription:{...trialing,trial_end:undefined}}).decision,'review');                  // no end
 assert.equal(e({invoice:null,subscription:trialing,binding:paid}).decision,'review');                             // trial after a paid period
 assert.equal(e({invoice:null,subscription:trialing,binding:{...binding,paid_through:t.paidThrough}}).access,'eligible'); // same trial re-read
 assert.equal(e({invoice:null,subscription:trialing,now:now-60+14*86400+1}).access,'suspend');                     // trial over, nothing paid
 assert.equal(e({invoice:null,subscription:{...trialing,status:'past_due'}}).access,'suspend');                    // card failed after trial
 console.log('26 entitlement assertions passed');
}
module.exports=run;
if(require.main===module)run();

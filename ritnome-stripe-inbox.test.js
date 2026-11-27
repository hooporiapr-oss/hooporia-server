'use strict';
const assert=require('node:assert/strict');
const {createInbox}=require('./ritnome-stripe-inbox');
async function run(){
 let calls=[], fail=false, row=null;
 const base={from(table){calls.push(table);return {
 select(c){calls.push(['select',c]);return this},
 eq(k,v){calls.push([k,v]);return this},
 async maybeSingle(){return {data:row,error:fail?{}:null}},
 async upsert(v,o){calls.push([v,o]);return {error:fail?{}:null}}
 }}};
 const inbox=createInbox(base);
 assert.equal(await inbox.isTracked('sub_test',false),false);
 row={id:'fixture'};
 assert.equal(await inbox.isTracked('sub_test',false),true);
 const e={livemode:false,stripe_event_id:'evt_test',subscription_id:'sub_test',event_type:'invoice.paid',event_created:100,extra:'discard'};
 await inbox.enqueue(e);
 const [v,o]=calls.at(-1);
 assert.equal(Object.hasOwn(v,'extra'),false);
 assert.equal(o.ignoreDuplicates,true);
 assert.equal(o.onConflict,'livemode,stripe_event_id');
 assert.equal(v.livemode,false);
 fail=true;
 await assert.rejects(()=>inbox.enqueue(e));
 await assert.rejects(()=>inbox.isTracked('sub_test',false));
 console.log('Inbox adapter mock tests passed');
}
module.exports=run;
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});

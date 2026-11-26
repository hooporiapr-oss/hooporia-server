// Install alongside coach-memory-service.cjs and coach-memory-http.cjs.
// Server-only. Host must inject a dedicated restricted PostgreSQL pool.
'use strict';
const {createMemoryService}=require('./coach-memory-service.cjs');
const {createMemoryHandler}=require('./coach-memory-http.cjs');
function createTransactionRunner(pool){
 if(!pool||typeof pool.connect!=='function')throw Error('Dedicated database pool required');
 return async function withTransaction(work){
  const client=await pool.connect();let discard=false;
  try{
   await client.query('BEGIN');
   await client.query("SET LOCAL statement_timeout = '5000ms'");
   await client.query("SET LOCAL lock_timeout = '2000ms'");
   await client.query('SET LOCAL ROLE coach_memory_backend');
   const result=await work(client);
   await client.query('COMMIT');return result;
  }catch(e){try{await client.query('ROLLBACK')}catch{discard=true}throw e}
  finally{client.release(discard)}
 };
}
function installCoachMemory(app,{env=process.env,pool,fetchImpl}={}){
 if(!app||typeof app.all!=='function')throw Error('Express app required');
 // Install before express.json() or global CORS. No startup database connection.
 let handler=createMemoryHandler({service:{run:async()=>{throw Error('Disabled')}},enabled:false});
 if(env.COACH_MEMORY_ENABLED==='true'){
  if(!pool||!env.COACH_MEMORY_SUPABASE_URL||!env.COACH_MEMORY_PUBLISHABLE_KEY)throw Error('Coach Memory configuration incomplete');
  const service=createMemoryService({supabaseUrl:env.COACH_MEMORY_SUPABASE_URL,publishableKey:env.COACH_MEMORY_PUBLISHABLE_KEY,withTransaction:createTransactionRunner(pool),fetchImpl});
  handler=createMemoryHandler({service,enabled:true});
 }
 app.all('/v1/coach-memory',(req,res)=>handler(req,res));
}
module.exports={installCoachMemory,createTransactionRunner};

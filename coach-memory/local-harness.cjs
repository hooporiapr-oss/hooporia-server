// Local Coach Memory harness for tests only: the REAL handler, service and restricted pool against a
// disposable PostgreSQL, with a fake Supabase Auth on loopback that mints synthetic tokens.
// Never points at a hosted project. No credentials are printed.
'use strict';
const http=require('node:http');
const {randomUUID}=require('node:crypto');
const {createMemoryService}=require('./coach-memory-service.cjs');
const {createMemoryHandler}=require('./coach-memory-http.cjs');
const {createTransactionRunner}=require('./coach-memory-install.cjs');
const {createCoachMemoryPool}=require('./coach-memory-pool.cjs');
const SUPABASE='https://cm-local.test';
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
function listen(server){return new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)))}
async function start({databaseUrl,allowedOrigin='https://hooporia.mobi',sql}){
 // users: email -> {id,password}; tokens: token -> {id,session,exp}
 const users=new Map(),tokens=new Map();
 function mint(id){const session=randomUUID(),exp=Math.floor(Date.now()/1000)+3600;
  const token=b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:id,session_id:session,exp,iss:SUPABASE+'/auth/v1',role:'authenticated',is_anonymous:false,aud:'authenticated'})+'.'+b64({sig:randomUUID()});
  tokens.set(token,{id,session,exp});return {token,session,exp}}
 async function register(email,password){const id=randomUUID();users.set(email.toLowerCase(),{id,password});if(sql)await sql(`insert into auth.users(id,email) values('${id}','${email.replace(/'/g,"''")}')`);return id}
 const auth=http.createServer(async(req,res)=>{
  const send=(c,b)=>{res.writeHead(c,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'});res.end(JSON.stringify(b))};
  if(req.method==='OPTIONS')return send(204,{});
  let body='';for await(const c of req)body+=c;
  const u=new URL(req.url,'http://x');
  if(u.pathname==='/auth/v1/user'){const t=(req.headers.authorization||'').replace(/^Bearer /,''),k=tokens.get(t);return k?send(200,{id:k.id,is_anonymous:false,aud:'authenticated',email:[...users.entries()].find(([,v])=>v.id===k.id)?.[0]}):send(401,{message:'invalid'})}
  if(u.pathname==='/auth/v1/token'&&u.searchParams.get('grant_type')==='password'){let d={};try{d=JSON.parse(body)}catch{}const usr=users.get(String(d.email||'').toLowerCase());if(!usr||usr.password!==d.password)return send(400,{error:'invalid_grant',error_description:'Invalid login credentials'});
   const {token,exp}=mint(usr.id);if(sql)await sql(`insert into auth.sessions(id,user_id) values('${tokens.get(token).session}','${usr.id}')`);return send(200,{access_token:token,token_type:'bearer',expires_in:3600,expires_at:exp,refresh_token:randomUUID(),user:{id:usr.id,email:d.email,is_anonymous:false,aud:'authenticated'}})}
  if(u.pathname==='/auth/v1/signup'){let d={};try{d=JSON.parse(body)}catch{}if(!d.email||!d.password||users.has(String(d.email).toLowerCase()))return send(422,{msg:'exists'});const id=await register(d.email,d.password);return send(200,{id,user:{id,email:d.email}})}
  if(u.pathname==='/auth/v1/logout'){const t=(req.headers.authorization||'').replace(/^Bearer /,'');tokens.delete(t);return send(204,{})}
  return send(404,{})});
 const authPort=await listen(auth);
 const fetchImpl=(url,init)=>{const x=new URL(url);if(x.origin!==SUPABASE)throw Error('unexpected host');return fetch('http://127.0.0.1:'+authPort+x.pathname+x.search,init)};
 const pool=createCoachMemoryPool({COACH_MEMORY_DATABASE_URL:databaseUrl});
 const service=createMemoryService({supabaseUrl:SUPABASE+'/',publishableKey:'local-anon-key',withTransaction:createTransactionRunner(pool),fetchImpl});
 const handler=createMemoryHandler({service,allowedOrigin,enabled:true});
 const api=http.createServer((req,res)=>handler(req,res));
 const apiPort=await listen(api);
 return {supabaseUrl:SUPABASE,authUrl:'http://127.0.0.1:'+authPort,apiUrl:'http://127.0.0.1:'+apiPort,register,mint,tokens,
  async signIn(email,password){const r=await fetch('http://127.0.0.1:'+authPort+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});if(!r.ok)throw Error('sign-in failed');return r.json()},
  revoke(token){tokens.delete(token)},
  async stop(){await pool.end();auth.close();api.close()}};
}
module.exports={start};

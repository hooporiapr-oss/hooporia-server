// Server-only HTTP adapter, not deployed. No database credentials or tokens in source.
'use strict';
const {Readable}=require('node:stream');
function createMemoryHandler({service,allowedOrigin='https://hooporia.mobi',enabled=false}){
 if(!service||typeof service.run!=='function')throw Error('Missing memory service');
 const origin=new URL(allowedOrigin);
 if(origin.protocol!=='https:'||origin.origin!==allowedOrigin)throw Error('Invalid allowed origin');
 return async function handle(req,res){
  const send=(status,body)=>{res.statusCode=status;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(body))};
  res.setHeader('Vary','Origin');
  if(req.url!=='/v1/coach-memory')return send(404,{error:'not_found'});
  if(!enabled)return send(503,{error:'unavailable'});
  if(req.headers.origin!==allowedOrigin)return send(403,{error:'forbidden'});
  res.setHeader('Access-Control-Allow-Origin',allowedOrigin);
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Cache-Control','no-store');res.statusCode=204;return res.end()}
  if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
  if(!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type']||''))return send(415,{error:'unsupported_media_type'});
  const limit=40000;let size=0,chunks=[];
  try{
   if(Number(req.headers['content-length'])>limit)return send(413,{error:'too_large'});
   for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>limit)return send(413,{error:'too_large'});chunks.push(Buffer.from(chunk))}
   const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   const result=await service.run(req.headers.authorization,input);
   return send(200,result);
  }catch(e){const status=[400,401,403,503].includes(e.status)?e.status:e instanceof SyntaxError?400:503;return send(status,{error:({400:'invalid_request',401:'authentication_required',403:'forbidden',503:'unavailable'})[status]})}
 };
}
module.exports={createMemoryHandler};

// Dedicated restricted PostgreSQL pool for Coach Memory. Server-only.
// COACH_MEMORY_DATABASE_URL must be a login that is a member of coach_memory_backend and nothing more.
'use strict';
function createCoachMemoryPool(env=process.env,{Pool}=require('pg')){
 const url=env.COACH_MEMORY_DATABASE_URL;
 if(typeof url!=='string'||!/^postgres(ql)?:\/\//.test(url))throw Error('COACH_MEMORY_DATABASE_URL required');
 const u=new URL(url);const sock=u.searchParams.get('host')||'';
 if(!u.username||(!u.hostname&&!sock.startsWith('/')))throw Error('COACH_MEMORY_DATABASE_URL incomplete');
 const local=u.hostname==='127.0.0.1'||u.hostname==='localhost'||sock.startsWith('/');
 const ssl=local?false:{rejectUnauthorized:true,...(env.COACH_MEMORY_DATABASE_CA?{ca:env.COACH_MEMORY_DATABASE_CA}:{})};
 return new Pool({connectionString:url,ssl,max:4,idleTimeoutMillis:30000,connectionTimeoutMillis:5000,application_name:'coach-memory'});
}
module.exports={createCoachMemoryPool};

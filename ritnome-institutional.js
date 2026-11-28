/* Ritnome institutional mode — shared script served by institutional.ritnome.com.
   With no launch code in the URL fragment this script does nothing (athlete mode untouched).
   With a launch code it decides institutional mode BEFORE the game runs, keeps the activity token in memory only,
   reports idempotently (run id + sequence) with retry, and never falls back to athlete reporting. */
(function(){
 'use strict';
 var SERVICE='https://institutional.ritnome.com';
 var m=/(?:^|[#&])rl=([A-Za-z0-9_-]{40,48})(?:&|$)/.exec(location.hash||'');
 var api={collect:null,active:false,mode:'none',activity:null,language:'es',handlesEnabled:false,start:noop,checkpoint:noop,end:noop,progress:noop,on:function(){},ended:false,headcount:0};
 window.RitnomeInstitutional=api;
 if(!m){api.mode='none';return;}
 // Institutional mode is decided now; the code leaves the URL immediately.
 api.mode='pending';api.active=true;
 try{history.replaceState(null,'',location.pathname+location.search);}catch(e){}
 document.documentElement.classList.add('ritnome-institutional','ritnome-pending');
 var code=m[1],token=null,run=null,seq=0,queue=[],sending=false,ended=false,listeners={},startedAt=0,lastCheckpoint=0,visible=true;
 var T={es:{pending:'Conectando con Ritnome…',ended:'Sesión finalizada. Pide a tu facilitador que inicie sesión.',ready:'Ritnome · modo institucional',finish:'Finalizar actividad',headcount:'¿Cuántas personas participan?',begin:'Comenzar',who:'¿Quién participa en esta estación?',nobody:'Sin identificador',change:'Participante',back:'Volver al panel',network:'Sin conexión; guardando para enviar.'},
        en:{pending:'Connecting to Ritnome…',ended:'Session ended. Ask your facilitator to sign in.',ready:'Ritnome · institutional mode',finish:'Finish activity',headcount:'How many people are taking part?',begin:'Begin',who:'Who is at this station?',nobody:'No handle',change:'Participant',back:'Back to the desk',network:'Offline; saving to send.'}};
 var lang='es';var t=function(k){return (T[lang]||T.es)[k];};
 function noop(){}
 function emit(name,detail){(listeners[name]||[]).forEach(function(f){try{f(detail)}catch(e){}});try{document.dispatchEvent(new CustomEvent('ritnome:'+name,{detail:detail}))}catch(e){}}
 api.on=function(name,f){(listeners[name]=listeners[name]||[]).push(f);};
 // ---- UI (banner + overlays), kept minimal and large-touch
 var css=document.createElement('style');css.textContent=
  '.ri-banner{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:#0f1a1f;color:#e9f3f5;font:600 16px/1.3 system-ui,sans-serif;border-top:3px solid #4fd1c5;box-shadow:0 -4px 18px rgba(0,0,0,.35)}'+
  '.ri-banner .ri-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.ri-banner button{font:inherit;font-size:16px;padding:12px 18px;border-radius:12px;border:2px solid #4fd1c5;background:#4fd1c5;color:#0f1a1f;min-height:48px}'+
  'html.ritnome-institutional body{padding-bottom:76px}'+
  '.ri-overlay{position:fixed;inset:0;z-index:2147483001;background:rgba(10,14,16,.96);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;text-align:center;font:600 22px/1.35 system-ui,sans-serif}'+
  '.ri-overlay .ri-grid{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;max-width:720px}.ri-overlay .ri-num{font-size:64px;line-height:1;min-width:120px}.ri-overlay .ri-row{display:flex;gap:16px;align-items:center}'+
  '.ri-overlay button{font:inherit;font-size:22px;min-width:72px;min-height:64px;padding:12px 22px;border-radius:16px;border:2px solid #4fd1c5;background:#13262b;color:#fff}.ri-overlay button.ri-go{background:#4fd1c5;color:#0f1a1f}';
 document.documentElement.appendChild(css);
 var banner,overlay;
 function showOverlay(html){hideOverlay();overlay=document.createElement('div');overlay.className='ri-overlay';overlay.setAttribute('role','dialog');overlay.innerHTML=html;document.documentElement.appendChild(overlay);return overlay;}
 function hideOverlay(){if(overlay&&overlay.parentNode)overlay.parentNode.removeChild(overlay);overlay=null;}
 function showBanner(){if(banner)return;banner=document.createElement('div');banner.className='ri-banner';banner.innerHTML='<span>'+t('ready')+' · '+(api.activity||'')+'</span><span class="ri-actions">'+(api.handlesEnabled&&api.handles.length?'<button type="button" class="ri-who">'+t('change')+': '+(labelOf(api.handle)||t('nobody'))+'</button>':'')+'<button type="button" class="ri-fin">'+t('finish')+'</button></span>';banner.querySelector('.ri-fin').onclick=function(){api.end({});};var w=banner.querySelector('.ri-who');if(w)w.onclick=function(){api.pickHandle();};document.documentElement.appendChild(banner);}
 function endScreen(){ended=true;api.ended=true;api.active=false;api.mode='ended';document.documentElement.classList.remove('ritnome-pending');document.documentElement.classList.add('ritnome-ended');
  var o=showOverlay('<div>'+t('ended')+'</div><button type="button" class="ri-go">'+t('back')+'</button>');o.querySelector('button').onclick=function(){location.href=SERVICE+'/desk';};emit('ended',{});}
 showOverlay('<div>'+t('pending')+'</div>');
 // ---- transport: in-order queue with retry; token in memory only
 function post(path,body,keepalive){return fetch(SERVICE+path,{method:'POST',keepalive:!!keepalive,headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify(body)});}
 function flush(){if(sending||ended||!token||!queue.length)return;sending=true;var item=queue[0];
  post('/reporting/report',{run:run,seq:item.seq,kind:item.kind,payload:item.payload},item.kind==='end').then(function(r){return r.json().then(function(j){return {status:r.status,body:j};});}).then(function(res){
   sending=false;var b=res.body||{};
   if(res.status===200){queue.shift();item.ack=true;emit('reported',{seq:item.seq,outcome:b.outcome});return flush();}
   if(res.status===401){endScreen();return;}
   if(res.status===409&&b.outcome==='out_of_order'&&typeof b.high_seq==='number'){while(queue.length&&queue[0].seq<=b.high_seq)queue.shift();if(queue.length&&queue[0].seq!==b.high_seq+1){queue=[];return;}return flush();}
   if(res.status===409){queue.shift();return flush();}
   setTimeout(flush,4000);
  }).catch(function(){sending=false;emit('offline',{});setTimeout(flush,3000);});}
 function enqueue(kind,payload){if(ended||!token)return false;seq++;queue.push({seq:seq,kind:kind,payload:payload||{}});flush();return true;}
 // ---- public API for the game page
 var started=false;
 api.start=function(opts){if(started||ended||!token)return false;started=true;opts=opts||{};startedAt=Date.now();lastCheckpoint=startedAt;
  var w=Math.max(screen.width,screen.height),dc=w<700?'phone':w<1200?'tablet':'desktop';
  run=(crypto&&crypto.randomUUID)?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16);});
  enqueue('start',{mode:opts.mode==='individual'?'individual':'group',headcount:api.headcount,device_class:dc,language:lang,participations:api.headcount});
  showBanner();emit('started',{run:run});return true;};
 function merged(p){var c={};try{if(typeof api.collect==='function')c=api.collect()||{};}catch(e){}var out=clean(c);var extra=clean(p);for(var k in extra)out[k]=extra[k];return out;}
 api.checkpoint=function(p){if(!started||ended)return false;lastCheckpoint=Date.now();return enqueue('checkpoint',merged(p));};
 api.handle=null;api.handles=[];
 api.progress=function(p){if(!started||ended||!api.handlesEnabled||!api.handle)return false;var q=clean(p,true);q.handle_id=api.handle;return enqueue('progress',q);};
 api.pickHandle=function(){if(!api.handlesEnabled||!api.handles.length)return false;askHandle(function(){});return true;};
 api.end=function(p){if(!started||ended)return false;var ok=enqueue('end',merged(p));ended=true;api.active=false;api.mode='finished';if(banner){banner.querySelector('button').disabled=true;banner.firstChild.textContent=t('ready')+' ✓';}emit('finished',{});return ok;};
 function clean(p,prog){p=p||{};var out={};['participations','interactions','headcount','group_bpm','levels','games_completed'].forEach(function(k){if(typeof p[k]==='number'&&isFinite(p[k]))out[k]=Math.max(0,Math.round(p[k]));});
  if(prog){if(typeof p.handle_id==='string')out.handle_id=p.handle_id;if(typeof p.setting==='string')out.setting=p.setting.slice(0,40);if(typeof p.personal_bpm==='number')out.personal_bpm=p.personal_bpm;if(typeof p.minutes==='number')out.minutes=p.minutes;if(p.result&&typeof p.result==='object')out.result=p.result;}
  return out;}
 // periodic checkpoint keeps the session alive (inactivity lock) and minutes current
 setInterval(function(){if(started&&!ended&&Date.now()-lastCheckpoint>60000)api.checkpoint({});},30000);
 document.addEventListener('visibilitychange',function(){visible=!document.hidden;});
 window.addEventListener('pagehide',function(){if(started&&!ended)api.end({});});
 // ---- headcount prompt, then hand control to the game
 function askHeadcount(){var n=api.headcount||6;var o=showOverlay('<div>'+t('headcount')+'</div><div class="ri-row"><button type="button" data-d="-1">−</button><div class="ri-num">'+n+'</div><button type="button" data-d="1">+</button></div><button type="button" class="ri-go">'+t('begin')+'</button>');
  var num=o.querySelector('.ri-num');o.querySelectorAll('button[data-d]').forEach(function(b){b.onclick=function(){n=Math.min(200,Math.max(1,n+Number(b.getAttribute('data-d'))));num.textContent=n;};});
  o.querySelector('.ri-go').onclick=function(){api.headcount=n;hideOverlay();var go=function(){document.documentElement.classList.remove('ritnome-pending');api.mode='active';emit('ready',{activity:api.activity,language:lang,handlesEnabled:api.handlesEnabled,handle:api.handle});};if(api.handlesEnabled&&api.handles.length)askHandle(go);else go();};}
 // ---- participant handle picker (only when the facility opted in and has handles); pseudonymous labels, no names
 function labelOf(id){return id?String(id).replace(/-/g,'').slice(0,6).toUpperCase():'';}
 function askHandle(done){var html='<div>'+t('who')+'</div><div class="ri-grid">'+api.handles.map(function(h){return '<button type="button" data-h="'+h.id+'"'+(h.id===api.handle?' class="ri-go"':'')+'>'+(h.label||labelOf(h.id))+'</button>';}).join('')+'</div><button type="button" class="ri-none">'+t('nobody')+'</button>';
  var o=showOverlay(html);function pick(id){api.handle=id;hideOverlay();var w=banner&&banner.querySelector('.ri-who');if(w)w.textContent=t('change')+': '+(labelOf(api.handle)||t('nobody'));emit('handle',{handle:api.handle});done();}
  o.querySelectorAll('button[data-h]').forEach(function(b){b.onclick=function(){pick(b.getAttribute('data-h'));};});o.querySelector('.ri-none').onclick=function(){pick(null);};}
 // ---- exchange the one-time code for a token (memory only)
 fetch(SERVICE+'/reporting/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code})}).then(function(r){return r.json().then(function(j){return {status:r.status,body:j};});}).then(function(res){
  var b=res.body||{};if(res.status!==200||!b.token){endScreen();return;}
  token=b.token;api.activity=b.activity;api.handlesEnabled=b.handles_enabled===true;api.handles=Array.isArray(b.handles)?b.handles.filter(function(h){return h&&typeof h.id==='string';}):[];lang=b.language==='en'?'en':'es';api.language=lang;
  askHeadcount();
 }).catch(function(){endScreen();});
})();

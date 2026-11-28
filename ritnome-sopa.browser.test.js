// LeLoLai Letras (recreation-sopa.html) playability tests: selection, hints, protection, engine, completion, institutional hook, layouts.
const express=require('express'),http=require('http'),{chromium}=require('playwright');
const BPM=process.env.RITNOME_BPM_DIR,OUT=process.env.RITNOME_OUT||require('os').tmpdir();if(!BPM){console.log('skip: RITNOME_BPM_DIR not set');process.exit(0)}
const app=express();app.use(express.static(BPM));const srv=http.createServer(app);
let fail=0,pass=0;const ok=(c,m)=>{if(c){pass++}else{fail++;console.log('FAIL',m)}};
srv.listen(0,'127.0.0.1',async()=>{const base='http://127.0.0.1:'+srv.address().port;const b=await chromium.launch();
async function mk(w,h,dsf,extra){const c=await b.newContext(Object.assign({viewport:{width:w,height:h},deviceScaleFactor:dsf||1},extra||{}));await c.route(/fonts\.(googleapis|gstatic)/,r=>r.abort());return c}
const ctx=await mk(390,844);const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>{errs.push('native dialog');d.dismiss()});
await p.goto(base+'/recreation-sopa.html');await p.waitForTimeout(200);
const cell=(r,c)=>p.locator(`.cell[data-r="${r}"][data-c="${c}"]`);
const tapPath=async cells=>{for(const [r,c] of cells)await cell(r,c).click()};
const state=()=>p.evaluate(()=>({sel:selected.length,found:found.length,total:wordList.length,done:document.getElementById('doneMsg').style.display}));
// defaults
ok(await p.evaluate(()=>SIZE===8&&document.getElementById('size').value==='8'&&document.querySelectorAll('.cell').length===64),'default 8x8');
ok(await p.evaluate(()=>[...document.querySelectorAll('#size option')].map(o=>o.value).join()==='8,10,12'),'sizes 8/10/12 kept');
ok(await p.evaluate(()=>document.querySelectorAll('.cat').length===6),'six categories');
// engine audit: all cats x sizes
const eng=await p.evaluate(()=>{const bad=[];for(const cat0 of Object.keys(WORDS))for(const size of [8,10,12]){window.cat=cat0;cat=cat0;SIZE=size;for(let n=0;n<80;n++){const bd=generate();if(bd.wordList.length<bd.target)bad.push(cat0+size+' short '+bd.wordList.length);for(const pl of bd.placed){if(!findsWord(bd.grid,pl.word))bad.push(cat0+size+' missing '+pl.word);const s=pl.cells.map(x=>bd.grid[x[0]][x[1]]).join('');if(s!==pl.word)bad.push('cells mismatch '+pl.word)}}}SIZE=8;cat='comida';startFresh();return bad});
ok(eng.length===0,'engine: 1440 boards, every listed word findable, full word count '+JSON.stringify(eng.slice(0,3)));
// find a placed word and select it one by one
async function wordCells(i){return p.evaluate(i=>placed[i].cells,i)}
let w0=await wordCells(0);await tapPath(w0.slice(0,2));
ok((await state()).sel===2,'two letters stay selected');
// accidental touch off line
const off=await p.evaluate(()=>{const a=selected[0];for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++){const dr=r-a.r,dc=c-a.c;if(dr&&dc&&Math.abs(dr)!==Math.abs(dc))return[r,c]}});
await cell(off[0],off[1]).click();ok((await state()).sel===2,'off-line tap keeps selection');
ok(await p.evaluate(()=>document.getElementById('status').textContent.length>5),'off-line tap explains');
// tap outside grid
await p.mouse.click(5,300);await p.locator('#status').click({force:true});ok((await state()).sel===2,'taps outside the grid keep selection');
// numbers
ok(await p.evaluate(()=>[...document.querySelectorAll('.cell.sel')].map(e=>e.dataset.n).join()==='1,2'),'selected letters numbered');
// undo
await p.click('#undo');ok((await state()).sel===1,'undo removes last');
await p.click('#clear');ok((await state()).sel===0,'clear removes all');
// one-by-one complete (forward)
w0=await wordCells(0);await tapPath(w0);let s=await state();ok(s.found===1&&s.sel===0,'word found letter by letter');
ok(await p.evaluate(()=>document.querySelectorAll('.cell.fnd').length>=placed[0].word.length&&document.querySelector('.word.found')!==null),'found cells + chip marked');
// first-to-last for word 2 (reverse selection: last then first)
let w1=await wordCells(1);await tapPath([w1[w1.length-1],w1[0]]);s=await state();ok(s.found===2,'reverse first-to-last selection');
ok(await p.evaluate(()=>document.querySelectorAll('.cell.sel').length===0),'selection cleared after find');
// first-to-last forward for word 3
let w2=await wordCells(2);await tapPath([w2[0],w2[w2.length-1]]);s=await state();ok(s.found===3,'forward first-to-last selection');
// first-to-last fills the whole line visibly before match? use partial: first and middle
let w3=await wordCells(3);await tapPath([w3[0],w3[2]]);ok(await p.evaluate(()=>selected.length===3&&document.querySelectorAll('.cell.sel').length===3),'first-to-middle fills the line (3 letters highlighted)');
// remove middle letter -> truncates
await cell(w3[1][0],w3[1][1]).click();ok(await p.evaluate(()=>selected.length===1),'tapping a marked letter removes it and following ones');
// hint never overrides: select first letter of word 3 and hint
await p.click('#clear');await tapPath([w3[0]]);
const hv=await p.evaluate(()=>{placed.forEach(pp=>{});const r=document.querySelectorAll('.cell');hint();return{hc:hintCell,word:hintWord}});
// force hint onto selected cell
await p.evaluate(({w3})=>{clearHint();hintCell=w3[0];hintWord=placed[3].word;paint()},{w3});
ok(await p.evaluate(()=>{const e=document.querySelector('.cell.hint');return e&&e.classList.contains('sel')&&e.getAttribute('data-n')==='1'}),'hint on a selected cell keeps selection (and badge)');
// hint on found cell
const fcell=w0[0];await p.evaluate(({fcell})=>{hintCell=fcell;paint()},{fcell});
ok(await p.evaluate(()=>{const e=document.querySelector('.cell.hint');return e&&e.classList.contains('fnd')}),'hint on a completed word keeps its colour');
ok(await p.evaluate(()=>{const e=document.querySelector('.cell.hint');return getComputedStyle(e,'::after').content.includes('★')}),'hint star visible (not colour alone)');
// hint duration
await p.click('#clear');await p.click('#hintBtn');const t0=Date.now();ok(await p.evaluate(()=>!!document.querySelector('.cell.hint')),'hint shown');
await p.waitForTimeout(4200);ok(await p.evaluate(()=>!!document.querySelector('.cell.hint')),'hint still visible at ~4.2s');
await p.waitForTimeout(1200);ok(await p.evaluate(()=>!document.querySelector('.cell.hint')&&!document.querySelector('.word.hinted')),'hint gone after ~5s');
// protection: category change with progress -> confirm
await p.click('.cat[data-cat="musica"]');ok(await p.evaluate(()=>document.getElementById('confirm').style.display==='flex'&&cat==='comida'),'category change asks first');
await p.click('#cKeep');ok(await p.evaluate(()=>document.getElementById('confirm').style.display==='none'&&found.length===3&&cat==='comida'),'keep playing preserves puzzle');
await p.selectOption('#size','10');ok(await p.evaluate(()=>document.getElementById('confirm').style.display==='flex'&&SIZE===8),'size change asks first');
await p.keyboard.press('Escape');ok(await p.evaluate(()=>document.getElementById('size').value==='8'&&SIZE===8&&found.length===3),'Escape keeps puzzle and restores selector');
await p.click('#newBtn');ok(await p.evaluate(()=>document.getElementById('confirm').style.display==='flex'),'New asks first');await p.click('#cKeep');
ok(await p.evaluate(()=>{document.getElementById('back').click();return document.getElementById('confirm').style.display==='flex'}),'back arrow asks first');await p.click('#cKeep');
// reload restores
await p.reload();await p.waitForTimeout(200);ok((await state()).found===3,'reload restores unfinished puzzle');
// confirm yes -> new
await p.click('#newBtn');await p.click('#cYes');ok((await state()).found===0,'confirmed new game starts fresh');
// selection-only protection (zero words found)
await p.evaluate(()=>clearSel());w0=await wordCells(0);await tapPath(w0.slice(0,2));
ok(await p.evaluate(()=>found.length===0&&selected.length===2),'setup: 2 letters selected, 0 words found');
await p.click('.cat[data-cat="pueblos"]');ok(await p.evaluate(()=>document.getElementById('confirm').style.display==='flex'&&cat==='comida'&&/letras|letters/.test(document.getElementById('cText').textContent)),'category change asks when only letters are selected');
await p.click('#cKeep');ok(await p.evaluate(()=>selected.length===2&&cat==='comida'),'keep playing preserves selection');
await p.selectOption('#size','12');ok(await p.evaluate(()=>document.getElementById('confirm').style.display==='flex'&&SIZE===8),'size change asks when only letters are selected');await p.keyboard.press('Escape');
await p.click('#newBtn');ok(await p.evaluate(()=>document.getElementById('confirm').style.display==='flex'),'New asks when only letters are selected');await p.click('#cKeep');
ok(await p.evaluate(()=>{document.getElementById('back').click();return document.getElementById('confirm').style.display==='flex'}),'back arrow asks when only letters are selected');await p.click('#cKeep');
await p.reload();await p.waitForTimeout(150);ok(await p.evaluate(()=>selected.length===2&&found.length===0),'reload restores a selection-only puzzle');
await p.click('#clear');await p.click('.cat[data-cat="pueblos"]');ok(await p.evaluate(()=>document.getElementById('confirm').style.display!=='flex'&&cat==='pueblos'),'no prompt when nothing is selected and nothing found');
await p.click('.cat[data-cat="comida"]');
// legend: completed words show different colours
ok(await p.evaluate(()=>{const sw=[...document.querySelectorAll('.swrow .sw')].map(e=>getComputedStyle(e).backgroundColor);return sw.length>=3&&new Set(sw).size===sw.length&&/color|color/.test(document.getElementById('lgFnd').textContent)}),'legend shows several different completed-word colours with explanatory text');
await p.click('#language');ok(await p.evaluate(()=>/own color|each word/i.test(document.getElementById('lgFnd').textContent)),'legend explained in English');await p.click('#language');
// completion
const n=(await state()).total;for(let i=0;i<n;i++){const wc=await wordCells(i);await tapPath(wc)}
s=await state();ok(s.found===n&&s.done==='block','all words found -> doneMsg display:block (institutional hook)');
ok(await p.evaluate(()=>document.getElementById('doneTitle').textContent.length>2&&document.querySelectorAll('.confetti').length>0&&document.getElementById('again').offsetHeight>=48),'celebration shown with play again');
await p.screenshot({path:OUT+'/after-celebration-phone.png'});
await p.click('#again');s=await state();ok(s.found===0&&s.done==='none','play again starts a fresh puzzle, hides celebration');
await p.reload();await p.waitForTimeout(150);ok((await state()).found===0,'completed game not restored');
// institutional hook twice
const ih=await p.evaluate(async()=>{let c=0;const el=document.getElementById('doneMsg');let was=false;new MutationObserver(()=>{const now=el.style.display==='block';if(now&&!was)c++;was=now}).observe(el,{attributes:true,attributeFilter:['style']});
  const finish=()=>{placed.forEach(pl=>{selected=pl.cells.map(x=>({r:x[0],c:x[1]}));check()})};finish();await new Promise(r=>setTimeout(r,50));document.getElementById('again').click();await new Promise(r=>setTimeout(r,50));finish();await new Promise(r=>setTimeout(r,50));return c});
ok(ih===2,'institutional completion observer fires once per completed game ('+ih+')');
// English
await p.evaluate(()=>{document.getElementById('viewBoard').click()});await p.click('#language');
ok(await p.evaluate(()=>/Undo/.test(document.getElementById('undo').textContent)&&/Hint/.test(document.getElementById('hintBtn').textContent)&&/Board/.test(document.getElementById('sizeLabel').textContent)&&document.documentElement.lang==='en'),'English labels');
ok(!errs.length,'no page errors / native dialogs '+errs.join('|'));
await ctx.close();
// ---- layouts & visuals
for(const [n,w,h,d] of [['phone',390,844,2],['phone-small',360,740,2],['tablet',820,1100,1],['desktop',1280,900,1]]){
 const c=await mk(w,h,d);const q=await c.newPage();const e2=[];q.on('pageerror',e=>e2.push(e.message));await q.goto(base+'/recreation-sopa.html');await q.waitForTimeout(300);
 for(const size of ['8','10','12']){await q.selectOption('#size',size);await q.waitForTimeout(80);
  const m=await q.evaluate(()=>{const cl=document.querySelector('.cell').getBoundingClientRect(),wl=document.getElementById('wordList').getBoundingClientRect(),ac=document.querySelector('.actions').getBoundingClientRect();return{cell:Math.round(cl.width),font:parseFloat(getComputedStyle(document.querySelector('.cell')).fontSize),wordsBottom:Math.round(wl.bottom),actionsBottom:Math.round(ac.bottom),vh:innerHeight,ov:document.documentElement.scrollWidth-document.documentElement.clientWidth,minTouch:Math.min(...[...document.querySelectorAll('.cat,.act,#language,#sound,#size')].filter(x=>x.offsetParent).map(x=>x.getBoundingClientRect().height))}});
  console.log(n,size,JSON.stringify(m));
  ok(m.ov<=0,`${n}/${size} no horizontal overflow`);ok(m.minTouch>=44,`${n}/${size} controls >=44px (${m.minTouch})`);ok(m.cell>=(size==='12'?23:size==='10'?29:36),`${n}/${size} cell size ${m.cell}`);
  if(size==='8')ok(m.wordsBottom<=m.vh,`${n}/8 word list visible without scrolling (${m.wordsBottom}<=${m.vh})`);
  if(size==='8'&&(n==='desktop'||n==='tablet'||n==='phone'))ok(m.actionsBottom<=m.vh,'actions visible '+n);}
 await q.selectOption('#size','8');await q.evaluate(()=>{startFresh()});
 await q.evaluate(()=>{const w=placed[0].cells;selected=w.slice(0,3).map(x=>({r:x[0],c:x[1]}));const f=placed[1];found.push(f.word);hintCell=placed[2].cells[0];hintWord=placed[2].word;renderWords();paint()});
 await q.screenshot({path:`${OUT}/after-${n}.png`,fullPage:n==='phone'});ok(!e2.length,n+' no page errors');await c.close()}
console.log(`PASS ${pass} FAIL ${fail}`);await b.close();srv.close();process.exitCode=fail?1:0});

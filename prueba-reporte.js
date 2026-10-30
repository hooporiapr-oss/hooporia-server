/* ════════════════════════════════════════════════════════════════
   EL REPORTE QUE RECIBE EL ENTRENADOR

   No se comprueba que "manda un correo" —eso es un fetch— sino las
   cuatro cosas que puede hacer mal:

     · decir una cifra distinta de la que se le dijo a los padrinos
     · callarse un correo que rebotó, que es el único que necesita
       una llamada
     · llevar un enlace de pago o una promesa de deducción
     · tumbar los avisos si el correo del entrenador falla
   ════════════════════════════════════════════════════════════════ */
const assert = require('assert');
let n = 0;
const ok = (t) => { n++; console.log('  OK  ' + t); };

// ── El módulo, con fetch y supabase de mentira ──────────────────
process.env.RESEND_API_KEY = 'test';
const enviados = [];
global.fetch = async (url, opt) => {
  if (String(url).includes('resend')) {
    const b = JSON.parse(opt.body);
    if (b.to[0] === 'rebota@ejemplo.com') return { ok: false, status: 422,
      text: async () => JSON.stringify({ message: 'Invalid `to` field' }) };
    enviados.push(b);
    return { ok: true, json: async () => ({ id: 'mail_' + enviados.length }) };
  }
  throw new Error('fetch inesperado: ' + url);
};

const REP = {
  ok: true,
  campana: 'Coquíes', juego: 'DB-1', rival: 'Flamboyanes',
  puntos: 58, rival_puntos: 61, piso_centavos: 500,
  entrenador: { nombre: 'John', correo: 'coach@ejemplo.com' },
  pledges: [
    { padrino:'Tía Mari', correo:'mari@ejemplo.com', tarifa:0.25, total:14.50,
      avisado:true, pendiente:false, bajo_minimo:false, corregido:false, no_entregable:false },
    { padrino:'Don Luis', correo:'luis@ejemplo.com', tarifa:0.50, total:29.00,
      avisado:true, pendiente:false, bajo_minimo:false, corregido:true, no_entregable:false },
    { padrino:'Vecino', correo:'malo@ejemplo.com', tarifa:0.10, total:5.80,
      avisado:false, pendiente:false, bajo_minimo:false, corregido:false, no_entregable:true },
    { padrino:'Primo', correo:'primo@ejemplo.com', tarifa:0.05, total:0,
      avisado:false, pendiente:false, bajo_minimo:true, corregido:false, no_entregable:false },
  ],
  resumen: { promesas:4, cobrables:3, prometido:49.30, bajo_minimo:1, corregidos:1 },
};

// supabase de mentira: sólo la rpc que usa el reporte
const fakeSupabase = { rpc: async (name, args) => {
  if (name === 'juego_reporte_cobro') return { data: REP, error: null };
  return { data: null, error: new Error('rpc inesperada: ' + name) };
} };

// Cargar server.js no se puede (levanta el puerto), así que se le
// saca el bloque y se evalúa con lo que necesita.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8')
  .split('/* ── EL REPORTE DEL ENTRENADOR')[1]
  .split('async function sendGameNotice')[0];
const mod = new Function('supabase','MAIL_FROM_HOOPORIA','MAIL_REPLY_TO','falloDeCorreo','fetch',
  '/* ── EL REPORTE DEL ENTRENADOR' + src +
  '; return { reporteAlEntrenador, sendCoachReport, reporteEntrenadorTextos };');

const falloDeCorreo = async (r) => { const e = new Error('mail ' + r.status); e.permanente = r.status === 422; return e; };
const M = mod(fakeSupabase, 'Cada Punto <avisos@cadapunto.com>', null, falloDeCorreo, global.fetch);

(async () => {
console.log('\n── 1 · Lo que dice ─────────────────────────────────────────');
const r = await M.reporteAlEntrenador('CODE', 'g1');
assert.strictEqual(r.estado, 'enviado'); ok('1a · sale, y al entrenador');
assert.strictEqual(r.a, 'coach@ejemplo.com'); ok('1b · a la dirección de coaches');

const m = enviados[0];
assert.ok(m.subject.includes('$49.30'), m.subject);
ok('1c · el asunto trae la cifra: ' + m.subject);

assert.ok(m.html.includes('58'), 'falta el marcador');
ok('1d · el marcador que salda las promesas');

// LA CIFRA. El total del correo tiene que ser el que suman los avisos.
const suma = REP.pledges.filter(p=>!p.bajo_minimo).reduce((a,p)=>a+p.total,0);
assert.strictEqual(Number(suma.toFixed(2)), 49.30);
assert.ok(m.html.includes('$49.30'), 'el total no cuadra con los avisos');
ok('1e · Y EL TOTAL CUADRA con lo que suman los avisos: $49.30');

console.log('\n── 2 · Lo que no se puede callar ───────────────────────────');
assert.ok(/reboté|rebotó/.test(m.html) || m.html.includes('llámalo'), 'no marca el rebote');
ok('2a · el correo que rebotó sale marcado');
assert.ok(m.html.includes('Vecino'), 'falta el padrino del rebote');
ok('2b · con su nombre, que es a quien hay que llamar');
assert.ok(m.text.includes('[rebotó]'), 'el texto plano no lo marca');
ok('2c · y también en el texto plano, no sólo en el HTML');
assert.ok(/bajo el m|below minimum/.test(m.html));
ok('2d · la promesa que no llegó al mínimo, dicha y no escondida');
assert.ok(m.html.includes('Primo'));
ok('2e · con su nombre: el entrenador sabrá qué decirle');

console.log('\n── 3 · Lo que NUNCA puede llevar ───────────────────────────');
assert.ok(!/deducible|deduct|tax/i.test(m.html + m.text));
ok('3a · ninguna promesa de deducción, en ningún idioma');
assert.ok(!/stripe|checkout|pagar ahora|pay now|invoice/i.test(m.html));
ok('3b · ningún enlace de pago: el programa cobra por su cuenta');
assert.ok(/no tocamos el dinero|never touch the money/.test(m.html));
ok('3c · y lo dice con todas las letras');

console.log('\n── 4 · Los dos idiomas ─────────────────────────────────────');
assert.ok(m.html.includes('anotó') && m.html.includes('scored'));
ok('4a · español e inglés, como los avisos');
assert.strictEqual((m.html.match(/<table/g)||[]).length, 1);
ok('4b · pero la tabla una sola vez: son cifras, no palabras');

console.log('\n── 5 · Y lo que no puede romper ────────────────────────────');
REP.entrenador = { nombre: null, correo: null };
const sinEnt = await M.reporteAlEntrenador('CODE','g1');
assert.strictEqual(sinEnt.estado, 'sin_entrenador');
ok('5a · sin entrenador no se escribe, y no se rompe');
REP.entrenador = { nombre:'John', correo:'rebota@ejemplo.com' };
let tumbo = false;
try { await M.reporteAlEntrenador('CODE','g1'); } catch (e) { tumbo = true; }
assert.ok(tumbo, 'debería lanzar para que el llamador lo atrape');
ok('5b · si el correo del entrenador rebota, LANZA — y cobrarJuego lo atrapa');
REP.entrenador = { nombre:'John', correo:'coach@ejemplo.com' };
REP.pledges = [];
const vacio = await M.reporteAlEntrenador('CODE','g1');
assert.strictEqual(vacio.estado, 'sin_promesas');
ok('5c · un juego sin promesas no genera un correo vacío');

console.log('\n════════ ' + n + ' verdes · el reporte dice la verdad ════════\n');
})().catch(e => { console.error('\nFALLA:', e.message); process.exit(1); });

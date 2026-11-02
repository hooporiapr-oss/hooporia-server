/* ══════════════════════════════════════════════════════════════════
   UN AVISO POR PADRINO, AUNQUE ALGO FALLE A MEDIAS — /game-notices

   La fila por juego de cobrarJuego() vive en la memoria de UN proceso.
   No protege si Render reinicia a media pasada, si hay dos instancias
   (un despliegue las solapa unos segundos), ni si Resend aceptó el
   correo pero la base no apuntó el envío. Lo que sí sobrevive a todo
   eso es la llave de cada aviso, que guarda Resend 24 horas.

   Corre el server.js de verdad, DOS veces (dos instancias), con una
   base en memoria y un Resend de mentira que se porta como dice su
   documentación de llaves:
     · misma llave y mismo cuerpo  → devuelve lo de antes, no manda
     · misma llave y otro cuerpo   → 409 invalid_idempotent_request
     · misma llave mientras manda  → 409 concurrent_idempotent_requests

   Comprueba:
     1 · dos instancias a la vez → un correo por padrino
     2 · la base no apunta un envío (o Render se cae entre el correo y
         la base) → el reintento no se lo manda dos veces
     3 · volver a poner el mismo marcador → no sale nada
     4 · corregir el marcador → sale la corrección; y si vuelve atrás
         y otra vez adelante, cada corrección sale
     5 · nada llega a Stripe en un juego de prueba

       node prueba-avisos-duraderos.js
   ══════════════════════════════════════════════════════════════════ */
'use strict';
const Module = require('module');
const path = require('path');

let fallos = 0;
const ok  = (m) => console.log('  ok   ' + m);
const mal = (m) => { fallos++; console.log('  MAL  ' + m); };
const si  = (v, m) => (v ? ok(m) : mal(m));

/* ── La base en memoria ─────────────────────────────────────────── */
const db = {
  puntos: 60,
  pledges: [
    { id: 'a', email: 'a@x.test', rate: 1,   avisos_n: 0, avisado_monto: null },
    { id: 'b', email: 'b@x.test', rate: 0.5, avisos_n: 0, avisado_monto: null },
    { id: 'c', email: 'c@x.test', rate: 0.2, avisos_n: 0, avisado_monto: null },
  ],
  romperApunte: null,        // id cuyo pledge_avisado falla una vez
};
let stripe = 0;

async function rpc(nombre, a) {
  if (nombre === 'juego_correcciones') {
    const lista = db.pledges.map(p => {
      const debe = +(p.rate * db.puntos).toFixed(2);
      return { id: p.id, email: p.email, nombre: p.id, rate: p.rate, cap: null, debe,
               avisos_n: p.avisos_n, dijimos: p.avisado_monto,
               accion: p.avisos_n === 0 ? 'primero'
                     : (p.avisado_monto === debe ? 'nada' : 'correccion') };
    });
    return { data: { ok: true, juego: 'vs R', programa: 'P', puntos: db.puntos,
                     piso_centavos: 500, pledges: lista, program_email: 'coach@x.test' }, error: null };
  }
  if (nombre === 'pledge_avisado') {
    if (db.romperApunte === a.p_id) { db.romperApunte = null;
      return { data: null, error: { message: 'base caída' } }; }
    const p = db.pledges.find(x => x.id === a.p_id);
    p.avisos_n += 1; p.avisado_monto = a.p_monto;
    return { data: { ok: true }, error: null };
  }
  if (nombre === 'juego_reporte') return { data: { ok: true, prueba: true, cobrable: true }, error: null };
  return { data: { ok: true, pledges: [], resumen: {} }, error: null };
}

/* ── Resend de mentira, con llaves ──────────────────────────────── */
const enviados = [];         // a quién le llegó un correo de aviso
const llaves = new Map();
const fetchReal = global.fetch;
global.fetch = async (url, o) => {
  if (!String(url).startsWith('https://api.resend.com/')) return fetchReal(url, o);
  const llave = o.headers && o.headers['Idempotency-Key'];
  const cuerpo = o.body;
  const b = JSON.parse(cuerpo);
  const resp = (st, j) => new Response(JSON.stringify(j), { status: st });
  if (llave && llaves.has(llave)) {
    const k = llaves.get(llave);
    if (!k.hecho) return resp(409, { name: 'concurrent_idempotent_requests' });
    if (k.cuerpo !== cuerpo) return resp(409, { name: 'invalid_idempotent_request' });
    return resp(200, { id: k.id });
  }
  const k = { cuerpo, hecho: false, id: 'em_' + (enviados.length + 1) };
  if (llave) llaves.set(llave, k);
  await new Promise(r => setTimeout(r, 25));
  if (/@x\.test/.test(String(b.to)) && !/coach@/.test(String(b.to))) enviados.push(String(b.to));
  k.hecho = true;
  return resp(200, { id: k.id });
};

/* ── Dos instancias del mismo server.js ─────────────────────────── */
const cargar = Module._load;
Module._load = function (req) {
  if (req === '@supabase/supabase-js') return { createClient: () => ({ rpc, from: () => ({}) }) };
  if (req === 'stripe') return () => new Proxy({}, { get: () => new Proxy({}, { get: () => async () => { stripe++; return {}; } }) });
  return cargar.apply(this, arguments);
};
Object.assign(process.env, { RESEND_API_KEY: 'x', STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'x', SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'x' });
const log = console.log, err = console.error;
console.log = () => {}; console.error = () => {};
const SERVER = path.join(__dirname, 'server.js');
process.env.PORT = '4971'; require(SERVER);
delete require.cache[require.resolve(SERVER)];
process.env.PORT = '4972'; require(SERVER);

const avisar = (puerto) => fetch(`http://127.0.0.1:${puerto}/game-notices`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'C', game_id: 'J1' }) })
  .then(r => r.json());
const de = (quien) => enviados.filter(e => e.startsWith(quien + '@')).length;
const otraVez = async () => { await avisar(4971); await avisar(4972); };

(async () => {
  await new Promise(r => setTimeout(r, 400));
  console.log = log;

  console.log('\n1 · Dos instancias mandan el mismo juego a la vez');
  await Promise.all([avisar(4971), avisar(4972)]);
  await otraVez();                                     // lo que quedó a medias, se termina
  si(de('a') === 1 && de('b') === 1 && de('c') === 1,
     'un correo por padrino (a:' + de('a') + ' b:' + de('b') + ' c:' + de('c') + ')');
  si(db.pledges.every(p => p.avisado_monto !== null), 'y los tres quedan apuntados en la base');

  console.log('\n2 · La base no apunta un envío (o Render se cae entre el correo y la base)');
  db.puntos = 70; db.romperApunte = 'b';
  const r1 = await avisar(4971);
  si(r1.failed === 1, 'esa pasada lo cuenta como pendiente, no como hecho (failed ' + r1.failed + ')');
  const bAntes = de('b');
  await avisar(4972);                                  // otra instancia, como tras un reinicio
  si(de('b') === bAntes, 'el reintento NO le escribe otra vez a b');
  si(db.pledges.find(p => p.id === 'b').avisado_monto === 35, 'y ahora sí queda apuntado: $35.00');

  console.log('\n3 · El entrenador vuelve a poner el mismo marcador');
  const n = enviados.length;
  const r3 = await avisar(4971);
  si(enviados.length === n && r3.sent === 0 && r3.corrected === 0, 'no sale nada');

  console.log('\n4 · Correcciones, también de ida y vuelta');
  const a0 = de('a');
  db.puntos = 60; await avisar(4972);
  si(de('a') === a0 + 1, '70 → 60: a recibe su corrección');
  db.puntos = 70; await avisar(4971);
  si(de('a') === a0 + 2, '60 → 70 otra vez: también le llega (no se confunde con la de antes)');
  si(db.pledges.find(p => p.id === 'a').avisado_monto === 70, 'y la base dice lo último que leyó: $70.00');

  console.log('\n5 · Juego de prueba');
  si(stripe === 0, 'Stripe no se llama nunca');

  console.error = err;
  console.log('\n' + (fallos ? '✗ ' + fallos + ' fallo(s)' : '✓ un aviso por padrino aunque algo falle a medias'));
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error = err; console.error('reventó:', e); process.exit(1); });

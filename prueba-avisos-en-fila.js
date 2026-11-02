/* ══════════════════════════════════════════════════════════════════
   DOS PASADAS DEL MISMO JUEGO A LA VEZ — /game-notices

   Los avisos salen solos al publicar el marcador, así que dos pasadas
   del mismo juego pueden cruzarse: un doble toque, un reintento del
   teléfono, o una corrección mientras la primera todavía manda. Cada
   padrino se apunta como avisado DESPUÉS de que su correo sale, así
   que sin fila dos pasadas le escribían dos veces.

   Corre el server.js de verdad con Supabase, Stripe y Resend de
   mentira (en memoria, sin red). Comprueba que:
     · tres llamadas a la vez → cada padrino recibe UN correo
     · una cuarta llamada después → no sale nada
     · otro juego no espera al primero
     · un juego de prueba no llega nunca a Stripe

       node prueba-avisos-en-fila.js
   ══════════════════════════════════════════════════════════════════ */
'use strict';
const Module = require('module');
const path = require('path');

let fallos = 0;
const ok  = (m) => console.log('  ok   ' + m);
const mal = (m) => { fallos++; console.log('  MAL  ' + m); };
const si  = (v, m) => (v ? ok(m) : mal(m));

/* La base en memoria: dos juegos, tres padrinos en cada uno. */
const promesas = {
  J1: [{ id: 'a', email: 'a@x.test', rate: 1 },    { id: 'b', email: 'b@x.test', rate: 0.5 },
       { id: 'c', email: 'c@x.test', rate: 0.25 }],
  J2: [{ id: 'd', email: 'd@x.test', rate: 1 },    { id: 'e', email: 'e@x.test', rate: 1 },
       { id: 'f', email: 'f@x.test', rate: 1 }],
};
const avisados = {};          // id → monto que se le dijo
let stripeLlamado = 0;

async function rpc(nombre, a) {
  if (nombre === 'juego_correcciones') {
    const lista = promesas[a.p_game].map(p => {
      const debe = +(p.rate * 60).toFixed(2);
      const dijimos = p.id in avisados ? avisados[p.id] : null;
      return { id: p.id, email: p.email, nombre: p.id, rate: p.rate, cap: null, debe, dijimos,
               accion: dijimos === null ? 'primero' : (dijimos === debe ? 'nada' : 'correccion') };
    });
    return { data: { ok: true, juego: 'vs R', programa: 'P', puntos: 60, piso_centavos: 500,
                     pledges: lista, program_email: 'coach@x.test' }, error: null };
  }
  if (nombre === 'pledge_avisado') { avisados[a.p_id] = a.p_monto; return { data: { ok: true }, error: null }; }
  if (nombre === 'juego_reporte')  return { data: { ok: true, prueba: true, cobrable: true }, error: null };
  return { data: { ok: true, pledges: [], resumen: {} }, error: null };
}

const correos = [];
const fetchReal = global.fetch;
global.fetch = async (url, o) => {
  if (String(url).startsWith('https://api.resend.com/')) {
    const b = JSON.parse(o.body);
    await new Promise(r => setTimeout(r, 30));         // un correo tarda: así se cruzan
    correos.push(String(b.to));
    return new Response(JSON.stringify({ id: 'x' }), { status: 200 });
  }
  return fetchReal(url, o);
};

const cargar = Module._load;
Module._load = function (req) {
  if (req === '@supabase/supabase-js') return { createClient: () => ({ rpc, from: () => ({}) }) };
  if (req === 'stripe') return () => new Proxy({}, { get: () => new Proxy({}, { get: () => async () => { stripeLlamado++; return {}; } }) });
  return cargar.apply(this, arguments);
};
Object.assign(process.env, { PORT: '4961', RESEND_API_KEY: 'x', STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'x', SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'x' });
const log = console.log, err = console.error;
console.log = () => {}; console.error = () => {};
require(path.join(__dirname, 'server.js'));

const avisar = (g) => fetch('http://127.0.0.1:4961/game-notices', { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'C', game_id: g }) })
  .then(r => r.json());
const cuenta = (pref) => correos.filter(c => pref.some(p => c.startsWith(p)));

(async () => {
  await new Promise(r => setTimeout(r, 300));
  console.log = log;

  console.log('\n1 · Tres llamadas a la vez');
  const t0 = Date.now();
  const rs = await Promise.all([avisar('J1'), avisar('J1'), avisar('J1'), avisar('J2')]);
  const j1 = cuenta(['a@', 'b@', 'c@']);
  si(j1.length === 3, 'cada padrino recibe UN correo (' + j1.length + ' correos para 3 padrinos)');
  si(rs.slice(0, 3).map(r => r.sent).sort().join() === '0,0,3',
     'la primera manda 3 y las otras dos no mandan nada (' + rs.slice(0, 3).map(r => r.sent).join(', ') + ')');

  console.log('\n2 · Otro juego no espera');
  si(cuenta(['d@', 'e@', 'f@']).length === 3 && rs[3].sent === 3, 'J2 manda sus 3 a la vez que J1');

  console.log('\n3 · Una llamada después');
  const antes = correos.length;
  const r4 = await avisar('J1');
  si(r4.sent === 0 && correos.length === antes, 'no sale nada: ya estaban avisados');

  console.log('\n4 · Juego de prueba');
  si(stripeLlamado === 0, 'Stripe no se llama nunca');

  console.error = err;
  console.log('\n' + (fallos ? '✗ ' + fallos + ' fallo(s)' : '✓ un aviso por padrino, aunque se crucen las pasadas'));
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error = err; console.error('reventó:', e); process.exit(1); });

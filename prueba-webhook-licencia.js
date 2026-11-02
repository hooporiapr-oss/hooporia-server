/* ══════════════════════════════════════════════════════════════════
   EL WEBHOOK DE STRIPE — sólo licencias

   Corre el server.js de verdad, con Stripe y Supabase de mentira (una
   base en memoria). Comprueba que una factura pagada:
     · marca pagada la licencia de un evento (licencias)
     · marca pagada la licencia de un juego (licencias_juego)
     · no toca una licencia anulada
     · no hace nada dos veces si Stripe repite el evento
     · contesta 500 si la base falla, para que Stripe reintente
     · y que una factura ajena no toca nada —ni promesas de padrinos
       ni ninguna otra tabla—

       node prueba-webhook-licencia.js
   ══════════════════════════════════════════════════════════════════ */
'use strict';
const Module = require('module');
const path = require('path');

let fallos = 0;
const ok  = (m) => console.log('  ok   ' + m);
const mal = (m) => { fallos++; console.log('  MAL  ' + m); };
const si  = (v, m) => (v ? ok(m) : mal(m));

/* La base en memoria. */
const db = {
  licencias:       [{ id: 'L1', stripe_invoice_id: 'in_evento', estado: 'enviada' }],
  licencias_juego: [{ id: 'J1', stripe_invoice_id: 'in_juego',   estado: 'enviada' },
                    { id: 'J2', stripe_invoice_id: 'in_anulada', estado: 'anulada' }],
  game_pledges:    [{ id: 'P1', invoice_status: 'sent' }],
};
const tocadas = [];
let romper = false;   // la base falla a propósito

function from(tabla) {
  const filtros = [];
  let cambio = null;
  const b = {
    update(o) { cambio = o; return b; },
    eq(c, v)  { filtros.push(f => f[c] === v); return b; },
    neq(c, v) { filtros.push(f => f[c] !== v); return b; },
    select()  { return b; },
    then(res) {
      tocadas.push(tabla);
      if (romper) return Promise.resolve({ data: null, error: { message: 'base caída' } }).then(res);
      const filas = (db[tabla] || []).filter(f => filtros.every(p => p(f)));
      if (cambio) filas.forEach(f => Object.assign(f, cambio));
      return Promise.resolve({ data: filas.map(f => ({ id: f.id })), error: null }).then(res);
    }
  };
  return b;
}

const cargar = Module._load;
Module._load = function (req) {
  if (req === '@supabase/supabase-js') return { createClient: () => ({ from, rpc: async () => ({}) }) };
  if (req === 'stripe') return () => ({
    webhooks: { constructEvent: (body) => JSON.parse(body.toString()) }
  });
  return cargar.apply(this, arguments);
};
Object.assign(process.env, { PORT: '4931', STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'x', SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'x' });
const log = console.log; console.log = (...a) => { if (!/escuchando|pagada|ya apuntada|No pude/.test(a[0])) log(...a); };

require(path.join(__dirname, 'server.js'));

const pagar = (id, tipo = 'invoice.paid') => fetch('http://127.0.0.1:4931/webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': 'x' },
  body: JSON.stringify({ type: tipo, data: { object: { id } } })
}).then(r => r.status);

(async () => {
  await new Promise(r => setTimeout(r, 300));
  console.log = log;

  console.log('\n1 · La licencia de un evento');
  si(await pagar('in_evento') === 200, 'contesta 200');
  si(db.licencias[0].estado === 'pagada' && !!db.licencias[0].paid_at, 'licencias → pagada, con fecha');

  console.log('\n2 · La licencia de un juego');
  si(await pagar('in_juego') === 200, 'contesta 200');
  si(db.licencias_juego[0].estado === 'pagada', 'licencias_juego → pagada');
  si(!!db.licencias_juego[0].pagada_el, 'con su fecha en pagada_el');

  console.log('\n3 · Stripe repite el evento');
  const primera = db.licencias_juego[0].pagada_el;
  const primeraEv = db.licencias[0].paid_at;
  await new Promise(r => setTimeout(r, 20));
  si(await pagar('in_juego') === 200 && await pagar('in_evento') === 200, 'la repetición contesta 200');
  si(db.licencias_juego[0].pagada_el === primera, 'licencias_juego: la fecha de pago no cambia');
  si(db.licencias[0].paid_at === primeraEv, 'licencias: la fecha de pago no cambia');

  console.log('\n3b · Una anulada no se toca');
  await pagar('in_anulada');
  si(db.licencias_juego[1].estado === 'anulada' && !db.licencias_juego[1].pagada_el, 'sigue anulada');

  console.log('\n4 · Una factura ajena no toca nada');
  tocadas.length = 0;
  si(await pagar('in_ajena') === 200, 'contesta 200');
  si(tocadas.every(t => t === 'licencias' || t === 'licencias_juego'),
     'sólo mira las dos tablas de licencias: ' + [...new Set(tocadas)].join(', '));
  si(db.game_pledges[0].invoice_status === 'sent', 'ninguna promesa de padrino cambia');

  console.log('\n4b · La base falla');
  romper = true;
  si(await pagar('in_otra') === 500, 'contesta 500, y Stripe lo reintenta');
  romper = false;

  console.log('\n5 · Otros eventos no hacen nada');
  tocadas.length = 0;
  si(await pagar('cs_x', 'checkout.session.completed') === 200 && tocadas.length === 0,
     'checkout.session.completed se ignora: no se apunta ningún pago');

  console.log('\n' + (fallos ? '✗ ' + fallos + ' fallo(s)' : '✓ el webhook sólo apunta licencias'));
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('reventó:', e); process.exit(1); });

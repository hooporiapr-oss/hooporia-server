#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   LA LICENCIA DE UN JUEGO, Y LO QUE PASA CUANDO STRIPE DICE NO

   Había pruebas de la licencia de un RETO —el producto por alumno, ya
   retirado— y ninguna de la licencia de un JUEGO, que es la única que
   factura hoy. Las de arriba siguen verdes porque prueban el camino
   viejo, así que no vieron nada de esto:

     · una factura rechazada borraba su propia fila, y con ella la
       única constancia de que este juego debía dinero
     · el juego desaparecía de la lista de cobrables en cuanto se
       mandaban los avisos, así que el reintento no existía
     · un juego de prueba se facturaba igual que uno de verdad

   Lo que se comprueba aquí es el camino del dinero de un juego, con
   Stripe de mentira y la base de mentira. La parte de SQL está
   probada aparte contra un PostgreSQL de verdad.
   ══════════════════════════════════════════════════════════════════ */

const path   = require('path');
const Module = require('module');

let fallos = 0;
const ok  = (m) => console.log('  ok   ' + m);
const mal = (m) => { fallos++; console.log('  MAL  ' + m); };
const eq  = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m)
  : mal(m + '\n         esperaba: ' + JSON.stringify(b) +
            '\n         vino:     ' + JSON.stringify(a)));

// ── El mundo de mentira ───────────────────────────────────────────
const M = {
  reporte: null,        // lo que contesta juego_reporte
  licencias: [],        // filas de licencias_juego, como las dejó el servidor
  borradas: [],         // si alguna vez se borra una, aquí se ve
  facturas: [], lineas: [], enviadas: [],
  correos: [], pledges: [],
  stripeRevienta: false,
  proximoId: 1
};

function reset() {
  M.licencias = []; M.borradas = []; M.facturas = []; M.lineas = [];
  M.enviadas = []; M.correos = []; M.pledges = [];
  M.stripeRevienta = false; M.proximoId = 1;
}

/* licencias_juego de mentira, con memoria: el reintento tiene que
   poder encontrar la fila que falló, así que una tabla que olvida no
   prueba nada. El índice único se imita a mano, que es lo que hace la
   base de verdad. */
function tabla(nombre) {
  return {
    insert(fila) {
      return { select: () => ({ single: async () => {
        if (nombre === 'licencias_juego') {
          const choca = M.licencias.some(l => l.game_id === fila.game_id
                                           && l.estado !== 'anulada');
          if (choca) return { data: null, error: { code: '23505',
                                                   message: 'duplicate key' } };
          const g = { id: 'lic_' + (M.proximoId++), ...fila };
          M.licencias.push(g);
          return { data: g, error: null };
        }
        return { data: { id: 'x', ...fila }, error: null };
      } }) };
    },
    update(cambio) {
      return { eq: (col, val) => {
        if (nombre === 'game_pledges') M.pledges.push({ id: val, ...cambio });
        if (nombre === 'licencias_juego') {
          const f = M.licencias.find(l => l.id === val);
          if (f) Object.assign(f, cambio);
        }
        const r = { data: { ...cambio, id: val }, error: null };
        return Object.assign(Promise.resolve(r), {
          select: () => ({ single: async () => ({
            data: M.licencias.find(l => l.id === val) || r.data, error: null }) }),
          neq: () => Promise.resolve(r)
        });
      } };
    },
    delete() {
      return { eq: async (col, val) => { M.borradas.push(val); return { error: null } } };
    },
    select() {
      /* La cadena que usa el servidor para buscar la fila previa:
         .select('*').eq().neq().limit().maybeSingle() */
      let filtradas = nombre === 'licencias_juego' ? M.licencias.slice()
                    : nombre === 'app_admins' ? [{ email: 'gostardigital@gmail.com' }]
                    : [];
      /* limit() devuelve el constructor y no una promesa: en
         supabase-js de verdad la cadena sigue viva después de
         limit(), y el servidor hace .limit(1).maybeSingle(). Un
         mock que corta ahí inventa un fallo que no existe. */
      const cadena = {
        eq:    (c, v) => { filtradas = filtradas.filter(f => f[c] === v); return cadena },
        neq:   (c, v) => { filtradas = filtradas.filter(f => f[c] !== v); return cadena },
        ilike: () => cadena,
        limit: (n) => { filtradas = filtradas.slice(0, n); return cadena },
        maybeSingle: async () => ({ data: filtradas[0] || null, error: null }),
        single:      async () => ({ data: filtradas[0] || null, error: null }),
        then: (res, rej) => Promise.resolve({ data: filtradas, error: null }).then(res, rej)
      };
      return cadena;
    }
  };
}

/* juego_correcciones se deriva del mismo reporte en vez de escribirse
   a mano: lo que esta prueba vigila es LA LICENCIA, y tener aquí una
   segunda versión inventada de qué le toca a cada padrino sería
   mantener dos veces una regla que ya está probada contra PostgreSQL
   de verdad en p2-prueba.sql. Aquí sólo hace falta que el bucle tenga
   a quién escribir. */
function correccionesDesdeReporte(rep) {
  if (!rep || rep.ok !== true) return rep;
  return {
    ok: true,
    game_id: rep.game_id,
    juego: rep.juego,
    programa: rep.programa,
    puntos: rep.puntos,
    opp_points: rep.opp_points,
    sin_marcador: rep.puntos == null,
    estado_juego: 'played',
    piso_centavos: rep.piso_centavos,
    pay_how: rep.pay_how,
    program_name: rep.program_name,
    program_email: rep.program_email,
    pledges: (rep.pledges || []).map(p => ({
      id: p.id, nombre: p.nombre, email: p.email,
      rate: p.rate, cap: p.cap, estado: p.estado,
      avisos_n: p.estado === 'sent' ? 1 : 0,
      dijimos: p.estado === 'sent' ? p.total : null,
      puntos: rep.puntos,
      debe: p.total,
      accion: p.estado === 'sent' ? 'nada' : 'primero',
    })),
    resumen: {},
  };
}

const supabaseFalso = {
  from: tabla,
  async rpc(nombre, args) {
    if (nombre === 'juego_reporte')       return { data: M.reporte, error: null };
    if (nombre === 'juego_correcciones')
      return { data: correccionesDesdeReporte(M.reporte), error: null };
    if (nombre === 'juego_licencia_cuadra')
      return { data: { ok: true, cuadra: true, facturada: null }, error: null };
    if (nombre === 'pledge_avisado' || nombre === 'pledge_en_cero'
     || nombre === 'pledge_no_entregable') return { data: { ok: true }, error: null };
    return { data: null, error: { message: 'rpc desconocida: ' + nombre } };
  }
};

const stripeFalso = () => ({
  customers: { list: async () => ({ data: [] }),
               create: async (c) => ({ id: 'cus_1', ...c }) },
  invoices: {
    create: async (f) => {
      if (M.stripeRevienta) throw new Error('Your account cannot create live invoices');
      const inv = { id: 'in_' + (M.facturas.length + 1), ...f };
      M.facturas.push(inv); return inv;
    },
    finalizeInvoice: async (id) => ({ id }),
    sendInvoice: async (id) => {
      const e = { id, hosted_invoice_url: 'https://stripe.test/' + id,
                  due_date: Math.floor(Date.now() / 1000) + 7 * 86400 };
      M.enviadas.push(e); return e;
    }
  },
  invoiceItems: { create: async (l) => { M.lineas.push(l); return l } },
  webhooks: { constructEvent: () => ({ type: 'ping' }) }
});

function enchufar(nombre, exporta) {
  const ruta = require.resolve(nombre, { paths: [__dirname] });
  const m = new Module(ruta, null);
  m.filename = ruta; m.loaded = true; m.exports = exporta;
  require.cache[ruta] = m;
}
enchufar('stripe', stripeFalso);
enchufar('@supabase/supabase-js', { createClient: () => supabaseFalso });

const fetchReal = global.fetch;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.indexOf('api.resend.com') !== -1) {
    const cuerpo = JSON.parse((opts && opts.body) || '{}');
    M.correos.push({ to: [].concat(cuerpo.to || [])[0], subject: cuerpo.subject });
    return { ok: true, status: 200, json: async () => ({ id: 'em_1' }) };
  }
  if (u.indexOf('/auth/v1/user') !== -1) {
    return { ok: true, status: 200, json: async () => ({ email: 'gostardigital@gmail.com' }) };
  }
  return fetchReal(url, opts);
};

process.env.STRIPE_SECRET_KEY         = 'sk_test_de_mentira';
process.env.STRIPE_WEBHOOK_SECRET     = 'whsec_de_mentira';
process.env.SUPABASE_URL              = 'https://ejemplo.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_de_mentira';
process.env.RESEND_API_KEY            = 'rs_de_mentira';
process.env.PORT                      = '0';

require(path.join(__dirname, 'server.js'));

const puerto = (function(){
  const hs = process._getActiveHandles().filter(h => h && h.address && h.listening);
  for (const h of hs) { const a = h.address(); if (a && a.port) return a.port; }
  return null;
})();
if (!puerto) { console.log('\n✗ no se pudo averiguar el puerto'); process.exit(1); }

const base = 'http://127.0.0.1:' + puerto;
async function POST(ruta, cuerpo) {
  const r = await fetchReal(base + ruta, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo)
  });
  return { codigo: r.status, cuerpo: await r.json().catch(() => ({})) };
}

// ── Material ──────────────────────────────────────────────────────
const JUEGO = '22222222-2222-2222-2222-222222222222';

/* Lo que devuelve juego_reporte para un juego jugado 68–61 con dos
   promesas que pasan el piso. */
function reporte(extra) {
  return Object.assign({
    ok: true,
    game_id: JUEGO,
    campaign_id: 'cmp-1',
    juego: 'vs Arecibo',
    plays_on: '2026-11-07',
    puntos: 68,
    opp_points: 61,
    programa: 'Canóvanas Basketball Club',
    promesas: 2,
    recaudado: 23.80,
    piso_centavos: 500,
    peldano: '10',
    amount_cents: 500,
    prueba: false,
    cobrable: true,
    program_name: 'Ana Ruiz',
    program_email: 'ana@ejemplo.com',
    ya_facturada: false,
    licencia: null,
    pay_how: 'ATH Móvil',
    pledges: [
      { id: 'p1', nombre: 'Padrino Uno', email: 'uno@ejemplo.com',
        rate: 0.25, cap: null, puntos: 68, total: 17.00, estado: 'open' },
      { id: 'p2', nombre: 'Padrino Dos', email: 'dos@ejemplo.com',
        rate: 0.10, cap: null, puntos: 68, total: 6.80,  estado: 'open' }
    ]
  }, extra || {});
}

// ══════════════════════════════════════════════════════════════════
(async () => {
let r;

console.log('\n1 · El camino bueno: avisos y una factura\n');
reset();
M.reporte = reporte();
r = await POST('/game-notices', { code: 'COACH-X', game_id: JUEGO });

eq(r.codigo, 200, 'contesta 200');
eq(r.cuerpo.sent, 2, 'los dos padrinos reciben su aviso');
eq(M.correos.length, 2, 'y los dos correos se pidieron de verdad');
eq(r.cuerpo.licencia.estado, 'enviada', 'la licencia se facturó');
eq(M.facturas.length, 1, 'una sola factura en Stripe');
eq(M.lineas[0].amount, 500, 'por el peldaño de $5, no por un porcentaje');
eq(M.licencias.length, 1, 'y queda una fila');
eq(M.licencias[0].estado, 'enviada', 'marcada enviada');
eq(M.licencias[0].intentos, 1, 'en el primer intento');


console.log('\n2 · Stripe dice no: LA FILA SE QUEDA\n');
reset();
M.reporte = reporte();
M.stripeRevienta = true;
r = await POST('/game-notices', { code: 'COACH-X', game_id: JUEGO });

eq(r.codigo, 200, 'la tanda de avisos no se convierte en un error');
eq(r.cuerpo.sent, 2, 'los avisos salieron igual: son dos trabajos distintos');
eq(r.cuerpo.licencia.estado, 'stripe', 'y la licencia dice que falló Stripe');
eq(M.borradas.length, 0, 'LA FILA NO SE BORRA — antes sí, y con ella el rastro');
eq(M.licencias.length, 1, 'sigue habiendo una fila');
eq(M.licencias[0].estado, 'fallida', 'en estado fallida');
eq(M.licencias[0].fallo, 'Your account cannot create live invoices',
   'con lo que dijo Stripe, palabra por palabra');
eq(typeof M.licencias[0].fallo_el, 'string', 'y cuándo fue');
eq(r.cuerpo.licencia.why, 'Your account cannot create live invoices',
   'el motivo sube hasta la respuesta, que es lo que lee el panel');


console.log('\n3 · El reintento REUSA esa fila, no abre otra\n');
/* Mismo juego, misma tabla con la fila fallida dentro. Stripe ya no
   falla. Esto es el mismo botón de siempre: el juego vuelve a salir
   en la lista de cobrables porque `fallida` no cuenta como factura. */
M.stripeRevienta = false;
M.correos = [];
M.reporte = reporte({
  // los padrinos ya están avisados, así que el reporte los trae 'sent'
  pledges: reporte().pledges.map(p => ({ ...p, estado: 'sent' }))
});
r = await POST('/game-notices', { code: 'COACH-X', game_id: JUEGO });

eq(r.cuerpo.licencia.estado, 'enviada', 'esta vez se factura');
eq(M.licencias.length, 1, 'y SIGUE habiendo una sola fila');
eq(M.licencias[0].estado, 'enviada', 'la misma, ahora enviada');
eq(M.licencias[0].intentos, 2, 'con el segundo intento contado');
eq(M.facturas.length, 1, 'una factura, no dos');
eq(r.cuerpo.sent, 0, 'y a nadie se le escribe dos veces');
eq(M.correos.length, 0, 'ni un correo de más');
eq(r.cuerpo.skipped, 2, 'los dos avisos ya hechos se cuentan como saltados');


console.log('\n4 · Ya facturada de verdad: no se toca\n');
/* Ahora la fila está 'enviada'. Un barrido que pase otra vez no debe
   confundirla con una fallida y reusarla. */
r = await POST('/game-notices', { code: 'COACH-X', game_id: JUEGO });

eq(r.cuerpo.licencia.estado, 'ya_facturada', 'se lee como ya facturada');
eq(M.facturas.length, 1, 'y Stripe no se vuelve a llamar');
eq(M.licencias.length, 1, 'sin filas nuevas');
eq(M.licencias[0].intentos, 2, 'ni intentos de más');


console.log('\n5 · El juego de prueba: avisa y NO factura\n');
reset();
M.reporte = reporte({ prueba: true, cobrable: false });
r = await POST('/game-notices', { code: 'COACH-X', game_id: JUEGO });

eq(r.codigo, 200, 'contesta 200');
eq(r.cuerpo.sent, 2, 'los avisos salen: el camino se recorre entero');
eq(M.correos.length, 2, 'y los correos se pidieron');
eq(r.cuerpo.licencia.estado, 'prueba',
   'la licencia se dice «prueba», no «sin promesas» — que es otra cosa');
eq(M.facturas.length, 0, 'NO se llama a Stripe');
eq(M.licencias.length, 0, 'y no se crea ninguna fila que luego haya que anular');


console.log('\n6 · Un aviso que falla sigue frenando la factura\n');
/* Esto NO cambia con el desacople. Desacoplar es que el éxito de los
   avisos no borre el pendiente de la factura; no es cobrar por un
   resultado a medio dar. */
reset();
M.reporte = reporte();
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.indexOf('api.resend.com') !== -1) {
    const c = JSON.parse((opts && opts.body) || '{}');
    const para = [].concat(c.to || [])[0];
    if (para === 'dos@ejemplo.com')
      return { ok: false, status: 422, text: async () => 'buzón inválido' };
    M.correos.push({ to: para, subject: c.subject });
    return { ok: true, status: 200, json: async () => ({ id: 'em_1' }) };
  }
  return fetchReal(url, opts);
};
r = await POST('/game-notices', { code: 'COACH-X', game_id: JUEGO });

eq(r.cuerpo.sent, 1, 'uno salió');
eq(r.cuerpo.failed, 1, 'y uno falló');
eq(r.cuerpo.licencia.estado, 'avisos_pendientes', 'así que no se factura todavía');
eq(M.facturas.length, 0, 'Stripe no se llama');
eq(M.licencias.length, 0, 'y no queda fila a medias');


console.log(fallos
  ? '\n✗ ' + fallos + ' fallo' + (fallos === 1 ? '' : 's') + '\n'
  : '\n✓ la licencia de un juego: una sola fila, reintentable, y nunca en una prueba\n');
process.exit(fallos ? 1 : 0);
})();

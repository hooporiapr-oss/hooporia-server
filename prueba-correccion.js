#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   LAS CORRECCIONES, Y EL CORREO QUE NO LLEGA

   La decisión de qué le toca a cada padrino vive en la base y está
   probada allí, contra PostgreSQL de verdad. Esto prueba la otra
   mitad: que el servidor mande lo que la base diga, que mande el
   correo CORRECTO —aviso o corrección no son el mismo texto— y que
   sepa distinguir un fallo de envío que se arregla reintentando de
   uno que no se va a arreglar nunca.

   Esa última distinción es la que importa para el dinero. Antes
   cualquier fallo frenaba la factura, y eso le daba a un padrino que
   tecleó mal su correo el poder de dejar al programa sin licencia
   para siempre.
   ══════════════════════════════════════════════════════════════════ */

const path   = require('path');
const Module = require('module');

let fallos = 0;
const ok  = (m) => console.log('  ok   ' + m);
const mal = (m) => { fallos++; console.log('  MAL  ' + m); };
const eq  = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m)
  : mal(m + '\n         esperaba: ' + JSON.stringify(b) +
            '\n         vino:     ' + JSON.stringify(a)));

const M = {
  correcciones: null,
  reporte: null,
  cuadra: null,
  correos: [],          // {to, subject, cuerpo}
  avisados: [],         // pledge_avisado
  ceros: [],            // pledge_en_cero
  muertos: [],          // pledge_no_entregable
  licencias: [],
  facturas: [],
  rechazo: null,        // {email → {status, body}} para hacer fallar envíos
  proximoId: 1
};

function reset() {
  M.correos = []; M.avisados = []; M.ceros = []; M.muertos = [];
  M.licencias = []; M.facturas = []; M.rechazo = null; M.proximoId = 1;
  M.cuadra = null;
}

function tabla(nombre) {
  return {
    insert(fila) {
      return { select: () => ({ single: async () => {
        if (nombre === 'licencias_juego') {
          const choca = M.licencias.some(l => l.game_id === fila.game_id
                                           && l.estado !== 'anulada');
          if (choca) return { data: null, error: { code: '23505', message: 'dup' } };
          const g = { id: 'lic_' + (M.proximoId++), ...fila };
          M.licencias.push(g);
          return { data: g, error: null };
        }
        return { data: { id: 'x', ...fila }, error: null };
      } }) };
    },
    update(cambio) {
      return { eq: (col, val) => {
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
    delete() { return { eq: async () => ({ error: null }) } },
    select() {
      let f = nombre === 'licencias_juego' ? M.licencias.slice()
            : nombre === 'app_admins' ? [{ email: 'gostardigital@gmail.com' }] : [];
      const c = {
        eq:  (k,v) => { f = f.filter(x => x[k] === v); return c },
        neq: (k,v) => { f = f.filter(x => x[k] !== v); return c },
        ilike: () => c,
        limit: (n) => { f = f.slice(0, n); return c },
        maybeSingle: async () => ({ data: f[0] || null, error: null }),
        single:      async () => ({ data: f[0] || null, error: null }),
        then: (res, rej) => Promise.resolve({ data: f, error: null }).then(res, rej)
      };
      return c;
    }
  };
}

const supabaseFalso = {
  from: tabla,
  async rpc(nombre, args) {
    if (nombre === 'juego_correcciones')   return { data: M.correcciones, error: null };
    if (nombre === 'juego_reporte')        return { data: M.reporte, error: null };
    if (nombre === 'juego_licencia_cuadra') return { data: M.cuadra, error: null };
    if (nombre === 'pledge_avisado')  { M.avisados.push(args); return { data:{ok:true}, error:null } }
    if (nombre === 'pledge_en_cero')  { M.ceros.push(args);    return { data:{ok:true}, error:null } }
    if (nombre === 'pledge_no_entregable') {
      M.muertos.push(args); return { data:{ok:true}, error:null };
    }
    return { data: null, error: { message: 'rpc desconocida: ' + nombre } };
  }
};

const stripeFalso = () => ({
  customers: { list: async () => ({ data: [] }), create: async (c) => ({ id:'cus_1', ...c }) },
  invoices: {
    create: async (f) => { const i = { id:'in_'+(M.facturas.length+1), ...f };
                           M.facturas.push(i); return i },
    finalizeInvoice: async (id) => ({ id }),
    sendInvoice: async (id) => ({ id, hosted_invoice_url:'https://stripe.test/'+id,
                                  due_date: Math.floor(Date.now()/1000)+7*86400 })
  },
  invoiceItems: { create: async (l) => l },
  webhooks: { constructEvent: () => ({ type:'ping' }) }
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
    const c = JSON.parse((opts && opts.body) || '{}');
    const para = [].concat(c.to || [])[0];
    const no = M.rechazo && M.rechazo[para];
    if (no) return { ok:false, status: no.status, text: async () => no.body };
    M.correos.push({ to: para, subject: c.subject, cuerpo: c.text });
    return { ok:true, status:200, json: async () => ({ id:'em_1' }) };
  }
  if (u.indexOf('/auth/v1/user') !== -1) {
    return { ok:true, status:200, json: async () => ({ email:'gostardigital@gmail.com' }) };
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
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(cuerpo)
  });
  return { codigo: r.status, cuerpo: await r.json().catch(() => ({})) };
}

const JUEGO = '22222222-2222-2222-2222-222222222222';

function P(id, nombre, email, accion, debe, dijimos, extra) {
  return Object.assign({ id, nombre, email, rate: 0.25, cap: null,
                         estado: 'open', avisos_n: dijimos == null ? 0 : 1,
                         dijimos, puntos: 58, debe, accion }, extra || {});
}

function correcciones(pledges, extra) {
  return Object.assign({
    ok: true, game_id: JUEGO, juego: 'vs Arecibo',
    programa: 'Canóvanas Basketball Club',
    puntos: 58, opp_points: 61, sin_marcador: false, estado_juego: 'played',
    piso_centavos: 500, pay_how: 'ATH Móvil',
    program_name: 'Ana Ruiz', program_email: 'ana@ejemplo.com',
    pledges, resumen: {}
  }, extra || {});
}

const REPORTE_OK = {
  ok: true, game_id: JUEGO, campaign_id: 'cmp-1', juego: 'vs Arecibo',
  puntos: 58, opp_points: 61, programa: 'Canóvanas Basketball Club',
  promesas: 2, recaudado: 23.80, piso_centavos: 500, peldano: '10',
  amount_cents: 500, prueba: false, cobrable: true,
  program_name: 'Ana Ruiz', program_email: 'ana@ejemplo.com',
  ya_facturada: false, licencia: null, pay_how: 'ATH Móvil', pledges: []
};

// ══════════════════════════════════════════════════════════════════
(async () => {
let r;

console.log('\n1 · Cada acción va por su camino\n');
reset();
M.reporte = REPORTE_OK;
M.correcciones = correcciones([
  P('p1','Alta','alta@ejemplo.com',  'correccion', 14.50, 17.00),
  P('p2','Justo','justo@ejemplo.com','correccion',  0,     5.44),
  P('p3','Tope','tope@ejemplo.com',  'nada',        8.00,  8.00),
  P('p4','Nuevo','nuevo@ejemplo.com','primero',     5.22,  null),
  P('p5','Bajo','bajo@ejemplo.com',  'cero',        0,     null),
]);
r = await POST('/game-notices', { code:'COACH-X', game_id: JUEGO });

eq(r.codigo, 200, 'contesta 200');
eq(r.cuerpo.corrected, 2, 'dos correcciones');
eq(r.cuerpo.sent, 1, 'un primer aviso');
eq(r.cuerpo.skipped, 1, 'y uno al que no hay nada que decirle');
eq(r.cuerpo.zero, 1, 'uno cerrado en cero');
eq(M.correos.length, 3, 'tres correos, no cinco');
eq(M.ceros.length, 1, 'y el cero se cerró sin correo');
eq(M.ceros[0].p_id, 'p5', 'el que tocaba');

const porEmail = (e) => M.correos.find(c => c.to === e);
eq(/Corrección|Correction/.test(porEmail('alta@ejemplo.com').subject), true,
   'a Alta le llega una CORRECCIÓN, no un aviso nuevo');
eq(/anotó|scored/.test(porEmail('nuevo@ejemplo.com').subject), true,
   'y a Nuevo le llega el aviso normal, que es su primero');
eq(porEmail('tope@ejemplo.com'), undefined,
   'al tope, que no se movió, NO le llega nada');


console.log('\n2 · La corrección dice la cifra vieja y la nueva\n');
const textoAlta = porEmail('alta@ejemplo.com').cuerpo;
eq(textoAlta.indexOf('$17.00') > -1, true, 'nombra lo que le dijimos: $17.00');
eq(textoAlta.indexOf('$14.50') > -1, true, 'y lo que es verdad: $14.50');

const textoJusto = porEmail('justo@ejemplo.com').cuerpo;
eq(/no debes nada|owe nothing/.test(textoJusto), true,
   'al que cae bajo el mínimo se le dice NO DEBES NADA, sin rodeos');
eq(textoJusto.indexOf('$5.44') > -1, true, 'y qué cifra tiene que olvidar');


console.log('\n3 · Un marcador retirado\n');
reset();
M.cuadra = { ok:true, cuadra:null, facturada:null };
M.correcciones = correcciones([
  P('p1','Alta','alta@ejemplo.com','correccion', 0, 17.00),
], { sin_marcador: true, puntos: 0, opp_points: null });
r = await POST('/game-notices', { code:'COACH-X', game_id: JUEGO });

eq(r.cuerpo.corrected, 1, 'la retirada sale');
eq(M.correos.length, 1, 'un correo');
eq(/retiró|withdrawn/.test(M.correos[0].cuerpo), true,
   'y dice que el resultado se retiró, no un «de X a Y» que no existe');
eq(/no debes nada|owe nothing/.test(M.correos[0].cuerpo), true, 'y que no debe nada');
eq(r.cuerpo.licencia.estado, 'sin_marcador', 'no se factura nada');
eq(M.facturas.length, 0, 'Stripe no se llama');


console.log('\n4 · UN CORREO MUERTO NO BLOQUEA LA LICENCIA\n');
/* El caso de ChatGPT: 47 salen, uno rebota para siempre. */
reset();
M.reporte = REPORTE_OK;
M.correcciones = correcciones([
  P('p1','Bueno','bueno@ejemplo.com',  'primero', 14.50, null),
  P('p2','Malo','malo@dominio.invalido','primero', 5.00,  null),
]);
M.rechazo = { 'malo@dominio.invalido':
  { status: 422, body: '{"message":"Invalid `to` field"}' } };
r = await POST('/game-notices', { code:'COACH-X', game_id: JUEGO });

eq(r.cuerpo.sent, 1, 'el bueno sale');
eq(r.cuerpo.undeliverable, 1, 'y el malo se cierra como inalcanzable');
eq(r.cuerpo.failed, 0, 'NO cuenta como fallo pendiente: no hay nada que reintentar');
eq(M.muertos.length, 1, 'se guarda con su motivo');
eq(M.muertos[0].p_id, 'p2', 'el que fue');
eq(/Invalid/.test(M.muertos[0].p_motivo), true, 'y con lo que dijo el proveedor');
eq(M.avisados.find(a => a.p_id === 'p2'), undefined,
   'y NO se marca como avisado: no se le avisó');
eq(r.cuerpo.licencia.estado, 'enviada', 'LA LICENCIA SALE IGUAL');
eq(M.facturas.length, 1, 'una factura');


console.log('\n5 · Un fallo temporal SÍ la frena\n');
reset();
M.reporte = REPORTE_OK;
M.correcciones = correcciones([
  P('p1','Bueno','bueno@ejemplo.com','primero', 14.50, null),
  P('p2','Lento','lento@ejemplo.com','primero',  5.00, null),
]);
M.rechazo = { 'lento@ejemplo.com': { status: 429, body: 'rate limited' } };
r = await POST('/game-notices', { code:'COACH-X', game_id: JUEGO });

eq(r.cuerpo.sent, 1, 'uno salió');
eq(r.cuerpo.failed, 1, 'y uno quedó pendiente de reintento');
eq(r.cuerpo.undeliverable, 0, 'que NO es lo mismo que inalcanzable');
eq(M.muertos.length, 0, 'no se cierra a nadie');
eq(r.cuerpo.licencia.estado, 'avisos_pendientes', 'y la factura espera');
eq(M.facturas.length, 0, 'Stripe no se llama');


console.log('\n6 · Si fallan TODAS, no son direcciones malas\n');
/* Una llave caducada o un dominio sin verificar dan un rechazo por
   cada padrino. Cerrarlos a todos escribiría una mentira en cada
   fila, así que se tratan como temporales. */
reset();
M.reporte = REPORTE_OK;
M.correcciones = correcciones([
  P('p1','Uno','uno@ejemplo.com','primero', 14.50, null),
  P('p2','Dos','dos@ejemplo.com','primero',  5.00, null),
]);
M.rechazo = {
  'uno@ejemplo.com': { status: 422, body: '{"message":"Invalid `to` field"}' },
  'dos@ejemplo.com': { status: 422, body: '{"message":"Invalid `to` field"}' },
};
r = await POST('/game-notices', { code:'COACH-X', game_id: JUEGO });

eq(r.cuerpo.undeliverable + r.cuerpo.failed, 2, 'los dos fallan');
eq(r.cuerpo.failed >= 1, true, 'pero al menos uno se trata como temporal');
eq(r.cuerpo.licencia.estado, 'avisos_pendientes',
   'y la factura espera, en vez de cobrar un juego que nadie supo');


console.log('\n7 · Una dirección ya cerrada no se vuelve a intentar\n');
reset();
M.reporte = REPORTE_OK;
M.correcciones = correcciones([
  P('p1','Bueno','bueno@ejemplo.com','primero', 14.50, null),
  P('p2','Muerto','muerto@dominio.invalido','no_entregable', 5.00, null,
    { fallo: '(422) Invalid `to` field' }),
]);
r = await POST('/game-notices', { code:'COACH-X', game_id: JUEGO });

eq(M.correos.length, 1, 'sólo sale un correo');
eq(M.correos[0].to, 'bueno@ejemplo.com', 'el del que se puede');
eq(r.cuerpo.undeliverable, 1, 'el otro se cuenta, para que el programa lo sepa');
eq(r.cuerpo.failed, 0, 'y no bloquea nada');
eq(r.cuerpo.licencia.estado, 'enviada', 'la licencia sale');
eq(/Invalid/.test((r.cuerpo.errors || []).join(' ')), true,
   'con el motivo a la vista, no escondido');


console.log('\n8 · La cuenta se guarda con lo que el padrino LEYÓ\n');
reset();
M.reporte = REPORTE_OK;
M.correcciones = correcciones([
  P('p1','Alta','alta@ejemplo.com','correccion', 14.50, 17.00),
]);
r = await POST('/game-notices', { code:'COACH-X', game_id: JUEGO });

eq(M.avisados.length, 1, 'se anota el aviso');
eq(M.avisados[0].p_monto, 14.50, 'con la cifra que iba en el correo');
eq(M.avisados[0].p_puntos, 58, 'y con los puntos de ese marcador');


console.log(fallos
  ? '\n✗ ' + fallos + ' fallo' + (fallos === 1 ? '' : 's') + '\n'
  : '\n✓ correcciones: el correo correcto, y un buzón muerto que no cuesta la licencia\n');
process.exit(fallos ? 1 : 0);
})();

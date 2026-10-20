/* ══════════════════════════════════════════════════════════════════
   LA FACTURA QUE SALE SOLA

   Desde ahora la licencia no la pulsa nadie: se factura al final de
   /challenge-notices, porque ese es el momento en que los resultados
   quedan dados y la regla del programa es que no se debe nada antes.

   Eso quita un clic y mete un riesgo: la factura sale sin que nadie
   la esté mirando, en Stripe de verdad, a un programa de verdad. Los
   cuatro errores que importan no se parecen entre sí:

     · cobrar dos veces el mismo evento
     · cobrar cuando un padrino se quedó sin su aviso
     · cobrar cuando no hubo ni una promesa
     · perder los correos porque la factura falló

   Ninguno de los cuatro se puede probar contra Stripe de verdad sin
   facturarle a alguien, así que aquí Stripe y Supabase son de
   mentira y lo que se prueba es la DECISIÓN: a quién se le crea una
   factura y a quién no, y qué sobrevive cuando algo se cae.

   El servidor se levanta de verdad —express, las rutas, el orden de
   los middlewares— y se le habla por HTTP. Lo único falso son las
   dos puertas de fuera.

       node prueba-factura-automatica.js
   ══════════════════════════════════════════════════════════════════ */
'use strict';
const path = require('path');
const Module = require('module');

let fallos = 0;
const ok  = (m) => console.log('  ok   ' + m);
const mal = (m) => { fallos++; console.log('  MAL  ' + m); };
const eq  = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m)
  : mal(m + '\n         esperaba: ' + JSON.stringify(b) +
            '\n         vino:     ' + JSON.stringify(a)));

// ── El mundo de mentira ───────────────────────────────────────────
/* Lo que el servidor le pide a la base y a Stripe, apuntado para
   poder preguntar después qué se creó y qué no. */
const M = {
  calculo: null,        // lo que contesta licencia_calculo
  reporte: null,        // lo que contesta challenge_report
  filas: [],            // las licencias insertadas
  borradas: [],         // las licencias retiradas
  facturas: [],         // las facturas creadas en Stripe
  lineas: [],           // las líneas de factura
  enviadas: [],         // las facturas finalizadas y enviadas
  correos: [],          // los avisos que salieron
  pledges: [],          // los update sobre pledges
  stripeRevienta: false,
  correoRevienta: null, // el correo que falla, o null
  duplicada: false      // la base contesta llave duplicada
};

function reset() {
  M.filas = []; M.borradas = []; M.facturas = []; M.lineas = [];
  M.enviadas = []; M.correos = []; M.pledges = [];
  M.stripeRevienta = false; M.correoRevienta = null; M.duplicada = false;
}

/* Una tabla de mentira que sólo sabe lo que el servidor le pide:
   insert().select().single() y update().eq(). */
function tabla(nombre) {
  const api = {
    insert(fila) {
      return {
        select: () => ({
          single: async () => {
            if (nombre === 'licencias' && M.duplicada) {
              return { data: null, error: { code: '23505', message: 'duplicate key' } };
            }
            const guardada = { id: 'lic_' + (M.filas.length + 1), ...fila };
            if (nombre === 'licencias') M.filas.push(guardada);
            return { data: guardada, error: null };
          }
        })
      };
    },
    update(cambio) {
      return {
        eq: (col, val) => {
          if (nombre === 'pledges') M.pledges.push({ id: val, ...cambio });
          const r = { data: { ...cambio, id: val }, error: null };
          // .eq().select().single() y .eq() a secas, los dos se usan
          return Object.assign(Promise.resolve(r), {
            select: () => ({ single: async () => r }),
            neq: () => Promise.resolve(r)
          });
        }
      };
    },
    delete() {
      return { eq: async (col, val) => { M.borradas.push(val); return { error: null } } };
    },
    select() {
      /* app_admins se consulta con .select().ilike().limit(): el
         admin de mentira siempre está dentro, porque lo que se
         prueba aquí es la factura, no la puerta. */
      const fin = { data: nombre === 'app_admins'
                            ? [{ email: 'gostardigital@gmail.com' }] : [],
                    error: null };
      const cadena = {
        eq:    () => cadena,
        ilike: () => cadena,
        limit: async () => fin,
        maybeSingle: async () => ({ data: fin.data[0] || null, error: null }),
        single: async () => ({ data: fin.data[0] || null, error: null })
      };
      return cadena;
    }
  };
  return api;
}

const supabaseFalso = {
  from: tabla,
  async rpc(nombre, args) {
    if (nombre === 'licencia_calculo')  return { data: M.calculo, error: null };
    if (nombre === 'challenge_report')  return { data: M.reporte, error: null };
    return { data: null, error: { message: 'rpc desconocida: ' + nombre } };
  }
};

const stripeFalso = () => ({
  customers: {
    list:   async () => ({ data: [] }),
    create: async (c) => ({ id: 'cus_1', ...c })
  },
  invoices: {
    create: async (f) => {
      if (M.stripeRevienta) throw new Error('Stripe se cayó');
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

/* Se meten en la caché de módulos antes de cargar el servidor, así
   que cuando él hace require('stripe') ya está esto ahí. */
function enchufar(nombre, exporta) {
  const ruta = require.resolve(nombre, { paths: [__dirname] });
  const m = new Module(ruta, null);
  m.filename = ruta; m.loaded = true; m.exports = exporta;
  require.cache[ruta] = m;
}
enchufar('stripe', stripeFalso);
enchufar('@supabase/supabase-js', { createClient: () => supabaseFalso });

/* Resend y la comprobación de admin salen por fetch. Se intercepta
   por host para no tener que saber el orden de las llamadas. */
const fetchReal = global.fetch;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.indexOf('api.resend.com') !== -1) {
    const cuerpo = JSON.parse((opts && opts.body) || '{}');
    const para = [].concat(cuerpo.to || [])[0];
    if (M.correoRevienta && para === M.correoRevienta) {
      return { ok: false, status: 422, text: async () => 'buzón inválido' };
    }
    M.correos.push({ to: para, subject: cuerpo.subject });
    return { ok: true, status: 200, json: async () => ({ id: 'em_1' }) };
  }
  if (u.indexOf('/auth/v1/user') !== -1) {
    return { ok: true, status: 200, json: async () => ({ email: 'gostardigital@gmail.com' }) };
  }
  return fetchReal(url, opts);
};

// ── Arranque ──────────────────────────────────────────────────────
process.env.STRIPE_SECRET_KEY        = 'sk_test_de_mentira';
process.env.STRIPE_WEBHOOK_SECRET    = 'whsec_de_mentira';
process.env.SUPABASE_URL             = 'https://ejemplo.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY= 'service_de_mentira';
process.env.RESEND_API_KEY           = 'rs_de_mentira';
process.env.PORT                     = '0';   // que el sistema elija

const servidor = require(path.join(__dirname, 'server.js'));

// app.listen(0) deja el puerto en el servidor; se saca del propio
// express escuchando, que es lo que devuelve listen().
const puerto = (function(){
  const hs = process._getActiveHandles().filter(h => h && h.address && h.listening);
  for (const h of hs) { const a = h.address(); if (a && a.port) return a.port; }
  return null;
})();

if (!puerto) { console.log('\n✗ no se pudo averiguar el puerto'); process.exit(1); }

const base = 'http://127.0.0.1:' + puerto;
async function POST(ruta, cuerpo, cabeceras) {
  const r = await fetchReal(base + ruta, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, cabeceras || {}),
    body: JSON.stringify(cuerpo)
  });
  return { codigo: r.status, cuerpo: await r.json().catch(() => ({})) };
}

// ── Material ──────────────────────────────────────────────────────
const RETO = '11111111-1111-1111-1111-111111111111';

function reporteCon(promesas) {
  return {
    ok: true,
    campaign: 'Diamantes de Arecibo',
    contact: { name: 'Coach Diaz', email: 'coach@programa.com' },
    challenge: { name: 'November scrimmage', game: 'fortress-vr' },
    players: [], pledges: promesas, count: promesas.length
  };
}
const PROMESA = (i, correo, total) => ({
  id: 'pl_' + i, idioma: 'en', estado: 'pending',
  jugador: 'John Claude', padrino: 'Tia ' + i, correo: correo,
  tarifa: 1, tope: null, puntos: total, total: total
});

const CALCULO_OK = {
  ok: true, challenge: 'November scrimmage', campaign_id: 'camp_1',
  programa: 'Diamantes de Arecibo', roster: 5, promesas: 2,
  cobrable: true, amount_cents: 2900,
  program_name: 'Diamantes de Arecibo', program_email: 'coach@programa.com',
  ya_facturada: false, licencia: null
};

// ══════════════════════════════════════════════════════════════════
(async function corre(){

console.log('\n1 · Los avisos salen y la factura sale con ellos\n');
reset();
M.reporte = reporteCon([PROMESA(1, 'tia1@ejemplo.com', 12), PROMESA(2, 'tia2@ejemplo.com', 20)]);
M.calculo = { ...CALCULO_OK };
let r = await POST('/challenge-notices', { code: 'HOO-ABC123', challenge_id: RETO });

eq(r.codigo, 200, 'contesta 200');
eq(r.cuerpo.sent, 2, 'los dos padrinos avisados');
eq(M.correos.length, 2, 'dos correos de verdad pedidos');
eq(r.cuerpo.licencia.estado, 'enviada', 'y la licencia queda enviada');
eq(M.facturas.length, 1, 'una factura, ni cero ni dos');
eq(M.lineas.length, 1, 'con su única línea');
eq(M.lineas[0].invoice, M.facturas[0].id,
   'y la línea atada a ESA factura, no suelta');
eq(M.lineas[0].amount, 2900, 'por los 2900 que dijo el cálculo');
eq(r.cuerpo.licencia.url, 'https://stripe.test/in_1', 'el enlace vuelve al admin');

console.log('\n2 · Si un aviso falló, no se cobra\n');
reset();
M.reporte = reporteCon([PROMESA(1, 'tia1@ejemplo.com', 12), PROMESA(2, 'malo@ejemplo.com', 20)]);
M.calculo = { ...CALCULO_OK };
M.correoRevienta = 'malo@ejemplo.com';
r = await POST('/challenge-notices', { code: 'HOO-ABC123', challenge_id: RETO });

eq(r.codigo, 200, 'los avisos que salieron no se vuelven un error');
eq(r.cuerpo.sent, 1, 'uno avisado');
eq(r.cuerpo.failed, 1, 'y uno fallido, dicho');
eq(r.cuerpo.licencia.estado, 'avisos_pendientes',
   'la licencia espera: al programa se le cobra cuando TODOS tienen su aviso');
eq(M.facturas.length, 0, 'ninguna factura creada');
eq(M.filas.length, 0, 'ni fila en licencias — nada que limpiar después');

console.log('\n3 · Y al arreglar el correo y volver a pulsar, sí\n');
/* El entrenador corrige el buzón y repite. Los que ya salieron están
   en 'sent' y challenge_report los trae así: se saltan. */
M.correoRevienta = null;
M.reporte = reporteCon([
  { ...PROMESA(1, 'tia1@ejemplo.com', 12), estado: 'sent' },
  PROMESA(2, 'bueno@ejemplo.com', 20)
]);
r = await POST('/challenge-notices', { code: 'HOO-ABC123', challenge_id: RETO });
eq(r.cuerpo.skipped, 1, 'el ya avisado no recibe dos veces');
eq(r.cuerpo.sent, 1, 'y el que faltaba recibe');
eq(r.cuerpo.licencia.estado, 'enviada', 'ahora sí se factura');
eq(M.facturas.length, 1, 'una sola factura en total');

console.log('\n4 · Sin promesas, sin cargo\n');
reset();
M.reporte = reporteCon([]);
M.calculo = { ...CALCULO_OK, promesas: 0, cobrable: false, amount_cents: 0 };
r = await POST('/challenge-notices', { code: 'HOO-ABC123', challenge_id: RETO });

eq(r.codigo, 200, 'no es un error que nadie prometiera');
eq(r.cuerpo.sent, 0, 'no hay a quién avisar');
eq(r.cuerpo.licencia.estado, 'sin_promesas', 'y la licencia lo dice con ese nombre');
eq(M.facturas.length, 0, 'nada en Stripe');
eq(M.filas.length, 0, 'y nada en licencias: no queda deuda apuntada');

console.log('\n5 · Dos veces el mismo evento, una sola factura\n');
reset();
M.reporte = reporteCon([PROMESA(1, 'tia1@ejemplo.com', 12)]);
M.calculo = { ...CALCULO_OK, promesas: 1 };
await POST('/challenge-notices', { code: 'HOO-ABC123', challenge_id: RETO });
eq(M.facturas.length, 1, 'la primera vez factura');

// Segunda pulsada: el cálculo ya dice que está facturada
M.calculo = { ...CALCULO_OK, promesas: 1, ya_facturada: true,
              licencia: { id: 'lic_1', estado: 'enviada' } };
M.reporte = reporteCon([{ ...PROMESA(1, 'tia1@ejemplo.com', 12), estado: 'sent' }]);
r = await POST('/challenge-notices', { code: 'HOO-ABC123', challenge_id: RETO });
eq(r.cuerpo.licencia.estado, 'ya_facturada', 'la segunda lo dice y no cobra');
eq(M.facturas.length, 1, 'sigue habiendo UNA factura');

console.log('\n6 · Y si el cálculo no lo vio, el índice de la base sí\n');
/* La carrera de verdad: dos llamadas a la vez, las dos con el
   cálculo diciendo que no está facturada. La única defensa que
   queda es la llave única de challenge_id. */
reset();
M.reporte = reporteCon([PROMESA(1, 'tia1@ejemplo.com', 12)]);
M.calculo = { ...CALCULO_OK, promesas: 1 };
M.duplicada = true;             // la base rechaza el insert
r = await POST('/challenge-notices', { code: 'HOO-ABC123', challenge_id: RETO });
eq(r.cuerpo.licencia.estado, 'ya_facturada',
   'el 23505 se lee como «ya facturada», no como fallo del servidor');
eq(M.facturas.length, 0, 'y no se llega a Stripe');

console.log('\n7 · Si Stripe se cae, los correos sobreviven\n');
reset();
M.reporte = reporteCon([PROMESA(1, 'tia1@ejemplo.com', 12)]);
M.calculo = { ...CALCULO_OK, promesas: 1 };
M.stripeRevienta = true;
r = await POST('/challenge-notices', { code: 'HOO-ABC123', challenge_id: RETO });

eq(r.codigo, 200, 'la tanda de avisos no se convierte en un error');
eq(r.cuerpo.sent, 1, 'el aviso salió y queda dicho que salió');
eq(M.correos.length, 1, 'el correo se pidió de verdad');
eq(r.cuerpo.licencia.estado, 'stripe', 'la licencia dice que falló Stripe');
eq(M.filas.length, 1, 'se había creado la fila');
eq(M.borradas.length, 1, 'y se retiró: no queda un evento marcado como cobrado');
eq(M.borradas[0], M.filas[0].id, 'la fila retirada es la que se creó');

console.log('\n8 · El piso de $5 es el que promete la página\n');
/* prometer.html le dice al padrino, antes de que prometa y en los
   dos idiomas: «si el total sale por debajo de $5, la promesa se
   cierra y no se debe nada». El servidor cortaba en 50 centavos, así
   que una promesa de $2 leía que no debía nada y recibía un aviso
   pidiéndole $2. */
reset();
M.reporte = reporteCon([
  PROMESA(1, 'grande@ejemplo.com', 12),   // $12 — pasa
  PROMESA(2, 'chica@ejemplo.com', 2),     // $2  — por debajo del piso
  { ...PROMESA(3, 'cero@ejemplo.com', 0), puntos: 0, total: 0 }  // no jugó
]);
M.calculo = { ...CALCULO_OK, promesas: 1 };
r = await POST('/challenge-notices', { code: 'HOO-ABC123', challenge_id: RETO });

eq(r.cuerpo.sent, 1, 'sólo se avisa a la de $12');
eq(r.cuerpo.zero, 2, 'la de $2 y la de cero puntos se cierran sin aviso');
eq(M.correos.map(c => c.to), ['grande@ejemplo.com'],
   'y a la de $2 NO le llega nada — que es lo que leyó al prometer');

/* Y se cierran con su cifra y con un estado que las distingue: la
   que no jugó no es lo mismo que la que jugó poco, y el reporte
   tiene que poder enseñar las dos. */
/* 'sent' fuera: ese es el estado de la que SÍ recibió su aviso, y
   dejarlo dentro hacía fallar la comprobación por culpa de la
   promesa que funcionó bien. */
var cerradas = M.pledges.filter(p => p.invoice_status && p.invoice_status !== 'sent');
eq(cerradas.map(p => p.invoice_status).sort(), ['no_points','too_small'],
   'una queda en too_small y la otra en no_points, no las dos igual');

console.log('\n9 · El botón del admin sigue sirviendo para lo que falló\n');
/* Después del caso 7 el evento quedó sin facturar. El botón tiene
   que poder sacarla, y antes de cobrar tiene que poder enseñarla. */
reset();
M.calculo = { ...CALCULO_OK, promesas: 1 };
r = await POST('/licencia', { challenge_id: RETO },
               { Authorization: 'Bearer token_de_mentira' });
eq(r.codigo, 200, 'sin confirmar contesta 200');
eq(r.cuerpo.vista_previa, true, 'y es una vista previa');
eq(r.cuerpo.amount_cents, 2900, 'con la cifra que se va a cobrar');
eq(M.facturas.length, 0, 'mirar no cobra');

r = await POST('/licencia', { challenge_id: RETO, confirmar: true },
               { Authorization: 'Bearer token_de_mentira' });
eq(r.cuerpo.ok, true, 'confirmando sí cobra');
eq(M.facturas.length, 1, 'una factura');
eq(r.cuerpo.url, 'https://stripe.test/in_1', 'y devuelve su enlace');

console.log('\n10 · Los estados con nombre llegan con su código HTTP\n');
reset();
M.calculo = { ...CALCULO_OK, cobrable: false, promesas: 0 };
r = await POST('/licencia', { challenge_id: RETO, confirmar: true },
               { Authorization: 'Bearer t' });
eq([r.codigo, r.cuerpo.error], [422, 'sin_promesas'], 'sin promesas → 422');

M.calculo = { ...CALCULO_OK, program_email: null };
r = await POST('/licencia', { challenge_id: RETO, confirmar: true },
               { Authorization: 'Bearer t' });
eq([r.codigo, r.cuerpo.error], [422, 'sin_correo'], 'sin correo del programa → 422');

M.calculo = { ...CALCULO_OK, ya_facturada: true };
r = await POST('/licencia', { challenge_id: RETO, confirmar: true },
               { Authorization: 'Bearer t' });
eq([r.codigo, r.cuerpo.error], [409, 'ya_facturada'], 'ya facturada → 409');

M.calculo = { ok: false, why: 'ese reto no existe' };
r = await POST('/licencia', { challenge_id: RETO, confirmar: true },
               { Authorization: 'Bearer t' });
eq([r.codigo, r.cuerpo.error], [404, 'no_calc'], 'sin cálculo → 404');
eq(r.cuerpo.why, 'ese reto no existe', 'y dice por qué, que es lo que costó la mañana');

console.log('\n' + (fallos === 0
  ? '✓ la factura sale sola, una vez, y sólo cuando toca'
  : '✗ ' + fallos + ' fallo(s)'));
process.exit(fallos === 0 ? 0 : 1);

})().catch(e => { console.error('\n✗ la prueba reventó:', e); process.exit(1) });

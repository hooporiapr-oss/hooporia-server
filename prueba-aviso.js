/* ══════════════════════════════════════════════════════════════════
   EL AVISO DEL PADRINO DE HOOPORIA — /challenge-notices

   Esta prueba corre el código DE VERDAD, no una copia: saca el bloque
   del propio server.js y lo ejecuta en un vm con las piezas de fuera
   sustituidas. Si alguien cambia el server y rompe el aviso, esto
   falla; si la prueba llevara su propia copia del código, seguiría
   verde mientras lo desplegado estuviera roto.

   Lo que se sustituye, y sólo eso:
   · supabase.rpc  → llama a challenge_report en un Postgres de verdad
   · supabase.from → UPDATE de verdad en ese mismo Postgres
   · fetch         → un Resend de mentira que apunta lo que saldría,
                     y que puede negarse a propósito

   Lo que NO se sustituye: la cuenta, el idioma, el orden de guardar
   antes de mandar, los estados, ni el HTML. Eso es lo que se prueba.

   Hace falta el Postgres local con el banco y las funciones puestas:
       (ver prueba-reporte-sql.sql en el repo de Cada Punto Cuenta)
   y se le pasa el socket y el puerto por variables:
       PGT=/tmp/pgt PGPORT=5433 PGUSER=claude PGDB=prueba \
         node prueba-aviso.js
   ══════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const vm = require('vm');
const { execFileSync } = require('child_process');

const PGT    = process.env.PGT    || '/tmp/pgt';
const PGPORT = process.env.PGPORT || '5433';
const PGUSER = process.env.PGUSER || 'claude';
const PGDB   = process.env.PGDB   || 'prueba';
const PSQL   = process.env.PSQL   || '/usr/lib/postgresql/16/bin/psql';

let fallos = 0;
const ok  = (m) => console.log('  ok   ' + m);
const mal = (m) => { fallos++; console.log('  MAL  ' + m); };
const eq  = (a, b, m) => (a === b ? ok(m + ' → ' + JSON.stringify(a))
                                  : mal(m + ' → esperaba ' + JSON.stringify(b) +
                                            ' y vino ' + JSON.stringify(a)));

function sql(q) {
  return execFileSync(PSQL,
    ['-h', PGT, '-p', PGPORT, '-U', PGUSER, '-d', PGDB, '-tA', '-c', q],
    { encoding: 'utf8' }).trim();
}

/* ── El código de verdad, sacado del server ─────────────────────── */
function sacarBloque() {
  const s = fs.readFileSync(__dirname + '/server.js', 'utf8');
  const i = s.indexOf('const MAIL_FROM_HOOPORIA');
  if (i < 0) throw new Error('no encuentro MAIL_FROM_HOOPORIA en server.js');
  const marca = s.indexOf("console.error('Challenge notices:'", i);
  if (marca < 0) throw new Error('no encuentro el final del manejador');
  const fin = s.indexOf('\n});\n', marca);
  if (fin < 0) throw new Error('no encuentro el cierre del manejador');
  return s.slice(i, fin + 5);
}

/* ── Las piezas de fuera ────────────────────────────────────────── */
const correos = [];          // lo que saldría por Resend
let negarA = null;           // un correo que Resend rechaza a propósito

const updates = [];          // cada UPDATE que pide el código

const supabaseFalso = {
  async rpc(nombre, args) {
    if (nombre !== 'challenge_report') throw new Error('rpc inesperada: ' + nombre);
    const j = sql(`select to_jsonb(public.challenge_report(` +
                  `$q$${args.p_code}$q$, $q$${args.p_challenge}$q$::uuid))`);
    return { data: JSON.parse(j), error: null };
  },
  from(tabla) {
    return {
      update(patch) {
        return {
          async eq(_col, id) {
            updates.push({ tabla, id, patch });
            const sets = Object.entries(patch).map(([k, v]) =>
              `${k} = ` + (v === null ? 'null'
                        : typeof v === 'number' ? String(v)
                        : `$q$${v}$q$`)).join(', ');
            sql(`update public.${tabla} set ${sets} where id = $q$${id}$q$`);
            return { error: null };
          },
        };
      },
    };
  },
};

async function fetchFalso(url, opciones) {
  const cuerpo = JSON.parse(opciones.body);
  if (negarA && cuerpo.to.includes(negarA)) {
    return { ok: false, status: 422,
             text: async () => '{"message":"no se pudo"}' };
  }
  correos.push(cuerpo);
  return { ok: true, status: 200, json: async () => ({ id: 'falso' }) };
}

/* ── Montarlo ───────────────────────────────────────────────────── */
let manejador = null;
const contexto = {
  console: { log(){}, error(){} },
  process: { env: { RESEND_API_KEY: 'falsa', MAIL_FROM_HOOPORIA: 'Cada Punto Cuenta <aviso@cadapunto.com>' } },
  MAIL_REPLY_TO: '',
  supabase: supabaseFalso,
  fetch: fetchFalso,
  app: { post(ruta, fn) { if (ruta === '/challenge-notices') manejador = fn; },
         use(){}, get(){} },
  /* El trozo que se corta empieza en MAIL_FROM_HOOPORIA, y entre eso
     y el manejador del aviso vive la ruta del webhook, que llama a
     express.raw() al registrarse. app.post de mentira se traga la
     ruta, pero el argumento se evalúa ANTES de la llamada: sin un
     express aquí, el bloque entero reventaba con un ReferenceError
     y esta prueba llevaba tiempo sin correr. */
  express: { raw: () => function(){}, json: () => function(){} },
  JSON, Number, Math, Date, Object, String, Error,
};
vm.createContext(contexto);
vm.runInContext(sacarBloque(), contexto, { filename: 'server.js (bloque del aviso)' });

if (!manejador) { mal('no se registró /challenge-notices'); process.exit(1); }

/* ── Un res de mentira ──────────────────────────────────────────── */
function resFalso() {
  const r = { code: 200, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json   = (b) => { r.body = b; return r; };
  return r;
}

const RETO = 'cccccccc-0000-0000-0000-000000000001';

/* Esta prueba ESCRIBE en la base: marca filas como avisadas y guarda
   cifras. Sin esto pasaba la primera vez y fallaba la segunda, porque
   se encontraba su propio trabajo hecho — y una prueba que sólo se
   puede correr una vez no la corre nadie.

   Así que empieza devolviendo las filas a como las deja el banco:
   abiertas, sin puntos, y con los 999/888/777 del modelo viejo
   puestos a propósito para que se note si alguien los lee. */
function reiniciar() {
  sql(`update public.pledges
          set invoice_status = case when sponsor_email = $q$nope@x.invalid$q$
                                    then $q$void$q$ else $q$open$q$ end,
              points_at_invoice = null,
              amount = 999, team_amount = 888, platform_amount = 777
        where challenge_id = $q$${RETO}$q$`);
  // Y el correo del entrenador, que una de las comprobaciones lo
  // quita a propósito para ver qué hace el aviso sin contacto.
  sql(`update public.coaches set email = $q$burgos@equipo.invalid$q$
        where access_code = $q$CODIGO-BUENO$q$`);
}

(async () => {
  reiniciar();
  console.log('1 · La puerta\n');

  let res = resFalso();
  await manejador({ body: { challenge_id: RETO } }, res);
  eq(res.code, 400, 'sin código no se manda nada');

  res = resFalso();
  await manejador({ body: { code: 'NO-EXISTE', challenge_id: RETO } }, res);
  eq(res.code, 403, 'un código que no existe se queda fuera');
  eq(correos.length, 0, 'y no salió ningún correo');

  console.log('\n2 · El envío\n');

  res = resFalso();
  await manejador({ body: { code: 'CODIGO-BUENO', challenge_id: RETO } }, res);
  eq(res.code, 200, 'con el código bueno contesta');
  eq(res.body.sent, 3, 'tres avisos: Abuela, Tío Orlando y Vecino');
  eq(res.body.zero, 2, 'dos sin puntos: Madrina (no jugó) y Primo (sacado)');
  eq(res.body.failed, 0, 'ninguno falló');

  // Las cifras del reporte, que son las probadas contra Postgres.
  const porCorreo = {};
  correos.forEach(c => { porCorreo[c.to[0]] = c; });

  const abuela = porCorreo['abuela@x.invalid'];
  const tio    = porCorreo['tio@x.invalid'];
  const vecino = porCorreo['vecino@x.invalid'];

  abuela ? ok('le salió correo a la abuela') : mal('no salió correo a la abuela');
  eq(/\$4\.50/.test(abuela.html), true, 'y dice $4.50, lo mismo que el reporte');
  eq(/45 puntos/.test(abuela.html), true, 'con los 45 puntos de Ana');
  eq(/Ana/.test(abuela.html), true, 'y nombra a la nena, que es por quien prometió');

  console.log('\n3 · El tope, que es lo que un padrino no se puede creer de menos\n');
  eq(/\$20\.00/.test(tio.html), true, 'a Tío Orlando le dice $20.00, su tope');
  eq(/\$45\.00/.test(tio.html), true, 'y le enseña los $45.00 que habrían sido');
  eq(/cap/i.test(tio.html), true, 'explicando que el tope lo puso él');

  console.log('\n4 · El idioma\n');
  eq(/Prometiste/.test(abuela.html) && !/You pledged/.test(abuela.html), true,
     'la abuela prometió en español y lo recibe sólo en español');
  eq(/You pledged/.test(tio.html) && !/Prometiste/.test(tio.html), true,
     'Tío Orlando prometió en inglés y lo recibe sólo en inglés');
  eq(/Prometiste/.test(vecino.html) && /You pledged/.test(vecino.html), true,
     'Vecino no tiene idioma guardado, así que le salen los dos');

  console.log('\n5 · A quién le escribe un padrino que no sabe cómo pagar\n');

  /* Lo importante no es que salga un correo cualquiera: es que salga
     el del entrenador DUEÑO DEL CÓDIGO. En el banco hay dos
     entrenadores en la misma campaña a propósito, y si el reporte
     cogiera el primero en vez del dueño del código, el padrino
     recibiría el correo del que no mandó nada. */
  eq(/burgos@equipo\.invalid/.test(abuela.html), true,
     'el correo lleva el del entrenador que mandó los avisos');
  eq(/nomando@equipo\.invalid/.test(abuela.html), false,
     'y no el del otro entrenador de la misma campaña');
  eq(/Coach Burgos/.test(abuela.html), true, 'con su nombre, no sólo la dirección');
  eq(abuela.reply_to, 'burgos@equipo.invalid',
     'y el Responder le llega a él, no a Gostar Digital');
  eq(/burgos@equipo\.invalid/.test(tio.html), true, 'lo mismo en el correo en inglés');
  eq(/write to/.test(tio.html), true, 'y traducido');

  // Sin contacto —un admin_code no tiene fila en coaches— el correo
  // vuelve a la frase de antes y no imprime un hueco.
  console.log('\n5b · Y si no hay contacto, no se inventa uno\n');
  const sinContacto = [];
  {
    const antes = correos.length;
    sql(`update public.coaches set email = null where access_code = $q$CODIGO-BUENO$q$`);
    sql(`update public.pledges set invoice_status = $q$open$q$ where sponsor_email = $q$abuela@x.invalid$q$`);
    const r2 = resFalso();
    await manejador({ body: { code: 'CODIGO-BUENO', challenge_id: RETO } }, r2);
    const nuevo = correos[correos.length - 1];
    sinContacto.push(nuevo);
    eq(correos.length, antes + 1, 'sale el correo igual');
    eq(/Ellos te dirán cómo/.test(nuevo.html), true, 'y dice que el programa te dirá cómo');
    eq(/escríbele a/.test(nuevo.html), false, 'sin invitar a escribirle a nadie');
    eq(/null|undefined/.test(nuevo.html), false, 'y sin un hueco donde iba el correo');
    eq(nuevo.reply_to, undefined, 'y sin reply_to, mejor que un buzón que nadie lee');
    sql(`update public.coaches set email = $q$burgos@equipo.invalid$q$ where access_code = $q$CODIGO-BUENO$q$`);
  }

  console.log('\n6 · Lo que el correo no lleva\n');
  const todos = correos.map(c => c.html + ' ' + c.text + ' ' + c.subject).join(' ');

  /* Buscar la PALABRA 'payment' aquí fue un falso positivo, y de los
     instructivos: lo que la disparaba era «Cada Punto Cuenta takes no
     payments», la frase que promete justo lo contrario de lo que la
     prueba temía. Lo que no puede haber no es la palabra, es un
     enlace. Así que se busca el enlace. */
  eq(/href=|https?:\/\//i.test(todos), false, 'ningún enlace, ni de pago ni de nada');
  eq(/stripe|pay\.html|checkout/i.test(todos), false, 'ni rastro de la pasarela de pagos');
  eq(/deducib|deductible|tax/i.test(todos), false, 'ni una palabra de impuestos');
  eq(/plataforma|platform fee|10%/i.test(todos), false, 'ningún cargo de plataforma');
  eq(/Cada Punto/.test(todos), false, 'y no firma como el otro producto');
  eq(correos.every(c => /Cada Punto Cuenta/.test(c.from)), true, 'el remitente dice Cada Punto Cuenta');
  eq(correos.every(c => /no cobra pagos|takes no payments/.test(c.html)), true,
     'cada uno dice que no cobramos pagos');
  eq(correos.every(c => /no te va a escribir otra vez|will not write to you about this again/.test(c.html)), true,
     'y que de aquí no sale un recordatorio');

  console.log('\n6b · Una promesa recién hecha dice pending, no open\n');

  /* Esto se escapó hasta una corrida de verdad: cp_pledge crea las
     promesas con invoice_status 'pending'. El aviso pedía 'open' a
     secas y las saltaba todas, contestando «saltada» sin mandar nada.
     El banco las creaba como 'open', así que la prueba pasaba
     mientras lo desplegado no mandaba un solo correo. */
  {
    const antes = correos.length;
    sql(`update public.pledges set invoice_status = $q$pending$q$
          where sponsor_email = $q$abuela@x.invalid$q$`);
    const r3 = resFalso();
    await manejador({ body: { code: 'CODIGO-BUENO', challenge_id: RETO } }, r3);
    eq(r3.body.sent, 1, 'una promesa en pending sí recibe su aviso');
    eq(correos.length, antes + 1, 'y el correo sale de verdad');
    eq(sql(`select invoice_status from public.pledges where sponsor_email = $q$abuela@x.invalid$q$`),
       'sent', 'y queda marcada como avisada');
  }

  console.log('\n7 · Lo que quedó escrito en la base\n');
  eq(sql(`select invoice_status from public.pledges where sponsor_email = $q$abuela@x.invalid$q$`),
     'sent', 'la fila de la abuela queda avisada');
  eq(sql(`select points_at_invoice::text from public.pledges where sponsor_email = $q$abuela@x.invalid$q$`),
     '45', 'con sus puntos guardados');
  // Comparado como numero y no como cadena: la columna es numeric sin
  // escala, asi que guarda 4.5 e imprime "4.5". Es el mismo dinero que
  // 4.50, y afirmar el formato seria afirmar algo que no importa.
  eq(sql(`select (team_amount = 4.50)::text from public.pledges where sponsor_email = $q$abuela@x.invalid$q$`),
     'true', 'y su cifra, 4.50');
  eq(sql(`select platform_amount::text from public.pledges where sponsor_email = $q$abuela@x.invalid$q$`),
     '0', 'el cargo de plataforma a cero, que ya no existe');
  eq(sql(`select (amount = team_amount)::text from public.pledges where sponsor_email = $q$abuela@x.invalid$q$`),
     'true', 'y amount igual que team_amount: sin recargo, son lo mismo');
  eq(sql(`select invoice_status from public.pledges where sponsor_email = $q$madrina@x.invalid$q$`),
     'no_points', 'la de Madrina se cierra como sin puntos');
  eq(sql(`select count(*)::text from public.pledges where invoice_status = $q$void$q$ and sponsor_email = $q$madrina@x.invalid$q$`),
     '0', 'y NO como anulada, que entonces desaparecería del reporte');

  console.log('\n8 · Que no se avise dos veces\n');
  const antes = correos.length;
  res = resFalso();
  await manejador({ body: { code: 'CODIGO-BUENO', challenge_id: RETO } }, res);
  eq(correos.length, antes, 'pulsar el botón otra vez no manda nada');
  eq(res.body.sent, 0, 'cero avisos nuevos');
  eq(res.body.skipped, 5, 'las cinco se saltan por estar ya cerradas');

  console.log('\n9 · Si Resend se niega, la fila se queda para reintentar\n');
  sql(`update public.pledges set invoice_status = $q$open$q$ where sponsor_email = $q$abuela@x.invalid$q$`);
  negarA = 'abuela@x.invalid';
  res = resFalso();
  await manejador({ body: { code: 'CODIGO-BUENO', challenge_id: RETO } }, res);
  eq(res.body.failed, 1, 'cuenta el fallo');
  eq(sql(`select invoice_status from public.pledges where sponsor_email = $q$abuela@x.invalid$q$`),
     'open', 'y la fila NO queda marcada como avisada');
  eq(sql(`select (team_amount = 4.50)::text from public.pledges where sponsor_email = $q$abuela@x.invalid$q$`),
     'true', 'pero la cifra sí quedó guardada, que se calculó antes de mandar');

  negarA = null;
  res = resFalso();
  await manejador({ body: { code: 'CODIGO-BUENO', challenge_id: RETO } }, res);
  eq(res.body.sent, 1, 'al reintentar sale sólo la que faltaba');

  console.log('\n' + (fallos === 0
    ? '✓ el aviso del padrino pasa'
    : '✗ ' + fallos + ' fallo(s)'));
  process.exit(fallos === 0 ? 0 : 1);
})().catch(e => { console.error('reventó:', e.message); process.exit(1); });

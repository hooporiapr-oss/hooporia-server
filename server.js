// ══════════════════════════════════════════════════════════════════
//  EL SERVIDOR DE HOOPORIA
//
//  Hooporia tiene su sitio, su admin y su base. Esto es lo que le
//  faltaba: su servidor.
//
//  Antes vivía dentro de uno de 3.300 líneas compartido con BOGO y
//  con Cada Punto, donde un cambio hecho para otro producto podía
//  romper el suyo sin que nadie lo notara. Aquí hay cinco rutas y
//  ninguna es de nadie más:
//
//    POST /challenge-notices   el aviso que recibe cada padrino al
//                              cerrar la ventana — uno, con sus
//                              puntos y su total, sin enlace de pago
//                              y sin recordatorios jamás
//    POST /licencia            la licencia del evento: $49, o $29 si
//                              la plantilla tiene menos de ocho, y
//                              nada si no se recogió ni una promesa
//    POST /webhook             Stripe diciendo que una se pagó
//    POST /team-signup         el correo que te llega cuando un
//                              programa pide campaña desde equipo.html
//    POST /coach/chat          la ayuda del entrenador, contestada —
//                              con su código, con tope de preguntas,
//                              y sin que el modelo conteste nada de
//                              dinero
//
//  Lo que NO hay aquí, y no lo habrá: cobrarle a un padrino. Hooporia
//  no procesa pagos de promesas, no verifica pagos y no persigue a
//  nadie. El dinero va del padrino al programa, directo. El único
//  cobro que existe es la licencia, y la paga el programa.
//
//  ── Variables de entorno ─────────────────────────────────────────
//    SUPABASE_URL
//    SUPABASE_SERVICE_ROLE_KEY
//    RESEND_API_KEY
//    MAIL_FROM_HOOPORIA        p.ej. Hooporia <avisos@hooporia.com>
//    MAIL_REPLY_TO             opcional: a dónde contesta un padrino
//                              cuando el reto no trae contacto
//    ADMIN_EMAIL               a dónde llega una solicitud de campaña
//    STRIPE_SECRET_KEY
//    STRIPE_WEBHOOK_SECRET     del endpoint de ESTE host, no del otro
//
//  Y las de la ayuda. Sin ANTHROPIC_API_KEY el chat contesta 503 y lo
//  dice; las demás tienen valor por defecto y sólo se ponen para
//  cambiarlo:
//    ANTHROPIC_API_KEY         sin ella el chat está apagado
//    COACH_CHAT_MODEL          por defecto claude-haiku-5-5
//    COACH_CHAT_PER_HOUR       por entrenador, por defecto 12
//    COACH_CHAT_PER_DAY        por entrenador, por defecto 30
//    COACH_CHAT_TOTAL_DAY      entre todos, por defecto 250 — éste es
//                              el que protege la factura
//    COACH_CHAT_OFF=1          apaga el chat sin quitar la llave
// ══════════════════════════════════════════════════════════════════
const express = require('express');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL,
                              process.env.SUPABASE_SERVICE_ROLE_KEY);

const MAIL_FROM_HOOPORIA =
  process.env.MAIL_FROM_HOOPORIA || 'Hooporia <onboarding@resend.dev>';
const MAIL_FROM = MAIL_FROM_HOOPORIA;

/* A dónde contesta un padrino que le da a «responder» cuando el reto
   no trae contacto del programa. Se quedó sin declarar al traer el
   aviso desde el servidor compartido, donde sí existía: la línea que
   lo usa sólo se evalúa cuando NO hay contacto, así que el fallo
   esperó escondido hasta el primer reto sin coach — y entonces tiró
   un ReferenceError que contó como «aviso fallido» sin decir más.

   Vacío es una respuesta válida: sin reply_to, responder le escribe
   al remitente. Mejor eso que mandar a una dirección inventada. */
const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO || '';

/* El webhook necesita el cuerpo crudo para comprobar la firma, así
   que va ANTES del express.json() de abajo. Al revés, el cuerpo
   llega ya parseado y la firma nunca cuadra. */
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let evento;
  try {
    evento = stripe.webhooks.constructEvent(
      req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Firma del webhook:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  if (evento.type === 'invoice.paid') {
    const inv = evento.data.object;
    try {
      const { data } = await supabase
        .from('licencias')
        .update({ estado: 'pagada', paid_at: new Date().toISOString() })
        .eq('stripe_invoice_id', inv.id)
        .neq('estado', 'anulada')
        .select('id');
      if (data && data.length) console.log(`Licencia ${data[0].id} pagada (${inv.id})`);
      else console.log(`invoice.paid sin licencia nuestra: ${inv.id}`);
    } catch (e) {
      console.error('No pude marcar la licencia pagada:', e);
      return res.status(500).send('no se pudo apuntar el pago');
    }
  }

  return res.status(200).send('ok');
});

app.use(express.json());

/* De dónde se aceptan llamadas. El admin vive en hooporia.com; nada
   más tiene por qué hablar con esto desde un navegador. */
app.use((req, res, next) => {
  const o = req.headers.origin || '';
  if (/^https:\/\/(www\.)?hooporia\.com$/.test(o) || /localhost/.test(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ── Quién puede pedir cosas ──────────────────────────────────────
async function requireAdmin(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;

  // Ask Supabase who this token belongs to.
  const who = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${token}`,
    },
  });
  if (!who.ok) return null;

  const user = await who.json();
  if (!user || !user.email) return null;

  const { data, error } = await supabase
    .from('app_admins')
    .select('email')
    .ilike('email', user.email)
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return user.email;
}

// ── El aviso del padrino ─────────────────────────────────────────
function avisoRetoTextos(lang, o) {
  const money = (n) => '$' + Number(n || 0).toFixed(2);

  /* CÓMO SE PAGA, en palabras del propio programa.

     Si la campaña lo tiene escrito, sale tal cual y el padrino no
     tiene que preguntarle nada a nadie. Si no, se queda la frase de
     siempre: que le escriba al entrenador.

     Con doce jugadores eso era una molestia. Con una escuela de
     cuatrocientos son mil seiscientos padrinos preguntando lo mismo
     —o, lo que de verdad pasa, dejándolo para luego y no pagando
     nunca. El segundo en que alguien está más dispuesto a pagar es
     el que acaba de leer que su ahijado anotó 150 puntos.

     Hooporia no cobra nada: esto es una instrucción que escribió el
     programa, impresa en el correo que ya salía. */
  const comoPagar = String(o.payHow || '').trim();

  if (lang === 'es') {
    const cuenta = o.cap != null
      ? `Prometiste ${money(o.rate)} por punto, que habrían sido ${money(o.bruto)} — ` +
        `pero pusiste un tope de ${money(o.cap)}, así que tu promesa es de <b>${money(o.pledged)}</b>.`
      : `Prometiste ${money(o.rate)} por punto, así que tu promesa es de <b>${money(o.pledged)}</b>.`;
    return {
      subject: `${o.who} anotó ${o.points} puntos — tu promesa`,
      lines: [
        `Hola ${o.name},`,
        `<b>${o.who}</b> anotó <b>${o.points} puntos</b> en ${o.retoName}.`,
        cuenta,
        comoPagar
          ? `Ese dinero se lo pagas directamente a ${o.teamName}: <b>${comoPagar}</b>` +
            (o.contactEmail
              ? ` Si algo no te cuadra, escríbele a ${o.contactName || o.teamName}: ${o.contactEmail}.`
              : '') +
            ` Hooporia no cobra pagos y no te va a escribir otra vez por esto.`
          : (o.contactEmail
              ? `Ese dinero se lo pagas directamente a ${o.teamName}. Si no sabes cómo, ` +
                `escríbele a ${o.contactName || o.teamName}: ${o.contactEmail}. ` +
                `Es quien lo recibe. Hooporia no cobra pagos y no te va a escribir otra vez por esto.`
              : `Ese dinero se lo pagas directamente a ${o.teamName}. Ellos te dirán cómo. ` +
                `Hooporia no cobra pagos y no te va a escribir otra vez por esto.`),
      ],
    };
  }

  const cuenta = o.cap != null
    ? `You pledged ${money(o.rate)} a point, which would have come to ${money(o.bruto)} — ` +
      `but you set a ${money(o.cap)} cap, so your pledge is <b>${money(o.pledged)}</b>.`
    : `You pledged ${money(o.rate)} a point, so your pledge comes to <b>${money(o.pledged)}</b>.`;
  return {
    subject: `${o.who} scored ${o.points} points — your pledge`,
    lines: [
      `Hi ${o.name},`,
      `<b>${o.who}</b> scored <b>${o.points} points</b> in ${o.retoName}.`,
      cuenta,
      comoPagar
        ? `You pay that directly to ${o.teamName}: <b>${comoPagar}</b>` +
          (o.contactEmail
            ? ` If something does not look right, write to ${o.contactName || o.teamName}: ${o.contactEmail}.`
            : '') +
          ` Hooporia takes no payments and will not write to you about this again.`
        : (o.contactEmail
            ? `You pay that directly to ${o.teamName}. If you are not sure how, write to ` +
              `${o.contactName || o.teamName}: ${o.contactEmail}. They are the one who ` +
              `receives it. Hooporia takes no payments and will not write to you about this again.`
            : `You pay that directly to ${o.teamName}, who will tell you how. ` +
              `Hooporia takes no payments and will not write to you about this again.`),
    ],
  };
}

async function sendChallengeNotice(o) {
  // 'es' o 'en' explícitos. Cualquier otra cosa —null, una fila
  // vieja— y salen los dos, porque no se sabe.
  const idioma = (o.lang === 'es' || o.lang === 'en') ? o.lang : null;
  const partes = idioma ? [avisoRetoTextos(idioma, o)]
                        : [avisoRetoTextos('es', o), avisoRetoTextos('en', o)];

  const bloque = (t) => t.lines.map(l => `<p>${l}</p>`).join('\n      ');
  const html = `
    <div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#12202E;font-size:15px;line-height:1.6">
      ${partes.map(bloque).join(
        '\n      <hr style="border:none;border-top:1px solid #D7E0E8;margin:22px 0">\n      ')}
      <p style="color:#5A6B7C;font-size:.8rem;margin-top:22px">
        Hooporia · Gostar Digital LLC · Puerto Rico
      </p>
    </div>`;

  const text = partes
    .map(t => t.lines.map(l => l.replace(/<[^>]+>/g, '')).join('\n'))
    .join('\n\n---\n\n') + '\n';

  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: MAIL_FROM_HOOPORIA,
      to: [o.to],
      /* El reply_to va al entrenador que mandó los avisos, no al
         nuestro. Un padrino que le dé a Responder preguntando cómo
         paga tiene que llegarle a quien cobra; si llega a Gostar
         Digital, llega a alguien que no tiene su dinero ni cómo
         ayudarle, y encima parece que lo cobramos nosotros.

         Sin contacto cae en MAIL_REPLY_TO, y si eso también está
         vacío no va reply_to ninguno — mejor eso que mandarle a un
         buzón que nadie lee. */
      ...(o.contactEmail ? { reply_to: o.contactEmail }
                         : (MAIL_REPLY_TO ? { reply_to: MAIL_REPLY_TO } : {})),
      subject: partes[0].subject,
      html, text,
    }),
  });

  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Resend refused the notice (${r.status}): ${detail.slice(0, 200)}`);
  }
}

/* ── EL PISO ──────────────────────────────────────────────────────
   Por debajo de esto la promesa se cierra y no se le pide nada a
   nadie. El número NO es una preferencia: es lo que prometer.html
   le dice al padrino, con estas mismas palabras, antes de que
   prometa —«si el total sale por debajo de $5, la promesa se cierra
   y no se debe nada»— y lo mismo en inglés.

   Estaba en 50 centavos aquí y en $5 en la página. Un padrino cuya
   promesa diera $2 leía que no debía nada y recibía un aviso
   pidiéndole $2. La página manda, porque es lo que esa persona
   leyó.

   Si este número cambia, cambian a la vez: prometer.html (los dos
   idiomas), el filtro de reporte.html y padrinos.html —la tabla de
   textos y la calculadora, que apaga el total cuando la promesa no
   llega. Son SEIS sitios y tienen que decir lo mismo.

   padrinos.html faltaba en esta lista, y por eso se desfasó: la
   página que lee el NENE antes de salir a pedir decía que no hay
   cantidad muy pequeña, mientras aquí se cerraba toda promesa de
   menos de $5. Si mañana se añade otro sitio que hable del piso,
   apúntalo aquí mismo. */
const PISO_CENTS = 500;

app.post('/challenge-notices', async (req, res) => {
  const { code, challenge_id } = req.body || {};
  if (!code || !challenge_id) {
    return res.status(400).json({ error: 'code and challenge_id are required' });
  }

  try {
    // La puerta y la cuenta en la misma llamada. challenge_report
    // comprueba el código con builder_check y que la campaña sea de
    // ese entrenador; si cualquiera de las dos falla, contesta
    // ok:false y aquí no se manda nada.
    const { data: rep, error } = await supabase.rpc('challenge_report', {
      p_code: String(code),
      p_challenge: String(challenge_id),
    });

    if (error) {
      console.error('challenge-notices report:', error.message);
      return res.status(500).json({ error: 'report failed' });
    }
    if (!rep || rep.ok !== true) {
      // El mismo mensaje que da el reporte, sin añadir nada: decir
      // cuál de las dos cosas falló sería enumerar campañas ajenas.
      return res.status(403).json({ error: (rep && rep.error) || 'not allowed' });
    }

    /* CÓMO SE PAGA. Se lee aparte y no por challenge_report, a
       propósito: esa función es la puerta del reporte —comprueba el
       código y que la campaña sea de ese entrenador— y reescribirla
       entera para añadir una columna es arriesgar lo que ya cierra
       bien por algo que es un dato suelto.

       Se lee DESPUÉS de que challenge_report dijo ok, así que para
       cuando se llega aquí ya está comprobado que este reto es de
       quien dice. Si la consulta falla o la columna está vacía,
       comoPagar queda vacío y el aviso dice lo de siempre: que le
       escriba al entrenador. Un dato de más que no llega no puede
       parar mil seiscientos avisos. */
    let payHow = null;
    try {
      const { data: cam } = await supabase
        .from('challenges')
        .select('campaigns(pay_how)')
        .eq('id', String(challenge_id))
        .single();
      payHow = (cam && cam.campaigns && cam.campaigns.pay_how) || null;
    } catch (e) {
      console.error('pay_how:', e.message);
    }

    const teamName = rep.campaign || 'the program';
    const retoName = (rep.challenge && rep.challenge.name) || teamName;

    /* A quién le escribe un padrino que no sabe cómo pagar: el
       entrenador dueño del código que acaba de mandar los avisos, que
       el reporte saca de coaches. Puede venir vacío —con un
       admin_code no hay fila— y entonces el correo vuelve a decir
       sólo «el programa te dirá cómo». */
    const contacto = rep.contact || {};
    const out = { sent: 0, skipped: 0, zero: 0, failed: 0, errors: [] };

    for (const p of rep.pledges || []) {
      /* Quién sigue sin avisar. Es una lista blanca a propósito, y
         costó una corrida de prueba averiguar por qué hacía falta:
         cp_pledge crea las promesas con invoice_status 'pending', no
         'open'. Pidiendo 'open' a secas, el botón contestaba
         «1 saltada» y no mandaba nada — y el entrenador se habría ido
         a buscar el fallo a Resend, que no tenía ninguno.

         Lista blanca y no lista negra porque el error de cada lado no
         es el mismo: si aparece un estado nuevo y no está aquí, el
         padrino no recibe su aviso y el entrenador lo ve en la cuenta
         de «saltadas»; al revés, un estado nuevo que debiera callar
         acabaría en el buzón de una abuela por segunda vez, y eso no
         se puede retirar. */
      const SIN_AVISAR = [null, undefined, '', 'open', 'pending'];
      if (SIN_AVISAR.indexOf(p.estado) === -1) { out.skipped++; continue; }

      const total  = Number(p.total || 0);
      const puntos = Number(p.puntos || 0);
      const cents  = Math.round(total * 100);

      /* Sin puntos no hay promesa que avisar, y por debajo del piso
         no se le pide a nadie. Las dos filas se
         cierran con su cifra guardada —no se dejan en 'open'
         pareciendo pendientes para siempre— pero NO con 'void':
         challenge_report esconde las anuladas, y esconder al nene que
         no jugó es esconder el único problema que un reporte puede
         enseñar. Con 'no_points' y 'too_small' siguen saliendo en el
         reporte con su cero, que es la verdad. */
      if (cents <= 0 || cents < PISO_CENTS) {
        await supabase.from('pledges').update({
          points_at_invoice: puntos,
          team_amount: total,
          amount: total,
          platform_amount: 0,
          invoice_status: cents <= 0 ? 'no_points' : 'too_small',
        }).eq('id', p.id);
        out.zero++;
        continue;
      }

      /* La cuenta se guarda ANTES de mandar: si el correo falla, el
         número ya está bueno y el aviso se puede repetir.

         amount va igual que team_amount porque en este modelo no hay
         recargo: el padrino paga la promesa y nada más. Dejar el
         amount viejo ahí sería dejar escrito un número con el 10% de
         un modelo que no existe. Y platform_amount a cero por lo
         mismo: no hay cargo de plataforma que cobrarle a él. */
      await supabase.from('pledges').update({
        points_at_invoice: puntos,
        team_amount: total,
        amount: total,
        platform_amount: 0,
      }).eq('id', p.id);

      try {
        await sendChallengeNotice({
          to: p.correo,
          name: p.padrino,
          who: p.jugador,
          lang: p.idioma,
          points: puntos,
          teamName, retoName,
          contactName: contacto.name || null,
          contactEmail: contacto.email || null,
          payHow,
          rate: Number(p.tarifa),
          pledged: total,
          // Para que el correo no cuente una multiplicación que no se
          // hizo: el tope sólo se menciona si de verdad mordió.
          cap:   p.tope != null && total < +(Number(p.tarifa) * puntos).toFixed(2)
                   ? Number(p.tope) : null,
          bruto: p.tope != null && total < +(Number(p.tarifa) * puntos).toFixed(2)
                   ? +(Number(p.tarifa) * puntos).toFixed(2) : null,
        });

        // Sólo después de que el correo salió. 'sent' aquí quiere
        // decir avisado, no facturado: no hay factura.
        await supabase.from('pledges').update({
          invoice_status: 'sent',
          invoiced_at: new Date().toISOString(),
        }).eq('id', p.id);
        out.sent++;
      } catch (e) {
        // La fila se queda en 'open' con su cifra buena, así que se
        // puede volver a pulsar el botón y sale sólo lo que faltó.
        out.failed++;
        out.errors.push(`${p.correo}: ${e.message}`);
      }
    }

    /* ── LA FACTURA SALE CON LOS AVISOS ──────────────────────────
       La regla que firma el programa es que no se debe nada hasta
       que los resultados estén dados, y el momento en que se dan es
       exactamente este: los avisos acabaron de salir. Así que la
       licencia se factura aquí y no hace falta que nadie se acuerde
       de pulsar nada.

       Tres cosas que hacen esto seguro:

       · Va al FINAL y en su propio try. Los correos ya salieron; una
         factura que falla no puede devolver un error que haga pensar
         que no salieron, ni repetirlos.

       · No factura si algún aviso falló. Al programa se le cobra
         cuando TODOS sus padrinos tienen su aviso, no antes. El
         entrenador arregla lo que falló, vuelve a pulsar, y entonces
         se factura. Cobrar con un padrino sin avisar sería cobrar por
         un resultado a medio dar.

       · No decide si hay que cobrar. Eso lo dice licencia_calculo:
         sin promesas contesta que no es cobrable y aquí no se crea
         ni fila ni factura. Sin promesas, sin cargo — como dice la
         página. */
    let licencia = { estado: 'no_intentada' };
    if (out.failed > 0) {
      licencia = { estado: 'avisos_pendientes' };
    } else {
      try {
        const r = await facturarLicencia(String(challenge_id));
        licencia = {
          estado: r.estado,
          why: r.why || null,
          amount_cents: r.vista ? r.vista.amount_cents : null,
          roster: r.vista ? r.vista.roster : null,
          program_email: r.vista ? r.vista.program_email : null,
          stripe_invoice_id: r.stripe_invoice_id || null,
          url: r.url || null,
          due_at: r.due_at || null
        };
      } catch (e) {
        /* No debería llegar aquí —facturarLicencia devuelve estados,
           no lanza— pero si lanzara, los correos siguen enviados y
           eso es lo que tiene que sobrevivir. */
        licencia = { estado: 'error', why: String(e && e.message || e) };
        console.error('challenge-notices licencia:', e);
      }
    }

    console.log(`Challenge ${challenge_id} notices —`, JSON.stringify(out),
                `licencia: ${licencia.estado}`);
    return res.json({ ok: true, campaign: teamName, challenge: retoName, ...out, licencia });
  } catch (e) {
    console.error('Challenge notices:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ── La licencia ──────────────────────────────────────────────────
const LICENCIA_DIAS = 7;

/* Live o prueba, leído del prefijo de la llave. Esto es lo que hace
   que el admin avise en rojo antes de mandarle una factura de verdad
   a un programa de verdad, así que equivocarse aquí no es un
   detalle.

   Cuenta sk_ y rk_: una llave restringida —la que conviene darle a
   este servidor, que sólo necesita clientes, facturas y líneas de
   factura— empieza por rk_, no por sk_. Mirando sólo sk_, una rk_
   live caía en 'sin llave', el admin la enseñaba como modo de
   prueba y el aviso rojo no salía. La factura habría sido real y la
   pantalla habría dicho que no se movía dinero. */
function modoDeStripe() {
  const k = process.env.STRIPE_SECRET_KEY || '';
  if (/^(sk|rk)_live/.test(k)) return 'live';
  if (/^(sk|rk)_test/.test(k)) return 'test';
  return 'sin llave';
}

/* ── La cuenta, aparte de quien la pide ───────────────────────────
   Dos sitios facturan la misma licencia: el botón del admin y el
   final de los avisos. Por eso esto NO lanza ni contesta HTTP:
   devuelve un estado con nombre, y cada lado decide qué hacer con
   él. Una excepción aquí tiraría abajo una tanda de correos que ya
   salió, y eso no se puede retirar. */
async function calcularLicencia(challenge_id) {
  const { data: calc, error } =
    await supabase.rpc('licencia_calculo', { p_challenge: challenge_id });
  if (error) return { estado: 'error', why: error.message };
  if (!calc || !calc.ok) {
    return { estado: 'sin_calculo', why: (calc && calc.why) || 'sin cálculo' };
  }

  const vista = {
    modo: modoDeStripe(),
    challenge: calc.challenge,
    programa: calc.programa,
    roster: calc.roster,
    promesas: calc.promesas,
    cobrable: calc.cobrable,
    amount_cents: calc.amount_cents,
    program_name: calc.program_name,
    program_email: calc.program_email,
    ya_facturada: calc.ya_facturada,
    licencia: calc.licencia,
    dias: LICENCIA_DIAS
  };

  if (calc.ya_facturada) return { estado: 'ya_facturada', vista, calc };
  /* Sin promesas, sin cargo. Es lo que dice la página y lo que firma
     el programa, así que no puede depender de que nadie se acuerde:
     se niega aquí, antes de que exista fila o factura. */
  if (!calc.cobrable)      return { estado: 'sin_promesas', vista, calc };
  if (!calc.program_email) return { estado: 'sin_correo',   vista, calc };
  return { estado: 'listo', vista, calc };
}

async function facturarLicencia(challenge_id) {
  const paso = await calcularLicencia(challenge_id);
  if (paso.estado !== 'listo') return paso;
  const { calc, vista } = paso;

  // ── La fila primero ─────────────────────────────────────────────
  const { data: fila, error: errFila } = await supabase
    .from('licencias')
    .insert({
      challenge_id,
      campaign_id: calc.campaign_id,
      amount_cents: calc.amount_cents,
      roster: calc.roster,
      promesas: calc.promesas,
      program_email: calc.program_email,
      program_name: calc.program_name,
      estado: 'open'
    })
    .select()
    .single();

  if (errFila) {
    /* 23505 = llave duplicada: ya se facturó entre el cálculo y
       esto. Es exactamente lo que el índice existe para hacer, así
       que no es un fallo. Importa más que antes: ahora hay dos
       caminos que pueden llegar aquí a la vez —el botón y los
       avisos— y el índice es lo único que impide dos facturas por
       un mismo evento. */
    if (errFila.code === '23505') return { estado: 'ya_facturada', vista };
    return { estado: 'error', why: errFila.message, vista };
  }

  // ── Y ahora Stripe ──────────────────────────────────────────────
  try {
    const hay = await stripe.customers.list({ email: calc.program_email, limit: 1 });
    const cliente = (hay.data && hay.data[0])
      || await stripe.customers.create({
           email: calc.program_email,
           name: calc.program_name || calc.programa || undefined,
           metadata: { campaign_id: String(calc.campaign_id || '') }
         });

    const concepto = `Hooporia — licencia del evento: ${calc.challenge}`;

    /* La factura antes que la línea, y la línea atada a ella por su
       id. Al revés —líneas sueltas y luego la factura— Stripe barre
       TODAS las líneas pendientes de ese cliente, así que una línea
       que se quedó de un intento fallido acabaría cobrada dentro de
       la factura siguiente. */
    const factura = await stripe.invoices.create({
      customer: cliente.id,
      collection_method: 'send_invoice',
      days_until_due: LICENCIA_DIAS,
      description: concepto,
      auto_advance: false,
      metadata: {
        producto: 'hooporia',
        challenge_id: String(challenge_id),
        licencia_id: String(fila.id)
      }
    });

    await stripe.invoiceItems.create({
      customer: cliente.id,
      invoice: factura.id,
      amount: calc.amount_cents,
      currency: 'usd',
      description: `${concepto} · plantilla de ${calc.roster}`
    });

    const firmada = await stripe.invoices.finalizeInvoice(factura.id);
    const enviada = await stripe.invoices.sendInvoice(firmada.id);

    const { data: puesta } = await supabase
      .from('licencias')
      .update({
        estado: 'enviada',
        stripe_invoice_id: enviada.id,
        stripe_hosted_url: enviada.hosted_invoice_url || null,
        issued_at: new Date().toISOString(),
        due_at: enviada.due_date ? new Date(enviada.due_date * 1000).toISOString() : null
      })
      .eq('id', fila.id)
      .select()
      .single();

    console.log(`Licencia ${fila.id} facturada: ${enviada.id} (${modoDeStripe()})`);
    return {
      estado: 'enviada', vista,
      stripe_invoice_id: enviada.id,
      url: enviada.hosted_invoice_url || null,
      due_at: puesta ? puesta.due_at : null
    };

  } catch (eStripe) {
    /* No llegó a haber factura, así que la fila sobra — y dejarla
       marcaría el evento como cobrado sin haberlo cobrado, y el
       índice único impediría reintentarlo. */
    await supabase.from('licencias').delete().eq('id', fila.id);
    console.error('Licencia — Stripe falló, fila retirada:', eStripe);
    return { estado: 'stripe', why: String(eStripe && eStripe.message || eStripe), vista };
  }
}

/* Un estado con nombre, un código HTTP. Lo usa /licencia; los avisos
   no contestan con esto porque un problema de factura no puede
   convertir unos correos que salieron en una respuesta de error. */
const HTTP_LICENCIA = {
  sin_calculo:  [404, 'no_calc'],
  ya_facturada: [409, 'ya_facturada'],
  sin_promesas: [422, 'sin_promesas'],
  sin_correo:   [422, 'sin_correo'],
  stripe:       [502, 'stripe'],
  error:        [500, 'error']
};

app.post('/licencia', async (req, res) => {
  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Not authorized' });

  const { challenge_id, confirmar } = req.body || {};
  if (!challenge_id) return res.status(400).json({ error: 'challenge_id is required' });

  try {
    /* Sin confirmar no se factura: se calcula y se enseña. El botón
       sigue existiendo para la licencia que los avisos no pudieron
       sacar —Stripe caído, programa sin correo— y para ver la cuenta
       antes de que salga. */
    const paso = confirmar === true
      ? await facturarLicencia(String(challenge_id))
      : await calcularLicencia(String(challenge_id));

    if (paso.estado === 'listo') {
      return res.json({ vista_previa: true, ...paso.vista });
    }
    if (paso.estado === 'enviada') {
      return res.json({
        ok: true, ...paso.vista,
        estado: 'enviada',
        stripe_invoice_id: paso.stripe_invoice_id,
        url: paso.url,
        due_at: paso.due_at
      });
    }

    const [codigo, nombre] = HTTP_LICENCIA[paso.estado] || [500, 'error'];
    return res.status(codigo).json({
      error: nombre,
      why: paso.why || null,
      ...(paso.vista || {})
    });

  } catch (e) {
    console.error('/licencia:', e);
    return res.status(500).json({ error: String(e && e.message || e) });
  }
});

// ── Un programa pidiendo campaña ─────────────────────────────────
app.post('/team-signup', async (req, res) => {
  const { team, program, coach, email, phone, license } = req.body || {};

  if (!team || !email) {
    return res.status(400).json({ error: 'team and email are required' });
  }

  const to = process.env.ADMIN_EMAIL || 'gostardigital@gmail.com';

  const row = (k, v) =>
    `<tr><td style="padding:6px 14px 6px 0;color:#5A6B7C">${k}</td>` +
    `<td style="padding:6px 0;font-weight:700">${v || '—'}</td></tr>`;

  const html = `
    <div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#12202E">
      <p style="font-size:.72rem;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#0C6E8C;margin:0 0 6px">
        Hooporia
      </p>
      <h1 style="font-size:1.4rem;margin:0 0 14px">${team} quiere una campaña</h1>
      <table style="width:100%;border-collapse:collapse;font-size:.95rem">
        ${row('Equipo', team)}
        ${row('Programa', program)}
        ${row('Coach', coach)}
        ${row('Correo', `<a href="mailto:${email}">${email}</a>`)}
        ${row('Teléfono', phone)}
      </table>

      ${license && license.accepted ? `
      <div style="margin:18px 0 0;padding:14px 16px;border:1px solid #D7E0E8;border-left:4px solid #FF7A18;border-radius:8px">
        <p style="margin:0 0 6px;font-size:.68rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#FF7A18">
          Licencia aceptada
        </p>
        <p style="margin:0 0 8px;font-size:.9rem">
          <b>${license.by || coach || '—'}</b> · ${license.at || '—'}
        </p>
        <p style="margin:0;color:#5A6B7C;font-size:.82rem;line-height:1.5">
          ${String(license.terms || '').replace(/<[^>]*>/g, '')}
        </p>
      </div>` : `
      <p style="margin:18px 0 0;color:#A8323F;font-size:.9rem">
        Sin acuse de licencia en esta solicitud.
      </p>`}
      <p style="margin:18px 0 0;color:#5A6B7C;font-size:.9rem">
        Aprueba o rechaza desde el admin — la petición ya está en la cola.
      </p>
      <p style="color:#5A6B7C;font-size:.8rem;margin-top:20px">
        Gostar Digital LLC · Puerto Rico
      </p>
    </div>`;

  const text =
    `${team} quiere una campaña\n\n` +
    `Equipo:   ${team}\n` +
    `Programa: ${program || '—'}\n` +
    `Coach:    ${coach || '—'}\n` +
    `Correo:   ${email}\n` +
    `Teléfono: ${phone || '—'}\n\n` +
    (license && license.accepted
      ? `Licencia aceptada por ${license.by || coach || '—'} el ${license.at || '—'}\n` +
        `${String(license.terms || '').replace(/<[^>]*>/g, '')}\n\n`
      : `SIN acuse de licencia en esta solicitud.\n\n`) +
    `Aprueba desde el admin.\n`;

  try {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [to],
        reply_to: email,          // contestar le escribe al coach
        subject: `Nuevo equipo: ${team}`,
        html, text,
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      throw new Error(`Resend refused the notice (${r.status}): ${detail.slice(0, 200)}`);
    }

    return res.json({ ok: true });
  } catch (e) {
    // El aviso es un extra: que falle no puede romper la inscripción.
    console.error('Team signup notice:', e.message);
    return res.json({ ok: false, note: 'request saved, notice failed' });
  }
});


app.get('/', (req, res) =>
  res.send('Hooporia server — avisos y licencias. Nada de pagos de padrinos.'));

/* ── ¿En qué modo estoy? ──────────────────────────────────────────
   «¿Estoy en live?» se contestaba abriendo el admin, eligiendo una
   campaña, abriendo un reto CON promesas y mirando la vista previa
   de la licencia. Después de limpiar los datos de prueba no hay
   ninguna de esas cosas, así que justo cuando se cambian las llaves
   —el momento en que más importa— era cuando no se podía mirar.

   No enseña ninguna llave: sólo el prefijo, que es lo único que
   hace falta saber, y si cada variable está puesta o no. Nada de
   esto le sirve a nadie que no la tenga ya. */
// ══════════════════════════════════════════════════════════════════
//  LA AYUDA DEL ENTRENADOR VIVE AQUÍ DESDE EL 22 DE OCTUBRE DE 2026
//
//  Vino del servidor compartido, que es donde se construyó. Hooporia
//  ya tenía todo lo demás aquí —avisos, licencia, webhook, alta de
//  programa— y le quedaba ESTA sola llamada al otro: ayuda.html
//  pedía /coach/chat a basketball-money-payments.
//
//  Una ruta no parece mucho, hasta la mañana en que hay que desplegar
//  un arreglo de la ayuda y los dos repos tienen un fichero llamado
//  server.js. Ese día se despliega el del otro producto encima de
//  éste. Pasó. Por eso está aquí.
//
//  Cada Punto sigue pidiéndosela al compartido y eso no cambia: allí
//  tiene cinco llamadas más, así que moverle ésta sola lo dejaría
//  hablando con tres servidores en vez de dos. Mientras tanto hay dos
//  copias de este bloque, y son IGUALES a propósito — el texto no
//  nombra ningún producto, justamente para que valga en los dos. Si
//  tocas una, toca la otra; prueba-ayuda-marca.js corre en los dos
//  repos y las vigila por separado. Cuando Cada Punto termine de
//  mudarse, la copia de allí se borra.
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
//  POST /coach/chat — la ayuda del entrenador, contestada.
//
//  Dos reglas, y las dos se cumplen aquí dentro y no en el navegador:
//
//  1. Sólo entra quien tiene código. Se comprueba AQUÍ con
//     builder_check. Que la página ya lo haya comprobado no cuenta:
//     cualquiera puede llamar a este endpoint a mano.
//
//  2. Lo de dinero NO lo contesta el modelo. Nunca. Cuándo se paga,
//     el 20%, el tope del padrino, los impuestos — eso sale de DINERO
//     palabra por palabra, el mismo texto que está en ayuda.html. Y si
//     el modelo devuelve una cifra de todas formas, se tira la
//     respuesta entera. Un entrenador que recibe una fecha de pago
//     equivocada de algo que lleva nuestro logo nos cuesta el programa.
// ══════════════════════════════════════════════════════════════════

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
// Se puede cambiar en Render sin tocar el código.
const COACH_CHAT_MODEL = process.env.COACH_CHAT_MODEL || 'claude-haiku-5-5';

// ── Los topes ───────────────────────────────────────────
// Todos se cambian en Render sin tocar el código. El que de verdad
// protege la factura es el tercero: es el techo del día entero,
// entren los entrenadores que entren.
const topeDe = (v, porDefecto) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : porDefecto;
};
const LIM_HORA  = topeDe(process.env.COACH_CHAT_PER_HOUR, 12);   // por entrenador
const LIM_DIA   = topeDe(process.env.COACH_CHAT_PER_DAY, 30);    // por entrenador
const LIM_TODOS = topeDe(process.env.COACH_CHAT_TOTAL_DAY, 250); // entre todos
// Interruptor de emergencia: COACH_CHAT_OFF=1 y el chat se apaga sin
// tener que quitar la llave ni desplegar nada.
const CHAT_APAGADO = String(process.env.COACH_CHAT_OFF || '') === '1';

// Lo que el entrenador puede preguntar y el modelo sí puede contestar.
// Es el mismo contenido de ayuda.html menos la sección El dinero, que
// no pasa por aquí.
//
// SIN MARCA, A PROPÓSITO. Este endpoint lo comparten los dos
// productos: el entrenador de baloncesto entra por Hooporia y el
// programa de escuela por Cada Punto, con el mismo código y la misma
// base. Antes esto decía "Cada Punto" seis veces, así que a un
// entrenador de Hooporia la ayuda le contestaba con el nombre del
// otro producto — y la ayuda es justo donde va el que ya está
// confundido.
//
// La salida no es preguntarle a la base de qué producto es cada
// código y tener dos textos que mantener. Es que el texto no nombre
// ninguno: el que escribe está DENTRO de su propia página y ya sabe
// dónde está. La ayuda habla de "nosotros" y de lo que hace la
// plataforma, y eso es verdad en los dos sitios.
const COACH_KB = `Eres la ayuda para entrenadores de esta plataforma. Esto es
una recaudación por promesas: los padrinos de un nene prometen unos centavos por
cada punto que anote ESE nene jugando The Fortress, dentro de un día de juego que
pone el programa. Cuando cierra la ventana se cobra solo.

NO NOMBRAS EL PRODUCTO. Ni el de baloncesto ni el de escuelas: el que te escribe
está dentro de su propia página y ya sabe en cuál está, y si le dices el nombre
del otro lo mandas a dudar de dónde metió a sus nenes. Habla de "esto", de "la
plataforma" y de "nosotros". Si te preguntan cómo se llama, descríbelo por lo
que hace y déjalo ahí.

Contesta SOLO con lo que está aquí abajo. Hablas con un entrenador, no con un
padrino.

QUÉ ES ESTO Y CÓMO SE EMPIEZA
- Es una recaudación por promesas para equipos y programas. Los
  padrinos de cada nene prometen unos centavos por cada punto
  que anote ese nene jugando The Fortress. Se juega el día de juego, el juego
  guarda los puntos solo, y de ahí sale lo que recaudó el programa.
- El entrenador NO pone marcadores. No hay nada que escribir. Eso cambió.
- Lo lleva Gostar Digital LLC, en Puerto Rico.
- Nadie se da de alta solo. NO hay un botón de crear tu cuenta ni de
  crear tu campaña. Las campañas las abrimos nosotros a mano, una por
  una. El programa no abre nada por su lado: nos lo pide y se lo
  montamos.
- Un programa que quiere empezar lo dice en cadapunto.com/contact.html
  ("Habla con nosotros"), o escribe a gostardigital@gmail.com. Cuenta de
  qué escuela, club o grupo es y para qué quiere recaudar. Nosotros
  armamos la campaña, el tablero y los enlaces, y le damos su código a
  cada entrenador. Nada sale al aire hasta que el programa lo diga.
- Así que a quien pregunte cómo apuntarse, cómo empezar, cómo abrir una
  cuenta o cómo crear una campaña, mándalo a cadapunto.com/contact.html o
  al correo. No le digas que se registre ni que cree nada por su cuenta,
  porque eso no existe.
- Un entrenador que YA tiene su código no tiene que apuntarse a nada:
  entra directo en cadapunto.com/mi-equipo.html.
- Lo que se apunta con un enlace es otra cosa: son los jugadores, con el
  enlace que su entrenador le manda al grupo del equipo.

EL FORTRESS — EL JUEGO SOBRE EL QUE SE RECAUDA
- The Fortress es el juego. Se juega en cadapunto.com/fortress-vr.html, en el
  teléfono, la tableta o la computadora. No hace falta instalar nada.
- Qué es: cinco bolas puestas delante, en 2-1-2. Se enciende una cadena de bolas
  en orden y hay que repetirla tocándolas. Cada ronda la cadena crece en una.
  Aguantar doce rondas son 78 puntos.
- Los puntos de una cadena son 1+2+3+... hasta el nivel que aguantó. Por eso
  cada ronda que se aguanta vale más que la anterior.
- Si se falla, se acabó esa tirada y empieza otra. Dentro de un cuarto se puede
  tirar las veces que dé el tiempo.
- Práctica: gratis, sin reloj, todas las veces que se quiera. No se guarda nada
  y no se cobra nada. El botón dice "Práctica · sin reloj".
- Scrimmage: los cuatro cuartos completos, para probar cómo se siente. Tampoco
  cuenta para nada.
- Con un casco de realidad virtual también se puede practicar, con la cabeza en
  vez de con el dedo. Pero el día de juego NO se juega con casco: sólo pantalla.
  Es a propósito, para no tener que repartir cascos a nadie.

ENTRAR
- Entra en cadapunto.com/mi-equipo.html con el código que se le dio.
- Se escribe una sola vez: ese teléfono queda sabiendo quién es, para la
  plantilla y el tablero.
- Si se lo vuelve a pedir, está en otro teléfono, otro navegador o una ventana
  privada.
- Si dice que el código no sirve: casi siempre son espacios pegados al copiar y
  pegar. Si sigue, que escriba al correo.
- Códigos perdidos no se pueden buscar: se guardan cifrados. Se hace uno nuevo.

LA PLANTILLA (cadapunto.com/plantilla.html)
- Dos maneras de apuntar jugadores, y valen a la vez: el entrenador pega los
  nombres uno por línea, o manda el enlace de apuntarse al grupo del equipo y
  cada familia se apunta sola. La segunda es la buena: cada nene recibe su
  propio enlace para sus padrinos.
- Un nene que se apuntó y no aparece está esperando aprobación. Sale arriba, en
  un recuadro anaranjado, con Aprobar y Rechazar. Mientras no se apruebe no sale
  en ningún sitio, y es a propósito.
- Se fue un nene: botón Sacar. Baja al final en gris y deja de salir en el
  tablero. No se borra y vuelve con un toque. Borrar sale después de sacarlo, y
  no se puede si ya tiene promesas encima.
- Nombre mal escrito: botón Arreglar, en su fila. Ahí mismo se le cambia la
  escuadra.

EL DÍA DE JUEGO
- La recaudación es UN día de juego. No hay calendario, no hay temporada, no hay
  interescuadra. Eso se quitó.
- El día de juego es una ventana de horas — dos por defecto — que ponemos
  nosotros a petición del programa. Dentro de esa ventana cada nene juega su
  partido, desde donde esté. No hay que juntar a nadie ni prestar equipos.
- El partido de un nene son CUATRO cuartos de cinco minutos. Cada cuarto vale la
  mejor tirada que haya hecho dentro de ese cuarto, y los cuatro se suman. Por
  eso cada tirada cuenta: no es el total del cuarto, es la mejor.
- Un cuarto que no se termine dentro de la ventana vale cero. Si se le muere la
  batería, que vuelva a abrir el mismo enlace: los cuartos que ya puso siguen
  puestos y sigue donde iba, mientras la ventana esté abierta.
- Un nene juega su partido UNA vez. Un cuarto ya guardado no se vuelve a jugar,
  ni recargando ni con otro teléfono.
- Las promesas se cierran cuando ABRE el día de juego. Después no entra ninguna,
  y es a propósito: prometer sabiendo lo que anotó el nene no es prometer.
- Para abrir un día de juego, que nos escriba con la fecha y la hora. No hay
  botón para eso: lo ponemos nosotros.

EL MARCADOR SE PONE SOLO
- Nadie escribe un marcador. El juego guarda cada cuarto según se juega. El
  entrenador no tiene nada que hacer el día de juego, y no puede cambiar un
  número aunque quiera.
- El tablero en vivo está en cadapunto.com/tablero.html y también sale desde Mi
  equipo, en "Ver el tablero". Enseña cada nene con sus cuatro cuartos llegando,
  su total, y si ya terminó o va por el segundo. Se refresca solo.
- Cuando cierra la ventana se cobra solo: a cada padrino le sale su enlace de
  pago por correo, sin que nadie apriete nada.
- Se recauda por los puntos que anotó el nene. No se gana ni se pierde contra
  nadie: no hay rival. El único rival es la cadena.
- Si un cuarto se guardó mal, que avise y lo miramos. Se corrige y se les dice a
  los padrinos.

DE QUÉ MÁS PUEDES HABLAR
- Hablas con quien lleva un grupo de nenes: unos son entrenadores de
  baloncesto y otros llevan un programa de escuela. Sigue al que te escribe.
  Si te habla de baloncesto, habla de baloncesto —reglas, posiciones,
  ejercicios, cómo montar una práctica, qué trabajar con un equipo que no tira
  bien—; si te habla de su salón o de su grupo, habla de eso. Corto, normal y
  con gusto, y vuelve a lo tuyo si viene a cuento.
- Si es gente de baloncesto, puedes hablar del baloncesto de Puerto Rico en
  general, de su historia y de lo que significa allí, con cariño y sin
  inventar.
- PERO hay una raya que no se cruza: NADA de lo que pase ahora mismo o de lo que
  haya que comprobar. No sabes quién ganó anoche, ni cómo va la tabla, ni quién
  juega en qué equipo esta temporada, ni qué pasó en un partido, ni lo que haya
  salido en las noticias. No lo sabes y no lo puedes mirar. Dilo tal cual: "de lo
  que está pasando ahora no me entero", y sigue.
- Tampoco sabes nada del equipo de quien te escribe: ni cuándo es su día de
  juego, ni quién está en su plantilla, ni cómo van de puntos. Eso lo ve él en
  su propia página, entrando con su código, y los puntos en el tablero.
- Nunca des un nombre, una fecha, un resultado o una cifra que no te hayan dado
  aquí. Si no lo sabes, dilo. Decir "no sé" es la respuesta correcta y no es un
  fallo.
- Nada de política, religión, salud, dinero de nadie, ni consejo legal. Si sale,
  dilo con buen modo y vuelve a lo tuyo.

CÓMO CONTESTAS
- Por defecto, en el idioma que te diga el sistema abajo del todo, aunque la
  pregunta venga escrita en el otro. El que lee tiene la página puesta en ese
  idioma y no quiere que se le cambie sola a media conversación.
- PERO si te PIDEN cambiar de idioma — "háblame en inglés", "can we talk in
  English", "en español por favor" — cambias ahí mismo y sigues en ese idioma el
  resto de la conversación. Eso lo manda el que pregunta, no la página. Nunca le
  digas que sólo puedes contestar en un idioma, porque no es verdad.
- Cuando cambies, dile de paso que con el botón EN/ES de arriba cambia la página
  entera, no sólo lo que tú le contestas.
- Corto: tres o cuatro frases. Dile qué botón tocar y en qué página.
- Palabras llanas. Nada de jerga ni de listas largas.
- No te inventes NADA. Ni una cifra, ni una fecha, ni un porcentaje, ni un plazo,
  ni un nombre de página que no esté aquí arriba.
- No prometas lo que vamos a hacer nosotros.
- Nunca des códigos, nombres de nenes, ni nada de otro equipo. Si te lo piden,
  dile que eso no lo puedes dar.
- Si te preguntan algo que no esté contestado aquí arriba — de la plataforma,
  de una campaña, de un cobro, de algo que haya que mirar por dentro — dilo y
  manda a escribir a gostardigital@gmail.com. Decir "eso no lo sé, escríbenos"
  es la respuesta correcta y no es un fallo.
- Pero no mandes al correo lo que puedas contestar tú. Un entrenador que
  pregunta cómo trabajar los tiros libres quiere una respuesta, no una
  dirección.
- Eres una ayuda, no una persona. No tienes nombre y no dices que eres John ni
  nadie de Gostar Digital.
- Pero hablas DE PARTE de la plataforma, no de fuera. Cuando digas lo que
  hacemos, di "nosotros": nosotros armamos la campaña, nosotros damos los
  códigos, escríbenos. Nunca "ellos", ni "la empresa", ni "el equipo" —
  estás en su propia página y eso suena a que esto es de otra gente.`;

// ── Lo de dinero, palabra por palabra ─────────────────────────────
// El mismo texto que ayuda.html y que cuadra con terms.html y
// custodia.html. Si una de esas cambia, esto cambia. El modelo no
// toca ninguna de estas respuestas.
const DINERO = [
  { k: /(cu[aá]ndo|cuando|when).{0,40}(me pag|pagan|cobro yo|remit|get paid|paid)|(pag|paid|remit).{0,25}(cu[aá]ndo|when)|d[ií]a 15|15th/i,
    es: 'Te pagamos el día 1 y el día 15 de cada mes, por lo cobrado hasta ese día. Si por alguna razón no podemos remitir en esa fecha, te lo decimos antes de que pase.',
    en: 'We pay on the 1st and the 15th of each month, for whatever has been collected by then. If for any reason we cannot send on that date, we tell you before it passes.' },

  { k: /(a d[oó]nde|ad[oó]nde|donde).{0,30}(pag|cobr)|cobro\.html|ath m[oó]vil|where.{0,20}pay me|bank|cuenta de banco/i,
    es: 'A donde nos digas en cadapunto.com/cobro.html, con el mismo código. Es la cuenta ATH Móvil Business de la organización. Hazlo una vez, al principio.',
    en: 'Wherever you tell us at cadapunto.com/cobro.html, with the same code. It is the organisation’s ATH Móvil Business account. Do it once, at the start.' },

  { k: /(cu[aá]nto|qu[eé]).{0,30}(se quedan|cobran ustedes|comisi[oó]n|se llevan)|20\s?%|veinte por ciento|how much.{0,20}keep|your cut|commission|fee/i,
    es: 'Nada de lo tuyo. El programa recibe el 100% de lo prometido. Nuestro 20% se le suma al pago del padrino, encima de la promesa: una promesa de $25 es un pago de $25.00 más $5.00, y al programa le llegan los $25 completos. Sin cuota de entrada, sin mensualidad y sin contrato.',
    en: 'Nothing of yours. The program receives 100% of what was pledged. Our 20% is added to the padrino’s payment, on top of the pledge: a $25 pledge is a payment of $25.00 plus $5.00, and the program receives the full $25. No setup fee, no monthly fee, no contract.' },

  { k: /deducib|impuesto|tax|irs|recibo para|hacienda|donaci[oó]n deduc|write ?off|501/i,
    es: 'No decimos que lo sea. Gostar Digital LLC es una empresa con fines de lucro, no una organización sin fines de lucro, y no emitimos recibos para impuestos. Si a un padrino le importa cómo se trata su pago, que lo consulte con su asesor.',
    en: 'We do not say that it is. Gostar Digital LLC is a for-profit company, not a non-profit, and we do not issue tax receipts. If how their payment is treated matters to a padrino, they should ask their own advisor.' },

  { k: /(tope|m[aá]ximo|l[ií]mite|fortuna|m[ií]nimo|minimum|cap\b|owe|debiendo|deber[aá]|too much)/i,
    es: 'El padrino pone su propio tope cuando promete, y el tope manda — no puede terminar debiendo más de eso. También hay un cobro mínimo de $5.',
    en: 'The padrino sets their own cap when they pledge, and the cap wins — they cannot end up owing more than that. There is also a $5 minimum charge.' },

  { k: /(cu[aá]ndo|cuando|when).{0,40}(cuenta|factura|cobr|bill|invoice|charge)|le llega la cuenta|les llega/i,
    es: 'Cuando pones el marcador, el juego se cierra y se calcula lo de cada padrino. Las cuentas salen desde el admin, así que puede haber unas horas entre que pones el marcador y que les llega.',
    en: 'When you post the score the game closes and every padrino’s amount is worked out. The bills go out from the admin side, so there can be a few hours between your posting the score and their receiving it.' },
];

// Cualquier otra cosa que huela a dinero y no sea una de las de arriba
// tampoco la contesta el modelo. Va a la página y al correo.
const OLOR_A_DINERO = /\$|dinero|plata|pago|pagar|pagos|cobr|factura|precio|cuesta|tarifa|por ciento|%|money|payment|pay\b|paid|charge|refund|reembolso|devoluci[oó]n|stripe|tarjeta|card\b|banco|bank/i;

const SIN_CIFRAS = {
  es: 'Eso es de dinero, y no te lo voy a contestar de memoria. Está escrito en la sección El dinero de esta misma página — bájale y ábrela. Si lo que preguntas no está ahí, escríbenos a gostardigital@gmail.com y te contestamos el mismo día.',
  en: 'That is a money question, and I will not answer it from memory. It is written out in The money section of this same page — scroll down and open it. If what you are asking is not there, write to gostardigital@gmail.com and we answer the same day.',
};

// ¿En qué idioma pregunta? Una tilde, una ñ o un signo de abrir ya
// lo deciden. Si no trae ninguno — y mucha gente escribe sin tildes —
// se cuentan palabras de cada lado y gana la que tenga más. Mirar sólo
// si había palabras inglesas contestaba en español a "is this tax
// deductible", que no lleva ninguna de las palabras obvias.
const PAL_ES = /\b(que|como|cuando|donde|cual|cuanto|para|por|porque|mi|mis|me|el|la|los|las|un|una|del|con|hay|esto|esta|eso|no|si|puedo|tengo|quiero|juego|juegos|marcador|equipo|codigo|jugador|jugadores|nene|nenes|plantilla|escuadra|padrino|padrinos|pongo|poner|apunt\w*|sirve)\b/g;
const PAL_EN = /\b(the|is|are|was|how|when|what|where|why|which|do|does|did|can|could|should|my|i|you|it|this|that|they|not|and|of|for|with|score|roster|game|games|team|pay|paid|sign|player|players|code|squad|padrino|padrinos|cannot|about)\b/g;
function idioma(t) {
  const s = String(t || '').toLowerCase();
  if (/[áéíóúñ¿¡]/.test(s)) return 'es';
  const es = (s.match(PAL_ES) || []).length;
  const en = (s.match(PAL_EN) || []).length;
  return en > es ? 'en' : 'es';
}

// El idioma lo decide el botón de la página, no la frase suelta. Una
// conversación en español con una pregunta escrita en inglés seguía
// en español para el que la lee; adivinarlo mensaje a mensaje la partía
// en dos. Si la página no lo manda — una copia vieja en caché — se
// vuelve a adivinar como antes.
function idiomaDe(body, pregunta) {
  const l = String((body && body.lang) || '').toLowerCase();
  if (l === 'es' || l === 'en') return l;
  return idioma(pregunta);
}

// La cuenta va en la base, no en memoria. En memoria tenía un agujero:
// Render reinicia el servicio cuando le parece y en cada reinicio la
// cuenta volvía a cero. Un tope que se borra solo no es un tope.
//
// No se guarda el código, se guarda un hash. Esa tabla no sirve para
// entrar en ningún sitio.
const crypto = require('crypto');
const huella = (code) =>
  crypto.createHash('sha256').update(String(code)).digest('hex').slice(0, 24);

// Sube los tres cubos y dice cómo quedaron. Si no se puede contar, NO
// se llama al modelo — se falla cerrado. Entre dejar a un entrenador sin
// respuesta un rato y una factura que no vimos venir, preferimos lo
// primero: abajo tiene las 24 preguntas y el correo.
async function pasaElTope(code) {
  const ahora = new Date();
  const dia = ahora.toISOString().slice(0, 10);
  const hora = dia + 'T' + String(ahora.getUTCHours()).padStart(2, '0');
  const h = huella(code);

  const bH = 'h:' + h + ':' + hora;
  const bD = 'd:' + h + ':' + dia;
  const bT = 'all:' + dia;

  const { data, error } = await supabase.rpc('coach_chat_bump', { p_buckets: [bH, bD, bT] });
  if (error) {
    console.error('coach/chat no se pudo contar:', error);
    return { ok: false, motivo: 'contador' };
  }
  const c = data || {};
  if ((c[bT] || 0) > LIM_TODOS) return { ok: false, motivo: 'todos' };
  if ((c[bD] || 0) > LIM_DIA)   return { ok: false, motivo: 'dia' };
  if ((c[bH] || 0) > LIM_HORA)  return { ok: false, motivo: 'hora' };
  return { ok: true, hoy: c[bT] || 0 };
}

const TOPE_DICHO = {
  hora: {
    es: 'Son muchas preguntas seguidas. Espera un rato y sigue, o escríbenos a gostardigital@gmail.com y te contesta una persona.',
    en: 'That is a lot of questions at once. Wait a while and carry on, or write to gostardigital@gmail.com and a person will answer you.' },
  dia: {
    es: 'Ya hiciste bastantes preguntas hoy. Mañana sigue, y mientras tanto escríbenos a gostardigital@gmail.com.',
    en: 'You have asked plenty today. Carry on tomorrow, and in the meantime write to gostardigital@gmail.com.' },
  todos: {
    es: 'El chat llegó a su tope de hoy. Las preguntas de esta página están completas, y si no está lo tuyo escríbenos a gostardigital@gmail.com.',
    en: 'The chat has reached today\u2019s limit. The questions on this page are complete, and if yours is not there write to gostardigital@gmail.com.' },
  contador: {
    es: 'No puedo contestarte ahora mismo. Las preguntas de esta página están completas, y si no está lo tuyo escríbenos a gostardigital@gmail.com.',
    en: 'I cannot answer right now. The questions on this page are complete, and if yours is not there write to gostardigital@gmail.com.' },
};

app.post('/coach/chat', async (req, res) => {
  try {
    const code = String((req.body && req.body.code) || '').trim();
    const inMsgs = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
    if (!code) return res.status(400).json({ error: 'code is required' });
    if (!inMsgs.length) return res.status(400).json({ error: 'messages is required' });

    // 1. La puerta. Se comprueba aquí, no en el navegador.
    const { data: chk, error: chkErr } = await supabase.rpc('builder_check', { p_code: code });
    if (chkErr) {
      console.error('coach/chat builder_check error:', chkErr);
      return res.status(500).json({ error: 'check failed' });
    }
    if (!chk || !chk.ok) return res.status(401).json({ error: 'bad code' });

    // Sólo las últimas, y cortadas. Nadie necesita mandar un libro.
    const msgs = inMsgs
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
      .slice(-10)
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 1200) }));
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'last message must be from the user' });
    }

    const pregunta = msgs[msgs.length - 1].content;
    const lang = idiomaDe(req.body, pregunta);

    // 2. El dinero no pasa por el modelo.
    for (const d of DINERO) {
      if (d.k.test(pregunta)) return res.json({ reply: d[lang] || d.es, fixed: true });
    }
    if (OLOR_A_DINERO.test(pregunta)) {
      return res.json({ reply: SIN_CIFRAS[lang], fixed: true });
    }

    if (!ANTHROPIC_API_KEY || CHAT_APAGADO) return res.status(503).json({ error: 'chat is off' });

    // El tope se mira AQUÍ, y no arriba, a propósito: las respuestas
    // fijas de dinero no cuestan nada, así que no tienen por qué
    // gastarle la cuota a nadie. Sólo cuenta lo que llega al modelo.
    const tope = await pasaElTope(code);
    if (!tope.ok) {
      return res.status(429).json({ reply: TOPE_DICHO[tope.motivo][lang], fixed: true });
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        // Sin temperature: estos modelos piensan antes de contestar y
        // no aceptan que se la toquemos. Y max_tokens tiene que dar
        // para lo que piensa MÁS lo que escribe — con 400 se le iba
        // entero en pensar y devolvía una respuesta vacía.
        model: COACH_CHAT_MODEL,
        max_tokens: 1024,
        system: COACH_KB + '\n\nIDIOMA DE ESTA CONVERSACIÓN: ' +
          (lang === 'en' ? 'inglés. Contesta en inglés.'
                         : 'español. Contesta en español.'),
        messages: msgs,
      }),
    });

    if (!r.ok) {
      console.error('coach/chat model error:', r.status, await r.text());
      return res.status(502).json({ error: 'model failed' });
    }

    const out = await r.json();
    // La respuesta puede venir en varios bloques, y el primero puede ser
    // lo que pensó, no lo que dice. Se juntan los de texto y ya.
    const reply = (out.content || [])
      .filter((c) => c && c.type === 'text' && c.text)
      .map((c) => c.text)
      .join('\n')
      .trim();
    if (!reply) {
      console.error('coach/chat respuesta sin texto — stop_reason:', out.stop_reason,
                    '| bloques:', (out.content || []).map((c) => c.type).join(','));
      return res.status(502).json({ error: 'empty reply' });
    }

    // 3. El cinturón, por si el modelo se fue de cifras de todas
    //    formas. Si trae un número de dinero o un porcentaje, la
    //    respuesta se tira entera — no se recorta.
    if (/\$\s?\d|\d+\s?%|\bpor ciento\b|\bpercent\b/i.test(reply)) {
      console.warn('coach/chat: respuesta con cifras descartada');
      return res.json({ reply: SIN_CIFRAS[lang], fixed: true });
    }

    console.log('coach/chat ok — preguntas al modelo hoy:', tope.hoy, 'de', LIM_TODOS);
    res.json({ reply });
  } catch (e) {
    console.error('coach/chat error:', e);
    res.status(500).json({ error: String(e) });
  }
});

app.get('/estado', (req, res) => {
  const puesta = (n) => !!(process.env[n] || '').trim();
  res.json({
    ok: true,
    stripe: modoDeStripe(),
    variables: {
      STRIPE_SECRET_KEY:        puesta('STRIPE_SECRET_KEY'),
      STRIPE_WEBHOOK_SECRET:    puesta('STRIPE_WEBHOOK_SECRET'),
      SUPABASE_URL:             puesta('SUPABASE_URL'),
      SUPABASE_SERVICE_ROLE_KEY:puesta('SUPABASE_SERVICE_ROLE_KEY'),
      RESEND_API_KEY:           puesta('RESEND_API_KEY'),
      MAIL_FROM_HOOPORIA:       puesta('MAIL_FROM_HOOPORIA'),
      MAIL_REPLY_TO:            puesta('MAIL_REPLY_TO'),
      ADMIN_EMAIL:              puesta('ADMIN_EMAIL'),
      ANTHROPIC_API_KEY:        puesta('ANTHROPIC_API_KEY')
    },
    /* La ayuda, de un vistazo. Es lo primero que hay que mirar
       después de desplegar: sin llave contesta 503 y lo dice, pero lo
       dice sólo al entrenador que preguntó, y eso no se entera nadie
       hasta que es tarde. */
    ayuda: {
      encendida: !!ANTHROPIC_API_KEY && !CHAT_APAGADO,
      modelo: COACH_CHAT_MODEL,
      topes: { hora: LIM_HORA, dia: LIM_DIA, todos: LIM_TODOS }
    },
    /* El remitente sí se enseña entero: va escrito en la cabecera de
       cada correo que sale, así que no es un secreto, y es justo lo
       que hubo que adivinar esta mañana cuando los avisos caían en
       Promociones. */
    remitente: MAIL_FROM_HOOPORIA
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Hooporia server escuchando en ${PORT}`));
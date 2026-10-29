// ══════════════════════════════════════════════════════════════════
//  EL SERVIDOR DE HOOPORIA
//
//  Cada Punto Cuenta tiene su sitio, su admin y su base. Esto es lo que le
//  faltaba: su servidor.
//
//  Antes vivía dentro de uno de 3.300 líneas compartido con BOGO y
//  con Cada Punto, donde un cambio hecho para otro producto podía
//  romper el suyo sin que nadie lo notara. Aquí hay cuatro rutas y
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
//
//  Lo que NO hay aquí, y no lo habrá: cobrarle a un padrino. Cada Punto Cuenta
//  no procesa pagos de promesas, no verifica pagos y no persigue a
//  nadie. El dinero va del padrino al programa, directo. El único
//  cobro que existe es la licencia, y la paga el programa.
//
//  ── Variables de entorno ─────────────────────────────────────────
//    SUPABASE_URL
//    SUPABASE_SERVICE_ROLE_KEY
//    RESEND_API_KEY
//    MAIL_FROM_HOOPORIA        p.ej. Cada Punto Cuenta <avisos@cadapunto.com>
//    MAIL_REPLY_TO             opcional: a dónde contesta un padrino
//                              cuando el reto no trae contacto
//    ADMIN_EMAIL               a dónde llega una solicitud de campaña
//    STRIPE_SECRET_KEY
//    STRIPE_WEBHOOK_SECRET     del endpoint de ESTE host, no del otro
//
//  LA AYUDA DEL ENTRENADOR SE QUITÓ EL 23 DE OCTUBRE DE 2026, un día
//  después de traerla aquí. No falló: contestaba. El problema era lo
//  que contestaba. Su texto de dinero —el fijo, el que no pasa por el
//  modelo y que la página rotula como oficial— seguía siendo el del
//  modelo custodio: que pagamos el día 1 y el 15, que nos den una
//  cuenta para remitirles, que nos quedamos un 20% y que las cuentas
//  salen del admin. Nada de eso es verdad desde que esto dejó de
//  tocar dinero, y cobro.html dice lo contrario en la misma web.
//
//  Un texto que envejece sin que nadie lo lea de vuelta no se arregla
//  escribiéndolo bien una vez. Las preguntas de ayuda.html se quedan,
//  que ésas se editan a la vista y no se contestan de memoria.
// ══════════════════════════════════════════════════════════════════
const express = require('express');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL,
                              process.env.SUPABASE_SERVICE_ROLE_KEY);

const MAIL_FROM_HOOPORIA =
  process.env.MAIL_FROM_HOOPORIA || 'Cada Punto Cuenta <onboarding@resend.dev>';
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

/* De dónde se aceptan llamadas. Sólo el sitio; nada más tiene por
   qué hablar con esto desde un navegador.

   LOS DOS DOMINIOS, y no uno. El sitio pasó a cadapunto.com el 22 de
   octubre de 2026 y esta lista decía hooporia.com a secas. Una lista
   así no da un error que se lea: el navegador bloquea la respuesta
   por su cuenta y la página se queda callada, así que el admin, el
   reporte y el chat de la ayuda habrían dejado de funcionar todos a
   la vez sin que el servidor registrara nada raro.

   hooporia.com se queda mientras el dominio viejo siga en pie y
   redirija. Cuando deje de existir, se quita de aquí — y no antes,
   que un enlace viejo que alguien guardó sigue llegando por ahí.

   Y OTRA VEZ LO MISMO, el 25 de octubre de 2026: el sitio pasó a
   cognitivo.digital. Tres páginas llaman aquí desde el navegador
   —admin.html, equipo.html y reporte.html— y servidas desde el
   dominio nuevo eran un origen que esta lista no conocía. Habrían
   dejado de funcionar las tres a la vez, calladas: el navegador
   bloquea la respuesta por su cuenta y aquí no queda ni un registro
   de que algo falló.

   Y SE DESHIZO AL DÍA SIGUIENTE. cognitivo.digital se retiró el 26
   de octubre de 2026 y el sitio volvió a cadapunto.com, así que ese
   origen sale de la lista: no queda ninguna página servida desde
   ahí, y un dominio que ya no es nuestro en una lista de orígenes
   permitidos es una puerta abierta a una casa en la que no vivimos.
   Si alguien lo registrara, sus páginas podrían llamar aquí.

   Que haya ido y vuelto en dos días dice dónde está el fallo de
   verdad: la lista no se mueve con el dominio porque vive en otro
   repositorio. Mientras siga así, mudar el sitio son DOS cambios, y
   éste es el que se olvida.

   hooporia.com se queda mientras el dominio viejo siga en pie y
   redirija — un enlace viejo que alguien guardó llega por ahí. */
const DOMINIOS = /^https:\/\/(www\.)?(cadapunto|hooporia)\.com$/;
app.use((req, res, next) => {
  const o = req.headers.origin || '';
  if (DOMINIOS.test(o) || /localhost/.test(o)) {
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

     Cada Punto Cuenta no cobra nada: esto es una instrucción que escribió el
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
            ` Cada Punto Cuenta no cobra pagos y no te va a escribir otra vez por esto.`
          : (o.contactEmail
              ? `Ese dinero se lo pagas directamente a ${o.teamName}. Si no sabes cómo, ` +
                `escríbele a ${o.contactName || o.teamName}: ${o.contactEmail}. ` +
                `Es quien lo recibe. Cada Punto Cuenta no cobra pagos y no te va a escribir otra vez por esto.`
              : `Ese dinero se lo pagas directamente a ${o.teamName}. Ellos te dirán cómo. ` +
                `Cada Punto Cuenta no cobra pagos y no te va a escribir otra vez por esto.`),
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
          ` Cada Punto Cuenta takes no payments and will not write to you about this again.`
        : (o.contactEmail
            ? `You pay that directly to ${o.teamName}. If you are not sure how, write to ` +
              `${o.contactName || o.teamName}: ${o.contactEmail}. They are the one who ` +
              `receives it. Cada Punto Cuenta takes no payments and will not write to you about this again.`
            : `You pay that directly to ${o.teamName}, who will tell you how. ` +
              `Cada Punto Cuenta takes no payments and will not write to you about this again.`),
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
        Cada Punto Cuenta · Gostar Digital LLC · Puerto Rico
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

    const concepto = `Cada Punto Cuenta — licencia del evento: ${calc.challenge}`;

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
        producto: 'cadapunto',
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

/* ════════════════════════════════════════════════════════════════
   EL COBRO DE UN JUEGO DE MARCADOR

   Lo mismo que /challenge-notices, apuntado a `game_pledges` en vez
   de a `pledges`. Un juego de baloncesto de verdad, su marcador
   final, y un aviso por padrino.

   AL PADRINO NO SE LE COBRA NADA. `game_pledges` todavía arrastra
   `platform_amount` y `stripe_session` de cuando la plataforma se
   llevaba un veinte por ciento y procesaba el pago; ese modelo se
   retiró y la custodia dice lo contrario con todas las letras. Aquí
   platform_amount se escribe a cero y stripe_session no se toca.

   Lo que se factura es la licencia, y se le factura al PROGRAMA.
   ════════════════════════════════════════════════════════════════ */

function avisoJuegoTextos(lang, o) {
  const money = (n) => '$' + Number(n || 0).toFixed(2);
  const comoPagar = String(o.payHow || '').trim();

  /* El marcador entero, no sólo los puntos del equipo: un padrino que
     ve «68–61» sabe de qué juego le hablan. Y se nombra al rival
     porque un equipo juega tres veces en un fin de semana. */
  const marcador = o.oppPoints != null
    ? `${o.points}–${o.oppPoints}` : String(o.points);

  if (lang === 'es') {
    const cuenta = o.cap != null
      ? `Prometiste ${money(o.rate)} por punto, que habrían sido ${money(o.bruto)} — ` +
        `pero pusiste un tope de ${money(o.cap)}, así que tu promesa es de <b>${money(o.pledged)}</b>.`
      : `Prometiste ${money(o.rate)} por punto, así que tu promesa es de <b>${money(o.pledged)}</b>.`;
    return {
      subject: `${o.teamName} anotó ${o.points} — tu promesa`,
      lines: [
        `Hola ${o.name},`,
        `<b>${o.teamName}</b> anotó <b>${o.points} puntos</b> ${o.label} (${marcador}).`,
        cuenta,
        comoPagar
          ? `Ese dinero se lo pagas directamente a ${o.teamName}: <b>${comoPagar}</b>` +
            (o.contactEmail
              ? ` Si algo no te cuadra, escríbele a ${o.contactName || o.teamName}: ${o.contactEmail}.`
              : '') +
            ` Cada Punto Cuenta no cobra pagos y no te va a escribir otra vez por esto, ` +
              `salvo que el marcador se corrija.`
          : (o.contactEmail
              ? `Ese dinero se lo pagas directamente a ${o.teamName}. Si no sabes cómo, ` +
                `escríbele a ${o.contactName || o.teamName}: ${o.contactEmail}. ` +
                `Es quien lo recibe. Cada Punto Cuenta no cobra pagos y no te va a escribir ` +
                `otra vez por esto, salvo que el marcador se corrija.`
              : `Ese dinero se lo pagas directamente a ${o.teamName}. Ellos te dirán cómo. ` +
                `Cada Punto Cuenta no cobra pagos y no te va a escribir otra vez por esto, ` +
                `salvo que el marcador se corrija.`),
      ],
    };
  }

  const cuenta = o.cap != null
    ? `You pledged ${money(o.rate)} a point, which would have come to ${money(o.bruto)} — ` +
      `but you set a ${money(o.cap)} cap, so your pledge is <b>${money(o.pledged)}</b>.`
    : `You pledged ${money(o.rate)} a point, so your pledge comes to <b>${money(o.pledged)}</b>.`;
  return {
    subject: `${o.teamName} scored ${o.points} — your pledge`,
    lines: [
      `Hi ${o.name},`,
      `<b>${o.teamName}</b> scored <b>${o.points} points</b> ${o.label} (${marcador}).`,
      cuenta,
      comoPagar
        ? `You pay that directly to ${o.teamName}: <b>${comoPagar}</b>` +
          (o.contactEmail
            ? ` If something does not look right, write to ${o.contactName || o.teamName}: ${o.contactEmail}.`
            : '') +
          ` Cada Punto Cuenta does not take payments and will not write to you about this ` +
            `again, unless the final score is corrected.`
        : (o.contactEmail
            ? `You pay that directly to ${o.teamName}. If you are not sure how, write to ` +
              `${o.contactName || o.teamName}: ${o.contactEmail}. They are the ones who receive it. ` +
              `Cada Punto Cuenta does not take payments and will not write to you about ` +
              `this again, unless the final score is corrected.`
            : `You pay that directly to ${o.teamName}. They will tell you how. ` +
              `Cada Punto Cuenta does not take payments and will not write to you about ` +
              `this again, unless the final score is corrected.`),
    ],
  };
}

/* `game_pledges` no guarda el idioma del padrino como lo hace
   `pledges`, así que salen los dos. Mejor un correo con las dos
   mitades que uno en el idioma equivocado. */
/* ── La corrección ────────────────────────────────────────────────

   El anotador puede corregir un marcador, y puede borrarlo. Cuando lo
   hace después de que los avisos salieron, hay gente con una cifra
   nuestra en la mano que ya no es verdad. Esto es lo que se les dice.

   Tres cosas que este correo hace y el primero no:

     · nombra la cifra VIEJA. «Tu promesa es de $14.50» a secas no se
       entiende cuando en el bolsillo hay un correo que dice $17.00;
       se entiende «te dijimos $17.00, y son $14.50».
     · sabe decir CERO. Es el caso que más importa y el más fácil de
       escribir mal: alguien que quedó por debajo del mínimo no «debe
       menos», no debe NADA, y hay que decirlo sin rodeos.
     · sabe que puede no haber marcador. Un juego cuyo resultado se
       borró no tiene un «de X a Y» que contar.

   Y el error es nuestro, así que se dice que es nuestro. No se le
   pide disculpas al padrino por algo que hizo el anotador, pero
   tampoco se escribe en pasiva para que no parezca de nadie. */
function correccionJuegoTextos(lang, o) {
  const money = (n) => '$' + Number(n || 0).toFixed(2);
  const comoPagar = String(o.payHow || '').trim();
  const cero   = Number(o.pledged || 0) <= 0;
  const borrado = !!o.sinMarcador;

  const marcador = o.oppPoints != null
    ? `${o.points}–${o.oppPoints}` : String(o.points);

  if (lang === 'es') {
    const queCambio = borrado
      ? `El resultado de ese juego se retiró, así que por ahora no hay marcador que contar.`
      : `El marcador quedó finalmente en <b>${marcador}</b>, no en el que te dimos.`;

    const laCuenta = cero
      ? (borrado
          ? `Eso quiere decir que <b>no debes nada</b>. Olvida la cifra del correo anterior.`
          : `Con ese marcador tu promesa queda por debajo del mínimo de ${money(o.piso)}, ` +
            `así que <b>no debes nada</b>. Olvida los ${money(o.antes)} que te dijimos.`)
      : `Te dijimos ${money(o.antes)}. Con el marcador bueno tu promesa es de ` +
        `<b>${money(o.pledged)}</b>.`;

    const comoSigue = cero
      ? `No tienes que hacer nada. Cada Punto Cuenta no cobra pagos y no te va a escribir ` +
        `más por este juego.`
      : (comoPagar
          ? `Ese dinero se lo pagas directamente a ${o.teamName}: <b>${comoPagar}</b>`
          : `Ese dinero se lo pagas directamente a ${o.teamName}.`) +
        (o.contactEmail
          ? ` Si algo no te cuadra, escríbele a ${o.contactName || o.teamName}: ${o.contactEmail}.`
          : '');

    return {
      subject: `Corrección — tu promesa con ${o.teamName}`,
      lines: [
        `Hola ${o.name},`,
        `Te escribimos hace poco con el resultado de <b>${o.teamName}</b> ${o.label}. ` +
          `Nos equivocamos de cifra y queremos arreglarlo antes de que pagues de más o de menos.`,
        queCambio,
        laCuenta,
        comoSigue,
      ],
    };
  }

  const queCambio = borrado
    ? `That game's result was withdrawn, so for now there is no score to report.`
    : `The final score came in at <b>${marcador}</b>, not the one we gave you.`;

  const laCuenta = cero
    ? (borrado
        ? `That means you <b>owe nothing</b>. Please ignore the amount in our last email.`
        : `At that score your pledge falls below the ${money(o.piso)} minimum, so you ` +
          `<b>owe nothing</b>. Please ignore the ${money(o.antes)} we told you.`)
    : `We told you ${money(o.antes)}. At the correct score your pledge is ` +
      `<b>${money(o.pledged)}</b>.`;

  const comoSigue = cero
    ? `There is nothing for you to do. Cada Punto Cuenta takes no payments and will not ` +
      `write to you about this game again.`
    : (comoPagar
        ? `You pay that directly to ${o.teamName}: <b>${comoPagar}</b>`
        : `You pay that directly to ${o.teamName}.`) +
      (o.contactEmail
        ? ` If something does not look right, write to ${o.contactName || o.teamName}: ` +
          `${o.contactEmail}.`
        : '');

  return {
    subject: `Correction — your pledge with ${o.teamName}`,
    lines: [
      `Hi ${o.name},`,
      `We wrote to you recently with <b>${o.teamName}</b>'s result ${o.label}. ` +
        `We gave you the wrong figure and we want to fix it before you pay too much or too little.`,
      queCambio,
      laCuenta,
      comoSigue,
    ],
  };
}

async function sendGameCorrection(o) {
  return enviarAviso(o, [correccionJuegoTextos('es', o), correccionJuegoTextos('en', o)]);
}

/* El sobre, uno solo. El aviso y la corrección se diferencian en lo
   que dicen y en nada más: mismo armazón, mismo bilingüe, mismo pie,
   misma manera de fallar. Tener dos copias de esto es tener dos el día
   que una cambie — y la que cambiaría tarde sería la de la corrección,
   que es la que menos se mira. */
async function enviarAviso(o, partes) {
  const bloque = (t) => t.lines.map(l => `<p>${l}</p>`).join('\n      ');

  const html = `
    <div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#12202E;font-size:15px;line-height:1.6">
      ${partes.map(bloque).join(
        '\n      <hr style="border:none;border-top:1px solid #D7E0E8;margin:22px 0">\n      ')}
      <p style="color:#5A6B7C;font-size:.8rem;margin-top:22px">
        Cada Punto Cuenta · Gostar Digital LLC · Puerto Rico
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
      ...(o.contactEmail ? { reply_to: o.contactEmail }
                         : (MAIL_REPLY_TO ? { reply_to: MAIL_REPLY_TO } : {})),
      subject: partes[0].subject,
      html, text,
    }),
  });

  if (!r.ok) throw await falloDeCorreo(r);
  return r.json();
}

async function sendGameNotice(o) {
  return enviarAviso(o, [avisoJuegoTextos('es', o), avisoJuegoTextos('en', o)]);
}

/* ── Por qué falló un correo, y si volver a intentarlo sirve ───────

   Un fallo de envío llevaba sólo un texto, así que todos pesaban lo
   mismo: se reintentaban para siempre y todos frenaban la factura. Eso
   es correcto para un proveedor caído y absurdo para una dirección que
   no existe — un padrino que teclea mal su correo dejaría al programa
   sin licencia PARA SIEMPRE.

   Se marca permanente con la mano MUY cerrada, y a propósito. Lo que
   cuesta equivocarse no es simétrico: tratar un fallo temporal como
   permanente deja a un padrino sin su aviso y nadie se entera nunca;
   tratar uno permanente como temporal sólo cuesta reintentos. Ante la
   duda, temporal. */
async function falloDeCorreo(r) {
  let cuerpo = '';
  try { cuerpo = await r.text(); } catch (e) { cuerpo = ''; }

  const texto = String(cuerpo || '').toLowerCase();

  /* 422 es lo que contesta Resend cuando la dirección no es una
     dirección. Un 403 o un 400 NO entran aquí aunque lo parezcan: una
     llave mal puesta o un cuerpo mal formado darían eso mismo para
     TODOS los padrinos a la vez, y marcarlos a todos como
     inalcanzables sería escribir una mentira en cuarenta y siete
     filas. Un 429 y cualquier 5xx son temporales por definición. */
  const permanente = r.status === 422 && (
    /invalid.*(email|recipient|address|`?to`?)/.test(texto) ||
    /not a valid email/.test(texto) ||
    /unknown recipient|no such (user|mailbox)|does not exist/.test(texto)
  );

  const e = new Error(`(${r.status}) ${cuerpo}`);
  e.status = r.status;
  e.permanente = permanente;
  e.cuerpo = cuerpo;
  return e;
}

/* La licencia de UN juego. Mismo orden que facturarLicencia: la fila
   primero, porque el índice único es lo único que impide dos facturas
   por el mismo juego cuando el botón y el barrido coinciden.

   SI STRIPE FALLA, LA FILA SE QUEDA. Antes se borraba —"se retira para
   poder reintentarlo"— y eso se escribió creyendo que la fila era lo
   que estorbaba. Lo que estorbaba era el índice; la fila era la única
   constancia de que este juego debía dinero. Borrarla dejaba el cobro
   sin rastro en el mismo gesto con el que se suponía que lo salvaba.
   Ahora se marca `fallida` con lo que dijo Stripe, y el reintento reusa
   esa misma fila: así los intentos se cuentan en un sitio. */
async function facturarLicenciaJuego(game_id, rep, torneo, juego_no) {
  /* Un juego de prueba llega hasta aquí con su peldaño bien calculado y
     se va sin factura. Se dice con su propio nombre y no como
     'sin_promesas', que es otra cosa y llevaría a buscar el fallo donde
     no está. */
  if (rep.prueba)         return { estado: 'prueba' };
  if (!rep.cobrable)      return { estado: 'sin_promesas' };
  if (rep.ya_facturada)   return { estado: 'ya_facturada', licencia: rep.licencia };
  if (!rep.program_email) return { estado: 'sin_correo' };

  const campos = {
    campaign_id: rep.campaign_id,
    torneo: torneo || null,
    juego_no: juego_no || null,
    amount_cents: rep.amount_cents,
    promesas: rep.promesas,
    recaudado: rep.recaudado,
    estado: 'open'
  };

  let { data: fila, error: errFila } = await supabase
    .from('licencias_juego')
    .insert({ game_id, ...campos, intentos: 1 })
    .select()
    .single();

  if (errFila) {
    if (errFila.code !== '23505') return { estado: 'error', why: errFila.message };

    /* Choque con el índice: o ya está facturado de verdad, o es la
       fila fallida de un intento anterior, que es la que hay que
       reusar. La cuenta se reescribe porque el marcador pudo haberse
       corregido entre el intento que falló y este. */
    const { data: previa } = await supabase
      .from('licencias_juego')
      .select('*')
      .eq('game_id', game_id)
      .neq('estado', 'anulada')
      .limit(1)
      .maybeSingle();

    if (!previa)                   return { estado: 'ya_facturada' };
    if (previa.estado !== 'fallida') {
      return { estado: 'ya_facturada', licencia: previa };
    }

    const { data: reusada, error: errReuso } = await supabase
      .from('licencias_juego')
      .update({ ...campos, intentos: Number(previa.intentos || 0) + 1 })
      .eq('id', previa.id)
      .select()
      .single();

    if (errReuso) return { estado: 'error', why: errReuso.message };
    fila = reusada;
  }

  try {
    const hay = await stripe.customers.list({ email: rep.program_email, limit: 1 });
    const cliente = (hay.data && hay.data[0])
      || await stripe.customers.create({
           email: rep.program_email,
           name: rep.program_name || rep.programa || undefined,
           metadata: { campaign_id: String(rep.campaign_id || '') }
         });

    const concepto = `Cada Punto Cuenta — licencia del juego: ${rep.programa} ${rep.juego}`;

    const factura = await stripe.invoices.create({
      customer: cliente.id,
      collection_method: 'send_invoice',
      days_until_due: LICENCIA_DIAS,
      description: concepto,
      auto_advance: false,
      metadata: {
        producto: 'cadapunto',
        game_id: String(game_id),
        torneo: String(torneo || ''),
        licencia_id: String(fila.id)
      }
    });

    await stripe.invoiceItems.create({
      customer: cliente.id,
      invoice: factura.id,
      amount: rep.amount_cents,
      currency: 'usd',
      description: `${concepto} · ${rep.promesas} promesa${rep.promesas === 1 ? '' : 's'}`
    });

    const firmada = await stripe.invoices.finalizeInvoice(factura.id);
    const enviada = await stripe.invoices.sendInvoice(firmada.id);

    await supabase.from('licencias_juego').update({
      estado: 'enviada',
      stripe_invoice_id: enviada.id,
      stripe_hosted_url: enviada.hosted_invoice_url || null,
      enviada_el: new Date().toISOString(),
      due_at: enviada.due_date ? new Date(enviada.due_date * 1000).toISOString() : null
    }).eq('id', fila.id);

    console.log(`Licencia de juego ${fila.id} facturada: ${enviada.id} (${modoDeStripe()})`);
    return {
      estado: 'enviada',
      amount_cents: rep.amount_cents,
      promesas: rep.promesas,
      program_email: rep.program_email,
      stripe_invoice_id: enviada.id,
      url: enviada.hosted_invoice_url || null
    };

  } catch (eStripe) {
    const porque = String(eStripe && eStripe.message || eStripe);

    /* La fila SE QUEDA, marcada y con la razón. torneo_juegos_cobrables
       no cuenta `fallida` como factura buena, así que este juego vuelve
       a salir en el barrido y el reintento es el mismo botón de
       siempre — sin que nadie tenga que acordarse de nada. */
    await supabase.from('licencias_juego').update({
      estado: 'fallida',
      fallo: porque,
      fallo_el: new Date().toISOString(),
    }).eq('id', fila.id);

    console.error('Licencia de juego — Stripe falló, fila marcada fallida:', eStripe);
    return { estado: 'stripe', why: porque, licencia_id: fila.id,
             intentos: Number(fila.intentos || 1) };
  }
}

/* Un juego: avisos y factura. Devuelve la cuenta de lo que pasó para
   que el barrido de un torneo pueda juntarlas sin repetir nada. */
/* Un juego: avisos, correcciones y factura. Devuelve la cuenta de lo
   que pasó para que el barrido de un torneo pueda juntarlas sin
   repetir nada.

   LO CONDUCE juego_correcciones Y NO juego_reporte, y ese cambio es
   todo el paso 2.

   juego_reporte se apoya en licencia_juego_calculo, que contesta
   «sin-marcador» en cuanto el juego no tiene puntos. Es lo correcto
   para facturar y es ciego para lo que hace falta aquí: el anotador
   puede BORRAR un marcador, no sólo corregirlo, y cuando lo hace sus
   padrinos siguen teniendo en el correo una cifra que ya no existe.
   Conducido por el reporte, este bucle ni siquiera podía enumerarlos.

   Y la lista blanca de estados que había —open, pending y nada más—
   era correcta para un reintento y desastrosa para una corrección: es
   lo que impide escribirle dos veces a una abuela cuando un envío
   falla a la mitad, y lo mismo que impedía decirle que el número que
   le dimos estaba mal. Ahora quien decide es la base, promesa por
   promesa, y aquí sólo se manda lo que diga. */
async function cobrarJuego(code, game_id, torneo, juego_no) {
  const { data: corr, error } = await supabase.rpc('juego_correcciones', {
    p_code: String(code), p_game: String(game_id),
  });

  if (error) return { ok: false, error: 'report failed', why: error.message };
  if (!corr || corr.ok !== true) {
    return { ok: false, error: (corr && corr.error) || 'not allowed' };
  }

  const out = { ok: true, game_id, juego: corr.juego, programa: corr.programa,
                sent: 0, corrected: 0, skipped: 0, zero: 0,
                failed: 0, undeliverable: 0, errors: [] };

  const puntos   = Number(corr.puntos || 0);
  const piso     = Number(corr.piso_centavos || 500) / 100;
  const teamName = corr.programa || 'the program';
  const pledges  = corr.pledges || [];

  /* Cuántos PODRÍAN fallar de forma permanente. Si fallan todos, no
     son cuarenta y siete direcciones malas: es nuestra configuración,
     y marcarlas a todas como inalcanzables escribiría una mentira en
     cuarenta y siete filas que nadie volvería a mirar. */
  const candidatos = pledges.filter(p => p.accion === 'primero' || p.accion === 'correccion').length;
  let permanentes = 0;

  for (const p of pledges) {
    const debe  = Number(p.debe || 0);
    const antes = p.dijimos == null ? null : Number(p.dijimos);

    /* Ya se le escribió y la cifra no ha cambiado. */
    if (p.accion === 'nada') { out.skipped++; continue; }

    /* Su dirección rechazó el correo para siempre y sigue siendo la
       misma dirección. Reintentarla no la hace existir. Sale en la
       cuenta para que el programa sepa a quién no se le pudo decir. */
    if (p.accion === 'no_entregable') {
      out.undeliverable++;
      out.errors.push(`${p.email}: ${p.fallo || 'undeliverable'}`);
      continue;
    }

    /* Nunca se le escribió y sigue sin deber nada: se cierra con su
       cifra guardada, sin correo. No se marca 'void' — sigue saliendo
       en el reporte con su cero, que es la verdad. */
    if (p.accion === 'cero') {
      await supabase.rpc('pledge_en_cero', {
        p_id: p.id, p_puntos: puntos,
        p_porque: puntos <= 0 ? 'no_points' : 'too_small',
      });
      out.zero++;
      continue;
    }

    const esCorreccion = p.accion === 'correccion';
    const bruto = +(Number(p.rate) * puntos).toFixed(2);
    const mordio = p.cap != null && debe > 0 && debe < bruto;

    const sobre = {
      to: p.email,
      name: p.nombre,
      teamName,
      label: corr.juego,
      points: puntos,
      oppPoints: corr.opp_points != null ? corr.opp_points : null,
      payHow: corr.pay_how,
      contactName: corr.program_name || null,
      contactEmail: corr.program_email || null,
      rate: Number(p.rate),
      pledged: debe,
      cap:   mordio ? Number(p.cap) : null,
      bruto: mordio ? bruto : null,
      // Sólo la corrección los usa.
      antes: antes,
      piso: piso,
      sinMarcador: !!corr.sin_marcador,
    };

    try {
      if (esCorreccion) await sendGameCorrection(sobre);
      else              await sendGameNotice(sobre);

      /* La cuenta se guarda DESPUÉS de que el correo salga, y con la
         cifra que llevaba: lo que hay que recordar es lo que el
         padrino LEYÓ. Recalcularla aquí guardaría un número que nadie
         recibió si alguien tocó el marcador entre medias. */
      await supabase.rpc('pledge_avisado', {
        p_id: p.id, p_puntos: puntos, p_monto: debe,
      });

      if (esCorreccion) out.corrected++; else out.sent++;

    } catch (e) {
      /* Permanente: se cierra en su propio estado, con el motivo y la
         dirección que falló. NO se marca como enviado — no se envió.
         Temporal: no se toca nada, así que la próxima pasada lo
         vuelve a intentar con la misma cifra. */
      if (e && e.permanente && candidatos > 1 && permanentes + 1 >= candidatos) {
        /* Han fallado todas. Eso no son direcciones malas. */
        out.failed++;
        out.errors.push(`${p.email}: ${e.message} (every address failed — treated as temporary)`);
      } else if (e && e.permanente) {
        permanentes++;
        await supabase.rpc('pledge_no_entregable', {
          p_id: p.id, p_puntos: puntos, p_monto: debe,
          p_motivo: String(e.message || e),
        });
        out.undeliverable++;
        out.errors.push(`${p.email}: ${e.message}`);
      } else {
        out.failed++;
        out.errors.push(`${p.email}: ${e.message}`);
      }
    }
  }

  /* ── LA FACTURA ───────────────────────────────────────────────────

     Sigue saliendo con los avisos y sigue sin salir si queda trabajo
     de avisos a medias. Lo que cambia es QUÉ cuenta como «a medias».

     Antes contaba cualquier fallo, y eso le daba a un padrino que
     tecleó mal su correo el poder de dejar al programa sin licencia
     para siempre: el aviso nunca iba a salir, así que la factura
     nunca iba a salir, y el juego se quedaba colgado en la lista de
     pendientes sin manera de cerrarlo.

     Ahora sólo frenan los fallos TEMPORALES, que son los que de
     verdad están a medias. Una dirección muerta llegó a su final: se
     guarda, se reporta, y deja de bloquear algo que no tiene que ver
     con ella. El programa paga por las promesas que recogió, y las
     recogió igual. */
  if (corr.sin_marcador) {
    /* Sin marcador no hay nada que facturar. Si ya había una factura
       hecha, lo que importa es si sigue cuadrando — y eso lo contesta
       juego_licencia_cuadra, no un update a escondidas sobre una
       factura que alguien ya tiene en la mano. */
    const { data: cuadra } = await supabase.rpc('juego_licencia_cuadra', {
      p_code: String(code), p_game: String(game_id),
    });
    out.licencia = { estado: 'sin_marcador',
                     cuadra: cuadra ? cuadra.cuadra : null,
                     facturada: cuadra ? cuadra.facturada : null };
    return out;
  }

  if (out.failed > 0) {
    out.licencia = { estado: 'avisos_pendientes' };
    return out;
  }

  const { data: rep, error: errRep } = await supabase.rpc('juego_reporte', {
    p_code: String(code), p_game: String(game_id),
  });

  if (errRep || !rep || rep.ok !== true) {
    out.licencia = { estado: 'error',
                     why: (errRep && errRep.message) || (rep && rep.error) || 'no report' };
    return out;
  }

  try {
    out.licencia = await facturarLicenciaJuego(game_id, rep, torneo, juego_no);
  } catch (e) {
    console.error('game-notices licencia:', e);
    out.licencia = { estado: 'error', why: String(e && e.message || e) };
  }

  /* Y si la licencia ya estaba hecha, se dice si el marcador de hoy la
     dejó descuadrada. No se reescribe: reemitir o abonar una factura
     que alguien ya tiene es una decisión con una persona al otro lado,
     no un update. */
  if (out.licencia && (out.licencia.estado === 'ya_facturada')) {
    const { data: cuadra } = await supabase.rpc('juego_licencia_cuadra', {
      p_code: String(code), p_game: String(game_id),
    });
    if (cuadra && cuadra.cuadra === false) {
      out.licencia.cuadra = false;
      out.licencia.calculo_hoy = cuadra.calculo_hoy;
      out.licencia.facturada  = cuadra.facturada;
    }
  }

  return out;
}

app.post('/game-notices', async (req, res) => {
  const { code, game_id, torneo, juego_no } = req.body || {};
  if (!code || !game_id) {
    return res.status(400).json({ error: 'code and game_id are required' });
  }
  try {
    const r = await cobrarJuego(code, game_id, torneo, juego_no);
    if (!r.ok) return res.status(r.error === 'report failed' ? 500 : 403).json(r);
    return res.json(r);
  } catch (e) {
    console.error('game-notices:', e);
    return res.status(500).json({ error: 'failed', why: String(e && e.message || e) });
  }
});

/* El barrido de un torneo es un bucle sobre lo de arriba y nada más:
   una segunda implementación del cobro acabaría discrepando con la
   primera el día que una de las dos cambie, y discrepar en dinero se
   descubre por un entrenador y no por una prueba. */
app.post('/tournament-notices', async (req, res) => {
  const { code, torneo } = req.body || {};
  if (!code || !torneo) {
    return res.status(400).json({ error: 'code and torneo are required' });
  }

  try {
    const { data: juegos, error } = await supabase.rpc('torneo_juegos_cobrables',
                                                      { p_torneo: String(torneo) });
    if (error) return res.status(500).json({ error: 'list failed', why: error.message });

    const out = { torneo, juegos: [], sent: 0, corrected: 0, failed: 0,
                  undeliverable: 0, facturados: 0, por_texto: 0, pruebas: 0 };

    /* De uno en uno y no en paralelo: son correos y facturas de
       Stripe, y veinte a la vez es como se tropieza con un límite de
       tasa a mitad de un torneo. */
    for (const j of juegos || []) {
      const r = await cobrarJuego(code, j.game_id, torneo, j.juego_no);

      /* por_texto y prueba vienen de la lista, no del cobro, y suben
         hasta la respuesta porque son las dos cosas que el panel tiene
         que poder ver sin que nadie abra una consulta: un enlace
         adivinado por texto es un juego que puede dejar de encontrarse
         mañana, y un juego de prueba explica por sí solo por qué no
         salió factura. */
      out.juegos.push({ juego_no: j.juego_no,
                        por_texto: !!j.por_texto,
                        prueba:    !!j.prueba,
                        avisos_pendientes:  Number(j.avisos_pendientes || 0),
                        licencia_pendiente: !!j.licencia_pendiente,
                        ...r });

      out.sent          += r.sent          || 0;
      out.corrected     += r.corrected     || 0;
      out.failed        += r.failed        || 0;
      out.undeliverable += r.undeliverable || 0;
      if (j.por_texto) out.por_texto++;
      if (j.prueba)    out.pruebas++;
      if (r.licencia && r.licencia.estado === 'enviada') out.facturados++;
    }

    return res.json(out);
  } catch (e) {
    console.error('tournament-notices:', e);
    return res.status(500).json({ error: 'failed', why: String(e && e.message || e) });
  }
});

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

  /* ── LA SOLICITUD SE GUARDA ANTES DE AVISAR ──────────────────────
     Hasta el 26 de octubre de 2026 esto no guardaba nada: mandaba un
     correo y se acababa ahí. Un correo que rebota, que cae en
     Promociones o que alguien borra se llevaba la solicitud entera,
     y no había dónde ir a buscarla.

     El orden importa y es el que está: primero la fila, después el
     aviso. Así el aviso vuelve a ser lo que decía ser —un extra— y
     el fallo de Resend deja de costar una campaña.

     Y arregla dos frases que eran mentira. El correo promete que «la
     petición ya está en la cola»: ahora hay cola. Y el catch de
     abajo contesta 'request saved': ahora está guardada de verdad. */
  let guardada = false;
  try {
    const { error } = await supabase.from('solicitudes').insert({
      equipo: String(team).slice(0, 200),
      programa: program ? String(program).slice(0, 200) : null,
      coach: coach ? String(coach).slice(0, 200) : null,
      email: String(email).slice(0, 320),
      telefono: phone ? String(phone).slice(0, 60) : null,
      licencia_ok: !!(license && license.accepted),
      licencia_por: (license && license.by) ? String(license.by).slice(0, 200) : null,
      licencia_el: (license && license.at) ? String(license.at).slice(0, 80) : null,
      licencia_texto: (license && license.terms)
        ? String(license.terms).replace(/<[^>]*>/g, '').slice(0, 4000) : null
    });
    if (error) throw new Error(error.message);
    guardada = true;
  } catch (e) {
    /* QUE NO SE PUEDA GUARDAR SÍ ES UN FALLO, y se dice. Es lo
       contrario del aviso: sin fila no queda nada, y contestar ok
       dejaría al entrenador creyendo que se inscribió. */
    console.error('Team signup save:', e.message);
    return res.status(500).json({ ok: false, error: 'no-se-pudo-guardar' });
  }

  const to = process.env.ADMIN_EMAIL || 'gostardigital@gmail.com';

  const row = (k, v) =>
    `<tr><td style="padding:6px 14px 6px 0;color:#5A6B7C">${k}</td>` +
    `<td style="padding:6px 0;font-weight:700">${v || '—'}</td></tr>`;

  const html = `
    <div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#12202E">
      <p style="font-size:.72rem;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#0C6E8C;margin:0 0 6px">
        Cada Punto Cuenta
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

    return res.json({ ok: true, guardada: guardada });
  } catch (e) {
    /* El aviso es un extra: que falle no puede romper la inscripción.
       Y ahora esta frase es verdad — la fila quedó escrita arriba
       antes de intentar el correo. Se contesta ok:true a propósito:
       para el entrenador la inscripción SÍ salió bien, y que nosotros
       no nos hayamos enterado por correo no es problema suyo. La
       solicitud está en el admin igual. */
    console.error('Team signup notice:', e.message);
    return res.json({ ok: true, guardada: guardada, aviso: 'no-salio-el-correo' });
  }
});


app.get('/', (req, res) =>
  res.send('Cada Punto Cuenta server — avisos y licencias. Nada de pagos de padrinos.'));

/* ── ¿En qué modo estoy? ──────────────────────────────────────────
   «¿Estoy en live?» se contestaba abriendo el admin, eligiendo una
   campaña, abriendo un reto CON promesas y mirando la vista previa
   de la licencia. Después de limpiar los datos de prueba no hay
   ninguna de esas cosas, así que justo cuando se cambian las llaves
   —el momento en que más importa— era cuando no se podía mirar.

   No enseña ninguna llave: sólo el prefijo, que es lo único que
   hace falta saber, y si cada variable está puesta o no. Nada de
   esto le sirve a nadie que no la tenga ya. */
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
      ADMIN_EMAIL:              puesta('ADMIN_EMAIL')
    },
    /* El remitente sí se enseña entero: va escrito en la cabecera de
       cada correo que sale, así que no es un secreto, y es justo lo
       que hubo que adivinar esta mañana cuando los avisos caían en
       Promociones. */
    remitente: MAIL_FROM_HOOPORIA
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Cada Punto Cuenta server escuchando en ${PORT}`));

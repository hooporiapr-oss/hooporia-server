// ══════════════════════════════════════════════════════════════════
//  EL SERVIDOR DE HOOPORIA
//
//  Hooporia tiene su sitio, su admin y su base. Esto es lo que le
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
        o.contactEmail
          ? `Ese dinero se lo pagas directamente a ${o.teamName}. Si no sabes cómo, ` +
            `escríbele a ${o.contactName || o.teamName}: ${o.contactEmail}. ` +
            `Es quien lo recibe. Hooporia no cobra pagos y no te va a escribir otra vez por esto.`
          : `Ese dinero se lo pagas directamente a ${o.teamName}. Ellos te dirán cómo. ` +
            `Hooporia no cobra pagos y no te va a escribir otra vez por esto.`,
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
      o.contactEmail
        ? `You pay that directly to ${o.teamName}. If you are not sure how, write to ` +
          `${o.contactName || o.teamName}: ${o.contactEmail}. They are the one who ` +
          `receives it. Hooporia takes no payments and will not write to you about this again.`
        : `You pay that directly to ${o.teamName}, who will tell you how. ` +
          `Hooporia takes no payments and will not write to you about this again.`,
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
   idiomas) y el filtro de reporte.html. Son cuatro sitios y tienen
   que decir lo mismo. */
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
app.listen(PORT, () => console.log(`Hooporia server escuchando en ${PORT}`));

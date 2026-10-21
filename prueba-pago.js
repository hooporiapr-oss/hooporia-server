/* ══════════════════════════════════════════════════════════════════
   CÓMO SE PAGA, DENTRO DEL AVISO

   El aviso de cierre le dice al padrino cuánto debe y a quién. Lo
   que no sabía decirle era CÓMO: la única salida era «si no sabes
   cómo, escríbele al entrenador».

   Con doce jugadores y cuarenta y ocho promesas eso es una molestia.
   Con una escuela de cuatrocientos nenes son mil seiscientas
   promesas — y lo que pasa de verdad no es que el entrenador reciba
   mil seiscientos correos, es que el padrino lo deja para luego y no
   paga nunca. El segundo en que alguien está más dispuesto a pagar
   es el que acaba de leer que su ahijado anotó 150 puntos.

   Esto comprueba la función que escribe el aviso, sin base de datos
   y sin red: es texto, y el texto es lo que cambió.

   Y comprueba lo que NO puede pasar: que por meter la frase del
   programa se caiga la que dice que Hooporia no cobra. Ésa es la
   línea que mantiene cierto lo que promete custodia.html.

       node prueba-pago.js
   ══════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const vm = require('vm');

let fallos = 0;
const ok  = (m) => console.log('  ok   ' + m);
const mal = (m) => { fallos++; console.log('  MAL  ' + m) };
const si  = (v, m) => (v ? ok(m) : mal(m));

/* La función del aviso, sacada tal cual del fichero que se despliega.
   Se corta sólo ella: no necesita express, ni supabase, ni red. */
function sacarAviso() {
  const s = fs.readFileSync(__dirname + '/server.js', 'utf8');
  const i = s.indexOf('function avisoRetoTextos');
  if (i < 0) throw new Error('no encuentro avisoRetoTextos en server.js');
  const fin = s.indexOf('\n}\n', i);
  if (fin < 0) throw new Error('no encuentro el final de avisoRetoTextos');
  return s.slice(i, fin + 3);
}
const ctx = { JSON, Number, Math, String, Object };
vm.createContext(ctx);
vm.runInContext(sacarAviso() + '\nthis.aviso = avisoRetoTextos;', ctx);
const aviso = ctx.aviso;

const BASE = {
  name: 'Carmen', who: 'Luis Burgos', points: 150,
  teamName: 'Escuela Lincoln', retoName: 'Reto de noviembre',
  contactName: 'Ana Ruiz', contactEmail: 'ana@lincoln.edu',
  rate: 0.20, pledged: 30, cap: null, bruto: null,
};
const texto = (o, l) => aviso(l, o).lines.join('\n');

// ── 1 · Con la línea del programa puesta ──────────────────────────
console.log('\n1 · Cuando el programa dice cómo se le paga\n');
for (const [l, etq] of [['es','es'], ['en','en']]) {
  const t = texto({ ...BASE, payHow: 'ATH Móvil a /EscuelaLincoln' }, l);
  si(t.indexOf('ATH Móvil a /EscuelaLincoln') >= 0,
     etq + ' · el aviso lleva la frase del programa, tal cual');
  si(/<b>ATH Móvil a \/EscuelaLincoln<\/b>/.test(t),
     etq + ' · y en negrita, que es lo que va a buscar el ojo');
  si(t.indexOf('ana@lincoln.edu') >= 0,
     etq + ' · el contacto sigue estando, por si algo no cuadra');
  /* La línea que no se puede perder: si el aviso deja de decir que
     Hooporia no cobra, custodia.html pasa a ser mentira. */
  si(/(Hooporia no cobra pagos|Hooporia takes no payments)/.test(t),
     etq + ' · y sigue diciendo que Hooporia no cobra nada');
  si(/(no te va a escribir otra vez|will not write to you about this again)/.test(t),
     etq + ' · y que no habrá un segundo correo');
}

// ── 2 · Sin ella, el aviso de siempre ─────────────────────────────
console.log('\n2 · Cuando no la dice, vuelve a lo de antes\n');
for (const [l, etq] of [['es','es'], ['en','en']]) {
  for (const vacio of [null, '', '   ', undefined]) {
    const t = texto({ ...BASE, payHow: vacio }, l);
    si(/(Si no sabes cómo|If you are not sure how)/.test(t),
       etq + ' · con payHow=' + JSON.stringify(vacio) + ' manda al entrenador');
  }
  const t = texto({ ...BASE, payHow: null }, l);
  si(/(Hooporia no cobra pagos|Hooporia takes no payments)/.test(t),
     etq + ' · y la línea de que no cobramos sigue ahí');
}

// ── 3 · Sin contacto y sin forma de pago ──────────────────────────
console.log('\n3 · Un programa sin correo y sin línea de pago\n');
for (const [l, etq] of [['es','es'], ['en','en']]) {
  const t = texto({ ...BASE, contactEmail: null, contactName: null, payHow: null }, l);
  si(/(Ellos te dirán cómo|who will tell you how)/.test(t),
     etq + ' · dice que el programa le dirá cómo');
  si(t.indexOf('null') < 0 && t.indexOf('undefined') < 0,
     etq + ' · y no se le escapa un null al correo de nadie');
}

// ── 4 · Con forma de pago pero sin correo de contacto ─────────────
console.log('\n4 · Con forma de pago y sin correo\n');
for (const [l, etq] of [['es','es'], ['en','en']]) {
  const t = texto({ ...BASE, contactEmail: null, contactName: null,
                    payHow: 'En la oficina de la escuela' }, l);
  si(t.indexOf('En la oficina de la escuela') >= 0, etq + ' · sale la forma de pago');
  si(t.indexOf('null') < 0 && t.indexOf('undefined') < 0, etq + ' · sin nulls sueltos');
  si(!/(Si algo no te cuadra|If something does not look right)/.test(t),
     etq + ' · y no ofrece escribirle a un correo que no existe');
}

// ── 5 · Lo que el aviso NO debe volverse ──────────────────────────
console.log('\n5 · Sigue siendo un aviso, no un cobro\n');
{
  const t = texto({ ...BASE, payHow: 'ATH Móvil a /EscuelaLincoln' }, 'en') +
            texto({ ...BASE, payHow: 'ATH Móvil a /EscuelaLincoln' }, 'es');
  si(!/pay now|pagar ahora|click to pay|enlace de pago/i.test(t),
     'no aparece ningún enlace de pago');
  si(!/hooporia\.com\/pag|\/checkout|stripe/i.test(t),
     'y no manda a pagar a ningún sitio nuestro');
}

console.log('\n' + (fallos === 0
  ? '✓ el padrino sabe cómo pagar, y sigue sin pagarnos a nosotros'
  : '✗ ' + fallos + ' fallo(s)'));
process.exit(fallos === 0 ? 0 : 1);

/* ══════════════════════════════════════════════════════════════════
   DE DÓNDE SE ACEPTAN LLAMADAS

   Esta lista decide qué páginas pueden hablar con el servidor desde
   un navegador. Si se queda corta no sale un error que alguien lea:
   el navegador bloquea la respuesta por su cuenta, la página se
   queda callada y el servidor no registra nada raro. El admin, el
   reporte y el chat de la ayuda dejan de funcionar todos a la vez y
   lo único que se ve es que "no pasa nada al pulsar".

   Pasó de verdad: el sitio se mudó a cadapunto.com el 22 de octubre
   de 2026 y la lista seguía diciendo hooporia.com a secas. Se
   encontró leyendo, no probando, que es la peor manera de encontrar
   algo así.

   Y la otra mitad, que importa igual: la lista tiene que estar
   ANCLADA. Un patrón sin principio ni fin —/cadapunto\.com/ a
   secas— acepta https://cadapunto.com.cualquiercosa.net, que es un
   sitio de otro dueño leyendo respuestas destinadas al nuestro.

   Lee server.js, no lo levanta.

       node prueba-cors.js
   ══════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

let fallos = 0;
const ok  = (m) => console.log('  ok   ' + m);
const mal = (m) => { fallos++; console.log('  MAL  ' + m); };
const si  = (v, m) => (v ? ok(m) : mal(m));

const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

/* La lista, sacada del fichero y convertida en una expresión de
   verdad: se prueba la que corre, no una copia escrita aquí. */
const m = src.match(/const DOMINIOS = (\/.+\/);/);
if (!m) {
  console.log('\n  MAL  no encuentro la lista de dominios en server.js\n');
  process.exit(1);
}
const DOMINIOS = new Function('return ' + m[1])();
console.log('\nla lista: ' + m[1] + '\n');

/* El servidor acepta también localhost, por una rama aparte. Se
   reproduce aquí la condición entera para probar lo que de verdad
   decide. */
const pasa = (o) => DOMINIOS.test(o) || /localhost/.test(o);

console.log('1 · Entra quien tiene que entrar\n');
for (const o of [
  'https://cadapunto.com',
  'https://www.cadapunto.com',
  'http://localhost:8080',
]) si(pasa(o), o);

/* cognitivo.digital YA NO ENTRA, y es a propósito. El sitio principal
   se movió allí un día y volvió a cadapunto.com al siguiente; el
   servidor lo retiró de la lista el 26. Esta prueba seguía esperándolo
   dentro, así que estaba roja por defender una decisión ya tomada —
   que es lo que hace una prueba vieja: pedir que se deshaga el
   arreglo. Se queda comprobado por el otro lado, abajo, donde se
   comprueba que NO entra. */
si(!pasa('https://cognitivo.digital'),
   'https://cognitivo.digital — retirado el 26, y sigue fuera');
si(!pasa('https://www.cognitivo.digital'),
   'https://www.cognitivo.digital — igual, con www');

/* El dominio viejo se queda mientras siga en pie y redirija: un
   enlace que alguien guardó llega por ahí. El día que se apague,
   esta línea se quita — y entonces hay que venir a quitarla aquí,
   que es justo para lo que está escrita. */
si(pasa('https://hooporia.com'),
   'https://hooporia.com — el viejo, mientras redirija');

console.log('\n2 · Y no entra nadie más\n');
for (const o of [
  ['', 'una petición sin origen'],
  ['null', 'un origen nulo'],
  ['http://cadapunto.com', 'el mismo dominio por http, sin cifrar'],
  ['https://cadapunto.com.atacante.net', 'un dominio que EMPIEZA por el nuestro'],
  ['https://atacante.net/cadapunto.com', 'uno que lo lleva en la ruta'],
  ['https://micadapunto.com', 'uno pegado por delante'],
  ['https://cadapunto.net', 'el mismo nombre con otra terminación'],
  /* Las mismas trampas contra el dominio retirado, para que volver a
     meterlo tenga que ser una decisión y no un descuido. */
  ['http://cognitivo.digital', 'el retirado por http, sin cifrar'],
  ['https://cognitivo.digital.atacante.net', 'uno que EMPIEZA por el retirado'],
  ['https://micognitivo.digital', 'el retirado pegado por delante'],
  ['https://cognitivo.com', 'cognitivo con otra terminación — no es nuestro'],
  ['https://cognitivo.digitalx', 'el retirado con una letra de más'],
  ['https://evil.com', 'uno cualquiera'],
]) si(!pasa(o[0]), o[1] + (o[0] ? ' (' + o[0] + ')' : ''));

console.log('\n3 · Y la cabecera devuelve el origen, no un comodín\n');
{
  /* Un '*' aquí serviría a cualquiera, y además el navegador lo
     rechaza en cuanto la petición lleva credenciales. */
  si(!/Access-Control-Allow-Origin['"]\s*,\s*['"]\*/.test(src),
     'no se responde Access-Control-Allow-Origin: *');
  si(/setHeader\('Access-Control-Allow-Origin', o\)/.test(src),
     'se devuelve el origen que pidió, ya comprobado');
}

console.log('\n' + (fallos === 0
  ? '✓ la lista deja entrar al sitio y a nadie más'
  : '✗ ' + fallos + ' fallo(s)'));
process.exit(fallos === 0 ? 0 : 1);

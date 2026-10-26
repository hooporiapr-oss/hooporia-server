// ══════════════════════════════════════════════════════════════════
//  LA SOLICITUD SE GUARDA ANTES DE AVISAR
//
//  Corre con `node prueba-solicitud.js`. No hace falta base ni llave:
//  prueba-solicitud-doble.js le cambia Supabase y fetch al servidor
//  antes de que arranque.
//
//  Lo que se mide, y por qué cada cosa:
//
//    1  que la fila se escriba, y con lo que mandó el entrenador
//    2  que se escriba ANTES del correo — ése es el arreglo entero
//    3  que un correo caído NO pierda la solicitud
//    4  que una base caída SÍ se diga, en vez de contestar ok
//    5  que sin equipo o sin correo no se escriba nada
// ══════════════════════════════════════════════════════════════════
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let fallos = 0;
const ok  = (t) => console.log('  ok   ' + t);
const mal = (t) => { fallos++; console.log('  MAL  ' + t) };
const si  = (c, t) => c ? ok(t) : mal(t);
const eq  = (a, b, t) => JSON.stringify(a) === JSON.stringify(b)
  ? ok(t)
  : mal(t + ' → esperaba ' + JSON.stringify(b) + ' y vino ' + JSON.stringify(a));

const PUERTO = 3400 + Math.floor(Math.random() * 300);

function levantar(extra){
  const filas = path.join(os.tmpdir(), 'solicitud-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.jsonl');
  fs.writeFileSync(filas, '');
  const hijo = spawn(process.execPath,
    ['--require', path.join(__dirname, 'prueba-solicitud-doble.js'), path.join(__dirname, 'server.js')],
    { env: Object.assign({}, process.env, {
        PORT: String(PUERTO),
        FILAS: filas,
        SUPABASE_URL: 'https://ejemplo.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'llave-de-mentira',
        RESEND_API_KEY: 'resend-de-mentira',
        ADMIN_EMAIL: 'admin@ejemplo.test',
        STRIPE_SECRET_KEY: 'sk_test_x'
      }, extra || {}),
      stdio: ['ignore', 'pipe', 'pipe'] });
  return { hijo, filas };
}

function esperar(ms){ return new Promise((r) => setTimeout(r, ms)) }

function pedir(cuerpo){
  return new Promise((resolve) => {
    const datos = JSON.stringify(cuerpo);
    const r = http.request({ host: '127.0.0.1', port: PUERTO, path: '/team-signup', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(datos) } },
      (res) => { let t = ''; res.on('data', (c) => t += c);
        res.on('end', () => { let j = null; try { j = JSON.parse(t) } catch(e){}
          resolve({ http: res.statusCode, cuerpo: j }) }) });
    r.on('error', () => resolve({ http: 0, cuerpo: null }));
    r.write(datos); r.end();
  });
}

const leer = (f) => fs.readFileSync(f, 'utf8').trim().split('\n')
  .filter(Boolean).map((l) => JSON.parse(l));

const SOLICITUD = {
  team: 'Paradiso 6to', program: 'Paradiso College Prep', coach: 'John',
  email: 'coach@ejemplo.test', phone: '787-555-0100',
  license: { accepted: true, by: 'John Burgos', at: '2026-10-26',
             terms: '<b>Una licencia por evento</b>, $49.' }
};

(async () => {

// ── 1 y 2 ─────────────────────────────────────────────────────────
console.log('\n1 · Se guarda, y se guarda antes de avisar\n');
{
  const { hijo, filas } = levantar();
  await esperar(900);
  const r = await pedir(SOLICITUD);
  await esperar(400);
  const hecho = leer(filas);

  eq(r.http, 200, 'contesta 200');
  si(r.cuerpo && r.cuerpo.ok === true && r.cuerpo.guardada === true,
     'y dice que quedó guardada');

  const ins = hecho.filter((x) => x.tipo === 'insert')[0];
  si(!!ins, 'se escribió una fila');
  eq(ins && ins.tabla, 'solicitudes', 'en solicitudes');
  eq(ins && ins.fila.equipo, 'Paradiso 6to', 'con el equipo');
  eq(ins && ins.fila.email, 'coach@ejemplo.test', 'con el correo del coach');
  eq(ins && ins.fila.coach, 'John', 'con el coach');
  eq(ins && ins.fila.telefono, '787-555-0100', 'con el teléfono');
  eq(ins && ins.fila.licencia_ok, true, 'con el acuse de la licencia');
  eq(ins && ins.fila.licencia_por, 'John Burgos', 'y quién lo marcó');
  /* El texto de la licencia se guarda SIN etiquetas: es un acuse
     para leer dentro de un año, no un trozo de página. */
  si(ins && ins.fila.licencia_texto && ins.fila.licencia_texto.indexOf('<b>') === -1,
     'y el texto aceptado, sin etiquetas');

  /* EL ARREGLO ENTERO, EN UNA LÍNEA. Si el correo se manda primero,
     un Resend caído se lleva la solicitud — que es exactamente lo
     que pasaba. El orden en el que ocurrieron las dos cosas es lo
     único que lo demuestra. */
  const orden = hecho.map((x) => x.tipo);
  si(orden.indexOf('insert') !== -1 && orden.indexOf('correo') !== -1 &&
     orden.indexOf('insert') < orden.indexOf('correo'),
     'y la fila se escribió ANTES del correo (' + orden.join(' → ') + ')');

  hijo.kill(); fs.unlinkSync(filas);
}

// ── 3 ─────────────────────────────────────────────────────────────
console.log('\n2 · Un correo caído no pierde la solicitud\n');
{
  const { hijo, filas } = levantar({ FALLA_CORREO: '1' });
  await esperar(900);
  const r = await pedir(SOLICITUD);
  await esperar(400);
  const hecho = leer(filas);

  si(!!hecho.filter((x) => x.tipo === 'insert')[0], 'la fila está');
  eq(r.http, 200, 'y se contesta 200 igual');
  /* ok:true A PROPÓSITO. Para el entrenador la inscripción salió
     bien; que no nos llegara el correo es problema nuestro, y la
     solicitud está en el admin de todas formas. */
  si(r.cuerpo && r.cuerpo.ok === true, 'el entrenador queda inscrito');
  eq(r.cuerpo && r.cuerpo.aviso, 'no-salio-el-correo', 'y se dice que el aviso no salió');

  hijo.kill(); fs.unlinkSync(filas);
}

// ── 4 ─────────────────────────────────────────────────────────────
console.log('\n3 · Una base caída sí se dice\n');
{
  const { hijo, filas } = levantar({ FALLA_BASE: '1' });
  await esperar(900);
  const r = await pedir(SOLICITUD);
  await esperar(400);
  const hecho = leer(filas);

  eq(r.http, 500, 'contesta 500');
  eq(r.cuerpo && r.cuerpo.error, 'no-se-pudo-guardar', 'y dice por qué');
  si(!(r.cuerpo && r.cuerpo.ok), 'y NO dice que salió bien');
  /* Y NO SE MANDA EL CORREO. Avisar de una solicitud que no existe
     deja un correo apuntando a una cola vacía, y a alguien
     buscándola. */
  si(!hecho.filter((x) => x.tipo === 'correo')[0],
     'y no sale un aviso de algo que no se guardó');

  hijo.kill(); fs.unlinkSync(filas);
}

// ── 5 ─────────────────────────────────────────────────────────────
console.log('\n4 · Sin equipo o sin correo no se escribe nada\n');
{
  const { hijo, filas } = levantar();
  await esperar(900);
  const a = await pedir({ email: 'solo@correo.test' });
  const b = await pedir({ team: 'Solo el equipo' });
  await esperar(300);
  const hecho = leer(filas);

  eq(a.http, 400, 'sin equipo → 400');
  eq(b.http, 400, 'sin correo → 400');
  eq(hecho.length, 0, 'y no quedó ni una fila ni un correo');

  hijo.kill(); fs.unlinkSync(filas);
}

console.log('\n' + (fallos === 0
  ? '✓ la solicitud se guarda primero, y el aviso vuelve a ser un extra'
  : '✗ ' + fallos + ' fallo(s)') + '\n');
process.exit(fallos === 0 ? 0 : 1);

})();

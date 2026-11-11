// ══════════════════════════════════════════════════════════════════
//  POST /hoja/leer — reads a photo of a paper scoresheet with Claude
//  and returns the box score as data. It saves nothing: the scorer
//  checks every number on marcadorpr.com/hoja.html and the page saves
//  it with bw_hoja_guardar (marcador-hojas.sql), with their own code.
//
//  Needs ANTHROPIC_API_KEY on Render. HOJA_MODEL is optional.
//  Mounted BEFORE the global express.json(): a photo is larger than
//  its 100 kB limit, so this router parses its own body.
// ══════════════════════════════════════════════════════════════════
const express = require('express');

const ORIGEN = /^https:\/\/(www\.)?(marcadorpr|cadapunto|hooporia)\.com$/;
/* Opus reads handwriting best; a photo still costs only a few cents. HOJA_MODEL overrides. */
const MODELO = () => process.env.HOJA_MODEL || 'claude-opus-5-5';
const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];

const equipo = {
  type: 'object',
  properties: {
    nombre: { type: 'string', description: 'Team name exactly as written (e.g. "Equipo 5 Amarillo").' },
    periodos: { type: 'array', items: { type: ['integer', 'null'] }, description: 'Points scored in each period (not running totals). null if unreadable.' },
    total: { type: ['integer', 'null'], description: 'Final points. Prefer the last mark of the running score.' },
    jugadores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          numero: { type: 'string' },
          nombre: { type: 'string' },
          puntos: { type: ['integer', 'null'] },
          faltas: { type: ['integer', 'null'] }
        },
        required: ['numero', 'nombre', 'puntos', 'faltas']
      }
    }
  },
  required: ['nombre', 'periodos', 'total', 'jugadores']
};

const HERRAMIENTA = {
  name: 'box_score',
  description: 'The box score read from the photographed basketball scoresheet.',
  input_schema: {
    type: 'object',
    properties: {
      es_hoja: { type: 'boolean', description: 'false if the photo is not a basketball scoresheet.' },
      fecha: { type: 'string' },
      lugar: { type: 'string' },
      categoria: { type: 'string' },
      a: equipo,
      b: equipo,
      dudas: { type: 'array', items: { type: 'string' }, description: 'Short notes, one per thing that was hard to read or did not add up. Write them in Spanish.' }
    },
    required: ['es_hoja', 'a', 'b', 'dudas']
  }
};

const INSTRUCCION =
  'This is a photo of a paper basketball scoresheet from a youth league in Puerto Rico. ' +
  'Team A is the team listed first (left or top), team B the second.\n\n' +
  'HOW THESE SHEETS ARE FILLED IN — use this to read them:\n' +
  '- Each player row has one box per period (1st, 2nd, 3rd, 4th, then overtime). In a box the scorer marks every basket: ' +
  'an X for 2 points, a 3 for a three-pointer, and a dot or small circle for each made free throw (1 point). ' +
  'After the marks the scorer usually writes that period\'s points after a dash, for example "XX-4", "XXX-6", "3X•X-8", "X-2", "3-3". ' +
  'Use the number after the dash as the player\'s points in that period; if there is no number, count the marks. An empty box is 0.\n' +
  '- A player\'s points for the game are the sum of their periods. A TP (total points) column, when filled, should match that sum; ' +
  'if a TP number is hard to place on a row, trust the sum of the period boxes.\n' +
  '- Personal fouls are marked in the small foul boxes beside the name (numbers 1 to 5 crossed out or ticked). Count the marked ones.\n' +
  '- Large circled numbers near each period column are usually the team\'s points in that period. The running score (a row of numbers crossed out in order) ' +
  'ends at the team\'s final score. A team\'s points in a period should equal the sum of its players\' points in that period: ' +
  'when they disagree, give the players\' sum and note it in dudas.\n' +
  '- If no final score is written, the team total is the sum of its players\' points.\n' +
  '- A player marked "NO" or with an empty row did not play: include them with 0 points only if they are listed with a name.\n\n' +
  'Read every player row: jersey number, name, points and personal fouls. Periods are points scored in that period, not running totals. ' +
  'Read only what is on the sheet. Never invent a player, a name or a number: if something truly cannot be read, use null and add a short note to dudas (in Spanish). ' +
  'Answer only by calling the box_score tool, once, with everything you read.';

function limite() {
  const golpes = new Map();
  return (req, res, next) => {
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
    const ahora = Date.now();
    const lista = (golpes.get(ip) || []).filter((t) => ahora - t < 3600e3);
    if (lista.length >= 30) return res.status(429).json({ ok: false, error: 'too_many' });
    lista.push(ahora); golpes.set(ip, lista); next();
  };
}

// Keep only the fields we asked for, with sane types and sizes.
function limpiar(x) {
  const txt = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const num = (v) => (Number.isInteger(v) && v >= 0 && v <= 400 ? v : null);
  const eq = (e) => ({
    nombre: txt(e && e.nombre, 80),
    periodos: (Array.isArray(e && e.periodos) ? e.periodos : []).slice(0, 8).map(num),
    total: num(e && e.total),
    jugadores: (Array.isArray(e && e.jugadores) ? e.jugadores : []).slice(0, 20).map((j) => ({
      numero: txt(j && String(j.numero ?? ''), 4), nombre: txt(j && j.nombre, 60),
      puntos: num(j && j.puntos), faltas: num(j && j.faltas) === null ? null : Math.min(num(j.faltas), 6)
    }))
  });
  return {
    es_hoja: x.es_hoja !== false,
    fecha: txt(x.fecha, 40), lugar: txt(x.lugar, 80), categoria: txt(x.categoria, 40),
    a: eq(x.a), b: eq(x.b),
    dudas: (Array.isArray(x.dudas) ? x.dudas : []).slice(0, 12).map((d) => txt(d, 200)).filter(Boolean)
  };
}

/* Why Anthropic said no, as one short word the page can explain to the
   organizer — so nobody has to open the Render logs to find out. Never
   includes the key or anything secret. */
function motivo(status, body) {
  if (/credit balance|billing|purchase credits/i.test(body)) return 'sin_credito';
  if (status === 401 || /authentication|invalid x-api-key/i.test(body)) return 'clave';
  if (status === 403) return 'permiso';
  if (status === 404 || /not_found_error/.test(body)) return 'modelo';
  if (status === 429 || status === 529 || status >= 500) return 'ocupado';
  if (status === 413 || /too large|image/i.test(body)) return 'foto';
  return 'otro_' + status;
}

async function claudeLee(imagen, tipo) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      /* tool_choice stays 'auto': current models think before answering, and the
         API refuses a forced tool together with thinking. The instruction asks
         for the tool instead. */
      model: MODELO(), max_tokens: 16000,
      tools: [HERRAMIENTA], tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: tipo, data: imagen } },
        { type: 'text', text: INSTRUCCION }
      ] }]
    })
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    const err = new Error('anthropic ' + r.status + ': ' + body.slice(0, 200));
    err.motivo = motivo(r.status, body);
    /* Anthropic's own one-line reason (it never contains the key), for the page */
    try { err.detalle = String(JSON.parse(body).error.message || '').slice(0, 160) } catch (x) { err.detalle = '' }
    throw err;
  }
  const j = await r.json();
  const uso = (j.content || []).find((c) => c.type === 'tool_use');
  if (!uso) { const e = new Error('no tool_use in the answer'); e.motivo = 'sin_respuesta'; throw e }
  return uso.input;
}

/* opts.base: something with rpc(fn, args) (supabase-js, or the tests'
   local Postgres). opts.leer: replaces Claude in the tests. */
module.exports = function hojas(opts) {
  const r = express.Router();
  r.use((req, res, next) => {
    const o = req.headers.origin || '';
    if (ORIGEN.test(o) || /^http:\/\/localhost(:\d+)?$/.test(o)) {
      res.setHeader('Access-Control-Allow-Origin', o);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  r.post('/leer', limite(), express.json({ limit: '8mb' }), async (req, res) => {
    const { code, imagen, tipo } = req.body || {};
    if (!code || typeof imagen !== 'string' || !TIPOS.includes(tipo)) return res.status(400).json({ ok: false, error: 'bad_request' });
    if (imagen.length > 7e6) return res.status(413).json({ ok: false, error: 'too_big' });
    const { data: cod, error } = await opts.base.rpc('bw_code_id', { p_code: String(code) });
    if (error) return res.status(502).json({ ok: false, error: 'db' });
    if (!cod) return res.status(403).json({ ok: false, error: 'bad_code' });
    if (!opts.leer && !process.env.ANTHROPIC_API_KEY) return res.status(503).json({ ok: false, error: 'no_key' });
    try {
      const t0 = Date.now();
      const crudo = await (opts.leer || claudeLee)(imagen, tipo);
      console.log('/hoja/leer ok ' + (Date.now() - t0) + 'ms');
      return res.json({ ok: true, hoja: limpiar(crudo || {}) });
    } catch (e) {
      console.error('/hoja/leer:', e.message);
      return res.status(502).json({ ok: false, error: 'ai', motivo: e.motivo || 'red', detalle: e.detalle || '' });
    }
  });
  return r;
};
module.exports.limpiar = limpiar;
module.exports.motivo = motivo;

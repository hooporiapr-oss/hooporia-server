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
const MODELO = () => process.env.HOJA_MODEL || 'claude-sonnet-5-5';
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
  'Team A is the team listed first (left or top), team B the second. ' +
  'For each team read every player row: jersey number, name, points and personal fouls. ' +
  'If points are not written as a number, count them from the marks in that row. ' +
  'Read points per period from the running-score columns (points in that period, not the running total). ' +
  'Read only what is on the sheet. Never invent a player, a name or a number: if something cannot be read, use null and add a note to dudas. ' +
  'If the players\' points do not add up to the team total, say so in dudas.';

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
  if (status === 404 || /model/i.test(body) && status === 400) return 'modelo';
  if (status === 429 || status === 529 || status >= 500) return 'ocupado';
  if (status === 413 || /too large|image/i.test(body)) return 'foto';
  return 'otro_' + status;
}

async function claudeLee(imagen, tipo) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODELO(), max_tokens: 4000,
      tools: [HERRAMIENTA], tool_choice: { type: 'tool', name: 'box_score' },
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
    throw err;
  }
  const j = await r.json();
  const uso = (j.content || []).find((c) => c.type === 'tool_use');
  if (!uso) throw new Error('no tool_use in the answer');
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
      return res.status(502).json({ ok: false, error: 'ai', motivo: e.motivo || 'red' });
    }
  });
  return r;
};
module.exports.limpiar = limpiar;
module.exports.motivo = motivo;

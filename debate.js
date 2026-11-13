// ══════════════════════════════════════════════════════════════════
//  /debate — El Debate del Día on cognogym.com/debate.
//    GET  /debate/hoy?v=<visitor>     today's question, my vote, yesterday
//    POST /debate/votar {fecha, opcion, v}
//    GET  /debate/archivo?antes=YYYY-MM-DD
//  Everything is decided in Postgres (cognogym-debate.sql): which day
//  it is, whether a vote counts, the real totals. This only passes the
//  calls through, adds the network hash, and limits how fast one
//  address can hammer it. Mounted before express.json() in server.js.
// ══════════════════════════════════════════════════════════════════
const express = require('express');
const crypto = require('crypto');

const ORIGEN = /^https:\/\/(www\.)?cognogym\.com$/;

function limite(max, ventana) {
  const golpes = new Map();
  return (req, res, next) => {
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
    const ahora = Date.now();
    const lista = (golpes.get(ip) || []).filter((t) => ahora - t < ventana);
    if (lista.length >= max) return res.status(429).json({ ok: false, error: 'too_many' });
    lista.push(ahora); golpes.set(ip, lista); next();
  };
}

/* A one-way fingerprint of the voter's network for one day: enough to
   cap how many votes come from one place, never reversible to an
   address, and different every day so it can't follow anyone. */
function red(req, fecha) {
  const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  const sal = process.env.DEBATE_SAL || process.env.SUPABASE_SERVICE_ROLE_KEY || 'cognogym';
  return crypto.createHash('sha256').update(sal + '|' + fecha + '|' + ip).digest('hex').slice(0, 32);
}

const visitante = (v) => (typeof v === 'string' && /^[a-z0-9-]{8,64}$/.test(v) ? v : '');
const fechaOk = (f) => typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f);

/* opts.base: something with rpc(fn, args) — supabase-js with the
   service key, or the tests' local Postgres. */
module.exports = function debate(opts) {
  const r = express.Router();
  r.use((req, res, next) => {
    const o = req.headers.origin || '';
    if (ORIGEN.test(o) || /^http:\/\/localhost(:\d+)?$/.test(o)) {
      res.setHeader('Access-Control-Allow-Origin', o);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  const pasar = async (res, fn, args) => {
    const { data, error } = await opts.base.rpc(fn, args);
    if (error) { console.error('/debate ' + fn + ':', error.message); return res.status(502).json({ ok: false, error: 'db' }) }
    return res.json({ ok: true, data });
  };
  r.get('/hoy', limite(120, 60e3), (req, res) => pasar(res, 'cg_debate_hoy', { p_visitante: visitante(req.query.v) }));
  r.get('/archivo', limite(60, 60e3), (req, res) => {
    const antes = fechaOk(req.query.antes) ? req.query.antes : null;
    return pasar(res, 'cg_debate_archivo', { p_antes: antes, p_n: 10 });
  });
  r.post('/votar', limite(20, 3600e3), express.json({ limit: '1kb' }), async (req, res) => {
    const { fecha, opcion, v } = req.body || {};
    if (!fechaOk(fecha) || typeof opcion !== 'string' || opcion.length > 4 || !visitante(v)) return res.status(400).json({ ok: false, error: 'mal' });
    const { data, error } = await opts.base.rpc('cg_debate_votar', { p_fecha: fecha, p_opcion: opcion, p_visitante: v, p_red: red(req, fecha) });
    if (error) { console.error('/debate votar:', error.message); return res.status(502).json({ ok: false, error: 'db' }) }
    return res.json({ ok: true, data });
  });
  // a broken or oversized body: a plain refusal, never an error page
  r.use((err, req, res, next) => res.status(400).json({ ok: false, error: 'mal' }));
  return r;
};
module.exports.red = red;

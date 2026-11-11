// ══════════════════════════════════════════════════════════════════
//  POST /avisos/apuntar — "Avísame cada lunes" on cognogym.com.
//  Saves an email or phone number with cg_aviso_apuntar()
//  (cognogym-avisos.sql). The list is never sent back to the page.
//
//  Mounted BEFORE the global express.json() and the CORS list in
//  server.js: cognogym.com is only allowed here, not on the rest of
//  the server.
// ══════════════════════════════════════════════════════════════════
const express = require('express');

const ORIGEN = /^https:\/\/(www\.)?cognogym\.com$/;

function limite(max) {
  const golpes = new Map();
  return (req, res, next) => {
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
    const ahora = Date.now();
    const lista = (golpes.get(ip) || []).filter((t) => ahora - t < 3600e3);
    if (lista.length >= max) return res.status(429).json({ ok: false, error: 'too_many' });
    lista.push(ahora); golpes.set(ip, lista); next();
  };
}

/* opts.base: something with rpc(fn, args) — supabase-js with the
   service key, or the tests' local Postgres.
   opts.avisar(datos): called for every NEW signup; server.js emails it
   to cognogym@gmail.com. It never holds up or fails the signup. */
module.exports = function avisos(opts) {
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
  r.post('/apuntar', limite(10), express.json({ limit: '2kb' }), async (req, res) => {
    const { contacto, reto, web } = req.body || {};
    if (web) return res.json({ ok: true, estado: 'nuevo' });           // a bot filled the hidden field: pretend, save nothing
    if (typeof contacto !== 'string' || !contacto.trim() || contacto.length > 160) return res.status(400).json({ ok: false, error: 'mal' });
    const { data, error } = await opts.base.rpc('cg_aviso_apuntar', { p_contacto: contacto, p_reto: typeof reto === 'string' ? reto.slice(0, 80) : null });
    if (error) { console.error('/avisos/apuntar:', error.message); return res.status(502).json({ ok: false, error: 'db' }) }
    if (data === 'mal') return res.status(400).json({ ok: false, error: 'mal' });
    console.log('/avisos/apuntar ' + data);
    res.json({ ok: true, estado: data });
    if (data === 'nuevo' && opts.avisar) {
      let total = null;
      try { const t = await opts.base.rpc('cg_avisos_total', {}); total = t.error ? null : t.data } catch (e) {}
      Promise.resolve().then(() => opts.avisar({ contacto: contacto.trim(), reto: typeof reto === 'string' ? reto.slice(0, 80) : '', total }))
        .catch((e) => console.error('/avisos aviso por email:', e.message));
    }
  });
  return r;
};

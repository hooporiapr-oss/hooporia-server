// ══════════════════════════════════════════════════════════════════
//  EL DOBLE — se carga ANTES que server.js, con --require
//
//  server.js llama a createClient y a fetch en cuanto arranca, y no
//  exporta nada: escucha y ya. Así que para probarlo sin tocarlo se
//  le cambia el mundo por debajo antes de que lo mire — el módulo de
//  Supabase y el fetch global — y luego se le deja arrancar.
//
//  Lo que la base de mentira hace se escribe, una fila por línea, en
//  el fichero que diga FILAS. Es cómo la prueba, que vive en otro
//  proceso, se entera de lo que pasó aquí dentro.
//
//  FALLA_BASE=1   la inserción revienta
//  FALLA_CORREO=1 Resend contesta 500
// ══════════════════════════════════════════════════════════════════
const fs = require('fs');
const Module = require('module');

const FILAS = process.env.FILAS;
const apunta = (que) => { try { fs.appendFileSync(FILAS, JSON.stringify(que) + '\n') } catch(e){} };

const baseFalsa = {
  from(tabla){
    return {
      insert(fila){
        if (process.env.FALLA_BASE === '1'){
          apunta({ tipo: 'insert-fallido', tabla });
          return Promise.resolve({ data: null, error: { message: 'la base dijo que no' } });
        }
        apunta({ tipo: 'insert', tabla, fila });
        return Promise.resolve({ data: [fila], error: null });
      },
      select(){ const q = { data: [], error: null };
        q.eq = () => q; q.in = () => q; q.maybeSingle = () => Promise.resolve({ data: null, error: null });
        q.then = (r) => Promise.resolve({ data: [], error: null }).then(r);
        return q; },
      update(){ const q = {}; q.eq = () => q;
        q.then = (r) => Promise.resolve({ data: null, error: null }).then(r); return q; }
    };
  }
};

/* El módulo de Supabase, cambiado antes de que nadie lo pida. */
const cargar = Module._load;
Module._load = function(peticion, padre, principal){
  if (peticion === '@supabase/supabase-js') return { createClient: () => baseFalsa };
  if (peticion === 'stripe') return () => ({ webhooks: { constructEvent(){ throw new Error('sin stripe') } } });
  return cargar.apply(this, arguments);
};

/* Y el fetch, que es por donde sale el correo. Se apunta que salió
   —o que se intentó— para poder comprobar el ORDEN: la fila primero
   y el aviso después. */
const fetchDeVerdad = global.fetch;
global.fetch = function(url, opciones){
  if (String(url).indexOf('api.resend.com') !== -1){
    apunta({ tipo: 'correo', asunto: (() => {
      try { return JSON.parse(opciones.body).subject } catch(e){ return null }
    })() });
    if (process.env.FALLA_CORREO === '1'){
      return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('no') });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 'x' }) });
  }
  return fetchDeVerdad.apply(this, arguments);
};

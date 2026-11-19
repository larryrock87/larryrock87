/**
 * Almacenamiento del festival.
 *
 * Modo "local"    : base de datos en DATA_DIR/db.json y archivos en DATA_DIR/uploads.
 * Modo "supabase" : base de datos en una tabla de Supabase (Postgres) y fotos,
 *                   audios y video en Supabase Storage. Se activa definiendo
 *                   SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.
 *
 * El servidor mantiene el estado en memoria (una sola instancia) y lo guarda
 * con límite de frecuencia. En modo Supabase también conserva una copia local
 * como respaldo.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const MIME_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'video/webm', mp4: 'video/mp4', mov: 'video/quicktime' };

function createStore({ dataDir, supabaseUrl, supabaseKey, bucket = 'festival', table = 'festival_state', rowId = 1, log = console }) {
  const uploadDir = path.join(dataDir, 'uploads');
  const dbFile = path.join(dataDir, 'db.json');
  fs.mkdirSync(uploadDir, { recursive: true });

  const remote = !!(supabaseUrl && supabaseKey);
  let sb = null;
  if (remote) {
    const { createClient } = require('@supabase/supabase-js');
    sb = createClient(supabaseUrl.replace(/\/+$/, ''), supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  const publicBase = remote ? `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${bucket}/` : '/uploads/';

  /* ---------------- base de datos ---------------- */
  function writeLocal(db) {
    const tmp = dbFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, dbFile);
  }
  const backupDir = path.join(dataDir, 'backups');
  /** Copia de seguridad del estado actual (se conservan las últimas 15). */
  function snapshot(label) {
    try {
      if (!fs.existsSync(dbFile)) return null;
      fs.mkdirSync(backupDir, { recursive: true });
      const name = `db-${new Date().toISOString().replace(/[:.]/g, '-')}-${label}.json`;
      fs.copyFileSync(dbFile, path.join(backupDir, name));
      const all = fs.readdirSync(backupDir).filter((f) => f.startsWith('db-')).sort();
      all.slice(0, Math.max(0, all.length - 15)).forEach((f) => fs.rm(path.join(backupDir, f), () => {}));
      return name;
    } catch (e) { log.error('  ⚠ No se pudo crear la copia de seguridad:', e.message); return null; }
  }
  function readLocal() {
    let txt;
    try { txt = fs.readFileSync(dbFile, 'utf8'); } catch { return null; } // aún no existe: primer arranque
    try {
      const raw = JSON.parse(txt);
      snapshot('inicio'); // cada arranque guarda una copia de lo que había
      return raw;
    } catch (e) {
      // El archivo existe pero no se puede leer: se conserva aparte para no perderlo
      const bad = path.join(dataDir, `db.ilegible-${Date.now()}.json`);
      try { fs.writeFileSync(bad, txt); } catch {}
      log.error(`  ⚠ No se pudo leer ${dbFile} (${e.message}). Se guardó una copia en ${bad}.`);
      return null;
    }
  }

  async function load() {
    if (!remote) return readLocal();
    const { data, error } = await sb.from(table).select('data').eq('id', rowId).maybeSingle();
    if (error) throw new Error(`No se pudo leer la tabla "${table}" de Supabase: ${error.message}. ¿Ejecutó el script supabase/setup.sql?`);
    if (data && data.data) return data.data;
    // primera vez: si hay datos locales (migración), se suben a Supabase
    return readLocal();
  }

  // "pending" indica que hay cambios sin subir; "latest" es la referencia al estado en memoria.
  // El estado se serializa una sola vez, en el momento de enviarlo (no en cada voto).
  let pending = false, latest = null, timer = null, inflight = null, failures = 0, lastError = null, lastSavedAt = null;
  async function pushRemote() {
    if (!pending || !latest) return;
    pending = false;
    const body = JSON.stringify({ id: rowId, data: latest, updated_at: new Date().toISOString() });
    const { error } = await sb.from(table).upsert(JSON.parse(body));
    if (error) {
      failures++; lastError = error.message;
      pending = true; // reintentar con el dato más reciente
      log.error(`  ⚠ Supabase: no se pudo guardar (intento ${failures}): ${error.message}`);
      throw error;
    }
    failures = 0; lastError = null; lastSavedAt = Date.now();
  }
  function schedule(delay) {
    if (timer) return;
    timer = setTimeout(async () => {
      timer = null;
      if (inflight) { schedule(200); return; }
      inflight = pushRemote().catch(() => {}).finally(() => { inflight = null; if (pending) schedule(Math.min(30000, 1000 * 2 ** Math.min(failures, 5))); });
    }, delay);
  }

  let localTimer = null;
  /** Guarda (con límite de frecuencia). Nunca pospone el guardado indefinidamente. */
  function save(db) {
    if (!localTimer) localTimer = setTimeout(() => { localTimer = null; try { writeLocal(db); } catch (e) { log.error('  ⚠ No se pudo escribir la copia local:', e.message); } }, 300);
    if (remote) { latest = db; pending = true; schedule(1000); }
  }
  /** Guardado inmediato (cambios importantes). */
  function saveNow(db) {
    clearTimeout(localTimer); localTimer = null;
    try { writeLocal(db); } catch (e) { log.error('  ⚠ No se pudo escribir la copia local:', e.message); }
    if (remote) { latest = db; pending = true; clearTimeout(timer); timer = null; schedule(0); }
  }
  /** Espera a que todo quede guardado (al apagar el servidor). */
  async function flush(db) {
    clearTimeout(localTimer); localTimer = null;
    try { writeLocal(db); } catch {}
    if (!remote) return;
    clearTimeout(timer); timer = null;
    if (inflight) await inflight;
    latest = db; pending = true;
    try { await pushRemote(); } catch {}
  }

  /* ---------------- archivos ---------------- */
  const extOf = (name) => path.extname(name).slice(1).toLowerCase();

  /** Guarda un archivo (Buffer o ruta de archivo temporal) y devuelve su URL pública. */
  async function putFile(name, source, contentType) {
    contentType = contentType || MIME_EXT[extOf(name)] || 'application/octet-stream';
    if (!remote) {
      const dest = path.join(uploadDir, name);
      if (Buffer.isBuffer(source)) fs.writeFileSync(dest, source); else fs.renameSync(source, dest);
      return `/uploads/${name}`;
    }
    const body = Buffer.isBuffer(source) ? source : fs.readFileSync(source);
    const { error } = await sb.storage.from(bucket).upload(name, body, { contentType, upsert: true, cacheControl: '604800' });
    if (!Buffer.isBuffer(source)) fs.rm(source, () => {});
    if (error) {
      const msg = /exceeded|too large|size/i.test(error.message) ? 'El archivo supera el tamaño permitido por Supabase Storage (50 MB en el plan gratuito).' : `Supabase Storage: ${error.message}`;
      throw Object.assign(new Error(msg), { status: 502 });
    }
    return publicBase + encodeURIComponent(name);
  }

  function removeFile(url) {
    if (!url) return;
    if (url.startsWith('/uploads/')) { fs.rm(path.join(uploadDir, path.basename(url)), () => {}); return; }
    if (remote && url.startsWith(publicBase)) {
      const name = decodeURIComponent(url.slice(publicBase.length));
      sb.storage.from(bucket).remove([name]).then(({ error }) => error && log.error('  ⚠ Supabase Storage: no se pudo borrar', name, error.message));
    }
  }

  function status() {
    return { mode: remote ? 'supabase' : 'local', dir: remote ? null : dataDir, lastSavedAt, failures, lastError, pending: pending || !!inflight };
  }

  return { mode: remote ? 'supabase' : 'local', uploadDir, tmpDir: uploadDir, load, save, saveNow, flush, putFile, removeFile, status, snapshot };
}

module.exports = { createStore };

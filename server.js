/**
 * Festival de la Voz Ministerial del MPPD 2026
 * Sistema de votación en vivo — servidor
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const compression = require('compression');

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'mppd2026';

// En Internet nunca se arranca con la contraseña de ejemplo
if (IS_PROD && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 8 || process.env.ADMIN_PASSWORD === 'mppd2026')) {
  console.error('\n  ✖ Defina la variable ADMIN_PASSWORD (mínimo 8 caracteres, distinta de "mppd2026") antes de publicar en Internet.\n');
  process.exit(1);
}
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_PARTICIPANTS = 30;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/* Persistencia                                                        */
/* ------------------------------------------------------------------ */

const rid = (n = 12) => crypto.randomBytes(n).toString('hex');

function defaultDb() {
  return {
    settings: {
      title: 'Festival de la Voz Ministerial del MPPD',
      year: '2026',
      publicUrl: '',          // URL que codifica el QR (si vacío, se usa la del navegador del admin)
      strictMode: false,      // además de la cookie, bloquea por huella del dispositivo
      screenKey: rid(6),      // clave para abrir la pantalla de gala
    },
    participants: [],         // {id, grado, nombre, apellidos, photo, order}
    voting: {
      status: 'idle',         // idle | scheduled | open | closed
      round: rid(6),
      startsAt: null,
      endsAt: null,
      openedOnce: false,
    },
    votes: {},                // participantId -> votos reales
    adjust: {},               // participantId -> ajuste manual del admin
    voters: {},               // voterId -> { p: participantId, t: timestamp }
    fingerprints: {},         // hash -> voterId
    audit: [],                // registro de ajustes manuales
    screen: { mode: 'espera', showCounts: true, revealAt: 0 },
    sessions: {},             // token de administrador -> vence (sobrevive reinicios)
  };
}

let db;
try {
  db = Object.assign(defaultDb(), JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  db.settings = Object.assign(defaultDb().settings, db.settings);
  db.screen = Object.assign(defaultDb().screen, db.screen);
  db.sessions = db.sessions || {};
} catch {
  db = defaultDb();
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  }, 150);
}
function saveNow() {
  clearTimeout(saveTimer);
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
save();

/* ------------------------------------------------------------------ */
/* Vistas de datos                                                     */
/* ------------------------------------------------------------------ */

const sortedParticipants = () =>
  [...db.participants].sort((a, b) => a.order - b.order);

function publicParticipants() {
  return sortedParticipants().map((p, i) => ({
    id: p.id,
    number: i + 1,
    grado: p.grado,
    nombre: p.nombre,
    apellidos: p.apellidos,
    photo: p.photo,
  }));
}

function publicState() {
  const v = db.voting;
  return {
    title: db.settings.title,
    year: db.settings.year,
    now: Date.now(),
    voting: {
      status: v.status,
      round: v.round,
      // el público sólo ve la hora de cierre mientras la votación está abierta
      endsAt: v.status === 'open' ? v.endsAt : null,
      startsAt: v.status === 'open' ? v.startsAt : null,
    },
    participants: publicParticipants(),
  };
}

function results() {
  const list = sortedParticipants().map((p, i) => {
    const real = db.votes[p.id] || 0;
    const adj = db.adjust[p.id] || 0;
    return {
      id: p.id,
      number: i + 1,
      grado: p.grado,
      nombre: p.nombre,
      apellidos: p.apellidos,
      photo: p.photo,
      real,
      adjust: adj,
      votes: Math.max(0, real + adj),
    };
  });
  const total = list.reduce((s, r) => s + r.votes, 0);
  const totalReal = list.reduce((s, r) => s + r.real, 0);
  list.forEach((r) => (r.pct = total ? (r.votes / total) * 100 : 0));
  const ranking = [...list].sort((a, b) => b.votes - a.votes || a.number - b.number);
  return { now: Date.now(), total, totalReal, voters: Object.keys(db.voters).length, list, ranking };
}

function screenResults() {
  const r = results();
  const strip = (x) => {
    const { real, adjust, ...rest } = x;
    return rest;
  };
  return {
    now: r.now,
    total: r.total,
    list: r.list.map(strip),
    ranking: r.ranking.map(strip),
  };
}

function adminState() {
  return {
    ...publicState(),
    votingFull: db.voting,
    settings: db.settings,
    screen: db.screen,
    results: results(),
    audit: db.audit.slice(-50).reverse(),
    maxParticipants: MAX_PARTICIPANTS,
    lanUrls: lanUrls(),
  };
}

function screenState() {
  return {
    ...publicState(),
    voting: { ...publicState().voting, startsAt: db.voting.startsAt, scheduledEndsAt: db.voting.endsAt },
    screen: db.screen,
    publicUrl: db.settings.publicUrl,
    results: screenResults(),
  };
}

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${PORT}/`);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Servidor HTTP                                                       */
/* ------------------------------------------------------------------ */

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(compression());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.path.startsWith('/admin') || req.path.startsWith('/api/admin')) res.setHeader('X-Frame-Options', 'DENY');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.use(express.json({ limit: '8mb' }));
app.get('/healthz', (req, res) => res.json({ ok: true, status: db.voting.status }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

/* --- autenticación del administrador --- */
const TOKEN_TTL = 1000 * 60 * 60 * 18;

function isAdminToken(t) {
  const exp = typeof t === 'string' && Object.prototype.hasOwnProperty.call(db.sessions, t) && db.sessions[t];
  if (!exp) return false;
  if (exp < Date.now()) { delete db.sessions[t]; save(); return false; }
  return true;
}
function requireAdmin(req, res, next) {
  const t = req.get('x-admin-token');
  if (!isAdminToken(t)) return res.status(401).json({ error: 'No autorizado' });
  next();
}
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const loginAttempts = new Map(); // ip -> {n, t}
app.post('/api/admin/login', (req, res) => {
  const ip = req.ip;
  const a = loginAttempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 10 * 60 * 1000) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) return res.status(429).json({ error: 'Demasiados intentos. Espere unos minutos.' });
  if (!safeEqual(req.body?.password || '', ADMIN_PASSWORD)) {
    a.n++; loginAttempts.set(ip, a);
    // pequeña espera para frenar ataques de fuerza bruta
    return setTimeout(() => res.status(401).json({ error: 'Contraseña incorrecta' }), 600);
  }
  loginAttempts.delete(ip);
  const token = rid(24);
  for (const [k, exp] of Object.entries(db.sessions)) if (exp < Date.now()) delete db.sessions[k];
  db.sessions[token] = Date.now() + TOKEN_TTL;
  save();
  res.json({ token });
});

/* --- estáticos --- */
app.use('/fonts/cinzel', express.static(path.join(__dirname, 'node_modules/@fontsource/cinzel'), { maxAge: '30d' }));
app.use('/fonts/montserrat', express.static(path.join(__dirname, 'node_modules/@fontsource/montserrat'), { maxAge: '30d' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));
app.get('/pantalla', (req, res) => res.sendFile(path.join(__dirname, 'public/pantalla.html')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '1h' }));

/* --- API pública --- */
app.get('/api/state', (req, res) => res.json(publicState()));

function voterIdFrom(req) {
  return parseCookies(req)['fv_voter'];
}

app.get('/api/me', (req, res) => {
  const id = voterIdFrom(req);
  const v = id && db.voters[`${db.voting.round}:${id}`];
  res.json({ voted: !!v, participantId: v ? v.p : null, round: db.voting.round });
});

const voteRate = new Map(); // ip -> [timestamps]
app.post('/api/vote', (req, res) => {
  if (db.voting.status !== 'open' || (db.voting.endsAt && Date.now() > db.voting.endsAt)) {
    return res.status(409).json({ error: 'La votación no está abierta en este momento.' });
  }

  // limitador anti-abuso (por IP). Es alto a propósito: todo el público
  // conectado al mismo Wi-Fi del teatro comparte una sola IP pública.
  const now = Date.now();
  const arr = (voteRate.get(req.ip) || []).filter((t) => now - t < 60000);
  if (arr.length >= 1500) return res.status(429).json({ error: 'Demasiadas solicitudes. Intente de nuevo.' });
  arr.push(now); voteRate.set(req.ip, arr);

  const { participantId, fp, localId } = req.body || {};
  if (!db.participants.some((p) => p.id === participantId)) {
    return res.status(400).json({ error: 'Participante no válido.' });
  }

  let voterId = voterIdFrom(req);
  if (!voterId || !/^[a-f0-9]{32}$/.test(voterId)) voterId = (typeof localId === 'string' && /^[a-f0-9]{32}$/.test(localId)) ? localId : rid(16);
  const key = `${db.voting.round}:${voterId}`;

  if (db.voters[key]) {
    return res.status(409).json({ error: 'Ya registraste tu voto. ¡Gracias!', participantId: db.voters[key].p });
  }
  // también bloquea si el identificador guardado en el navegador ya votó
  if (typeof localId === 'string' && db.voters[`${db.voting.round}:${localId}`]) {
    return res.status(409).json({ error: 'Ya registraste tu voto. ¡Gracias!', participantId: db.voters[`${db.voting.round}:${localId}`].p });
  }
  let fpKey = null;
  if (db.settings.strictMode && typeof fp === 'string' && fp.length >= 8 && fp.length <= 128) {
    fpKey = `${db.voting.round}:${crypto.createHash('sha256').update(fp + '|' + req.ip).digest('hex').slice(0, 32)}`;
    if (db.fingerprints[fpKey]) {
      return res.status(409).json({ error: 'Este dispositivo ya registró un voto. ¡Gracias!' });
    }
  }

  db.voters[key] = { p: participantId, t: now };
  if (fpKey) db.fingerprints[fpKey] = voterId;
  db.votes[participantId] = (db.votes[participantId] || 0) + 1;
  save();

  res.setHeader('Set-Cookie', `fv_voter=${voterId}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax; HttpOnly${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true, participantId, voterId });
  scheduleResults();
});

app.get('/api/qr.svg', async (req, res) => {
  const url = String(req.query.u || db.settings.publicUrl || `${req.protocol}://${req.get('host')}/`).slice(0, 500);
  const dark = /^#[0-9a-f]{6}$/i.test(req.query.dark || '') ? req.query.dark : '#0b1a33';
  const light = /^#[0-9a-f]{6}$/i.test(req.query.light || '') ? req.query.light : '#ffffff';
  try {
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark, light } });
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  } catch (e) {
    res.status(400).send('QR inválido');
  }
});

app.get('/api/qr.png', async (req, res) => {
  const url = String(req.query.u || db.settings.publicUrl || `${req.protocol}://${req.get('host')}/`).slice(0, 500);
  try {
    const buf = await QRCode.toBuffer(url, { width: 1200, margin: 2, errorCorrectionLevel: 'H', color: { dark: '#0b1a33', light: '#ffffff' } });
    res.type('image/png').set('Content-Disposition', 'attachment; filename="qr-votacion-festival.png"').send(buf);
  } catch {
    res.status(400).send('QR inválido');
  }
});

/* --- API de pantalla (con clave) --- */
app.get('/api/screen', (req, res) => {
  if (req.query.k !== db.settings.screenKey && !isAdminToken(req.get('x-admin-token'))) {
    return res.status(401).json({ error: 'Clave de pantalla inválida' });
  }
  res.json(screenState());
});

/* --- API de administración --- */
const admin = express.Router();
admin.use(requireAdmin);

admin.get('/state', (req, res) => res.json(adminState()));

function savePhoto(dataUrl, id) {
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const ext = m[1] === 'jpg' ? 'jpeg' : m[1];
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 6 * 1024 * 1024) throw new Error('La foto es demasiado grande.');
  const name = `${id}-${rid(4)}.${ext === 'jpeg' ? 'jpg' : ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return `/uploads/${name}`;
}
function removePhoto(photo) {
  if (photo && photo.startsWith('/uploads/')) {
    fs.rm(path.join(UPLOAD_DIR, path.basename(photo)), () => {});
  }
}
const clean = (s, n = 80) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, n);

admin.post('/participants', (req, res) => {
  if (db.participants.length >= MAX_PARTICIPANTS) {
    return res.status(400).json({ error: `Máximo ${MAX_PARTICIPANTS} participantes.` });
  }
  const { grado, nombre, apellidos, photo } = req.body || {};
  if (!clean(nombre) || !clean(apellidos)) return res.status(400).json({ error: 'Nombre y apellidos son obligatorios.' });
  const id = rid(6);
  let photoUrl = null;
  try { photoUrl = photo ? savePhoto(photo, id) : null; } catch (e) { return res.status(400).json({ error: e.message }); }
  const order = db.participants.reduce((m, p) => Math.max(m, p.order), 0) + 1;
  db.participants.push({ id, grado: clean(grado), nombre: clean(nombre), apellidos: clean(apellidos), photo: photoUrl, order });
  save(); broadcastAll();
  res.json({ ok: true, id });
});

admin.put('/participants/:id', (req, res) => {
  const p = db.participants.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'No existe' });
  const { grado, nombre, apellidos, photo, removePhoto: rm } = req.body || {};
  if (grado !== undefined) p.grado = clean(grado);
  if (nombre !== undefined && clean(nombre)) p.nombre = clean(nombre);
  if (apellidos !== undefined && clean(apellidos)) p.apellidos = clean(apellidos);
  try {
    if (photo) { const url = savePhoto(photo, p.id); removePhoto(p.photo); p.photo = url; }
    else if (rm) { removePhoto(p.photo); p.photo = null; }
  } catch (e) { return res.status(400).json({ error: e.message }); }
  save(); broadcastAll();
  res.json({ ok: true });
});

admin.delete('/participants/:id', (req, res) => {
  const i = db.participants.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'No existe' });
  const [p] = db.participants.splice(i, 1);
  removePhoto(p.photo);
  delete db.votes[p.id]; delete db.adjust[p.id];
  save(); broadcastAll();
  res.json({ ok: true });
});

admin.post('/participants/reorder', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  ids.forEach((id, i) => { const p = db.participants.find((x) => x.id === id); if (p) p.order = i + 1; });
  save(); broadcastAll();
  res.json({ ok: true });
});

/* control de votación */
admin.post('/voting/start', (req, res) => {
  const { minutes, startsAt, endsAt } = req.body || {};
  if (!db.participants.length) return res.status(400).json({ error: 'Agregue participantes antes de abrir la votación.' });
  const now = Date.now();
  if (startsAt && endsAt) {
    const s = Number(startsAt), e = Number(endsAt);
    if (!(e > s) || e <= now) return res.status(400).json({ error: 'Las fechas de inicio/cierre no son válidas.' });
    db.voting.startsAt = s; db.voting.endsAt = e;
    db.voting.status = s <= now ? 'open' : 'scheduled';
  } else {
    const m = Number(minutes);
    if (!(m > 0 && m <= 24 * 60)) return res.status(400).json({ error: 'Duración inválida.' });
    db.voting.startsAt = now; db.voting.endsAt = now + m * 60000; db.voting.status = 'open';
  }
  if (db.voting.status === 'open') db.voting.openedOnce = true;
  saveNow(); broadcastAll();
  res.json({ ok: true });
});

admin.post('/voting/extend', (req, res) => {
  const m = Number(req.body?.minutes);
  if (!(m > 0 && m <= 600)) return res.status(400).json({ error: 'Minutos inválidos.' });
  if (db.voting.status === 'open' || db.voting.status === 'scheduled') db.voting.endsAt += m * 60000;
  else if (db.voting.status === 'closed') { // reabrir por m minutos (mismo turno: quien ya votó no puede repetir)
    db.voting.status = 'open'; db.voting.startsAt = Date.now(); db.voting.endsAt = Date.now() + m * 60000;
  } else return res.status(400).json({ error: 'La votación no ha iniciado.' });
  saveNow(); broadcastAll();
  res.json({ ok: true });
});

admin.post('/voting/stop', (req, res) => {
  if (db.voting.status === 'open' || db.voting.status === 'scheduled') {
    db.voting.status = db.voting.status === 'open' ? 'closed' : 'idle';
    db.voting.endsAt = db.voting.status === 'closed' ? Date.now() : null;
    saveNow(); broadcastAll();
  }
  res.json({ ok: true });
});

admin.post('/voting/reset', (req, res) => {
  db.voting = { status: 'idle', round: rid(6), startsAt: null, endsAt: null, openedOnce: false };
  db.votes = {}; db.adjust = {}; db.voters = {}; db.fingerprints = {};
  db.audit.push({ t: Date.now(), msg: 'Se reiniciaron todos los votos (nueva ronda).' });
  db.screen.mode = 'espera';
  saveNow(); broadcastAll();
  res.json({ ok: true });
});

/* ajuste manual de resultados */
admin.post('/adjust', (req, res) => {
  const { participantId, delta, set } = req.body || {};
  const p = db.participants.find((x) => x.id === participantId);
  if (!p) return res.status(404).json({ error: 'No existe' });
  const real = db.votes[p.id] || 0;
  const before = Math.max(0, real + (db.adjust[p.id] || 0));
  if (set !== undefined && set !== null && set !== '') {
    const n = Math.max(0, Math.floor(Number(set)));
    if (!Number.isFinite(n)) return res.status(400).json({ error: 'Valor inválido' });
    db.adjust[p.id] = n - real;
  } else {
    const d = Math.trunc(Number(delta));
    if (!Number.isFinite(d)) return res.status(400).json({ error: 'Valor inválido' });
    db.adjust[p.id] = Math.max(-real, (db.adjust[p.id] || 0) + d);
  }
  const after = Math.max(0, real + db.adjust[p.id]);
  db.audit.push({ t: Date.now(), msg: `${p.nombre} ${p.apellidos}: ${before} → ${after} votos (ajuste manual)` });
  if (db.audit.length > 500) db.audit.splice(0, db.audit.length - 500);
  save(); scheduleResults();
  res.json({ ok: true });
});

admin.post('/adjust/clear', (req, res) => {
  db.adjust = {};
  db.audit.push({ t: Date.now(), msg: 'Se eliminaron todos los ajustes manuales (resultados reales).' });
  save(); scheduleResults();
  res.json({ ok: true });
});

/* pantalla de gala */
admin.post('/screen', (req, res) => {
  const { mode, showCounts } = req.body || {};
  if (mode && ['espera', 'vivo', 'ganador', 'podio', 'participantes'].includes(mode)) {
    db.screen.mode = mode;
    if (mode === 'ganador' || mode === 'podio') db.screen.revealAt = Date.now();
  }
  if (typeof showCounts === 'boolean') db.screen.showCounts = showCounts;
  save(); broadcastAll();
  res.json({ ok: true });
});

admin.post('/settings', (req, res) => {
  const { title, year, publicUrl, strictMode, regenScreenKey } = req.body || {};
  if (title !== undefined) db.settings.title = clean(title, 120) || db.settings.title;
  if (year !== undefined) db.settings.year = clean(year, 10);
  if (publicUrl !== undefined) {
    const u = clean(publicUrl, 300);
    if (u && !/^https?:\/\//i.test(u)) return res.status(400).json({ error: 'La URL debe iniciar con http:// o https://' });
    db.settings.publicUrl = u;
  }
  if (typeof strictMode === 'boolean') db.settings.strictMode = strictMode;
  if (regenScreenKey) db.settings.screenKey = rid(6);
  save(); broadcastAll();
  res.json({ ok: true });
});

admin.post('/logout', (req, res) => {
  delete db.sessions[req.get('x-admin-token')]; save();
  res.json({ ok: true });
});

admin.get('/backup.json', (req, res) => {
  const { sessions, ...rest } = db;
  res.set('Content-Disposition', `attachment; filename="respaldo-festival-${new Date().toISOString().slice(0, 10)}.json"`).json(rest);
});

admin.get('/export.csv', (req, res) => {
  const r = results();
  const rows = [['Puesto', 'N°', 'Grado', 'Nombre', 'Apellidos', 'Votos reales', 'Ajuste', 'Votos finales', 'Porcentaje']];
  r.ranking.forEach((x, i) => rows.push([i + 1, x.number, x.grado, x.nombre, x.apellidos, x.real, x.adjust, x.votes, x.pct.toFixed(2) + '%']));
  const csv = '﻿' + rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  res.type('text/csv').set('Content-Disposition', 'attachment; filename="resultados-festival-voz-2026.csv"').send(csv);
});

app.use('/api/admin', admin);

/* ------------------------------------------------------------------ */
/* Tiempo real                                                         */
/* ------------------------------------------------------------------ */

io.on('connection', (socket) => {
  const { role, token, k } = socket.handshake.auth || {};
  if (role === 'admin' && isAdminToken(token)) {
    socket.join('admin');
    socket.emit('admin', adminState());
  } else if (role === 'screen' && (k === db.settings.screenKey || isAdminToken(token))) {
    socket.join('screen');
    socket.emit('screen', screenState());
  } else if (role === 'screen') {
    socket.emit('screen-denied');
  }
  socket.emit('state', publicState());
});

let resultsTimer = null;
function scheduleResults() {
  if (resultsTimer) return;
  resultsTimer = setTimeout(() => {
    resultsTimer = null;
    io.to('admin').emit('results', { results: results(), audit: db.audit.slice(-50).reverse() });
    io.to('screen').emit('results', screenResults());
  }, 250);
}

function broadcastAll() {
  io.emit('state', publicState());
  io.to('admin').emit('admin', adminState());
  io.to('screen').emit('screen', screenState());
}

// reloj: abre/cierra automáticamente según el horario
setInterval(() => {
  const v = db.voting, now = Date.now();
  if (v.status === 'scheduled' && v.startsAt && now >= v.startsAt) {
    v.status = 'open'; v.openedOnce = true; saveNow(); broadcastAll();
  } else if (v.status === 'open' && v.endsAt && now >= v.endsAt) {
    v.status = 'closed'; saveNow(); broadcastAll();
  }
}, 500);

// limpieza periódica del limitador de votos
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of voteRate) if (!arr.length || now - arr[arr.length - 1] > 60000) voteRate.delete(ip);
}, 5 * 60000).unref();

process.on('SIGINT', () => { saveNow(); process.exit(0); });
process.on('SIGTERM', () => { saveNow(); process.exit(0); });

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  🎤  Festival de la Voz Ministerial del MPPD 2026');
  console.log('  ───────────────────────────────────────────────');
  console.log(`  Votación pública : http://localhost:${PORT}/`);
  console.log(`  Administrador    : http://localhost:${PORT}/admin   (contraseña: ${process.env.ADMIN_PASSWORD ? '••••••' : ADMIN_PASSWORD})`);
  console.log(`  Pantalla de gala : http://localhost:${PORT}/pantalla?k=${db.settings.screenKey}`);
  lanUrls().forEach((u) => console.log(`  En la red local  : ${u}`));
  console.log('');
});

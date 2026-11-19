/**
 * Festival de la Voz Ministerial del MPPD 2026
 * Servidor: votación del público (Voz de la Audiencia), sala del jurado,
 * comunidad (me gusta y comentarios), pantalla de gala y administración.
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
const J = require('./lib/jury');
const { esOfensivo, tieneEnlace } = require('./lib/filtro');
const { createStore } = require('./lib/store');

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'mppd2026';

// En Internet nunca se arranca con la contraseña de ejemplo
if (IS_PROD && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 8 || process.env.ADMIN_PASSWORD === 'mppd2026')) {
  console.error('\n  ✖ Defina la variable ADMIN_PASSWORD (mínimo 8 caracteres, distinta de "mppd2026") antes de publicar en Internet.\n');
  process.exit(1);
}
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const store = createStore({
  dataDir: DATA_DIR,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  bucket: process.env.SUPABASE_BUCKET || 'festival',
});
const UPLOAD_DIR = store.uploadDir;
const MAX_PARTICIPANTS = 30;
const MAX_JUDGES = 5;
const MAX_MINUTES = 12 * 60; // los procesos con tiempo duran de 1 minuto a 12 horas
const MAX_AUDIO = 15 * 1024 * 1024;
// Supabase Storage (plan gratuito) admite archivos de hasta 50 MB
const MAX_VIDEO = (store.mode === 'supabase' ? Number(process.env.SUPABASE_MAX_FILE_MB) || 50 : 120) * 1024 * 1024;

/* ================================================================== */
/* Persistencia                                                        */
/* ================================================================== */

const rid = (n = 12) => crypto.randomBytes(n).toString('hex');

const DEFAULT_DESCRIPTION = 'Festival de la Voz Ministerial 2026, el escenario de gala donde la vocación de servicio y el arte convergen. En este encuentro único, nuestro personal militar y administrativo une su talento para cautivar al público con la fuerza y la excelencia de sus voces. Vive un espectáculo inolvidable que celebra el canto, la pasión y el orgullo de nuestra institución.';

function defaultDb() {
  return {
    settings: {
      title: 'Festival de la Voz Ministerial del MPPD',
      edition: 'Primera Edición',
      year: '2026',
      tagline: 'Un escenario donde el personal militar y administrativo une su talento para demostrar sus capacidades de canto.',
      description: DEFAULT_DESCRIPTION,
      video: null,            // video corto de la página de inicio
      showPhotos: true,       // mostrar las fotos de los participantes al público
      likesEnabled: true,
      commentsEnabled: false, // solo el administrador activa los comentarios
      commentsPremod: false,  // si está activo, los comentarios esperan aprobación
      publicUrl: '',
      strictMode: false,
      screenKey: rid(6),
    },
    participants: [],         // {id, grado, nombre, apellidos, genero, cancion, descripcion, photo, audio, order, tribute, inEvaluation}
    voting: { status: 'idle', round: rid(6), startsAt: null, endsAt: null, openedOnce: false },
    votes: {}, adjust: {}, voters: {}, fingerprints: {},
    fans: {},                 // fanId -> {nombre, apellidos, t, banned}
    likes: {},                // participantId -> { fanId: t }
    comments: [],             // {id, pid, fanId, nombre, text, t, status}
    judges: [],               // {id, nombre, usuario, clave, t}
    jury: { status: 'idle', round: rid(6), startsAt: null, endsAt: null },
    scores: {},               // judgeId -> participantId -> {c:[5], t}
    tieVotes: {},             // clave del empate -> {candidates, original, votes, round, needsAdmin}
    decisions: { F: {}, M: {} }, // desempates resueltos: genero -> puesto -> {id, candidates, by, t}
    approvals: {},            // judgeId -> {ok, note, sig, t}
    audit: [],
    screen: { mode: 'espera', showCounts: true, revealAt: 0, awardStep: 3 },
    sessions: {},             // token -> {role, judgeId?, exp}
  };
}

let db = defaultDb(); // se reemplaza al arrancar con los datos guardados (ver start())

function hydrate(raw) {
  if (!raw) return defaultDb();
  const d = Object.assign(defaultDb(), raw);
  d.settings = Object.assign(defaultDb().settings, raw.settings);
  d.screen = Object.assign(defaultDb().screen, raw.screen);
  d.jury = Object.assign(defaultDb().jury, raw.jury);
  d.decisions = Object.assign({ F: {}, M: {} }, raw.decisions);
  // migración de versiones anteriores
  for (const [t, v] of Object.entries(d.sessions || {})) if (typeof v === 'number') d.sessions[t] = { role: 'admin', exp: v };
  d.participants.forEach((p) => {
    p.genero = p.genero || ''; p.cancion = p.cancion || ''; p.descripcion = p.descripcion || '';
    p.audio = p.audio || null; p.tribute = !!p.tribute; p.inEvaluation = !!p.inEvaluation;
  });
  return d;
}

/**
 * Reconecta fotos, audios y video que existen en el disco pero que el estado no
 * conoce (por ejemplo, tras restaurar un respaldo, que no incluye los archivos).
 * Los nombres de archivo contienen el id del participante.
 */
function relinkMedia() {
  const out = { photos: 0, audios: 0, video: 0, lostPhotos: 0, lostAudios: 0, lostVideo: 0 };
  if (store.mode !== 'local') return out;
  let files = [];
  try { files = fs.readdirSync(UPLOAD_DIR).filter((f) => !f.endsWith('.part')); } catch { return out; }
  const missing = (url) => !url || (url.startsWith('/uploads/') && !fs.existsSync(path.join(UPLOAD_DIR, path.basename(url))));
  const newest = (re) => files.filter((f) => re.test(f)).map((f) => ({ f, t: fs.statSync(path.join(UPLOAD_DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.f;
  const dead = (url) => !!url && missing(url); // enlace a un archivo que ya no existe
  for (const p of db.participants) {
    if (!/^[a-f0-9]+$/.test(p.id)) continue;
    if (missing(p.photo)) {
      const f = newest(new RegExp(`^(?:foto-)?${p.id}-[a-f0-9]+\\.(?:jpe?g|png|webp)$`, 'i'));
      if (f) { p.photo = '/uploads/' + f; out.photos++; } else if (dead(p.photo)) { p.photo = null; out.lostPhotos++; }
    }
    if (missing(p.audio)) {
      const f = newest(new RegExp(`^voz-${p.id}-[a-f0-9]+\\.(?:mp3|m4a|aac|wav|ogg|webm)$`, 'i'));
      if (f) { p.audio = '/uploads/' + f; out.audios++; } else if (dead(p.audio)) { p.audio = null; out.lostAudios++; }
    }
  }
  if (missing(db.settings.video)) {
    const f = newest(/^video-[a-f0-9]+\.(?:mp4|webm|mov)$/i);
    if (f) { db.settings.video = '/uploads/' + f; out.video++; } else if (dead(db.settings.video)) { db.settings.video = null; out.lostVideo = 1; }
  }
  return out;
}

// Guardado con límite de frecuencia (local cada 300 ms; Supabase como máximo 1 vez por segundo)
const save = () => store.save(db);
const saveNow = () => store.saveNow(db);

function log(type, actor, msg) {
  db.audit.push({ t: Date.now(), type, actor, msg });
  if (db.audit.length > 3000) db.audit.splice(0, db.audit.length - 3000);
  save();
  io && io.to('admin').emit('audit', db.audit[db.audit.length - 1]);
}

/* ================================================================== */
/* Vistas de datos                                                     */
/* ================================================================== */

const sortedParticipants = () => [...db.participants].sort((a, b) => a.order - b.order).map((p, i) => ({ ...p, number: i + 1 }));
const fullName = (p) => `${p.nombre} ${p.apellidos}`.trim();
const likeCount = (pid) => Object.keys(db.likes[pid] || {}).length;
const commentCount = (pid) => db.comments.reduce((n, c) => n + (c.pid === pid && c.status === 'visible' ? 1 : 0), 0);

function publicParticipants() {
  const show = db.settings.showPhotos;
  return sortedParticipants().map((p) => ({
    id: p.id, number: p.number, grado: p.grado, nombre: p.nombre, apellidos: p.apellidos,
    genero: p.genero, cancion: p.cancion, descripcion: p.descripcion,
    photo: show ? p.photo : null, audio: p.audio, tribute: p.tribute,
    likes: likeCount(p.id), comments: commentCount(p.id),
  }));
}

function votingPublic() {
  const v = db.voting, open = v.status === 'open';
  return { status: v.status, round: v.round, endsAt: open ? v.endsAt : null, startsAt: open ? v.startsAt : null, unlimited: open && !v.endsAt };
}

function publicState() {
  const s = db.settings;
  return {
    title: s.title, edition: s.edition, year: s.year, tagline: s.tagline, description: s.description,
    video: s.video, showPhotos: s.showPhotos, likesEnabled: s.likesEnabled, commentsEnabled: s.commentsEnabled,
    now: Date.now(),
    voting: votingPublic(),
    participants: publicParticipants(),
  };
}

/* --- Voz de la Audiencia --- */
function results() {
  const list = sortedParticipants().filter((p) => !p.tribute).map((p) => {
    const real = db.votes[p.id] || 0, adj = db.adjust[p.id] || 0;
    return { id: p.id, number: p.number, grado: p.grado, nombre: p.nombre, apellidos: p.apellidos, genero: p.genero, photo: p.photo, real, adjust: adj, votes: Math.max(0, real + adj) };
  });
  const total = list.reduce((s, r) => s + r.votes, 0);
  const totalReal = list.reduce((s, r) => s + r.real, 0);
  list.forEach((r) => (r.pct = total ? (r.votes / total) * 100 : 0));
  const ranking = [...list].sort((a, b) => b.votes - a.votes || a.number - b.number);
  return { now: Date.now(), total, totalReal, voters: Object.keys(db.voters).length, list, ranking };
}
function screenResults() {
  const r = results();
  const strip = ({ real, adjust, ...rest }) => rest;
  return { now: r.now, total: r.total, list: r.list.map(strip), ranking: r.ranking.map(strip) };
}

/* --- Jurado --- */
const evaluated = () => sortedParticipants().filter((p) => p.inEvaluation && !p.tribute);
const judgeIds = () => db.judges.map((j) => j.id);
const tieKey = (g, pend) => `${g}:${pend.position}:${J.candSig(pend.candidates)}`;
const partCard = (p) => p && ({ id: p.id, number: p.number, grado: p.grado, nombre: p.nombre, apellidos: p.apellidos, genero: p.genero, cancion: p.cancion, photo: p.photo });

function juryResults() {
  const parts = evaluated();
  const byId = Object.fromEntries(parts.map((p) => [p.id, p]));
  const jids = judgeIds();
  const totals = J.computeTotals(parts, jids, db.scores);
  const complete = J.scoringComplete(parts, jids, db.scores);
  const deliberation = db.jury.status !== 'idle' && jids.length > 0 && parts.length > 0 && (complete || db.jury.status === 'closed');
  const categories = {};
  const ties = [];
  const winners = {};
  for (const g of J.GENDERS) {
    const st = J.standings(totals.filter((t) => t.genero === g), db.decisions[g] || {});
    categories[g] = st.ranking.map((t) => ({ ...t, ...partCard(byId[t.id]) }));
    winners[g] = st.placements.map((pl) => ({ position: pl.position, tiebreak: !!pl.tiebreak, ...partCard(byId[pl.id]), total: totals.find((t) => t.id === pl.id).total, pct: totals.find((t) => t.id === pl.id).pct }));
    if (st.pending && deliberation) {
      const key = tieKey(g, st.pending);
      const rec = db.tieVotes[key] || { candidates: st.pending.candidates, original: st.pending.candidates, votes: {}, round: 1, needsAdmin: false };
      ties.push({ key, genero: g, position: st.pending.position, candidates: rec.candidates.map((id) => partCard(byId[id])), original: rec.original, votes: rec.votes, round: rec.round, needsAdmin: rec.needsAdmin, total: totals.find((t) => t.id === st.pending.candidates[0]).total });
    }
  }
  const ungendered = parts.filter((p) => !J.GENDERS.includes(p.genero)).map(partCard);
  const allResolved = deliberation && ties.length === 0;
  const sig = J.winnersSignature(winners);
  const approvedBy = jids.filter((j) => db.approvals[j] && db.approvals[j].ok && db.approvals[j].sig === sig);
  const objections = jids.filter((j) => db.approvals[j] && !db.approvals[j].ok && db.approvals[j].sig === sig)
    .map((j) => ({ judgeId: j, nombre: (db.judges.find((x) => x.id === j) || {}).nombre, note: db.approvals[j].note }));
  const staleApprovals = jids.some((j) => db.approvals[j] && db.approvals[j].ok && db.approvals[j].sig !== sig);
  return {
    totals: totals.map((t) => ({ ...t, ...partCard(byId[t.id]) })),
    complete, deliberation, categories, ties, winners, ungendered, allResolved, sig,
    approvedBy, objections, staleApprovals,
    allApproved: allResolved && jids.length > 0 && approvedBy.length === jids.length,
    progress: db.judges.map((j) => ({ id: j.id, nombre: j.nombre, saved: parts.filter((p) => db.scores[j.id] && db.scores[j.id][p.id]).length, total: parts.length })),
  };
}

function juryPublicStatus() {
  const j = db.jury;
  return { status: j.status, round: j.round, startsAt: j.startsAt, endsAt: j.status === 'open' ? j.endsAt : null, unlimited: j.status === 'open' && !j.endsAt };
}

function juryStateFor(judgeId) {
  const judge = db.judges.find((x) => x.id === judgeId);
  if (!judge) return null;
  const parts = evaluated();
  const mine = db.scores[judgeId] || {};
  const done = parts.length > 0 && parts.every((p) => mine[p.id]);
  const R = juryResults();
  const canSeeResults = done || db.jury.status === 'closed';
  return {
    now: Date.now(),
    title: db.settings.title, year: db.settings.year,
    me: { id: judge.id, nombre: judge.nombre },
    jury: juryPublicStatus(),
    criteria: J.CRITERIA, maxPoints: J.MAX_POINTS, minPoints: J.MIN_POINTS,
    judgesCount: db.judges.length,
    participants: parts.map((p) => ({ ...partCard(p), descripcion: p.descripcion, audio: p.audio })),
    myScores: mine,
    done,
    progress: R.progress.map(({ nombre, saved, total }) => ({ nombre, saved, total })),
    results: canSeeResults ? {
      complete: R.complete,
      categories: Object.fromEntries(J.GENDERS.map((g) => [g, R.categories[g].map((t) => ({ id: t.id, number: t.number, grado: t.grado, nombre: t.nombre, apellidos: t.apellidos, photo: t.photo, total: t.total, pct: t.pct, count: t.count }))])),
    } : null,
    deliberation: R.deliberation ? {
      ties: R.ties.map((t) => ({ key: t.key, genero: t.genero, position: t.position, candidates: t.candidates, round: t.round, needsAdmin: t.needsAdmin, myVote: t.votes[judgeId] || null, received: Object.keys(t.votes).length })),
      winners: R.winners,
      allResolved: R.allResolved,
      sig: R.sig,
      myApproval: db.approvals[judgeId] && db.approvals[judgeId].sig === R.sig ? db.approvals[judgeId] : null,
      approvedCount: R.approvedBy.length,
      allApproved: R.allApproved,
    } : null,
  };
}

// La pantalla de gala no recibe marcas de desempate: solo puesto, participante y porcentaje.
function awardsForScreen() {
  const R = juryResults();
  const clean = (list) => list.map(({ tiebreak, total, ...w }) => w);
  return { step: db.screen.awardStep, winners: { F: clean(R.winners.F), M: clean(R.winners.M) }, allApproved: R.allApproved };
}

/* --- Comunidad --- */
const publicComment = (c) => ({ id: c.id, pid: c.pid, nombre: c.nombre, text: c.text, t: c.t, status: c.status });

/* --- Estados completos --- */
function adminState() {
  return {
    ...publicState(),
    participantsFull: sortedParticipants(),
    votingFull: db.voting,
    settings: db.settings,
    screen: db.screen,
    results: results(),
    audit: db.audit.slice(-80).reverse(),
    maxParticipants: MAX_PARTICIPANTS,
    maxJudges: MAX_JUDGES,
    lanUrls: lanUrls(),
    storage: { ...store.status(), ephemeral: IS_PROD && store.mode === 'local' && !process.env.DATA_DIR },
    jury: juryAdminState(),
    community: communityAdminState(),
  };
}
function juryAdminState() {
  return { status: db.jury, judges: db.judges, scores: db.scores, decisions: db.decisions, approvals: db.approvals, criteria: J.CRITERIA, results: juryResults() };
}
function communityAdminState() {
  return {
    comments: db.comments.slice(-400).reverse().map((c) => ({ ...publicComment(c), fanId: c.fanId, apellidos: (db.fans[c.fanId] || {}).apellidos || '', banned: !!(db.fans[c.fanId] || {}).banned })),
    fans: Object.keys(db.fans).length,
    likes: Object.values(db.likes).reduce((n, o) => n + Object.keys(o).length, 0),
    pending: db.comments.filter((c) => c.status === 'pending').length,
  };
}
function screenState() {
  const ps = publicState();
  return {
    ...ps,
    participants: sortedParticipants().map((p) => ({ id: p.id, number: p.number, grado: p.grado, nombre: p.nombre, apellidos: p.apellidos, genero: p.genero, cancion: p.cancion, descripcion: p.descripcion, photo: p.photo, tribute: p.tribute })),
    voting: { ...ps.voting, startsAt: db.voting.startsAt, scheduledEndsAt: db.voting.endsAt },
    screen: db.screen,
    publicUrl: db.settings.publicUrl,
    results: screenResults(),
    awards: db.screen.mode === 'premiacion' ? awardsForScreen() : null,
  };
}

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${PORT}/`);
  }
  return out;
}

/* ================================================================== */
/* Servidor HTTP                                                       */
/* ================================================================== */

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(compression());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (/^\/(admin|jurado|api\/admin|api\/jury)/.test(req.path)) res.setHeader('X-Frame-Options', 'DENY');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.use(express.json({ limit: '8mb' }));
app.get('/healthz', (req, res) => {
  const st = store.status();
  res.status(st.failures >= 5 ? 503 : 200).json({ ok: st.failures < 5, storage: st.mode, voting: db.voting.status, jury: db.jury.status });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false }, maxHttpBufferSize: 1e6 });

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}
const cookieAttrs = (req, maxAge) => `Path=/; Max-Age=${maxAge}; SameSite=Lax; HttpOnly${req.secure ? '; Secure' : ''}`;
const clean = (s, n = 80) => String(s ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const cleanText = (s, n = 1200) => String(s ?? '').replace(/[<>]/g, '').replace(/\r/g, '').trim().slice(0, n);

/* --- sesiones (administrador y jurados) --- */
const TOKEN_TTL = 1000 * 60 * 60 * 18;
function session(t) {
  if (typeof t !== 'string' || !Object.prototype.hasOwnProperty.call(db.sessions, t)) return null;
  const s = db.sessions[t];
  if (!s || s.exp < Date.now()) { delete db.sessions[t]; save(); return null; }
  return s;
}
const isAdminToken = (t) => { const s = session(t); return !!s && s.role === 'admin'; };
function judgeFromToken(t) {
  const s = session(t);
  if (!s || s.role !== 'judge') return null;
  return db.judges.find((j) => j.id === s.judgeId) || null;
}
function newSession(data) {
  for (const [k, v] of Object.entries(db.sessions)) if (!v || v.exp < Date.now()) delete db.sessions[k];
  const token = rid(24);
  db.sessions[token] = { ...data, exp: Date.now() + TOKEN_TTL };
  save();
  return token;
}
function requireAdmin(req, res, next) {
  if (!isAdminToken(req.get('x-admin-token'))) return res.status(401).json({ error: 'No autorizado' });
  next();
}
function requireJudge(req, res, next) {
  const j = judgeFromToken(req.get('x-jury-token'));
  if (!j) return res.status(401).json({ error: 'Sesión de jurado inválida' });
  req.judge = j; next();
}
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
const loginAttempts = new Map();
function loginGuard(req, res) {
  const key = req.ip;
  const a = loginAttempts.get(key) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 10 * 60 * 1000) { a.n = 0; a.t = Date.now(); }
  loginAttempts.set(key, a);
  if (a.n >= 15) { res.status(429).json({ error: 'Demasiados intentos. Espere unos minutos.' }); return null; }
  return a;
}
const failLogin = (res, a, msg) => { a.n++; setTimeout(() => res.status(401).json({ error: msg }), 600); };

app.post('/api/admin/login', (req, res) => {
  const a = loginGuard(req, res); if (!a) return;
  if (!safeEqual(req.body?.password || '', ADMIN_PASSWORD)) return failLogin(res, a, 'Contraseña incorrecta');
  loginAttempts.delete(req.ip);
  res.json({ token: newSession({ role: 'admin' }) });
});

app.post('/api/jury/login', (req, res) => {
  const a = loginGuard(req, res); if (!a) return;
  const usuario = String(req.body?.usuario || '').trim().toLowerCase();
  const clave = String(req.body?.clave || '').trim().toUpperCase();
  const j = db.judges.find((x) => x.usuario === usuario);
  if (!j || !safeEqual(clave, j.clave)) return failLogin(res, a, 'Usuario o clave incorrectos');
  loginAttempts.delete(req.ip);
  log('jurado', j.nombre, 'Ingresó a la sala de evaluación.');
  res.json({ token: newSession({ role: 'judge', judgeId: j.id }), nombre: j.nombre });
});

/* --- archivos estáticos --- */
app.use('/fonts/cinzel', express.static(path.join(__dirname, 'node_modules/@fontsource/cinzel'), { maxAge: '30d' }));
app.use('/fonts/montserrat', express.static(path.join(__dirname, 'node_modules/@fontsource/montserrat'), { maxAge: '30d' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' })); // admite Range (audio/video)
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));
app.get('/pantalla', (req, res) => res.sendFile(path.join(__dirname, 'public/pantalla.html')));
app.get('/jurado', (req, res) => res.sendFile(path.join(__dirname, 'public/jurado.html')));
// Páginas, scripts y estilos se revalidan en cada visita (así una instalación nueva se ve de inmediato
// y no queda un script viejo en el navegador); las imágenes se guardan un día.
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders: (res, file) => res.setHeader('Cache-Control', /\.(?:html|js|css)$/i.test(file) ? 'no-cache' : 'public, max-age=86400'),
}));

/* ================================================================== */
/* API pública: estado y Voz de la Audiencia                           */
/* ================================================================== */

app.get('/api/state', (req, res) => res.json(publicState()));

const voterIdFrom = (req) => parseCookies(req)['fv_voter'];

app.get('/api/me', (req, res) => {
  const id = voterIdFrom(req);
  const v = id && db.voters[`${db.voting.round}:${id}`];
  res.json({ voted: !!v, participantId: v ? v.p : null, round: db.voting.round });
});

const voteRate = new Map();
app.post('/api/vote', (req, res) => {
  if (db.voting.status !== 'open' || (db.voting.endsAt && Date.now() > db.voting.endsAt)) {
    return res.status(409).json({ error: 'La votación no está abierta en este momento.' });
  }
  // límite alto a propósito: el público en el mismo Wi-Fi comparte una IP
  const now = Date.now();
  const arr = (voteRate.get(req.ip) || []).filter((t) => now - t < 60000);
  if (arr.length >= 1500) return res.status(429).json({ error: 'Demasiadas solicitudes. Intente de nuevo.' });
  arr.push(now); voteRate.set(req.ip, arr);

  const { participantId, fp, localId } = req.body || {};
  const p = db.participants.find((x) => x.id === participantId);
  if (!p || p.tribute) return res.status(400).json({ error: 'Participante no válido.' });

  const validId = (x) => typeof x === 'string' && /^[a-f0-9]{32}$/.test(x);
  let voterId = voterIdFrom(req);
  if (!validId(voterId)) voterId = validId(localId) ? localId : rid(16);
  const key = `${db.voting.round}:${voterId}`;
  if (db.voters[key]) return res.status(409).json({ error: 'Ya registraste tu voto. ¡Gracias!', participantId: db.voters[key].p });
  if (validId(localId) && db.voters[`${db.voting.round}:${localId}`]) {
    return res.status(409).json({ error: 'Ya registraste tu voto. ¡Gracias!', participantId: db.voters[`${db.voting.round}:${localId}`].p });
  }
  let fpKey = null;
  if (db.settings.strictMode && typeof fp === 'string' && fp.length >= 8 && fp.length <= 128) {
    fpKey = `${db.voting.round}:${crypto.createHash('sha256').update(fp + '|' + req.ip).digest('hex').slice(0, 32)}`;
    if (db.fingerprints[fpKey]) return res.status(409).json({ error: 'Este dispositivo ya registró un voto. ¡Gracias!' });
  }
  db.voters[key] = { p: participantId, t: now };
  if (fpKey) db.fingerprints[fpKey] = voterId;
  db.votes[participantId] = (db.votes[participantId] || 0) + 1;
  save();
  res.setHeader('Set-Cookie', `fv_voter=${voterId}; ${cookieAttrs(req, 60 * 60 * 24 * 365)}`);
  res.json({ ok: true, participantId, voterId });
  scheduleResults();
});

async function qrUrl(req) {
  return String(req.query.u || db.settings.publicUrl || `${req.protocol}://${req.get('host')}/`).slice(0, 500);
}
app.get('/api/qr.svg', async (req, res) => {
  const dark = /^#[0-9a-f]{6}$/i.test(req.query.dark || '') ? req.query.dark : '#0b1a33';
  const light = /^#[0-9a-f]{6}$/i.test(req.query.light || '') ? req.query.light : '#ffffff';
  try {
    const svg = await QRCode.toString(await qrUrl(req), { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark, light } });
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  } catch { res.status(400).send('QR inválido'); }
});
app.get('/api/qr.png', async (req, res) => {
  try {
    const buf = await QRCode.toBuffer(await qrUrl(req), { width: 1200, margin: 2, errorCorrectionLevel: 'H', color: { dark: '#0b1a33', light: '#ffffff' } });
    res.type('image/png').set('Content-Disposition', 'attachment; filename="qr-votacion-festival.png"').send(buf);
  } catch { res.status(400).send('QR inválido'); }
});

app.get('/api/screen', (req, res) => {
  if (req.query.k !== db.settings.screenKey && !isAdminToken(req.get('x-admin-token'))) return res.status(401).json({ error: 'Clave de pantalla inválida' });
  res.json(screenState());
});

/* ================================================================== */
/* Comunidad: registro, me gusta y comentarios                         */
/* ================================================================== */

const fanFrom = (req) => { const id = parseCookies(req)['fv_fan']; return id && db.fans[id] ? { id, ...db.fans[id] } : null; };
const NAME_RE = /^[\p{L}][\p{L} .'-]{1,39}$/u;

app.get('/api/fan/me', (req, res) => {
  const f = fanFrom(req);
  if (!f) return res.json({ fan: null, liked: [] });
  const liked = Object.keys(db.likes).filter((pid) => db.likes[pid][f.id]);
  res.json({ fan: { nombre: f.nombre, apellidos: f.apellidos, banned: !!f.banned }, liked });
});

app.post('/api/fan', (req, res) => {
  const nombre = clean(req.body?.nombre, 40), apellidos = clean(req.body?.apellidos, 40);
  if (!NAME_RE.test(nombre) || !NAME_RE.test(apellidos)) return res.status(400).json({ error: 'Escribe tu nombre y apellido reales (solo letras).' });
  if (esOfensivo(`${nombre} ${apellidos}`)) return res.status(422).json({ error: 'El nombre contiene palabras no permitidas.' });
  let f = fanFrom(req);
  const id = f ? f.id : rid(16);
  db.fans[id] = { ...(db.fans[id] || {}), nombre, apellidos, t: Date.now() };
  save();
  res.setHeader('Set-Cookie', `fv_fan=${id}; ${cookieAttrs(req, 60 * 60 * 24 * 365)}`);
  res.json({ fan: { nombre, apellidos } });
  scheduleCommunity();
});

app.post('/api/fan/logout', (req, res) => {
  res.setHeader('Set-Cookie', `fv_fan=; ${cookieAttrs(req, 0)}`);
  res.json({ ok: true });
});

const fanRate = new Map(); // fanId -> {likes:[t], comment: t}
app.post('/api/like', (req, res) => {
  if (!db.settings.likesEnabled) return res.status(409).json({ error: 'Los “me gusta” están desactivados.' });
  const f = fanFrom(req);
  if (!f) return res.status(401).json({ error: 'Regístrate con tu nombre y apellido para dar “me gusta”.', register: true });
  if (f.banned) return res.status(403).json({ error: 'Tu cuenta fue bloqueada por el administrador.' });
  const pid = req.body?.participantId;
  if (!db.participants.some((p) => p.id === pid)) return res.status(400).json({ error: 'Participante no válido.' });
  const r = fanRate.get(f.id) || { likes: [], comment: 0 };
  r.likes = r.likes.filter((t) => Date.now() - t < 60000);
  if (r.likes.length >= 60) return res.status(429).json({ error: 'Espera un momento.' });
  r.likes.push(Date.now()); fanRate.set(f.id, r);
  db.likes[pid] = db.likes[pid] || {};
  let liked;
  if (db.likes[pid][f.id]) { delete db.likes[pid][f.id]; liked = false; } else { db.likes[pid][f.id] = Date.now(); liked = true; }
  save();
  res.json({ liked, count: likeCount(pid) });
  scheduleLikes();
});

app.get('/api/comments/:pid', (req, res) => {
  const f = fanFrom(req);
  const list = db.comments.filter((c) => c.pid === req.params.pid && (c.status === 'visible' || (f && c.fanId === f.id))).slice(-150);
  res.json({ comments: list.map(publicComment), enabled: db.settings.commentsEnabled });
});

app.post('/api/comments', (req, res) => {
  if (!db.settings.commentsEnabled) return res.status(409).json({ error: 'Los comentarios están desactivados en este momento.' });
  const f = fanFrom(req);
  if (!f) return res.status(401).json({ error: 'Regístrate con tu nombre y apellido para comentar.', register: true });
  if (f.banned) return res.status(403).json({ error: 'Tu cuenta fue bloqueada por el administrador.' });
  const pid = req.body?.participantId;
  if (!db.participants.some((p) => p.id === pid)) return res.status(400).json({ error: 'Participante no válido.' });
  const text = clean(req.body?.text, 280);
  if (text.length < 2) return res.status(400).json({ error: 'Escribe un comentario.' });
  if (esOfensivo(text)) {
    log('comentario', `${f.nombre} ${f.apellidos}`, `Comentario bloqueado automáticamente por lenguaje ofensivo.`);
    return res.status(422).json({ error: 'Tu comentario contiene lenguaje no permitido. Por favor, sé respetuoso.' });
  }
  if (tieneEnlace(text)) return res.status(422).json({ error: 'No se permiten enlaces, correos ni teléfonos en los comentarios.' });
  const r = fanRate.get(f.id) || { likes: [], comment: 0 };
  if (Date.now() - r.comment < 15000) return res.status(429).json({ error: 'Espera unos segundos antes de comentar de nuevo.' });
  if (db.comments.some((c) => c.fanId === f.id && c.pid === pid && c.text === text)) return res.status(409).json({ error: 'Ya publicaste ese comentario.' });
  r.comment = Date.now(); fanRate.set(f.id, r);
  const c = { id: rid(8), pid, fanId: f.id, nombre: `${f.nombre} ${f.apellidos}`, text, t: Date.now(), status: db.settings.commentsPremod ? 'pending' : 'visible' };
  db.comments.push(c);
  if (db.comments.length > 5000) db.comments.splice(0, db.comments.length - 5000);
  save();
  res.json({ comment: publicComment(c), pending: c.status === 'pending' });
  if (c.status === 'visible') { io.emit('comment', publicComment(c)); scheduleLikes(); }
  scheduleCommunity();
});

/* ================================================================== */
/* Sala del jurado                                                     */
/* ================================================================== */

const jury = express.Router();
jury.use(requireJudge);

jury.get('/state', (req, res) => res.json(juryStateFor(req.judge.id)));

jury.post('/score', (req, res) => {
  if (db.jury.status !== 'open' || (db.jury.endsAt && Date.now() > db.jury.endsAt)) return res.status(409).json({ error: 'La sala de evaluación no está abierta.' });
  const { participantId } = req.body || {};
  const c = Array.isArray(req.body?.c) ? req.body.c.map(Number) : null;
  const p = evaluated().find((x) => x.id === participantId);
  if (!p) return res.status(400).json({ error: 'Este participante no está en evaluación.' });
  if (!J.validScores(c)) return res.status(400).json({ error: `Califique los ${J.CRITERIA.length} aspectos entre ${J.MIN_POINTS} y ${J.MAX_POINTS} puntos.` });
  db.scores[req.judge.id] = db.scores[req.judge.id] || {};
  if (db.scores[req.judge.id][p.id]) return res.status(409).json({ error: 'Esta evaluación ya fue guardada y no puede cambiarse.' });
  db.scores[req.judge.id][p.id] = { c, t: Date.now() };
  log('puntuacion', req.judge.nombre, `Guardó la evaluación de ${fullName(p)}: ${c.join(' + ')} = ${c.reduce((a, b) => a + b, 0)} pts.`);
  saveNow();
  res.json({ ok: true });
  broadcastJury();
});

jury.post('/tie', (req, res) => {
  const { key, participantId } = req.body || {};
  const R = juryResults();
  const tie = R.ties.find((t) => t.key === key);
  if (!R.deliberation || !tie) return res.status(409).json({ error: 'Este desempate ya no está activo.' });
  if (tie.needsAdmin) return res.status(409).json({ error: 'El administrador resolverá este empate.' });
  if (!tie.candidates.some((c) => c.id === participantId)) return res.status(400).json({ error: 'Seleccione uno de los participantes empatados.' });
  const rec = db.tieVotes[key] || (db.tieVotes[key] = { candidates: tie.candidates.map((c) => c.id), original: tie.original, votes: {}, round: 1, needsAdmin: false });
  rec.votes[req.judge.id] = participantId;
  const p = db.participants.find((x) => x.id === participantId);
  log('desempate', req.judge.nombre, `Votó en el desempate del ${tie.position}.º lugar (${J.GENDER_NAME[tie.genero]}, ronda ${rec.round}) por ${fullName(p)}.`);
  const tally = J.tallyTie(rec, judgeIds());
  if (tally.status === 'resolved') {
    db.decisions[tie.genero][tie.position] = { id: tally.winner, candidates: rec.original, by: 'jurado', t: Date.now() };
    const w = db.participants.find((x) => x.id === tally.winner);
    log('desempate', 'Sistema', `Desempate resuelto por el jurado: ${fullName(w)} ocupa el ${tie.position}.º lugar (${J.GENDER_NAME[tie.genero]}).`);
  } else if (tally.status === 'runoff') {
    rec.candidates = tally.candidates; rec.votes = {}; rec.round++;
    log('desempate', 'Sistema', `El desempate del ${tie.position}.º lugar (${J.GENDER_NAME[tie.genero]}) sigue empatado: nueva ronda entre ${tally.candidates.length} participantes.`);
  } else if (tally.status === 'admin') {
    rec.needsAdmin = true;
    log('desempate', 'Sistema', `El jurado no logró desempatar el ${tie.position}.º lugar (${J.GENDER_NAME[tie.genero]}). Decide el administrador.`);
  }
  saveNow();
  res.json({ ok: true, status: tally.status });
  broadcastJury();
});

jury.post('/approve', (req, res) => {
  const R = juryResults();
  if (!R.allResolved) return res.status(409).json({ error: 'Los ganadores aún no están definidos.' });
  const ok = req.body?.ok !== false;
  const note = cleanText(req.body?.note, 400);
  if (!ok && note.length < 3) return res.status(400).json({ error: 'Indique el motivo de su observación.' });
  db.approvals[req.judge.id] = { ok, note, sig: R.sig, t: Date.now() };
  log('aprobacion', req.judge.nombre, ok ? 'Aprobó a los ganadores propuestos.' : `Presentó una observación: «${note}»`);
  saveNow();
  res.json({ ok: true });
  broadcastJury();
});

app.use('/api/jury', jury);

/* ================================================================== */
/* Administración                                                      */
/* ================================================================== */

const admin = express.Router();
admin.use(requireAdmin);

admin.get('/state', (req, res) => res.json(adminState()));
admin.get('/audit', (req, res) => res.json({ audit: [...db.audit].reverse() }));
admin.post('/logout', (req, res) => { delete db.sessions[req.get('x-admin-token')]; save(); res.json({ ok: true }); });

/* --- archivos subidos --- */
async function savePhoto(dataUrl, id) {
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 6 * 1024 * 1024) throw new Error('La foto es demasiado grande.');
  const ext = m[1] === 'jpeg' || m[1] === 'jpg' ? 'jpg' : m[1];
  return store.putFile(`foto-${id}-${rid(4)}.${ext}`, buf);
}
const removeFile = (url) => store.removeFile(url);
const AUDIO_TYPES = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'webm' };
const VIDEO_TYPES = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
/** Recibe un archivo grande por streaming (sin cargarlo en memoria). */
function receiveFile(req, types, maxBytes, prefix) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = types[type];
    if (!ext) return reject(Object.assign(new Error('Formato de archivo no admitido.'), { status: 415 }));
    if (Number(req.headers['content-length']) > maxBytes) return reject(Object.assign(new Error(`El archivo supera ${Math.round(maxBytes / 1048576)} MB.`), { status: 413 }));
    const name = `${prefix}-${rid(5)}.${ext}`;
    const tmp = path.join(UPLOAD_DIR, name + '.part');
    const out = fs.createWriteStream(tmp);
    let bytes = 0, failed = false;
    const fail = (e) => { if (failed) return; failed = true; out.destroy(); fs.rm(tmp, () => {}); reject(e); };
    req.on('data', (chunk) => { bytes += chunk.length; if (bytes > maxBytes) { fail(Object.assign(new Error(`El archivo supera ${Math.round(maxBytes / 1048576)} MB.`), { status: 413 })); req.destroy(); } });
    req.on('aborted', () => fail(new Error('Carga interrumpida.')));
    req.pipe(out);
    out.on('finish', () => {
      if (failed) return;
      if (!bytes) return fail(Object.assign(new Error('Archivo vacío.'), { status: 400 }));
      store.putFile(name, tmp, type).then(resolve, (e) => { fs.rm(tmp, () => {}); reject(e); });
    });
    out.on('error', fail);
  });
}

/* --- participantes --- */
function participantFields(body, p) {
  const f = {};
  if (body.grado !== undefined) f.grado = clean(body.grado);
  if (body.nombre !== undefined && clean(body.nombre)) f.nombre = clean(body.nombre);
  if (body.apellidos !== undefined && clean(body.apellidos)) f.apellidos = clean(body.apellidos);
  if (body.genero !== undefined) f.genero = ['F', 'M'].includes(body.genero) ? body.genero : '';
  if (body.cancion !== undefined) f.cancion = clean(body.cancion, 120);
  if (body.descripcion !== undefined) f.descripcion = cleanText(body.descripcion, 600);
  if (body.tribute !== undefined) f.tribute = !!body.tribute;
  if (body.inEvaluation !== undefined) f.inEvaluation = !!body.inEvaluation;
  const merged = { ...(p || {}), ...f };
  if (merged.tribute) f.inEvaluation = false; // el homenaje póstumo no se evalúa
  return f;
}

admin.post('/participants', async (req, res) => {
  if (db.participants.length >= MAX_PARTICIPANTS) return res.status(400).json({ error: `Máximo ${MAX_PARTICIPANTS} participantes.` });
  const b = req.body || {};
  if (!clean(b.nombre) || !clean(b.apellidos)) return res.status(400).json({ error: 'Nombre y apellidos son obligatorios.' });
  const id = rid(6);
  let photo = null;
  try { photo = b.photo ? await savePhoto(b.photo, id) : null; } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  const order = db.participants.reduce((m, p) => Math.max(m, p.order), 0) + 1;
  const p = { id, grado: '', nombre: '', apellidos: '', genero: '', cancion: '', descripcion: '', photo, audio: null, order, tribute: false, inEvaluation: false, ...participantFields(b) };
  db.participants.push(p);
  log('participante', 'Administrador', `Agregó a ${fullName(p)}${p.tribute ? ' (homenaje póstumo)' : ''}.`);
  save(); broadcastAll();
  res.json({ ok: true, id });
});

admin.put('/participants/:id', async (req, res) => {
  const p = db.participants.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'No existe' });
  const b = req.body || {};
  const before = { inEvaluation: p.inEvaluation, tribute: p.tribute };
  let newPhoto = null;
  try { if (b.photo) newPhoto = await savePhoto(b.photo, p.id); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  Object.assign(p, participantFields(b, p));
  if (newPhoto) { removeFile(p.photo); p.photo = newPhoto; }
  else if (b.removePhoto) { removeFile(p.photo); p.photo = null; }
  const changes = [];
  if (before.inEvaluation !== p.inEvaluation) changes.push(p.inEvaluation ? 'enviado a la sala de evaluación' : 'retirado de la sala de evaluación');
  if (before.tribute !== p.tribute) changes.push(p.tribute ? 'marcado como homenaje póstumo' : 'ya no es homenaje póstumo');
  log('participante', 'Administrador', `Editó a ${fullName(p)}${changes.length ? ` (${changes.join(', ')})` : ''}.`);
  save(); broadcastAll();
  res.json({ ok: true });
});

admin.post('/participants/evaluation', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : db.participants.map((p) => p.id);
  const on = !!req.body?.inEvaluation;
  let n = 0;
  db.participants.forEach((p) => { if (ids.includes(p.id) && !p.tribute && p.inEvaluation !== on) { p.inEvaluation = on; n++; } });
  log('participante', 'Administrador', on ? `Envió ${n} participante(s) a la sala de evaluación.` : `Retiró ${n} participante(s) de la sala de evaluación.`);
  save(); broadcastAll();
  res.json({ ok: true, changed: n });
});

admin.put('/participants/:id/audio', async (req, res) => {
  const p = db.participants.find((x) => x.id === req.params.id);
  if (!p) { req.resume(); return res.status(404).json({ error: 'No existe' }); }
  try {
    const url = await receiveFile(req, AUDIO_TYPES, MAX_AUDIO, `voz-${p.id}`);
    removeFile(p.audio); p.audio = url;
    log('participante', 'Administrador', `Cargó el audio de ${fullName(p)}.`);
    save(); broadcastAll();
    res.json({ ok: true, audio: url });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
admin.delete('/participants/:id/audio', (req, res) => {
  const p = db.participants.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'No existe' });
  removeFile(p.audio); p.audio = null;
  log('participante', 'Administrador', `Quitó el audio de ${fullName(p)}.`);
  save(); broadcastAll();
  res.json({ ok: true });
});

admin.delete('/participants/:id', (req, res) => {
  const i = db.participants.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'No existe' });
  const [p] = db.participants.splice(i, 1);
  removeFile(p.photo); removeFile(p.audio);
  delete db.votes[p.id]; delete db.adjust[p.id]; delete db.likes[p.id];
  db.comments = db.comments.filter((c) => c.pid !== p.id);
  for (const j of Object.keys(db.scores)) delete db.scores[j][p.id];
  log('participante', 'Administrador', `Eliminó a ${fullName(p)}.`);
  save(); broadcastAll();
  res.json({ ok: true });
});

/* --- carga masiva: varios participantes (con foto) en un solo archivo --- */
admin.post('/participants/import', async (req, res) => {
  const list = Array.isArray(req.body?.participants) ? req.body.participants : null;
  if (!list || !list.length) return res.status(400).json({ error: 'El archivo no contiene participantes.' });
  if (list.length > MAX_PARTICIPANTS) return res.status(400).json({ error: `El archivo tiene más de ${MAX_PARTICIPANTS} participantes.` });
  const created = [], skipped = [], errors = [];
  const same = (p, n, a) => `${p.nombre} ${p.apellidos}`.toLowerCase() === `${n} ${a}`.toLowerCase();
  for (const b of list) {
    const nombre = clean(b?.nombre), apellidos = clean(b?.apellidos);
    if (!nombre || !apellidos) { errors.push('Una fila no tiene nombre o apellidos.'); continue; }
    if (db.participants.some((p) => same(p, nombre, apellidos))) { skipped.push(`${nombre} ${apellidos}`); continue; } // ya cargado: no se duplica
    if (db.participants.length >= MAX_PARTICIPANTS) { errors.push(`${nombre} ${apellidos}: se alcanzó el máximo de ${MAX_PARTICIPANTS}.`); continue; }
    const id = rid(6);
    let photo = null;
    try { photo = b.photo ? await savePhoto(b.photo, id) : null; } catch (e) { errors.push(`${nombre} ${apellidos}: ${e.message}`); continue; }
    const order = db.participants.reduce((m, p) => Math.max(m, p.order), 0) + 1;
    db.participants.push({ id, grado: '', nombre: '', apellidos: '', genero: '', cancion: '', descripcion: '', photo, audio: null, order, tribute: false, inEvaluation: false, ...participantFields(b) });
    created.push(`${nombre} ${apellidos}`);
  }
  log('participante', 'Administrador', `Carga masiva: ${created.length} participantes agregados${skipped.length ? `, ${skipped.length} ya existían` : ''}${errors.length ? `, ${errors.length} con error` : ''}.`);
  save(); broadcastAll();
  res.json({ ok: true, created: created.length, names: created, skipped, errors });
});
admin.post('/participants/reorder', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  ids.forEach((id, i) => { const p = db.participants.find((x) => x.id === id); if (p) p.order = i + 1; });
  save(); broadcastAll();
  res.json({ ok: true });
});

/* --- tiempos (Voz de la Audiencia y Jurado) --- */
function parseWindow(body) {
  const now = Date.now();
  if (body.unlimited) return { startsAt: now, endsAt: null };
  if (body.startsAt && body.endsAt) {
    const s = Number(body.startsAt), e = Number(body.endsAt);
    if (!(e > s) || e <= now) throw new Error('Las fechas de inicio y cierre no son válidas.');
    if (e - s > MAX_MINUTES * 60000) throw new Error('La duración máxima es de 12 horas.');
    return { startsAt: s, endsAt: e };
  }
  const m = Number(body.minutes);
  if (!(m >= 1 && m <= MAX_MINUTES)) throw new Error('La duración debe estar entre 1 minuto y 12 horas.');
  return { startsAt: now, endsAt: now + m * 60000 };
}
const fmtWindow = (w) => (w.endsAt ? `${Math.round((w.endsAt - w.startsAt) / 60000)} min` : 'sin límite de tiempo');

admin.post('/voting/start', (req, res) => {
  if (!db.participants.some((p) => !p.tribute)) return res.status(400).json({ error: 'Agregue participantes antes de abrir la votación.' });
  let w; try { w = parseWindow(req.body || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
  Object.assign(db.voting, w);
  db.voting.status = w.startsAt <= Date.now() ? 'open' : 'scheduled';
  if (db.voting.status === 'open') db.voting.openedOnce = true;
  log('audiencia', 'Administrador', db.voting.status === 'open' ? `Abrió la votación de la Voz de la Audiencia (${fmtWindow(w)}).` : `Programó la votación de la Voz de la Audiencia (${fmtWindow(w)}).`);
  saveNow(); broadcastAll();
  res.json({ ok: true });
});
admin.post('/voting/extend', (req, res) => {
  const m = Number(req.body?.minutes);
  if (!(m >= 1 && m <= MAX_MINUTES)) return res.status(400).json({ error: 'Minutos inválidos.' });
  const v = db.voting;
  if ((v.status === 'open' || v.status === 'scheduled') && v.endsAt) v.endsAt += m * 60000;
  else if (v.status === 'closed') { v.status = 'open'; v.startsAt = Date.now(); v.endsAt = Date.now() + m * 60000; }
  else if (v.status !== 'open') return res.status(400).json({ error: 'La votación no ha iniciado.' });
  log('audiencia', 'Administrador', `Extendió/reabrió la votación del público ${m} min.`);
  saveNow(); broadcastAll();
  res.json({ ok: true });
});
admin.post('/voting/stop', (req, res) => {
  const v = db.voting;
  if (v.status === 'open' || v.status === 'scheduled') {
    v.status = v.status === 'open' ? 'closed' : 'idle';
    v.endsAt = v.status === 'closed' ? Date.now() : null;
    log('audiencia', 'Administrador', 'Cerró la votación de la Voz de la Audiencia.');
    saveNow(); broadcastAll();
  }
  res.json({ ok: true });
});
admin.post('/voting/reset', (req, res) => {
  db.voting = { status: 'idle', round: rid(6), startsAt: null, endsAt: null, openedOnce: false };
  db.votes = {}; db.adjust = {}; db.voters = {}; db.fingerprints = {};
  log('audiencia', 'Administrador', 'Reinició todos los votos del público (nueva ronda).');
  if (['vivo', 'ganador', 'podio'].includes(db.screen.mode)) db.screen.mode = 'espera';
  saveNow(); broadcastAll();
  res.json({ ok: true });
});

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
  log('audiencia', 'Administrador', `Ajuste manual: ${fullName(p)} ${before} → ${after} votos.`);
  save(); scheduleResults();
  res.json({ ok: true });
});
admin.post('/adjust/clear', (req, res) => {
  db.adjust = {};
  log('audiencia', 'Administrador', 'Eliminó todos los ajustes manuales de la Voz de la Audiencia.');
  save(); scheduleResults();
  res.json({ ok: true });
});

/* --- jurados --- */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
function freeUser() { for (let i = 1; i <= 99; i++) if (!db.judges.some((j) => j.usuario === `jurado${i}`)) return `jurado${i}`; return `jurado${rid(2)}`; }
function killJudgeSessions(id) { for (const [k, v] of Object.entries(db.sessions)) if (v && v.role === 'judge' && v.judgeId === id) delete db.sessions[k]; }

admin.post('/judges', (req, res) => {
  if (db.judges.length >= MAX_JUDGES) return res.status(400).json({ error: `El jurado está completo (${MAX_JUDGES} miembros).` });
  const nombre = clean(req.body?.nombre, 80);
  if (nombre.length < 3) return res.status(400).json({ error: 'Escriba el nombre del jurado.' });
  const j = { id: rid(6), nombre, usuario: freeUser(), clave: newCode(), t: Date.now() };
  db.judges.push(j);
  log('jurado', 'Administrador', `Registró al jurado ${nombre} (usuario ${j.usuario}).`);
  saveNow(); broadcastAll(); broadcastJury();
  res.json({ ok: true, judge: j });
});
admin.put('/judges/:id', (req, res) => {
  const j = db.judges.find((x) => x.id === req.params.id);
  if (!j) return res.status(404).json({ error: 'No existe' });
  if (req.body?.nombre !== undefined && clean(req.body.nombre, 80).length >= 3) j.nombre = clean(req.body.nombre, 80);
  if (req.body?.regenerate) { j.clave = newCode(); killJudgeSessions(j.id); log('jurado', 'Administrador', `Generó una nueva clave para ${j.nombre}.`); }
  saveNow(); broadcastAll(); broadcastJury();
  res.json({ ok: true, judge: j });
});
admin.delete('/judges/:id', (req, res) => {
  const i = db.judges.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'No existe' });
  const [j] = db.judges.splice(i, 1);
  killJudgeSessions(j.id);
  delete db.scores[j.id]; delete db.approvals[j.id];
  for (const t of Object.values(db.tieVotes)) delete t.votes[j.id];
  log('jurado', 'Administrador', `Eliminó al jurado ${j.nombre} y sus evaluaciones.`);
  io.to('judge:' + j.id).emit('jury-logout');
  saveNow(); broadcastAll(); broadcastJury();
  res.json({ ok: true });
});

/* --- proceso de evaluación del jurado --- */
admin.post('/jury/start', (req, res) => {
  if (!db.judges.length) return res.status(400).json({ error: 'Registre al menos un jurado.' });
  if (!evaluated().length) return res.status(400).json({ error: 'Envíe participantes a la sala de evaluación.' });
  let w; try { w = parseWindow(req.body || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
  Object.assign(db.jury, w, { status: 'open' });
  log('jurado', 'Administrador', `Abrió la sala de evaluación del jurado (${fmtWindow(w)}).`);
  saveNow(); broadcastAll(); broadcastJury();
  res.json({ ok: true });
});
admin.post('/jury/extend', (req, res) => {
  const m = Number(req.body?.minutes);
  if (!(m >= 1 && m <= MAX_MINUTES)) return res.status(400).json({ error: 'Minutos inválidos.' });
  const jj = db.jury;
  if (jj.status === 'open' && jj.endsAt) jj.endsAt += m * 60000;
  else if (jj.status === 'closed') { jj.status = 'open'; jj.startsAt = Date.now(); jj.endsAt = Date.now() + m * 60000; }
  else if (jj.status !== 'open') return res.status(400).json({ error: 'La evaluación no ha iniciado.' });
  log('jurado', 'Administrador', `Extendió/reabrió la sala de evaluación ${m} min.`);
  saveNow(); broadcastAll(); broadcastJury();
  res.json({ ok: true });
});
admin.post('/jury/stop', (req, res) => {
  if (db.jury.status === 'open') {
    db.jury.status = 'closed'; db.jury.endsAt = Date.now();
    log('jurado', 'Administrador', 'Cerró la sala de evaluación (ya no se reciben puntuaciones).');
    saveNow(); broadcastAll(); broadcastJury();
  }
  res.json({ ok: true });
});
admin.post('/jury/reset', (req, res) => {
  db.jury = { status: 'idle', round: rid(6), startsAt: null, endsAt: null };
  db.scores = {}; db.tieVotes = {}; db.decisions = { F: {}, M: {} }; db.approvals = {};
  if (db.screen.mode === 'premiacion') db.screen.mode = 'espera';
  log('jurado', 'Administrador', 'Reinició por completo la evaluación del jurado (puntuaciones, desempates y aprobaciones).');
  saveNow(); broadcastAll(); broadcastJury();
  res.json({ ok: true });
});
admin.put('/jury/scores', (req, res) => {
  const { judgeId, participantId } = req.body || {};
  const c = Array.isArray(req.body?.c) ? req.body.c.map(Number) : null;
  const j = db.judges.find((x) => x.id === judgeId), p = db.participants.find((x) => x.id === participantId);
  if (!j || !p) return res.status(404).json({ error: 'No existe' });
  if (!J.validScores(c)) return res.status(400).json({ error: `Cada aspecto debe estar entre ${J.MIN_POINTS} y ${J.MAX_POINTS}.` });
  db.scores[j.id] = db.scores[j.id] || {};
  const prev = db.scores[j.id][p.id];
  db.scores[j.id][p.id] = { c, t: Date.now(), editedByAdmin: true };
  log('alteracion', 'Administrador', `Modificó la evaluación de ${j.nombre} a ${fullName(p)}: ${prev ? prev.c.join('+') + ' = ' + prev.c.reduce((a, b) => a + b, 0) : 'sin puntuación'} → ${c.join('+')} = ${c.reduce((a, b) => a + b, 0)}.`);
  saveNow(); broadcastAll(); broadcastJury();
  res.json({ ok: true });
});
admin.delete('/jury/scores', (req, res) => {
  const { judgeId, participantId } = req.body || {};
  const j = db.judges.find((x) => x.id === judgeId), p = db.participants.find((x) => x.id === participantId);
  if (!j || !p || !db.scores[j.id] || !db.scores[j.id][p.id]) return res.status(404).json({ error: 'No existe' });
  delete db.scores[j.id][p.id];
  log('alteracion', 'Administrador', `Desbloqueó la evaluación de ${j.nombre} a ${fullName(p)} para que la califique de nuevo.`);
  saveNow(); broadcastAll(); broadcastJury();
  res.json({ ok: true });
});
admin.post('/jury/decide', (req, res) => {
  const { key, participantId } = req.body || {};
  const R = juryResults();
  const tie = R.ties.find((t) => t.key === key);
  if (!tie) return res.status(409).json({ error: 'Este empate ya no está activo.' });
  if (!tie.original.includes(participantId)) return res.status(400).json({ error: 'Seleccione uno de los participantes empatados.' });
  db.decisions[tie.genero][tie.position] = { id: participantId, candidates: tie.original, by: 'admin', t: Date.now() };
  const p = db.participants.find((x) => x.id === participantId);
  log('alteracion', 'Administrador', `Decidió el desempate: ${fullName(p)} ocupa el ${tie.position}.º lugar (${J.GENDER_NAME[tie.genero]}).`);
  saveNow(); broadcastAll(); broadcastJury();
  res.json({ ok: true });
});
admin.post('/jury/decisions/clear', (req, res) => {
  db.decisions = { F: {}, M: {} }; db.tieVotes = {};
  log('alteracion', 'Administrador', 'Anuló todos los desempates (los jurados deberán votarlos de nuevo).');
  saveNow(); broadcastAll(); broadcastJury();
  res.json({ ok: true });
});
admin.post('/jury/approvals/reset', (req, res) => {
  db.approvals = {};
  log('aprobacion', 'Administrador', 'Solicitó una nueva aprobación de los ganadores a todos los jurados.');
  saveNow(); broadcastAll(); broadcastJury();
  res.json({ ok: true });
});
admin.get('/jury/export.csv', (req, res) => {
  const R = juryResults();
  const crit = J.CRITERIA.map((c) => c.name);
  const rows = [['Categoría', 'Puesto', 'N°', 'Grado', 'Nombre', 'Apellidos', 'Jurado', ...crit, 'Total jurado']];
  for (const g of J.GENDERS) {
    R.categories[g].forEach((t) => {
      const w = R.winners[g].find((x) => x.id === t.id);
      for (const jd of db.judges) {
        const s = db.scores[jd.id] && db.scores[jd.id][t.id];
        rows.push([J.GENDER_NAME[g], w ? w.position : '', t.number, t.grado, t.nombre, t.apellidos, jd.nombre, ...(s ? s.c : crit.map(() => '')), s ? s.c.reduce((a, b) => a + b, 0) : '']);
      }
      rows.push([J.GENDER_NAME[g], w ? w.position : '', t.number, t.grado, t.nombre, t.apellidos, 'TOTAL', ...t.criteria, t.total, `${t.pct.toFixed(2)}%`]);
    });
  }
  const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  res.type('text/csv').set('Content-Disposition', 'attachment; filename="evaluacion-jurado-festival-2026.csv"').send(csv);
});

/* --- comunidad --- */
admin.post('/comments/:id/approve', (req, res) => {
  const c = db.comments.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'No existe' });
  c.status = 'visible';
  save(); io.emit('comment', publicComment(c)); scheduleLikes(); scheduleCommunity();
  res.json({ ok: true });
});
admin.delete('/comments/:id', (req, res) => {
  const i = db.comments.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'No existe' });
  const [c] = db.comments.splice(i, 1);
  log('comentario', 'Administrador', `Eliminó un comentario de ${c.nombre}: «${c.text.slice(0, 80)}»`);
  save(); io.emit('comment-removed', { id: c.id, pid: c.pid }); scheduleLikes(); scheduleCommunity();
  res.json({ ok: true });
});
admin.post('/fans/:id/ban', (req, res) => {
  const f = db.fans[req.params.id];
  if (!f) return res.status(404).json({ error: 'No existe' });
  f.banned = req.body?.banned !== false;
  if (f.banned) {
    const removed = db.comments.filter((c) => c.fanId === req.params.id);
    db.comments = db.comments.filter((c) => c.fanId !== req.params.id);
    removed.forEach((c) => io.emit('comment-removed', { id: c.id, pid: c.pid }));
  }
  log('comentario', 'Administrador', `${f.banned ? 'Bloqueó' : 'Desbloqueó'} al usuario ${f.nombre} ${f.apellidos}.`);
  save(); scheduleLikes(); scheduleCommunity();
  res.json({ ok: true });
});

/* --- pantalla de gala --- */
const SCREEN_MODES = ['espera', 'participantes', 'vivo', 'ganador', 'podio', 'homenaje', 'premiacion', 'video'];
admin.post('/screen', (req, res) => {
  const { mode, showCounts, awardStep } = req.body || {};
  if (mode && SCREEN_MODES.includes(mode)) {
    db.screen.mode = mode;
    if (['ganador', 'podio', 'premiacion', 'homenaje'].includes(mode)) db.screen.revealAt = Date.now();
  }
  if ([0, 1, 2, 3].includes(awardStep)) { db.screen.awardStep = awardStep; db.screen.revealAt = Date.now(); }
  if (typeof showCounts === 'boolean') db.screen.showCounts = showCounts;
  if (mode === 'premiacion' || awardStep !== undefined) log('premiacion', 'Administrador', `Mostró en pantalla: ${['podio completo', '1.er lugar', '2.º lugar', '3.er lugar'][db.screen.awardStep]} (jurado).`);
  save(); broadcastAll();
  res.json({ ok: true });
});

/* --- página y configuración --- */
admin.post('/settings', (req, res) => {
  const b = req.body || {}, s = db.settings;
  if (b.title !== undefined) s.title = clean(b.title, 120) || s.title;
  if (b.edition !== undefined) s.edition = clean(b.edition, 60);
  if (b.year !== undefined) s.year = clean(b.year, 10);
  if (b.tagline !== undefined) s.tagline = cleanText(b.tagline, 300);
  if (b.description !== undefined) s.description = cleanText(b.description, 1500);
  if (b.publicUrl !== undefined) {
    const u = clean(b.publicUrl, 300);
    if (u && !/^https?:\/\//i.test(u)) return res.status(400).json({ error: 'La URL debe iniciar con http:// o https://' });
    s.publicUrl = u;
  }
  for (const k of ['strictMode', 'showPhotos', 'likesEnabled', 'commentsEnabled', 'commentsPremod']) {
    if (typeof b[k] === 'boolean' && s[k] !== b[k]) {
      s[k] = b[k];
      const names = { strictMode: 'modo estricto', showPhotos: 'fotos visibles al público', likesEnabled: '“me gusta”', commentsEnabled: 'comentarios', commentsPremod: 'moderación previa de comentarios' };
      log('configuracion', 'Administrador', `${b[k] ? 'Activó' : 'Desactivó'}: ${names[k]}.`);
    }
  }
  if (b.regenScreenKey) s.screenKey = rid(6);
  save(); broadcastAll();
  res.json({ ok: true });
});
admin.put('/media/video', async (req, res) => {
  try {
    const url = await receiveFile(req, VIDEO_TYPES, MAX_VIDEO, 'video');
    removeFile(db.settings.video); db.settings.video = url;
    log('configuracion', 'Administrador', 'Cargó el video de la página de inicio.');
    save(); broadcastAll();
    res.json({ ok: true, video: url });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
admin.delete('/media/video', (req, res) => {
  removeFile(db.settings.video); db.settings.video = null;
  if (db.screen.mode === 'video') db.screen.mode = 'espera';
  log('configuracion', 'Administrador', 'Quitó el video de la página de inicio.');
  save(); broadcastAll();
  res.json({ ok: true });
});

admin.get('/backup.json', (req, res) => {
  const { sessions, ...rest } = db;
  res.set('Content-Disposition', `attachment; filename="respaldo-festival-${new Date().toISOString().slice(0, 10)}.json"`).json(rest);
});
/* --- restaurar un respaldo (el archivo descargado con «Descargar respaldo») --- */
admin.post('/restore', (req, res) => {
  const raw = req.body;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.participants) || !raw.settings || typeof raw.settings !== 'object' || !raw.voting || typeof raw.voting !== 'object') {
    return res.status(400).json({ error: 'El archivo no parece un respaldo del festival.' });
  }
  saveNow(); store.snapshot('antes-de-restaurar'); // lo que había queda guardado en la carpeta backups
  const keepSessions = db.sessions, keepKey = db.settings.screenKey;
  const restored = hydrate(raw);
  restored.sessions = keepSessions;             // la sesión del administrador y de los jurados sigue activa
  restored.settings.screenKey = keepKey;        // las pantallas abiertas siguen funcionando
  db = restored;
  const re = relinkMedia();
  const counts = { participantes: db.participants.length, jurados: db.judges.length, comentarios: db.comments.length, likes: Object.values(db.likes || {}).reduce((n, o) => n + Object.keys(o).length, 0), puntuaciones: Object.values(db.scores || {}).reduce((n, o) => n + Object.keys(o).length, 0) };
  log('configuracion', 'Administrador', `Restauró un respaldo: ${counts.participantes} participantes, ${counts.jurados} jurados, ${counts.likes} me gusta, ${counts.comentarios} comentarios, ${counts.puntuaciones} puntuaciones.`);
  saveNow(); broadcastAll(); broadcastJury();
  res.json({ ok: true, ...counts, relinked: re, photosMissing: db.participants.filter((p) => !p.photo).length, audiosMissing: db.participants.filter((p) => !p.audio).length });
});
admin.post('/relink-media', (req, res) => {
  const re = relinkMedia();
  log('configuracion', 'Administrador', `Reconectó archivos del disco: ${re.photos} fotos, ${re.audios} audios${re.video ? ', 1 video' : ''}.`);
  save(); broadcastAll();
  res.json({ ok: true, ...re, storage: store.mode });
});
admin.get('/export.csv', (req, res) => {
  const r = results();
  const rows = [['Puesto', 'N°', 'Grado', 'Nombre', 'Apellidos', 'Categoría', 'Votos reales', 'Ajuste', 'Votos finales', 'Porcentaje', 'Me gusta']];
  r.ranking.forEach((x, i) => rows.push([i + 1, x.number, x.grado, x.nombre, x.apellidos, J.GENDER_NAME[x.genero] || '', x.real, x.adjust, x.votes, x.pct.toFixed(2) + '%', likeCount(x.id)]));
  const csv = '﻿' + rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  res.type('text/csv').set('Content-Disposition', 'attachment; filename="voz-de-la-audiencia-2026.csv"').send(csv);
});

app.use('/api/admin', admin);

/* ================================================================== */
/* Tiempo real                                                         */
/* ================================================================== */

io.on('connection', (socket) => {
  const { role, token, k } = socket.handshake.auth || {};
  if (role === 'admin' && isAdminToken(token)) {
    socket.join('admin');
    socket.emit('admin', adminState());
  } else if (role === 'judge') {
    const j = judgeFromToken(token);
    if (j) { socket.join('judges'); socket.join('judge:' + j.id); socket.emit('jury', juryStateFor(j.id)); }
    else socket.emit('jury-logout');
  } else if (role === 'screen' && (k === db.settings.screenKey || isAdminToken(token))) {
    socket.join('screen');
    socket.emit('screen', screenState());
  } else if (role === 'screen') {
    socket.emit('screen-denied');
  }
  socket.emit('state', publicState());
});

function throttle(fn, ms) {
  let t = null;
  return () => { if (t) return; t = setTimeout(() => { t = null; fn(); }, ms); };
}
const scheduleResults = throttle(() => {
  io.to('admin').emit('results', { results: results() });
  io.to('screen').emit('results', screenResults());
}, 250);
const scheduleLikes = throttle(() => {
  io.emit('likes', Object.fromEntries(db.participants.map((p) => [p.id, { l: likeCount(p.id), c: commentCount(p.id) }])));
}, 400);
const scheduleCommunity = throttle(() => io.to('admin').emit('community', communityAdminState()), 300);
const broadcastJury = throttle(() => {
  for (const j of db.judges) io.to('judge:' + j.id).emit('jury', juryStateFor(j.id));
  io.to('admin').emit('jury-admin', juryAdminState());
  if (db.screen.mode === 'premiacion') io.to('screen').emit('screen', screenState());
}, 200);

function broadcastAll() {
  io.emit('state', publicState());
  io.to('admin').emit('admin', adminState());
  io.to('screen').emit('screen', screenState());
}

// reloj: abre/cierra automáticamente según el horario
setInterval(() => {
  const v = db.voting, jj = db.jury, now = Date.now();
  if (v.status === 'scheduled' && v.startsAt && now >= v.startsAt) {
    v.status = 'open'; v.openedOnce = true; log('audiencia', 'Sistema', 'La votación del público se abrió según lo programado.'); saveNow(); broadcastAll();
  } else if (v.status === 'open' && v.endsAt && now >= v.endsAt) {
    v.status = 'closed'; log('audiencia', 'Sistema', 'La votación del público se cerró al terminar el tiempo.'); saveNow(); broadcastAll();
  }
  if (jj.status === 'open' && jj.endsAt && now >= jj.endsAt) {
    jj.status = 'closed'; log('jurado', 'Sistema', 'La sala de evaluación se cerró al terminar el tiempo.'); saveNow(); broadcastAll(); broadcastJury();
  }
}, 500);

setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of voteRate) if (!arr.length || now - arr[arr.length - 1] > 60000) voteRate.delete(ip);
  for (const [id, r] of fanRate) if (now - Math.max(r.comment, ...r.likes, 0) > 120000) fanRate.delete(id);
}, 5 * 60000).unref();

async function shutdown() {
  try { await store.flush(db); } finally { process.exit(0); }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function start() {
  try {
    db = hydrate(await store.load());
  } catch (e) {
    // nunca arrancar vacío si no se pudo leer la base de datos: se sobrescribirían los datos reales
    console.error(`\n  ✖ ${e.message}\n`);
    process.exit(1);
  }
  const re = relinkMedia();
  if (re.photos || re.audios || re.video) console.log(`  ↻ Se reconectaron archivos del disco: ${re.photos} fotos, ${re.audios} audios, ${re.video} video.`);
  saveNow();
  server.listen(PORT, '0.0.0.0', onListen);
}

function onListen() {
  console.log('\n  🎤  Festival de la Voz Ministerial del MPPD 2026');
  console.log('  ───────────────────────────────────────────────');
  console.log(`  Página pública   : http://localhost:${PORT}/`);
  console.log(`  Administrador    : http://localhost:${PORT}/admin   (contraseña: ${process.env.ADMIN_PASSWORD ? '••••••' : ADMIN_PASSWORD})`);
  console.log(`  Sala del jurado  : http://localhost:${PORT}/jurado`);
  console.log(`  Pantalla de gala : http://localhost:${PORT}/pantalla?k=${db.settings.screenKey}`);
  lanUrls().forEach((u) => console.log(`  En la red local  : ${u}`));
  console.log(`  Almacenamiento   : ${store.mode === 'supabase' ? 'Supabase (base de datos + Storage)' : 'local (' + DATA_DIR + ')'}`);
  if (IS_PROD && store.mode === 'local' && !process.env.DATA_DIR) console.log('  ⚠ DATA_DIR no está definida: los datos se guardan en una carpeta temporal y se BORRAN con cada instalación. Defina DATA_DIR=/var/data y agregue un disco en Render.');
  console.log('');
}

start();

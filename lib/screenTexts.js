/**
 * Mensajes de la pantalla de gala que el administrador puede editar.
 * Cada mensaje tiene una clave, un grupo, una descripción y su texto por defecto.
 * En los textos se puede usar {year} (año del festival) y {title} (nombre del festival).
 */
'use strict';

const HIDE = '{hide}'; // marca interna: el administrador ocultó este mensaje

const GROUPS = {
  espera: 'Pantalla QR / Espera',
  participantes: 'Participantes',
  vivo: 'Voz de la Audiencia en vivo',
  ganador: 'Revelación y podio de la Voz de la Audiencia',
  homenaje: 'Homenaje póstumo',
  premiacion: 'Premiación del jurado',
};

const DEFS = [
  // --- QR / Espera
  ['espera', 'espera_open', 'Titular con la votación abierta', '¡Vota por tu favorito!'],
  ['espera', 'espera_closed', 'Titular con la votación cerrada', '¡Gracias por votar!'],
  ['espera', 'espera_idle', 'Titular antes de abrir la votación', '{title}'],
  ['espera', 'qr_title', 'Título junto al código QR', 'Escanea y vota'],
  ['espera', 'qr_sub', 'Instrucción bajo el título del QR', 'Apunta la cámara de tu teléfono al código'],
  ['espera', 'badge_open', 'Etiqueta: votación abierta', 'VOTACIÓN ABIERTA'],
  ['espera', 'badge_closed', 'Etiqueta: votación cerrada', 'VOTACIÓN CERRADA'],
  ['espera', 'badge_idle', 'Etiqueta: antes de abrir', 'PRÓXIMAMENTE'],
  // --- Participantes
  ['participantes', 'parts_sub', 'Subtítulo de la galería', 'NUESTROS PARTICIPANTES'],
  // --- En vivo
  ['vivo', 'live_sub', 'Subtítulo de la pantalla en vivo', 'VOZ DE LA AUDIENCIA · EN VIVO'],
  ['vivo', 'live_badge', 'Etiqueta «en vivo»', 'EN VIVO'],
  ['vivo', 'badge_scheduled', 'Etiqueta: votación programada', 'PROGRAMADA'],
  ['vivo', 'badge_finished', 'Etiqueta: votación finalizada', 'FINALIZADA'],
  ['vivo', 'badge_wait', 'Etiqueta: en espera', 'EN ESPERA'],
  ['vivo', 'clock_left', 'Reloj: tiempo restante', 'TIEMPO RESTANTE'],
  ['vivo', 'clock_starts', 'Reloj: inicia en', 'INICIA EN'],
  ['vivo', 'clock_idle', 'Reloj: título cuando no hay votación', 'VOTACIÓN'],
  ['vivo', 'clock_closed', 'Reloj: votación cerrada', 'CERRADA'],
  ['vivo', 'leader_label', 'Tarjeta del líder', 'VA A LA CABEZA'],
  ['vivo', 'leader_tie', 'Tarjeta del líder: empate', 'EMPATE EN EL PRIMER LUGAR'],
  ['vivo', 'leader_waiting', 'Sin votos: etiqueta', 'ESPERANDO VOTOS'],
  ['vivo', 'leader_waiting_title', 'Sin votos: título', '¡Vota ahora!'],
  ['vivo', 'leader_waiting_sub', 'Sin votos: frase', 'Escanea el código QR'],
  ['vivo', 'stat_votes', 'Contador de votos', 'VOTOS'],
  ['vivo', 'stat_rate', 'Contador de votos por minuto', 'VOTOS / MIN'],
  ['vivo', 'mini_title', 'Recuadro del QR: título', '¡Vota ya!'],
  ['vivo', 'mini_sub', 'Recuadro del QR: texto', 'Escanea el código con tu teléfono y elige a tu favorito.'],
  ['vivo', 'unit_vote', 'Palabra: voto (singular)', 'voto'],
  ['vivo', 'unit_votes', 'Palabra: votos (plural)', 'votos'],
  ['vivo', 'board_empty', 'Sin participantes', 'Aún no hay participantes'],
  // --- Revelación y podio de la audiencia
  ['ganador', 'win_pre', 'Antes de revelar al ganador', 'La Voz de la Audiencia es…'],
  ['ganador', 'win_kick', 'Encabezado del ganador', '★ VOZ DE LA AUDIENCIA · {year} ★'],
  ['ganador', 'win_tie_kick', 'Encabezado en caso de empate', '🏆 ¡EMPATE EN EL PRIMER LUGAR! 🏆'],
  ['ganador', 'win_pct', 'Texto junto al porcentaje', 'de los votos'],
  ['ganador', 'win_none', 'Cuando no hay votos', 'SIN VOTOS REGISTRADOS'],
  ['ganador', 'podium_sub', 'Subtítulo del podio de la audiencia', 'PODIO · VOZ DE LA AUDIENCIA'],
  // --- Homenaje
  ['homenaje', 'trib_kick', 'Encabezado del homenaje', 'HOMENAJE PÓSTUMO'],
  ['homenaje', 'trib_ribbon', 'Cinta «In memoriam»', 'IN MEMORIAM'],
  ['homenaje', 'trib_default', 'Dedicatoria si el participante no tiene una', 'Su voz y su servicio permanecen en nuestra memoria. Este festival también le pertenece.'],
  // --- Premiación del jurado
  ['premiacion', 'aw_kick', 'Encabezado de la premiación', 'PREMIACIÓN DEL JURADO · {year}'],
  ['premiacion', 'aw_p3', 'Título del tercer lugar', 'Tercer Lugar'],
  ['premiacion', 'aw_p2', 'Título del segundo lugar', 'Segundo Lugar'],
  ['premiacion', 'aw_p1', 'Título del primer lugar', 'Primer Lugar'],
  ['premiacion', 'aw_final', 'Título del podio completo', 'Ganadores'],
  ['premiacion', 'aw_F', 'Nombre de la categoría femenina', 'VOZ FEMENINA'],
  ['premiacion', 'aw_M', 'Nombre de la categoría masculina', 'VOZ MASCULINA'],
  ['premiacion', 'aw_score', 'Texto junto al porcentaje del jurado', 'de la puntuación del jurado'],
  ['premiacion', 'aw_empty', 'Puesto sin ganador', 'Puesto desierto'],
].map(([group, key, label, def]) => ({ group, key, label, def }));

const BY_KEY = Object.fromEntries(DEFS.map((d) => [d.key, d]));
const MAX_LEN = 200;

const sanitize = (s) => String(s ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);

/** Aplica los cambios del administrador sobre los guardados. null = restaurar el texto original. */
function applyOverrides(current, changes) {
  const out = { ...(current || {}) };
  for (const [key, value] of Object.entries(changes || {})) {
    if (!BY_KEY[key]) continue;
    if (value === null || value === undefined) { delete out[key]; continue; }
    if (value === HIDE) { out[key] = HIDE; continue; }
    const v = sanitize(value);
    if (!v || v === BY_KEY[key].def) delete out[key]; else out[key] = v;
  }
  return out;
}

/** Mensajes finales (con valores por defecto, reemplazos {year} y {title} y ocultos vacíos). */
function resolveTexts(overrides, vars = {}) {
  const out = {};
  for (const d of DEFS) {
    const o = overrides && overrides[d.key];
    let t = o === HIDE ? '' : (typeof o === 'string' ? o : d.def);
    t = t.replace(/\{year\}/g, vars.year ?? '').replace(/\{title\}/g, vars.title ?? '');
    out[d.key] = t;
  }
  return out;
}

module.exports = { DEFS, GROUPS, HIDE, MAX_LEN, applyOverrides, resolveTexts };

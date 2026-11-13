/**
 * Lógica de evaluación del jurado (funciones puras, sin estado).
 *
 * - Cada jurado califica 5 aspectos de 1 a 20 puntos (máx. 100 por jurado).
 * - El total de un participante es la suma de los puntos de todos los jurados.
 * - Por categoría (Voz Femenina / Voz Masculina) se asignan 1.º, 2.º y 3.º lugar:
 *   un solo participante por puesto. Si un empate afecta un puesto del podio,
 *   los jurados eligen al ganador de ese puesto (desempate).
 */
'use strict';

const CRITERIA = [
  { key: 'afinacion', name: 'Afinación y tonalidad', desc: 'Precisión auditiva, control tonal y afinación constante.' },
  { key: 'ritmo', name: 'Cuadratura y ritmo', desc: 'Métrica, entrada a tiempo y sincronización con la orquesta o pista.' },
  { key: 'diccion', name: 'Dicción y fraseo', desc: 'Claridad en la pronunciación, articulación y legato interpretativo.' },
  { key: 'calidad', name: 'Calidad vocal y timbre', desc: 'Color, potencia, sostén de columna de aire y técnica vocal.' },
  { key: 'escena', name: 'Dominio escénico e interpretación', desc: 'Expresividad, vestuario, proyección y conexión con el público.' },
];
const MAX_POINTS = 20;
const MIN_POINTS = 1;
const PLACES = 3;
const GENDERS = ['F', 'M'];
const GENDER_NAME = { F: 'Voz Femenina', M: 'Voz Masculina' };

function validScores(c) {
  return Array.isArray(c) && c.length === CRITERIA.length &&
    c.every((n) => Number.isInteger(n) && n >= MIN_POINTS && n <= MAX_POINTS);
}
const sum = (a) => a.reduce((s, n) => s + n, 0);

/**
 * @param participants participantes evaluados [{id, genero, number}]
 * @param judgeIds     ids de los jurados
 * @param scores       { [judgeId]: { [participantId]: { c: [5 números] } } }
 */
function computeTotals(participants, judgeIds, scores) {
  const maxTotal = Math.max(1, judgeIds.length) * MAX_POINTS * CRITERIA.length;
  return participants.map((p) => {
    const perJudge = {};
    const criteria = CRITERIA.map(() => 0);
    let total = 0, count = 0;
    for (const j of judgeIds) {
      const s = scores[j] && scores[j][p.id];
      if (!s || !validScores(s.c)) continue;
      const t = sum(s.c);
      perJudge[j] = t; total += t; count++;
      s.c.forEach((n, i) => (criteria[i] += n));
    }
    return { id: p.id, genero: p.genero, number: p.number, total, count, perJudge, criteria, pct: (total / maxTotal) * 100 };
  });
}

/** ¿Todos los jurados calificaron a todos los participantes? */
function scoringComplete(participants, judgeIds, scores) {
  if (!judgeIds.length || !participants.length) return false;
  return judgeIds.every((j) => participants.every((p) => scores[j] && scores[j][p.id] && validScores(scores[j][p.id].c)));
}

const candSig = (ids) => [...ids].sort().join(',');

/**
 * Calcula el podio de una categoría.
 * @param totals     resultado de computeTotals filtrado por categoría
 * @param decisions  { [position]: { id, candidates: [ids] } } desempates ya resueltos
 * @returns { ranking, placements: [{position, id}], pending: null | {position, candidates} }
 */
function standings(totals, decisions = {}) {
  const ranking = [...totals].sort((a, b) => b.total - a.total || (a.number || 0) - (b.number || 0));
  const groups = [];
  for (const r of ranking) {
    const g = groups[groups.length - 1];
    if (g && g[0].total === r.total) g.push(r); else groups.push([r]);
  }
  const placements = [];
  let pos = 1;
  for (const group of groups) {
    if (pos > PLACES) break;
    let members = group.map((r) => r.id);
    const original = candSig(members);
    while (members.length && pos <= PLACES) {
      if (members.length === 1) { placements.push({ position: pos, id: members[0] }); pos++; members = []; break; }
      const d = decisions[pos];
      // la decisión solo vale si se tomó entre exactamente estos mismos candidatos
      if (d && members.includes(d.id) && candSig(d.candidates) === candSig(members)) {
        placements.push({ position: pos, id: d.id, tiebreak: true });
        members = members.filter((x) => x !== d.id);
        pos++;
        continue;
      }
      return { ranking, placements, pending: { position: pos, candidates: members, groupSig: original } };
    }
  }
  return { ranking, placements, pending: null };
}

/**
 * Cuenta los votos de desempate.
 * @param tie      { candidates: [ids], votes: { [judgeId]: participantId } }
 * @returns { status: 'waiting' | 'resolved' | 'runoff' | 'admin', winner?, candidates? }
 */
function tallyTie(tie, judgeIds) {
  const votes = judgeIds.map((j) => tie.votes && tie.votes[j]).filter((v) => tie.candidates.includes(v));
  if (votes.length < judgeIds.length) return { status: 'waiting', received: votes.length };
  const count = {};
  votes.forEach((v) => (count[v] = (count[v] || 0) + 1));
  const max = Math.max(...Object.values(count));
  const leaders = tie.candidates.filter((c) => count[c] === max);
  if (leaders.length === 1) return { status: 'resolved', winner: leaders[0], count };
  if (leaders.length < tie.candidates.length) return { status: 'runoff', candidates: leaders, count };
  return { status: 'admin', count }; // empate total en la votación: decide el administrador
}

/** Firma de los ganadores (para saber si cambiaron después de la aprobación). */
function winnersSignature(byGender) {
  return GENDERS.map((g) => `${g}:${(byGender[g] || []).map((p) => `${p.position}=${p.id}`).join('|')}`).join(';');
}

module.exports = { CRITERIA, MAX_POINTS, MIN_POINTS, PLACES, GENDERS, GENDER_NAME, validScores, computeTotals, scoringComplete, standings, tallyTie, winnersSignature, candSig };

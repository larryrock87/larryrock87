'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const J = require('../lib/jury');

const T = (id, total, number) => ({ id, total, number: number || 0 });

test('validScores exige 5 enteros entre 1 y 20', () => {
  assert.ok(J.validScores([20, 20, 20, 20, 20]));
  assert.ok(!J.validScores([20, 20, 20, 20]));
  assert.ok(!J.validScores([0, 20, 20, 20, 20]));
  assert.ok(!J.validScores([21, 20, 20, 20, 20]));
  assert.ok(!J.validScores([10.5, 20, 20, 20, 20]));
});

test('computeTotals suma jurados y calcula porcentaje sobre 5 jurados × 100', () => {
  const judges = ['j1', 'j2', 'j3', 'j4', 'j5'];
  const scores = {};
  judges.forEach((j) => (scores[j] = { a: { c: [20, 20, 20, 20, 20] }, b: { c: [10, 10, 10, 10, 10] } }));
  const [a, b] = J.computeTotals([{ id: 'a' }, { id: 'b' }], judges, scores);
  assert.equal(a.total, 500); assert.equal(a.pct, 100); assert.equal(a.count, 5);
  assert.equal(b.total, 250); assert.equal(b.pct, 50);
  assert.deepEqual(a.criteria, [100, 100, 100, 100, 100]);
  assert.ok(J.scoringComplete([{ id: 'a' }, { id: 'b' }], judges, scores));
  delete scores.j3.b;
  assert.ok(!J.scoringComplete([{ id: 'a' }, { id: 'b' }], judges, scores));
});

test('podio sin empates', () => {
  const r = J.standings([T('a', 400), T('b', 450), T('c', 300), T('d', 420)]);
  assert.equal(r.pending, null);
  assert.deepEqual(r.placements.map((p) => p.id), ['b', 'd', 'a']);
});

test('empate en el 1.er lugar requiere desempate y luego continúa', () => {
  const totals = [T('a', 450), T('b', 450), T('c', 400), T('d', 300)];
  let r = J.standings(totals);
  assert.deepEqual(r.pending, { position: 1, candidates: ['a', 'b'], groupSig: 'a,b' });
  assert.equal(r.placements.length, 0);
  r = J.standings(totals, { 1: { id: 'b', candidates: ['a', 'b'] } });
  assert.equal(r.pending, null);
  assert.deepEqual(r.placements.map((p) => [p.position, p.id]), [[1, 'b'], [2, 'a'], [3, 'c']]);
});

test('triple empate en el 3.er lugar: un solo ganador, sin más desempates', () => {
  const totals = [T('a', 480), T('b', 470), T('c', 400), T('d', 400), T('e', 400)];
  let r = J.standings(totals);
  assert.equal(r.pending.position, 3);
  assert.deepEqual(r.pending.candidates, ['c', 'd', 'e']);
  r = J.standings(totals, { 3: { id: 'd', candidates: ['c', 'd', 'e'] } });
  assert.equal(r.pending, null);
  assert.deepEqual(r.placements.map((p) => p.id), ['a', 'b', 'd']);
});

test('triple empate en el 2.º lugar necesita dos desempates', () => {
  const totals = [T('a', 480), T('b', 400), T('c', 400), T('d', 400)];
  let r = J.standings(totals, { 2: { id: 'c', candidates: ['b', 'c', 'd'] } });
  assert.deepEqual(r.pending, { position: 3, candidates: ['b', 'd'], groupSig: 'b,c,d' });
  r = J.standings(totals, { 2: { id: 'c', candidates: ['b', 'c', 'd'] }, 3: { id: 'd', candidates: ['b', 'd'] } });
  assert.deepEqual(r.placements.map((p) => p.id), ['a', 'c', 'd']);
});

test('una decisión vieja no se aplica si cambian los empatados', () => {
  const r = J.standings([T('a', 450), T('b', 450), T('c', 450)], { 1: { id: 'a', candidates: ['a', 'b'] } });
  assert.equal(r.pending.position, 1);
  assert.deepEqual(r.pending.candidates, ['a', 'b', 'c']);
});

test('empate fuera del podio no requiere desempate', () => {
  const r = J.standings([T('a', 500), T('b', 490), T('c', 480), T('d', 100), T('e', 100)]);
  assert.equal(r.pending, null);
  assert.equal(r.placements.length, 3);
});

test('categoría con menos de 3 participantes', () => {
  const r = J.standings([T('a', 300), T('b', 200)]);
  assert.deepEqual(r.placements.map((p) => p.position), [1, 2]);
});

test('votación de desempate: espera, gana mayoría, segunda vuelta y decisión del administrador', () => {
  const judges = ['1', '2', '3', '4', '5'];
  assert.equal(J.tallyTie({ candidates: ['a', 'b'], votes: { 1: 'a' } }, judges).status, 'waiting');
  const w = J.tallyTie({ candidates: ['a', 'b'], votes: { 1: 'a', 2: 'a', 3: 'b', 4: 'a', 5: 'b' } }, judges);
  assert.equal(w.status, 'resolved'); assert.equal(w.winner, 'a');
  const r = J.tallyTie({ candidates: ['a', 'b', 'c'], votes: { 1: 'a', 2: 'a', 3: 'b', 4: 'b', 5: 'c' } }, judges);
  assert.equal(r.status, 'runoff'); assert.deepEqual(r.candidates, ['a', 'b']);
  const adm = J.tallyTie({ candidates: ['a', 'b'], votes: { 1: 'a', 2: 'b', 3: 'a', 4: 'b' } }, ['1', '2', '3', '4']);
  assert.equal(adm.status, 'admin');
});

test('la firma de ganadores cambia si cambia un ganador', () => {
  const a = J.winnersSignature({ F: [{ position: 1, id: 'x' }], M: [{ position: 1, id: 'y' }] });
  const b = J.winnersSignature({ F: [{ position: 1, id: 'x' }], M: [{ position: 1, id: 'z' }] });
  assert.notEqual(a, b);
});

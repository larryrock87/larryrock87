'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFS, HIDE, applyOverrides, resolveTexts } = require('../lib/screenTexts');

test('todos los mensajes tienen clave única, grupo y texto por defecto', () => {
  const keys = DEFS.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const d of DEFS) { assert.ok(d.group && d.label && typeof d.def === 'string' && d.def.length, d.key); }
});

test('sin cambios se usan los textos por defecto, con {year} y {title} reemplazados', () => {
  const t = resolveTexts({}, { year: '2026', title: 'Festival X' });
  assert.equal(t.aw_p1, 'Primer Lugar');
  assert.equal(t.aw_kick, 'PREMIACIÓN DEL JURADO · 2026');
  assert.equal(t.espera_idle, 'Festival X');
});

test('el administrador puede editar, ocultar y restaurar un mensaje', () => {
  let o = applyOverrides({}, { aw_p1: '  ¡Gran Campeón!  ', aw_score: HIDE });
  let t = resolveTexts(o, { year: '2026', title: 'T' });
  assert.equal(t.aw_p1, '¡Gran Campeón!');
  assert.equal(t.aw_score, '');
  o = applyOverrides(o, { aw_p1: null, aw_score: 'del jurado' });
  t = resolveTexts(o, {});
  assert.equal(t.aw_p1, 'Primer Lugar');
  assert.equal(t.aw_score, 'del jurado');
});

test('un texto igual al original o vacío restaura el original; claves desconocidas y HTML se ignoran', () => {
  let o = applyOverrides({}, { aw_p2: 'Otro' });
  o = applyOverrides(o, { aw_p2: 'Segundo Lugar', inventada: 'x' });
  assert.deepEqual(o, {});
  o = applyOverrides({}, { aw_p3: '<b>Bronce</b>' });
  assert.equal(o.aw_p3, 'bBronce/b');
  o = applyOverrides(o, { aw_p3: '   ' });
  assert.deepEqual(o, {});
});

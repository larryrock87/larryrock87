'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { esOfensivo, tieneEnlace } = require('../lib/filtro');

test('detecta groserías y variantes', () => {
  for (const t of ['eres un idiota', 'IMBÉCIL', 'qué mierda', 'm i e r d a', 'puuuuta', 'p.u.t.a', '1d10ta', 'mamaguevo', 'Coño', 'MARICO', 'eres un gafo']) {
    assert.ok(esOfensivo(t), t);
  }
});

test('no bloquea comentarios normales', () => {
  for (const t of ['¡Qué voz tan hermosa! Bendiciones', 'Excelente interpretación, mi capitán', 'Me encantó la canción', 'Orgullo venezolano 🇻🇪', 'Computadora', 'Escultura', 'Disputa', 'Una voz increíble', 'Felicitaciones a la Sargento Peña', 'Arriba Carlos, eres el mejor']) {
    assert.ok(!esOfensivo(t), t);
  }
});

test('detecta enlaces y spam', () => {
  assert.ok(tieneEnlace('visita www.ejemplo.com'));
  assert.ok(tieneEnlace('https://x.y'));
  assert.ok(!tieneEnlace('Qué bonito cantó. Felicidades.'));
});

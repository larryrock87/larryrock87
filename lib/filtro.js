/**
 * Filtro de lenguaje ofensivo para comentarios y nombres (español / Venezuela).
 * Detecta variantes con acentos, mayúsculas, letras repetidas, números en lugar
 * de letras (p.ej. "1d10ta") y palabras separadas con espacios o símbolos.
 */
'use strict';

// raíces ofensivas (ya normalizadas: sin acentos, minúsculas, la ñ se conserva)
const PALABRAS = [
  'puta', 'puto', 'putas', 'putos', 'putica', 'putazo', 'hijueputa', 'hijoeputa', 'hijodeputa', 'hdp', 'hp',
  'mierda', 'mierdero', 'coño', 'coñazo', 'coñoemadre', 'coñoetumadre', 'coñuda',
  'marico', 'marica', 'maricon', 'maricona', 'mariquera', 'mariqueras',
  'mamaguevo', 'mamahuevo', 'mamaguebo', 'mamaweb', 'mamon', 'mamona',
  'guevon', 'huevon', 'webon', 'guebon', 'weon', 'guevo', 'webo', 'guebo',
  'pendejo', 'pendeja', 'pendejada', 'carajo', 'carajito', 'verga', 'vergacion', 'vergatario', 'careverga', 'caraeverga',
  'joder', 'jodido', 'jodida', 'joda', 'cabron', 'cabrona', 'culo', 'culero', 'culera', 'culio', 'culiao',
  'malparido', 'malparida', 'gonorrea', 'perra', 'zorra', 'zorron', 'cuero', 'cuera', 'ramera', 'prostituta',
  'idiota', 'imbecil', 'estupido', 'estupida', 'tarado', 'tarada', 'retrasado', 'retrasada', 'mongolico', 'mongolica',
  'subnormal', 'gafo', 'gafa', 'pajuo', 'pajua', 'bruto', 'bruta', 'burro', 'burra', 'basura', 'escoria',
  'asqueroso', 'asquerosa', 'maldito', 'maldita', 'desgraciado', 'desgraciada', 'cochino', 'cochina', 'mardito',
  'chupamedias', 'jalabolas', 'jalamecate', 'bolsa', 'bobo', 'boba', 'tonto', 'tonta', 'inutil', 'payaso', 'payasa',
  'mamaguevazo', 'pargo', 'cagada', 'cagar', 'cago', 'cagon', 'cagona', 'pene', 'vagina', 'teta', 'tetas', 'sexo', 'porno', 'follar', 'coger',
  'nazi', 'negro de mierda', 'muerete', 'matate', 'ojala te mueras',
];

// raíces que se buscan también dentro de otras palabras (largas e inequívocas)
const RAICES = ['mierd', 'coño', 'mamaguev', 'mamahuev', 'guevon', 'huevon', 'pendej', 'verga', 'malparid', 'hijueput', 'gonorrea', 'imbecil', 'idiota', 'estupid', 'culer', 'cabron', 'porno'];

function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .replace(/ñ/g, '\u0001')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\u0001/g, 'ñ')
    .replace(/[0@4]/g, (c) => ({ 0: 'o', '@': 'a', 4: 'a' }[c]))
    .replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/[5$]/g, 's').replace(/7/g, 't')
    .replace(/(.)\1{2,}/g, '$1') // "puuuuta" -> "puta"
    .replace(/(.)\1/g, (m, c) => (/[lrc]/.test(c) ? m : c)); // dobles letras, salvo ll, rr, cc
}

const palabraSet = new Set(PALABRAS.filter((p) => !p.includes(' ')));
const frases = PALABRAS.filter((p) => p.includes(' '));

/** Devuelve true si el texto contiene lenguaje ofensivo. */
function esOfensivo(texto) {
  const n = normalizar(texto);
  const palabras = n.split(/[^a-zñ]+/).filter(Boolean);
  if (palabras.some((w) => palabraSet.has(w) || palabraSet.has(w.replace(/s$/, '')))) return true;
  if (frases.some((f) => n.includes(f))) return true;
  // raíces inequívocas dentro de otras palabras ("mierdero", "pendejadas")
  if (palabras.some((w) => RAICES.some((r) => w.includes(r)))) return true;
  // letras sueltas separadas con espacios o puntos: "p u t a", "m.i.e.r.d.a"
  let run = '';
  for (const w of [...palabras, '']) {
    if (w.length === 1) { run += w; continue; }
    if (run.length >= 3 && (palabraSet.has(run) || RAICES.some((r) => run.includes(r)))) return true;
    run = '';
  }
  return false;
}

/** Enlaces, correos y teléfonos (evita spam en los comentarios). */
function tieneEnlace(texto) {
  return /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|ve|io|co|ly|me|info)\b|@[a-z0-9_]{3,}|\b\d{4}[\s-]?\d{7}\b)/i.test(String(texto || ''));
}

module.exports = { esOfensivo, tieneEnlace, normalizar };

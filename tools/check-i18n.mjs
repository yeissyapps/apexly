// ============================================================================
//  check-i18n — avisa de los textos sin traducir al inglés.
//
//  Busca en el código todas las llamadas t(...) y comprueba que su clave (el
//  texto en español) esté en src/i18n/en.js. Una clave que falta no rompe
//  nada — sale en español —, pero es justo el tipo de hueco que nadie ve
//  hasta que un jugador inglés se lo encuentra.
//
//    npm run check:i18n
//
//  Reconoce t('texto'), t("texto") y t(cond ? 'a' : 'b'). Lo que se traduce
//  desde una VARIABLE (t(pieza.label), t(clima.hint)...) no se puede ver
//  desde aquí: esas claves van en en.js debajo de la marca "DATOS", y para
//  ellas no se avisa de "ya no se usan".
//
//  También avisa de t(`...`) con plantilla, que no se puede comprobar: hay
//  que usar t('... {x} ...', { x }).
// ============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const files = ['App.js', ...readdirSync('src').filter((f) => f.endsWith('.js') && f !== 'i18n.js').map((f) => join('src', f))];

const enSrc = readFileSync('src/i18n/en.js', 'utf8');
const EN = (await import('data:text/javascript,' + encodeURIComponent(enSrc))).default;
const dataPart = enSrc.split('---- DATOS')[1] || '';
const dataKeys = new Set();
for (const m of dataPart.matchAll(/^\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*:/gm)) dataKeys.add(unq(m[1]));

function unq(s) {
  return s.slice(1, -1).replace(/\\n/g, '\n').replace(/\\(['"\\])/g, '$1');
}

// Argumento de t( ... ) hasta su paréntesis de cierre (contando anidados y
// saltando cadenas).
function argAt(code, start) {
  let depth = 1;
  let i = start;
  while (i < code.length && depth > 0) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < code.length && code[i] !== q) { if (code[i] === '\\') i++; i++; }
    } else if (c === '(') depth++;
    else if (c === ')') depth--;
    i++;
  }
  return code.slice(start, i - 1);
}

const used = new Map();
const bad = [];
for (const f of files) {
  const code = readFileSync(f, 'utf8');
  for (const m of code.matchAll(/(?<![\w.$])t\(/g)) {
    const arg = argAt(code, m.index + 2).trim();
    const line = code.slice(0, m.index).split('\n').length;
    if (arg.startsWith('`')) { bad.push(`${f}:${line}`); continue; }
    let keys = [];
    const first = arg.match(/^('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/);
    if (first) keys = [first[1]];
    else if (/\?/.test(arg.split(',{')[0].split(', {')[0])) {
      const cond = arg.split(/,\s*\{/)[0];
      keys = [...cond.matchAll(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g)].map((x) => x[1]);
    }
    for (const k of keys) {
      const key = unq(k);
      if (!used.has(key)) used.set(key, `${f}:${line}`);
    }
  }
}

const missing = [...used.keys()].filter((k) => !(k in EN));
const unused = Object.keys(EN).filter((k) => !used.has(k) && !dataKeys.has(k));

console.log(`\n${used.size} textos con t(), ${Object.keys(EN).length} traducciones en en.js\n`);
if (missing.length) {
  console.log(`SIN TRADUCIR (${missing.length}):`);
  for (const k of missing) console.log(`  ${used.get(k)}  ${JSON.stringify(k)}`);
}
if (bad.length) {
  console.log(`\nt() con plantilla \`...\` (usa t('... {x}', { x })):`);
  for (const b of bad) console.log('  ' + b);
}
if (unused.length) {
  console.log(`\nTraducciones que ya no usa el código (${unused.length}) — revisar o borrar:`);
  for (const k of unused) console.log('  ' + JSON.stringify(k));
}
if (!missing.length && !bad.length) console.log('Todo traducido.');
process.exit(missing.length || bad.length ? 1 : 0);

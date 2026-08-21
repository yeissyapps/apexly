// ============================================================================
//  check-schema — comprueba que lo que el CLIENTE pide existe de verdad en la
//  base de datos.
//
//  Nace de un fallo real: el Grand Prix llevaba dias sin poder guardar ni un
//  tiempo porque `submit_gp_result` estaba desplegada con TRES parametros y el
//  cliente llamaba con CUATRO. PostgREST devolvia PGRST202 sin ejecutar nada,
//  el `catch` del cliente se lo tragaba, y el jugador solo veia "no se pudo
//  enviar el tiempo". Nada en el codigo estaba mal: lo que fallaba era que el
//  SQL del repo y el SQL corrido en Supabase habian dejado de coincidir.
//
//  Este script lee el codigo, saca todas las llamadas a RPC y todas las
//  columnas que se seleccionan, y las prueba una a una contra la API.
//
//    node tools/check-schema.mjs
//
//  SIN EFECTOS SECUNDARIOS, y a proposito: usa solo la clave anon y NUNCA
//  inicia sesion, asi que `auth.uid()` es null y toda funcion se corta en su
//  primer `if auth.uid() is null then raise` antes de tocar una fila. Por eso
//  puede llamar a `submit_time` sin escribir ningun tiempo.
//
//  Que significa cada resultado:
//    PGRST202  -> la funcion no existe con ESOS nombres de parametro
//    42703     -> la columna no existe en esa tabla
//    cualquier otra cosa (incluido un error de autenticacion) -> existe
// ============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const cfg = readFileSync('src/supabaseConfig.js', 'utf8');
const URL_ = cfg.match(/SUPABASE_URL\s*=\s*'([^']+)'/)[1];
const KEY = cfg.match(/SUPABASE_ANON_KEY\s*=\s*\n?\s*'([^']+)'/)[1];
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// --- Recoger el codigo cliente ---------------------------------------------
const files = ['App.js', ...readdirSync('src').filter((f) => f.endsWith('.js')).map((f) => join('src', f))];
const code = files.map((f) => readFileSync(f, 'utf8')).join('\n');

// --- 1. Llamadas a RPC ------------------------------------------------------
// supabase.rpc('nombre', { p_a: ..., p_b: ... })  -> nombre + nombres de params
const rpcs = new Map();
for (const m of code.matchAll(/\.rpc\(\s*'([a-z0-9_]+)'\s*(?:,\s*\{([\s\S]*?)\}\s*)?\)/g)) {
  const [, name, body = ''] = m;
  const params = [...body.matchAll(/(?:^|[,{\s])(p_[a-z0-9_]+)\s*:/g)].map((x) => x[1]);
  const key = `${name}(${params.slice().sort().join(',')})`;
  if (!rpcs.has(key)) rpcs.set(key, { name, params });
}

// --- 2. Columnas seleccionadas ---------------------------------------------
// .from('tabla') ... .select('a, b, rel(c, d)')
const cols = new Map(); // tabla -> Set(columnas)
const add = (t, c) => { if (!cols.has(t)) cols.set(t, new Set()); cols.get(t).add(c); };
for (const m of code.matchAll(/\.from\(\s*'([a-z0-9_]+)'\s*\)([\s\S]{0,400}?)\.select\(\s*'([^']*)'/g)) {
  const [, table, , sel] = m;
  if (sel.trim() === '*' || sel.trim() === '') { add(table, '*'); continue; }
  // partir por comas de primer nivel (respetando rel(...))
  let depth = 0, cur = '';
  const parts = [];
  for (const ch of sel) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const rel = p.match(/^([a-z0-9_]+)\s*\(([^)]*)\)$/);
    if (rel) { for (const c of rel[2].split(',')) if (c.trim()) add(rel[1], c.trim()); continue; }
    add(table, p.replace(/^.*?:/, '').trim()); // quita alias "x:col"
  }
}

// --- Sondas -----------------------------------------------------------------
async function probeRpc({ name, params }) {
  const body = Object.fromEntries(params.map((p) => [p, null]));
  const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const t = await r.text();
  return t.includes('PGRST202') ? { ok: false, why: 'no existe con esos parametros' } : { ok: true };
}

async function probeCol(table, col) {
  const r = await fetch(`${URL_}/rest/v1/${table}?select=${encodeURIComponent(col)}&limit=1`, { headers: H });
  const t = await r.text();
  if (t.includes('42703')) return { ok: false, why: 'columna inexistente' };
  if (t.includes('42P01')) return { ok: false, why: 'TABLA inexistente' };
  return { ok: true };
}

// --- Ejecutar ---------------------------------------------------------------
let fallos = 0;
console.log(`\nComprobando contra ${URL_}\n`);

console.log(`RPC (${rpcs.size})`);
for (const { name, params } of rpcs.values()) {
  const r = await probeRpc({ name, params });
  if (!r.ok) { fallos++; console.log(`  FALLA  ${name}(${params.join(', ')}) — ${r.why}`); }
}

const totalCols = [...cols.values()].reduce((a, s) => a + s.size, 0);
console.log(`\nColumnas (${totalCols} en ${cols.size} tablas)`);
for (const [table, set] of cols) {
  for (const c of set) {
    if (c === '*' || c.includes('!')) continue; // '*' y hints de join no se comprueban
    const r = await probeCol(table, c);
    if (!r.ok) { fallos++; console.log(`  FALLA  ${table}.${c} — ${r.why}`); }
  }
}

console.log(fallos === 0
  ? '\nTodo cuadra: el codigo y la base de datos dicen lo mismo.\n'
  : `\n${fallos} desajuste(s). Cada uno es una funcion que revienta en tiempo de ejecucion.\n`);
process.exit(fallos === 0 ? 0 : 1);

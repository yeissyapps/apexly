// ============================================================================
//  GENERATOR — circuito del día generado de forma DETERMINÍSTICA por fecha.
//
//  Todos los jugadores ven el mismo circuito el mismo día (semilla = fecha),
//  pero cada día es distinto y variado: se encadenan "secciones" con carácter
//  propio (rápida / eses / cerrada / fluida) en orden aleatorio-determinístico,
//  mezclando ritmos para que no se sientan iguales entre sí.
//
//  Garantía de que NO se cruza consigo mismo: cada sección tiene rumbo neto 0
//  y nunca gira más de ~90°, así que la X del trazado nunca decrece -> una
//  curva monótona en X no puede cruzarse. Aun así validamos y reintentamos.
//
//  Objetivo de duración: ~35-50 s conduciendo limpio (constantes de config).
// ============================================================================

import { BANK, assemble } from './pieces.js';
import { buildTrackFromCenterline } from './track.js';
import { CONFIG } from './config.js';

const WIDE = 52;
const NARROW = 40;

// --- RNG determinístico (hash de la fecha -> secuencia reproducible) --------
function hashStr(s) {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const chance = (r, p) => r() < p;
const flip = (r) => r() < 0.5;

// --- Longitud de cada pieza (para acertar la duración objetivo) -------------
const pieceLen = {};
for (const p of BANK) {
  const cl = assemble([p.id], WIDE);
  let L = 0;
  for (let i = 0; i < cl.length - 1; i++) L += Math.hypot(cl[i + 1].x - cl[i].x, cl[i + 1].y - cl[i].y);
  pieceLen[p.id] = L;
}
const secLen = (sec) => sec.reduce((a, id) => a + pieceLen[id], 0);

// --- Secciones. Las de tipo fast/esses/tight/flow tienen rumbo neto 0 y giros
//     <= 90° (la X nunca decrece -> no se cruzan). La sección `hook` mete giros
//     de > 90° (hooks / horquillas): puede cruzar, por eso el generador valida
//     y reintenta con otra semilla si hace falta. -----------------------------
const pick = (r, a) => a[Math.floor(r() * a.length)];
const SECTIONS = {
  // Rápida: recta de buen ritmo, rota por kinks. OJO: el kink es "se toma
  //   plano" (arco grande, ~26° — ver pieces.js), o sea que NO exige frenar
  //   de verdad; mecánicamente esta sección sigue siendo un tramo largo sin
  //   nada que decidir, solo con forma de zigzag en el mapa. Por eso el
  //   tramo más largo (straight_l, 700u) se ha quitado de las opciones —
  //   sigue siendo la sección "de respiro" entre tramos técnicos, pero más
  //   corta, no una recta de casi 3s a tope sin ningún input.
  fast: (r) => {
    const d = flip(r);
    return [
      pick(r, ['straight_s', 'straight_s', 'straight_m']),
      d ? 'kink_L' : 'kink_R',
      pick(r, ['straight_s', 'straight_m']),
      d ? 'kink_R' : 'kink_L',
      'straight_s',
    ];
  },
  // Fluida: par de curvas amplias (sweeper / wide / bend), radio grande.
  flow: (r) => {
    const k = pick(r, ['sweep', 'wide', 'bend']);
    const L = k + '_L', R = k + '_R';
    return flip(r) ? [R, 'straight_s', L, 'straight_s'] : [L, 'straight_s', R, 'straight_s'];
  },
  // Eses: chicanes (rápida / normal / cerrada), a veces dobles.
  esses: (r) => {
    const k = pick(r, ['chicane_fast', 'chicane', 'chicane', 'chicane_sharp']);
    const A = k + '_LR', B = k + '_RL';
    if (chance(r, 0.4)) return flip(r) ? [A, 'straight_xs', B, 'straight_xs', A] : [B, 'straight_xs', A, 'straight_xs', B];
    return flip(r) ? [A, 'straight_s', B] : [B, 'straight_s', A];
  },
  // Cerrada: jog de curvas de 90° (corner / tight).
  tight: (r) => {
    const k = pick(r, ['corner', 'tight', 'tight']);
    const L = k + '_L', R = k + '_R';
    return flip(r) ? [R, 'straight_m', L] : [L, 'straight_m', R];
  },
  // Hook: giro de > 90° -> jog de hooks o switchback de horquilla (se valida).
  // `hairpinBias` (0..1, por defecto 0.5) inclina hacia la horquilla de
  // verdad (switchback) en vez del jog más suave — lo usa Modo Carrera para
  // subir la dificultad en los niveles altos sin tocar el circuito diario.
  hook: (r, opts) => {
    const bias = opts?.hairpinBias ?? 0.5;
    if (chance(r, 1 - bias)) return flip(r) ? ['hook_R', 'straight_s', 'hook_L'] : ['hook_L', 'straight_s', 'hook_R'];
    return flip(r) ? ['hairpin_R', 'straight_m', 'hairpin_L'] : ['hairpin_L', 'straight_m', 'hairpin_R'];
  },
};
const TYPES = ['fast', 'esses', 'tight', 'flow', 'hook'];
// 'fast' bajado (0.22 -> 0.14): sus kinks no frenan de verdad (ver comentario
// en SECTIONS.fast), así que cuanto más pesa, más lapso sin nada que decidir.
// El resto absorbe la diferencia hacia las secciones con curvas de verdad.
const WEIGHT = { fast: 0.14, esses: 0.29, tight: 0.25, flow: 0.18, hook: 0.14 };
function weightedType(r, weight) {
  const x = r();
  let acc = 0;
  for (const t of TYPES) { acc += weight[t]; if (x < acc) return t; }
  return 'esses';
}

// --- Etiqueta descriptiva del carácter del circuito -------------------------
function makeLabel(types, half) {
  const c = { fast: 0, esses: 0, tight: 0, flow: 0, hook: 0 };
  for (const t of types) c[t]++;
  const tags = [];
  if (half <= NARROW) tags.push('Estrecho');
  if (c.hook >= 2) tags.push('Horquillas');
  else if (c.esses >= 3) tags.push('Chicanes');
  else if (c.tight >= 3) tags.push('Cerrado');
  else if (c.esses + c.tight + c.hook > c.fast + c.flow) tags.push('Técnico');
  if (c.fast >= 4) tags.push('Rápido');
  else if (c.flow >= 3) tags.push('Fluido');
  if (tags.length === 0) tags.push('Variado');
  return tags.slice(0, 2).join(' · ');
}

// --- Estimación de tiempo limpio (referencia, no toca la física) ------------
function cleanTime(len) {
  const { MAX_SPEED, ACCEL } = CONFIG;
  const dAccel = (MAX_SPEED * MAX_SPEED) / (2 * ACCEL);
  return len > dAccel ? MAX_SPEED / ACCEL + (len - dAccel) / MAX_SPEED : Math.sqrt((2 * len) / ACCEL);
}

function segDist(a, b, c, d) {
  const f = (px, py, qx, qy) => {
    const dx = qx - px, dy = qy - py, l2 = dx * dx + dy * dy || 1;
    return (x, y) => { let t = ((x - px) * dx + (y - py) * dy) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - (px + dx * t), y - (py + dy * t)); };
  };
  const f1 = f(a.x, a.y, b.x, b.y), f2 = f(c.x, c.y, d.x, d.y);
  return Math.min(f1(c.x, c.y), f1(d.x, d.y), f2(a.x, a.y), f2(b.x, b.y));
}

const TARGET = 9200, MAXLEN = 11800;
const SHORTCUT = CONFIG.TRACK_WIDTH - CONFIG.CAR_WIDTH;

// Genera la especificación del circuito para una fecha (determinístico).
// `opts` (todo opcional, por defecto = comportamiento de siempre del
// circuito diario): half (ancho fijo, si no se sortea WIDE/NARROW), weight
// (tabla de pesos por tipo de sección), hairpinBias (ver SECTIONS.hook),
// requireFast (si hace falta al menos una sección 'fast' para validar).
function generateSpec(dateKey, opts = {}) {
  const { half: forcedHalf, weight = WEIGHT, hairpinBias, requireFast = true } = opts;
  let fallback = null;
  for (let attempt = 0; attempt < 16; attempt++) {
    const rng = mulberry32(hashStr(dateKey + '#' + attempt));
    const half = forcedHalf != null ? forcedHalf : (chance(rng, 0.22) ? NARROW : WIDE);
    const ids = ['straight_s'];
    const types = [];
    let len = pieceLen['straight_s'];
    let last = null, run = 0, guard = 0;
    while (len < TARGET && guard++ < 40) {
      let t = weightedType(rng, weight);
      // No repetir 3 veces seguidas; y nunca dos 'fast' seguidas (evita encadenar rectas).
      if (t === last && (run >= 2 || t === 'fast')) { while (t === last) t = weightedType(rng, weight); }
      const sec = SECTIONS[t](rng, { hairpinBias });
      const sl = secLen(sec);
      if (len + sl > MAXLEN) break;
      ids.push(...sec); types.push(t);
      run = t === last ? run + 1 : 1; last = t; len += sl;
    }
    ids.push('straight_s');

    const cl = assemble(ids, half);
    const cum = [0];
    for (let i = 0; i < cl.length - 1; i++) cum.push(cum[i] + Math.hypot(cl[i + 1].x - cl[i].x, cl[i + 1].y - cl[i].y));
    const L = cum[cum.length - 1];
    const time = cleanTime(L);

    // Seguridad: comprobar que no se cruza consigo mismo (por si algún caso raro).
    let cross = false;
    for (let i = 0; i < cl.length - 1 && !cross; i++)
      for (let j = i + 1; j < cl.length - 1; j++) {
        if (cum[j] - cum[i + 1] < 320) continue;
        if (segDist(cl[i], cl[i + 1], cl[j], cl[j + 1]) < SHORTCUT) { cross = true; break; }
      }

    const tech = types.filter((t) => t === 'esses' || t === 'tight' || t === 'hook').length;
    const distinct = new Set(types).size;
    const spec = { ids, half, types, centerline: cl, timeEstimate: time };
    if (!fallback) fallback = spec; // primer candidato como red de seguridad
    if (time >= 35 && time <= 50 && !cross && tech >= 2 && distinct >= 3 && (!requireFast || types.includes('fast'))) return spec;
  }
  return fallback;
}

// Solo el tiempo de referencia del circuito de un día, SIN construir su
// geometría (bordes, polígono de asfalto, meta). Lo usa el gráfico de
// evolución del Perfil, que necesita el objetivo de muchos días pasados y no
// dibuja ninguno de esos trazados.
//
// OJO con la expectativa: esto NO es la optimización que parece. Medido sobre
// 30 días, 262 ms -> 231 ms (12%); el coste real está en `generateSpec`, que
// prueba hasta 16 candidatos por día hasta encontrar uno válido, no en montar
// la geometría. Para que el Perfil no se congele, lo que de verdad hace falta
// es NO llamar a esto en bucle durante el render: el Perfil lo calcula fuera
// del primer pintado y cachea el resultado (el valor de un día pasado es
// determinista y no cambia nunca).
//
// Es el MISMO valor que `dailyCircuit(dateKey).timeEstimate` (misma semilla,
// mismo generateSpec) — verificado sobre 30 días, 0 desviaciones.
export function dailyTimeEstimate(dateKey) {
  return generateSpec(dateKey).timeEstimate;
}

// Circuito del día listo para el juego: { track, label, half, timeEstimate }.
export function dailyCircuit(dateKey) {
  const spec = generateSpec(dateKey);
  return {
    track: buildTrackFromCenterline(spec.centerline),
    label: makeLabel(spec.types, spec.half),
    half: spec.half,
    timeEstimate: spec.timeEstimate,
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

// Circuito de Modo Carrera para una dificultad `t` (0 = nivel 1, 1 = nivel
// más difícil). Mismo motor que el diario, pero con el ancho, el peso de
// cada tipo de sección y el sesgo hacia horquilla-de-verdad (en vez de jog)
// deslizando con `t` — así la dificultad sube por más de un eje, no solo
// por el margen de tiempo. `dailyCircuit` NO usa esta función ni se ve
// afectado por ella (sigue con sus valores de siempre).
export function tieredCircuit(seedKey, t) {
  const half = lerp(56, 36, t);       // más ancho que WIDE en el nivel 1 -> más estrecho que NARROW en el último
  const weight = {
    fast: lerp(0.20, 0.06, t),
    esses: lerp(0.26, 0.28, t),
    tight: lerp(0.20, 0.26, t),
    flow: lerp(0.20, 0.10, t),
    hook: lerp(0.14, 0.30, t),
  };
  const hairpinBias = lerp(0.35, 0.85, t); // dentro de 'hook': jog suave -> horquilla de verdad
  const spec = generateSpec(seedKey, { half, weight, hairpinBias, requireFast: t < 0.6 });
  return {
    track: buildTrackFromCenterline(spec.centerline),
    label: makeLabel(spec.types, spec.half),
    half: spec.half,
    timeEstimate: spec.timeEstimate,
  };
}

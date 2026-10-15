// ============================================================================
//  LOOP GENERATOR — circuitos CERRADOS generados por fecha (EN PRUEBAS).
//
//  JC, 2026-10-14: "cómo de grande sería hacer los circuitos cerrados en lugar
//  de trazadas" -> prototipo validado en una hoja de 30 días. Esto es ese
//  mismo generador dentro de la app, de momento SOLO para el modo de prueba
//  "PROBAR CIRCUITO CERRADO" (Perfil, testers). El diario sigue con
//  generator.js tal cual.
//
//  Por qué no reutiliza generator.js: aquel garantiza que el trazado no se
//  cruza haciendo que siempre avance hacia la derecha — imposible en un
//  circuito que tiene que volver a la salida. Aquí:
//    1. Puntos de control alrededor de un centro (con algún retroceso y
//       "lenguas" hacia dentro que dan horquillas).
//    2. Spline cerrada (Catmull-Rom centrípeta) y escalado a la longitud de
//       vuelta elegida.
//    3. Las curvas más cerradas que MIN_RADIUS se suavizan localmente (en vez
//       de tirar el circuito).
//    4. Se descarta si dos tramos que no son vecinos quedan a menos de
//       MIN_GAP (la pista se tocaría consigo misma) — eso también descarta
//       cualquier cruce.
//    5. Salida en el tramo más recto (el coche arranca recto) y sentido de
//       giro al azar.
//  Determinista por fecha, como el diario: todos ven el mismo circuito.
//
//  Sin imports de React Native: se puede ejecutar en Node (hojas de prueba).
// ============================================================================

import { buildTrackFromCenterline } from './track.js';

export const LOOP_HALF = 46;        // medio ancho (el de los cerrados del Grand Prix)
export const LOOP_LAPS = 2;         // 2 vueltas de ~19 s: con 3 eran óvalos sin gracia
const MIN_RADIUS = 80;              // la curva más cerrada del juego ronda 70-120
const MIN_GAP = 2 * LOOP_HALF + 40;
const STEP = 20;                    // separación entre puntos de la línea central
const FOLD_MIN = 80;                // ver foldMin en generateLap

function hashSeq(s) {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
}
function mulberry(seed) {
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function spline(ctrl, perSeg = 40) {
  const n = ctrl.length, out = [];
  const P = (i) => ctrl[(i + n) % n];
  const d = (a, b) => Math.pow(Math.hypot(b.x - a.x, b.y - a.y), 0.5) || 1e-6;
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    for (let k = 0; k < perSeg; k++) {
      const t = t1 + ((t2 - t1) * k) / perSeg;
      const L = (pa, pb, ta, tb) => ({ x: ((tb - t) * pa.x + (t - ta) * pb.x) / (tb - ta), y: ((tb - t) * pa.y + (t - ta) * pb.y) / (tb - ta) });
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      out.push(L(L(A1, A2, t0, t2), L(A2, A3, t1, t3), t1, t2));
    }
  }
  return out;
}

function loopLength(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += Math.hypot(b.x - a.x, b.y - a.y); }
  return s;
}

function resample(pts, step) {
  const total = loopLength(pts), n = Math.round(total / step), out = [];
  const segLen = (i) => { const a = pts[i], b = pts[(i + 1) % pts.length]; return Math.hypot(b.x - a.x, b.y - a.y); };
  let seg = 0, acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (k * total) / n;
    while (acc + segLen(seg) < target) { acc += segLen(seg); seg++; }
    const a = pts[seg], b = pts[(seg + 1) % pts.length], u = (target - acc) / (segLen(seg) || 1);
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  }
  return out;
}

function scaleTo(pts, len) {
  const s = len / loopLength(pts);
  return pts.map((p) => ({ x: p.x * s, y: p.y * s }));
}

// Curvatura con signo (1/radio) en cada punto del lazo.
function curvature(pts) {
  const n = pts.length, k = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 2 + n) % n], b = pts[i], c = pts[(i + 2) % n];
    const ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y), ac = Math.hypot(c.x - a.x, c.y - a.y);
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    k.push((2 * cross) / (ab * bc * ac || 1));
  }
  return k;
}

// Distancia en línea recta más corta entre dos puntos separados 2*K por la
// pista: si es muy pequeña, ahí el trazado se pliega (ver FOLD_MIN).
function foldMin(pts, K) {
  const n = pts.length;
  let m = Infinity;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - K + n) % n], b = pts[(i + K) % n];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d < m) m = d;
  }
  return m;
}

function minGap(pts) {
  const n = pts.length, skip = Math.ceil((Math.PI * MIN_GAP) / STEP) + 4;
  let best = Infinity;
  for (let i = 0; i < n; i += 2) {
    for (let j = i + skip; j < n; j += 2) {
      if (Math.min(j - i, n - (j - i)) < skip) continue;
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d < best) best = d;
    }
  }
  return best;
}

// Nombre del circuito a partir de sus curvas, con las mismas palabras que el
// diario (generator.js, makeLabel) para que se traduzcan igual (i18n/en.js).
function makeLabel(k) {
  const turns = [];
  let cur = null;
  for (const kk of k) {
    const sign = Math.sign(kk), strong = Math.abs(kk) > 1 / 300;
    if (strong && cur && cur.sign === sign) { cur.angle += Math.abs(kk) * STEP; cur.minR = Math.min(cur.minR, 1 / Math.abs(kk)); }
    else if (strong) { cur = { sign, angle: Math.abs(kk) * STEP, minR: 1 / Math.abs(kk) }; turns.push(cur); }
    else cur = null;
  }
  const deg = (r) => (r * 180) / Math.PI;
  const real = turns.filter((t) => deg(t.angle) > 25);
  const hairpins = real.filter((t) => deg(t.angle) > 130).length;
  const tight = real.filter((t) => t.minR < 140).length;
  const flips = real.reduce((acc, t, i) => acc + (i > 0 && t.sign !== real[i - 1].sign ? 1 : 0), 0);
  const tags = [];
  if (hairpins >= 1) tags.push('Horquillas');
  else if (tight >= 5) tags.push('Cerrado');
  else if (flips >= 8) tags.push('Chicanes');
  else if (tight >= 2) tags.push('Técnico');
  if (real.length <= 5) tags.push('Rápido');
  else if (real.length >= 11) tags.push('Variado');
  if (tags.length === 0) tags.push('Fluido');
  return tags.slice(0, 2).join(' · ');
}

// Una vuelta (lista de puntos {x,y}) o null si este día no sale ninguna.
function generateLap(dateKey) {
  const next = hashSeq('loop:' + dateKey);
  for (let attempt = 0; attempt < 400; attempt++) {
    const rng = mulberry(next());
    const N = 11 + Math.floor(rng() * 8);
    const spikes = new Set();
    const nSpikes = rng() < 0.75 ? 1 + Math.floor(rng() * 2) : 0;
    for (let q = 0; q < nSpikes; q++) spikes.add(Math.floor(rng() * N));
    const ctrl = [];
    for (let i = 0; i < N; i++) {
      if (spikes.has(i)) {
        // "Lengua" hacia dentro: fuera, dentro, fuera muy juntos -> horquilla.
        const base = (i / N) * Math.PI * 2, rOut = 0.95, rIn = 0.3 + rng() * 0.2, half = 0.16 + rng() * 0.06;
        ctrl.push({ x: Math.cos(base - half) * rOut * 1000, y: Math.sin(base - half) * rOut * 1000 });
        ctrl.push({ x: Math.cos(base) * rIn * 1000, y: Math.sin(base) * rIn * 1000 });
        ctrl.push({ x: Math.cos(base + half) * rOut * 1000, y: Math.sin(base + half) * rOut * 1000 });
        continue;
      }
      const ang = ((i + (rng() - 0.5) * 1.1) / N) * Math.PI * 2;
      let r = 0.5 + rng() * 0.5;
      if (rng() < 0.32) r *= 0.3 + rng() * 0.25;
      ctrl.push({ x: Math.cos(ang) * r * 1000, y: Math.sin(ang) * r * 1000 });
    }
    const targetLap = 4000 + rng() * 900;
    let pts = resample(scaleTo(resample(spline(ctrl), 6), targetLap), STEP);
    // Descarte barato ANTES de suavizar: si el trazado se dobla sobre sí
    // mismo (dos puntos a 10 de distancia por la pista quedan a menos de
    // FOLD_MIN en línea recta), ningún suavizado lo abre hasta el radio
    // mínimo — se descartaba igual, pero tras 80 vueltas de suavizado (5 ms
    // por intento, ~50 intentos por día: segundos en el móvil al arrancar).
    // Medido sobre 60 días: todos los aceptados tienen >= 90, así que con 80
    // no cambia NINGÚN circuito y se ahorra el 92% de los descartes.
    if (foldMin(pts, 5) < FOLD_MIN) continue;
    for (let it = 0; it < 80; it++) {
      const k0 = curvature(pts);
      let bad = 0;
      pts = pts.map((p, i) => {
        if (Math.abs(k0[i]) * MIN_RADIUS <= 1) return p;
        bad++;
        const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
        return { x: p.x * 0.4 + (a.x + b.x) * 0.3, y: p.y * 0.4 + (a.y + b.y) * 0.3 };
      });
      if (!bad) break;
    }
    pts = resample(scaleTo(pts, targetLap), STEP);
    const k = curvature(pts);
    if (1 / Math.max(...k.map(Math.abs)) < MIN_RADIUS) continue;
    if (minGap(pts) < MIN_GAP) continue;
    // Salida en el tramo más recto.
    const W = 12;
    let bestI = 0, bestSum = Infinity;
    for (let i = 0; i < pts.length; i++) {
      let sum = 0;
      for (let j = -W; j <= W; j++) sum += Math.abs(k[(i + j + pts.length) % pts.length]);
      if (sum < bestSum) { bestSum = sum; bestI = i; }
    }
    pts = [...pts.slice(bestI), ...pts.slice(0, bestI)];
    if (rng() < 0.5) pts = [pts[0], ...pts.slice(1).reverse()];
    return pts;
  }
  return null;
}

// Circuito cerrado del día listo para el juego: { track, label, half,
// timeEstimate }, mismo formato que dailyCircuit() (generator.js). La vuelta
// se repite LOOP_LAPS veces seguidas, igual que buildClosedCombo() en
// pieces.js — el motor ya sabe correr eso (track.laps / track.closed).
export function closedDailyCircuit(dateKey) {
  // Desde que es el diario de verdad (generator.js, CLOSED_FROM) no puede
  // haber un día sin circuito: si la semilla del día no da ninguno en 400
  // intentos (no ha pasado en las pruebas), se prueban semillas derivadas.
  // Los días que salen a la primera no cambian.
  let lap = generateLap(dateKey);
  for (let salt = 1; !lap && salt <= 5; salt++) lap = generateLap(`${dateKey}#${salt}`);
  if (!lap) return null;
  const k = curvature(lap);
  // Cada punto lleva su medio ancho y un `type` (recta/curva), como los de
  // pieces.js — Game.js lo usa en el diagnóstico.
  const oneLap = [...lap, lap[0]].map((p, i) => ({
    x: p.x, y: p.y, w: LOOP_HALF,
    type: Math.abs(k[i % lap.length]) < 1 / 600 ? 'recta' : 'curva',
  }));
  const centerline = [...oneLap];
  for (let l = 1; l < LOOP_LAPS; l++) for (let i = 1; i < oneLap.length; i++) centerline.push(oneLap[i]);
  const track = buildTrackFromCenterline(centerline);
  track.closed = true;
  track.laps = LOOP_LAPS;
  track.lapLength = loopLength(lap);
  return {
    track,
    label: makeLabel(k),
    half: LOOP_HALF,
    timeEstimate: Math.round((track.lapLength / 250) * LOOP_LAPS),
  };
}

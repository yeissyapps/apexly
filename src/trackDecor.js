// ============================================================================
//  trackDecor — geometría decorativa del circuito (solo render, nada de física).
//
//  JC, 2026-10-14, "paquete 1" de estética de carrera: que la pista deje de
//  ser una cinta flotando en negro y parezca un circuito.
//    · Escapatoria + hierba: bandas por debajo del asfalto (las dibuja
//      TrackLayer con la propia línea central y un trazo ancho).
//    · Pianos SOLO en las curvas, como en un circuito de verdad; en las
//      rectas, línea blanca de borde. Las curvas se anuncian solas al ver
//      aparecer el rojo/blanco.
//    · Muros de neumáticos por fuera de las curvas cerradas.
//
//  Todo sale de la GEOMETRÍA (curvatura por vértice), no del tipo de pieza:
//  así vale igual para el diario por piezas, los cerrados del GP y los
//  circuitos cerrados por spline (loopGenerator). Se calcula una vez por
//  circuito (useMemo en TrackLayer) y cada capa va en UN <Path>: el <G> de
//  cámara cambia de transform en cada frame y arrastra todo lo que cuelga.
//
//  Módulo puro (sin React) para poder probarlo en Node.
// ============================================================================

export const KERB_W = 9;       // ancho del piano (centrado en el borde)
const KERB_BLOCK = 11;         // largo objetivo de cada bloque rojo/blanco
const KERB_R = 210;            // curva con radio menor que esto lleva piano
const KERB_LEAD = 18;          // el piano empieza/acaba un poco antes/después del arco
const TYRE_R = 130;            // radio por debajo del cual la curva es "cerrada"
const TYRE_MIN_TURN = 70;      // ...y además gira al menos esto (grados) en total
const TYRE_GAP = 26;           // distancia del borde de pista a la 1ª fila de neumáticos
const TYRE_RAD = 4.3;          // radio de cada neumático
const TYRE_STEP = 9.2;         // separación entre neumáticos de una fila

// Un circuito cerrado de varias vueltas repite la misma vuelta en la línea
// central: para decorar basta con la primera (dibujarla dos veces solo
// duplica trabajo y, en los pianos, descuadra el patrón).
export function firstLapCount(track) {
  const n = track.center.length;
  return track.laps > 1 ? Math.round((n - 1) / track.laps) + 1 : n;
}

// Curvatura con signo por vértice (1/radio). >0 = gira hacia el borde
// izquierdo (track.left = centro + normal, normal = tangente girada +90°).
function vertexCurvature(pts, closed) {
  const n = pts.length;
  const k = new Array(n).fill(0);
  const ang = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let a = pts[i - 1];
    let b = pts[i + 1];
    if (closed) {
      // primer y último punto coinciden: el vecino "de atrás" del 0 es el n-2
      if (i === 0) a = pts[n - 2];
      if (i === n - 1) b = pts[1];
    }
    if (!a || !b) continue;
    const ax = pts[i].x - a.x, ay = pts[i].y - a.y;
    const bx = b.x - pts[i].x, by = b.y - pts[i].y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-6 || lb < 1e-6) continue;
    const t = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    ang[i] = t;
    k[i] = t / ((la + lb) / 2);
  }
  return { k, ang };
}

// Rachas consecutivas de vértices que cumplen `test` -> [[i0, i1], ...]
function runs(n, test) {
  const out = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (test(i)) { if (start < 0) start = i; }
    else if (start >= 0) { out.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) out.push([start, n - 1]);
  return out;
}

function cumLength(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return cum;
}

// Normal por vértice de una polilínea (tangente promediada girada +90°).
function normals(pts) {
  const n = pts.length;
  const nor = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[Math.min(n - 1, i + 1)];
    const tx = p1.x - p0.x, ty = p1.y - p0.y;
    const L = Math.hypot(tx, ty) || 1;
    nor.push({ x: -ty / L, y: tx / L });
  }
  return nor;
}

// Muestreador por longitud de arco. `s` debe pedirse en orden creciente.
function sampler(pts, cum, nor) {
  const n = pts.length;
  let seg = 0;
  return (s) => {
    while (seg < n - 2 && cum[seg + 1] < s) seg++;
    const a = cum[seg], b = cum[seg + 1];
    const f = b > a ? Math.min(1, Math.max(0, (s - a) / (b - a))) : 0;
    const p = {
      x: pts[seg].x + (pts[seg + 1].x - pts[seg].x) * f,
      y: pts[seg].y + (pts[seg + 1].y - pts[seg].y) * f,
    };
    if (nor) {
      p.nx = nor[seg].x + (nor[seg + 1].x - nor[seg].x) * f;
      p.ny = nor[seg].y + (nor[seg + 1].y - nor[seg].y) * f;
    }
    return p;
  };
}

// Bloques del piano sobre un borde, solo en los tramos [s0, s1] (longitud de
// arco del propio borde). Geometría explícita y no strokeDasharray: en iOS el
// discontinuo se rasteriza con bloques desiguales (ver historia en Game.js).
// Devuelve dos paths: bloques rojos y bloques blancos.
function kerbBlocks(pts, ranges, blockLen, halfW) {
  if (pts.length < 2 || !ranges.length) return { red: '', white: '' };
  const cum = cumLength(pts);
  const at = sampler(pts, cum, normals(pts));
  const SUB = 3; // sub-muestras por bloque (para que siga la curva)
  const red = [];
  const white = [];
  for (const [r0, r1] of ranges) {
    const count = Math.max(2, Math.round((r1 - r0) / blockLen));
    const len = (r1 - r0) / count;
    for (let k = 0; k < count; k++) {
      const s0 = r0 + k * len;
      const s1 = s0 + len;
      const inner = [];
      const outer = [];
      for (let m = 0; m <= SUB; m++) {
        const p = at(s0 + ((s1 - s0) * m) / SUB);
        const nl = Math.hypot(p.nx, p.ny) || 1;
        const ux = (p.nx / nl) * halfW;
        const uy = (p.ny / nl) * halfW;
        inner.push(`${p.x - ux},${p.y - uy}`);
        outer.push(`${p.x + ux},${p.y + uy}`);
      }
      const ring = inner.concat(outer.reverse());
      (k % 2 === 0 ? red : white).push(`M${ring[0]}L${ring.slice(1).join('L')}Z`);
    }
  }
  return { red: red.join(''), white: white.join('') };
}

// Pasa rachas de índices a tramos de longitud de arco sobre `edge`,
// alargados KERB_LEAD por cada lado y fusionados si se solapan.
function rangesOnEdge(edge, idxRuns) {
  const cum = cumLength(edge);
  const total = cum[cum.length - 1];
  const out = [];
  for (const [i0, i1] of idxRuns) {
    const a = Math.max(0, cum[i0] - KERB_LEAD);
    const b = Math.min(total, cum[i1] + KERB_LEAD);
    if (out.length && a <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
    else out.push([a, b]);
  }
  return out;
}

function distToSegment(px, py, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const L2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / L2));
  return Math.hypot(px - (a.x + vx * t), py - (a.y + vy * t));
}

const circle = (x, y, r) => `M${(x - r).toFixed(1)},${y.toFixed(1)}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;

// Muros de neumáticos por FUERA de las curvas cerradas (radio < TYRE_R y que
// giren al menos TYRE_MIN_TURN en total: así una chicane suave no se llena de
// neumáticos). Dos filas, alternando dos colores como los muros pintados de
// verdad. Un neumático que caiga cerca de OTRO tramo de pista (trazados que
// pasan al lado de sí mismos) se descarta: nunca encima del asfalto.
function tyreWalls(center, k, ang) {
  const n = center.length;
  const tight = runs(n, (i) => Math.abs(k[i]) > 1 / TYRE_R);
  const a = [];
  const b = [];
  for (const [i0, i1] of tight) {
    let turn = 0;
    let sign = 0;
    for (let i = i0; i <= i1; i++) { turn += ang[i]; sign += k[i]; }
    if (Math.abs(turn) * 180 / Math.PI < TYRE_MIN_TURN) continue;
    const outer = sign > 0 ? -1 : 1; // gira a la izquierda -> fuera = derecha
    const j0 = Math.max(0, i0 - 1);
    const j1 = Math.min(n - 1, i1 + 1);
    for (let row = 0; row < 2; row++) {
      const off = TYRE_GAP + row * (TYRE_RAD * 1.9);
      const line = [];
      for (let i = j0; i <= j1; i++) {
        const p0 = center[Math.max(0, i - 1)];
        const p1 = center[Math.min(n - 1, i + 1)];
        const tx = p1.x - p0.x, ty = p1.y - p0.y;
        const L = Math.hypot(tx, ty) || 1;
        const d = (center[i].w + off) * outer;
        line.push({ x: center[i].x + (-ty / L) * d, y: center[i].y + (tx / L) * d });
      }
      const cum = cumLength(line);
      const total = cum[cum.length - 1];
      const at = sampler(line, cum);
      const count = Math.floor(total / TYRE_STEP);
      for (let m = 0; m <= count; m++) {
        const s = m * TYRE_STEP + (row ? TYRE_STEP / 2 : 0);
        if (s > total) break;
        const p = at(s);
        // ¿cerca de algún tramo de pista? (de cualquier parte del trazado)
        let clear = true;
        for (let q = 0; q < n - 1 && clear; q++) {
          if (distToSegment(p.x, p.y, center[q], center[q + 1]) < center[q].w + KERB_W + TYRE_RAD) clear = false;
        }
        if (!clear) continue;
        (m % 4 < 2 ? a : b).push(circle(p.x, p.y, TYRE_RAD));
      }
    }
  }
  return { a: a.join(''), b: b.join('') };
}

// Todo lo decorativo de un circuito, listo para pintar.
export function buildTrackDecor(track) {
  const n = firstLapCount(track);
  const center = track.center.slice(0, n);
  const left = track.left.slice(0, n);
  const right = track.right.slice(0, n);
  const { k, ang } = vertexCurvature(center, !!track.closed);

  const curvy = runs(n, (i) => Math.abs(k[i]) > 1 / KERB_R);
  const kerbL = kerbBlocks(left, rangesOnEdge(left, curvy), KERB_BLOCK, KERB_W / 2);
  const kerbR = kerbBlocks(right, rangesOnEdge(right, curvy), KERB_BLOCK, KERB_W / 2);

  let maxW = 0;
  for (const p of center) if (p.w > maxW) maxW = p.w;

  const pl = (pts) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return {
    center: pl(center),
    edgeL: pl(left),
    edgeR: pl(right),
    maxW,
    kerbRed: kerbL.red + kerbR.red,
    kerbWhite: kerbL.white + kerbR.white,
    tyres: tyreWalls(center, k, ang),
    stats: { curvyRuns: curvy.length },
  };
}

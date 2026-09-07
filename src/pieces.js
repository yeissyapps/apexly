// ============================================================================
//  PIECES — Sistema de piezas modulares de circuito (v0.2).
//
//  Cada pieza define su geometría como una LÍNEA CENTRAL local (empezando en
//  (0,0) con rumbo +x) y expone un punto de ENTRADA y uno de SALIDA con
//  posición y ángulo. El combinador `assemble()` monta un circuito encadenando
//  piezas: rota/traslada cada una para que su entrada encaje con la salida de
//  la anterior. El encaje es continuo por construcción (tangentes alineadas).
//
//  Duraciones pensadas para ~35-50 s conduciendo limpio con las constantes de
//  velocidad actuales (MAX_SPEED/ACCEL en config.js) — no se tocan, solo se
//  usan de referencia al dimensionar las piezas y combos.
//
//  Nada de generación aleatoria ni validación automática aquí: son piezas y
//  combinaciones montadas a mano.
// ============================================================================

import { buildTrackFromCenterline } from './track.js';

const DEFAULT_WIDTH = 104; // = CONFIG.TRACK_WIDTH (mismo feel que el trazado previo)

// ---- Generadores de geometría local (entrada en (0,0), rumbo +x) ----------
function straight(len) {
  const steps = Math.max(2, Math.round(len / 120));
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push({ x: (len * i) / steps, y: 0 });
  return pts;
}

// Arco circular EXACTO: rumbo de entrada 0, de salida = turnDeg (grados).
// turnDeg > 0 gira hacia +y, < 0 hacia -y.
function arc(radius, turnDeg) {
  const total = (turnDeg * Math.PI) / 180;
  const s = Math.sign(total) || 1;
  const phi = Math.abs(total);
  const steps = Math.max(4, Math.ceil(phi / (Math.PI / 20))); // ~9°/paso
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const u = (phi * i) / steps;
    const a = -s * (Math.PI / 2) + s * u;
    pts.push({ x: radius * Math.cos(a), y: radius * s + radius * Math.sin(a) });
  }
  return pts;
}

function placePoints(points, pose) {
  const c = Math.cos(pose.angle);
  const s = Math.sin(pose.angle);
  return points.map((p) => ({
    x: pose.x + p.x * c - p.y * s,
    y: pose.y + p.x * s + p.y * c,
  }));
}
function transformPose(local, pose) {
  const c = Math.cos(pose.angle);
  const s = Math.sin(pose.angle);
  return {
    x: pose.x + local.x * c - local.y * s,
    y: pose.y + local.x * s + local.y * c,
    angle: pose.angle + local.angle,
  };
}
// Encadena listas locales en una sola (para piezas compuestas, p.ej. chicane).
function chain(...lists) {
  let out = [];
  let pose = { x: 0, y: 0, angle: 0 };
  for (const list of lists) {
    const placed = placePoints(list, pose);
    for (let i = out.length ? 1 : 0; i < placed.length; i++) out.push(placed[i]);
    const n = placed.length;
    pose = {
      x: placed[n - 1].x,
      y: placed[n - 1].y,
      angle: Math.atan2(placed[n - 1].y - placed[n - 2].y, placed[n - 1].x - placed[n - 2].x),
    };
  }
  return out;
}

function makePiece(id, type, points, width = DEFAULT_WIDTH) {
  const n = points.length;
  return {
    id,
    type,
    width,
    points,
    entry: {
      x: points[0].x,
      y: points[0].y,
      angle: Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x),
    },
    exit: {
      x: points[n - 1].x,
      y: points[n - 1].y,
      angle: Math.atan2(points[n - 1].y - points[n - 2].y, points[n - 1].x - points[n - 2].x),
    },
  };
}

// ---- Banco de piezas -------------------------------------------------------
// Paleta amplia. El generador (src/generator.js) las combina. Las curvas van
// en pares izquierda/derecha; las de > 90° (hook, horquilla) reversan la marcha
// y solo se usan validando que el circuito no se cruce.
export const BANK = [
  // --- Rectas (de muy corta a muy larga) ---
  makePiece('straight_xs', 'recta', straight(140)),
  makePiece('straight_s', 'recta', straight(240)),
  makePiece('straight_m', 'recta', straight(430)),
  makePiece('straight_l', 'recta', straight(700)),
  makePiece('straight_xl', 'recta', straight(950)),

  // --- Curvas por radio/ángulo, de más abierta a más cerrada ---
  // Kink: bend levísimo, se toma plano (radio grande, ~26°).
  makePiece('kink_L', 'kink', arc(250, -26)),
  makePiece('kink_R', 'kink', arc(250, 26)),
  // Sweeper largo: curva rápida de radio muy grande (~88°).
  makePiece('sweep_L', 'curva_amplia', arc(500, -88)),
  makePiece('sweep_R', 'curva_amplia', arc(500, 88)),
  // Curva amplia (radio grande, ~70°).
  makePiece('wide_L', 'curva_amplia', arc(340, -70)),
  makePiece('wide_R', 'curva_amplia', arc(340, 70)),
  // Bend: curva media abierta (~52°).
  makePiece('bend_L', 'curva', arc(200, -52)),
  makePiece('bend_R', 'curva', arc(200, 52)),
  // Corner: 90° de radio medio.
  makePiece('corner_L', 'curva', arc(165, -90)),
  makePiece('corner_R', 'curva', arc(165, 90)),
  // Tight: 90° cerrada.
  makePiece('tight_L', 'curva_cerrada', arc(125, -90)),
  makePiece('tight_R', 'curva_cerrada', arc(125, 90)),
  // Hook: curva de más de 90° (120°), muy cerrada.
  makePiece('hook_L', 'curva_cerrada', arc(95, -120)),
  makePiece('hook_R', 'curva_cerrada', arc(95, 120)),
  // Horquilla: U de ~180°.
  makePiece('hairpin_L', 'horquilla', arc(120, -175)),
  makePiece('hairpin_R', 'horquilla', arc(120, 175)),

  // --- Chicanes = S limpia (2 arcos, izq+der). Desplazamiento lateral mayor
  //     que el hueco de carril: NO se pueden trazar en recta. ---
  // Rápida (fluida, radio 150).
  makePiece('chicane_fast_LR', 'chicane', chain(arc(150, -46), arc(150, 46))),
  makePiece('chicane_fast_RL', 'chicane', chain(arc(150, 46), arc(150, -46))),
  // Normal (radio 100).
  makePiece('chicane_LR', 'chicane', chain(arc(100, -62), arc(100, 62))),
  makePiece('chicane_RL', 'chicane', chain(arc(100, 62), arc(100, -62))),
  // Cerrada (radio 70, más brusca): castiga entrar rápido.
  makePiece('chicane_sharp_LR', 'chicane', chain(arc(70, -82), arc(70, 82))),
  makePiece('chicane_sharp_RL', 'chicane', chain(arc(70, 82), arc(70, -82))),
];

// Piezas "de cierre" para los circuitos CERRADOS (ver más abajo, sección
// CLOSED_COMBOS) — rectas/curva con longitud y ángulo EXACTOS resueltos por
// separado para que cada circuito cierre sin costura. Van en BANK (no en un
// array aparte) porque `assemble()`/`byId`, más abajo, solo conocen las
// piezas que estén aquí en el momento de construirse — deben entrar ANTES de
// esa línea, no al final del archivo.
// Recta "de cierre" partida en tramos cortos con chicanes suaves (radio 150,
// 46°) intercaladas — en vez de una única recta enorme. JC, tras probar la
// primera versión: "el circuito tiene dos rectas enormes, hay que
// eliminarlas". Una chicane no cambia el rumbo neto (sale a 0°, igual que una
// recta), así que esto NO afecta al cierre del circuito — solo rompe la
// monotonía de la recta. `numChicanes` es fijo por sitio (no depende de
// `len`): estos valores ya sólo SE APLICAN, no se resuelven aquí — la
// longitud total y el nº de chicanes se decidieron en el solver offline
// (mismo motivo que arriba: si el nº de chicanes cambiara con la longitud a
// resolver, el sistema lineal del solver habría dado un resultado distinto).
function closingStraight(len, numChicanes) {
  if (numChicanes <= 0) return straight(len);
  const segLen = len / (numChicanes + 1);
  const segs = [straight(segLen)];
  for (let i = 0; i < numChicanes; i++) {
    segs.push(arc(150, i % 2 === 0 ? -46 : 46), arc(150, i % 2 === 0 ? 46 : -46), straight(segLen));
  }
  return chain(...segs);
}

const CLOSED_BANK = [
  // 1. Herradura
  makePiece('c1_a', 'recta_cierre', closingStraight(1403.055371143598, 4)),
  makePiece('c1_b', 'recta_cierre', closingStraight(1452.1528938793317, 4)),
  makePiece('c1_trim', 'curva_ajuste', arc(300, 107.99999999999991)),
  // 2. Abanico
  makePiece('c2_a', 'recta_cierre', closingStraight(821.3490639156203, 1)),
  makePiece('c2_b', 'recta_cierre', closingStraight(2050.2546195331697, 7)),
  makePiece('c2_trim', 'curva_ajuste', arc(300, 99.19378881987572)),
  // 3. Serpiente
  makePiece('c3_a', 'recta_cierre', closingStraight(1667.3670576613383, 4)),
  makePiece('c3_b', 'recta_cierre', closingStraight(1579.8245050343537, 4)),
  makePiece('c3_trim', 'curva_ajuste', arc(300, 107.99999999999989)),
  // 4. Tenedor
  makePiece('c4_a', 'recta_cierre', closingStraight(1240.2974216610019, 3)),
  makePiece('c4_b', 'recta_cierre', closingStraight(1220.4445980950481, 4)),
  makePiece('c4_trim', 'curva_ajuste', arc(300, 98.12698412698407)),
  // 5. Zigzag (ya cortas de por sí, sin chicane)
  makePiece('c5_a', 'recta_cierre', closingStraight(249.12835298928874, 0)),
  makePiece('c5_b', 'recta_cierre', closingStraight(492.84652220493234, 0)),
  makePiece('c5_trim', 'curva_ajuste', arc(250, -41.481481481481325)),
  // 6. Nudo
  makePiece('c6_a', 'recta_cierre', closingStraight(1509.7376488549394, 3)),
  makePiece('c6_b', 'recta_cierre', closingStraight(425.2014716067197, 0)),
  makePiece('c6_trim', 'curva_ajuste', arc(250, 20.571428571428413)),
  // 7. Ola
  makePiece('c7_a', 'recta_cierre', closingStraight(885.8404719537644, 1)),
  makePiece('c7_b', 'recta_cierre', closingStraight(1683.9729841297828, 5)),
  makePiece('c7_trim', 'curva_ajuste', arc(300, 83.71052631578945)),
  // 8. Trébol
  makePiece('c8_a', 'recta_cierre', closingStraight(1250.2216564426449, 2)),
  makePiece('c8_b', 'recta_cierre', closingStraight(1318.4640625357697, 3)),
  makePiece('c8_trim', 'curva_ajuste', arc(300, 107.99999999999991)),
];
BANK.push(...CLOSED_BANK);

const byId = Object.fromEntries(BANK.map((p) => [p.id, p]));

// ---- Combinador: monta la línea central encajando piezas -------------------
// Devuelve [{ x, y, w }] en unidades de mundo (w = medio ancho de carril).
// El ancho es UNIFORME para todo el circuito (o todo ancho o todo estrecho,
// nunca mezclado): `half` lo fija por combo. Si no se pasa, usa el de la pieza.
export function assemble(ids, half) {
  const out = [];
  const halfW = [];
  const pieceType = []; // tipo de la pieza de origen de cada punto (ver Game.js, diagnóstico)
  let pose = { x: 0, y: 0, angle: 0 };
  for (const id of ids) {
    const p = byId[id];
    if (!p) throw new Error('Pieza desconocida: ' + id);
    const placed = placePoints(p.points, pose);
    const ww = half != null ? half : p.width / 2;
    // Se salta el primer punto (comparte junta con la pieza anterior).
    for (let i = out.length ? 1 : 0; i < placed.length; i++) {
      out.push(placed[i]);
      halfW.push(ww);
      pieceType.push(p.type);
    }
    pose = transformPose(p.exit, pose);
  }
  return out.map((pt, i) => ({ x: pt.x, y: pt.y, w: halfW[i], type: pieceType[i] }));
}

// ---- Combinaciones de prueba ("circuitos del día") -------------------------
// La idea es que cada día se juegue un circuito distinto. Estos 4 son de
// prueba: TODOS exigentes (banda técnico-retorcido), variando el TIPO de reto,
// no la dificultad ni la duración. ~37-46 s conduciendo limpio (validado), sin
// atajos ni saltos en las uniones. Marchan en una dirección general para no
// cruzarse consigo mismos.
const dogR = ['tight_R', 'straight_m', 'tight_L']; // jog cerrado: neto 0, avanza
const rep = (block, n) => Array.from({ length: n }, () => block).flat();
const WIDE = 52; // medio ancho normal (= CONFIG.TRACK_WIDTH/2)
const NARROW = 40; // medio ancho de pista estrecha
// Canal de los circuitos CERRADOS del Grand Prix: "un pelín más estrecho"
// que el normal, pedido explícito de JC tras probar el primero (52→46, unas
// líneas más abajo en CLOSED_COMBOS) — no toca WIDE/NARROW de los combos de
// siempre.
const GP_CLOSED_HALF = 46;

export const COMBOS = {
  eses: {
    name: 'Eses',
    desc: 'Chicanes encadenadas a ritmo. Técnico.',
    half: WIDE,
    pieces: [...rep(['chicane_LR', 'straight_s', 'chicane_RL', 'straight_s', ...dogR, 'straight_s'], 5), 'chicane_LR', 'straight_s'],
  },
  navaja: {
    name: 'Navaja',
    desc: 'Chicanes muy cerradas: castiga entrar rápido.',
    half: WIDE,
    pieces: [...rep(['chicane_sharp_LR', 'straight_s', 'chicane_sharp_RL', 'straight_s', ...dogR, 'straight_s'], 5), 'chicane_sharp_RL', 'straight_s'],
  },
  quebrado: {
    name: 'Quebrado',
    desc: 'Curvas cerradas y jogs, sin recta para respirar.',
    half: WIDE,
    pieces: [...rep(['tight_R', 'straight_s', 'tight_L', 'straight_s', 'chicane_LR', 'straight_s', ...dogR], 4), 'tight_R', 'straight_s', 'tight_L'],
  },
  ratonera: {
    name: 'Ratonera',
    desc: 'Pista estrecha de principio a fin. Sin margen.',
    half: NARROW,
    pieces: [...rep(['chicane_LR', 'straight_s', 'chicane_RL', 'straight_s', ...dogR, 'straight_s'], 5), 'chicane_LR', 'straight_s'],
  },
};

// Orden para el selector.
export const COMBO_LIST = ['eses', 'navaja', 'quebrado', 'ratonera'];

// Monta el objeto de circuito completo listo para el juego.
export function buildCombo(comboId) {
  const combo = COMBOS[comboId];
  const centerline = assemble(combo.pieces, combo.half);
  return buildTrackFromCenterline(centerline);
}

// ============================================================================
//  CIRCUITOS CERRADOS (2026-09-07) — contenido para el modo Grand Prix de 3
//  vueltas. A diferencia de COMBOS (punta a punta, salida y meta nunca
//  coinciden), estos SÍ cierran sobre sí mismos: el último punto vuelve a
//  conectar con el primero, en posición Y en rumbo, sin costura visible.
//
//  Por qué hacen falta piezas nuevas: `arc()` discretiza cada curva en pasos
//  de ~9°, así que el ángulo de salida REAL de una pieza no es exactamente su
//  turnDeg nominal (p.ej. corner_R, "90°" nominal, sale en 85.5° real). Para
//  un combo abierto esto es invisible; para uno cerrado, si no se corrige, dos
//  giros no encajan y queda un salto justo en la costura. Cada circuito de
//  aquí abajo lleva:
//   - DOS rectas "de cierre" (`c<N>_a` / `c<N>_b`) con la longitud EXACTA que
//     hace falta para que la posición cierre en (0,0).
//   - UNA curva "de ajuste" (`c<N>_trim`) con el ángulo EXACTO que hace falta
//     para que el rumbo cierre en 0° (sin ella, discretización + curvas
//     nominales redondas casi nunca suman 360° justos).
//  Todo resuelto numéricamente (sistema lineal para las rectas, bisección
//  para el ángulo) y verificado por separado: cierre exacto (distancia y
//  ángulo ~0), sin auto-solape (hueco mínimo entre tramos no contiguos muy
//  por encima del ancho de canal) y duración estimada (longitud/MAX_SPEED,
//  cota superior sin frenazos) en la franja pedida. Sin rectas largas
//  (straight_l/xl) en ninguno, a petición explícita — la longitud la dan las
//  curvas, chicanes y horquillas, no tramos rectos.
//
//  OJO — falta la otra mitad para que esto sea jugable: `Game.js` asume hoy
//  un trazado ABIERTO (nearestOnPolyline no "envuelve" la búsqueda al cruzar
//  la costura, y la meta se comprueba desde el frame 0). Esta sección solo
//  monta el CONTENIDO; el soporte de vuelta cerrada en el motor es trabajo
//  aparte, todavía no hecho.
// ============================================================================

export const CLOSED_COMBOS = {
  herradura: {
    name: 'Herradura',
    desc: 'Rectángulo redondeado con 3 chicanes y una horquilla en switchback.',
    half: GP_CLOSED_HALF,
    closed: true,
    pieces: [
      'c1_a', 'corner_R', 'straight_s', 'chicane_LR', 'straight_m', 'chicane_RL', 'straight_m',
      'corner_R', 'straight_m', 'chicane_LR', 'straight_m',
      'hairpin_L', 'straight_m', 'hairpin_R',
      'straight_m', 'chicane_RL', 'straight_m', 'chicane_LR', 'straight_s',
      'corner_R', 'c1_b', 'c1_trim',
    ],
  },
  abanico: {
    name: 'Abanico',
    desc: 'El más rápido y fluido: curvas amplias (sweep/wide/hook), una sola chicane.',
    half: GP_CLOSED_HALF,
    closed: true,
    pieces: [
      'c2_a', 'sweep_R', 'straight_m', 'straight_m', 'straight_m', 'straight_m',
      'chicane_fast_LR', 'straight_m',
      'wide_R', 'straight_m', 'straight_m', 'straight_m', 'straight_m',
      'hook_R', 'c2_b', 'c2_trim',
    ],
  },
  serpiente: {
    name: 'Serpiente',
    desc: 'Forma no convexa (mezcla de giros L/R) con 2 chicanes cerradas y una horquilla.',
    half: GP_CLOSED_HALF,
    closed: true,
    pieces: [
      'c3_a', 'tight_R', 'straight_s', 'chicane_sharp_LR', 'straight_m', 'straight_m',
      'tight_R', 'straight_m', 'tight_L', 'straight_m', 'straight_m',
      'hairpin_R', 'straight_m', 'hairpin_L',
      'straight_m', 'tight_R', 'straight_s', 'chicane_sharp_RL', 'straight_m', 'straight_m',
      'tight_R', 'c3_b', 'c3_trim',
    ],
  },
  tenedor: {
    name: 'Tenedor',
    desc: 'Horquilla en switchback + 2 bend + curvas cerradas, sin chicanes.',
    half: GP_CLOSED_HALF,
    closed: true,
    pieces: [
      'c4_a', 'tight_R', 'straight_m', 'straight_m', 'bend_R', 'straight_m',
      'tight_R', 'straight_m', 'tight_L', 'straight_m', 'straight_m',
      'hairpin_L', 'straight_m', 'hairpin_R',
      'straight_m', 'straight_m', 'bend_R', 'straight_m',
      'tight_R', 'c4_b', 'c4_trim',
    ],
  },
  zigzag: {
    name: 'Zigzag',
    desc: 'Muchas curvas pequeñas encadenadas (kink/bend) — el más técnico y nervioso.',
    half: GP_CLOSED_HALF, // (el radio 250 es solo del TRIM, no del canal)
    closed: true,
    pieces: [
      'corner_R', 'straight_m', 'straight_m', 'kink_R', 'straight_m', 'bend_R', 'straight_m', 'straight_m', 'straight_m',
      'c5_a',
      'corner_R', 'straight_m', 'straight_m', 'chicane_LR', 'straight_m', 'chicane_RL', 'straight_m', 'straight_m', 'straight_m',
      'corner_R', 'straight_m', 'straight_m', 'kink_R', 'straight_m', 'bend_R', 'straight_m', 'straight_m', 'straight_m',
      'c5_b', 'c5_trim',
    ],
  },
  nudo: {
    name: 'Nudo',
    desc: 'El más exigente: chicanes cerradas encadenadas sin apenas respiro.',
    half: GP_CLOSED_HALF,
    closed: true,
    pieces: [
      'c6_a', 'tight_R', 'straight_s', 'chicane_sharp_LR', 'straight_m', 'chicane_sharp_RL', 'straight_m', 'straight_m',
      'tight_R', 'straight_m', 'chicane_LR', 'straight_m', 'chicane_RL', 'straight_m', 'straight_m', 'straight_s',
      'tight_R', 'straight_m', 'chicane_sharp_LR', 'straight_m', 'chicane_sharp_RL', 'straight_m', 'straight_m',
      'tight_R', 'c6_b', 'c6_trim',
    ],
  },
  ola: {
    name: 'Ola',
    desc: 'Contravirajes amplios (sweep izq/dcha) con una única chicane rápida.',
    half: GP_CLOSED_HALF,
    closed: true,
    pieces: [
      'c7_a', 'sweep_R', 'straight_m', 'wide_R', 'straight_m', 'sweep_L', 'straight_m', 'sweep_R', 'straight_m',
      'chicane_fast_LR', 'straight_s',
      'wide_R', 'straight_m', 'wide_R', 'c7_b', 'c7_trim',
    ],
  },
  trebol: {
    name: 'Trébol',
    desc: 'Una horquilla + 2 chicanes de radios distintos sobre un rectángulo redondeado.',
    half: GP_CLOSED_HALF,
    closed: true,
    pieces: [
      'c8_a', 'corner_R', 'straight_s', 'chicane_fast_LR', 'straight_m', 'straight_m',
      'hairpin_L', 'straight_m', 'hairpin_R', 'straight_m', 'straight_m',
      'corner_R', 'straight_m', 'chicane_RL', 'straight_m', 'chicane_LR', 'straight_m', 'straight_m',
      'corner_R', 'c8_b', 'c8_trim',
    ],
  },
};

export const CLOSED_COMBO_LIST = ['herradura', 'abanico', 'serpiente', 'tenedor', 'zigzag', 'nudo', 'ola', 'trebol'];

// Monta un circuito CERRADO. Devuelve el track normal MÁS `lapLength` (la
// longitud de una vuelta, en unidades de mundo) — de momento no hace nada
// especial con la costura (eso es el trabajo de motor pendiente, ver el
// comentario de arriba): buildTrackFromCenterline coloca la meta en el último
// punto tal cual, que aquí cae prácticamente encima de la salida.
//
// `laps` (por defecto 3, el formato del Grand Prix): en vez de enseñarle al
// motor un concepto nuevo de "vuelta", se concatena la MISMA vuelta cerrada
// `laps` veces seguidas (saltando el punto duplicado de cada costura, igual
// que `assemble()` ya hace entre piezas) — el resultado es un trazado
// abierto de punta a punta como cualquier otro, con la salida al principio y
// la META al final de la 3.ª vuelta. Como el circuito cierra EXACTO (mismo
// punto y mismo rumbo, verificado al generarlo), la costura entre una vuelta
// y la siguiente es indistinguible de cualquier otra unión de piezas — así
// que `nearestOnPolyline`/la detección de meta de `Game.js` (pensadas para un
// trazado abierto) funcionan tal cual, SIN tocar ni una línea del motor: la
// única meta real es la del final, las dos costuras intermedias son un punto
// de paso más. `SECTOR_COUNT` (3, fijo en Game.js) reparte el HUD de
// sectores en 3 tramos iguales — con `laps=3` sobre un circuito de longitud
// uniforme, cada sector cae EXACTO en una vuelta, así que el "SECTOR 1/3" ya
// existente hace de "VUELTA 1/3" sin más cambios.
export function buildClosedCombo(comboId, laps = 3) {
  const combo = CLOSED_COMBOS[comboId];
  const oneLap = assemble(combo.pieces, combo.half);
  const centerline = [...oneLap];
  for (let lap = 1; lap < laps; lap++) {
    for (let i = 1; i < oneLap.length; i++) centerline.push(oneLap[i]);
  }
  const track = buildTrackFromCenterline(centerline);
  track.closed = true;
  track.laps = laps;
  track.lapLength = oneLap.reduce((acc, p, i) => {
    if (i === 0) return 0;
    const prev = oneLap[i - 1];
    return acc + Math.hypot(p.x - prev.x, p.y - prev.y);
  }, 0);
  return track;
}

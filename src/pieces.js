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
const byId = Object.fromEntries(BANK.map((p) => [p.id, p]));

// ---- Combinador: monta la línea central encajando piezas -------------------
// Devuelve [{ x, y, w }] en unidades de mundo (w = medio ancho de carril).
// El ancho es UNIFORME para todo el circuito (o todo ancho o todo estrecho,
// nunca mezclado): `half` lo fija por combo. Si no se pasa, usa el de la pieza.
export function assemble(ids, half) {
  const out = [];
  const halfW = [];
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
    }
    pose = transformPose(p.exit, pose);
  }
  return out.map((pt, i) => ({ x: pt.x, y: pt.y, w: halfW[i] }));
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

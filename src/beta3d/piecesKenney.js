// ============================================================================
//  piecesKenney — banco de piezas para la Fase 2 del plan de evaluación 3D
//  (ver C:\Users\JC\.claude\plans\ticklish-dazzling-wand.md).
//
//  MISMO patrón que src/pieces.js (línea central local, entrada en (0,0) con
//  rumbo +x, `assemble()` encadena por pose) pero con radios/longitudes que
//  coinciden con las piezas FÍSICAS reales del kit de Kenney en vez de los
//  valores pensados para el SVG de hoy. No se toca pieces.js — es un banco
//  aparte, deliberadamente pequeño (solo lo que hace falta para una pista de
//  prueba fija), no el generador diario.
//
//  Medidas (leídas del propio .glb, min/max de los accessors POSITION — ver
//  el comentario de la Fase 2 en el plan): canal de ancho 2.0, muro alto 0.3,
//  recta de 4.0 de largo nominal (con 0.2 de solape en cada junta, para que
//  no se vea la costura entre piezas). Las curvas ('corner-small'/'corner-
//  large') son giros de 90°: el radio se dedujo de dónde cae el borde
//  exterior de la malla real (medido con el mismo solape de 0.2) — 2.0 para
//  la pequeña, 4.0 para la grande (números redondos, y el doble exacto entre
//  ellas, lo que da confianza en que el cálculo es correcto).
// ============================================================================

const KENNEY_WIDTH = 2.0; // ancho de canal del kit — MISMO valor que usa el 3D para posicionar las piezas
const KENNEY_STRAIGHT_LEN = 4.0;
const KENNEY_CORNER_SMALL_R = 2.0;
const KENNEY_CORNER_LARGE_R = 4.0;

function straight(len) {
  return [{ x: 0, y: 0 }, { x: len, y: 0 }];
}

// Copia exacta de arc() en pieces.js — mismo contrato (rumbo de entrada 0,
// salida = turnDeg), solo repetido aquí para no importar de pieces.js (ese
// archivo es del generador diario, este banco es 100% independiente).
function arc(radius, turnDeg) {
  const total = (turnDeg * Math.PI) / 180;
  const s = Math.sign(total) || 1;
  const phi = Math.abs(total);
  const steps = Math.max(4, Math.ceil(phi / (Math.PI / 20)));
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
  return points.map((p) => ({ x: pose.x + p.x * c - p.y * s, y: pose.y + p.x * s + p.y * c }));
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

// El ángulo de entrada/salida es EXACTO (analítico), no derivado del chord
// entre los dos últimos puntos discretizados de arc(): ese chord da la
// tangente en el PUNTO MEDIO del último tramo, no en el extremo real — con
// ~9°/paso eso son ~4.5° de error por curva. Para una recta da igual (el
// chord ES la dirección exacta), pero para un óvalo de piezas RÍGIDAS
// encadenadas ese error se acumula pieza a pieza y el circuito no cierra
// (comprobado: con el chord, un óvalo de 4 giros de 90° cerraba con un
// desfase de 18° y ~0.9 unidades — con el ángulo analítico, cierra exacto).
function makePiece(id, glb, points, width, entryAngle, exitAngle) {
  const n = points.length;
  return {
    id,
    glb, // nombre del asset .glb a instanciar en la escena 3D
    width,
    points,
    entry: { x: points[0].x, y: points[0].y, angle: entryAngle },
    exit: { x: points[n - 1].x, y: points[n - 1].y, angle: exitAngle },
  };
}

export const KENNEY_BANK = [
  makePiece('straight', 'track-straight', straight(KENNEY_STRAIGHT_LEN), KENNEY_WIDTH, 0, 0),
  // "_L": gira hacia -y en la convención de arc() de arriba — ver Beta3D.js
  // para cómo se traduce ese signo a una rotación de verdad en la escena 3D.
  makePiece('corner_small_L', 'track-corner-small', arc(KENNEY_CORNER_SMALL_R, -90), KENNEY_WIDTH, 0, (-90 * Math.PI) / 180),
];

const byId = Object.fromEntries(KENNEY_BANK.map((p) => [p.id, p]));

// Mismo contrato que assemble() en pieces.js, pero devuelve TAMBIÉN la pose
// de cada pieza colocada (posición+ángulo de su punto de entrada en el
// mundo) — la física solo necesita el centerline, pero el render 3D
// necesita saber además QUÉ modelo va en cada sitio y con qué transform.
export function assembleBeta(ids) {
  const center = [];
  const placements = [];
  let pose = { x: 0, y: 0, angle: 0 };
  for (const id of ids) {
    const p = byId[id];
    if (!p) throw new Error('Pieza beta desconocida: ' + id);
    placements.push({ id, glb: p.glb, pose: { ...pose } });
    const placed = placePoints(p.points, pose);
    for (let i = center.length ? 1 : 0; i < placed.length; i++) {
      center.push({ x: placed[i].x, y: placed[i].y, w: p.width / 2, type: p.id });
    }
    pose = transformPose(p.exit, pose);
  }
  return { center, placements, endPose: pose };
}

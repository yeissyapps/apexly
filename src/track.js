// ============================================================================
//  TRACK — Geometría del circuito a partir de una LÍNEA CENTRAL.
//
//  Ya no hay un trazado fijo: el circuito se monta con piezas (ver pieces.js),
//  que producen una línea central de puntos { x, y, w } en unidades de mundo
//  (w = medio ancho de carril en ese punto; puede variar por pieza).
//
//  Esta función deriva de esa línea central todo lo que necesita el juego:
//  bordes, polígono de asfalto, pose de salida, meta y línea de salida. La
//  colisión (en App.js) usa la propia línea central + su w por punto.
// ============================================================================

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}
function norm(v) {
  const m = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / m, y: v.y / m };
}

// center: [{ x, y, w }]  (w = medio ancho de carril en ese punto)
export function buildTrackFromCenterline(center) {
  const left = [];
  const right = [];
  const tangents = [];
  for (let i = 0; i < center.length; i++) {
    const prev = center[Math.max(0, i - 1)];
    const next = center[Math.min(center.length - 1, i + 1)];
    const t = norm(sub(next, prev)); // tangente
    tangents.push(t);
    const n = { x: -t.y, y: t.x }; // normal (perpendicular)
    const w = center[i].w;
    left.push({ x: center[i].x + n.x * w, y: center[i].y + n.y * w });
    right.push({ x: center[i].x - n.x * w, y: center[i].y - n.y * w });
  }

  // Polígono del asfalto (borde izq. de ida + borde der. de vuelta).
  const roadPolygon = [...left, ...right.slice().reverse()];

  // Pose de salida: primer punto, mirando hacia el segundo.
  const startPose = {
    x: center[0].x,
    y: center[0].y,
    heading: Math.atan2(tangents[0].y, tangents[0].x),
  };

  // Meta: perpendicular en el último punto + su tangente (para el cruce).
  const last = center.length - 1;
  const finish = {
    a: left[last],
    b: right[last],
    point: { x: center[last].x, y: center[last].y },
    tangent: tangents[last],
  };

  const startLine = { a: left[0], b: right[0] };

  return { center, left, right, roadPolygon, startPose, finish, startLine };
}

// ============================================================================
//  Fecha del día. El circuito del día se GENERA a partir de esta clave (ver
//  src/generator.js): mismo día -> mismo circuito para todos, distinto cada día.
// ============================================================================

// Fecha local en formato YYYY-MM-DD.
export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Desplaza una clave de día en `delta` días (p. ej. -1 = ayer).
export function dayOffset(dayKey, delta) {
  const d = new Date(dayKey + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  return todayKey(d);
}

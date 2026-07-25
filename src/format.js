// Formato de tiempos.

// mm:ss.cc  o  ss.cc
export function fmt(ms) {
  const total = Math.max(0, ms) / 1000;
  const cc = Math.floor((total % 1) * 100)
    .toString()
    .padStart(2, '0');
  const s = Math.floor(total) % 60;
  const m = Math.floor(total / 60);
  if (m > 0) return `${m}:${s.toString().padStart(2, '0')}.${cc}`;
  return `${s}.${cc}`;
}

// Segundos con 2 decimales (para diferencias: "0.40").
export function fmtSecs(ms) {
  return (Math.max(0, ms) / 1000).toFixed(2);
}

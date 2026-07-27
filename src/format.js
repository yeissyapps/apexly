// Formato de tiempos.

// Crono EN VIVO (HUD): mm:ss.cc o ss.cc, sin sufijo (cambia cada frame).
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

// Tiempo DEFINITIVO (resultado, ranking, mejor): milésimas + "s".
// Las milésimas evitan empates visuales cuando muchos comparten centésima.
export function fmtTime(ms) {
  const total = Math.max(0, ms) / 1000;
  const mmm = Math.floor((total % 1) * 1000)
    .toString()
    .padStart(3, '0');
  const s = Math.floor(total) % 60;
  const m = Math.floor(total / 60);
  if (m > 0) return `${m}:${s.toString().padStart(2, '0')}.${mmm}s`;
  return `${s}.${mmm}s`;
}

// Segundos con 3 decimales, sin "s" (para diferencias: "0.404").
export function fmtSecs(ms) {
  return (Math.max(0, ms) / 1000).toFixed(3);
}

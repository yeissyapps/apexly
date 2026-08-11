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

// Gap al líder, estilo pantalla de tiempos F1 ("+1.284"). Líder (o sin gap
// todavía) -> "Líder", nunca un "+0.000" raro.
export function fmtGap(ms) {
  if (ms == null || ms <= 0) return 'Líder';
  return `+${fmtSecs(ms)}`;
}

// Cuenta atrás legible ("2h 14min" / "38 min"). Compartida por
// useMidnightCountdown (App.js) y useCountdownTo (GrandPrix.js) — mismo
// formato para la cuenta atrás del diario y la del Grand Prix.
export function fmtCountdown(ms) {
  const totalMin = Math.max(0, Math.ceil(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}min` : `${m} min`;
}

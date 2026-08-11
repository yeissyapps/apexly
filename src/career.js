// ============================================================================
//  Modo Carrera — helpers compartidos entre App.js (que juega el nivel a
//  pantalla completa, como el circuito diario) y CareerMode.js (la lista).
//  Un solo sitio para el cálculo del gap-time: cliente y "servidor de
//  confianza" (el propio cliente valida antes de llamar a la RPC) tienen que
//  usar EXACTAMENTE la misma fórmula.
// ============================================================================

import { tieredCircuit } from './generator';
import { weatherById } from './weather';

export const LEVEL_COUNT = 30;
export const CAREER_AD_BATCH = 3; // un anuncio en Carrera da más intentos que en el diario (3 vs 1): el nivel es tuyo, no un cupo compartido de todo el día

const tierOf = (n) => (n - 1) / (LEVEL_COUNT - 1);

// Mismo generador determinista que el circuito diario, sembrado por nivel en
// vez de por fecha, pero con dificultad progresiva por TIER (0..1): ancho,
// peso de cada tipo de sección y sesgo hacia horquilla real suben con `n` —
// no solo el gap-time (ver `tieredCircuit` en generator.js).
export function levelSpec(n) {
  return tieredCircuit('career-' + n, tierOf(n));
}

// Clima del nivel: progresivo igual que el resto — despejado en los
// primeros, hasta lluvia (la condición que más cuesta de manejar, volante
// más impreciso + menos velocidad punta) en los últimos.
export function weatherForLevel(n) {
  const t = tierOf(n);
  if (t < 0.25) return weatherById('clear');
  if (t < 0.5) return weatherById('dry');
  if (t < 0.75) return weatherById('wind');
  return weatherById('rain');
}

// Calibrado con tiempos reales de JC: en la escalera de 10 niveles su vuelta
// limpia caía prácticamente EN `timeEstimate` (ratio ~0.99-1.01), no muy por
// debajo — o sea que el margen de sobra no viene de que el estimado sea
// blando, viene del propio margen. 8% en el nivel 1 -> -10% en el último: el
// primero se pasa con una vuelta limpia sin más, el último exige batir la
// vuelta "media" por margen real. La curva es la misma de siempre — al pasar
// a 30 niveles el nivel 15 cae casi en el mismo punto relativo (t≈0.48) que
// el nivel 5 de la escalera de 10 (t≈0.44) donde JC se quedó atascado, así
// que sigue siendo la referencia validada.
export function gapMsFor(n, timeEstimateSec) {
  const margin = 1.08 - tierOf(n) * 0.18;
  return Math.round(timeEstimateSec * margin * 1000);
}

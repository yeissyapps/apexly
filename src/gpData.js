// ============================================================================
//  Grand Prix — helpers compartidos, mismo rol que career.js: un solo sitio
//  para la generación de circuitos/clima (deterministas por semilla) y el
//  cálculo de puntos, para que cliente y servidor (que valida antes de la
//  RPC) usen exactamente los mismos criterios.
//
//  NOTA de nombre: este archivo se llamaba src/grandprix.js, pero en Windows
//  (NTFS, case-insensitive) eso colisiona con src/GrandPrix.js (el archivo de
//  pantallas) — el segundo Write pisó al primero sin avisar. Se renombra a
//  gpData.js para que no puedan volver a chocar.
// ============================================================================

import { tieredCircuit } from './generator';
import { dailyWeather } from './weather';

export function gpSeed(gpId, dayIndex) {
  return 'gp-' + gpId + '-' + dayIndex;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Ronda "de hoy" a partir de started_at — no medianoche, la hora EXACTA en
// que arrancó el GP (JC: "si se arranca un lunes a las 12:15, todos los días
// aparece circuito nuevo a las 12:15"). 1-indexado, con tope en circuit_count.
export function currentRoundIndex(gp) {
  if (!gp) return null;
  const elapsed = Date.now() - new Date(gp.started_at).getTime();
  const idx = Math.floor(elapsed / DAY_MS) + 1;
  return Math.max(1, Math.min(gp.circuit_count, idx));
}

// Cuándo abre la SIGUIENTE ronda (para la cuenta atrás) — null si ya se jugó
// la última.
export function nextRoundUnlockAt(gp) {
  if (!gp) return null;
  const idx = currentRoundIndex(gp);
  if (idx >= gp.circuit_count) return null;
  return new Date(gp.started_at).getTime() + idx * DAY_MS;
}

// El GP termina cuando pasan circuit_count días desde el arranque (aunque el
// campo `status` del servidor tarde en marcarlo 'finished' — el cron lo hace
// cada 15 min, esto es la verdad inmediata en cliente).
export function gpFinished(gp) {
  if (!gp) return false;
  return Date.now() >= new Date(gp.started_at).getTime() + gp.circuit_count * DAY_MS;
}

// Un anuncio en el GP da más intentos que en el diario — mismo razonamiento
// que Carrera (CAREER_AD_BATCH): la ronda es del grupo, no un cupo diario
// compartido con nadie más.
export const GP_AD_BATCH = 3;

// Rampa de dificultad MÁS SUAVE que Modo Carrera (t 0.2 -> 0.6, no 0 -> 1):
// un GP es un evento de una semana entre amigos, no una escalera de progreso
// — la ronda 1 tiene que ser accesible el primer día y la 7 tener más mordida,
// sin llegar a los tiers más duros que sí tiene sentido reservar para Carrera.
export function gpCircuitSpec(gpId, dayIndex, circuitCount = 7) {
  const tt = (dayIndex - 1) / Math.max(1, circuitCount - 1);
  const t = 0.2 + 0.4 * tt;
  return tieredCircuit(gpSeed(gpId, dayIndex), t);
}

// Clima determinista por ronda (misma semilla que el circuito, distinta
// función) — variedad gratis, sin generador propio.
export function gpWeather(gpId, dayIndex) {
  return dailyWeather(gpSeed(gpId, dayIndex));
}

// Nombre de ronda con carácter, reutilizando la etiqueta que ya calcula el
// generador (Horquillas/Chicanes/Técnico/...) en vez de "Circuito 3" a secas.
export function roundLabel(dayIndex, spec) {
  return `Ronda ${dayIndex} · ${spec.label}`;
}

// Tabla de puntos F1 estándar. Solo puntúan las 10 primeras posiciones —
// igual que la F1 real con más de 10 pilotos, así que un grupo de 5 usa solo
// los 5 primeros escalones y uno de 12+ dos se quedan sin puntuar, sin que
// haga falta reescalar nada según el tamaño del grupo.
export const F1_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

// Agrega resultados crudos (de getGpResults) en la general del campeonato.
// `members`: [{ userId, nickname }] — TODOS los del grupo, para que aparezca
// hasta quien aún no ha clasificado ningún tiempo (con 0 puntos). Quien no
// corrió una ronda concreta simplemente no ocupa puesto ese día (JC: "cero
// puntos ese circuito", el resto se reparte solo entre quien sí clasificó).
// Devuelve un array ordenado por puntos desc: { userId, nickname, points,
// rounds: { [dayIndex]: { ms, pos, pts } } }.
export function computeStandings(results, members) {
  const byUser = new Map();
  const ensure = (userId, nickname) => {
    if (!byUser.has(userId)) byUser.set(userId, { userId, nickname, points: 0, rounds: {} });
    return byUser.get(userId);
  };
  (members || []).forEach((m) => ensure(m.userId, m.nickname));

  const byDay = new Map();
  (results || []).forEach((r) => {
    if (!byDay.has(r.dayIndex)) byDay.set(r.dayIndex, []);
    byDay.get(r.dayIndex).push(r);
  });

  for (const [dayIndex, rows] of byDay) {
    const sorted = [...rows].sort((a, b) => a.ms - b.ms);
    sorted.forEach((r, i) => {
      const pts = F1_POINTS[i] || 0;
      const u = ensure(r.userId, r.nickname);
      u.points += pts;
      u.rounds[dayIndex] = { ms: r.ms, pos: i + 1, pts };
    });
  }

  return [...byUser.values()].sort((a, b) => b.points - a.points);
}

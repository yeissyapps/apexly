// ============================================================================
//  Clima diario — condiciones atmosféricas deterministas por fecha.
//
//  Igual que el circuito: el mismo día, todos juegan el MISMO clima (justo para
//  el ranking). Semilla propia (salteada) para que clima y trazado no estén
//  correlacionados. Los efectos son SUTILES y se aplican como una capa de
//  MODIFICADORES encima de las constantes de `config.js` (nunca las editan):
//
//    steerMul  -> multiplica el tiempo de respuesta del volante (>1 = más
//                 perezoso/resbaladizo; <1 = más preciso/seco).
//    speedMul  -> multiplica la velocidad punta del día.
//    windX/Y   -> empuje lateral constante (unidades de mundo por segundo).
//
//  neutral (steerMul 1, speedMul 1, viento 0) = EXACTAMENTE igual que hoy.
// ============================================================================

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Modificador neutro (sin efecto). Se usa como fallback en el motor.
export const NEUTRAL = {
  id: 'clear', icon: '🌤️', label: 'Despejado', hint: 'condiciones neutras',
  steerMul: 1, speedMul: 1, windX: 0, windY: 0,
};

// Condiciones posibles (con peso). Efectos sutiles a propósito.
const CONDS = [
  { id: 'clear', w: 30, icon: '🌤️', label: 'Despejado', hint: 'condiciones neutras',
    steerMul: 1, speedMul: 1, wind: 0 },
  { id: 'dry',   w: 22, icon: '☀️', label: 'Seco',      hint: 'buen agarre · día rápido',
    steerMul: 0.92, speedMul: 1.03, wind: 0 },
  { id: 'rain',  w: 26, icon: '🌧️', label: 'Lluvia',    hint: 'menos agarre · cuesta afinar',
    steerMul: 1.35, speedMul: 0.96, wind: 0 },
  { id: 'wind',  w: 22, icon: '🌬️', label: 'Viento',    hint: 'te empuja de lado',
    steerMul: 1, speedMul: 1, wind: 14 },
];

// IDs de condiciones (para el selector de prueba), en orden.
export const WEATHER_IDS = CONDS.map((c) => c.id);

// Fuerza una condición concreta (para el modo de prueba). Viento con dirección
// diagonal fija para que el efecto se vea claro.
export function weatherById(id) {
  const c = CONDS.find((x) => x.id === id) || CONDS[0];
  const windX = c.wind > 0 ? c.wind * 0.7 : 0;
  const windY = c.wind > 0 ? c.wind * 0.7 : 0;
  return { id: c.id, icon: c.icon, label: c.label, hint: c.hint, steerMul: c.steerMul, speedMul: c.speedMul, windX, windY };
}

// Devuelve el clima del día: { id, icon, label, hint, steerMul, speedMul, windX, windY }.
export function dailyWeather(dateKey) {
  const rng = mulberry32(hashStr('wx:' + String(dateKey)));
  const total = CONDS.reduce((a, c) => a + c.w, 0);
  let r = rng() * total;
  let cond = CONDS[CONDS.length - 1];
  for (const c of CONDS) { if (r < c.w) { cond = c; break; } r -= c.w; }

  let windX = 0, windY = 0;
  if (cond.wind > 0) {
    const ang = rng() * Math.PI * 2;
    windX = Math.cos(ang) * cond.wind;
    windY = Math.sin(ang) * cond.wind;
  }
  return {
    id: cond.id, icon: cond.icon, label: cond.label, hint: cond.hint,
    steerMul: cond.steerMul, speedMul: cond.speedMul, windX, windY,
  };
}

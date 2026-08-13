// ============================================================================
//  Attempts — intentos diarios de carrera (economía de anuncios).
//
//  Modelo: 3 intentos gratis al día. Al agotarlos, ver un anuncio (rewarded)
//  concede un LOTE de +3 intentos. Se puede repetir. El IAP "quitar anuncios"
//  (futuro) dará intentos ilimitados sin ver anuncios — pero cualquiera puede
//  llegar a ilimitado viendo anuncios, así que el ranking sigue siendo justo.
//
//  Persistencia local por día (AsyncStorage). Un "intento" = empezar una vuelta.
// ============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';

export const FREE_ATTEMPTS = 3; // gratis al día
export const AD_BATCH = 1;       // intentos que concede cada anuncio

const key = (day) => `attempts_${day}`;

export async function loadAttempts(day) {
  try {
    const raw = await AsyncStorage.getItem(key(day));
    return raw ? JSON.parse(raw) : { used: 0, bonus: 0 };
  } catch (_) {
    return { used: 0, bonus: 0 };
  }
}

async function save(day, v) {
  try { await AsyncStorage.setItem(key(day), JSON.stringify(v)); } catch (_) {}
}

// Consume un intento (al empezar una vuelta). Devuelve el estado nuevo.
export async function consumeAttempt(day) {
  const a = await loadAttempts(day);
  a.used += 1;
  await save(day, a);
  return a;
}

// Concede un lote (tras ver un anuncio). Devuelve el estado nuevo. `amount`
// por defecto es AD_BATCH (circuito diario); Modo Carrera pasa el suyo
// propio (CAREER_AD_BATCH, en career.js) porque un anuncio ahí vale más.
export async function grantBatch(day, amount = AD_BATCH) {
  const a = await loadAttempts(day);
  a.bonus += amount;
  await save(day, a);
  return a;
}

// Intentos restantes a partir del estado { used, bonus }.
export function attemptsLeft(a) {
  return FREE_ATTEMPTS + (a?.bonus || 0) - (a?.used || 0);
}

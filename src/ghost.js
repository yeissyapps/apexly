// ============================================================================
//  Ghost — tu mejor vuelta del día guardada en el móvil (sin backend).
//
//  Traza = [[t_ms, x, y, heading], ...] muestreada durante la vuelta. Se guarda
//  la de tu mejor tiempo del día; en la siguiente vuelta persigues ese fantasma.
// ============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';

const key = (day) => `ghost_${day}`;

export async function loadGhost(day) {
  try {
    const raw = await AsyncStorage.getItem(key(day));
    return raw ? JSON.parse(raw) : null; // { ms, trace }
  } catch (_) {
    return null;
  }
}

// Guarda la traza si mejora el mejor guardado del día. Devuelve el ghost vigente.
export async function saveGhostIfBest(day, ms, trace) {
  try {
    const raw = await AsyncStorage.getItem(key(day));
    const prev = raw ? JSON.parse(raw) : null;
    if (prev && prev.ms <= ms) return prev;
    const g = { ms, trace };
    await AsyncStorage.setItem(key(day), JSON.stringify(g));
    return g;
  } catch (_) {
    return null;
  }
}

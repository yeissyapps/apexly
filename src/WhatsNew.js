// ============================================================================
//  "Qué hay de nuevo" — pop-up de UNA vez, para quien ACTUALIZA la app (no
//  para quien se la instala por primera vez: eso ya lo cuenta el Tour, ver
//  Tour.js — mostrar las dos cosas sería contar lo mismo dos veces).
//
//  Mismo patrón de persistencia que el Tour (AsyncStorage + una clave), pero
//  guardando la VERSIÓN vista, no solo un booleano: así cada versión con
//  cambios de cara al jugador puede tener su propio contenido sin arrastrar
//  el "ya lo vi" de una versión anterior.
// ============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'whatsnew:lastSeenVersion';

// La versión que se cuenta aquí — sube esto a mano cuando haya algo que
// contar de cara al jugador. Un parche sin cambios visibles no necesita
// tocar esto (y así no le sale el pop-up a nadie por él).
export const WHATS_NEW_VERSION = '2.4.6';

export const WHATS_NEW_TITLE = 'Un reto cada día';

export const WHATS_NEW_ITEMS = [
  {
    title: 'Reto del día',
    body: 'Cada día hay un reto nuevo, el mismo para todos, que vale 15 monedas: adelantar a alguien en el ranking, una vuelta récord sin tocar el muro, mejorar tus tres sectores… Lo tienes en Inicio, debajo del circuito.',
  },
  {
    title: 'Tu rival del mes',
    body: 'Algunos días el reto tiene nombre: quien va justo por delante de ti en la clasificación del mes. Haz ese día mejor tiempo y las monedas son tuyas.',
  },
];

// true si a este dispositivo le falta ver las novedades de WHATS_NEW_VERSION.
export async function shouldShowWhatsNew() {
  try {
    const seen = await AsyncStorage.getItem(KEY);
    return seen !== WHATS_NEW_VERSION;
  } catch (_) {
    return false; // sin AsyncStorage, mejor no molestar que repetir el pop-up
  }
}

export async function markWhatsNewSeen() {
  try { await AsyncStorage.setItem(KEY, WHATS_NEW_VERSION); } catch (_) {}
}

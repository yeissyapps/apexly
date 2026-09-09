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
export const WHATS_NEW_VERSION = '2.4.3';

export const WHATS_NEW_TITLE = 'Os hemos escuchado';

export const WHATS_NEW_ITEMS = [
  {
    title: 'Recuperamos la conducción de la versión anterior',
    body: 'Hemos escuchado vuestro feedback y hemos vuelto a implementar la misma conducción que en la versión anterior.',
  },
  {
    title: 'Un Grand Prix renovado',
    body: 'Circuitos cerrados y 3 vueltas seguidas. Compite con tus amigos por la vuelta rápida, por los sectores y por ser el más rápido.',
  },
  {
    title: 'Ranking mejorado',
    body: 'Ahora puedes ver el ranking completo, tanto el de hoy como el nuevo ranking del mes, donde puedes competir por más y mejores recompensas.',
  },
  {
    title: 'Carrera se muda',
    body: 'El modo Carrera ahora vive en tu Perfil, junto al Garaje y la Tienda.',
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

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

export const WHATS_NEW_ITEMS = [
  {
    title: 'Grand Prix con sectores de verdad',
    body: 'Morado y verde en vivo contra el mejor tiempo real del grupo, punto extra por vuelta rápida y podio con colores en la clasificación.',
  },
  {
    title: 'Ranking del mes',
    body: 'Puntúa cada día como en la F1 — el 50% mejor se lleva un premio grande en monedas al cerrar el mes.',
  },
  {
    title: 'Carrera se muda',
    body: 'El modo Carrera ahora vive en tu Perfil, junto al Garaje y la Tienda.',
  },
  {
    title: 'Volante más preciso',
    body: 'Vuelve a responder al instante al soltar el dedo, sin el retraso que llevaba dando la lata.',
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

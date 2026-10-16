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

import { t } from './i18n';

const KEY = 'whatsnew:lastSeenVersion';

// La versión que se cuenta aquí — sube esto a mano cuando haya algo que
// contar de cara al jugador. Un parche sin cambios visibles no necesita
// tocar esto (y así no le sale el pop-up a nadie por él).
export const WHATS_NEW_VERSION = '2.4.9';

export const whatsNewTitle = () => t('Llegan los circuitos cerrados');

export const whatsNewItems = () => [
  {
    title: t('Desde el 1 de noviembre'),
    body: t('El circuito del día pasa a ser un circuito cerrado de 2 vueltas: sales y llegas por la misma recta. Uno nuevo cada día, el mismo para todos, y la clasificación del mes arranca de cero con ellos.'),
  },
  {
    title: t('Sectores en cada vuelta'),
    body: t('Ves tus tres sectores en cada vuelta, y el morado es para la mejor pasada del día por ese tramo, sea en la vuelta que sea.'),
  },
];

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

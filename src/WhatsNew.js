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
export const WHATS_NEW_VERSION = '2.4.8';

export const whatsNewTitle = () => t('Sube al podio');

export const whatsNewItems = () => [
  {
    title: t('Tu perfil, en el podio'),
    body: t('Tu piloto, en lo más alto del podio de tu perfil, con tu puesto del mes al lado. Y en RANKING, los tres primeros del día y del mes, cada uno en su escalón.'),
  },
  {
    title: t('Vitrina'),
    body: t('Victorias, podios del mes, sectores morados y tu mejor racha, a la vista de cualquiera que entre en tu perfil.'),
  },
  {
    title: t('Circuitos con más vida'),
    body: t('Escapatorias, pianos solo en las curvas y muros de neumáticos en las curvas cerradas.'),
  },
  {
    title: t('Minimapa'),
    body: t('Durante la carrera ves el circuito entero arriba a la derecha: tú en rojo, tu fantasma en blanco y el líder en dorado.'),
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

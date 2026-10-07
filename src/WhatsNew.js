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
export const WHATS_NEW_VERSION = '2.4.7';

// Funciones y no constantes: los textos se traducen al pintar (src/i18n.js).
export const whatsNewTitle = () => t('Un reto cada día');

export const whatsNewItems = () => [
  {
    title: t('Reto del día'),
    body: t('Cada día hay un reto nuevo, el mismo para todos, que vale 15 monedas: adelantar a alguien en el ranking, una vuelta récord sin tocar el muro, mejorar tus tres sectores… Lo tienes en Inicio, debajo del circuito.'),
  },
  {
    title: t('Tu rival del mes'),
    body: t('Algunos días el reto tiene nombre: quien va justo por delante de ti en la clasificación del mes. Haz ese día mejor tiempo y las monedas son tuyas.'),
  },
  {
    title: t('Apexly en inglés'),
    body: t('La app ya se puede usar en inglés. Cámbialo cuando quieras en tu Perfil, en IDIOMA.'),
  },
  {
    title: t('1 VS 1: si no corres, pierdes'),
    body: t('Si aceptas un reto y se acaban los 15 minutos sin que corras, el bote es para tu rival.'),
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

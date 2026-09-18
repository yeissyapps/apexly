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
export const WHATS_NEW_VERSION = '2.4.4';

export const WHATS_NEW_TITLE = 'Tu piloto, tu duelo';

export const WHATS_NEW_ITEMS = [
  {
    title: 'Pilotos coleccionables',
    body: 'Se acabó montar piezas sueltas: ahora eliges un piloto entero, con su propia rareza. Del básico gratis a la leyenda, hay 14 por coleccionar.',
  },
  {
    title: 'También caen en el sobre',
    body: 'Los avatares (menos el básico) ahora salen al abrir sobres, igual que las piezas de tu coche.',
  },
  {
    title: 'Visita a otros jugadores',
    body: 'Toca el nombre de cualquiera en el ranking y entra en su perfil: su piloto, su coche, sus stats.',
  },
  {
    title: 'Duelos 1vs1',
    body: 'Reta a otro jugador desde su perfil y apuesta monedas. Corréis los dos a ciegas y al final se revela quién ha sido más rápido.',
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

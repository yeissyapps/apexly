// ============================================================================
//  Rate — petición de valoración en la tienda, en el momento adecuado.
//
//  Se usa el diálogo NATIVO (SKStoreReviewController en iOS, In-App Review de
//  Play en Android) vía expo-store-review: el usuario puntúa sin salir del
//  juego. A cambio, el sistema manda mucho:
//
//    - iOS permite como mucho 3 avisos por año y por dispositivo, y decide él
//      si lo enseña. Llamar a la API NO garantiza que aparezca.
//    - Android va por cuota de Google, y además el diálogo SOLO funciona si la
//      app se instaló desde Play. En una build de lado (adb install) la
//      llamada no hace nada — no es un fallo, es cómo funciona.
//
//  O sea que tenemos pocos disparos reales. Por eso no se pide "cuando toque"
//  sino SOLO tras un buen momento, y con freno local para no gastar cuota del
//  sistema en intentos que sabemos que sobran.
//
//  Lo que NO se hace, a propósito: preguntar antes "¿te gusta el juego?" y
//  mandar a la tienda solo a quien diga que sí. Eso es filtrar reseñas y lo
//  prohíben las normas de Apple y de Google. Se pide sin filtro, y se elige
//  bien el cuándo.
// ============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';

const KEY = 'rate:v1';

// Vueltas terminadas antes de plantearse pedir nada. Un jugador del primer día
// todavía no sabe si le gusta el juego, y encima acaba de tragarse el tour: la
// petición ahí solo quema uno de los pocos avisos que da el sistema.
const MIN_RACES = 5;

// Freno propio entre peticiones. El sistema ya limita, pero él no nos dice si
// llegó a enseñarlo, así que sin esto volveríamos a pedirlo cada vez que se
// mejora la marca — y gastaríamos la cuota anual en una tarde.
const COOLDOWN_DAYS = 90;

async function load() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : { races: 0, askedAt: 0 };
  } catch (_) {
    return { races: 0, askedAt: 0 };
  }
}

async function save(v) {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(v)); } catch (_) {}
}

// Llamar al terminar CUALQUIER vuelta (buena o mala): así se cuenta el uso
// real. `good` marca si además fue un buen momento — mejorar tu marca del día
// o superar un nivel de Carrera. Solo se pide valoración si `good`.
export async function noteRaceFinished(good) {
  const st = await load();
  st.races += 1;

  const now = Date.now();
  const cooled = now - (st.askedAt || 0) > COOLDOWN_DAYS * 86400000;

  if (!good || st.races < MIN_RACES || !cooled) {
    await save(st);
    return false;
  }

  try {
    // `isAvailableAsync` mira que la plataforma lo soporte; `hasAction` que
    // además haya algo que hacer (en Android sin Play, o si ya valoró, no lo
    // hay). Si no, se sale sin tocar `askedAt`: no hemos gastado nada, y ya
    // se reintentará en el próximo buen momento.
    if (!(await StoreReview.isAvailableAsync())) { await save(st); return false; }
    if (!(await StoreReview.hasAction())) { await save(st); return false; }

    await StoreReview.requestReview();
    st.askedAt = now;
    await save(st);
    return true;
  } catch (_) {
    await save(st);
    return false;
  }
}

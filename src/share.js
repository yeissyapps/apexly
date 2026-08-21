// ============================================================================
//  share — captura la <ShareCard> a PNG y la comparte con el selector nativo.
//
//  IMAGEN **Y** TEXTO, y eso es el motivo de que exista react-native-share
//  aquí. Antes esto usaba expo-sharing, que comparte un FICHERO y nada más:
//  el texto solo se usaba en el catch, o sea que en el caso normal lo que
//  llegaba al grupo era un PNG suelto, sin el enlace de descarga ni el reto.
//  Una imagen no puede llevar un botón dentro; el enlace tiene que ir en el
//  texto, y para eso el texto tiene que salir de la app.
//
//  Con el texto viajando al lado, WhatsApp y Telegram convierten solos la URL
//  en una tarjeta de previsualización tocable (icono + nombre de la app), que
//  es el "botón de descargar" sin tener que dibujar ninguno.
//
//  Se conserva expo-sharing como plan B por si el módulo nativo no está
//  (Expo Go), y compartir texto pelado como plan C: mejor perder la tarjeta
//  que dejar al usuario sin poder compartir.
// ============================================================================

import { Share } from 'react-native';

let ViewShot = null;
let RNShare = null;
let Sharing = null;
try { ViewShot = require('react-native-view-shot'); } catch (_) {}
try { RNShare = require('react-native-share').default; } catch (_) {}
try { Sharing = require('expo-sharing'); } catch (_) {}

export const canShareImage = !!(ViewShot && (RNShare || Sharing));

// cardRef = ref a la vista de la tarjeta (fuera de pantalla).
// text = mensaje que acompaña a la imagen (incluye el enlace a la tienda).
export async function shareCardImage(cardRef, text) {
  // Plan A: imagen + texto en la misma hoja de compartir.
  //
  // Se captura como data-uri en vez de como ruta de fichero: es el camino que
  // react-native-share maneja igual en Android y en iOS (en Android se encarga
  // él del FileProvider, que es donde suelen aparecer los "permission denied"
  // al pasarle un file:// a pelo).
  try {
    if (ViewShot && RNShare && cardRef?.current) {
      const uri = await ViewShot.captureRef(cardRef, { format: 'png', quality: 1, result: 'data-uri' });
      await RNShare.open({
        url: uri,
        type: 'image/png',
        message: text,
        failOnCancel: false, // cancelar no es un error: no hay nada que avisar
      });
      return true;
    }
  } catch (_) {
    // cae al plan B
  }

  // Plan B: solo imagen (sin el enlace, pero al menos se comparte la tarjeta).
  try {
    if (ViewShot && Sharing && cardRef?.current) {
      const uri = await ViewShot.captureRef(cardRef, { format: 'png', quality: 1 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Comparte tu tiempo' });
        return true;
      }
    }
  } catch (_) {
    // cae al plan C
  }

  // Plan C: texto pelado. Aquí el enlace sí va, que es lo que más importa.
  try { await Share.share({ message: text }); } catch (_) {}
  return false;
}

// ============================================================================
//  share — captura la <ShareCard> a PNG y la comparte con el selector nativo
//  (que muestra una vista previa de la imagen). Si faltan los módulos nativos
//  (p. ej. en Expo Go), cae a compartir texto para no romper el flujo.
// ============================================================================

import { Share } from 'react-native';

let ViewShot = null;
let Sharing = null;
try { ViewShot = require('react-native-view-shot'); } catch (_) {}
try { Sharing = require('expo-sharing'); } catch (_) {}

export const canShareImage = !!(ViewShot && Sharing);

// cardRef = ref a la vista de la tarjeta (fuera de pantalla).
export async function shareCardImage(cardRef, fallbackText) {
  try {
    if (ViewShot && Sharing && cardRef?.current) {
      const uri = await ViewShot.captureRef(cardRef, { format: 'png', quality: 1 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Comparte tu tiempo' });
        return true;
      }
    }
  } catch (_) {
    // cae al texto
  }
  try { await Share.share({ message: fallbackText }); } catch (_) {}
  return false;
}

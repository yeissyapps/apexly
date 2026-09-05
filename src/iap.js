// ============================================================================
//  IAP — compra única "ilimitado para siempre" (quita el límite de intentos).
//
//  No consumible, mismo product id en Android/iOS. Flujo por eventos
//  (purchaseUpdatedListener/purchaseErrorListener) envuelto en una promesa.
//  Cualquiera puede llegar a "ilimitado" viendo anuncios igualmente — esto
//  solo quita la fricción, así que el ranking sigue siendo justo.
// ============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';

let iap = null;
try {
  iap = require('expo-iap');
} catch (_) {
  iap = null;
}

// Para ocultar del todo la opción de compra cuando no hay módulo nativo (p.
// ej. una build de iOS que todavía no lleva el plugin de expo-iap) en vez de
// dejar visible un botón que siempre "falla" en silencio al tocarlo.
export const IAP_AVAILABLE = !!iap;

export const UNLIMITED_SKU = 'com.yeissyapps.circuitodiario.unlimited';

const OWNED_KEY = 'unlimited_owned';
let connected = false;

export async function isUnlimitedCached() {
  try {
    return (await AsyncStorage.getItem(OWNED_KEY)) === '1';
  } catch (_) {
    return false;
  }
}

async function markOwned() {
  try { await AsyncStorage.setItem(OWNED_KEY, '1'); } catch (_) {}
}

async function ensureConnected() {
  if (!iap || connected) return;
  await iap.initConnection();
  connected = true;
}

// Precio localizado para el botón (p.ej. "2,99 €"). null si no se pudo pedir.
export async function getUnlimitedPrice() {
  if (!iap) return null;
  try {
    await ensureConnected();
    const products = await iap.fetchProducts({ skus: [UNLIMITED_SKU], type: 'in-app' });
    const p = products?.[0];
    return p?.displayPrice || p?.localizedPrice || null;
  } catch (_) {
    return null;
  }
}

// Revisa las compras ya hechas en la tienda (reinstalación, mismo Apple ID /
// cuenta Google). Devuelve true si el usuario ya tiene el ilimitado.
export async function restoreUnlimited() {
  if (!iap) return isUnlimitedCached();
  try {
    await ensureConnected();
    const purchases = await iap.getAvailablePurchases();
    const owns = purchases.some((p) => (p.productId || p.id) === UNLIMITED_SKU);
    if (owns) await markOwned();
    return owns || (await isUnlimitedCached());
  } catch (_) {
    return isUnlimitedCached();
  }
}

// Compra el ilimitado. Devuelve true si se completó, false si se canceló o
// falló (sin módulo nativo → false, para no bloquear el desarrollo en Expo Go).
export function buyUnlimited() {
  if (!iap) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    let subUpdated = null;
    let subError = null;

    const finish = (result) => {
      if (done) return;
      done = true;
      if (subUpdated) subUpdated.remove();
      if (subError) subError.remove();
      resolve(result);
    };

    subUpdated = iap.purchaseUpdatedListener(async (purchase) => {
      const id = purchase.productId || purchase.id;
      if (id !== UNLIMITED_SKU) return;
      try {
        await iap.finishTransaction({ purchase, isConsumable: false });
      } catch (_) {}
      await markOwned();
      finish(true);
    });
    subError = iap.purchaseErrorListener(() => {
      // Cancelación del usuario u otro fallo: no es un crash, solo "no comprado".
      finish(false);
    });

    (async () => {
      try {
        await ensureConnected();
        await iap.requestPurchase({
          request: {
            apple: { sku: UNLIMITED_SKU },
            google: { skus: [UNLIMITED_SKU] },
          },
          type: 'in-app',
        });
      } catch (_) {
        finish(false);
      }
    })();
  });
}

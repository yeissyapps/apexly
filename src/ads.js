// ============================================================================
//  Ads — anuncios recompensados (AdMob vía react-native-google-mobile-ads).
//
//  Fase 1b: usa los IDs de TEST de Google (TestIds.REWARDED) → anuncios reales
//  de prueba, sin necesidad de cuenta AdMob. En Fase 2 se cambian por los IDs
//  reales (y se añade consentimiento UMP/ATT).
//
//  `showRewarded()` resuelve true SOLO si el usuario se ganó la recompensa
//  (vio el vídeo entero). Si falla la carga o lo cierra antes, resuelve false.
//  Todo va envuelto en try/catch: si el módulo nativo no está disponible, cae a
//  un stub para no romper el flujo.
// ============================================================================

import { REWARDED_UNIT } from './adsConfig';

let admob = null;
try {
  admob = require('react-native-google-mobile-ads');
} catch (_) {
  admob = null;
}

let initialized = false;

// Inicializa AdMob tras recabar el consentimiento UMP/GDPR (obligatorio en la
// UE). Si el formulario no aplica o falla, se sigue igualmente (no bloquea).
export async function initAds() {
  if (!admob || initialized) return;
  initialized = true;
  try {
    const { AdsConsent } = admob;
    if (AdsConsent) {
      try {
        await AdsConsent.requestInfoUpdate();
        await AdsConsent.loadAndShowConsentFormIfRequired();
      } catch (_) {}
    }
    await admob.default().initialize();
  } catch (_) {}
}

// ¿Debe ofrecerse un punto para revisar/revocar el consentimiento? (solo
// aplica a usuarios EEE/UK/Suiza a quienes se les mostró el formulario UMP).
export async function isPrivacyOptionsRequired() {
  if (!admob) return false;
  try {
    const { AdsConsent, AdsConsentPrivacyOptionsRequirementStatus } = admob;
    if (!AdsConsent) return false;
    const info = await AdsConsent.getConsentInfo();
    return info?.privacyOptionsRequirementStatus === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED;
  } catch (_) {
    return false;
  }
}

// Reabre el formulario de privacidad (para que el usuario cambie o revoque
// su consentimiento en cualquier momento, no solo la primera vez).
export async function showPrivacyOptions() {
  if (!admob) return;
  try {
    const { AdsConsent } = admob;
    if (AdsConsent) await AdsConsent.showPrivacyOptionsForm();
  } catch (_) {}
}

// Último motivo por el que no salió el anuncio. Sin esto solo sabíamos "no
// cargó", y en iOS no hay logcat donde mirarlo: en TestFlight es la única forma
// de distinguir "AdMob no tiene relleno" (cosa suya, se arregla sola) de un
// error de configuración nuestro.
//   no-fill  -> AdMob no tiene anuncio que servir (típico en unidad nueva)
//   network  -> sin conexión
//   invalid  -> petición mal formada: ID de bloque incorrecto = BUG NUESTRO
//   internal -> error interno del SDK
let lastError = '';
export function getLastAdError() {
  return lastError;
}

function describeAdError(err) {
  const code = err && (err.code || err.message || '');
  const s = String(code).toLowerCase();
  if (s.includes('no-fill') || s.includes('no fill')) return 'no-fill';
  if (s.includes('network')) return 'network';
  if (s.includes('invalid')) return 'invalid';
  if (s.includes('internal')) return 'internal';
  return String(code).slice(0, 40) || 'desconocido';
}

export function showRewarded() {
  lastError = '';
  return new Promise((resolve) => {
    // Fallback: sin módulo nativo → simula el anuncio (no bloquea el desarrollo).
    if (!admob) {
      setTimeout(() => resolve(true), 500);
      return;
    }

    const { RewardedAd, RewardedAdEventType, AdEventType } = admob;
    let done = false;
    let earned = false;
    let shown = false;
    let loadTimer = null;
    const unsubs = [];

    const finish = (result) => {
      if (done) return;
      done = true;
      if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
      unsubs.forEach((u) => { try { u(); } catch (_) {} });
      resolve(result);
    };

    try {
      const ad = RewardedAd.createForAdRequest(REWARDED_UNIT, {
        requestNonPersonalizedAdsOnly: true,
      });
      unsubs.push(ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
        // A partir de aquí manda el ciclo del anuncio (CLOSED), NO un
        // temporizador: un rewarded dura ~30s, y cortarlo a media reproducción
        // anulaba la recompensa aunque el usuario lo viese entero.
        shown = true;
        if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
        try { ad.show(); } catch (_) { finish(false); }
      }));
      unsubs.push(ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => { earned = true; }));
      unsubs.push(ad.addAdEventListener(AdEventType.CLOSED, () => finish(earned)));
      unsubs.push(ad.addAdEventListener(AdEventType.ERROR, (err) => {
        lastError = describeAdError(err);
        finish(false);
      }));
      ad.load();
      // Salvavidas SOLO para la carga (sin relleno / sin red). Una vez el
      // anuncio está en pantalla deja de aplicar.
      loadTimer = setTimeout(() => {
        if (!shown) { if (!lastError) lastError = 'sin respuesta (12s)'; finish(false); }
      }, 12000);
    } catch (e) {
      lastError = describeAdError(e);
      finish(false);
    }
  });
}

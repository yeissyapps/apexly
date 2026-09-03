// ============================================================================
//  Ads — anuncios recompensados (AdMob vía react-native-google-mobile-ads).
//
//  `showRewarded()` resuelve true SOLO si el usuario se ganó la recompensa
//  (vio el vídeo entero). Si falla la carga o lo cierra antes, resuelve false.
//  Todo va envuelto en try/catch: si el módulo nativo no está disponible, cae a
//  un stub para no romper el flujo.
//
//  CUÁNDO SE PIDE EL CONSENTIMIENTO (importante, ver más abajo): NO al abrir la
//  app, sino la primera vez que el jugador pide ver un anuncio.
// ============================================================================

import { Platform } from 'react-native';
import { REWARDED_UNIT } from './adsConfig';

let admob = null;
try {
  admob = require('react-native-google-mobile-ads');
} catch (_) {
  admob = null;
}

// ============================================================================
//  CONSENTIMIENTO UMP/GDPR — perezoso, no al arrancar.
//
//  Antes se llamaba a loadAndShowConsentFormIfRequired() en un useEffect de
//  arranque. Medido en el emulador: el muro de consentimiento (210 socios,
//  en el idioma del sistema) se pintaba ENCIMA de la pantalla de bienvenida,
//  antes de que el usuario hubiera visto la app ni escrito su nombre. Los
//  toques se los comía el diálogo, así que un usuario nuevo se encontraba
//  la app aparentemente colgada detrás de una pared de letra pequeña.
//
//  Ahora se parte en dos:
//    prepareConsent()   -> solo requestInfoUpdate(). SIN interfaz: es la
//                          llamada que Google pide hacer en cada arranque y
//                          únicamente averigua si haría falta formulario.
//    ensureAdsReady()   -> enseña el formulario (si toca) e inicializa el SDK.
//                          Se llama desde showRewarded(), o sea la primera vez
//                          que el jugador PIDE ver un anuncio.
//
//  Esto se puede hacer porque en Apexly no hay banners ni intersticiales:
//  todos los anuncios salen de un toque explícito ("ver anuncio para más
//  intentos"). Así el muro aparece en el único momento en que tiene sentido
//  —justo cuando pides algo pagado con publicidad— y quien no ve anuncios
//  nunca llega a que le pidan el consentimiento.
//
//  El SDK se inicializa DESPUÉS del formulario a propósito: pedir anuncios
//  antes de recabar el consentimiento es justo lo que prohíbe la política.
// ============================================================================

let consentPrepared = null; // promesa de requestInfoUpdate (sin interfaz)
let adsReady = null;        // promesa de "formulario resuelto + SDK inicializado"

export function prepareConsent() {
  if (!admob) return Promise.resolve();
  if (consentPrepared) return consentPrepared;
  consentPrepared = (async () => {
    try {
      const { AdsConsent } = admob;
      if (AdsConsent) await AdsConsent.requestInfoUpdate();
    } catch (_) {}
  })();
  return consentPrepared;
}

// Resuelve false SOLO si el usuario dijo que no y por tanto no se le pueden
// pedir anuncios; en cualquier otro fallo resuelve true para intentarlo igual
// (un error de red al consultar el consentimiento no debe capar el anuncio).
export function ensureAdsReady() {
  if (!admob) return Promise.resolve(true);
  if (adsReady) return adsReady;
  adsReady = (async () => {
    try {
      const { AdsConsent } = admob;
      await prepareConsent();
      if (AdsConsent) {
        try { await AdsConsent.loadAndShowConsentFormIfRequired(); } catch (_) {}
      }
      if (AdsConsent) {
        try {
          const info = await AdsConsent.getConsentInfo();
          if (info && info.canRequestAds === false) {
            adsReady = null; // que se reevalúe si cambia de opinión
            return false;
          }
        } catch (_) {}
      }
      await admob.default().initialize();
      return true;
    } catch (_) {
      return true;
    }
  })();
  return adsReady;
}

// ¿Debe ofrecerse un punto para revisar/revocar el consentimiento? (solo
// aplica a usuarios EEE/UK/Suiza a quienes les toca el formulario UMP).
//
// Se exige TAMBIÉN que el consentimiento esté ya resuelto (`OBTAINED`), no
// solo que las opciones de privacidad sean obligatorias. Al aplazar el
// formulario, un usuario del EEE cumple lo segundo desde el primer arranque:
// el enlace "Privacidad de anuncios" aparecía al pie de Inicio ANTES de que
// se le hubiera preguntado nada, ofreciéndole revisar una decisión que
// todavía no había tomado.
export async function isPrivacyOptionsRequired() {
  if (!admob) return false;
  try {
    const { AdsConsent, AdsConsentPrivacyOptionsRequirementStatus, AdsConsentStatus } = admob;
    if (!AdsConsent) return false;
    await prepareConsent(); // sin esto getConsentInfo() no tiene nada que contar
    const info = await AdsConsent.getConsentInfo();
    if (!info) return false;
    if (AdsConsentStatus && info.status !== AdsConsentStatus.OBTAINED) return false;
    return info.privacyOptionsRequirementStatus === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED;
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
    // Si acaba de dar el consentimiento que antes negó, el próximo anuncio
    // tiene que volver a intentarlo en vez de arrastrar el "no" cacheado.
    adsReady = null;
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

// ¿El último intento falló porque el usuario rechazó el consentimiento? Se
// separa de los demás fallos porque el aviso tiene que ser otro: decirle
// "ahora no hay anuncios disponibles" a quien acaba de pulsar "No consentir"
// es mentirle, y además le esconde que la decisión es suya y reversible.
let deniedConsent = false;
export function wasConsentDenied() {
  return deniedConsent;
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

export async function showRewarded() {
  lastError = '';

  // Fallback: sin módulo nativo → simula el anuncio (no bloquea el desarrollo).
  if (!admob) {
    await new Promise((r) => setTimeout(r, 500));
    return true;
  }

  // Primer anuncio de la instalación: aquí es donde sale el formulario de
  // consentimiento, con el botón ya en estado "cargando" (ver watchAd).
  if (!(await ensureAdsReady())) {
    lastError = 'consentimiento denegado';
    deniedConsent = true;
    return false;
  }
  deniedConsent = false;

  return new Promise((resolve) => {
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
      // requestNonPersonalizedAdsOnly SOLO en iOS, y a propósito.
      //
      // Anuncios personalizados en iOS exigen pedir ATT (App Tracking
      // Transparency) — y tres builds seguidas rechazadas por Apple
      // (Guideline 2.1, "unable to locate the App Tracking Transparency
      // permission request", siempre en iPad, código ya verificado
      // funcionando en iPhone real) con la app bloqueada semanas sin poder
      // publicar nada, decisión de JC: mejor cobrar menos por anuncio en
      // iOS que seguir sin poder publicar Grand Prix, el indicador de
      // curva y el resto de esta sesión. eCPM medido: 0,24€ (NPA) contra
      // 3,63€ (personalizado) — real, pero con ~20 jugadores/día y solo
      // anuncios rewarded (nunca banners/intersticiales), la diferencia
      // absoluta es céntimos, no una cifra que compense seguir bloqueados.
      //
      // Android NO lleva esto: su identificador de publicidad no exige un
      // permiso explícito equivalente a ATT, así que ahí sigue sirviendo
      // anuncios personalizados sin ningún problema de cumplimiento — esto
      // es estrictamente un apaño de iOS.
      //
      // Si algún día se recupera acceso a un iPad real para probar el fix
      // del onPress (ver docs/review-notes.md) y Apple lo acepta, esto se
      // puede revertir y volver a pedir ATT.
      const ad = RewardedAd.createForAdRequest(
        REWARDED_UNIT,
        Platform.OS === 'ios' ? { requestNonPersonalizedAdsOnly: true } : undefined,
      );
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

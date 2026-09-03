// ============================================================================
//  Analytics — eventos de producto sobre Firebase Analytics (mismo proyecto
//  que ya usamos para push/AdMob). Envuelto en try/catch: sin el módulo
//  nativo (Expo Go, o build sin prebuild) no rompe nada, solo no registra.
//
//  first_open / session_start (y con ello retención D1/D7) los manda el SDK
//  solo; aquí solo instrumentamos los eventos de producto que nos interesan.
// ============================================================================

let analytics = null;
try {
  analytics = require('@react-native-firebase/analytics').default;
} catch (_) {
  analytics = null;
}

function log(name, params) {
  if (!analytics) return;
  analytics().logEvent(name, params).catch(() => {});
}

export function logOnboardingComplete() {
  log('tutorial_complete');
}

export function logRaceStart() {
  log('race_start');
}

export function logRaceFinish({ ms, isBest }) {
  log('race_finish', { ms, is_best: !!isBest });
}

export function logPaywallView() {
  log('paywall_view');
}

export function logAdWatched() {
  log('ad_watched');
}

// Precio fijo (2,99 €) en ambas tiendas — no parseamos el string localizado
// del botón para el reporte de ingresos, mandamos el valor real conocido.
export function logPurchaseUnlimited() {
  log('purchase', { item_id: 'unlimited', value: 2.99, currency: 'EUR' });
}

export function logGarageOpen() {
  log('garage_open');
}

// Nadie sabía, ni siquiera JC probando su propia app, si compartir una
// vuelta se usaba de verdad — cero eventos hasta ahora. Sin esto seguimos
// adivinando si el canal de crecimiento más barato que tenemos sirve para
// algo o no.
export function logShareResult() {
  log('share_result');
}

export function logReferralCodeShared() {
  log('referral_code_shared');
}

export function logReferralRedeemed() {
  log('referral_redeemed');
}

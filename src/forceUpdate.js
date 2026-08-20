// ============================================================================
//  Force update — compara el build instalado contra el mínimo exigido
//  (tabla app_version en Supabase, ver supabase/app_version.sql) y resuelve
//  el link a la tienda para el botón "Actualizar".
//
//  Android: el link a Play Store se construye solo con el bundle id, no
//  hace falta red. iOS no tiene ese atajo (Apple exige el id numérico de la
//  app), así que se resuelve una vez con la API pública de iTunes y se
//  cachea en memoria — si falla (sin red, API caída), se cae a un texto sin
//  botón en vez de romper la pantalla de bloqueo.
// ============================================================================

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { getMinBuild } from './api';

const BUNDLE_ID = 'com.yeissyapps.circuitodiario';
const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${BUNDLE_ID}`;

let cachedAppStoreUrl = null;

export function getCurrentBuild() {
  const cfg = Constants.expoConfig || {};
  const raw = Platform.OS === 'ios' ? cfg.ios?.buildNumber : cfg.android?.versionCode;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

// null si el build instalado ya cumple (o si no se pudo comprobar: nunca
// bloqueamos el arranque por un fallo de red aquí).
export async function checkForceUpdate() {
  try {
    const min = await getMinBuild(Platform.OS);
    if (min == null) return null;
    return getCurrentBuild() < min ? min : null;
  } catch (e) {
    return null;
  }
}

export async function getStoreUrl() {
  if (Platform.OS === 'android') return PLAY_STORE_URL;
  if (cachedAppStoreUrl) return cachedAppStoreUrl;
  try {
    const res = await fetch(`https://itunes.apple.com/lookup?bundleId=${BUNDLE_ID}`);
    const json = await res.json();
    const url = json?.results?.[0]?.trackViewUrl;
    if (url) cachedAppStoreUrl = url;
    return url || null;
  } catch (e) {
    return null;
  }
}

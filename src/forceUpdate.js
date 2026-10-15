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

// Android: el versionCode de app.json (es el mismo que lleva el AAB).
//
// iOS: NO el buildNumber. Codemagic pone el número de build real con
// agvtool al compilar (ver codemagic.yaml) y app.json se queda fijo en
// "91" — la app leía 91 en TODAS las builds y el force update de iOS no
// podía distinguir versiones (descubierto al publicar la 2.4.8). Se usa la
// versión de marketing, que sí cambia en cada release: "2.4.9" -> 20409.
// En Supabase, app_version.min_build de 'ios' va en ESA escala (las
// builds de iOS anteriores a esto dicen ser la 91, así que cualquier
// mínimo de 5 cifras las bloquea a todas: justo lo que se quiere).
export function getCurrentBuild() {
  const cfg = Constants.expoConfig || {};
  if (Platform.OS === 'ios') {
    const [maj, min, pat] = String(cfg.version || '').split('.').map((x) => parseInt(x, 10) || 0);
    return maj * 10000 + min * 100 + pat;
  }
  const n = parseInt(cfg.android?.versionCode, 10);
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

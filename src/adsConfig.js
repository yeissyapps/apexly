// ============================================================================
//  Config de AdMob — IDs centralizados.
//
//  Mientras USE_TEST_ADS = true se usan los IDs de TEST de Google (no generan
//  ingresos, no requieren cuenta, muestran "Test Ad").
//
//  PARA PRODUCCIÓN:
//   1) Pon aquí tus IDs REALES (unidad rewarded, Android/iOS) en REAL_REWARDED.
//   2) Pon el App ID REAL en app.json (plugin react-native-google-mobile-ads)
//      y vuelve a hacer prebuild.
//   3) USE_TEST_ADS = false.
// ============================================================================

import { Platform } from 'react-native';

export const USE_TEST_ADS = false; // ⚠️ PONER false PARA PRODUCCIÓN

// Rewarded de TEST de Google (id público y estable).
const TEST_REWARDED = 'ca-app-pub-3940256099942544/5224354917';

// Unidades REALES de AdMob (app "Apexly").
const REAL_REWARDED = Platform.select({
  android: 'ca-app-pub-4375333671603622/2609862756',
  ios: 'ca-app-pub-4375333671603622/2077600044',
});

export const REWARDED_UNIT = USE_TEST_ADS ? TEST_REWARDED : REAL_REWARDED;

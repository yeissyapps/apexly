// Interruptores de features para controlar el alcance del v1.

import { t } from './i18n';

// Notificaciones push ("te han superado"). FCM configurado (2026-07-29):
// google-services.json en app.json + clave de cuenta de servicio subida a
// Expo (FCM V1). Falta probar la entrega real en un build nuevo.
export const PUSH_ENABLED = true;

// Quién ve el banco de pruebas de circuitos cerrados (Perfil -> PROBAR
// CIRCUITO CERRADO, src/LoopTest.js). Por nombre y no por __DEV__: hay que
// poder probarlo en una build normal (TestFlight / AAB). Los nombres son
// únicos, así que nadie más puede "ser" Yeissy1.
const LOOP_TESTERS = ['yeissy1'];
export const isLoopTester = (nickname) => __DEV__ || LOOP_TESTERS.includes(String(nickname || '').trim().toLowerCase());

// Texto de intentos con plural correcto ("1 intento" / "2 intentos").
export const intentosTxt = (n) => (n === 1 ? t('{n} intento', { n }) : t('{n} intentos', { n }));

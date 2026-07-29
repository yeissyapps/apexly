// Interruptores de features para controlar el alcance del v1.

// Notificaciones push ("te han superado"). FCM configurado (2026-07-29):
// google-services.json en app.json + clave de cuenta de servicio subida a
// Expo (FCM V1). Falta probar la entrega real en un build nuevo.
export const PUSH_ENABLED = true;

// Texto de intentos con plural correcto ("1 intento" / "2 intentos").
export const intentosTxt = (n) => `${n} ${n === 1 ? 'intento' : 'intentos'}`;

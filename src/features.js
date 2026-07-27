// Interruptores de features para controlar el alcance del v1.

// Notificaciones push ("te han superado"). El código y la Edge Function están
// listos, pero falta configurar FCM (google-services.json + credenciales en
// Expo) para que se entreguen en Android. Se activa en v1.1 poniéndolo a true.
export const PUSH_ENABLED = false;

// Texto de intentos con plural correcto ("1 intento" / "2 intentos").
export const intentosTxt = (n) => `${n} ${n === 1 ? 'intento' : 'intentos'}`;

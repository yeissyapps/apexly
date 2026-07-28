// ============================================================================
//  CONFIG — El "feel" del coche vive aquí.
//
//  Todos estos números están pensados para AJUSTARSE JUGANDO. Abre este
//  archivo, cambia un valor, guarda (Fast Refresh recarga solo) y vuelve a
//  probar. No hace falta tocar App.js para tunear la conducción.
//
//  Las unidades de velocidad/aceleración están en "unidades de mundo" por
//  segundo. El mundo mide WORLD_WIDTH de ancho (ver abajo) y se escala para
//  llenar la pantalla, así que estos números se sienten igual en cualquier
//  móvil.
// ============================================================================

export const CONFIG = {
  // --- Mundo --------------------------------------------------------------
  // Ancho de referencia del circuito. No suele hacer falta tocarlo; cambia
  // la "escala" a la que se juega todo. La altura se calcula según la
  // proporción de la pantalla.
  WORLD_WIDTH: 400,

  // --- Aceleración y velocidad -------------------------------------------
  // El coche acelera SOLO (no hay botón de gas). ACCEL = cuánta velocidad
  // gana por segundo mientras no choca. MAX_SPEED = techo de velocidad.
  ACCEL: 150, // u/s^2  (sube despacio: da tiempo a controlar)
  MAX_SPEED: 250, // u/s  (techo alto: conducir limpio se vuelve rápido y exigente)

  // --- Giro ---------------------------------------------------------------
  // Grados por segundo que puede girar el coche a velocidad ~0 (giro máximo).
  TURN_RATE_MAX_DEG: 220,
  // A velocidad máxima el giro se reduce a este factor del máximo (0..1).
  // Ej: 0.65 => a tope de velocidad todavía gira el 65% que gira lento.
  // Esto es lo que hace que "a más velocidad, gire menos" (pero sin pasarse).
  TURN_RATE_AT_MAX_SPEED: 0.65,

  // Ease del volante (no es giro instantáneo):
  // segundos que tarda el volante en ir de 0 a full al PULSAR (in) y de full
  // a 0 al SOLTAR (out). Más bajo = giro más inmediato/sensible.
  STEER_EASE_IN: 0.1, // s
  STEER_EASE_OUT: 0.09, // s

  // --- Colisión con muros -------------------------------------------------
  // Fracción de velocidad que se PIERDE en el IMPACTO (0.6 = pierde el 60%).
  // Solo se aplica en el primer frame del choque, no mientras rozas la pared.
  // Alto = chocar castiga fuerte (el reto es no chocar para mantener velocidad).
  CRASH_SPEED_LOSS: 0.6,
  // Aturdimiento: milisegundos tras el IMPACTO en los que el volante NO
  // responde. Corto para poder corregir rápido tras un roce.
  CRASH_STUN_MS: 150,
  // Cómo rebota contra la pared (restitución de la velocidad reflejada):
  //   0 = se desliza pegado a la pared (sin rebote)
  //   1 = rebote de espejo completo (sale como bola de billar)
  // A 0.4 el choque te lanzaba CRUZANDO la pista y, con el aturdimiento, te
  // estrellabas contra el lado contrario: pinball. Se nota sobre todo en las
  // curvas cerradas, donde el contacto es inevitable porque no hay freno (a
  // 250 u/s harían falta 151°/s para un radio 95 y el coche da 143°/s).
  // Medido en una curva de radio 95: el volantazo máximo baja de 156° a 88°.
  // Súbelo si quieres que chocar tenga más "patada".
  CRASH_BOUNCE: 0,
  // Cuánto hay que separarse del muro (unidades de mundo) para que el
  // siguiente toque cuente como un choque NUEVO. Mientras sigues pegado,
  // deslizas sin castigo en vez de encadenar choques.
  WALL_RELEASE: 3,
  // Frontera entre ROZAR y CHOCAR: cuán de frente tienes que llegar al muro
  // (0 = paralelo, 1 = perpendicular). 0.35 ~ 20º de ángulo de ataque.
  //   Por debajo -> roce: conservas el rumbo y el control, solo raspas
  //                 velocidad (el muro NO te lleva a ti).
  //   Por encima -> choque: rebote + pérdida de velocidad + aturdimiento.
  // Bajarlo = más castigo (casi todo cuenta como choque).
  CRASH_MIN_IMPACT: 0.35,
  // Fricción al raspar el muro: fracción de velocidad que pierdes por segundo
  // cuando vas totalmente de frente. Escala con lo de frente que vayas, así
  // que rozar en paralelo casi no cuesta. Subirlo = rozar penaliza más.
  WALL_SCRUB: 1.8,

  // --- Coche (tamaño de la caja de colisión, en unidades de mundo) --------
  CAR_LENGTH: 32,
  CAR_WIDTH: 17,

  // --- Circuito -----------------------------------------------------------
  TRACK_WIDTH: 104, // ancho del carril

  // --- Debug / ayudas visuales -------------------------------------------
  // true => dibuja una flecha sutil en cada zona táctil (para comparar el
  // "feel" con y sin pista visual de dónde tocar).
  SHOW_TOUCH_HINTS: false,
  // true => dibuja los bordes del carril y el eje (para depurar la colisión).
  SHOW_DEBUG: false,
};

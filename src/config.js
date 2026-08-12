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

  // Frenada integrada en el propio volante (sin botón nuevo, sigue siendo
  // solo izquierda/derecha): cuanto más fuerte gires, más frena el coche
  // solo, proporcional a |steer| (0..1). Convierte cada curva en una
  // decisión real — girar fuerte = más lento pero más cerrado, girar suave
  // = más rápido pero más ancho — en vez de que todo el mundo llegue a tope
  // de velocidad (MAX_SPEED) y solo importe la precisión del volante.
  // A volante a tope (steer=1) y velocidad máxima, el ritmo neto es
  // ACCEL - TURN_SPEED_DRAG = 150-350 = -200 u/s² (frena de verdad y se
  // nota). El primer valor (220 -> -70 u/s²) resultó demasiado sutil en
  // pista: en 0,4s de curva apenas perdías un 11% de velocidad.
  //
  // Historia, porque costó cara: durante una sesión larga se intentó arreglar
  // el comportamiento en horquillas con un modelo de giro nuevo (giro por
  // radio, tope de rebote, empuje pasivo al rozar) y se revirtió todo, porque
  // la referencia de "en Android va perfecto" es la build de producción
  // (versionCode 7, commit 61de5b0) que lleva ESTE mismo valor y el modelo de
  // giro de grados fijos de abajo. Lección: el grueso del problema no era la
  // física sino la entrega de eventos táctiles en iOS (ver MIN_INPUT_MS y
  // applyTouches en Game.js); cambiar la física para compensar un problema de
  // toques solo creaba un juego distinto al que ya funcionaba.
  //
  // Lo único de física que SÍ hizo falta es el suelo de aquí abajo
  // (MIN_TURN_SPEED), y por un motivo propio y medible: -200 u/s² netos dejan
  // el coche a 0 en una horquilla. Eso no se notaba en los circuitos de
  // chicanes pero rompe los de horquillas.
  TURN_SPEED_DRAG: 350, // u/s^2 de frenado extra a volante a tope

  // Suelo del frenado por volante (u/s). NO es un mínimo absoluto: si ya vas
  // más lento (por un choque) el volante simplemente deja de frenarte, nunca
  // te empuja. Ver el detalle en stepSimulation, Game.js.
  //
  // Existe porque una horquilla pide más de un segundo de volante mantenido, y
  // a -200 u/s² netos eso te deja en 0 a mitad de curva. A 0 el coche gira
  // sobre sí mismo sin avanzar y se queda clavado al muro — es lo que rompe el
  // nivel 2 (Horquillas) y no se nota en el 1 (Chicanes), donde no hace falta
  // mantener el volante tanto tiempo.
  //
  // 110 = 44% de MAX_SPEED: girar a tope sigue costando más de la mitad de tu
  // velocidad, que era la intención de TURN_SPEED_DRAG, pero deja de ser un
  // parón total.
  MIN_TURN_SPEED: 110, // u/s

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
  //
  // OJO con el OUT: mientras el volante se centra, el coche SIGUE GIRANDO, así
  // que sueltas apuntando a un sitio y acabas apuntando a otro — se siente como
  // que "el coche se va solo contra el muro". Medido a 250 u/s:
  //   0.09 -> sigue girando 5,8° tras soltar = 25u de desvío lateral en 1 s
  //   0.03 -> sigue girando 1,6°             =  7u   (medio carril = 44u)
  // Se deja el IN alto (el volante tiene peso al meterlo, que es lo que gusta)
  // y el OUT bajo: enderezar es inmediato. La asimetría es intencionada.
  STEER_EASE_IN: 0.1, // s
  STEER_EASE_OUT: 0.03, // s

  // SOLO como respaldo: duración que se le concede a un toque cuando el
  // sistema no da un timestamp nativo usable. Lo normal es reconstruir la
  // duración REAL del dedo desde `nativeEvent.timestamp` (ver applyTouches en
  // Game.js) — que es lo que de verdad importa, porque la duración del toque
  // ES la intención del jugador: ~55 ms para abrirse en recta, ~125 ms para
  // ajustar en una chicane, 300-900 ms para una horquilla (medido leyendo el
  // táctil por hardware en el Android de JC: 41 toques, mínimo 55 ms, mediana
  // 125 ms, ninguno por debajo de 20 ms).
  //
  // En iOS la mitad de los toques llegan con "pulsar" y "soltar" en el mismo
  // instante, lo cual es falso. Darles a todos un valor fijo (como hacía la
  // versión anterior de esto) rompe la proporción: un toque de 55 ms recibía
  // más del doble de giro y una horquilla de 600 ms una quinta parte.
  MIN_INPUT_MS: 130,

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
  // OJO: este valor NO se puede bajar a 0. El rebote es lo ÚNICO que despega
  // al coche del muro: como la velocidad va siempre en la dirección del rumbo,
  // y al rozar no se toca el rumbo, un coche que queda paralelo a la pared se
  // queda raspando ahí para siempre si no giras tú. Con 0 se midió que NO se
  // despega nunca (5,5 s pegado y subiendo). Pero pasarse tampoco vale: a 0.4
  // te lanza cruzando la pista y rebotas contra el muro de enfrente (pinball),
  // con lo que el tiempo pegado vuelve a subir a 3,2 s.
  // Medido (coche a 258 u/s contra el muro a 22°, sin tocar nada después):
  //   0.00 -> 5542 ms pegado, NO se despega,
  //   0.15 ->  408 ms pegado, se despega en 0,99 s, recupera los 250 u/s
  //   0.40 -> 3208 ms pegado (pinball), se queda en 59 u/s
  CRASH_BOUNCE: 0.15,
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
  // cuando vas totalmente de frente. Escala con lo de frente que vayas.
  WALL_SCRUB: 1.8,
  // Rozamiento de ARRASTRE: se aplica siempre que estés tocando el muro, vayas
  // como vayas. Sin esto, ir pegado en paralelo (head~0) salía GRATIS y podías
  // arrastrarte por la pared sin coste, que es lo que JC no quería.
  // A 2.2/s, un segundo pegado te deja al 11% de velocidad: apoyarte castiga,
  // pero conservas el control (a diferencia de encadenar choques).
  WALL_DRAG: 2.2,

  // --- Coche (tamaño de la caja de colisión, en unidades de mundo) --------
  CAR_LENGTH: 32,
  CAR_WIDTH: 17,

  // --- Circuito -----------------------------------------------------------
  TRACK_WIDTH: 104, // ancho del carril

  // --- Beta / diagnóstico -------------------------------------------------
  // true => se ven el contador de FPS, el botón ⚑ de marcar anomalía con su
  // panel y el envío de la grabación, y el motivo técnico por el que un anuncio
  // no ha cargado ("no-fill", etc.).
  //
  // Va en false para publicar. La grabadora sigue corriendo por dentro (es un
  // búfer preasignado, no cuesta nada), así que si el volantazo fantasma vuelve
  // a aparecer basta con poner esto en true y generar build: no hay que volver
  // a escribir nada del instrumental.
  DIAG: false,

  // --- Debug / ayudas visuales -------------------------------------------
  // true => dibuja una flecha sutil en cada zona táctil (para comparar el
  // "feel" con y sin pista visual de dónde tocar).
  SHOW_TOUCH_HINTS: false,
  // true => dibuja los bordes del carril y el eje (para depurar la colisión).
  SHOW_DEBUG: false,
};

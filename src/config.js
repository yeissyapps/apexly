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
  // A volante a tope (steer=1) el ritmo neto es ACCEL - TURN_SPEED_DRAG.
  // El primer valor (220 -> -70 u/s²) resultó demasiado sutil en pista: en
  // 0,4s de curva apenas perdías un 11% de velocidad. Se subió a 350
  // (-200 u/s²) y ESO FUE EL ERROR: se subió a ojo, sin volver a pisar
  // pista ("a falta de sentirla otra vez", decía este mismo comentario).
  //
  // Medido en una grabación real (iOS, build 31, 22,9s de vuelta): a -200
  // u/s² el coche llega a CERO en 0,3-0,6s en cuanto mantienes el volante,
  // y a 0 u/s el giro va a su máximo (TURN_RATE_MAX_DEG), así que pirueta
  // parado en mitad de la curva. Pasó 20 veces en una sola vuelta:
  //   4,02s  64 u/s -> 4,40s  0 u/s, y de ahí girando solo -117° -> -143°
  //   6,14s  71 u/s -> 6,55s  0 u/s, girando 34° -> 108° sin avanzar
  // No era un fallo de iOS: el Android que iba bien es la versión anterior,
  // que no tenía esta frenada. Eran dos juegos distintos.
  //
  // 240 => -90 u/s² netos: desde 250 u/s, un segundo de volante a tope te
  // deja en 160 (pierdes el 36%, se nota y sigue siendo una decisión), pero
  // no te para. El suelo MIN_TURN_SPEED remata el caso extremo.
  TURN_SPEED_DRAG: 240, // u/s^2 de frenado extra a volante a tope

  // Suelo de velocidad MIENTRAS giras (no se aplica si no tocas el volante,
  // ni en un choque — solo limita el frenado POR VOLANTE). Es la segunda mitad
  // del arreglo: aunque bajemos TURN_SPEED_DRAG, entrar a una horquilla ya
  // lento seguiría pudiendo llevarte a 0, y a 0 el coche pirueta parado.
  //
  // 110 = 44% de MAX_SPEED. El primer intento fue 60 (24%) y se quedó corto:
  // a 60 u/s el coche se arrastra y la curva se eterniza.
  //
  // Con el giro por radio (ver TURN_RADIUS_*), este suelo ya NO es lo que
  // impide la pirueta — eso lo resuelve que omega sea proporcional a la
  // velocidad. Aquí solo marca el ritmo mínimo en curva: a 110 u/s el coche
  // traza radio 80, que pasa por la curva más cerrada de todos los circuitos
  // generados (la peor medida: 72, y el carril da 43 de margen extra).
  MIN_TURN_SPEED: 110, // u/s

  // --- Giro ---------------------------------------------------------------
  // El giro se define por el RADIO del arco que describe el coche a volante a
  // tope, en unidades de mundo. La velocidad de giro sale de ahí:
  //     omega = velocidad / radio     (rad/s)
  //
  // Antes esto eran grados/segundo fijos (220), y encima MÁS giro cuanto MÁS
  // lento ibas. Mientras el coche iba siempre a tope (no existía la frenada al
  // girar) eso daba un radio de ~100 y funcionaba. En cuanto la frenada bajó la
  // velocidad de crucero, el radio se desplomó: a 110 u/s el coche giraba con
  // radio 34 y hacía trompos. Medido en el propio generador, LA CURVA MÁS
  // CERRADA QUE EXISTE tiene radio 72 (mediana 180-320), o sea que el coche
  // giraba tres veces más de lo que ninguna curva llega a pedir.
  //
  // Con el radio fijado, el coche traza siempre el mismo arco vaya rápido o
  // lento, y a velocidad 0 no gira nada — desaparece de raíz la pirueta sobre
  // sí mismo.
  //
  //   FAST (100) a velocidad máxima => 143°/s, calcado a la versión que iba
  //     bien, y encaja con las curvas medias del circuito.
  //   SLOW (65) a velocidad ~0 => permite cerrar una horquilla de radio 72
  //     apurando, sin llegar a poder trompear.
  TURN_RADIUS_FAST: 100, // unidades de mundo, a MAX_SPEED
  TURN_RADIUS_SLOW: 65, // unidades de mundo, a velocidad ~0

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

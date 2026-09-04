// ============================================================================
//  piecesKenney — banco de piezas para la Fase 2 del plan de evaluación 3D
//  (ver C:\Users\JC\.claude\plans\ticklish-dazzling-wand.md).
//
//  MISMO patrón que src/pieces.js (línea central local, entrada en (0,0) con
//  rumbo +x, `assemble()` encadena por pose) pero con radios/longitudes que
//  coinciden con las piezas FÍSICAS reales del kit de Kenney en vez de los
//  valores pensados para el SVG de hoy. No se toca pieces.js — es un banco
//  aparte, deliberadamente pequeño (solo lo que hace falta para una pista de
//  prueba fija), no el generador diario.
//
//  Medidas (leídas del propio .glb, min/max de los accessors POSITION — ver
//  el comentario de la Fase 2 en el plan): recta de 4.0 de largo nominal
//  (con 0.2 de solape en cada junta, para que no se vea la costura entre
//  piezas), muro alto 0.3. Las curvas ('corner-small'/'corner-large') son
//  giros de 90°: el radio se dedujo de dónde cae el borde exterior de la
//  malla real (medido con el mismo solape de 0.2) — 2.0 para la pequeña,
//  4.0 para la grande (números redondos, y el doble exacto entre ellas, lo
//  que da confianza en que el cálculo es correcto).
//
//  Variante ESTRECHA ("narrow"), no ancha ("wide") — cambiada a petición de
//  JC para una prueba con las piezas reales de menor tamaño: ancho de canal
//  1.0 (la mitad que la ancha). Medido en Node (accessor POSITION del propio
//  .glb): straight y corner-small de la variante estrecha comparten EXACTA
//  la misma longitud de recta (rango Z idéntico, [-0.2,4.2]) y el mismo
//  borde exterior de curva (mín X idéntico, -2.2) que la variante ancha —
//  o sea, comparten la MISMA línea central/radio, solo cambia el ancho del
//  canal. Por eso aquí solo cambia KENNEY_WIDTH; el resto de medidas
//  (longitud, radio) se reutilizan tal cual de la variante ancha.
//
//  JC probó estrecha (1.0) y ancha (2.0) y las dos se quedaron cortas/
//  largas -- pidió algo intermedio. El kit de Kenney NO trae una tercera
//  variante de ancho (comprobado en el zip: solo narrow/wide), así que en
//  vez de cargar otro asset, el ancho FISICO se sube aquí a 1.5 (el punto
//  medio) y Beta3D.js reescribe los vértices de las mallas narrow para que
//  el ancho VISUAL coincida exactamente con este valor -- ver
//  KENNEY_TRACK_ASSET_WIDTH (el ancho real del asset narrow, para calcular
//  el factor de reescalado) y widenCornerGeometry en Beta3D.js.
//
//  A petición de JC ("ponte con todas las piezas"): banco ampliado con
//  corner_large (mismo giro de 90°, radio doble) y esse (desplazamiento
//  lateral SIN cambiar de rumbo — la pieza 'curve' del kit, que resultó
//  no ser una curva de radio distinto sino algo nuevo, ver el comentario
//  de esse() más abajo), cada una en las dos direcciones (_L/_R) — ver el
//  comentario de makePiece() para cómo se resuelve el espejo de la _R sin
//  tener una malla "de derechas" separada (el kit no la trae).
// ============================================================================

// Fase 3: la línea central ya no vive en metros del kit, sino en las MISMAS
// "unidades de mundo" que usa src/pieces.js (rectas 140-950, radios 70-500,
// TRACK_WIDTH=104) — porque esas unidades son las que CONFIG.MAX_SPEED,
// CONFIG.CAR_WIDTH, etc. dan por sentadas (stepSimulation, reutilizado tal
// cual de Game.js, no sabe nada de metros). SCALE convierte metros de Kenney
// -> unidades de mundo: con SCALE=52, el medio-ancho de canal del kit
// (1.0 m) da 52 unidades, el MISMO medio-ancho que WIDE en pieces.js. El
// render (Beta3D.js) escala cada malla .glb por este mismo factor al
// colocarla, para que su tamaño visual seguido coincida con el espaciado
// ahora más grande de la línea central.
export const SCALE = 52;

// Ancho real del asset narrow tal como viene del kit (para el factor de
// reescalado de vértices en Beta3D.js) vs. el ancho VISUAL que de verdad
// usamos (punto medio pedido por JC entre narrow=1.0 y wide=2.0). La malla
// (asfalto + piano pintado) se ensancha hasta este valor en Beta3D.js.
export const KENNEY_TRACK_ASSET_WIDTH = 1.0 * SCALE;
export const KENNEY_WIDTH_TARGET = 1.5 * SCALE;

// El canal FÍSICO (lo que de verdad delimita stepSimulation) es más
// ESTRECHO que el visual — JC señaló que el coche "se sube en los pianos"
// en curva. Causa: stepSimulation (sin tocar, es la física real del juego)
// solo resta un margen ESTÁTICO (CONFIG.CAR_WIDTH/2) al radio de colisión,
// sin tener en cuenta que un coche GIRADO respecto al carril (como en toda
// curva) proyecta lateralmente más que su ancho quieto — hasta
// CONFIG.CAR_LENGTH/2 en el caso extremo de ir casi perpendicular al
// carril. Con el canal físico llegando hasta el mismo borde que el asfalto
// pintado (1.5), ese margen de más basta para que el morro/cola del coche
// asome sobre el piano en una curva cerrada, aunque el CENTRO nunca cruce
// el límite (la física, ahí, sigue siendo correcta). Recortando el canal
// físico a 1.2 (0.3 menos que el visual) queda ese sobrante como margen de
// seguridad — el asfalto entre el límite físico y el borde pintado sigue
// ahí, pero ya no se puede circular por él, así que el coche no vuelve a
// alcanzar visualmente el piano en un giro normal.
const KENNEY_WIDTH = 1.2 * SCALE;
const KENNEY_STRAIGHT_LEN = 4.0 * SCALE;
export const KENNEY_CORNER_SMALL_R = 2.0 * SCALE;
export const KENNEY_CORNER_LARGE_R = 4.0 * SCALE;
// Pieza 'curve' del kit: NO es un giro de 90° con otro radio (como se
// suponía al principio) — medida en Node (accessor POSITION + comprobación
// de que las secciones de entrada y salida están las dos en Z=0/Z=4.0
// exactas, es decir MISMO rumbo de entrada y salida): es una "esse" — un
// carril que se desplaza LATERALMENTE 2.0 mientras avanza 4.0, sin cambiar
// de rumbo en ningún extremo. Es la pieza que de verdad hacía falta para
// aproximar circuitos reales con eses, no solo óvalos.
export const KENNEY_ESSE_LEN = 4.0 * SCALE;
export const KENNEY_ESSE_SHIFT = 2.0 * SCALE;

function straight(len) {
  return [{ x: 0, y: 0 }, { x: len, y: 0 }];
}

// Copia exacta de arc() en pieces.js — mismo contrato (rumbo de entrada 0,
// salida = turnDeg), solo repetido aquí para no importar de pieces.js (ese
// archivo es del generador diario, este banco es 100% independiente).
function arc(radius, turnDeg) {
  const total = (turnDeg * Math.PI) / 180;
  const s = Math.sign(total) || 1;
  const phi = Math.abs(total);
  const steps = Math.max(4, Math.ceil(phi / (Math.PI / 20)));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const u = (phi * i) / steps;
    const a = -s * (Math.PI / 2) + s * u;
    pts.push({ x: radius * Math.cos(a), y: radius * s + radius * Math.sin(a) });
  }
  return pts;
}

// Centerline de la "esse": desplazamiento lateral con paso de coseno (0 en
// los dos extremos, así el rumbo de entrada y salida no cambia — igual que
// mide la malla real). `shift` negativo = hacia un lado ("_L"), positivo =
// hacia el otro ("_R"). Verificado en Node contra los vértices reales de
// track-narrow-curve.glb: la malla transformada cae en una banda de
// 17-30 unidades de la línea central (mismo orden que las curvas ya
// probadas), tanto para el signo que le toca como para el opuesto en el
// control negativo (ahí la banda se dispara a 3-207, confirma que el signo
// importa y que este es el correcto).
function esse(len, shift, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({ x: len * t, y: shift * 0.5 * (1 - Math.cos(Math.PI * t)) });
  }
  return pts;
}

function placePoints(points, pose) {
  const c = Math.cos(pose.angle);
  const s = Math.sin(pose.angle);
  return points.map((p) => ({ x: pose.x + p.x * c - p.y * s, y: pose.y + p.x * s + p.y * c }));
}
function transformPose(local, pose) {
  const c = Math.cos(pose.angle);
  const s = Math.sin(pose.angle);
  return {
    x: pose.x + local.x * c - local.y * s,
    y: pose.y + local.x * s + local.y * c,
    angle: pose.angle + local.angle,
  };
}

// El ángulo de entrada/salida es EXACTO (analítico), no derivado del chord
// entre los dos últimos puntos discretizados de arc(): ese chord da la
// tangente en el PUNTO MEDIO del último tramo, no en el extremo real — con
// ~9°/paso eso son ~4.5° de error por curva. Para una recta da igual (el
// chord ES la dirección exacta), pero para un óvalo de piezas RÍGIDAS
// encadenadas ese error se acumula pieza a pieza y el circuito no cierra
// (comprobado: con el chord, un óvalo de 4 giros de 90° cerraba con un
// desfase de 18° y ~0.9 unidades — con el ángulo analítico, cierra exacto).
// `mirror` (por defecto true, el comportamiento de siempre): controla el
// espejo local en X de la malla al instanciarla (ver Beta3D.js). Las piezas
// "_L" (giro/desplazamiento hacia un lado) llevan el espejo puesto, tal
// como se validó en la Fase 3; las "_R" (hacia el otro lado) van SIN
// espejo — verificado en Node (no a ojo) que esa es la combinación que
// alinea la malla real con la línea central de cada sentido: con el
// espejo "que no toca", la banda malla<->centerline se dispara de
// 17-30 a 3-207 unidades (ver los comentarios de arc()/esse() más arriba).
function makePiece(id, glb, points, width, entryAngle, exitAngle, mirror = true) {
  const n = points.length;
  return {
    id,
    glb, // nombre del asset .glb a instanciar en la escena 3D
    width,
    points,
    mirror,
    entry: { x: points[0].x, y: points[0].y, angle: entryAngle },
    exit: { x: points[n - 1].x, y: points[n - 1].y, angle: exitAngle },
  };
}

const RIGHT_ANGLE = Math.PI / 2;

export const KENNEY_BANK = [
  makePiece('straight', 'track-narrow-straight', straight(KENNEY_STRAIGHT_LEN), KENNEY_WIDTH, 0, 0),
  // "_L" gira/desplaza hacia -y en esta convención, "_R" hacia +y — ver
  // Beta3D.js para cómo esos signos se traducen en la escena 3D real.
  makePiece('corner_small_L', 'track-narrow-corner-small', arc(KENNEY_CORNER_SMALL_R, -90), KENNEY_WIDTH, 0, -RIGHT_ANGLE, true),
  makePiece('corner_small_R', 'track-narrow-corner-small', arc(KENNEY_CORNER_SMALL_R, 90), KENNEY_WIDTH, 0, RIGHT_ANGLE, false),
  makePiece('corner_large_L', 'track-narrow-corner-large', arc(KENNEY_CORNER_LARGE_R, -90), KENNEY_WIDTH, 0, -RIGHT_ANGLE, true),
  makePiece('corner_large_R', 'track-narrow-corner-large', arc(KENNEY_CORNER_LARGE_R, 90), KENNEY_WIDTH, 0, RIGHT_ANGLE, false),
  // Esse: el rumbo de entrada y salida es el MISMO (0) — no gira, solo
  // desplaza el carril de lado.
  makePiece('esse_L', 'track-narrow-curve', esse(KENNEY_ESSE_LEN, -KENNEY_ESSE_SHIFT, 40), KENNEY_WIDTH, 0, 0, true),
  makePiece('esse_R', 'track-narrow-curve', esse(KENNEY_ESSE_LEN, KENNEY_ESSE_SHIFT, 40), KENNEY_WIDTH, 0, 0, false),
];

const byId = Object.fromEntries(KENNEY_BANK.map((p) => [p.id, p]));

// Mismo contrato que assemble() en pieces.js, pero devuelve TAMBIÉN la pose
// de cada pieza colocada (posición+ángulo de su punto de entrada en el
// mundo) — la física solo necesita el centerline, pero el render 3D
// necesita saber además QUÉ modelo va en cada sitio y con qué transform.
export function assembleBeta(ids) {
  const center = [];
  const placements = [];
  let pose = { x: 0, y: 0, angle: 0 };
  for (const id of ids) {
    const p = byId[id];
    if (!p) throw new Error('Pieza beta desconocida: ' + id);
    placements.push({ id, glb: p.glb, mirror: p.mirror, pose: { ...pose } });
    const placed = placePoints(p.points, pose);
    for (let i = center.length ? 1 : 0; i < placed.length; i++) {
      center.push({ x: placed[i].x, y: placed[i].y, w: p.width / 2, type: p.id });
    }
    pose = transformPose(p.exit, pose);
  }
  return { center, placements, endPose: pose };
}

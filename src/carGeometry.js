// ============================================================================
//  Geometría del coche — DATOS PUROS, sin React ni react-native-svg.
//
//  Por qué existe: la forma del coche vivía dentro de CarSprite.js, mezclada
//  con JSX. Eso hacía imposible dos cosas que ahora hacen falta:
//
//    1. Verla sin compilar. Para juzgar una pieza nueva había que construir
//       la app, instalarla y abrir sobres hasta que tocara. La hoja de
//       contactos (tools/contact-sheet.mjs) importa ESTE archivo y pinta
//       todo el catálogo de golpe, en Node, en segundos.
//    2. Iterar formas. Cambiar un chasis o un alerón era editar JSX a mano
//       entre etiquetas; aquí es una lista de números.
//
//  REGLA: este archivo no importa nada de React. Si alguna vez hace falta,
//  es señal de que lo que se está metiendo aquí no es geometría.
//
//  Sistema de coordenadas (el mismo de siempre, no se ha tocado):
//  origen en el centro del coche, +x hacia el MORRO, +y hacia la derecha del
//  coche. El coche mide ~32 de largo por ~16 de ancho.
//
//  VOCABULARIO DE FORMAS: todo (alerones y libreas) se describe con las
//  mismas primitivas — `rect`, `polygon`, `circle`, `text` — para que un
//  único pintor las sirva. Antes los alerones eran solo rectángulos sueltos
//  con otra forma de escribirlos, y por eso los cuatro se parecían: un
//  rectángulo detrás del coche admite pocas variaciones. Con polígonos
//  entran las placas laterales abiertas y los labios curvos.
// ============================================================================

// Declarado aquí arriba a propósito: LIVERY_SHAPES_GEOM lo usa al construirse
// (el 7 del dorsal se traza al cargar el módulo). Más abajo caería en la zona
// muerta del `const` y reventaría al importar.
const round = (n) => Math.round(n * 100) / 100;

// Silueta de la carrocería. Estilo 911 GT3 RS visto desde arriba: morro
// afilado, costados con cintura, cola ancha.
export const CAR_BODY =
  'M16,0 C15,-4 13,-6.5 10,-7.2 C6,-7.8 2,-7.2 -2,-7.6 ' +
  'C-6,-8 -9,-8.6 -12,-8.2 C-14,-7.9 -15.5,-6 -16,0 ' +
  'C-15.5,6 -14,7.9 -12,8.2 C-9,8.6 -6,8 -2,7.6 ' +
  'C2,7.2 6,7.8 10,7.2 C13,6.5 15,4 16,0 Z';

// ============================================================================
//  ALERONES
//
//  Se pintan ANTES que la carrocería, así que todo lo que quede bajo el
//  cuerpo desaparece: por eso los puntales y los labios arrancan dentro del
//  coche y solo asoma lo que sobresale por detrás.
//
//  Cada uno se reconoce por UNA idea, no por milímetros de diferencia:
//    labio        · pegado a la cola, sin hueco       -> discreto
//    gt           · plano + placas abiertas en abanico
//    cuello_cisne · plano sostenido por dos brazos visibles en el hueco
//    biplano      · dos planos apilados, el más ancho y el que más sobresale
// ============================================================================
export const WING_SHAPES_GEOM = {
  sin_aleron: [],

  // Labio de cola (ducktail): un bulto que abraza la cola sin dejar hueco.
  // La arista recta que cierra el polígono cae dentro del cuerpo y no se ve.
  //
  // `hug` = esta pieza sigue el ANCHO del chasis. Es la única que lo lleva:
  // un plano suspendido puede (y debe) ser más ancho que el coche, pero un
  // labio que sobresale por los costados no es un labio, es un escudo pegado
  // detrás — que es exactamente como se veía en el monoplaza.
  labio: [
    {
      type: 'polygon',
      hug: true,
      points: '-14,-7.8 -16.6,-7.2 -18.4,-4.6 -19.2,0 -18.4,4.6 -16.6,7.2 -14,7.8',
    },
  ],

  // Plano recto con hueco + placas laterales abiertas en abanico. Las placas
  // son polígonos, no rectángulos: abiertas se leen como placas; en recto se
  // leían como que el plano era simplemente más largo.
  gt: [
    { type: 'rect', x: -18.0, y: -3.6, width: 3.0, height: 2.0, rx: 0.6 },
    { type: 'rect', x: -18.0, y: 1.6, width: 3.0, height: 2.0, rx: 0.6 },
    { type: 'rect', x: -20.6, y: -9.6, width: 3.0, height: 19.2, rx: 0.8 },
    { type: 'polygon', points: '-21.8,-11.6 -16.8,-10.0 -16.8,-8.6 -21.8,-9.6' },
    { type: 'polygon', points: '-21.8,11.6 -16.8,10.0 -16.8,8.6 -21.8,9.6' },
  ],

  // Cuello de cisne: el plano no se apoya desde abajo sino que cuelga de dos
  // brazos que salen de la carrocería. Los brazos van afilados y separados,
  // que es lo que hace que el hueco se lea.
  cuello_cisne: [
    { type: 'polygon', points: '-15.8,-4.6 -20.6,-6.8 -20.6,-5.2 -15.8,-3.0' },
    { type: 'polygon', points: '-15.8,4.6 -20.6,6.8 -20.6,5.2 -15.8,3.0' },
    { type: 'rect', x: -21.4, y: -8.6, width: 2.6, height: 17.2, rx: 0.8 },
    { type: 'rect', x: -22.6, y: -9.9, width: 3.8, height: 1.8, rx: 0.6 },
    { type: 'rect', x: -22.6, y: 8.1, width: 3.8, height: 1.8, rx: 0.6 },
  ],

  // Biplano: dos planos apilados unidos por placas que abarcan los dos. Es
  // el que más sobresale por detrás y el único más ancho que el propio coche
  // — a tamaño de juego se distingue por la silueta, sin mirar el detalle.
  biplano: [
    { type: 'rect', x: -17.8, y: -3.4, width: 2.6, height: 1.8, rx: 0.6 },
    { type: 'rect', x: -17.8, y: 1.6, width: 2.6, height: 1.8, rx: 0.6 },
    { type: 'rect', x: -18.8, y: -10.2, width: 2.4, height: 20.4, rx: 0.8 },
    { type: 'rect', x: -22.4, y: -11.2, width: 2.8, height: 22.4, rx: 0.8 },
    { type: 'polygon', points: '-23.4,-12.0 -17.4,-10.8 -17.4,-9.0 -23.4,-10.2' },
    { type: 'polygon', points: '-23.4,12.0 -17.4,10.8 -17.4,9.0 -23.4,10.2' },
  ],
};

export function wingGeom(shape) {
  return WING_SHAPES_GEOM[shape] || WING_SHAPES_GEOM.sin_aleron;
}

// ============================================================================
//  LIBREAS
//
//  La franja ya no es "una barra corta en medio del capó": va de morro a
//  cola, que es como se pintan de verdad. Y el catálogo deja de ser cuatro
//  variantes de raya:
//    simple  · franja central
//    doble   · dos franjas paralelas
//    flecha  · galón apuntando al morro   -> no es una raya, se lee al vuelo
//    numero  · dorsal en disco, con el número calado en el color del coche
//    damero  · banda a cuadros            -> la más reconocible de todas
// ============================================================================

// La banda a cuadros se genera con un bucle en vez de escribir 12 cuadrados a
// mano: sigue siendo dato puro (se calcula una vez al cargar el módulo) y
// cambiar el tamaño del cuadro es tocar un número.
const DAMERO_SQ = 2.8;
const DAMERO_COLS = 5;
const DAMERO_ROWS = 5;
const DAMERO = [];
for (let r = 0; r < DAMERO_ROWS; r++) {
  for (let c = 0; c < DAMERO_COLS; c++) {
    // Solo se pintan los cuadros "negros": los otros dejan ver la carrocería,
    // que es justo lo que hace el damero (y evita tener que calar nada).
    if ((r + c) % 2 !== 0) continue;
    DAMERO.push({
      type: 'rect',
      x: -DAMERO_COLS * DAMERO_SQ / 2 + c * DAMERO_SQ,
      y: -DAMERO_ROWS * DAMERO_SQ / 2 + r * DAMERO_SQ,
      width: DAMERO_SQ,
      height: DAMERO_SQ,
    });
  }
}

// El "7" del dorsal, trazado a mano. Sale de un cuadro de 3.6 x 5.0 centrado
// en (cx, 0), que deja margen de sobra dentro de un disco de radio 4.2.
//
// ORIENTACIÓN: la cifra apunta hacia el MORRO, no hacia el costado. En pista
// la cámara mantiene el coche siempre mirando hacia arriba de la pantalla
// (gira el circuito, no el coche), así que un dorsal orientado al costado se
// lee tumbado SIEMPRE — que es como estaba y por qué no había manera de
// reconocer el número. Con el "arriba" de la cifra en +x, en carrera se lee
// derecho; en el garaje gira con el plato, como todo lo demás.
const NUM_CX = -10.6;
function numeralPoints(cx) {
  // Trazo en coordenadas de lectura (u = derecha, v = abajo)...
  const p = [
    [-1.8, -2.5], [1.8, -2.5],    // barra superior
    [0.2, 2.5], [-1.0, 2.5],      // pie del trazo diagonal
    [0.55, -1.35], [-1.8, -1.35], // vuelta por debajo de la barra
  ];
  // ...y girado para que "arriba" caiga hacia el morro: x = -v, y = u.
  return p.map(([u, v]) => `${round(cx - v)},${round(u)}`).join(' ');
}

export const LIVERY_SHAPES_GEOM = {
  simple: [{ type: 'rect', x: -13, y: -1.5, width: 26, height: 3.0 }],
  doble: [
    { type: 'rect', x: -13, y: -2.9, width: 26, height: 1.8 },
    { type: 'rect', x: -13, y: 1.1, width: 26, height: 1.8 },
  ],
  // Galón: dos trazos que se juntan en punta hacia el morro.
  flecha: [
    { type: 'polygon', points: '3,0 -4,-6.6 -7.6,-6.6 -0.6,0 -7.6,6.6 -4,6.6' },
    { type: 'polygon', points: '-4.6,0 -11.6,-6.6 -13.6,-6.6 -6.6,0 -13.6,6.6 -11.6,6.6' },
  ],
  // Dorsal: disco relleno con el número CALADO en el color de la carrocería
  // (`knockout`). Un círculo de contorno con el número dentro se perdía a
  // tamaño de juego; un disco macizo se ve incluso en miniatura.
  //
  // Va en la cubierta TRASERA (x negativa) y no en el centro: centrado, la
  // cabina se comía media cifra — el techo se pinta encima de la librea, así
  // que un dorsal bajo el techo es un dorsal invisible. Echado bien atrás,
  // además, deja de pelearse con la rejilla del motor y se lee el disco
  // entero. Es el sitio donde va en un coche de verdad.
  //
  // EL 7 ES GEOMETRÍA, NO TEXTO. Con <Text> lo resolvía la fuente del
  // sistema, y react-native-svg y el navegador no eligen la misma: en la
  // hoja de contactos salía centrado y del tamaño justo, y en el móvil salía
  // enorme, bajo y tocando el borde del disco. O sea que la hoja daba por
  // bueno algo que en el dispositivo estaba mal — el único caso del catálogo
  // donde eso podía pasar, porque es la única primitiva que dependía de una
  // fuente. Como polígono mide lo que dicen sus números en los dos sitios.
  numero: [
    { type: 'circle', cx: NUM_CX, cy: 0, r: 4.2 },
    {
      type: 'polygon',
      knockout: true,
      // Trazado en X hacia el morro, igual que el resto: el dorsal se lee
      // desde el costado izquierdo del coche.
      rigid: true,
      anchorX: NUM_CX,
      points: numeralPoints(NUM_CX),
    },
  ],
  damero: DAMERO,
};

export function liveryGeom(pattern) {
  return LIVERY_SHAPES_GEOM[pattern] || LIVERY_SHAPES_GEOM.simple;
}

// ============================================================================
//  Adaptación de piezas a cada chasis
//
//  Las medidas de arriba están dibujadas para el chasis GT (el original).
//  Para los demás no valen tal cual: en un monoplaza la franja se sale por
//  los costados y el alerón queda flotando lejos de la cola. Estas funciones
//  las recolocan usando los anclajes que declara cada chasis.
//
//  GT es la referencia, así que para GT el desplazamiento es 0 y la escala 1:
//  no toca nada de lo que ya funcionaba.
// ============================================================================
const REF_WING_MOUNT = -16;
const REF_LIVERY_LEN = 26;
const REF_LIVERY_X = -13;

// Aplica una transformación en X a cualquier primitiva del vocabulario. Una
// sola función para alerones y libreas: cuando eran dos caminos distintos,
// añadir un polígono a un alerón significaba que el desplazamiento por chasis
// se lo saltaba en silencio.
// `ky` solo se aplica a las primitivas marcadas `hug` (ver el labio): al
// resto se les deja el Y intacto a propósito.
function mapShapes(shapes, mapX, scale, ky = 1) {
  return shapes.map((p) => {
    const k = p.hug ? ky : 1;
    if (p.type === 'rect') {
      return { ...p, x: mapX(p.x), width: p.width * scale, y: p.y * k, height: p.height * k };
    }
    if (p.type === 'polygon') {
      // `rigid`: la pieza se MUEVE con el chasis pero no se estira. Lo usa el
      // 7 del dorsal — una cifra escalada un 20% en un solo eje deja de ser
      // una cifra y pasa a ser un borrón.
      const dx = p.rigid ? mapX(p.anchorX) - p.anchorX : 0;
      return {
        ...p,
        points: p.points.split(' ').map((pt) => {
          const [px, py] = pt.split(',').map(Number);
          return `${round(p.rigid ? px + dx : mapX(px))},${round(py * k)}`;
        }).join(' '),
      };
    }
    if (p.type === 'circle') return { ...p, cx: mapX(p.cx) };
    if (p.type === 'text') return { ...p, x: mapX(p.x) };
    return p;
  });
}

// Medio ancho del GT: la referencia contra la que se estrechan las piezas
// que abrazan la carrocería.
const REF_HALF = 8.2;

export function wingGeomFor(chassis, shape) {
  const dx = (chassis?.wingMount ?? REF_WING_MOUNT) - REF_WING_MOUNT;
  const ky = (chassis?.half ?? REF_HALF) / REF_HALF;
  const shapes = wingGeom(shape);
  // El alerón se DESPLAZA, no se escala en X: estirarlo cambiaría el grosor
  // de los planos y un chasis largo tendría un alerón "gordo" sin haberlo
  // elegido. En Y solo se ajusta lo marcado `hug`.
  if (dx === 0 && ky === 1) return shapes;
  return mapShapes(shapes, (x) => x + dx, 1, ky);
}

export function liveryGeomFor(chassis, pattern) {
  const len = chassis?.liveryLen ?? REF_LIVERY_LEN;
  const x0 = chassis?.liveryX ?? REF_LIVERY_X;
  const k = len / REF_LIVERY_LEN;
  const dx = x0 - REF_LIVERY_X;
  const shapes = liveryGeom(pattern);
  if (k === 1 && dx === 0) return shapes;

  // Solo se escala/desplaza en X (a lo largo del coche). En Y NO: la franja
  // debe conservar su grosor, si no en un chasis ancho se convierte en una
  // mancha y en uno estrecho desaparece. Como los largos de todos los chasis
  // son parecidos, la escala se queda cerca de 1 y el damero no se deforma.
  return mapShapes(shapes, (x) => (x - REF_LIVERY_X) * k + x0, k);
}

// --- Piezas fijas (no personalizables) --------------------------------------
export const GRILLE = { x: -12, y: -4.6, width: 8, height: 9.2, rx: 2, fill: 'rgba(0,0,0,0.18)' };
export const CABIN = { x: -1, y: -4.8, width: 9, height: 9.6, rx: 3.4, fill: '#1b2733' };
export const SPLITTER = { x: 13.6, y: -6.6, width: 2.6, height: 13.2, rx: 1, fill: '#0f1218' };

// ============================================================================
//  FAROS
//
//  El haz SALE DE LA LÁMPARA, calculado a partir de `chassis.lights`. Antes
//  era una constante con las coordenadas del GT clavadas (x=11.4, y=±5),
//  así que en los otros tres chasis las lámparas estaban en un sitio y los
//  conos de luz en otro: en el monoplaza los faros van casi juntos en el
//  centro (y=±1.6) y la luz salía a la altura de las ruedas.
//
//  Dos conos por faro (uno largo y tenue, otro corto y más denso) para que el
//  haz tenga caída sin necesitar degradado.
// ============================================================================
export function lightBeamsFor(chassis) {
  const lamps = chassis?.lights || [{ x: 11.4, y: -5 }, { x: 11.4, y: 5 }];
  const out = [];
  for (const l of lamps) {
    // El cono largo se abre hacia fuera (y*1.2) además de hacia delante: es
    // lo que hace que dos haces paralelos no se lean como una sola mancha.
    out.push({ points: `${l.x},${l.y} ${round(l.x + 18.6)},${round(l.y * 1.2 - 5)} ${round(l.x + 18.6)},${round(l.y * 1.2 + 5)}`, opacity: 0.22 });
  }
  for (const l of lamps) {
    out.push({ points: `${l.x},${l.y} ${round(l.x + 8.6)},${round(l.y - 1.6)} ${round(l.x + 8.6)},${round(l.y + 1.6)}`, opacity: 0.4 });
  }
  return out;
}

// Radio de la lámpara. El monoplaza lo declara más pequeño porque sus faros
// van casi pegados: con el radio del GT los dos círculos se solapaban y se
// veía una sola mancha.
export function lightRadius(chassis) {
  return chassis?.lightR ?? 1.7;
}

// --- Veta de brillo de metalizado/cromado -----------------------------------
// Elipse angosta a lo largo del morro-cola: ya se estrecha sola en los
// extremos sin más cálculo. El cromado añade una segunda veta más fina abajo
// y más nítida — reflejo duro del metal pulido frente al satinado del
// metalizado.
export function highlightEllipses(finish) {
  const cromado = finish === 'cromado';
  const out = [{ cx: -1, cy: -4.6, rx: 13.5, ry: cromado ? 1.1 : 1.7, opacity: cromado ? 0.8 : 0.5 }];
  if (cromado) out.push({ cx: -1, cy: 4.4, rx: 12, ry: 0.8, opacity: 0.45 });
  return out;
}

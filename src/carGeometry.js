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
// ============================================================================

// Silueta de la carrocería. Estilo 911 GT3 RS visto desde arriba: morro
// afilado, costados con cintura, cola ancha.
export const CAR_BODY =
  'M16,0 C15,-4 13,-6.5 10,-7.2 C6,-7.8 2,-7.2 -2,-7.6 ' +
  'C-6,-8 -9,-8.6 -12,-8.2 C-14,-7.9 -15.5,-6 -16,0 ' +
  'C-15.5,6 -14,7.9 -12,8.2 C-9,8.6 -6,8 -2,7.6 ' +
  'C2,7.2 6,7.8 10,7.2 C13,6.5 15,4 16,0 Z';

// --- Alerones ---------------------------------------------------------------
// Cada forma es una lista de rectángulos (props sueltas). Se pintan ANTES que
// la carrocería, así que lo que quede bajo el cuerpo no se ve: por eso los
// puntales arrancan dentro y solo asoma el plano.
export const WING_SHAPES_GEOM = {
  sin_aleron: [],
  cuello_cisne: [
    { x: -16.5, y: -4, width: 3.6, height: 8, rx: 1 },
    { x: -18.6, y: -10.8, width: 3.6, height: 21.6, rx: 1.6 },
    { x: -18.9, y: -11.2, width: 5.2, height: 2.4, rx: 1 },
    { x: -18.9, y: 8.8, width: 5.2, height: 2.4, rx: 1 },
  ],
  // Plano recto + placas trapezoidales en los extremos + puntales finos.
  gt: [
    { x: -18.5, y: -9, width: 3, height: 18, rx: 1 },
    { x: -20.5, y: -11, width: 3.4, height: 2.6, rx: 0.8 },
    { x: -20.5, y: 8.4, width: 3.4, height: 2.6, rx: 0.8 },
    { x: -16, y: -3.4, width: 2.2, height: 6.8, rx: 1 },
  ],
  // Angulada/barrida, minimalista (menos piezas que el GT).
  barrido: [
    { x: -19, y: -9.5, width: 3, height: 19, rx: 1.4 },
    { x: -16.2, y: -3, width: 2, height: 6, rx: 1 },
  ],
  // Plano ancho pegado a la carrocería, sin puntales visibles — más ancho que
  // el propio coche (whale-tail).
  cola_de_pato: [{ x: -17.5, y: -10, width: 4.5, height: 20, rx: 1.6 }],
};

export function wingGeom(shape) {
  return WING_SHAPES_GEOM[shape] || WING_SHAPES_GEOM.cuello_cisne;
}

// --- Libreas ----------------------------------------------------------------
// Descriptores de primitiva en vez de JSX, para que los pueda pintar tanto
// react-native-svg (en el juego) como una plantilla de texto (en la hoja de
// contactos). `stroke: true` = el color va al trazo, no al relleno.
export const LIVERY_SHAPES_GEOM = {
  simple: [{ type: 'rect', x: -8, y: -1.4, width: 20, height: 2.8 }],
  doble: [
    { type: 'rect', x: -8, y: -2.6, width: 20, height: 1.6 },
    { type: 'rect', x: -8, y: 1, width: 20, height: 1.6 },
  ],
  diagonal: [{ type: 'polygon', points: '-2,-7.4 4,-7.4 -4,7.4 -10,7.4' }],
  numero: [
    { type: 'circle', cx: -2, cy: 0, r: 4.4, stroke: true, strokeWidth: 1 },
    { type: 'text', x: -2, y: 1.6, fontSize: 5, fontWeight: '700', anchor: 'middle', value: '7' },
  ],
};

export function liveryGeom(pattern) {
  return LIVERY_SHAPES_GEOM[pattern] || LIVERY_SHAPES_GEOM.simple;
}

// --- Adaptación de piezas a cada chasis --------------------------------------
// Las medidas de arriba están dibujadas para el chasis GT (el original). Para
// los demás no valen tal cual: en un monoplaza la franja se sale por los
// costados y el alerón queda flotando lejos de la cola. Estas dos funciones
// las recolocan usando los anclajes que declara cada chasis.
//
// GT es la referencia (wingMount -16, liveryLen 20, liveryX -8), así que para
// GT el desplazamiento es 0 y la escala 1: no toca nada de lo que ya
// funcionaba.
const REF_WING_MOUNT = -16;
const REF_LIVERY_LEN = 20;
const REF_LIVERY_X = -8;

export function wingGeomFor(chassis, shape) {
  const dx = (chassis?.wingMount ?? REF_WING_MOUNT) - REF_WING_MOUNT;
  const rects = wingGeom(shape);
  return dx === 0 ? rects : rects.map((r) => ({ ...r, x: r.x + dx }));
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
  // mancha y en uno estrecho desaparece.
  const mapX = (x) => (x - REF_LIVERY_X) * k + x0;
  return shapes.map((p) => {
    if (p.type === 'rect') return { ...p, x: mapX(p.x), width: p.width * k };
    if (p.type === 'polygon') {
      return {
        ...p,
        points: p.points.split(' ').map((pt) => {
          const [px, py] = pt.split(',').map(Number);
          return `${mapX(px).toFixed(2)},${py}`;
        }).join(' '),
      };
    }
    if (p.type === 'circle') return { ...p, cx: mapX(p.cx) };
    if (p.type === 'text') return { ...p, x: mapX(p.x) };
    return p;
  });
}

// --- Piezas fijas (no personalizables) --------------------------------------
export const GRILLE = { x: -12, y: -4.6, width: 8, height: 9.2, rx: 2, fill: 'rgba(0,0,0,0.18)' };
export const CABIN = { x: -1, y: -4.8, width: 9, height: 9.6, rx: 3.4, fill: '#1b2733' };
export const SPLITTER = { x: 13.6, y: -6.6, width: 2.6, height: 13.2, rx: 1, fill: '#0f1218' };

// --- Faros ------------------------------------------------------------------
// Dos conos por faro (uno largo y tenue, otro corto y más denso) para que el
// haz tenga caída sin necesitar degradado.
export const LIGHT_BEAMS = [
  { points: '11.4,-5 30,-11 30,-1', opacity: 0.22 },
  { points: '11.4,5 30,1 30,11', opacity: 0.22 },
  { points: '11.4,-5 20,-6.6 20,-3.4', opacity: 0.4 },
  { points: '11.4,5 20,3.4 20,6.6', opacity: 0.4 },
];
export const LIGHT_BULBS = [
  { cx: 11.4, cy: -5, r: 1.7 },
  { cx: 11.4, cy: 5, r: 1.7 },
];

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

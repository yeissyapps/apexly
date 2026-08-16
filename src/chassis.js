// ============================================================================
//  Chasis — las siluetas elegibles del coche.
//
//  POR QUÉ CADA CHASIS TRAE SUS PROPIOS ANCLAJES: en la versión de una sola
//  silueta, todo lo demás estaba clavado a sus medidas (cabina en x=-1,
//  splitter en x=13.6, faros en x=11.4, franja de 20 de largo...). Esos
//  números solo son correctos para ESE coche: en un monoplaza, estrecho y
//  largo, los faros caen fuera de la carrocería y la franja se sale por los
//  costados. Así que la silueta y sus puntos de montaje viajan juntos — si
//  se separan, cada chasis nuevo obliga a tocar cinco sitios y alguno se
//  olvida.
//
//  Sistema de coordenadas (común a todos): origen en el centro, +x al MORRO,
//  +y a la derecha del coche. `half` = medio ancho máximo, para que la
//  librea sepa hasta dónde puede llegar sin desbordar.
//
//  REGLA DE JUEGO: el chasis es SOLO estético, como el resto del garaje. La
//  caja de colisión del juego (CONFIG.CAR_LENGTH/CAR_WIDTH) NO depende de
//  esto — si dependiera, elegir chasis sería elegir ventaja y se acabó la
//  igualdad del ranking. Por eso todos ocupan aproximadamente lo mismo.
// ============================================================================

// --- Chasis 1: GT (el de siempre) -------------------------------------------
// Estilo 911 GT3 RS: morro afilado, costados con cintura, cola ancha. Es el
// coche con el que la gente lleva jugando, así que se conserva EXACTO — no
// se toca ni un número, para que nadie sienta que le han cambiado el suyo.
const GT = {
  id: 'gt',
  label: 'GT',
  locked: false,
  half: 8.2,
  body:
    'M16,0 C15,-4 13,-6.5 10,-7.2 C6,-7.8 2,-7.2 -2,-7.6 ' +
    'C-6,-8 -9,-8.6 -12,-8.2 C-14,-7.9 -15.5,-6 -16,0 ' +
    'C-15.5,6 -14,7.9 -12,8.2 C-9,8.6 -6,8 -2,7.6 ' +
    'C2,7.2 6,7.8 10,7.2 C13,6.5 15,4 16,0 Z',
  cabin: { x: -1, y: -4.8, width: 9, height: 9.6, rx: 3.4 },
  grille: { x: -12, y: -4.6, width: 8, height: 9.2, rx: 2 },
  splitter: { x: 13.6, y: -6.6, width: 2.6, height: 13.2, rx: 1 },
  lights: [{ x: 11.4, y: -5 }, { x: 11.4, y: 5 }],
  wingMount: -16,   // desde aquí hacia atrás cuelga el alerón
  liveryLen: 26,    // largo de la franja — es la REFERENCIA de carGeometry
  liveryX: -13,     // dónde empieza (de cola a morro, no un trozo del capó)
};

// --- Chasis 2: Monoplaza ----------------------------------------------------
// Fórmula: morro largo y estrecho, cuerpo fino, ruedas descubiertas
// insinuadas como bloques a los lados. La cabina es un óvalo pequeño y
// adelantado (el piloto va casi en el centro).
const MONOPLAZA = {
  id: 'monoplaza',
  label: 'Monoplaza',
  locked: true,
  rarity: 'epica',
  half: 5.4,
  body:
    'M17,0 C16.5,-1.6 15,-2.4 13,-2.6 C10,-2.9 7,-2.6 5,-3.2 ' +
    'C3,-3.8 1,-5.2 -2,-5.4 C-6,-5.6 -10,-5.4 -13,-5 ' +
    'C-15,-4.7 -16,-3 -16.5,0 ' +
    'C-16,3 -15,4.7 -13,5 C-10,5.4 -6,5.6 -2,5.4 ' +
    'C1,5.2 3,3.8 5,3.2 C7,2.6 10,2.9 13,2.6 C15,2.4 16.5,1.6 17,0 Z',
  // Ruedas descubiertas: cuatro bloques que asoman fuera del cuerpo. Van en
  // `extras` para que se pinten con la carrocería y hereden su color.
  extras: [
    { x: 6, y: -8.6, width: 5.5, height: 3.4, rx: 1.2 },
    { x: 6, y: 5.2, width: 5.5, height: 3.4, rx: 1.2 },
    { x: -11.5, y: -9.4, width: 6.5, height: 4, rx: 1.4 },
    { x: -11.5, y: 5.4, width: 6.5, height: 4, rx: 1.4 },
  ],
  cabin: { x: -3.5, y: -2.9, width: 6.5, height: 5.8, rx: 2.9 },
  grille: { x: -13, y: -3, width: 5, height: 6, rx: 1.6 },
  splitter: { x: 14.5, y: -5.2, width: 2.4, height: 10.4, rx: 0.9 },
  lights: [{ x: 12, y: -1.6 }, { x: 12, y: 1.6 }],
  // Lámparas más pequeñas: van casi pegadas en el centro y con el radio del
  // GT los dos círculos se solapaban en una sola mancha.
  lightR: 1.2,
  wingMount: -16.5,
  // Franja deliberadamente corta: el morro es tan fino que una franja hasta
  // la punta desbordaría por los costados (no se escala en Y a propósito,
  // ver liveryGeomFor), y una franja que se sale parece un fallo de dibujo.
  liveryLen: 21,
  liveryX: -13,
};

// --- Chasis 3: Clásico ------------------------------------------------------
// Silueta de los 60-70: casi rectangular, esquinas vivas, morro y cola
// planos. Deliberadamente el MENOS aerodinámico del lote — se reconoce por
// la contundencia, no por la elegancia.
const CLASICO = {
  id: 'clasico',
  label: 'Clásico',
  locked: true,
  rarity: 'rara',
  half: 7.6,
  body:
    'M14.5,-6.4 C15.6,-6.4 16,-5.6 16,-4 L16,4 C16,5.6 15.6,6.4 14.5,6.4 ' +
    'L-14,6.4 C-15.4,6.4 -16,5.6 -16,4 L-16,-4 C-16,-5.6 -15.4,-6.4 -14,-6.4 Z',
  cabin: { x: -3, y: -4.6, width: 10, height: 9.2, rx: 1.2 },
  grille: { x: -14.5, y: -4.8, width: 6, height: 9.6, rx: 0.6 },
  splitter: { x: 15.2, y: -6, width: 2, height: 12, rx: 0.5 },
  lights: [{ x: 13.8, y: -4.4 }, { x: 13.8, y: 4.4 }],
  wingMount: -16,
  liveryLen: 28,
  liveryX: -14,
};

// --- Chasis 4: Prototipo ----------------------------------------------------
// LMP/Le Mans: el más ancho y bajo, morro en cuña muy marcada, cola cortada
// en recto. La cabina va desplazada hacia adelante y es pequeña respecto al
// cuerpo, que es lo que le da la escala de "coche grande".
const PROTOTIPO = {
  id: 'prototipo',
  label: 'Prototipo',
  locked: true,
  rarity: 'legendaria',
  half: 9,
  body:
    'M17,0 C16,-3.4 14,-5 11,-6.2 C7,-7.8 2,-8.6 -3,-8.9 ' +
    'C-8,-9.2 -13,-9 -15.5,-8.4 L-16.5,-8.4 L-16.5,8.4 L-15.5,8.4 ' +
    'C-13,9 -8,9.2 -3,8.9 C2,8.6 7,7.8 11,6.2 C14,5 16,3.4 17,0 Z',
  cabin: { x: 0, y: -4.2, width: 8, height: 8.4, rx: 3.6 },
  grille: { x: -13, y: -5.4, width: 7, height: 10.8, rx: 1.4 },
  splitter: { x: 14.4, y: -7, width: 3, height: 14, rx: 1.2 },
  lights: [{ x: 12.2, y: -5.4 }, { x: 12.2, y: 5.4 }],
  wingMount: -16.5,
  liveryLen: 28,
  liveryX: -14,
};

export const CHASSIS = [GT, MONOPLAZA, CLASICO, PROTOTIPO];

export const DEFAULT_CHASSIS = 'gt';

export function chassisById(id) {
  return CHASSIS.find((c) => c.id === id) || GT;
}

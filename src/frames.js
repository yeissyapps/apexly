// ============================================================================
//  Marcos del ranking — la ÚNICA pieza que ven los demás.
//
//  POR QUÉ EXISTE ESTA CATEGORÍA: las otras 22 piezas (chasis, pintura,
//  alerón, librea) solo se aprecian en tu propio garaje; en carrera el coche
//  se ve pequeño y de lejos. O sea, coleccionabas para ti solo. El marco se
//  pinta en TU FILA del ranking, que es lo que mira todo el mundo — es lo que
//  convierte la colección en algo que se puede presumir.
//
//  Se aplica ENCIMA del estilo de "tú" que ya existe (fondo magenta), no en
//  su lugar: el magenta sigue significando "esta fila eres tú" y el marco
//  añade el acabado. Si el marco sustituyera al magenta, la gente perdería
//  la referencia de dónde está.
//
//  LA CORONA MUNDIAL NO SE COMPRA. No está en catalog_pieces, así que nunca
//  sale de un sobre: se concede la primera vez que acabas 1.º del mundo en un
//  día (ver grant_world_crowns en supabase/frames.sql) y se conserva para
//  siempre. Por eso tampoco cuenta para el "X/N piezas": una pieza que no
//  puede tocarte en un sobre haría la colección imposible de completar (el
//  mismo motivo por el que los faros quedan fuera del recuento).
// ============================================================================

// OJO: este archivo NO importa nada, a propósito. `car.js` lo necesita para
// contar las piezas totales, y car.js lo importa la hoja de contactos desde
// Node — si esto arrastrara `theme.js` (que importa react-native), la hoja
// dejaría de funcionar. Por eso cada marco guarda el NOMBRE del token de
// color (`tone`), no el color: quien pinta lo resuelve contra RD, así que
// sigue habiendo una sola fuente de color y cero duplicación de hex.
export const FRAMES = [
  {
    id: 'sin_marco',
    label: 'Sin marco',
    locked: false,
    deco: null,
  },
  {
    id: 'filo',
    label: 'Filo',
    locked: true,
    rarity: 'rara',
    // Barra sólida en el canto de entrada. Discreta: la lista se sigue
    // leyendo como una lista, no como un escaparate.
    deco: { kind: 'left', width: 4, tone: 'trackBlue' },
  },
  {
    id: 'esquinas',
    label: 'Esquinas',
    locked: true,
    rarity: 'rara',
    deco: { kind: 'all', width: 2, tone: 'successGreen' },
  },
  {
    id: 'doble',
    label: 'Doble',
    locked: true,
    rarity: 'epica',
    // Te enmarca por los dos costados: se te encuentra de un vistazo aunque
    // la lista sea larga.
    deco: { kind: 'sides', width: 4, tone: 'youMagenta' },
  },
  {
    id: 'corona',
    label: 'Corona mundial',
    locked: true,
    rarity: 'legendaria',
    achievement: true, // no sale en sobres: se gana acabando 1.º del mundo
    deco: { kind: 'all', width: 2, tone: 'gold1st' },
    glyph: '♛',
  },
];

export const DEFAULT_FRAME = 'sin_marco';

export function frameById(id) {
  return FRAMES.find((f) => f.id === id) || FRAMES[0];
}

// Los que SÍ pueden salir en un sobre (todo lo bloqueado menos los logros).
// Es la lista que tiene que cuadrar con catalog_pieces en el servidor.
export const PACK_FRAMES = FRAMES.filter((f) => f.locked && !f.achievement);

// Traduce el `deco` de un marco a estilo de React Native. Recibe la paleta
// (RD) en vez de importarla, por lo dicho arriba: este archivo no depende de
// nada. Devuelve {} para "sin marco".
export function frameStyle(frame, RD) {
  const d = frame?.deco;
  if (!d) return {};
  const c = RD[d.tone];
  if (d.kind === 'left') return { borderLeftWidth: d.width, borderLeftColor: c };
  if (d.kind === 'sides') {
    return {
      borderLeftWidth: d.width, borderLeftColor: c,
      borderRightWidth: d.width, borderRightColor: c,
    };
  }
  return { borderWidth: d.width, borderColor: c };
}

export function frameGlyphColor(frame, RD) {
  return frame?.deco ? RD[frame.deco.tone] : undefined;
}

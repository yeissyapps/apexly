// ============================================================================
//  Car — catálogo de personalización del coche (garaje).
//
//  Todo lo que define QUÉ opciones existen vive aquí (sin React), para que
//  CarSprite (dibuja) y Garage (elige) lean del mismo sitio y nunca diverjan.
//  `locked: true` marca piezas premium — el CÓMO se desbloquean (racha,
//  ranking, sobres...) se decide más adelante; de momento solo se muestran
//  bloqueadas, como escaparate de lo que vendrá.
// ============================================================================

export const CAR_DEFAULTS = {
  bodyColor: '#ffd23f',
  wingShape: 'sin_aleron', // todos empiezan sin extras, nada equipado de fábrica
  wingColor: '#0f1218',
  livery: null, // color de la franja (hex de CAR_COLORS), null = sin franja
  liveryPattern: 'simple', // id de LIVERY_PATTERNS
  lightsColor: '#fff6cf',
};

// 20 colores (8 base + 12 premium en 3 acabados), compartidos por
// carrocería, alerón y franja de librea.
//
// `finish` decide cómo se pinta en el coche de verdad (ver CarSprite.js):
//   'flat'       -> el hex de `c` tal cual, como hasta ahora.
//   'metalizado' / 'cromado' -> degradado ESTÁTICO a partir de `stops`.
//   'holografico'            -> degradado que ROTA con el tiempo (sin timer
//                                nuevo: el coche ya se re-renderiza solo,
//                                sea el plato giratorio del garaje o el rAF
//                                del juego).
// `c` se queda siempre como representante plano (para localizar la pieza
// por su hex guardado en Supabase, que sigue siendo un string simple).
export const CAR_COLORS = [
  { id: 'blanco', c: '#ffffff', locked: false, finish: 'flat' },
  { id: 'negro', c: '#1a1a1c', locked: false, finish: 'flat' },
  { id: 'amarillo', c: '#ffd23f', locked: false, finish: 'flat' },
  { id: 'naranja', c: '#ff5a1f', locked: false, finish: 'flat' },
  { id: 'rojo', c: '#ff5c5c', locked: false, finish: 'flat' },
  { id: 'azul', c: '#4fa9ff', locked: false, finish: 'flat' },
  { id: 'verde', c: '#3fae5c', locked: false, finish: 'flat' },
  { id: 'marron', c: '#6b4a2f', locked: false, finish: 'flat' },

  // --- Metalizado (rara) ---
  { id: 'morado_metalizado', label: 'Morado metal.', c: '#7a5ea8', locked: true, finish: 'metalizado', rarity: 'rara',
    stops: ['#5c447f', '#8f74bf', '#6a5192', '#c3b0e0', '#6a5192', '#4a3766'] },
  { id: 'verde_metalizado', label: 'Verde metal.', c: '#3f7a52', locked: true, finish: 'metalizado', rarity: 'rara',
    stops: ['#2c5a3c', '#4f9968', '#3a7a4f', '#a8dcb8', '#3a7a4f', '#204030'] },
  { id: 'azul_metalizado', label: 'Azul metal.', c: '#3a6ea5', locked: true, finish: 'metalizado', rarity: 'rara',
    stops: ['#294e78', '#5c8dc2', '#3a6ea5', '#a9cdec', '#3a6ea5', '#1c3752'] },
  { id: 'rojo_metalizado', label: 'Rojo metal.', c: '#a13f3f', locked: true, finish: 'metalizado', rarity: 'rara',
    stops: ['#7a2c2c', '#c26161', '#a13f3f', '#e8adad', '#a13f3f', '#521818'] },

  // --- Cromado (épica) ---
  { id: 'oro', label: 'Oro cromado', c: '#d4af37', locked: true, finish: 'cromado', rarity: 'epica',
    stops: ['#7a5f16', '#e8c65a', '#fff3c4', '#e8c65a', '#a67f24', '#f5da8a', '#7a5f16', '#c99f2e'] },
  { id: 'plata', label: 'Plata cromada', c: '#c0c0c0', locked: true, finish: 'cromado', rarity: 'epica',
    stops: ['#6e6e6e', '#d8d8d8', '#ffffff', '#d8d8d8', '#8a8a8a', '#e8e8e8', '#6e6e6e', '#b0b0b0'] },
  { id: 'grafito', label: 'Grafito cromado', c: '#5b5f66', locked: true, finish: 'cromado', rarity: 'epica',
    stops: ['#3d4046', '#7d828b', '#5b5f66', '#c4c8ce', '#5b5f66', '#26282c'] },
  { id: 'bronce', label: 'Bronce cromado', c: '#8a5a34', locked: true, finish: 'cromado', rarity: 'epica',
    stops: ['#5f3c20', '#a97c4d', '#8a5a34', '#d9b98d', '#8a5a34', '#3d2612'] },

  // --- Holográfico (legendaria) ---
  { id: 'holografico_arcoiris', label: 'Holo arcoíris', c: '#ff5c8a', locked: true, finish: 'holografico', rarity: 'legendaria',
    stops: ['#ff5c8a', '#ffb84d', '#f5e663', '#5ce8a0', '#5cc8ff', '#b884ff'] },
  { id: 'holografico_verde_amarillo_morado', label: 'Holo verde-morado', c: '#5ce87a', locked: true, finish: 'holografico', rarity: 'legendaria',
    stops: ['#5ce87a', '#f5e663', '#b884ff'] },
  { id: 'holografico_rosa_cian_azul', label: 'Holo rosa-azul', c: '#ff6fa8', locked: true, finish: 'holografico', rarity: 'legendaria',
    stops: ['#ff6fa8', '#5ce8e0', '#4fa9ff'] },
  { id: 'holografico_ambar_magenta_violeta', label: 'Holo ámbar-violeta', c: '#ffb84d', locked: true, finish: 'holografico', rarity: 'legendaria',
    stops: ['#ffb84d', '#ff4fa0', '#8a4fff'] },
];

// Busca la ficha de catálogo de un color por su hex guardado (loadout sigue
// guardando un hex plano, no un id — así no hace falta tocar la columna de
// Supabase). Si no está en el catálogo (color heredado/antiguo), degrada a
// plano con ese mismo hex.
export function findColorEntry(hex) {
  return CAR_COLORS.find((c) => c.c === hex) || { c: hex, finish: 'flat' };
}

// Formas de alerón. 'sin_aleron' es la única libre (nuevo valor de fábrica);
// el resto son piezas premium, de más a menos común.
export const WING_SHAPES = [
  { id: 'sin_aleron', label: 'Sin alerón', locked: false },
  { id: 'cuello_cisne', label: 'Cuello cisne', locked: true, rarity: 'rara' },
  { id: 'gt', label: 'GT', locked: true, rarity: 'rara' },
  { id: 'barrido', label: 'Barrido', locked: true, rarity: 'epica' },
  { id: 'cola_de_pato', label: 'Cola de pato', locked: true, rarity: 'legendaria' },
];

// Patrones de librea (la franja). El COLOR de la franja ya no es propio de
// la librea: reutiliza CAR_COLORS (mismo picker que carrocería/alerón).
export const LIVERY_PATTERNS = [
  { id: 'simple', label: 'Franja simple', locked: false },
  { id: 'doble', label: 'Doble franja', locked: true, rarity: 'rara' },
  { id: 'diagonal', label: 'Diagonal', locked: true, rarity: 'epica' },
  { id: 'numero', label: 'Número', locked: true, rarity: 'legendaria' },
];

export const LIGHT_COLORS = [
  { id: 'blanco', c: '#fff6cf', locked: false },
  { id: 'ambar', c: '#ffb84d', locked: false },
  { id: 'multicolor', c: '#b884ff', locked: true },
];

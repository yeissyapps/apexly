// ============================================================================
//  Car — catálogo de personalización del coche (garaje).
//
//  Todo lo que define QUÉ opciones existen vive aquí (sin React), para que
//  CarSprite (dibuja) y Garage (elige) lean del mismo sitio y nunca diverjan.
//  `locked: true` marca piezas premium — el CÓMO se desbloquean (racha,
//  ranking...) se decide más adelante; de momento solo se muestran bloqueadas.
// ============================================================================

export const CAR_DEFAULTS = {
  bodyColor: '#ffd23f',
  wingShape: 'cuello_cisne',
  wingColor: '#0f1218',
  livery: null, // id de BODY_LIVERIES, o null = sin franja
  lightsColor: '#fff6cf',
};

export const BODY_COLORS = [
  { id: 'amarillo', c: '#ffd23f', locked: false },
  { id: 'naranja', c: '#ff5a1f', locked: false },
  { id: 'azul', c: '#4fa9ff', locked: false },
  { id: 'crema', c: '#eae4d6', locked: false },
  { id: 'plata', c: '#a7a7a7', locked: true },
  { id: 'oro', c: '#f0c451', locked: true },
];

export const WING_SHAPES = [
  { id: 'sin_aleron', label: 'Sin alerón', locked: false },
  { id: 'calle', label: 'Calle', locked: false },
  { id: 'cuello_cisne', label: 'Cuello cisne', locked: false },
  { id: 'doble_plano', label: 'Doble plano', locked: true },
];

export const WING_COLORS = [
  { id: 'negro', c: '#0f1218', locked: false },
  { id: 'blanco', c: '#eae4d6', locked: false },
  { id: 'naranja', c: '#ff5a1f', locked: false },
  { id: 'oro', c: '#f0c451', locked: true },
];

export const BODY_LIVERIES = [
  { id: null, label: 'Sin franja', c: null, locked: false },
  { id: 'blanca', label: 'Blanca', c: '#eae4d6', locked: false },
  { id: 'azul', label: 'Azul', c: '#4fa9ff', locked: false },
  { id: 'dorada', label: 'Dorada', c: '#f0c451', locked: true },
];

export const LIGHT_COLORS = [
  { id: 'blanco', c: '#fff6cf', locked: false },
  { id: 'ambar', c: '#ffb84d', locked: false },
  { id: 'multicolor', c: '#b884ff', locked: true },
];

export function findLivery(id) {
  return BODY_LIVERIES.find((l) => l.id === id) || BODY_LIVERIES[0];
}

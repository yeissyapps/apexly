// ============================================================================
//  Tema — dirección "A refinada": mundo oscuro de motorsport con ejecución
//  moderna (superficies suaves, tipografía neutra, más aire).
//
//  Color con SIGNIFICADO:
//    hot     -> marca / acción (CTA)
//    gold    -> récord / 1.º puesto
//    purple  -> tu mejor marca / "tú"
//    green   -> mejora / vas por delante
//  Los tiempos van en monoespaciada tabular (look de cronómetro).
// ============================================================================

import { Platform } from 'react-native';

export const C = {
  bg:     '#0a0c0f',
  card:   '#14181e',
  card2:  '#1a1f26',
  line:   '#242b34',
  line2:  '#2e3641',
  ink:    '#ecebe5',   // off-white cálido
  dim:    '#8b929c',
  faint:  '#5d646e',
  hot:    '#ff6a3d',   // marca / livery
  hotInk: '#1a0d07',   // texto sobre naranja
  gold:   '#ffb84d',   // récord / P1
  purple: '#b884ff',   // mejor personal / tú
  green:  '#43e08a',   // mejora / por delante
  silver: '#b6bcc4',
  bronze: '#cf8f5a',
};

// Fuente monoespaciada para tiempos y números.
export const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

// Colores de avatar (tonos vivos que leen sobre fondo oscuro; texto oscuro encima).
const AV_COLORS = [
  '#ff6a3d', '#ffb84d', '#b884ff', '#43e08a', '#5b9dff',
  '#ff7db0', '#4fd6c8', '#f0c94f', '#9d8bff', '#ff8f5c',
];

export function avatarColor(key) {
  const s = String(key || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}

// Iniciales a partir del nombre: 2 letras si hay dos palabras, si no 1-2.
export function initials(name) {
  const n = String(name || '').trim();
  if (!n) return '?';
  const parts = n.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase();
}

// ============================================================================
//  Rediseño "Parrilla" (dirección 1a, handoff design_handoff_apexly_redesign).
//  Sistema de color/tipografía nuevo, en migración pantalla a pantalla — RD y
//  RD_FONT conviven con C/MONO hasta que todas las pantallas estén migradas.
// ============================================================================

export const RD = {
  bg: '#0b0b0c',
  panelBorder: '#2a2a2c',
  gridLine: '#232324',
  textPrimary: '#f2ede2',
  textSecondary: '#a7a7a7',
  textTertiary: '#8c8c8c',
  textDisabled: '#6f6f6f',
  // Acento de marca, de uso restringido: CTA, sector activo, detalle del
  // coche. Es el MISMO rojo del icono de la app (sacado por pixel del propio
  // asset, no un rojo parecido), para que lo de fuera y lo de dentro sean la
  // misma marca. Nombre semántico a propósito: si algún día cambia el tono,
  // el token sigue significando lo mismo.
  brand: '#e4002b',
  gold1st: '#f0c451',
  gold1stShade: '#7a5610',
  silver2nd: '#a7a7a7',
  silver2ndShade: '#4a4a4a',
  bronze3rd: '#cf8a4c',
  bronze3rdShade: '#6b3f18',
  successGreen: '#38d97a',
  youMagenta: '#d63384',
  youMagentaBg: '#1a1210',
  cream: '#eae4d6',
  trackBlue: '#4fa9ff',    // nombre del circuito · logro "1.º de tu grupo"
  // Aviso ("vas por detrás del fantasma"). Va en naranja y NO en rojo a
  // propósito: con la marca en rojo, un aviso rojo competiría por el mismo
  // significado y el jugador no sabría si es acento o alerta.
  danger: '#ff5a1f',
};

export const RD_FONT = {
  displayBlack: 'BarlowCondensed_800ExtraBold',
  displayBold: 'BarlowCondensed_700Bold',
  displaySemibold: 'BarlowCondensed_600SemiBold',
  mono: 'IBMPlexMono_500Medium',
  monoSemibold: 'IBMPlexMono_600SemiBold',
  monoBold: 'IBMPlexMono_700Bold',
};

// Pares claro/oscuro para el "identicon" de avatar (versión lite: solo el
// degradado diagonal por ahora, la forma geométrica llega en la fase de
// avatares). Determinista por key, igual que avatarColor.
const RD_IDENTICON_PAIRS = [
  ['#7c5cff', '#4b3aa8'], // púrpura
  ['#ff5c8a', '#c93463'], // rosa
  ['#2fbf71', '#1c8a52'], // verde
  ['#5c7a99', '#37506b'], // azul grisáceo
  ['#c9973a', '#8a6423'], // dorado apagado
  ['#4fd6c8', '#2b8e84'], // turquesa
  ['#ff8f5c', '#b3572c'], // naranja tostado
];

// Rareza de las piezas del coche. Vive aquí y no en cada pantalla porque lo
// usan la Tienda (probabilidades y badge al abrir) y el Garaje (marco de cada
// pieza): si el azul de "rara" no es EL MISMO en los dos sitios, el jugador
// no puede aprender el código de color.
export const RARITY_COLOR = {
  rara: '#4fa9ff',       // = RD.trackBlue
  epica: '#d63384',      // = RD.youMagenta
  legendaria: '#f0c451', // = RD.gold1st
};

export const RARITY_LABEL = { rara: 'Rara', epica: 'Épica', legendaria: 'Legendaria' };

// Resultado real por sector de una vuelta (no confundir con RD, que es la
// paleta general): morado = mejor del mundo hoy, verde = mejoraste tu
// fantasma, amarillo = no lo mejoraste. Usado en el desglose de Resultado.
export const SECTOR_RESULT_COLORS = {
  purple: '#b884ff',
  green: RD.successGreen,
  yellow: '#ffd83d',
};

export function rdIdenticonPair(key) {
  const s = String(key || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return RD_IDENTICON_PAIRS[h % RD_IDENTICON_PAIRS.length];
}

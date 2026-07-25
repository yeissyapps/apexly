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

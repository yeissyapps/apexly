// ============================================================================
//  links — enlaces públicos de la app (los que viajan fuera del móvil).
//
//  Separado de forceUpdate.js a propósito: aquel resuelve la tienda para el
//  botón "Actualizar" DENTRO de la app, donde ya sabemos en qué plataforma
//  estamos. Aquí es al revés — el enlace acaba en un grupo de WhatsApp donde
//  hay Android y iPhone mezclados, así que tiene que decidir en destino.
// ============================================================================

import { SUPABASE_URL } from './supabaseConfig';

// Redirector propio: mira el User-Agent y manda a Play o App Store (ver
// supabase/functions/ir/index.ts). Es feo de leer, y da igual: WhatsApp y
// Telegram siguen la redirección y pintan la ficha de la tienda con el icono
// de la app, que es lo que la gente ve y toca.
//
// Cuando haya dominio propio, esta constante es lo único que cambia.
export const SHARE_LINK = `${SUPABASE_URL}/functions/v1/ir`;

// Enlace de "reto" para compartir una vuelta concreta.
//
// Los parámetros ms/day van desde ya, aunque hoy no hagan nada: sin App Links
// ni Universal Links configurados (no hay dominio propio), un https:// NO
// puede abrir la app, así que todo el mundo acaba en la tienda. El día que
// haya dominio y App Links, el reto vuelve a funcionar sin tocar el texto que
// se comparte.
export function retoLink(ms, day) {
  return `${SHARE_LINK}?ms=${ms}&day=${encodeURIComponent(day)}`;
}

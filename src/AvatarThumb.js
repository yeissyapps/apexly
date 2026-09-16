// ============================================================================
//  AvatarThumb — miniatura de piloto para listas (rankings, GP). Si el
//  jugador ya tiene avatar_thumb_url (Fase 2 de avatares, ver
//  PilotViewer.js/api.js), se pinta esa foto.
//
//  Si no (la inmensa mayoría todavía, sin catálogo/inventario real para
//  desbloquear el suyo): JC, 2026-09-15, primero pidió un template gris
//  liso, luego "genera un avatar para cada jugador... no el cuadrado
//  gris" — un render 3D real del piloto no se puede generar por-jugador
//  desde el cliente (las policies de Storage solo dejan escribir en tu
//  propia carpeta, a propósito, para que nadie pise el avatar de otro).
//  La solución intermedia: el set COMPLETO de 14 MUÑECOS ENTEROS ya
//  renderizados (Fase 4, "muñecos enteros" desbloqueables por rareza —
//  ver AvatarViewer.js / AvatarTest.js: 1 base + 6 comunes + 4 raras + 2
//  épicas + 1 legendaria), asignados a cada jugador por hash de su
//  `userId` — estable (no cambia si se renombra) y sin coste de red
//  (assets locales, empaquetados con la app). Sustituye a las 6
//  variantes de color de la Fase 1/3 (mismo piloto recoloreado) — esas
//  quedan como referencia en assets/pilot/defaults/ pero ya no se usan
//  aquí. OJO: el reparto es UNIFORME (cada uno de los 14 con la misma
//  probabilidad) — no refleja la rareza real (la legendaria no debería
//  salir tan a menudo como una común). Es a propósito así de simple
//  mientras esto sea solo la miniatura de relleno; el reparto pesado por
//  rareza de verdad le corresponde al inventario/desbloqueo real de la
//  Fase 4 (`pilot_avatar_id` en `users`, aún sin construir).
// ============================================================================

import { Image, StyleSheet } from 'react-native';
import { variantIndexForSeed } from './PilotViewer';
import { AVATARS } from './avatarCatalog';

// Fotos YA renderizadas del set completo (ver AvatarTest.js -> "GENERAR
// 14 MINIATURAS"). Mismo criterio de hash estable que antes, ahora sobre
// 14 diseños en vez de 6 colores. Lista única en avatarCatalog.js — Profile
// elige el mismo diseño (en 3D) con el mismo índice, así el jugador ve
// siempre el mismo muñeco en su miniatura y en su visor en vivo.
function variantForSeed(seed) {
  return AVATARS[variantIndexForSeed(seed, AVATARS.length)].thumb;
}

// "contain", no "cover": estos renders son de cuerpo entero (mucho más
// altos que anchos), y "cover" sobre una caja cuadrada recortaba cabeza
// y piernas para rellenarla — el jugador nunca veía la figura completa
// (JC, 2026-09-15: "siguen sin verse enteros"). Con "contain" sale la
// figura entera, centrada, con aire transparente a los lados en vez de
// recorte — el precio es que ya no rellena el cuadrado de lado a lado,
// así que el `size` pedido por cada sitio puede necesitar subir un poco
// para que el personaje en sí se siga viendo grande.
export default function AvatarThumb({ uri, size = 22, seed }) {
  const radius = Math.round(size * 0.2);
  const source = uri ? { uri } : variantForSeed(seed);
  return (
    <Image
      source={source}
      resizeMode="contain"
      style={[styles.base, { width: size, height: size, borderRadius: radius }]}
    />
  );
}

const styles = StyleSheet.create({
  // Sin backgroundColor: con el fondo del render ahora transparente de
  // verdad, cualquier color de relleno aquí se vería A TRAVÉS del PNG —
  // exactamente el "cuadrado con bordes redondeados" que reportó JC. Antes
  // este backgroundColor tenía sentido (tapaba huecos), ahora es al revés.
  base: {},
});

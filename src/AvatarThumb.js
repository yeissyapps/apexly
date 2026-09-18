// ============================================================================
//  AvatarThumb — miniatura de piloto para listas (rankings, GP). Pinta el
//  PNG YA EMPAQUETADO en la app del avatar que el jugador tiene guardado en
//  `pilot_avatar_id` (avatarCatalog.js) — cae a la BASE si todavía no ha
//  elegido ninguno.
//
//  JC, 2026-09-17: "ya no se hace el tema de la miniatura no? si ya tenemos
//  el avatar entero" — tenía razón. Antes esto pintaba una foto subida a
//  Storage (avatar_thumb_url, capturada del visor 3D) porque el sistema
//  viejo tenía combinaciones de piezas/colores infinitas por jugador — con
//  el catálogo cerrado de 14 diseños fijos de hoy, cada uno YA tiene su PNG
//  local; no hace falta renderizar ni subir nada, solo mirar qué id tiene
//  guardado. Esto también quita el hueco donde la subida podía fallar
//  después de que el RPC ya hubiera guardado bien el avatar, dejando la
//  miniatura desincronizada del avatar real.
//
//  Antes de eso (aún más viejo): cada jugador caía a un diseño distinto por
//  hash de su `userId` (variantIndexForSeed) mientras no existía ningún
//  selector real — JC, 2026-09-17, lo quitó también: "todo el mundo debe
//  tener el azul" hasta que elija o gane otro en un sobre.
// ============================================================================

import { Image, StyleSheet } from 'react-native';
import { AVATARS } from './avatarCatalog';

// "contain", no "cover": estos renders son de cuerpo entero (mucho más
// altos que anchos), y "cover" sobre una caja cuadrada recortaba cabeza
// y piernas para rellenarla — el jugador nunca veía la figura completa
// (JC, 2026-09-15: "siguen sin verse enteros"). Con "contain" sale la
// figura entera, centrada, con aire transparente a los lados en vez de
// recorte — el precio es que ya no rellena el cuadrado de lado a lado,
// así que el `size` pedido por cada sitio puede necesitar subir un poco
// para que el personaje en sí se siga viendo grande.
export default function AvatarThumb({ pilotAvatarId, size = 22 }) {
  const radius = Math.round(size * 0.2);
  const avatar = pilotAvatarId ? AVATARS.find((a) => a.key === pilotAvatarId) : null;
  const source = (avatar || AVATARS[0]).thumb;
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

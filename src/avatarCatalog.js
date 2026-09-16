// ============================================================================
//  avatarCatalog — lista única de los 14 "muñecos enteros" (Fase 4: 1 base +
//  6 comunes + 4 raras + 2 épicas + 1 legendaria). Antes AvatarThumb.js (las
//  miniaturas PNG de listas/ranking) y AvatarTest.js (la pantalla DEV con
//  los .glb) tenían cada uno su propia copia del mismo orden de 14 — el
//  mismo tipo de "dos números que se separan" que TOTAL_PIECES ya evitó una
//  vez (ver Profile.js). Se centraliza aquí para que quien pinte lo que sea
//  (miniatura 2D, visor 3D en vivo) elija SIEMPRE el mismo diseño para el
//  mismo jugador vía variantIndexForSeed(seed, AVATARS.length).
// ============================================================================

export const AVATARS = [
  { key: 'base', label: 'BASE', rarity: 'base',
    glb: require('../assets/pilot/procesado/avatar_base.glb'),
    thumb: require('../assets/pilot/avatars/avatar-base.png') },
  { key: 'comun_1', label: 'COMÚN 1', rarity: 'comun',
    glb: require('../assets/pilot/procesado/avatar_comun_1.glb'),
    thumb: require('../assets/pilot/avatars/avatar-comun_1.png') },
  { key: 'comun_2', label: 'COMÚN 2', rarity: 'comun',
    glb: require('../assets/pilot/procesado/avatar_comun_2.glb'),
    thumb: require('../assets/pilot/avatars/avatar-comun_2.png') },
  { key: 'comun_3', label: 'COMÚN 3', rarity: 'comun',
    glb: require('../assets/pilot/procesado/avatar_comun_3.glb'),
    thumb: require('../assets/pilot/avatars/avatar-comun_3.png') },
  { key: 'comun_4', label: 'COMÚN 4', rarity: 'comun',
    glb: require('../assets/pilot/procesado/avatar_comun_4.glb'),
    thumb: require('../assets/pilot/avatars/avatar-comun_4.png') },
  { key: 'comun_5', label: 'COMÚN 5', rarity: 'comun',
    glb: require('../assets/pilot/procesado/avatar_comun_5.glb'),
    thumb: require('../assets/pilot/avatars/avatar-comun_5.png') },
  { key: 'comun_6', label: 'COMÚN 6', rarity: 'comun',
    glb: require('../assets/pilot/procesado/avatar_comun_6.glb'),
    thumb: require('../assets/pilot/avatars/avatar-comun_6.png') },
  { key: 'raro_1', label: 'RARO 1', rarity: 'rara',
    glb: require('../assets/pilot/procesado/avatar_raro_1.glb'),
    thumb: require('../assets/pilot/avatars/avatar-raro_1.png') },
  { key: 'raro_2', label: 'RARO 2', rarity: 'rara',
    glb: require('../assets/pilot/procesado/avatar_raro_2.glb'),
    thumb: require('../assets/pilot/avatars/avatar-raro_2.png') },
  { key: 'raro_3', label: 'RARO 3', rarity: 'rara',
    glb: require('../assets/pilot/procesado/avatar_raro_3.glb'),
    thumb: require('../assets/pilot/avatars/avatar-raro_3.png') },
  { key: 'raro_4', label: 'RARO 4', rarity: 'rara',
    glb: require('../assets/pilot/procesado/avatar_raro_4.glb'),
    thumb: require('../assets/pilot/avatars/avatar-raro_4.png') },
  { key: 'epico_1', label: 'ÉPICO 1', rarity: 'epica',
    glb: require('../assets/pilot/procesado/avatar_epico_1.glb'),
    thumb: require('../assets/pilot/avatars/avatar-epico_1.png') },
  { key: 'epico_2', label: 'ÉPICO 2', rarity: 'epica',
    glb: require('../assets/pilot/procesado/avatar_epico_2.glb'),
    thumb: require('../assets/pilot/avatars/avatar-epico_2.png') },
  { key: 'legendario', label: 'LEGENDARIO (textura provisional)', rarity: 'legendaria',
    glb: require('../assets/pilot/procesado/avatar_legendario.glb'),
    thumb: require('../assets/pilot/avatars/avatar-legendario.png') },
];

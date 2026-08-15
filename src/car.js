// ============================================================================
//  Car — catálogo de personalización del coche (garaje).
//
//  Todo lo que define QUÉ opciones existen vive aquí (sin React), para que
//  CarSprite (dibuja) y Garage (elige) lean del mismo sitio y nunca diverjan.
//  `locked: true` marca piezas premium — el CÓMO se desbloquean (racha,
//  ranking, sobres...) se decide más adelante; de momento solo se muestran
//  bloqueadas, como escaparate de lo que vendrá.
// ============================================================================

// chassis.js no importa nada, así que esto no crea ciclo. Con extensión .js
// a propósito: Metro no la necesita, pero Node sí, y tools/contact-sheet.mjs
// importa este archivo (misma convención que pieces.js -> track.js).
import { CHASSIS } from './chassis.js';
import { PACK_FRAMES } from './frames.js';

export const CAR_DEFAULTS = {
  chassis: 'gt', // id de CHASSIS (chassis.js); 'gt' es el coche de siempre
  bodyColor: '#f5c518', // amarillo de la paleta nueva
  wingShape: 'sin_aleron', // todos empiezan sin extras, nada equipado de fábrica
  // OJO: tiene que ser un color que EXISTA en CAR_COLORS. Antes era
  // '#0f1218' (el negro del splitter, tomado prestado), que no está en el
  // catálogo — y como el servidor solo acepta colores del catálogo, cualquier
  // usuario que no hubiera cambiado nunca el alerón NO PODÍA GUARDAR NADA del
  // garaje: save_loadout devolvía PIECE_NOT_OWNED: wing_color en cada toque.
  // Estuvo invisible porque el error se tragaba (ver Garage.apply).
  // Afectaba a 41 de 51 usuarios cuando se detectó.
  wingColor: '#17171a', // negro de la paleta nueva, libre y en catálogo
  frame: 'sin_marco', // id de FRAMES (frames.js) — marco de tu fila del ranking
  livery: null, // color de la franja (hex de CAR_COLORS), null = sin franja
  liveryPattern: 'simple', // id de LIVERY_PATTERNS
  // Mismo cuidado que con wingColor: tiene que EXISTIR en LIGHT_COLORS y ser
  // libre. Al rehacer los faros este valor era '#fff6cf', que dejó de estar
  // en el catálogo — y eso es exactamente lo que bloqueó a 41 de 51 usuarios
  // la vez anterior. Lo comprueba tools/check-catalog.mjs.
  lightsColor: '#f4f1e4',
};

// ============================================================================
//  PALETA — 20 colores, compartidos por carrocería, alerón y franja.
//
//  Los 8 LIBRES son colores nacionales de competición, no primarios de caja
//  de rotuladores. Cada uno tiene historia (verde británico, rosso corsa,
//  azul Francia, amarillo Bélgica...), que es lo que hace que elegir uno
//  signifique algo. La versión anterior era rojo/azul/verde genéricos más un
//  MARRÓN que no elige nadie para un coche de carreras: un hueco tirado.
//
//  Dos que se corrigen a propósito:
//   - El rojo libre viejo (#ff5c5c) era un salmón lavado y encima chocaba con
//     el rojo de marca (#e4002b): dos rojos distintos se leen como un fallo.
//     El rosso corsa tira a naranja, así que convive sin competir.
//   - El naranja viejo (#ff5a1f) era EXACTAMENTE el token "danger" del tema,
//     o sea un coche pintado del color de las alertas.
//  Y entra un gris grafito, que faltaba: el neutro medio es de los más usados
//  en motorsport y no había ninguno entre el blanco y el negro.
//
//  El campo "finish" decide cómo se pinta (ver CarSprite.js):
//    'flat'                   -> el hex de "c" tal cual.
//    'metalizado' / 'cromado' -> degradado ESTÁTICO a partir de "stops".
//    'holografico'            -> degradado que ROTA con el tiempo (sin timer
//                                nuevo: el coche ya se re-renderiza solo).
//  "c" es siempre el representante plano: es el hex que se guarda en
//  Supabase y por el que se localiza la pieza.
// ============================================================================
export const CAR_COLORS = [
  // --- Libres: colores nacionales de competición --------------------------
  { id: 'blanco', label: 'Blanco', c: '#f0eee8', locked: false, finish: 'flat' },
  { id: 'negro', label: 'Negro', c: '#17171a', locked: false, finish: 'flat' },
  { id: 'grafito', label: 'Grafito', c: '#6e737a', locked: false, finish: 'flat' },
  { id: 'rosso', label: 'Rosso corsa', c: '#d32b1e', locked: false, finish: 'flat' },
  { id: 'verde_britanico', label: 'Verde británico', c: '#1f5c3a', locked: false, finish: 'flat' },
  { id: 'azul_francia', label: 'Azul Francia', c: '#2b5fb8', locked: false, finish: 'flat' },
  { id: 'amarillo', label: 'Amarillo', c: '#f5c518', locked: false, finish: 'flat' },
  { id: 'naranja_gulf', label: 'Naranja Gulf', c: '#e8611a', locked: false, finish: 'flat' },

  // --- Metalizado (rara) ---------------------------------------------------
  // Veta de brillo satinada a lo largo del coche (ver highlightEllipses).
  { id: 'azul_metalizado', label: 'Azul metal.', c: '#3a6ea5', locked: true, finish: 'metalizado', rarity: 'rara',
    stops: ['#294e78', '#5c8dc2', '#3a6ea5', '#a9cdec', '#3a6ea5', '#1c3752'] },
  { id: 'verde_metalizado', label: 'Verde metal.', c: '#3f7a52', locked: true, finish: 'metalizado', rarity: 'rara',
    stops: ['#2c5a3c', '#4f9968', '#3a7a4f', '#a8dcb8', '#3a7a4f', '#204030'] },
  { id: 'burdeos_metalizado', label: 'Burdeos metal.', c: '#7a2038', locked: true, finish: 'metalizado', rarity: 'rara',
    stops: ['#4f1224', '#a33a55', '#7a2038', '#d98aa0', '#7a2038', '#360b18'] },
  { id: 'arena_metalizado', label: 'Arena metal.', c: '#a8894f', locked: true, finish: 'metalizado', rarity: 'rara',
    stops: ['#6f5729', '#c9a768', '#a8894f', '#ecd6a8', '#a8894f', '#4d3a18'] },

  // --- Cromado (épica) -----------------------------------------------------
  // Dos vetas, la de abajo más fina y nítida: reflejo duro de metal pulido.
  { id: 'oro', label: 'Oro cromado', c: '#d4af37', locked: true, finish: 'cromado', rarity: 'epica',
    stops: ['#7a5f16', '#e8c65a', '#fff3c4', '#e8c65a', '#a67f24', '#f5da8a', '#7a5f16', '#c99f2e'] },
  { id: 'plata', label: 'Plata cromada', c: '#c0c0c0', locked: true, finish: 'cromado', rarity: 'epica',
    stops: ['#6e6e6e', '#d8d8d8', '#ffffff', '#d8d8d8', '#8a8a8a', '#e8e8e8', '#6e6e6e', '#b0b0b0'] },
  { id: 'cobre', label: 'Cobre cromado', c: '#b06a3b', locked: true, finish: 'cromado', rarity: 'epica',
    stops: ['#6b3a1a', '#c9834f', '#f0c9a8', '#c9834f', '#8a5028', '#e0a878', '#6b3a1a', '#a06034'] },
  { id: 'acero', label: 'Acero cromado', c: '#5b5f66', locked: true, finish: 'cromado', rarity: 'epica',
    stops: ['#3d4046', '#7d828b', '#c4c8ce', '#7d828b', '#4a4e55', '#a8adb5', '#3d4046', '#5b5f66'] },

  // --- Holográfico (legendaria) -------------------------------------------
  // Cubren el cuerpo entero y el degradado ROTA: es lo que las separa de
  // cualquier otra cosa del catálogo a simple vista.
  { id: 'holo_arcoiris', label: 'Holo arcoíris', c: '#ff5c8a', locked: true, finish: 'holografico', rarity: 'legendaria',
    stops: ['#ff5c8a', '#ffb84d', '#f5e663', '#5ce8a0', '#5cc8ff', '#b884ff'] },
  { id: 'holo_aurora', label: 'Holo aurora', c: '#5ce87a', locked: true, finish: 'holografico', rarity: 'legendaria',
    stops: ['#5ce87a', '#f5e663', '#b884ff'] },
  { id: 'holo_laguna', label: 'Holo laguna', c: '#ff6fa8', locked: true, finish: 'holografico', rarity: 'legendaria',
    stops: ['#ff6fa8', '#5ce8e0', '#4fa9ff'] },
  { id: 'holo_magma', label: 'Holo magma', c: '#ffb84d', locked: true, finish: 'holografico', rarity: 'legendaria',
    stops: ['#ffb84d', '#ff4fa0', '#8a4fff'] },
];

// Busca la ficha de catálogo de un color por su hex guardado (loadout sigue
// guardando un hex plano, no un id — así no hace falta tocar la columna de
// Supabase). Si no está en el catálogo (color heredado/antiguo), degrada a
// plano con ese mismo hex.
export function findColorEntry(hex) {
  return CAR_COLORS.find((c) => c.c === hex) || { c: hex, finish: 'flat' };
}

// ============================================================================
//  ALERONES — 'sin_aleron' es el único libre; el resto salen en sobres.
//
//  El lote anterior (cuello cisne / GT / barrido / cola de pato) eran cuatro
//  rectángulos detrás del coche que solo se diferenciaban en dos milímetros
//  de largo: en el garaje, mirándolos fijamente, se notaba; en pista, no.
//  Ahora cada uno cambia la SILUETA, que es lo único que se lee en marcha.
//  La escalera va de discreto a bestia, para que subir de rareza se note.
// ============================================================================
export const WING_SHAPES = [
  { id: 'sin_aleron', label: 'Sin alerón', locked: false },
  { id: 'labio', label: 'Labio', locked: true, rarity: 'rara' },
  { id: 'gt', label: 'GT', locked: true, rarity: 'rara' },
  { id: 'cuello_cisne', label: 'Cuello cisne', locked: true, rarity: 'epica' },
  { id: 'biplano', label: 'Biplano', locked: true, rarity: 'legendaria' },
];

// ============================================================================
//  LIBREAS — el patrón de la franja. El COLOR no es propio de la librea:
//  reutiliza CAR_COLORS (mismo picker que carrocería y alerón).
//
//  Antes eran tres rayas y un número. Ahora las dos legendarias son las que
//  no se parecen a una raya: el galón y el damero se reconocen de un vistazo
//  incluso a tamaño de juego, que es lo que justifica su rareza.
// ============================================================================
export const LIVERY_PATTERNS = [
  { id: 'simple', label: 'Franja central', locked: false },
  { id: 'doble', label: 'Doble franja', locked: true, rarity: 'rara' },
  { id: 'flecha', label: 'Galón', locked: true, rarity: 'rara' },
  { id: 'numero', label: 'Dorsal', locked: true, rarity: 'epica' },
  { id: 'damero', label: 'Damero', locked: true, rarity: 'legendaria' },
];

// ============================================================================
//  FAROS — ahora son piezas de verdad, no un interruptor de dos posiciones.
//
//  Antes había tres entradas y una de ellas ('multicolor') estaba marcada
//  `locked` pero NO existía en catalog_pieces: no salía en ningún sobre, así
//  que era una pieza imposible de conseguir puesta ahí de adorno — y había
//  que excluirla a mano del recuento para que la colección no fuera
//  incompletable. Fuera; las bloqueadas de ahora sí se sortean.
//
//  Mismo mecanismo que los colores de carrocería: se guarda el hex en la
//  columna que ya existe (car_lights_color), sin columna nueva.
// ============================================================================
export const LIGHT_COLORS = [
  { id: 'blanco', label: 'Blanco', c: '#f4f1e4', locked: false },
  { id: 'ambar', label: 'Ámbar', c: '#ffb347', locked: false },
  { id: 'xenon', label: 'Xenón', c: '#a8d8ff', locked: true, rarity: 'rara' },
  { id: 'laser', label: 'Láser', c: '#c9a2ff', locked: true, rarity: 'epica' },
];

// ============================================================================
//  Total de piezas coleccionables — UNA fuente, calculada del catálogo.
//
//  Estaba escrito a mano (`const TOTAL_PIECES = 19`) en Tienda.js mientras
//  Profile.js lo calculaba. Al añadir los chasis, la tienda habría dicho
//  "22/19 piezas" y, peor, habría dado la colección por completa al llegar a
//  19 — apagando la compra con tres piezas todavía por salir.
//
//  Los FAROS ya SÍ entran: hasta ahora quedaban fuera porque su única pieza
//  bloqueada era imposible de conseguir (ver LIGHT_COLORS). Las nuevas se
//  sortean como cualquier otra, así que cuentan para la colección.
// ============================================================================
//  Los MARCOS entran por `PACK_FRAMES` y no por la lista entera: la Corona
//  mundial es un logro (no está en catalog_pieces, nunca sale en un sobre) y
//  contarla dejaría la colección en 27/28 para siempre.
export const COLLECTIBLE_CATALOGS = [CAR_COLORS, WING_SHAPES, LIVERY_PATTERNS, CHASSIS, LIGHT_COLORS];

export const TOTAL_PIECES =
  COLLECTIBLE_CATALOGS.flat().filter((p) => p.locked).length + PACK_FRAMES.length;

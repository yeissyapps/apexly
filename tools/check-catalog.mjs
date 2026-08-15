// ============================================================================
//  Comprobador del catálogo — evita la clase de bug que ya mordió dos veces.
//
//  HISTORIA (por eso existe): CAR_DEFAULTS.wingColor apuntaba a '#0f1218', un
//  hex que no estaba en CAR_COLORS. Como el servidor solo acepta colores del
//  catálogo y el garaje manda el loadout ENTERO en cada toque, 41 de 51
//  usuarios no podían guardar NADA del garaje — y el error se tragaba, así
//  que nadie lo vio. Al rehacer la paleta volvió a pasar exactamente igual
//  con bodyColor, y lo cazó este script antes de compilar.
//
//  La regla que comprueba es simple y es la que se rompe siempre: TODO valor
//  por defecto tiene que existir en el catálogo, y todo lo que el servidor
//  valida como "libre" tiene que coincidir con lo que el cliente ofrece como
//  libre. Si esas dos listas se separan, el jugador se queda bloqueado sin
//  ningún mensaje.
//
//  Uso:  node tools/check-catalog.mjs
//  Sale con código 1 si algo falla (sirve para encadenarlo antes de compilar).
// ============================================================================

import { readFileSync } from 'node:fs';
import { CAR_COLORS, WING_SHAPES, LIVERY_PATTERNS, LIGHT_COLORS, CAR_DEFAULTS, TOTAL_PIECES } from '../src/car.js';
import { CHASSIS } from '../src/chassis.js';
import { FRAMES, PACK_FRAMES } from '../src/frames.js';

let fails = 0;
const fail = (msg) => { console.log('  FALLO  ' + msg); fails++; };
const ok = (msg) => console.log('  ok     ' + msg);

console.log('\nCATÁLOGO');
const hexes = CAR_COLORS.map((c) => c.c);
const ids = CAR_COLORS.map((c) => c.id);
if (new Set(ids).size !== ids.length) fail('hay ids de color repetidos');
else ok(`${ids.length} colores con id único`);
if (new Set(hexes).size !== hexes.length) fail('hay hex de color repetidos (el servidor localiza la pieza por hex)');
else ok('todos los hex son distintos');

for (const c of CAR_COLORS) {
  if (!/^#[0-9a-f]{6}$/i.test(c.c)) fail(`hex mal formado en ${c.id}: ${c.c}`);
  if (c.finish !== 'flat' && !(c.stops && c.stops.length >= 3)) fail(`${c.id} es ${c.finish} pero no trae stops`);
}

console.log('\nVALORES POR DEFECTO (la trampa que ya falló dos veces)');
if (!hexes.includes(CAR_DEFAULTS.bodyColor)) fail(`bodyColor ${CAR_DEFAULTS.bodyColor} no está en la paleta`);
else ok('bodyColor existe en la paleta');
if (!hexes.includes(CAR_DEFAULTS.wingColor)) fail(`wingColor ${CAR_DEFAULTS.wingColor} no está en la paleta`);
else ok('wingColor existe en la paleta');
if (CAR_DEFAULTS.livery !== null && !hexes.includes(CAR_DEFAULTS.livery)) fail('livery por defecto no está en la paleta');
else ok('livery por defecto válido');
if (!WING_SHAPES.some((w) => w.id === CAR_DEFAULTS.wingShape)) fail('wingShape por defecto no existe');
else ok('wingShape por defecto existe');
if (!LIVERY_PATTERNS.some((l) => l.id === CAR_DEFAULTS.liveryPattern)) fail('liveryPattern por defecto no existe');
else ok('liveryPattern por defecto existe');
if (!CHASSIS.some((c) => c.id === CAR_DEFAULTS.chassis)) fail('chassis por defecto no existe');
else ok('chassis por defecto existe');
if (!FRAMES.some((f) => f.id === CAR_DEFAULTS.frame)) fail('frame por defecto no existe');
else ok('frame por defecto existe');

// Todo lo que es por defecto tiene que ser LIBRE, o el usuario nuevo nace
// con una pieza que el servidor le va a rechazar.
const freeHex = CAR_COLORS.filter((c) => !c.locked).map((c) => c.c);
for (const [k, v] of [['bodyColor', CAR_DEFAULTS.bodyColor], ['wingColor', CAR_DEFAULTS.wingColor]]) {
  if (!freeHex.includes(v)) fail(`${k} por defecto (${v}) NO es un color libre`);
}
if (WING_SHAPES.find((w) => w.id === CAR_DEFAULTS.wingShape)?.locked) fail('wingShape por defecto está bloqueado');
if (CHASSIS.find((c) => c.id === CAR_DEFAULTS.chassis)?.locked) fail('chassis por defecto está bloqueado');
if (FRAMES.find((f) => f.id === CAR_DEFAULTS.frame)?.locked) fail('frame por defecto está bloqueado');

console.log('\nCLIENTE vs SERVIDOR');
// La lista de colores libres está escrita a mano en el SQL: si se separa de
// la del cliente, el jugador ve un color que no puede equipar.
// Se lee palette_v2.sql porque es la migración MÁS RECIENTE que redefine
// save_loadout: es la que manda sobre la lista de colores libres del
// servidor. Si algún día hay otra posterior, hay que apuntar aquí.
const sql = readFileSync(new URL('../supabase/palette_v2.sql', import.meta.url), 'utf8');
const m = sql.match(/v_free_colors\s+text\[\]\s*:=\s*array\[([^\]]+)\]/);
if (!m) fail('no encuentro v_free_colors en supabase/frames.sql');
else {
  const sqlFree = m[1].split(',').map((s) => s.trim().replace(/'/g, '').toLowerCase());
  const cliFree = freeHex.map((h) => h.toLowerCase());
  const faltan = cliFree.filter((h) => !sqlFree.includes(h));
  const sobran = sqlFree.filter((h) => !cliFree.includes(h));
  if (faltan.length) fail(`el SQL no acepta colores que el cliente ofrece: ${faltan.join(', ')}`);
  if (sobran.length) fail(`el SQL acepta colores que ya no existen: ${sobran.join(', ')}`);
  if (!faltan.length && !sobran.length) ok(`los ${cliFree.length} colores libres coinciden con el SQL`);
}

console.log('\nCOLECCIÓN');
const packable =
  CAR_COLORS.filter((c) => c.locked).length +
  WING_SHAPES.filter((w) => w.locked).length +
  LIVERY_PATTERNS.filter((l) => l.locked).length +
  CHASSIS.filter((c) => c.locked).length +
  PACK_FRAMES.length;
if (packable !== TOTAL_PIECES) fail(`TOTAL_PIECES=${TOTAL_PIECES} pero hay ${packable} piezas sorteables`);
else ok(`TOTAL_PIECES = ${TOTAL_PIECES} y cuadra con las piezas sorteables`);
// Una pieza bloqueada que no pueda salir en un sobre deja la colección
// imposible de completar (le pasa a los faros y a la corona, a propósito).
const lockedLights = LIGHT_COLORS.filter((l) => l.locked).length;
if (lockedLights) ok(`${lockedLights} faro(s) bloqueado(s) fuera del recuento, correcto`);
if (FRAMES.some((f) => f.achievement)) ok('la corona es logro y queda fuera del recuento, correcto');

console.log(fails ? `\n${fails} PROBLEMA(S)\n` : '\nCatálogo coherente\n');
process.exit(fails ? 1 : 0);

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
// Los faros pasaron a ser catálogo con hex propio, así que caen en la misma
// trampa que la carrocería: al rehacerlos, '#fff6cf' dejó de existir.
if (!LIGHT_COLORS.some((l) => l.c === CAR_DEFAULTS.lightsColor)) fail(`lightsColor ${CAR_DEFAULTS.lightsColor} no está en el catálogo de faros`);
else ok('lightsColor existe en el catálogo de faros');

// Todo lo que es por defecto tiene que ser LIBRE, o el usuario nuevo nace
// con una pieza que el servidor le va a rechazar.
const freeHex = CAR_COLORS.filter((c) => !c.locked).map((c) => c.c);
for (const [k, v] of [['bodyColor', CAR_DEFAULTS.bodyColor], ['wingColor', CAR_DEFAULTS.wingColor]]) {
  if (!freeHex.includes(v)) fail(`${k} por defecto (${v}) NO es un color libre`);
}
if (WING_SHAPES.find((w) => w.id === CAR_DEFAULTS.wingShape)?.locked) fail('wingShape por defecto está bloqueado');
if (CHASSIS.find((c) => c.id === CAR_DEFAULTS.chassis)?.locked) fail('chassis por defecto está bloqueado');
if (FRAMES.find((f) => f.id === CAR_DEFAULTS.frame)?.locked) fail('frame por defecto está bloqueado');
if (LIVERY_PATTERNS.find((l) => l.id === CAR_DEFAULTS.liveryPattern)?.locked) fail('liveryPattern por defecto está bloqueado');
if (LIGHT_COLORS.find((l) => l.c === CAR_DEFAULTS.lightsColor)?.locked) fail('lightsColor por defecto está bloqueado');

console.log('\nCLIENTE vs SERVIDOR');
// La lista de colores libres está escrita a mano en el SQL: si se separa de
// la del cliente, el jugador ve un color que no puede equipar.
// Se lee pieces_v2.sql porque es la migración MÁS RECIENTE que redefine
// save_loadout: es la que manda sobre las listas de piezas libres del
// servidor. Si algún día hay otra posterior, hay que apuntar aquí.
const sql = readFileSync(new URL('../supabase/pieces_v2.sql', import.meta.url), 'utf8');

// Compara una lista `array[...]` del SQL contra la del cliente. Se hizo
// genérica al añadir los faros: la de colores llevaba meses escrita a mano y
// ya se había desincronizado una vez.
function compareList(name, cliente) {
  const m = sql.match(new RegExp(name + "\\s+text\\[\\]\\s*:=\\s*array\\[([^\\]]+)\\]"));
  if (!m) { fail(`no encuentro ${name} en el SQL`); return; }
  const enSql = m[1].split(',').map((s) => s.trim().replace(/'/g, '').toLowerCase());
  const cli = cliente.map((h) => String(h).toLowerCase());
  const faltan = cli.filter((h) => !enSql.includes(h));
  const sobran = enSql.filter((h) => !cli.includes(h));
  if (faltan.length) fail(`${name}: el SQL no acepta lo que el cliente ofrece: ${faltan.join(', ')}`);
  if (sobran.length) fail(`${name}: el SQL acepta lo que ya no existe: ${sobran.join(', ')}`);
  if (!faltan.length && !sobran.length) ok(`${name}: ${cli.length} coinciden con el SQL`);
}

compareList('v_free_colors', freeHex);
compareList('v_free_lights', LIGHT_COLORS.filter((l) => !l.locked).map((l) => l.c));

// Las piezas bloqueadas tienen que estar EN catalog_pieces o son imposibles
// de conseguir (le pasaba al faro 'multicolor'). Se comprueba contra los
// inserts del propio SQL.
for (const [cat, list] of [['wing', WING_SHAPES], ['livery', LIVERY_PATTERNS], ['light', LIGHT_COLORS]]) {
  // Con regex y no con includes(): los inserts van alineados en columnas, así
  // que entre la categoría y el id hay varios espacios.
  const enSql = (id) => new RegExp(`'${cat}'\\s*,\\s*'${id}'`).test(sql);
  const faltan = list.filter((p) => p.locked && !enSql(p.id)).map((p) => p.id);
  if (faltan.length) fail(`${cat}: bloqueadas que no se sortean en ningún sobre: ${faltan.join(', ')}`);
  else ok(`${cat}: todas las bloqueadas están en catalog_pieces`);
}

console.log('\nCOLECCIÓN');
const packable =
  CAR_COLORS.filter((c) => c.locked).length +
  WING_SHAPES.filter((w) => w.locked).length +
  LIVERY_PATTERNS.filter((l) => l.locked).length +
  CHASSIS.filter((c) => c.locked).length +
  LIGHT_COLORS.filter((l) => l.locked).length +
  PACK_FRAMES.length;
if (packable !== TOTAL_PIECES) fail(`TOTAL_PIECES=${TOTAL_PIECES} pero hay ${packable} piezas sorteables`);
else ok(`TOTAL_PIECES = ${TOTAL_PIECES} y cuadra con las piezas sorteables`);
if (FRAMES.some((f) => f.achievement)) ok('la corona es logro y queda fuera del recuento, correcto');

console.log(fails ? `\n${fails} PROBLEMA(S)\n` : '\nCatálogo coherente\n');
process.exit(fails ? 1 : 0);

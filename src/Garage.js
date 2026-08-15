// ============================================================================
//  Garaje — personalización del coche (carrocería, alerón, librea, faros).
//
//  QUÉ SE ARREGLÓ EN EL REDISEÑO (la versión anterior funcionaba, pero no
//  contaba nada):
//
//  1. LA RAREZA ERA INVISIBLE. El catálogo de car.js lleva `rarity` desde que
//     se diseñó (rara/épica/legendaria) y aquí TODAS las piezas bloqueadas se
//     pintaban igual: opacidad 0.3 y un candado rojo. Una legendaria
//     holográfica se veía exactamente igual que una rara metalizada, así que
//     no había nada que codiciar. Ahora cada pieza lleva el color de su
//     rareza —el MISMO que anuncia la Tienda— y van agrupadas por rareza con
//     su contador.
//
//  2. ERA UN MURO DE CUADRADOS IGUALES. ~40 swatches idénticos seguidos, sin
//     jerarquía: nada decía por dónde empezar a mirar. Agrupar por rareza le
//     da estructura y de paso convierte la pantalla en un mapa de colección
//     ("me faltan 4 épicas") en vez de una paleta de colores.
//
//  3. ERA UN CALLEJÓN SIN SALIDA. Decía "abre sobres para desbloquear" sin
//     ninguna forma de ir a la tienda. Ahora hay botón.
//
//  4. SE REPINTABA ENTERO 20 VECES POR SEGUNDO. El plato giratorio guardaba
//     el ángulo en el estado del Garaje (`setSpin` cada 50 ms), así que cada
//     giro re-renderizaba también los ~40 swatches y sus Pressables. El giro
//     vive ahora dentro de <Showcase>, memoizado: solo se repinta el coche.
// ============================================================================

import { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

import DangerStripe from './DangerStripe';
import CarSprite from './CarSprite';
import { RD, RD_FONT, RARITY_COLOR, RARITY_LABEL } from './theme';
import { CAR_DEFAULTS, CAR_COLORS, WING_SHAPES, LIVERY_PATTERNS, LIGHT_COLORS, TOTAL_PIECES } from './car';
import { CHASSIS } from './chassis';
import { FRAMES, PACK_FRAMES, frameStyle, frameGlyphColor } from './frames';
import { getMyLoadout, saveLoadout, getInventory } from './api';

// Con 5 pestañas cada una tiene ~70dp: "CARROCERÍA" partía en dos líneas y
// descuadraba la fila entera. "PINTURA" dice lo mismo (es el color del
// cuerpo) y cabe — todas las etiquetas se mantienen en 7 caracteres o menos.
const TABS = [
  { id: 'chassis', label: 'CHASIS' },
  { id: 'body', label: 'PINTURA' },
  { id: 'wing', label: 'ALERÓN' },
  { id: 'livery', label: 'LIBREA' },
  { id: 'lights', label: 'FAROS' },
  { id: 'frame', label: 'MARCO' },
];

// Orden de los grupos: primero lo que puedes usar ya, luego la escalera de
// rareza. Al revés, la pantalla abriría con lo que NO tienes.
const GROUP_ORDER = [null, 'rara', 'epica', 'legendaria'];
const GROUP_LABEL = { null: 'LIBRES', rara: 'RARAS', epica: 'ÉPICAS', legendaria: 'LEGENDARIAS' };

// A partir de cuántas piezas compensa agrupar por rareza. Con los 20 colores
// de carrocería, agrupar da estructura y convierte la lista en un mapa de
// colección. Pero alerón tiene 5 piezas y librea 4, repartidas en las mismas
// 4 rarezas: salían CUATRO cabeceras para cuatro piezas, una por pieza. Por
// debajo de este umbral van en una sola fila, y la rareza sigue leyéndose en
// el marco de cada pieza (que es donde de verdad importa).
const GROUP_MIN = 8;

// --- Suelo del garaje: plato giratorio, visto DESDE ARRIBA -------------------
//  Aquí hubo un error de bulto que merece quedar escrito. Se dibujó un suelo
//  en PERSPECTIVA de un punto (con horizonte y filas estrechándose al fondo)
//  debajo de un coche que está dibujado CENITAL, visto desde arriba. Son dos
//  proyecciones incompatibles en el mismo cuadro: el suelo se alejaba y el
//  coche no, así que el coche parecía recortado y pegado encima en vez de
//  estar apoyado — justo lo contrario de lo que se buscaba.
//
//  El sprite del coche es el MISMO del juego (vista cenital) y no se puede
//  cambiar, así que manda él: el suelo tiene que ser cenital también. Un
//  plato giratorio visto desde arriba —anillos concéntricos, borde a cuadros,
//  marcas radiales— es coherente con esa vista y además explica por qué el
//  coche da vueltas, cosa que antes no explicaba nada.
const CX = 100;
const CY = 70;
const RING_IN = 49;
const RING_OUT = 57;
const RING_SEGMENTS = 24;

const polar = (r, a) =>
  `${(CX + r * Math.cos(a)).toFixed(2)},${(CY + r * Math.sin(a)).toFixed(2)}`;

// Borde a cuadros del plato: un sector de corona por segmento (arco exterior
// de ida, arco interior de vuelta).
const RING_QUADS = [];
for (let i = 0; i < RING_SEGMENTS; i += 2) {
  const a0 = (i * 2 * Math.PI) / RING_SEGMENTS;
  const a1 = ((i + 1) * 2 * Math.PI) / RING_SEGMENTS;
  RING_QUADS.push(
    `M${polar(RING_OUT, a0)} A${RING_OUT},${RING_OUT} 0 0 1 ${polar(RING_OUT, a1)}` +
      ` L${polar(RING_IN, a1)} A${RING_IN},${RING_IN} 0 0 0 ${polar(RING_IN, a0)} Z`,
  );
}

// Marcas radiales en cruz, como las guías de un plato de taller.
const TICKS = [0, 90, 180, 270].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return {
    x1: CX + 20 * Math.cos(a), y1: CY + 20 * Math.sin(a),
    x2: CX + 44 * Math.cos(a), y2: CY + 44 * Math.sin(a),
  };
});

// Escaparate memoizado: se queda con el giro para él solo (ver punto 4 de la
// cabecera). Solo se repinta cuando cambia la pieza que se está mirando.
const Showcase = memo(function Showcase({ loadout }) {
  const [spin, setSpin] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSpin((d) => (d + 0.9) % 360), 50);
    return () => clearInterval(id);
  }, []);

  return (
    <Svg width="100%" height={200} viewBox="0 0 200 140">
      <Rect x={0} y={0} width={200} height={140} fill="#0d0d0f" />
      <Circle cx={CX} cy={CY} r={RING_OUT} fill="#161618" />
      {RING_QUADS.map((d, i) => (
        <Path key={i} d={d} fill={RD.cream} opacity={0.45} />
      ))}
      <Circle cx={CX} cy={CY} r={RING_IN} fill="#121214" />
      <Circle cx={CX} cy={CY} r={36} fill="none" stroke={RD.panelBorder} strokeWidth={0.8} />
      <Circle cx={CX} cy={CY} r={20} fill="none" stroke={RD.panelBorder} strokeWidth={0.8} />
      {TICKS.map((t, i) => (
        <Line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={RD.panelBorder} strokeWidth={0.8} />
      ))}
      {/* Sombra CENITAL: centrada bajo el coche, no una elipse aplastada
          "de suelo" (eso solo tiene sentido mirando desde un lado). */}
      <Ellipse cx={CX + 2} cy={CY + 3} rx={25} ry={19} fill="#000000" opacity={0.38} />
      {/* OJO con la escala: el coche NO se escala con el alto del <Svg>, que
          el viewBox es fijo (200x140). A 3.4 llenaba el marco entero. */}
      <CarSprite x={CX} y={CY} deg={spin} scale={2.5} loadout={loadout} />
    </Svg>
  );
});

// Candado dibujado (nada de emoji, mismo lenguaje técnico que el resto del
// juego): arco de la grapa + cuerpo sólido.
function LockIcon({ color }) {
  return (
    <Svg width={12} height={12} viewBox="0 0 16 16">
      <Path d="M4,7 V5 A4,4 0 0,1 12,5 V7" fill="none" stroke={color} strokeWidth={1.9} />
      <Rect x={3} y={7} width={10} height={7} rx={1.5} fill={color} />
    </Svg>
  );
}

// Muestra de CHASIS: a diferencia del resto de piezas, aquí lo que se elige
// es una SILUETA, no un color. Un cuadrado de color no dice nada, así que la
// muestra dibuja el propio contorno del chasis.
function ChassisSwatch({ ch, isSelected, isPreviewing, isLocked, onPress }) {
  const rc = ch.rarity ? RARITY_COLOR[ch.rarity] : null;
  const stroke = isPreviewing ? RD.brand : isSelected ? '#ffffff' : (rc || RD.textTertiary);
  return (
    <Pressable style={s.chassisWrap} onPress={onPress}>
      <View
        style={[
          s.chassisBox,
          rc && { borderColor: rc },
          isSelected && s.swatchSelected,
          isPreviewing && s.swatchPreviewing,
        ]}
      >
        {/* El coche se dibuja apuntando a +x (derecha) y aquí interesa verlo
            de morro hacia arriba, como en pista, así que se gira -90°.
            OJO CON EL viewBox: al girar, el largo del coche (~33) pasa a
            necesitar ALTO, no ancho. Con el viewBox apaisado de antes
            (40x24) se comía morro y cola y las cuatro siluetas parecían el
            mismo tocho. Va en vertical y con margen para el alerón. */}
        <Svg width="100%" height={54} viewBox="-11 -19 22 38">
          <G transform="rotate(-90)">
            {(ch.extras || []).map((r, i) => (
              <Rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} rx={r.rx}
                fill={isLocked ? RD.textDisabled : stroke} opacity={isLocked ? 0.5 : 0.9} />
            ))}
            <Path d={ch.body} fill={isLocked ? RD.textDisabled : stroke} opacity={isLocked ? 0.5 : 0.9} />
            <Rect {...ch.cabin} fill={RD.bg} opacity={0.55} />
          </G>
        </Svg>
        {isLocked && !isPreviewing && (
          <View style={s.chassisLock} pointerEvents="none"><LockIcon color={rc || RD.brand} /></View>
        )}
        {!isLocked && rc && <View style={[s.ownedPip, { backgroundColor: rc }]} pointerEvents="none" />}
      </View>
      <Text style={[s.swatchLabel, isPreviewing && s.swatchLabelPreviewing, !isLocked && rc && { color: rc }]}>
        {isPreviewing ? 'Mirando' : ch.label}
      </Text>
    </Pressable>
  );
}

function Swatch({ opt, value, isSelected, isPreviewing, isLocked, onPress, wrapStyle }) {
  const rc = opt.rarity ? RARITY_COLOR[opt.rarity] : null;
  return (
    <Pressable style={[s.swatchWrap, wrapStyle]} onPress={onPress}>
      <View style={s.swatchStack}>
        <View
          style={[
            s.swatch,
            { backgroundColor: opt.c || RD.gridLine },
            // Marco por rareza: es lo que distingue de un vistazo una épica
            // de una rara, y usa el mismo código de color que la Tienda.
            rc && { borderColor: rc },
            isLocked && s.swatchLocked,
            isSelected && s.swatchSelected,
            isPreviewing && s.swatchPreviewing,
          ]}
        />
        {isLocked && !isPreviewing && (
          <View style={s.lockBadge} pointerEvents="none">
            <LockIcon color={rc || RD.brand} />
          </View>
        )}
        {/* Marca de "ya es tuya": una pieza premium desbloqueada tiene que
            verse distinta de una libre, o el sobre no se siente premiado. */}
        {!isLocked && rc && (
          <View style={[s.ownedPip, { backgroundColor: rc }]} pointerEvents="none" />
        )}
      </View>
      <Text
        style={[
          s.swatchLabel,
          isPreviewing && s.swatchLabelPreviewing,
          !isLocked && rc && { color: rc },
        ]}
        numberOfLines={2}
      >
        {isPreviewing ? 'Mirando' : (opt.label || '')}
      </Text>
    </Pressable>
  );
}

function PieceGrid({ field, category, options, selected, getValue = (o) => o.c, owned, preview, onPreview, onSelect }) {
  // Agrupa por rareza conservando el orden del catálogo dentro de cada grupo.
  const groups = useMemo(() => {
    const by = new Map();
    for (const opt of options) {
      const key = opt.rarity || null;
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(opt);
    }
    return GROUP_ORDER.filter((k) => by.has(k)).map((k) => ({ rarity: k, items: by.get(k) }));
  }, [options]);

  const isOwned = (opt) =>
    !opt.locked || !!(category && owned?.has(`${category}:${opt.id}`));

  const renderSwatch = (opt, wrapStyle) => {
    const value = getValue(opt);
    const locked = !isOwned(opt);
    return (
      <Swatch
        key={String(opt.id)}
        opt={opt}
        value={value}
        isSelected={!preview && value === selected}
        isPreviewing={!!preview && preview.field === field && preview.value === value}
        isLocked={locked}
        wrapStyle={wrapStyle}
        onPress={() => (locked ? onPreview(field, value) : onSelect(value))}
      />
    );
  };

  // Pocas piezas: una sola fila, sin cabeceras. `flex: 1` en cada hueco en
  // vez de ancho fijo para que entren siempre, sean 3, 4 o 5.
  if (options.length < GROUP_MIN) {
    return <View style={s.singleRow}>{options.map((opt) => renderSwatch(opt, s.swatchFlex))}</View>;
  }

  return (
    <View style={{ gap: 14 }}>
      {groups.map(({ rarity, items }) => {
        const have = items.filter(isOwned).length;
        const rc = rarity ? RARITY_COLOR[rarity] : RD.textTertiary;
        return (
          <View key={String(rarity)} style={{ gap: 10 }}>
            <View style={s.groupHeader}>
              <Text style={[s.groupLabel, { color: rc }]}>{GROUP_LABEL[String(rarity)]}</Text>
              <View style={[s.groupRule, { backgroundColor: rc, opacity: 0.25 }]} />
              <Text style={s.groupCount}>
                {rarity ? `${have}/${items.length}` : items.length}
              </Text>
            </View>
            <View style={s.grid}>{items.map((opt) => renderSwatch(opt))}</View>
          </View>
        );
      })}
    </View>
  );
}

export default function Garage({ onBack, onOpenTienda, nickname }) {
  const [loadout, setLoadout] = useState(CAR_DEFAULTS);
  const [tab, setTab] = useState('body');
  const [preview, setPreview] = useState(null); // { field, value } de una pieza bloqueada, o null
  const [saveError, setSaveError] = useState(null);
  const [owned, setOwned] = useState(new Set()); // "categoria:pieza" que ya tienes (sobres)

  useEffect(() => {
    getMyLoadout().then(setLoadout).catch(() => {});
    getInventory()
      .then((items) => setOwned(new Set(items.map((p) => `${p.category}:${p.pieceId}`))))
      .catch(() => {});
  }, []);

  function apply(patch) {
    setPreview(null);
    Haptics.selectionAsync().catch(() => {});
    const next = { ...loadout, ...patch };
    setLoadout(next);
    setSaveError(null);
    // NO tragarse el fallo. Cuando esto era `.catch(() => {})`, el garaje
    // enseñaba el cambio aplicado mientras el servidor lo rechazaba: 41 de 51
    // usuarios llevaban sin poder guardar nada y no había forma de saberlo
    // (ver el comentario de wingColor en car.js). Si el guardado falla, el
    // coche vuelve a como estaba y se dice — mentir es peor que fallar.
    saveLoadout(next).catch((e) => {
      setLoadout(loadout);
      const msg = String(e?.message || '');
      setSaveError(
        msg.includes('PIECE_NOT_OWNED')
          ? 'Esa pieza todavía no es tuya.'
          : 'No se pudo guardar. Comprueba la conexión.',
      );
    });
  }

  // Toca una pieza bloqueada: se ve en el coche un momento, pero no se guarda
  // ni sustituye lo que llevas puesto de verdad.
  function previewLocked(field, value) {
    Haptics.selectionAsync().catch(() => {});
    setPreview({ field, value });
  }

  function selectTab(id) {
    setPreview(null);
    setTab(id);
  }

  const displayLoadout = preview ? { ...loadout, [preview.field]: preview.value } : loadout;

  // Cuántas piezas premium tienes, para la línea de progreso. El TOTAL sale
  // de car.js (una sola fuente); aquí solo se cuenta cuántas son tuyas, y
  // hay que recorrer las 4 categorías o el chasis no contaría.
  const premiumOwned = [
    ...CAR_COLORS.map((o) => ['color', o]),
    ...WING_SHAPES.map((o) => ['wing', o]),
    ...LIVERY_PATTERNS.map((o) => ['livery', o]),
    ...CHASSIS.map((o) => ['chassis', o]),
    ...LIGHT_COLORS.map((o) => ['light', o]),
    // PACK_FRAMES y no FRAMES: la Corona es un logro y no entra en
    // TOTAL_PIECES, así que contarla daría un 29/28 a quien la tenga.
    ...PACK_FRAMES.map((o) => ['frame', o]),
  ].filter(([cat, o]) => o.locked && owned.has(`${cat}:${o.id}`)).length;

  return (
    <View style={s.screen}>
      <StatusBar hidden />
      <DangerStripe height={6} />
      <ScrollView contentContainerStyle={s.content}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={s.backLink}>‹ INICIO</Text>
        </Pressable>

        <View style={s.titleRow}>
          <Text style={s.pageTitle}>Garaje</Text>
          <Text style={s.collectionCount}>{premiumOwned}/{TOTAL_PIECES} piezas</Text>
        </View>
        <Text style={s.disclaimer}>Solo estético — no afecta al rendimiento del coche</Text>
        {!!saveError && <Text style={s.saveError}>{saveError}</Text>}

        <View style={s.preview}>
          <Showcase loadout={displayLoadout} />
          {preview && (
            <View style={s.previewBadge}>
              <Text style={s.previewBadgeText}>SOLO ESTÁS MIRANDO — NO ES TUYA</Text>
              <Pressable onPress={onOpenTienda} hitSlop={8}>
                <Text style={s.previewBadgeLink}>CONSEGUIR ›</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={s.tabsRow}>
          {TABS.map((t) => (
            <Pressable
              key={t.id}
              style={[s.tab, tab === t.id && s.tabActive]}
              onPress={() => selectTab(t.id)}
            >
              {/* numberOfLines + adjustsFontSizeToFit: si algún día una
                  etiqueta crece, encoge en vez de partirse y descuadrar la
                  fila (que es lo que pasó al meter la 5.ª pestaña). */}
              <Text
                style={[s.tabText, tab === t.id && s.tabTextActive]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === 'chassis' && (
          <View style={s.singleRow}>
            {CHASSIS.map((c) => {
              const locked = c.locked && !owned.has(`chassis:${c.id}`);
              return (
                <ChassisSwatch
                  key={c.id}
                  ch={c}
                  isSelected={!preview && loadout.chassis === c.id}
                  isPreviewing={!!preview && preview.field === 'chassis' && preview.value === c.id}
                  isLocked={locked}
                  onPress={() => (locked ? previewLocked('chassis', c.id) : apply({ chassis: c.id }))}
                />
              );
            })}
          </View>
        )}

        {tab === 'body' && (
          <PieceGrid
            field="bodyColor"
            category="color"
            options={CAR_COLORS}
            selected={loadout.bodyColor}
            owned={owned}
            preview={preview}
            onPreview={previewLocked}
            onSelect={(c) => apply({ bodyColor: c })}
          />
        )}

        {tab === 'wing' && (
          <>
            <Text style={s.sectionLabel}>FORMA</Text>
            <PieceGrid
              field="wingShape"
              category="wing"
              options={WING_SHAPES}
              selected={loadout.wingShape}
              getValue={(o) => o.id}
              owned={owned}
              preview={preview}
              onPreview={previewLocked}
              onSelect={(id) => apply({ wingShape: id })}
            />
            <Text style={s.sectionLabel}>COLOR</Text>
            <PieceGrid
              field="wingColor"
              category="color"
              options={CAR_COLORS}
              selected={loadout.wingColor}
              owned={owned}
              preview={preview}
              onPreview={previewLocked}
              onSelect={(c) => apply({ wingColor: c })}
            />
          </>
        )}

        {tab === 'livery' && (
          <>
            <Text style={s.sectionLabel}>PATRÓN</Text>
            <PieceGrid
              field="liveryPattern"
              category="livery"
              options={LIVERY_PATTERNS}
              selected={loadout.liveryPattern}
              getValue={(o) => o.id}
              owned={owned}
              preview={preview}
              onPreview={previewLocked}
              onSelect={(id) => apply({ liveryPattern: id })}
            />
            <Text style={s.sectionLabel}>COLOR</Text>
            <PieceGrid
              field="livery"
              category="color"
              options={[{ id: 'sin_franja', label: 'Sin franja', c: null, locked: false }, ...CAR_COLORS]}
              selected={loadout.livery}
              getValue={(o) => (o.id === 'sin_franja' ? null : o.c)}
              owned={owned}
              preview={preview}
              onPreview={previewLocked}
              onSelect={(c) => apply({ livery: c })}
            />
          </>
        )}

        {tab === 'frame' && (
          <View style={{ gap: 10 }}>
            <Text style={s.frameHint}>
              Es la única pieza que ven los demás: se pinta en tu fila del ranking.
            </Text>
            {FRAMES.map((f) => {
              const locked = f.locked && !owned.has(`frame:${f.id}`);
              const selected = !preview && (loadout.frame || 'sin_marco') === f.id;
              const previewing = !!preview && preview.field === 'frame' && preview.value === f.id;
              const rc = f.rarity ? RARITY_COLOR[f.rarity] : null;
              return (
                <Pressable
                  key={f.id}
                  onPress={() => (locked ? previewLocked('frame', f.id) : apply({ frame: f.id }))}
                >
                  {/* La muestra ES una fila de ranking de mentira: un swatch
                      abstracto no diría dónde acaba apareciendo esto. */}
                  <View style={[s.frameRow, frameStyle(f, RD), locked && s.frameRowLocked, selected && s.frameRowSelected, previewing && s.frameRowPreviewing]}>
                    <Text style={s.frameRank}>01</Text>
                    <Text style={s.frameNick}>{nickname || 'Tú'}</Text>
                    {!!f.glyph && <Text style={{ color: frameGlyphColor(f, RD), fontSize: 13 }}>{f.glyph}</Text>}
                    <View style={{ flex: 1 }} />
                    {locked && <LockIcon color={rc || RD.brand} />}
                  </View>
                  <View style={s.frameMeta}>
                    <Text style={[s.frameLabel, !locked && rc && { color: rc }]}>{f.label}</Text>
                    <Text style={[s.frameTier, rc && { color: rc }]}>
                      {f.achievement ? 'LOGRO · 1.º DEL MUNDO' : f.rarity ? f.rarity.toUpperCase() : 'LIBRE'}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        {tab === 'lights' && (
          <PieceGrid
            field="lightsColor"
            // Con `category` los faros bloqueados se comprueban contra el
            // inventario, como el resto. Sin ella, PieceGrid daba por tuya
            // cualquier pieza bloqueada — daba igual mientras el único faro
            // bloqueado era inconseguible, pero ahora se ganan en sobres.
            category="light"
            options={LIGHT_COLORS}
            selected={loadout.lightsColor}
            owned={owned}
            preview={preview}
            onPreview={previewLocked}
            onSelect={(c) => apply({ lightsColor: c })}
          />
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RD.bg },
  content: { paddingHorizontal: 18, paddingTop: 50, paddingBottom: 40, gap: 16 },
  backLink: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono, marginBottom: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  pageTitle: {
    color: RD.textPrimary, fontSize: 28, fontFamily: RD_FONT.displayBlack,
    textTransform: 'uppercase',
  },
  collectionCount: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono },
  disclaimer: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono, marginBottom: -4 },
  saveError: { color: RD.danger, fontSize: 11, fontFamily: RD_FONT.monoBold, marginBottom: -4 },
  sectionLabel: {
    color: RD.textTertiary, fontSize: 10, fontFamily: RD_FONT.mono,
    letterSpacing: 0.8, marginBottom: -6,
  },
  preview: {
    borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  previewBadge: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.8)', borderTopWidth: 1, borderTopColor: RD.brand,
    paddingVertical: 7, paddingHorizontal: 10,
  },
  previewBadgeText: { color: RD.textSecondary, fontSize: 9, fontFamily: RD_FONT.mono, letterSpacing: 0.5 },
  previewBadgeLink: { color: RD.brand, fontSize: 10, fontFamily: RD_FONT.monoBold, letterSpacing: 0.5 },
  tabsRow: { flexDirection: 'row', gap: 6 },
  tab: {
    flex: 1, borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    paddingVertical: 9, paddingHorizontal: 2, alignItems: 'center', justifyContent: 'center',
  },
  tabActive: { borderColor: RD.brand },
  tabText: { color: RD.textTertiary, fontSize: 9.5, fontFamily: RD_FONT.mono, letterSpacing: 0.3 },
  tabTextActive: { color: RD.textPrimary },

  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupLabel: { fontSize: 10, fontFamily: RD_FONT.monoBold, letterSpacing: 1.2 },
  groupRule: { flex: 1, height: 1 },
  groupCount: {
    color: RD.textTertiary, fontSize: 10, fontFamily: RD_FONT.mono,
    fontVariant: ['tabular-nums'],
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  singleRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  chassisWrap: { flex: 1, alignItems: 'center' },
  chassisBox: {
    alignSelf: 'stretch', borderWidth: 2, borderColor: RD.panelBorder, borderRadius: 2,
    paddingVertical: 6, alignItems: 'center', justifyContent: 'center',
  },
  chassisLock: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },

  frameHint: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono, lineHeight: 16 },
  frameRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: RD.youMagentaBg, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 2,
  },
  frameRowLocked: { opacity: 0.45 },
  frameRowSelected: { borderWidth: 1, borderColor: '#ffffff' },
  frameRowPreviewing: { borderWidth: 1, borderColor: RD.brand },
  frameRank: { color: RD.youMagenta, fontSize: 12, fontFamily: RD_FONT.mono },
  frameNick: { color: RD.textPrimary, fontSize: 13, fontWeight: '700' },
  frameMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingHorizontal: 2 },
  frameLabel: { color: RD.textSecondary, fontSize: 11, fontFamily: RD_FONT.mono },
  frameTier: { color: RD.textTertiary, fontSize: 9, fontFamily: RD_FONT.mono, letterSpacing: 0.8 },
  swatchFlex: { width: undefined, flex: 1 },
  swatchWrap: { width: 68, alignItems: 'center' },
  swatchStack: { width: 38, height: 38 },
  swatch: { width: 38, height: 38, borderRadius: 2, borderWidth: 2, borderColor: 'transparent' },
  swatchSelected: { borderColor: '#ffffff', borderWidth: 3 },
  swatchPreviewing: { borderColor: RD.brand, borderWidth: 3 },
  swatchLocked: { opacity: 0.32 },
  lockBadge: { position: 'absolute', top: 0, left: 0, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  ownedPip: {
    position: 'absolute', top: -3, right: -3, width: 8, height: 8, borderRadius: 4,
    borderWidth: 1.5, borderColor: RD.bg,
  },
  swatchLabel: { color: RD.textTertiary, fontSize: 8.5, fontFamily: RD_FONT.mono, marginTop: 6, textAlign: 'center', lineHeight: 11 },
  swatchLabelPreviewing: { color: RD.brand, fontFamily: RD_FONT.monoBold },
});

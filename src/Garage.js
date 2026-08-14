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
import Svg, { Ellipse, Line, Path, Rect } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

import DangerStripe from './DangerStripe';
import CarSprite from './CarSprite';
import { RD, RD_FONT, RARITY_COLOR, RARITY_LABEL } from './theme';
import { CAR_DEFAULTS, CAR_COLORS, WING_SHAPES, LIVERY_PATTERNS, LIGHT_COLORS } from './car';
import { getMyLoadout, saveLoadout, getInventory } from './api';

const TABS = [
  { id: 'body', label: 'CARROCERÍA' },
  { id: 'wing', label: 'ALERÓN' },
  { id: 'livery', label: 'LIBREA' },
  { id: 'lights', label: 'FAROS' },
];

// Orden de los grupos: primero lo que puedes usar ya, luego la escalera de
// rareza. Al revés, la pantalla abriría con lo que NO tienes.
const GROUP_ORDER = [null, 'rara', 'epica', 'legendaria'];
const GROUP_LABEL = { null: 'LIBRES', rara: 'RARAS', epica: 'ÉPICAS', legendaria: 'LEGENDARIAS' };

// --- Suelo del garaje, en perspectiva ---------------------------------------
// Antes era una cuadrícula plana al 14% de opacidad: se leía como una textura
// de fondo, no como un suelo. Con las filas estrechándose hacia el fondo, el
// coche pasa a estar APOYADO en algo y el panel deja de ser una caja plana.
const HORIZON = 46;
const FLOOR_BOTTOM = 140;
const FLOOR_ROWS = 7;
const FLOOR_COLS = 8;
const HALF_TOP = 34;   // media anchura del suelo en el horizonte
const HALF_BOTTOM = 190; // media anchura al borde de abajo (se sale del viewBox a propósito)

function floorRowY(i) {
  const t = i / FLOOR_ROWS;
  return HORIZON + (FLOOR_BOTTOM - HORIZON) * Math.pow(t, 1.9);
}
function floorHalfWidth(i) {
  const t = i / FLOOR_ROWS;
  return HALF_TOP + (HALF_BOTTOM - HALF_TOP) * Math.pow(t, 1.9);
}

const FLOOR_QUADS = [];
for (let r = 0; r < FLOOR_ROWS; r++) {
  const y0 = floorRowY(r), y1 = floorRowY(r + 1);
  const h0 = floorHalfWidth(r), h1 = floorHalfWidth(r + 1);
  for (let c = 0; c < FLOOR_COLS; c++) {
    if ((r + c) % 2 !== 0) continue;
    const u0 = c / FLOOR_COLS, u1 = (c + 1) / FLOOR_COLS;
    const x0a = 100 - h0 + 2 * h0 * u0, x1a = 100 - h0 + 2 * h0 * u1;
    const x0b = 100 - h1 + 2 * h1 * u0, x1b = 100 - h1 + 2 * h1 * u1;
    FLOOR_QUADS.push({
      d: `M${x0a},${y0} L${x1a},${y0} L${x1b},${y1} L${x0b},${y1} Z`,
      // Las filas del fondo se desvanecen: sin esto el damero llega nítido
      // hasta el horizonte y parece un mantel, no un suelo con profundidad.
      o: 0.05 + 0.13 * (r / FLOOR_ROWS),
    });
  }
}

// Escaparate memoizado: se queda con el giro para él solo (ver punto 4 de la
// cabecera). Solo se repinta cuando cambia la pieza que se está mirando.
const Showcase = memo(function Showcase({ loadout }) {
  const [spin, setSpin] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSpin((d) => (d + 0.9) % 360), 50);
    return () => clearInterval(id);
  }, []);

  return (
    <Svg width="100%" height={210} viewBox="0 0 200 140">
      <Rect x={0} y={0} width={200} height={HORIZON} fill="#0e0e10" />
      {FLOOR_QUADS.map((q, i) => (
        <Path key={i} d={q.d} fill={RD.cream} opacity={q.o} />
      ))}
      <Line x1={0} y1={HORIZON} x2={200} y2={HORIZON} stroke={RD.panelBorder} strokeWidth={1} />
      {/* OJO con la escala: el alto del <Svg> subió a 210 pero el viewBox
          sigue siendo 200x140, así que el coche NO se escala solo con el
          panel — a 3.4 llenaba el marco entero y se cortaba por abajo. El
          coche tiene que dejar ver el suelo, que es lo que le da el sitio. */}
      <Ellipse cx={100} cy={100} rx={38} ry={7} fill="#000000" opacity={0.45} />
      <CarSprite x={100} y={74} deg={spin} scale={2.5} loadout={loadout} />
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

function Swatch({ opt, value, isSelected, isPreviewing, isLocked, onPress }) {
  const rc = opt.rarity ? RARITY_COLOR[opt.rarity] : null;
  return (
    <Pressable style={s.swatchWrap} onPress={onPress}>
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
            <View style={s.grid}>
              {items.map((opt) => {
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
                    onPress={() => (locked ? onPreview(field, value) : onSelect(value))}
                  />
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export default function Garage({ onBack, onOpenTienda }) {
  const [loadout, setLoadout] = useState(CAR_DEFAULTS);
  const [tab, setTab] = useState('body');
  const [preview, setPreview] = useState(null); // { field, value } de una pieza bloqueada, o null
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
    saveLoadout(next).catch(() => {});
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

  // Cuántas piezas premium tienes en total, para la línea de progreso.
  const premium = [
    ...CAR_COLORS.map((o) => ['color', o]),
    ...WING_SHAPES.map((o) => ['wing', o]),
    ...LIVERY_PATTERNS.map((o) => ['livery', o]),
  ].filter(([, o]) => o.locked);
  const premiumOwned = premium.filter(([cat, o]) => owned.has(`${cat}:${o.id}`)).length;

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
          <Text style={s.collectionCount}>{premiumOwned}/{premium.length} piezas</Text>
        </View>
        <Text style={s.disclaimer}>Solo estético — no afecta al rendimiento del coche</Text>

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
              <Text style={[s.tabText, tab === t.id && s.tabTextActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

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

        {tab === 'lights' && (
          <PieceGrid
            field="lightsColor"
            options={LIGHT_COLORS}
            selected={loadout.lightsColor}
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
    paddingVertical: 9, alignItems: 'center',
  },
  tabActive: { borderColor: RD.brand },
  tabText: { color: RD.textTertiary, fontSize: 10, fontFamily: RD_FONT.mono, letterSpacing: 0.8 },
  tabTextActive: { color: RD.textPrimary },

  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupLabel: { fontSize: 10, fontFamily: RD_FONT.monoBold, letterSpacing: 1.2 },
  groupRule: { flex: 1, height: 1 },
  groupCount: {
    color: RD.textTertiary, fontSize: 10, fontFamily: RD_FONT.mono,
    fontVariant: ['tabular-nums'],
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
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

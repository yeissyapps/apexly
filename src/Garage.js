// ============================================================================
//  Garaje — personalización del coche (carrocería, alerón, librea, faros).
//
//  Cada toque en una pieza LIBRE se aplica al vuelo (preview + Supabase), sin
//  botón de "guardar". Las piezas premium se muestran bloqueadas — el CÓMO se
//  desbloquean (racha, ranking, sobres...) se decide más adelante; de momento
//  tocarlas solo las PREVISUALIZA en el coche (candado, sin poder quedártelas)
//  para dar ganas de la colección que vendrá.
// ============================================================================

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import Svg, { Ellipse, Path, Rect } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

import DangerStripe from './DangerStripe';
import CarSprite from './CarSprite';
import { RD, RD_FONT } from './theme';
import { CAR_DEFAULTS, CAR_COLORS, WING_SHAPES, LIVERY_PATTERNS, LIGHT_COLORS } from './car';
import { getMyLoadout, saveLoadout } from './api';

const TABS = [
  { id: 'body', label: 'CARROCERÍA' },
  { id: 'wing', label: 'ALERÓN' },
  { id: 'livery', label: 'LIBREA' },
  { id: 'lights', label: 'FAROS' },
];

// Suelo del garaje: cuadrícula tipo pit-lane, blanco y negro (los oscuros son
// el propio fondo del panel, solo se dibujan los claros).
const FLOOR_SQ = 20;
const FLOOR_COLS = 10;
const FLOOR_ROWS = 7;
const FLOOR_SQUARES = [];
for (let row = 0; row < FLOOR_ROWS; row++) {
  for (let col = 0; col < FLOOR_COLS; col++) {
    if ((row + col) % 2 === 0) FLOOR_SQUARES.push({ x: col * FLOOR_SQ, y: row * FLOOR_SQ });
  }
}

export default function Garage({ onBack }) {
  const [loadout, setLoadout] = useState(CAR_DEFAULTS);
  const [tab, setTab] = useState('body');
  const [spin, setSpin] = useState(0);
  const [preview, setPreview] = useState(null); // { field, value } de una pieza bloqueada, o null

  useEffect(() => {
    getMyLoadout().then(setLoadout).catch(() => {});
  }, []);

  // Plato giratorio del escaparate: una vuelta cada ~20s.
  useEffect(() => {
    const id = setInterval(() => setSpin((d) => (d + 0.9) % 360), 50);
    return () => clearInterval(id);
  }, []);

  function apply(patch) {
    setPreview(null);
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

  return (
    <View style={s.screen}>
      <StatusBar hidden />
      <DangerStripe height={6} />
      <ScrollView contentContainerStyle={s.content}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={s.backLink}>‹ INICIO</Text>
        </Pressable>
        <Text style={s.pageTitle}>Garaje</Text>
        <Text style={s.disclaimer}>Solo estético — no afecta al rendimiento del coche</Text>

        <View style={s.preview}>
          <Svg width="100%" height={170} viewBox="0 0 200 140">
            {FLOOR_SQUARES.map((sq, i) => (
              <Rect key={i} x={sq.x} y={sq.y} width={FLOOR_SQ} height={FLOOR_SQ} fill={RD.cream} opacity={0.14} />
            ))}
            <Ellipse cx={100} cy={104} rx={44} ry={8} fill="#000000" opacity={0.35} />
            <CarSprite x={100} y={68} deg={spin} scale={3.15} loadout={displayLoadout} />
          </Svg>
          {preview && (
            <View style={s.previewBadge}>
              <Text style={s.previewBadgeText}>VISTA PREVIA — SE DESBLOQUEARÁ MÁS ADELANTE</Text>
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
          <ColorGrid
            field="bodyColor"
            options={CAR_COLORS}
            selected={loadout.bodyColor}
            preview={preview}
            onPreview={previewLocked}
            onSelect={(c) => apply({ bodyColor: c })}
          />
        )}

        {tab === 'wing' && (
          <>
            <Text style={s.sectionLabel}>FORMA</Text>
            <ColorGrid
              field="wingShape"
              options={WING_SHAPES}
              selected={loadout.wingShape}
              getValue={(o) => o.id}
              preview={preview}
              onPreview={previewLocked}
              onSelect={(id) => apply({ wingShape: id })}
            />
            <Text style={s.sectionLabel}>COLOR</Text>
            <ColorGrid
              field="wingColor"
              options={CAR_COLORS}
              selected={loadout.wingColor}
              preview={preview}
              onPreview={previewLocked}
              onSelect={(c) => apply({ wingColor: c })}
            />
          </>
        )}

        {tab === 'livery' && (
          <>
            <Text style={s.sectionLabel}>PATRÓN</Text>
            <ColorGrid
              field="liveryPattern"
              options={LIVERY_PATTERNS}
              selected={loadout.liveryPattern}
              getValue={(o) => o.id}
              preview={preview}
              onPreview={previewLocked}
              onSelect={(id) => apply({ liveryPattern: id })}
            />
            <Text style={s.sectionLabel}>COLOR</Text>
            <ColorGrid
              field="livery"
              options={[{ id: 'sin_franja', label: 'Sin franja', c: null, locked: false }, ...CAR_COLORS]}
              selected={loadout.livery}
              getValue={(o) => (o.id === 'sin_franja' ? null : o.c)}
              preview={preview}
              onPreview={previewLocked}
              onSelect={(c) => apply({ livery: c })}
            />
          </>
        )}

        {tab === 'lights' && (
          <ColorGrid
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

// Candado dibujado (nada de emoji, mismo lenguaje técnico que el resto del
// juego): arco de la grapa + cuerpo sólido.
function LockIcon() {
  return (
    <Svg width={14} height={14} viewBox="0 0 16 16">
      <Path d="M4,7 V5 A4,4 0 0,1 12,5 V7" fill="none" stroke={RD.brandOrange} strokeWidth={1.7} />
      <Rect x={3} y={7} width={10} height={7} rx={1.5} fill={RD.brandOrange} />
    </Svg>
  );
}

function ColorGrid({ field, options, selected, getValue = (o) => o.c, preview, onPreview, onSelect }) {
  return (
    <View style={s.grid}>
      {options.map((opt) => {
        const value = getValue(opt);
        const isSelected = !preview && value === selected;
        const isPreviewing = !!preview && preview.field === field && preview.value === value;
        return (
          <Pressable
            key={String(opt.id)}
            style={s.swatchWrap}
            onPress={() => (opt.locked ? onPreview(field, value) : onSelect(value))}
          >
            <View style={s.swatchStack}>
              <View
                style={[
                  s.swatch,
                  { backgroundColor: opt.c || RD.gridLine },
                  isSelected && s.swatchSelected,
                  isPreviewing && s.swatchPreviewing,
                  opt.locked && !isPreviewing && s.swatchLocked,
                ]}
              />
              {opt.locked && !isPreviewing && (
                <View style={s.lockBadge} pointerEvents="none">
                  <LockIcon />
                </View>
              )}
            </View>
            <Text style={[s.swatchLabel, isPreviewing && s.swatchLabelPreviewing]} numberOfLines={1}>
              {isPreviewing ? 'Mirando…' : opt.locked ? 'Bloqueado' : (opt.label || '')}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RD.bg },
  content: { paddingHorizontal: 18, paddingTop: 50, paddingBottom: 40, gap: 16 },
  backLink: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono, marginBottom: 8 },
  pageTitle: {
    color: RD.textPrimary, fontSize: 28, fontFamily: RD_FONT.displayBlack,
    textTransform: 'uppercase', marginBottom: 4,
  },
  disclaimer: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono, marginBottom: -4 },
  sectionLabel: {
    color: RD.textTertiary, fontSize: 10, fontFamily: RD_FONT.mono,
    letterSpacing: 0.8, marginBottom: -6,
  },
  preview: {
    borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    alignItems: 'center', justifyContent: 'center', paddingVertical: 8, overflow: 'hidden',
  },
  previewBadge: {
    position: 'absolute', bottom: 6, left: 6, right: 6,
    backgroundColor: 'rgba(0,0,0,0.72)', borderWidth: 1, borderColor: RD.brandOrange,
    paddingVertical: 5, alignItems: 'center',
  },
  previewBadgeText: { color: RD.brandOrange, fontSize: 9, fontFamily: RD_FONT.monoBold, letterSpacing: 0.6 },
  tabsRow: { flexDirection: 'row', gap: 6 },
  tab: {
    flex: 1, borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    paddingVertical: 9, alignItems: 'center',
  },
  tabActive: { borderColor: RD.brandOrange },
  tabText: { color: RD.textTertiary, fontSize: 10, fontFamily: RD_FONT.mono, letterSpacing: 0.8 },
  tabTextActive: { color: RD.textPrimary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'center' },
  swatchWrap: { width: 60, alignItems: 'center' },
  swatchStack: { width: 36, height: 36 },
  swatch: { width: 36, height: 36, borderRadius: 2, borderWidth: 2, borderColor: 'transparent' },
  swatchSelected: { borderColor: '#ffffff' },
  swatchPreviewing: { borderColor: RD.brandOrange },
  swatchLocked: { opacity: 0.3 },
  lockBadge: { position: 'absolute', top: 0, left: 0, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  swatchLabel: { color: RD.textTertiary, fontSize: 9, fontFamily: RD_FONT.mono, marginTop: 5, textAlign: 'center' },
  swatchLabelPreviewing: { color: RD.brandOrange, fontFamily: RD_FONT.monoBold },
});

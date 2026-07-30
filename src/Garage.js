// ============================================================================
//  Garaje — personalización del coche (carrocería, alerón, librea, faros).
//
//  Cada toque en una pieza se aplica al vuelo (preview + Supabase), sin botón
//  de "guardar". Las piezas premium se muestran bloqueadas — el CÓMO se
//  desbloquean (racha, ranking...) se decide más adelante; de momento solo
//  son un escaparate de lo que vendrá.
// ============================================================================

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import Svg, { Ellipse, Rect } from 'react-native-svg';

import DangerStripe from './DangerStripe';
import CarSprite from './CarSprite';
import { RD, RD_FONT } from './theme';
import { CAR_DEFAULTS, CAR_COLORS, BODY_LIVERIES, LIGHT_COLORS } from './car';
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

  useEffect(() => {
    getMyLoadout().then(setLoadout).catch(() => {});
  }, []);

  // Plato giratorio del escaparate: una vuelta cada ~20s.
  useEffect(() => {
    const id = setInterval(() => setSpin((d) => (d + 0.9) % 360), 50);
    return () => clearInterval(id);
  }, []);

  function apply(patch) {
    const next = { ...loadout, ...patch };
    setLoadout(next);
    saveLoadout(next).catch(() => {});
  }

  return (
    <View style={s.screen}>
      <StatusBar hidden />
      <DangerStripe height={6} />
      <ScrollView contentContainerStyle={s.content}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={s.backLink}>‹ INICIO</Text>
        </Pressable>
        <Text style={s.pageTitle}>Garaje</Text>

        <View style={s.preview}>
          <Svg width="100%" height={170} viewBox="0 0 200 140">
            {FLOOR_SQUARES.map((sq, i) => (
              <Rect key={i} x={sq.x} y={sq.y} width={FLOOR_SQ} height={FLOOR_SQ} fill={RD.cream} opacity={0.14} />
            ))}
            <Ellipse cx={100} cy={104} rx={44} ry={8} fill="#000000" opacity={0.35} />
            <CarSprite x={100} y={68} deg={spin} scale={3.15} loadout={loadout} />
          </Svg>
        </View>

        <View style={s.tabsRow}>
          {TABS.map((t) => (
            <Pressable
              key={t.id}
              style={[s.tab, tab === t.id && s.tabActive]}
              onPress={() => setTab(t.id)}
            >
              <Text style={[s.tabText, tab === t.id && s.tabTextActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === 'body' && (
          <ColorGrid
            options={CAR_COLORS}
            selected={loadout.bodyColor}
            onSelect={(c) => apply({ bodyColor: c })}
          />
        )}

        {tab === 'wing' && (
          <ColorGrid
            options={CAR_COLORS}
            selected={loadout.wingColor}
            onSelect={(c) => apply({ wingColor: c })}
          />
        )}

        {tab === 'livery' && (
          <ColorGrid
            options={BODY_LIVERIES}
            selected={loadout.livery}
            getValue={(o) => o.id}
            onSelect={(id) => apply({ livery: id })}
          />
        )}

        {tab === 'lights' && (
          <ColorGrid
            options={LIGHT_COLORS}
            selected={loadout.lightsColor}
            onSelect={(c) => apply({ lightsColor: c })}
          />
        )}
      </ScrollView>
    </View>
  );
}

function ColorGrid({ options, selected, getValue = (o) => o.c, onSelect }) {
  return (
    <View style={s.grid}>
      {options.map((opt) => {
        const value = getValue(opt);
        const isSelected = value === selected;
        return (
          <Pressable
            key={String(opt.id)}
            style={s.swatchWrap}
            disabled={opt.locked}
            onPress={() => onSelect(value)}
          >
            <View
              style={[
                s.swatch,
                { backgroundColor: opt.c || RD.gridLine },
                isSelected && s.swatchSelected,
                opt.locked && s.swatchLocked,
              ]}
            />
            <Text style={s.swatchLabel} numberOfLines={1}>
              {opt.locked ? 'BLOQUEADO' : (opt.label || '')}
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
  preview: {
    borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    alignItems: 'center', justifyContent: 'center', paddingVertical: 8, overflow: 'hidden',
  },
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
  swatch: { width: 36, height: 36, borderRadius: 2, borderWidth: 2, borderColor: 'transparent' },
  swatchSelected: { borderColor: '#ffffff' },
  swatchLocked: { opacity: 0.35 },
  swatchLabel: { color: RD.textTertiary, fontSize: 9, fontFamily: RD_FONT.mono, marginTop: 5, textAlign: 'center' },
});

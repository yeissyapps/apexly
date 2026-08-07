// ============================================================================
//  Tienda — comprar y abrir sobres con monedas ganadas por racha/ranking.
//
//  Un sobre = 125 monedas = 1 pieza premium aleatoria del garaje (color,
//  alerón o librea), sin duplicados (el servidor excluye lo que ya tienes).
//  Mismo lenguaje visual que Garage.js (esqueleto, tokens RD/RD_FONT).
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import Svg, { Ellipse } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

import DangerStripe from './DangerStripe';
import CarSprite from './CarSprite';
import ShineBadge from './ShineBadge';
import { RD, RD_FONT } from './theme';
import { CAR_DEFAULTS, CAR_COLORS, WING_SHAPES, LIVERY_PATTERNS } from './car';
import { getWallet, getInventory, getMyLoadout, saveLoadout, openPack } from './api';

const PACK_COST = 125;
const TOTAL_PIECES = 19;
const RARITY_LABEL = { rara: 'Rara', epica: 'Épica', legendaria: 'Legendaria' };
const RARITY_COLOR = { rara: RD.trackBlue, epica: RD.youMagenta, legendaria: RD.gold1st };

function pieceLabel(category, pieceId) {
  if (category === 'wing') return WING_SHAPES.find((w) => w.id === pieceId)?.label ?? pieceId;
  if (category === 'livery') return LIVERY_PATTERNS.find((l) => l.id === pieceId)?.label ?? pieceId;
  return pieceId.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function previewLoadoutFor(base, category, pieceId) {
  const entry = category === 'color' ? CAR_COLORS.find((c) => c.id === pieceId) : null;
  if (category === 'color') return { ...base, bodyColor: entry?.c ?? base.bodyColor };
  if (category === 'wing') return { ...base, wingShape: pieceId };
  if (category === 'livery') return { ...base, liveryPattern: pieceId, livery: base.livery || '#ffffff' };
  return base;
}

export default function Tienda({ onBack }) {
  const [wallet, setWallet] = useState({ balance: 0, pendingPacks: 0 });
  const [ownedCount, setOwnedCount] = useState(0);
  const [loadout, setLoadout] = useState(CAR_DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [reveal, setReveal] = useState(null); // { category, pieceId, rarity }

  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  // Ref además de estado: `busy` (useState) no se actualiza a tiempo entre
  // dos taps casi simultáneos (React no re-renderiza entre medias), así que
  // un doble tap rápido pasaba el check `if (busy) return` dos veces y
  // abría dos sobres de golpe (el servidor cobraba bien los dos, pero el
  // segundo se abría en silencio, sin mostrar su revelación). La ref se lee
  // y escribe al instante, en el mismo tick del primer tap.
  const openingRef = useRef(false);

  const refresh = () => {
    getWallet().then(setWallet).catch(() => {});
    getInventory().then((items) => setOwnedCount(items.length)).catch(() => {});
    getMyLoadout().then(setLoadout).catch(() => {});
  };

  useEffect(refresh, []);

  useEffect(() => {
    if (!reveal) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    scale.setValue(0.6);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 90, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [reveal]);

  async function handleOpen(source) {
    if (openingRef.current) return;
    openingRef.current = true;
    setBusy(true);
    setErrorMsg(null);
    try {
      const result = await openPack(source);
      setReveal(result);
      refresh();
    } catch (e) {
      const code = String(e?.message || e);
      if (code.includes('INSUFFICIENT_FUNDS')) setErrorMsg('No te llega el saldo para otro sobre.');
      else if (code.includes('NO_PENDING_PACK')) setErrorMsg('No tienes sobres pendientes.');
      else if (code.includes('COLLECTION_COMPLETE')) setErrorMsg('Ya tienes todas las piezas — colección completa.');
      else setErrorMsg('No se pudo abrir el sobre. Inténtalo de nuevo.');
    } finally {
      openingRef.current = false;
      setBusy(false);
    }
  }

  async function handleEquip() {
    if (!reveal) return;
    const next = previewLoadoutFor(loadout, reveal.category, reveal.pieceId);
    try {
      await saveLoadout(next);
      setLoadout(next);
    } catch (_) {
      // si falla el equipar, la pieza ya es tuya igualmente — se puede
      // equipar luego desde el Garaje.
    }
    setReveal(null);
  }

  const previewLoadout = reveal ? previewLoadoutFor(loadout, reveal.category, reveal.pieceId) : loadout;
  const complete = ownedCount >= TOTAL_PIECES;

  return (
    <View style={s.screen}>
      <StatusBar hidden />
      <DangerStripe height={6} />
      <ScrollView contentContainerStyle={s.content}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={s.backLink}>‹ INICIO</Text>
        </Pressable>
        <Text style={s.pageTitle}>Tienda</Text>
        <Text style={s.disclaimer}>Solo estético — no afecta al rendimiento del coche</Text>

        <View style={s.balanceRow}>
          <Text style={s.balanceLabel}>SALDO</Text>
          <Text style={s.balanceValue}>{wallet.balance}</Text>
        </View>

        {wallet.pendingPacks > 0 && (
          <View style={s.card}>
            <Text style={s.cardTitle}>SOBRES PENDIENTES · {wallet.pendingPacks}</Text>
            <Text style={s.cardBody}>Regalo de tu racha de 7 días — sin caducar.</Text>
            <Pressable style={s.cardBtn} onPress={() => handleOpen('free')} disabled={busy}>
              <Text style={s.cardBtnText}>ABRIR</Text>
            </Pressable>
          </View>
        )}

        <View style={s.card}>
          <Text style={s.cardTitle}>SOBRE · {PACK_COST} MONEDAS</Text>
          <Text style={s.cardBody}>
            1 pieza aleatoria, nunca repetida. 65% rara · 30% épica · 5% legendaria.
          </Text>
          <Pressable
            style={[s.cardBtn, (busy || complete || wallet.balance < PACK_COST) && s.cardBtnDisabled]}
            onPress={() => handleOpen('paid')}
            disabled={busy || complete || wallet.balance < PACK_COST}
          >
            <Text style={s.cardBtnText}>{complete ? 'COLECCIÓN COMPLETA' : 'COMPRAR Y ABRIR'}</Text>
          </Pressable>
        </View>

        {errorMsg && <Text style={s.errorText}>{errorMsg}</Text>}

        <Text style={s.progressText}>Colección: {ownedCount}/{TOTAL_PIECES} piezas</Text>
      </ScrollView>

      {reveal && (
        <View style={s.revealOverlay}>
          <Animated.View style={[s.revealCard, { opacity, transform: [{ scale }] }]}>
            <Svg width="100%" height={150} viewBox="0 0 200 140">
              <Ellipse cx={100} cy={104} rx={44} ry={8} fill="#000000" opacity={0.35} />
              <CarSprite x={100} y={68} deg={-20} scale={3.15} loadout={previewLoadout} />
            </Svg>
            {reveal.rarity === 'legendaria' ? (
              <ShineBadge style={[s.rarityBadge, { backgroundColor: RARITY_COLOR[reveal.rarity] }]}>
                <Text style={s.rarityBadgeText}>{RARITY_LABEL[reveal.rarity]}</Text>
              </ShineBadge>
            ) : (
              <View style={[s.rarityBadge, { backgroundColor: RARITY_COLOR[reveal.rarity] }]}>
                <Text style={s.rarityBadgeText}>{RARITY_LABEL[reveal.rarity]}</Text>
              </View>
            )}
            <Text style={s.revealLabel}>{pieceLabel(reveal.category, reveal.pieceId)}</Text>
            <Pressable style={s.equipBtn} onPress={handleEquip}>
              <Text style={s.equipBtnText}>EQUIPAR AHORA</Text>
            </Pressable>
            <Pressable onPress={() => setReveal(null)} hitSlop={12}>
              <Text style={s.laterLink}>Seguir</Text>
            </Pressable>
          </Animated.View>
        </View>
      )}
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
  balanceRow: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2, paddingHorizontal: 14, paddingVertical: 12,
  },
  balanceLabel: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono, letterSpacing: 0.8 },
  balanceValue: { color: RD.gold1st, fontSize: 26, fontFamily: RD_FONT.displayBlack },
  card: { borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2, padding: 14, gap: 8 },
  cardTitle: { color: RD.textPrimary, fontSize: 13, fontFamily: RD_FONT.monoBold, letterSpacing: 0.5 },
  cardBody: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono, lineHeight: 17 },
  cardBtn: { borderWidth: 1, borderColor: RD.brandOrange, borderRadius: 2, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  cardBtnDisabled: { borderColor: RD.panelBorder, opacity: 0.5 },
  cardBtnText: { color: RD.brandOrange, fontSize: 13, fontFamily: RD_FONT.monoBold, letterSpacing: 0.5 },
  errorText: { color: RD.dangerRed, fontSize: 12, fontFamily: RD_FONT.mono, textAlign: 'center' },
  progressText: { color: RD.textTertiary, fontSize: 12, fontFamily: RD_FONT.mono, textAlign: 'center' },

  revealOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.82)', alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  revealCard: {
    width: '100%', borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    backgroundColor: RD.bg, padding: 18, alignItems: 'center', gap: 10,
  },
  rarityBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 2 },
  rarityBadgeText: { color: RD.bg, fontSize: 11, fontFamily: RD_FONT.monoBold, letterSpacing: 0.6 },
  revealLabel: { color: RD.textPrimary, fontSize: 18, fontFamily: RD_FONT.displayBold, textTransform: 'uppercase' },
  equipBtn: { alignSelf: 'stretch', backgroundColor: RD.brandOrange, borderRadius: 2, paddingVertical: 13, alignItems: 'center', marginTop: 6 },
  equipBtnText: { color: '#04160b', fontSize: 14, fontFamily: RD_FONT.monoBold, letterSpacing: 0.5 },
  laterLink: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono, marginTop: 2 },
});

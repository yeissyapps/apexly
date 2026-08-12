// ============================================================================
//  Profile — perfil del jugador: stats + acceso a Garaje y Tienda. Antes
//  vivían como botones sueltos en Inicio; con la barra de 3 pestañas
//  (Diario/Amigos/Carrera) necesitaban un sitio propio, fuera de los modos
//  de juego — mismo patrón que el resto de pantallas a página completa
//  (Garage.js/Tienda.js): DangerStripe + enlace de vuelta + StatusBar oculta.
//
//  Monedas/racha llegan por props (Inicio ya los tiene cargados). El resto
//  de stats (nivel de Carrera, piezas coleccionadas, puesto de hoy) son
//  propias de esta pantalla — se piden aquí mismo al entrar, en vez de
//  sumarlas al efecto global de Inicio, que no las necesita para nada.
// ============================================================================

import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import DangerStripe from './DangerStripe';
import Identicon from './Identicon';
import { RD, RD_FONT } from './theme';
import { getCareerProgress, getInventory, getGlobalBoard } from './api';
import { LEVEL_COUNT } from './career';
import { CAR_COLORS, WING_SHAPES, LIVERY_PATTERNS } from './car';

// Piezas realmente "coleccionables" (con candado y vía de desbloqueo). Los
// faros no cuentan — no tienen vía de desbloqueo esta fase (ver Garage.js).
const TOTAL_PIECES = [CAR_COLORS, WING_SHAPES, LIVERY_PATTERNS]
  .flat()
  .filter((p) => p.locked).length;

export default function Profile({ nickname, myStreak, wallet, onBack, onOpenGarage, onOpenTienda }) {
  const [career, setCareer] = useState(null); // nivel más alto superado
  const [piecesOwned, setPiecesOwned] = useState(null);
  const [todayRank, setTodayRank] = useState(undefined); // undefined = cargando, null = no jugó hoy

  useEffect(() => {
    let alive = true;
    getCareerProgress().then((n) => alive && setCareer(n)).catch(() => alive && setCareer(0));
    getInventory()
      .then((items) => {
        if (!alive) return;
        const owned = new Set(items.map((p) => `${p.category}:${p.pieceId}`));
        setPiecesOwned(owned.size);
      })
      .catch(() => alive && setPiecesOwned(0));
    getGlobalBoard()
      .then((b) => alive && setTodayRank(b.me ? b.me.rank : null))
      .catch(() => alive && setTodayRank(null));
    return () => { alive = false; };
  }, []);

  return (
    <View style={s.screen}>
      <StatusBar hidden />
      <DangerStripe height={6} />
      <ScrollView contentContainerStyle={s.content}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={s.backLink}>‹ INICIO</Text>
        </Pressable>
        <Text style={s.pageTitle}>Perfil</Text>

        <View style={s.identity}>
          <Identicon seed={nickname} size={44} />
          <Text style={s.nickname}>{nickname}</Text>
        </View>

        <View style={s.statsGrid}>
          <View style={s.statsRow}>
            <View style={s.statCard}>
              <Text style={s.statValue}>{career != null ? `${career}/${LEVEL_COUNT}` : '—'}</Text>
              <Text style={s.statLabel}>NIVELES</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statValue}>{myStreak?.current ?? 0}</Text>
              <Text style={s.statLabel}>RACHA ACTUAL</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statValue}>{myStreak?.longest ?? 0}</Text>
              <Text style={s.statLabel}>RACHA MÁXIMA</Text>
            </View>
          </View>
          <View style={s.statsRow}>
            <View style={s.statCard}>
              <Text style={s.statValue}>{piecesOwned != null ? `${piecesOwned}/${TOTAL_PIECES}` : '—'}</Text>
              <Text style={s.statLabel}>PIEZAS</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statValue}>{wallet?.balance ?? 0}</Text>
              <Text style={s.statLabel}>MONEDAS</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statValue}>{todayRank ? `#${todayRank}` : todayRank === null ? '—' : '···'}</Text>
              <Text style={s.statLabel}>RANKING HOY</Text>
            </View>
          </View>
        </View>

        <View style={s.actionsRow}>
          <Pressable style={s.actionBtn} onPress={onOpenGarage}>
            <Text style={s.actionBtnText}>GARAJE</Text>
          </Pressable>
          <Pressable style={s.actionBtn} onPress={onOpenTienda}>
            <Text style={s.actionBtnText}>TIENDA</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RD.bg },
  content: { paddingHorizontal: 18, paddingTop: 50, paddingBottom: 40, gap: 18 },
  backLink: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono, marginBottom: 8 },
  pageTitle: {
    color: RD.textPrimary, fontSize: 28, fontFamily: RD_FONT.displayBlack,
    textTransform: 'uppercase', marginBottom: -8,
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nickname: { color: RD.textPrimary, fontSize: 16, fontFamily: RD_FONT.monoSemibold },
  statsGrid: { gap: 10 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1, borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    paddingVertical: 14, alignItems: 'center', gap: 4,
  },
  statValue: { color: RD.gold1st, fontSize: 22, fontFamily: RD_FONT.displayBlack, fontVariant: ['tabular-nums'] },
  statLabel: { color: RD.textTertiary, fontSize: 9, fontFamily: RD_FONT.mono, letterSpacing: 0.6, textAlign: 'center' },
  actionsRow: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1, borderWidth: 1, borderColor: RD.trackBlue, borderRadius: 2,
    paddingVertical: 14, alignItems: 'center',
  },
  actionBtnText: { color: RD.trackBlue, fontSize: 14, fontFamily: RD_FONT.monoBold },
});

// ============================================================================
//  Profile — perfil del jugador: identidad, stats y acceso a Garaje/Tienda.
//
//  Estructura, de arriba abajo (y por qué en ese orden): identidad grande,
//  luego lo que se presume, luego el detalle. Antes eran seis tarjetas
//  idénticas en dos filas — todas del mismo tamaño, así que ninguna
//  destacaba y la pantalla no decía qué era importante.
//
//  Monedas/racha llegan por props (Inicio ya los tiene cargados). El resto
//  se pide aquí al entrar. TODO lo que va contra red degrada a un guion si
//  falla: el perfil no debe romperse por una consulta caída, y los
//  contadores de vueltas/choques solo existen si ya se corrió
//  `supabase/stats.sql` (hasta entonces salen en guion, no en cero, que
//  mentiría diciendo "no te has chocado nunca").
// ============================================================================

import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import DangerStripe from './DangerStripe';
import Identicon from './Identicon';
import StatTrend from './StatTrend';
import { RD, RD_FONT } from './theme';
import { fmtTime } from './format';
import { dailyTimeEstimate } from './generator';
import {
  getCareerProgress, getInventory, getGlobalBoard,
  getPlayerStats, getMyDailyHistory, getMyPurpleSectors, getLifetimeCoins,
} from './api';
import { LEVEL_COUNT } from './career';
import { CAR_COLORS, WING_SHAPES, LIVERY_PATTERNS } from './car';

// Piezas realmente "coleccionables" (con candado y vía de desbloqueo). Los
// faros no cuentan — no tienen vía de desbloqueo esta fase (ver Garage.js).
const TOTAL_PIECES = [CAR_COLORS, WING_SHAPES, LIVERY_PATTERNS]
  .flat()
  .filter((p) => p.locked).length;

// Caché de los objetivos por día. El objetivo de un día pasado es
// determinista y no cambia NUNCA, así que se calcula una vez y se guarda:
// generarlo cuesta ~8ms por día (16 candidatos hasta dar con uno válido) y
// el gráfico pide decenas de días. Sin esto, abrir el Perfil se notaría.
const TARGET_CACHE_KEY = 'circuit_targets_v1';

async function loadTargets(days) {
  let cache = {};
  try {
    const raw = await AsyncStorage.getItem(TARGET_CACHE_KEY);
    if (raw) cache = JSON.parse(raw);
  } catch (_) {}

  let added = false;
  for (const day of days) {
    if (cache[day] == null) {
      try {
        cache[day] = dailyTimeEstimate(day) * 1000; // s -> ms
        added = true;
      } catch (_) {
        cache[day] = 0;
      }
    }
  }
  if (added) {
    try { await AsyncStorage.setItem(TARGET_CACHE_KEY, JSON.stringify(cache)); } catch (_) {}
  }
  return cache;
}

// "2h 14m" / "14m 05s" / "45s" — el tiempo total en pista puede ir de un
// minuto a muchas horas, así que la unidad se elige sola.
function fmtDuration(ms) {
  if (!ms || ms < 0) return '—';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

function StatCard({ value, label, hint, tone }) {
  return (
    <View style={s.statCard}>
      <Text style={[s.statValue, tone === 'dim' && s.statValueDim]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
      {!!hint && <Text style={s.statHint}>{hint}</Text>}
    </View>
  );
}

export default function Profile({ nickname, myStreak, wallet, onBack, onOpenGarage, onOpenTienda }) {
  const [career, setCareer] = useState(null);
  const [piecesOwned, setPiecesOwned] = useState(null);
  const [todayRank, setTodayRank] = useState(undefined); // undefined = cargando, null = no jugó hoy
  const [stats, setStats] = useState(undefined);         // undefined = cargando, null = tabla sin crear
  const [purple, setPurple] = useState(null);
  const [lifetimeCoins, setLifetimeCoins] = useState(null);
  const [trend, setTrend] = useState(null);

  useEffect(() => {
    let alive = true;
    getCareerProgress().then((n) => alive && setCareer(n)).catch(() => alive && setCareer(0));
    getInventory()
      .then((items) => {
        if (!alive) return;
        setPiecesOwned(new Set(items.map((p) => `${p.category}:${p.pieceId}`)).size);
      })
      .catch(() => alive && setPiecesOwned(0));
    getGlobalBoard()
      .then((b) => alive && setTodayRank(b.me ? b.me.rank : null))
      .catch(() => alive && setTodayRank(null));
    getPlayerStats().then((v) => alive && setStats(v)).catch(() => alive && setStats(null));
    getMyPurpleSectors().then((v) => alive && setPurple(v)).catch(() => {});
    getLifetimeCoins().then((v) => alive && setLifetimeCoins(v)).catch(() => {});

    // El gráfico va aparte y DESPUÉS: necesita calcular el objetivo de cada
    // día, que es caro la primera vez. Se resuelve fuera del primer pintado
    // para que el resto del perfil aparezca ya.
    getMyDailyHistory(30)
      .then(async (rows) => {
        if (!alive || rows.length === 0) { if (alive) setTrend([]); return; }
        const targets = await loadTargets(rows.map((r) => r.day));
        if (!alive) return;
        setTrend(rows.map((r) => ({ ...r, targetMs: targets[r.day] || 0 })));
      })
      .catch(() => alive && setTrend([]));

    return () => { alive = false; };
  }, []);

  const daysRaced = trend ? trend.length : null;
  // Choques por vuelta es más honesto que el total: 400 choques en 500
  // vueltas es un dato distinto a 400 en 50, y el total solo premia a quien
  // más ha jugado.
  const crashRate = stats && stats.laps > 0 ? (stats.crashes / stats.laps).toFixed(1) : null;

  return (
    <View style={s.screen}>
      <StatusBar hidden />
      <DangerStripe height={6} />
      <ScrollView contentContainerStyle={s.content}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={s.backLink}>‹ INICIO</Text>
        </Pressable>

        <View style={s.identity}>
          <Identicon seed={nickname} size={56} />
          <View style={s.identityText}>
            <Text style={s.nickname} numberOfLines={1}>{nickname}</Text>
            <Text style={s.identitySub}>
              {daysRaced != null ? `${daysRaced} ${daysRaced === 1 ? 'día corrido' : 'días corridos'}` : '···'}
              {stats?.bestMs ? ` · mejor ${fmtTime(stats.bestMs)}` : ''}
            </Text>
          </View>
        </View>

        {/* Garaje y Tienda van ARRIBA: son lo accionable de esta pantalla, y
            enterrarlos bajo el bloque de stats obligaba a hacer scroll para
            llegar a lo único que se puede pulsar. Las stats son de leer, y
            leer puede esperar a después de actuar. */}
        <View style={s.actionsRow}>
          <Pressable style={s.actionBtn} onPress={onOpenGarage}>
            <Text style={s.actionBtnText}>GARAJE</Text>
          </Pressable>
          <Pressable style={s.actionBtn} onPress={onOpenTienda}>
            <Text style={s.actionBtnText}>TIENDA</Text>
          </Pressable>
        </View>

        {/* Fila de titulares: lo que de verdad presume el jugador. Va en una
            fila propia y más grande que el resto — si todo pesa igual, nada
            destaca (que era el problema de la versión anterior). */}
        <View style={s.heroRow}>
          <View style={s.heroCard}>
            <Text style={s.heroValue}>{myStreak?.current ?? 0}</Text>
            <Text style={s.heroLabel}>RACHA</Text>
            <Text style={s.heroHint}>máx. {myStreak?.longest ?? 0}</Text>
          </View>
          <View style={s.heroCard}>
            {/* El dorado SOLO si de verdad vas primero. Antes lo llevaban
                todos los números de la pantalla, así que no distinguía nada;
                apareciendo solo aquí, vuelve a significar "podio". */}
            <Text style={[s.heroValue, todayRank === 1 && s.heroValueGold]}>
              {todayRank ? `#${todayRank}` : todayRank === null ? '—' : '···'}
            </Text>
            <Text style={s.heroLabel}>HOY</Text>
            <Text style={s.heroHint}>
              {purple ? `${purple.mine}/3 morados` : ' '}
            </Text>
          </View>
        </View>

        <StatTrend points={trend || []} />

        <Text style={s.sectionLabel}>EN PISTA</Text>
        <View style={s.statsRow}>
          <StatCard
            value={stats ? stats.laps : '—'}
            label="VUELTAS"
            tone={stats ? null : 'dim'}
          />
          <StatCard
            value={stats ? fmtDuration(stats.raceMs) : '—'}
            label="AL VOLANTE"
            tone={stats ? null : 'dim'}
          />
          <StatCard
            value={stats ? stats.crashes : '—'}
            label="CHOQUES"
            hint={crashRate ? `${crashRate}/vuelta` : null}
            tone={stats ? null : 'dim'}
          />
        </View>

        <Text style={s.sectionLabel}>COLECCIÓN</Text>
        <View style={s.statsRow}>
          <StatCard
            value={career != null ? `${career}/${LEVEL_COUNT}` : '—'}
            label="NIVELES"
          />
          <StatCard
            value={piecesOwned != null ? `${piecesOwned}/${TOTAL_PIECES}` : '—'}
            label="PIEZAS"
          />
          <StatCard
            value={lifetimeCoins != null ? lifetimeCoins : (wallet?.balance ?? 0)}
            label={lifetimeCoins != null ? 'MONEDAS GANADAS' : 'MONEDAS'}
            hint={lifetimeCoins != null ? `${wallet?.balance ?? 0} ahora` : null}
          />
        </View>

        {stats === null && (
          <Text style={s.statsMissing}>
            Los contadores de pista se activan al correr supabase/stats.sql.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RD.bg },
  content: { paddingHorizontal: 18, paddingTop: 50, paddingBottom: 40, gap: 14 },
  backLink: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono, marginBottom: 4 },

  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 2 },
  identityText: { flex: 1, minWidth: 0, gap: 3 },
  nickname: {
    color: RD.textPrimary, fontSize: 30, fontFamily: RD_FONT.displayBlack,
    textTransform: 'uppercase',
  },
  identitySub: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono },

  heroRow: { flexDirection: 'row', gap: 10 },
  heroCard: {
    flex: 1, borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    paddingVertical: 16, alignItems: 'center', gap: 2,
  },
  // Neutro por defecto. El color se reserva para cuando dice algo (ver
  // heroValueGold); un número grande ya destaca por tamaño, no necesita
  // además un acento para que lo mires.
  heroValue: {
    color: RD.textPrimary, fontSize: 40, fontFamily: RD_FONT.displayBlack,
    fontVariant: ['tabular-nums'], lineHeight: 42,
  },
  heroValueGold: { color: RD.gold1st },
  heroLabel: { color: RD.textSecondary, fontSize: 10, fontFamily: RD_FONT.monoBold, letterSpacing: 1.2 },
  heroHint: { color: RD.textTertiary, fontSize: 10, fontFamily: RD_FONT.mono },

  sectionLabel: {
    color: RD.textTertiary, fontSize: 10, fontFamily: RD_FONT.mono,
    letterSpacing: 1.4, marginTop: 4, marginBottom: -6,
  },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1, borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    paddingVertical: 13, paddingHorizontal: 6, alignItems: 'center', gap: 3,
  },
  statValue: {
    color: RD.textPrimary, fontSize: 19, fontFamily: RD_FONT.displayBlack,
    fontVariant: ['tabular-nums'],
  },
  statValueDim: { color: RD.textDisabled },
  statLabel: {
    color: RD.textTertiary, fontSize: 9, fontFamily: RD_FONT.mono,
    letterSpacing: 0.6, textAlign: 'center',
  },
  statHint: { color: RD.textDisabled, fontSize: 9, fontFamily: RD_FONT.mono },
  statsMissing: {
    color: RD.textDisabled, fontSize: 10, fontFamily: RD_FONT.mono,
    textAlign: 'center', marginTop: -4,
  },

  actionsRow: { flexDirection: 'row', gap: 10, marginBottom: 2 },
  actionBtn: {
    flex: 1, borderWidth: 1, borderColor: RD.trackBlue, borderRadius: 2,
    paddingVertical: 14, alignItems: 'center',
  },
  actionBtnText: { color: RD.trackBlue, fontSize: 14, fontFamily: RD_FONT.monoBold },
});

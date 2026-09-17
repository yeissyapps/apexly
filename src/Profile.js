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
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import DangerStripe from './DangerStripe';
import StatTrend from './StatTrend';
import AvatarViewer from './AvatarViewer';
import { variantIndexForSeed } from './PilotViewer';
import { AVATARS, TOTAL_COLLECTIBLES } from './avatarCatalog';
import { RD, RD_FONT } from './theme';
import { fmtTime } from './format';
import { dailyTimeEstimate } from './generator';
import {
  getCareerProgress, getInventory, getGlobalBoard, getMyId, getPlayerRankToday,
  getPlayerStats, getMyDailyHistory, getMyPurpleSectors, getLifetimeCoins, getPilotAvatarId,
} from './api';
import { LEVEL_COUNT } from './career';

// Media pantalla de verdad, no un porcentaje del contenido del ScrollView
// (ahí "50%" no significa nada sin un padre de altura fija) — se mide
// directo contra la ventana. JC, 2026-09-15: "vea en media pantalla de
// arriba su avatar".
const AVATAR_HEIGHT = Dimensions.get('window').height * 0.5;

// TOTAL_PIECES vive en car.js (una sola fuente, calculada del catálogo del
// coche) — antes se calculaba aquí y estaba escrito a mano en Tienda.js, así
// que al añadir una categoría los dos números se separaban. TOTAL_COLLECTIBLES
// (avatarCatalog.js) le suma las piezas de avatar bloqueables: piecesOwned
// de abajo cuenta TODO el inventory sin filtrar por categoría, así que el
// total tiene que incluirlas también o "completo" llegaría antes de tiempo.

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

// Perfil dejó de caber en un solo scroll al sumar avatar 3D + stats +
// tendencia + acciones (JC, 2026-09-16: "muchísima info en el perfil").
// PILOTO agrupa lo visual/accionable (Garaje/Tienda/Carrera, avatar); STATS
// agrupa lo de leer (RACHA/HOY, tendencia, contadores). El avatar se queda
// a media pantalla tal cual se pidió — se reparte el contenido en dos
// pestañas en vez de encogerlo.
const PROFILE_TABS = [
  { id: 'piloto', label: 'PILOTO' },
  { id: 'stats', label: 'STATS' },
];

function StatCard({ value, label, hint, tone }) {
  return (
    <View style={s.statCard}>
      <Text style={[s.statValue, tone === 'dim' && s.statValueDim]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
      {!!hint && <Text style={s.statHint}>{hint}</Text>}
    </View>
  );
}

export default function Profile({
  nickname, myStreak, wallet, onBack, onOpenGarage, onOpenTienda, onOpenCareer, onOpenAvatarPicker,
  onOpenPilotTest, onOpenAvatarTest,
  viewUserId, viewNickname, viewStreak,
}) {
  const [career, setCareer] = useState(null);
  const [piecesOwned, setPiecesOwned] = useState(null);
  const [todayRank, setTodayRank] = useState(undefined); // undefined = cargando, null = no jugó hoy
  const [stats, setStats] = useState(undefined);         // undefined = cargando, null = tabla sin crear
  const [purple, setPurple] = useState(null);
  const [lifetimeCoins, setLifetimeCoins] = useState(null);
  const [trend, setTrend] = useState(null);
  const [myId, setMyId] = useState(null);
  const [tab, setTab] = useState('piloto');
  const [pilotAvatarId, setPilotAvatarId] = useState(null); // null = todavía sin elegir uno (o cargando) -> hash de siempre

  // Perfil público de otro jugador (JC, 2026-09-15) — viewUserId llega al
  // tocar un nombre/avatar en cualquier ranking (ver App.js:
  // openPlayerProfile). Se compara contra tu propio id (no solo "¿llegó
  // viewUserId?") porque tocar TU PROPIA fila en un ranking también pasa
  // por aquí, y debe verse como "mi perfil" de toda la vida, con sus
  // botones y sus monedas — no como el de un desconocido.
  const isOwnProfile = !viewUserId || viewUserId === myId;
  const displayNickname = isOwnProfile ? nickname : (viewNickname || '···');

  useEffect(() => {
    let alive = true;
    getMyId().then((id) => alive && setMyId(id)).catch(() => {});
    getCareerProgress(viewUserId).then((n) => alive && setCareer(n)).catch(() => alive && setCareer(0));
    getInventory(viewUserId)
      .then((items) => {
        if (!alive) return;
        setPiecesOwned(new Set(items.map((p) => `${p.category}:${p.pieceId}`)).size);
      })
      .catch(() => alive && setPiecesOwned(0));

    // El puesto de hoy: la tuya usa getGlobalBoard (ventana completa, ya la
    // pedía Inicio); la de otro jugador solo necesita SU número, no toda
    // la ventana de vecinos — getPlayerRankToday es más barata para eso.
    if (viewUserId) {
      getPlayerRankToday(viewUserId).then((r) => alive && setTodayRank(r)).catch(() => alive && setTodayRank(null));
    } else {
      getGlobalBoard()
        .then((b) => alive && setTodayRank(b.me ? b.me.rank : null))
        .catch(() => alive && setTodayRank(null));
    }

    getPlayerStats(viewUserId).then((v) => alive && setStats(v)).catch(() => alive && setStats(null));
    getMyPurpleSectors(undefined, viewUserId).then((v) => alive && setPurple(v)).catch(() => {});
    // El avatar REAL que eligió (Fase 4, inventario de verdad, JC
    // 2026-09-16) — null mientras carga o si nunca eligió ninguno, y en
    // ese caso se sigue cayendo al hash determinista de siempre (ver
    // `avatar` más abajo), no a un "sin avatar".
    getPilotAvatarId(viewUserId).then((id) => alive && setPilotAvatarId(id)).catch(() => {});
    // Las monedas son privadas (JC: público el avatar y las stats, no el
    // saldo) — ni se piden para el perfil de otro jugador.
    if (!viewUserId) {
      getLifetimeCoins().then((v) => alive && setLifetimeCoins(v)).catch(() => {});
    }

    // El gráfico va aparte y DESPUÉS: necesita calcular el objetivo de cada
    // día, que es caro la primera vez. Se resuelve fuera del primer pintado
    // para que el resto del perfil aparezca ya.
    getMyDailyHistory(30, viewUserId)
      .then(async (rows) => {
        if (!alive || rows.length === 0) { if (alive) setTrend([]); return; }
        const targets = await loadTargets(rows.map((r) => r.day));
        if (!alive) return;
        setTrend(rows.map((r) => ({ ...r, targetMs: targets[r.day] || 0 })));
      })
      .catch(() => alive && setTrend([]));

    return () => { alive = false; };
  }, [viewUserId]);

  const daysRaced = trend ? trend.length : null;
  // Choques por vuelta es más honesto que el total: 400 choques en 500
  // vueltas es un dato distinto a 400 en 50, y el total solo premia a quien
  // más ha jugado.
  const crashRate = stats && stats.laps > 0 ? (stats.crashes / stats.laps).toFixed(1) : null;

  // `profileId`: el de la persona que se está viendo (otro jugador o, sin
  // viewUserId, tú mismo). Si ya eligió un avatar de verdad (selector real,
  // JC 2026-09-16, ver AvatarPicker.js) se usa ESE; si no (nunca lo tocó,
  // o el dato aún no ha llegado), se cae al mismo hash determinista que
  // pinta AvatarThumb.js en las listas — mismo criterio en los dos sitios,
  // así el jugador ve siempre el mismo muñeco hasta que elige el suyo.
  const profileId = viewUserId || myId;
  const avatar = pilotAvatarId
    ? (AVATARS.find((a) => a.key === pilotAvatarId) || AVATARS[0])
    : (profileId ? AVATARS[variantIndexForSeed(profileId, AVATARS.length)] : AVATARS[0]);

  return (
    <View style={s.screen}>
      <StatusBar hidden />
      <DangerStripe height={6} />
      <ScrollView contentContainerStyle={s.content}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={s.backLink}>‹ INICIO</Text>
        </Pressable>

        <View style={s.identity}>
          <View style={s.identityText}>
            <Text style={s.nickname} numberOfLines={1}>{displayNickname}</Text>
            <Text style={s.identitySub}>
              {daysRaced != null ? `${daysRaced} ${daysRaced === 1 ? 'día corrido' : 'días corridos'}` : '···'}
              {stats?.bestMs ? ` · mejor ${fmtTime(stats.bestMs)}` : ''}
            </Text>
          </View>
        </View>

        {/* Dos pestañas (JC, 2026-09-16: "muchísima info en el perfil") en
            vez de un único scroll largo — ver PROFILE_TABS arriba. */}
        <View style={s.tabsRow}>
          {PROFILE_TABS.map((t) => (
            <Pressable
              key={t.id}
              style={[s.tab, tab === t.id && s.tabActive]}
              onPress={() => setTab(t.id)}
            >
              <Text style={[s.tabText, tab === t.id && s.tabTextActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === 'piloto' && (
          <>
            {/* Garaje, Tienda y Carrera actúan sobre TU cuenta — solo tienen
                sentido en tu propio perfil, no en el de otro jugador (JC,
                2026-09-15: perfiles públicos). Carrera se sumó aquí el
                2026-09-09: tenía poca acogida como pestaña propia y no es
                de lo principal del juego — vive junto a Garaje/Tienda, no
                en la barra de abajo. */}
            {isOwnProfile && (
              <View style={s.actionsRow}>
                {/* Colores distintos por botón (JC, 2026-09-16) — antes los
                    3 llevaban el mismo trackBlue y se leían como una sola
                    pieza de 3 partes en vez de 3 destinos distintos. Cada
                    color reutiliza un token que YA significa algo en el
                    resto de la app (ver theme.js): trackBlue es "coche",
                    gold1st es "moneda/récord", successGreen es "progreso". */}
                <Pressable style={[s.actionBtn, s.actionBtnGaraje]} onPress={onOpenGarage}>
                  <Text style={[s.actionBtnText, s.actionBtnTextGaraje]}>GARAJE</Text>
                </Pressable>
                <Pressable style={[s.actionBtn, s.actionBtnTienda]} onPress={onOpenTienda}>
                  <Text style={[s.actionBtnText, s.actionBtnTextTienda]}>TIENDA</Text>
                </Pressable>
                <Pressable style={[s.actionBtn, s.actionBtnCarrera]} onPress={onOpenCareer}>
                  <Text style={[s.actionBtnText, s.actionBtnTextCarrera]}>CARRERA</Text>
                </Pressable>
                {/* Selector real de avatar (JC, 2026-09-16) — youMagenta
                    porque ya es el color de "épica" en el resto de la app
                    (RARITY_COLOR), y este botón lleva justo a la pantalla
                    de rarezas. */}
                <Pressable style={[s.actionBtn, s.actionBtnAvatar]} onPress={onOpenAvatarPicker}>
                  <Text style={[s.actionBtnText, s.actionBtnTextAvatar]}>AVATAR</Text>
                </Pressable>
              </View>
            )}

            {/* Botón de prueba SOLO en dev — desaparece solo en cualquier
                build de release, no hace falta acordarse de quitarlo. Sirve
                para ver el PilotViewer (Fase 1 de avatares) mientras se
                construye. */}
            {isOwnProfile && __DEV__ && !!onOpenPilotTest && (
              <Pressable style={s.devBtn} onPress={onOpenPilotTest}>
                <Text style={s.devBtnText}>[DEV] PILOTO 3D</Text>
              </Pressable>
            )}

            {/* Fase 4 (JC, 2026-09-15): muñecos enteros desbloqueables por
                rareza, con textura real en vez de tinte por piezas. */}
            {isOwnProfile && __DEV__ && !!onOpenAvatarTest && (
              <Pressable style={s.devBtn} onPress={onOpenAvatarTest}>
                <Text style={s.devBtnText}>[DEV] AVATARES</Text>
              </Pressable>
            )}

            {/* El avatar a media pantalla, tal como se pidió — ahora el
                muñeco entero de verdad (Fase 4, avatarCatalog.js), no el
                configurador viejo por piezas. */}
            <View style={s.avatarStage}>
              <AvatarViewer key={avatar.key} source={avatar.glb} cacheKey={avatar.key} />
            </View>
          </>
        )}

        {tab === 'stats' && (
          <>
            {/* Fila de titulares: antes vivía en PILOTO, pero competía con
                el avatar por protagonismo — JC, 2026-09-16: "quitaría
                racha y hoy de ahí". Aquí es lo primero que se lee, que es
                donde encaja: STATS es la pantalla de leer números. */}
            <View style={s.heroRow}>
              <View style={s.heroCard}>
                {/* viewStreak (JC, 2026-09-16: "no se ve la racha en los
                    perfiles de la gente") llega como número plano desde las
                    filas de ranking (`r.streak = users.current_streak`,
                    ver api.js) — no como {current, longest}, que es la
                    forma de myStreak (la tuya, cargada aparte en Inicio).
                    Pedirle `.current` a un número da undefined siempre. */}
                <Text style={s.heroValue}>{(isOwnProfile ? myStreak?.current : viewStreak) ?? 0}</Text>
                <Text style={s.heroLabel}>RACHA</Text>
                {/* La racha MÁXIMA solo la tienes tú misma cargada (viene
                    por prop desde Inicio) — el ranking no manda
                    longest_streak de otros jugadores, así que en un perfil
                    ajeno se omite en vez de enseñar un "máx. 0" que sería
                    mentira. */}
                {isOwnProfile && <Text style={s.heroHint}>máx. {myStreak?.longest ?? 0}</Text>}
              </View>
              <View style={s.heroCard}>
                {/* El dorado SOLO si de verdad vas primero. Antes lo
                    llevaban todos los números de la pantalla, así que no
                    distinguía nada; apareciendo solo aquí, vuelve a
                    significar "podio". */}
                <Text style={[s.heroValue, todayRank === 1 && s.heroValueGold]}>
                  {todayRank ? `#${todayRank}` : todayRank === null ? '—' : '···'}
                </Text>
                <Text style={s.heroLabel}>HOY</Text>
                <Text style={s.heroHint}>
                  {purple ? `${purple.mine}/3 morados` : ' '}
                </Text>
              </View>
            </View>

            <StatTrend points={trend || []} own={isOwnProfile} />

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
                value={piecesOwned != null ? `${piecesOwned}/${TOTAL_COLLECTIBLES}` : '—'}
                label="PIEZAS"
              />
              {/* Las monedas se quedan fuera del perfil público (JC,
                  2026-09-15: "público su avatar y sus stats" — el saldo no
                  es una stat de pista/colección, es dinero). */}
              {isOwnProfile && (
                <StatCard
                  value={lifetimeCoins != null ? lifetimeCoins : (wallet?.balance ?? 0)}
                  label={lifetimeCoins != null ? 'MONEDAS GANADAS' : 'MONEDAS'}
                  hint={lifetimeCoins != null ? `${wallet?.balance ?? 0} ahora` : null}
                />
              )}
            </View>

            {stats === null && (
              <Text style={s.statsMissing}>
                Los contadores de pista se activan al correr supabase/stats.sql.
              </Text>
            )}
          </>
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

  tabsRow: { flexDirection: 'row', gap: 6 },
  tab: {
    flex: 1, borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    paddingVertical: 9, alignItems: 'center', justifyContent: 'center',
  },
  tabActive: { borderColor: RD.brand },
  tabText: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.monoBold, letterSpacing: 1 },
  tabTextActive: { color: RD.textPrimary },

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
    flex: 1, borderWidth: 1, borderRadius: 2,
    paddingVertical: 14, alignItems: 'center',
  },
  actionBtnText: { fontSize: 14, fontFamily: RD_FONT.monoBold },
  actionBtnGaraje: { borderColor: RD.trackBlue },
  actionBtnTextGaraje: { color: RD.trackBlue },
  actionBtnTienda: { borderColor: RD.gold1st },
  actionBtnTextTienda: { color: RD.gold1st },
  actionBtnCarrera: { borderColor: RD.successGreen },
  actionBtnTextCarrera: { color: RD.successGreen },
  actionBtnAvatar: { borderColor: RD.youMagenta },
  actionBtnTextAvatar: { color: RD.youMagenta },

  devBtn: {
    borderWidth: 1, borderColor: '#665', borderStyle: 'dashed', borderRadius: 2,
    paddingVertical: 10, alignItems: 'center', marginTop: -4,
  },
  devBtnText: { color: '#aa8', fontSize: 11, fontFamily: RD_FONT.mono },

  // El escenario del piloto: JC, 2026-09-15, "reducir márgenes... se ve
  // apagado" — el margen negativo recorta el hueco que dejaba el `gap` del
  // ScrollView por encima/debajo (antes 14+14 de vacío, ahora la mitad), y
  // el fondo ligeramente más claro que el negro puro de la pantalla + las
  // dos líneas finas lo enmarcan como un panel propio en vez de negro
  // fundiéndose con negro.
  avatarStage: {
    height: AVATAR_HEIGHT,
    marginHorizontal: -18,
    marginVertical: -8,
    backgroundColor: '#111113',
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: RD.panelBorder,
  },
});

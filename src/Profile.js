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

import { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import DangerStripe from './DangerStripe';
import StatTrend from './StatTrend';
import AvatarViewer from './AvatarViewer';
import CoinIcon from './CoinIcon';
import { AVATARS, TOTAL_COLLECTIBLES } from './avatarCatalog';
import { RD, RD_FONT } from './theme';
import { fmtTime } from './format';
import { dailyTimeEstimate } from './generator';
import {
  getCareerProgress, getInventory, getGlobalBoard, getMyId, getPlayerRankToday,
  getPlayerStats, getMyDailyHistory, getMyPurpleSectors, getLifetimeCoins, getPilotAvatarId,
  createDuel, cancelDuel, getMyActiveDuels, getPresenceMap,
} from './api';
import { LEVEL_COUNT } from './career';

// "En línea" es una aproximación por sondeo (touchPresence cada ~60s desde
// App.js, sin tiempo real) — 3 minutos de margen para no parpadear a
// "desconectado" entre dos latidos si uno se retrasa un poco.
const ONLINE_WINDOW_MS = 3 * 60 * 1000;

// El duelo vivo con el jugador cuyo perfil estás viendo: qué es y qué puedes
// hacer con él. Sustituye al formulario de retar (no se puede abrir otro 1 vs
// 1 con la misma persona hasta que este se resuelva). El resto de tus duelos
// están en la pestaña 1 VS 1 de Inicio (DuelsTab.js), no en el perfil.
function DuelStatusRow({ d, onOpen, onCancel, cancelling }) {
  const mins = Math.max(1, Math.ceil((new Date(d.deadline).getTime() - Date.now()) / 60000));

  // Reto MÍO sin contestar: el toque de la fila NO cancela (sería fácil de
  // pulsar sin querer), solo el botón CANCELAR.
  if (d.status === 'pending' && d.role === 'outgoing') {
    return (
      <View style={s.duelBanner}>
        <Text style={s.duelBannerText}>
          Esperando a {d.otherName} · {d.wager} monedas · caduca en {mins} min
        </Text>
        <Pressable onPress={() => onCancel(d.id)} disabled={cancelling} hitSlop={10}>
          <Text style={[s.duelBannerLink, s.duelBannerCancel]}>{cancelling ? '…' : 'CANCELAR'}</Text>
        </Pressable>
      </View>
    );
  }

  let text;
  let action;
  if (d.status === 'pending') {
    text = `${d.otherName} te reta por ${d.wager} monedas`;
    action = 'VER ›';
  } else if (!d.myRunDone) {
    text = `1 vs 1 con ${d.otherName} · ${d.wager} monedas · te quedan ${mins} min para correr`;
    action = 'CORRER ›';
  } else {
    text = `1 vs 1 con ${d.otherName} · ya has corrido, falta su vuelta`;
    action = 'VER ›';
  }
  return (
    <Pressable style={s.duelBanner} onPress={() => onOpen(d.id)}>
      <Text style={s.duelBannerText}>{text}</Text>
      <Text style={s.duelBannerLink}>{action}</Text>
    </Pressable>
  );
}

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
  onOpenPilotTest, onOpenAvatarTest, onOpenDuel,
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
  const [online, setOnline] = useState(false);      // presencia real del jugador que se está viendo
  const [activeDuels, setActiveDuels] = useState([]); // mis duelos vivos, recibidos o enviados (ver getMyActiveDuels)
  const [cancelBusy, setCancelBusy] = useState(null); // id del reto que se está cancelando
  const [wagerInput, setWagerInput] = useState('50');
  const [challengeBusy, setChallengeBusy] = useState(false);
  const [challengeMsg, setChallengeMsg] = useState(null); // { type: 'ok'|'err', text }

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

  // Duelos 1vs1 (JC, 2026-09-17): se cargan MIS duelos vivos tanto en tu
  // perfil (aviso de cada uno: responder, cancelar, correr) como en el de un
  // rival (si ya hay uno entre los dos, sustituye al formulario de retar y se
  // ve/gestiona ahí mismo — JC, 2026-09-19: "ya tienes un reto pendiente" sin
  // poder ver cuál era). En el perfil de otro jugador, además, se comprueba su
  // presencia real para la insignia EN LÍNEA.
  const reloadDuels = useCallback(
    () => getMyActiveDuels().then(setActiveDuels).catch(() => {}),
    []
  );
  useEffect(() => {
    let alive = true;
    if (viewUserId) {
      getMyActiveDuels().then((d) => alive && setActiveDuels(d)).catch(() => {});
      getPresenceMap([viewUserId]).then((m) => {
        if (!alive) return;
        const seen = m.get(viewUserId);
        setOnline(!!seen && Date.now() - seen.getTime() < ONLINE_WINDOW_MS);
      }).catch(() => {});
    }
    return () => { alive = false; };
  }, [viewUserId]);

  async function handleChallenge() {
    const wager = parseInt(wagerInput, 10);
    if (!wager || wager <= 0 || challengeBusy) return;
    // El servidor también lo comprueba (create_duel); esto solo ahorra el
    // viaje y da el mensaje al momento. Si el saldo aún no ha llegado, se
    // deja pasar y decide el servidor.
    if (wallet?.balance != null && wager > wallet.balance) {
      setChallengeMsg({ type: 'err', text: `No tienes tantas monedas: tienes ${wallet.balance}.` });
      return;
    }
    setChallengeBusy(true);
    setChallengeMsg(null);
    try {
      await createDuel(viewUserId, wager);
      await reloadDuels(); // el reto recién enviado sale ya abajo, con su cuenta atrás y su botón de cancelar
    } catch (e) {
      const code = String(e?.message || e);
      const text = code.includes('DUEL_ALREADY_PENDING') ? 'Ya tenéis un 1 vs 1 en marcha.'
        : code.includes('INSUFFICIENT_FUNDS') ? 'No te quedan monedas libres para esa apuesta (cuentan tus retos pendientes).'
        : code.includes('INVALID_WAGER') ? 'Pon una apuesta válida.'
        : 'No se pudo enviar el reto. Inténtalo otra vez.';
      setChallengeMsg({ type: 'err', text });
      if (code.includes('DUEL_ALREADY_PENDING')) reloadDuels();
    } finally {
      setChallengeBusy(false);
    }
  }

  async function handleCancelDuel(id) {
    if (cancelBusy) return;
    setCancelBusy(id);
    try { await cancelDuel(id); } catch (_) { /* ya no estaba pendiente: se recarga igual */ }
    await reloadDuels();
    setCancelBusy(null);
  }

  // Mi duelo vivo con el jugador que estoy viendo (si lo hay).
  const duelWithThem = !isOwnProfile ? activeDuels.find((d) => d.otherId === viewUserId) : null;

  // Mientras espero a que acepten mi reto, se mira cada pocos segundos: sin
  // esto, al aceptar el otro jugador no aparecía CORRER aquí hasta salir del
  // perfil y volver a entrar (JC, 2026-09-19).
  const waitingOnThem = duelWithThem?.status === 'pending' && duelWithThem?.role === 'outgoing';
  useEffect(() => {
    if (!waitingOnThem) return undefined;
    const t = setInterval(reloadDuels, 5000);
    return () => clearInterval(t);
  }, [waitingOnThem, reloadDuels]);

  const daysRaced = trend ? trend.length : null;
  // Choques por vuelta es más honesto que el total: 400 choques en 500
  // vueltas es un dato distinto a 400 en 50, y el total solo premia a quien
  // más ha jugado.
  const crashRate = stats && stats.laps > 0 ? (stats.crashes / stats.laps).toFixed(1) : null;

  // Si ya eligió un avatar de verdad (selector real, JC 2026-09-16, ver
  // AvatarPicker.js) se usa ESE; si no (nunca lo tocó, o el dato aún no ha
  // llegado), cae a la base — JC, 2026-09-17: "ahora hay jugadores con
  // diferentes avatares, todo el mundo debe tener el azul". Antes cada
  // jugador caía a un diseño distinto por hash de su id (variantIndexForSeed),
  // lo que hacía parecer que cualquiera podía "tener" un raro/épico sin
  // haberlo ganado en un sobre — justo lo contrario de la economía real que
  // se acaba de montar. Mismo criterio en AvatarThumb.js (listas/ranking).
  const avatar = pilotAvatarId
    ? (AVATARS.find((a) => a.key === pilotAvatarId) || AVATARS[0])
    : AVATARS[0];

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
            <View style={s.nicknameRow}>
              <Text style={s.nickname} numberOfLines={1}>{displayNickname}</Text>
              {!isOwnProfile && online && (
                <View style={s.onlinePill}>
                  <View style={s.onlineDot} />
                  <Text style={s.onlinePillText}>EN LÍNEA</Text>
                </View>
              )}
            </View>
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

            {/* RETAR (JC, 2026-09-17: duelos 1vs1) — perfil de OTRO jugador
                solamente, mismo hueco donde se ocultan Garaje/Tienda/Carrera
                por ser "tu cuenta". La apuesta se cobra a los dos al
                ACEPTAR, no al enviar el reto — aquí no se mueve nada
                todavía, solo se manda. */}
            {!isOwnProfile && duelWithThem && (
              <View style={s.duelCard}>
                <Text style={s.duelCardTitle}>1 VS 1 EN CURSO</Text>
                <DuelStatusRow
                  d={duelWithThem}
                  onOpen={onOpenDuel}
                  onCancel={handleCancelDuel}
                  cancelling={cancelBusy === duelWithThem.id}
                />
                <Text style={s.duelMsgHint}>
                  Todos tus 1 vs 1 están en la pestaña 1 VS 1 de Inicio. Hasta que este se resuelva no podéis abrir otro.
                </Text>
              </View>
            )}

            {!isOwnProfile && !duelWithThem && (
              <View style={s.duelCard}>
                <Text style={s.duelCardTitle}>RETAR A UN 1 VS 1</Text>
                <View style={s.duelWagerRow}>
                  <CoinIcon size={16} />
                  <TextInput
                    style={s.duelWagerInput}
                    value={wagerInput}
                    onChangeText={(t) => setWagerInput(t.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    maxLength={5}
                  />
                  {wallet?.balance != null && (
                    <Text style={s.duelWagerHint}>tienes {wallet.balance}</Text>
                  )}
                </View>
                {!!challengeMsg && (
                  <Text style={challengeMsg.type === 'ok' ? s.duelMsgOk : s.duelMsgErr}>{challengeMsg.text}</Text>
                )}
                <Pressable
                  style={[s.retarBtn, challengeBusy && s.retarBtnDisabled]}
                  onPress={handleChallenge}
                  disabled={challengeBusy}
                >
                  <Text style={s.retarBtnText}>{challengeBusy ? 'ENVIANDO…' : 'RETAR'}</Text>
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
  nicknameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  nickname: {
    color: RD.textPrimary, fontSize: 30, fontFamily: RD_FONT.displayBlack,
    textTransform: 'uppercase',
  },
  identitySub: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono },
  onlinePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderColor: RD.successGreen, borderRadius: 2,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: RD.successGreen },
  onlinePillText: { color: RD.successGreen, fontSize: 9, fontFamily: RD_FONT.monoBold, letterSpacing: 0.8 },

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

  duelBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: RD.brand, borderRadius: 2,
    paddingVertical: 12, paddingHorizontal: 14, marginBottom: 2,
  },
  duelBannerText: { color: RD.textPrimary, fontSize: 12, fontFamily: RD_FONT.monoBold, flex: 1, marginRight: 8 },
  duelBannerLink: { color: RD.brand, fontSize: 12, fontFamily: RD_FONT.monoBold },
  duelBannerCancel: { color: RD.textSecondary },
  duelWagerHint: { color: RD.textSecondary, fontSize: 11, fontFamily: RD_FONT.mono },
  duelMsgHint: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono },

  duelCard: {
    borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    padding: 14, gap: 10,
  },
  duelCardTitle: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.monoBold, letterSpacing: 1 },
  duelWagerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: RD.gold1st, borderRadius: 2,
    backgroundColor: RD.gold1stShade, paddingVertical: 10, paddingHorizontal: 12,
  },
  duelWagerInput: {
    flex: 1, color: RD.gold1st, fontSize: 18, fontFamily: RD_FONT.monoBold,
    padding: 0,
  },
  duelMsgOk: { color: RD.successGreen, fontSize: 11, fontFamily: RD_FONT.mono },
  duelMsgErr: { color: RD.danger, fontSize: 11, fontFamily: RD_FONT.mono },
  retarBtn: { backgroundColor: RD.brand, borderRadius: 2, paddingVertical: 13, alignItems: 'center' },
  retarBtnDisabled: { opacity: 0.5 },
  retarBtnText: { color: RD.bg, fontSize: 14, fontFamily: RD_FONT.displayBlack, letterSpacing: 0.6 },

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

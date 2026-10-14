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
import PodiumStage, { podiumFraming } from './PodiumStage';
import Svg, { Path, Rect } from 'react-native-svg';
import CoinIcon from './CoinIcon';
import { AVATARS, TOTAL_COLLECTIBLES } from './avatarCatalog';
import { RD, RD_FONT, RARITY_COLOR } from './theme';
import { fmtTime } from './format';
import { dailyTimeEstimate } from './generator';
import {
  getCareerProgress, getInventory, getGlobalBoard, getMyId, getPlayerRankToday,
  getPlayerStats, getMyDailyHistory, getMyPurpleSectors, getLifetimeCoins, getPilotAvatarId,
  createDuel, cancelDuel, getMyActiveDuels, getPresenceMap,
  getMonthlyRanking, getWorldWinCounts, getPurpleTotal, getLongestStreak,
} from './api';
import { LEVEL_COUNT } from './career';
import { t, getLang, setLang, ord } from './i18n';

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
          {t('Esperando a {name} · {n} monedas · caduca en {mins} min', { name: d.otherName, n: d.wager, mins })}
        </Text>
        <Pressable onPress={() => onCancel(d.id)} disabled={cancelling} hitSlop={10}>
          <Text style={[s.duelBannerLink, s.duelBannerCancel]}>{cancelling ? '…' : t('CANCELAR')}</Text>
        </Pressable>
      </View>
    );
  }

  let text;
  let action;
  if (d.status === 'pending') {
    text = t('{name} te reta por {n} monedas', { name: d.otherName, n: d.wager });
    action = t('VER ›');
  } else if (!d.myRunDone) {
    text = t('1 vs 1 con {name} · {n} monedas · te quedan {mins} min para correr', { name: d.otherName, n: d.wager, mins });
    action = t('CORRER ›');
  } else {
    text = t('1 vs 1 con {name} · ya has corrido, falta su vuelta', { name: d.otherName });
    action = t('VER ›');
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
const AVATAR_HEIGHT = Dimensions.get('window').height * 0.46;
const STAGE_W = Dimensions.get('window').width;
// Cuánto se espera al puesto del mes antes de montar el muñeco igualmente.
const STAGE_WAIT_MS = 2500; // a sangre: marginHorizontal -18 anula el padding

// Fondo de tarjeta: un paso por encima del negro de la pantalla, el mismo
// del escenario del avatar. Sin él las tarjetas eran solo un borde
// flotando en negro.
const RD_SURFACE = '#111113';

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

// Selector de idioma (src/i18n.js) — solo en tu propio perfil. Cambiarlo
// vuelve a montar la app entera con el idioma nuevo (ver index.js).
function LangSwitch() {
  const lang = getLang();
  return (
    <View style={s.langRow}>
      <Text style={s.langLabel}>{t('IDIOMA')}</Text>
      <View style={s.langOpts}>
        {[['es', 'Español'], ['en', 'English']].map(([code, name]) => (
          <Pressable
            key={code}
            style={[s.langOpt, lang === code && s.langOptActive]}
            onPress={() => setLang(code)}
            hitSlop={6}
          >
            <Text style={[s.langOptText, lang === code && s.langOptTextActive]}>{name}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// Fila de telemetría: etiqueta a la izquierda, número a la derecha. Antes
// eran seis tarjetas idénticas en rejilla — todas pesaban lo mismo y la
// pantalla se leía como un muro de cajas (JC, 2026-10-14: "mejora el diseño
// del perfil"). En lista se escanean de arriba abajo como una hoja de datos.
function StatRow({ label, value, hint, dim, last }) {
  return (
    <View style={[s.statRow, last && s.statRowLast]}>
      <Text style={s.statRowLabel}>{label}</Text>
      <View style={s.statRowRight}>
        {!!hint && <Text style={s.statRowHint}>{hint}</Text>}
        <Text style={[s.statRowValue, dim && s.statValueDim]}>{value}</Text>
      </View>
    </View>
  );
}

// Vitrina: cuatro logros con su emblema. El emblema y el número se apagan a
// gris mientras valen 0 — un "0 victorias" en oro presumiría de nada.
const PURPLE = '#b884ff'; // el morado de los sectores (SECTOR_COLORS en Game.js)

function TrophyIcon({ icon, color }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 20 20">
      {icon === 'crown' && (
        <>
          <Path d="M3 14 L2 5 L7 9 L10 3 L13 9 L18 5 L17 14 Z" fill={color} />
          <Rect x={3} y={15.5} width={14} height={2} fill={color} />
        </>
      )}
      {icon === 'podium' && (
        <>
          <Rect x={7} y={4} width={6} height={14} fill={color} />
          <Rect x={1} y={8} width={5.5} height={10} fill={color} fillOpacity={0.7} />
          <Rect x={13.5} y={11} width={5.5} height={7} fill={color} fillOpacity={0.5} />
        </>
      )}
      {icon === 'sectors' && (
        <>
          <Rect x={1} y={8} width={5.3} height={4} fill={color} fillOpacity={0.5} />
          <Rect x={7.35} y={8} width={5.3} height={4} fill={color} />
          <Rect x={13.7} y={8} width={5.3} height={4} fill={color} fillOpacity={0.5} />
        </>
      )}
      {icon === 'flame' && (
        <Path d="M10 1.5 C12.5 5.5 16 8 16 12.5 A6 6 0 0 1 4 12.5 C4 9.5 5.8 7.6 7 5.8 C7.6 8 8.6 9.2 10 9.6 C10.3 6.8 9.4 4.2 10 1.5 Z" fill={color} />
      )}
    </Svg>
  );
}

function Trophy({ icon, color, value, label }) {
  const has = value > 0;
  return (
    <View style={s.trophy}>
      <TrophyIcon icon={icon} color={has ? color : RD.textDisabled} />
      <Text style={[s.trophyValue, !has && s.trophyValueDim]}>
        {value === undefined ? '···' : value === null ? '—' : value}
      </Text>
      <Text style={s.trophyLabel} numberOfLines={2}>{label}</Text>
    </View>
  );
}

// Acceso a Garaje / Tienda / Carrera. Cada uno conserva su color (JC,
// 2026-09-16: tres destinos distintos, no una pieza de tres partes), pero
// ahora el color va solo en el nombre y la tarjeta enseña un dato de verdad
// — cuántas piezas, cuántas monedas, en qué nivel vas — en vez de ser un
// botón vacío.
function ActionTile({ label, color, value, caption, coin, onPress }) {
  return (
    <Pressable style={({ pressed }) => [s.tile, pressed && s.tilePressed]} onPress={onPress}>
      <View style={s.tileHead}>
        <Text style={[s.tileLabel, { color }]}>{label}</Text>
        <Text style={s.tileArrow}>›</Text>
      </View>
      <View style={s.tileValueRow}>
        {coin && <CoinIcon size={15} />}
        <Text style={s.tileValue} numberOfLines={1}>{value}</Text>
      </View>
      <Text style={s.tileCaption}>{caption}</Text>
    </Pressable>
  );
}

export default function Profile({
  nickname, myStreak, wallet, onBack, onOpenGarage, onOpenTienda, onOpenCareer, onOpenAvatarPicker,
  onOpenPilotTest, onOpenAvatarTest, onOpenDuel, onOpenLoopTest,
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
  // Podio y vitrina (JC, 2026-10-14). undefined = cargando, null = sin dato.
  const [monthRank, setMonthRank] = useState(undefined);   // puesto en el ranking del mes (null = no ha corrido este mes)
  const [monthPodiums, setMonthPodiums] = useState(undefined);
  const [wins, setWins] = useState(undefined);             // días ganados (1.º del mundo), de siempre
  const [purpleTotal, setPurpleTotal] = useState(undefined);
  const [otherLongest, setOtherLongest] = useState(undefined); // mejor racha de OTRO jugador (la tuya llega por myStreak)
  const [stageWaited, setStageWaited] = useState(false);
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

    // Podio (puesto del mes) y vitrina. El ranking del mes es el mismo que
    // enseña la pestaña RANKING (puntos por día, ver getMonthlyRanking).
    const wait = setTimeout(() => alive && setStageWaited(true), STAGE_WAIT_MS);
    Promise.all([viewUserId ? Promise.resolve(viewUserId) : getMyId(), getMonthlyRanking()])
      .then(([uid, { rows }]) => {
        if (!alive) return;
        const row = rows.find((r) => r.userId === uid);
        setMonthRank(row ? row.rank : null);
        setMonthPodiums(row ? row.podiums : 0);
      })
      .catch(() => { if (alive) { setMonthRank(null); setMonthPodiums(null); } });
    (viewUserId ? Promise.resolve(viewUserId) : getMyId())
      .then((uid) => getWorldWinCounts([uid]).then((m) => alive && setWins(m[uid] || 0)))
      .catch(() => alive && setWins(null));
    getPurpleTotal(viewUserId).then((n) => alive && setPurpleTotal(n)).catch(() => alive && setPurpleTotal(null));
    if (viewUserId) {
      getLongestStreak(viewUserId).then((n) => alive && setOtherLongest(n)).catch(() => alive && setOtherLongest(null));
    }
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

    return () => { alive = false; clearTimeout(wait); };
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
      setChallengeMsg({ type: 'err', text: t('No tienes tantas monedas: tienes {n}.', { n: wallet.balance }) });
      return;
    }
    setChallengeBusy(true);
    setChallengeMsg(null);
    try {
      await createDuel(viewUserId, wager);
      await reloadDuels(); // el reto recién enviado sale ya abajo, con su cuenta atrás y su botón de cancelar
    } catch (e) {
      const code = String(e?.message || e);
      const text = code.includes('DUEL_ALREADY_PENDING') ? t('Ya tenéis un 1 vs 1 en marcha.')
        : code.includes('INSUFFICIENT_FUNDS') ? t('No te quedan monedas libres para esa apuesta (cuentan tus retos pendientes).')
        : code.includes('INVALID_WAGER') ? t('Pon una apuesta válida.')
        : t('No se pudo enviar el reto. Inténtalo otra vez.');
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
    const id = setInterval(reloadDuels, 5000);
    return () => clearInterval(id);
  }, [waitingOnThem, reloadDuels]);

  const daysRaced = trend ? trend.length : null;
  // Choques por vuelta es más honesto que el total: 400 choques en 500
  // vueltas es un dato distinto a 400 en 50, y el total solo premia a quien
  // más ha jugado.
  // Coma decimal en español ("1,0/vuelta"), punto en inglés.
  const crashRate = stats && stats.laps > 0
    ? (stats.crashes / stats.laps).toFixed(1).replace('.', getLang() === 'en' ? '.' : ',')
    : null;

  // Escalón del podio = puesto del mes si es 1-3; si no, al suelo.
  const podiumPlace = monthRank >= 1 && monthRank <= 3 ? monthRank : null;
  const stageReady = monthRank !== undefined || stageWaited;
  const bestStreak = isOwnProfile ? (myStreak?.longest ?? undefined) : otherLongest;

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
          <Text style={s.backLink}>{t('‹ INICIO')}</Text>
        </Pressable>

        <View style={s.identity}>
          <View style={s.identityText}>
            <View style={s.nicknameRow}>
              <Text style={s.nickname} numberOfLines={1}>{displayNickname}</Text>
              {!isOwnProfile && online && (
                <View style={s.onlinePill}>
                  <View style={s.onlineDot} />
                  <Text style={s.onlinePillText}>{t('EN LÍNEA')}</Text>
                </View>
              )}
            </View>
            <Text style={s.identitySub}>
              {daysRaced != null ? (daysRaced === 1 ? t('{n} día corrido', { n: daysRaced }) : t('{n} días corridos', { n: daysRaced })) : '···'}
              {stats?.bestMs ? t(' · mejor {time}', { time: fmtTime(stats.bestMs) }) : ''}
            </Text>
          </View>
        </View>

        {/* Dos pestañas (JC, 2026-09-16: "muchísima info en el perfil") en
            vez de un único scroll largo — ver PROFILE_TABS arriba. */}
        <View style={s.tabsRow}>
          {PROFILE_TABS.map((pt) => (
            <Pressable
              key={pt.id}
              style={[s.tab, tab === pt.id && s.tabActive]}
              onPress={() => setTab(pt.id)}
            >
              <Text style={[s.tabText, tab === pt.id && s.tabTextActive]}>{t(pt.label)}</Text>
            </Pressable>
          ))}
        </View>

        {tab === 'piloto' && (
          <>
            {/* El avatar arriba, a media pantalla — es lo primero que pidió
                JC (2026-09-15: "vea en media pantalla de arriba su avatar")
                y lo que hace de esta pantalla TU perfil. Antes quedaba por
                debajo de botones, idioma y pruebas, casi fuera de la vista.
                El cambio de avatar vive encima del propio muñeco: es el
                sitio donde se entiende sin explicación. */}
            <View style={s.avatarStage}>
              <PodiumStage width={STAGE_W} height={AVATAR_HEIGHT} accent={RARITY_COLOR[avatar.rarity] || RD.cream} place={podiumPlace} />
              {/* El muñeco no se monta hasta saber su escalón (o tras
                  STAGE_WAIT_MS): si no, aparecería en el del 1 y luego
                  "bajaría" a su sitio. */}
              {stageReady && (
                <AvatarViewer key={avatar.key} source={avatar.glb} cacheKey={avatar.key} framing={podiumFraming(podiumPlace)} />
              )}
              <View pointerEvents="none" style={s.placeChip}>
                <Text style={[s.placeChipText, podiumPlace === 1 && s.placeChipGold]}>
                  {monthRank === undefined ? '···'
                    : monthRank ? t('{pos} DEL MES', { pos: ord(monthRank) })
                    : t('SIN CORRER ESTE MES')}
                </Text>
              </View>
              {isOwnProfile && (
                <Pressable style={({ pressed }) => [s.stageChip, pressed && s.stageChipPressed]} onPress={onOpenAvatarPicker} hitSlop={8}>
                  <Text style={s.stageChipText}>{t('CAMBIAR AVATAR')}</Text>
                </Pressable>
              )}
            </View>

            {/* Vitrina (JC, 2026-10-14): lo que se presume, justo bajo el
                podio — es lo primero que miras en el perfil de otro. */}
            <View style={s.trophies}>
              <Trophy icon="crown" color={RD.gold1st} value={wins} label={t('VICTORIAS')} />
              <Trophy icon="podium" color={RD.silver2nd} value={monthPodiums} label={t('PODIOS · MES')} />
              <Trophy icon="sectors" color={PURPLE} value={purpleTotal} label={t('MORADOS')} />
              <Trophy icon="flame" color={RD.danger} value={bestStreak} label={t('MEJOR RACHA')} />
            </View>

            {/* Garaje, Tienda y Carrera actúan sobre TU cuenta — solo en tu
                propio perfil (JC, 2026-09-15: perfiles públicos). */}
            {isOwnProfile && (
              <View style={s.tiles}>
                <ActionTile
                  label={t('GARAJE')}
                  color={RD.trackBlue}
                  value={piecesOwned != null ? `${piecesOwned}/${TOTAL_COLLECTIBLES}` : '—'}
                  caption={t('PIEZAS')}
                  onPress={onOpenGarage}
                />
                <ActionTile
                  label={t('TIENDA')}
                  color={RD.gold1st}
                  value={wallet?.balance ?? '—'}
                  caption={t('MONEDAS')}
                  coin
                  onPress={onOpenTienda}
                />
                <ActionTile
                  label={t('CARRERA')}
                  color={RD.successGreen}
                  value={career != null ? `${career}/${LEVEL_COUNT}` : '—'}
                  caption={t('NIVELES')}
                  onPress={onOpenCareer}
                />
              </View>
            )}

            {/* RETAR (JC, 2026-09-17: duelos 1vs1) — perfil de OTRO jugador
                solamente. La apuesta se cobra a los dos al ACEPTAR, no al
                enviar el reto — aquí no se mueve nada todavía, solo se manda. */}
            {!isOwnProfile && duelWithThem && (
              <View style={s.duelCard}>
                <Text style={s.duelCardTitle}>{t('1 VS 1 EN CURSO')}</Text>
                <DuelStatusRow
                  d={duelWithThem}
                  onOpen={onOpenDuel}
                  onCancel={handleCancelDuel}
                  cancelling={cancelBusy === duelWithThem.id}
                />
                <Text style={s.duelMsgHint}>
                  {t('Todos tus 1 vs 1 están en la pestaña 1 VS 1 de Inicio. Hasta que este se resuelva no podéis abrir otro.')}
                </Text>
              </View>
            )}

            {!isOwnProfile && !duelWithThem && (
              <View style={s.duelCard}>
                <Text style={s.duelCardTitle}>{t('RETAR A UN 1 VS 1')}</Text>
                <View style={s.duelWagerRow}>
                  <CoinIcon size={16} />
                  <TextInput
                    style={s.duelWagerInput}
                    value={wagerInput}
                    onChangeText={(v) => setWagerInput(v.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    maxLength={5}
                  />
                  {wallet?.balance != null && (
                    <Text style={s.duelWagerHint}>{t('tienes {n}', { n: wallet.balance })}</Text>
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
                  <Text style={s.retarBtnText}>{challengeBusy ? t('ENVIANDO…') : t('RETAR')}</Text>
                </Pressable>
              </View>
            )}

            {/* Ajustes al final: el idioma se toca una vez y no debe
                competir con el avatar ni con los accesos. */}
            {isOwnProfile && (
              <View style={s.settings}>
                <Text style={s.sectionLabel}>{t('AJUSTES')}</Text>
                <LangSwitch />
              </View>
            )}

            {/* Banco de pruebas de circuitos cerrados — testers (ver
                isLoopTester en features.js), también en builds normales. */}
            {isOwnProfile && !!onOpenLoopTest && (
              <Pressable style={s.devBtn} onPress={onOpenLoopTest}>
                <Text style={s.devBtnText}>{t('PROBAR CIRCUITO CERRADO')}</Text>
              </Pressable>
            )}

            {/* Botones de prueba SOLO en dev — desaparecen solos en cualquier
                build de release. */}
            {isOwnProfile && __DEV__ && !!onOpenPilotTest && (
              <Pressable style={s.devBtn} onPress={onOpenPilotTest}>
                <Text style={s.devBtnText}>[DEV] PILOTO 3D</Text>
              </Pressable>
            )}
            {isOwnProfile && __DEV__ && !!onOpenAvatarTest && (
              <Pressable style={s.devBtn} onPress={onOpenAvatarTest}>
                <Text style={s.devBtnText}>[DEV] AVATARES</Text>
              </Pressable>
            )}
          </>
        )}

        {tab === 'stats' && (
          <>
            {/* Fila de titulares: antes vivía en PILOTO, pero competía con
                el avatar por protagonismo — JC, 2026-09-16: "quitaría
                racha y hoy de ahí". Aquí es lo primero que se lee, que es
                donde encaja: STATS es la pantalla de leer números. */}
            <View style={s.heroPanel}>
              <View style={s.heroCell}>
                {/* viewStreak (JC, 2026-09-16: "no se ve la racha en los
                    perfiles de la gente") llega como número plano desde las
                    filas de ranking (`r.streak = users.current_streak`,
                    ver api.js) — no como {current, longest}, que es la
                    forma de myStreak (la tuya, cargada aparte en Inicio).
                    Pedirle `.current` a un número da undefined siempre. */}
                <Text style={s.heroValue}>{(isOwnProfile ? myStreak?.current : viewStreak) ?? 0}</Text>
                <Text style={s.heroLabel}>{t('RACHA')}</Text>
                {/* La racha MÁXIMA solo la tienes tú misma cargada (viene
                    por prop desde Inicio) — el ranking no manda
                    longest_streak de otros jugadores, así que en un perfil
                    ajeno se omite en vez de enseñar un "máx. 0" que sería
                    mentira. */}
                {isOwnProfile && <Text style={s.heroHint}>{t('máx. {n}', { n: myStreak?.longest ?? 0 })}</Text>}
              </View>
              <View style={s.heroDivider} />
              <View style={s.heroCell}>
                {/* El dorado SOLO si de verdad vas primero. Antes lo
                    llevaban todos los números de la pantalla, así que no
                    distinguía nada; apareciendo solo aquí, vuelve a
                    significar "podio". */}
                {/* Sin correr hoy: antes un "—" que no decía nada. Ahora lo
                    dice, y en tu perfil te lleva a Inicio a correr (no
                    arranca la carrera desde aquí: Inicio es quien gestiona
                    intentos y avisos previos). */}
                {todayRank === null ? (
                  <>
                    <Text style={s.heroValueNone}>{t('SIN CORRER')}</Text>
                    <Text style={s.heroLabel}>{t('HOY')}</Text>
                    {isOwnProfile ? (
                      <Pressable onPress={onBack} hitSlop={10}>
                        <Text style={s.heroLink}>{t('IR A JUGAR ›')}</Text>
                      </Pressable>
                    ) : <Text style={s.heroHint}> </Text>}
                  </>
                ) : (
                  <>
                    <Text style={[s.heroValue, todayRank === 1 && s.heroValueGold]}>
                      {todayRank ? `#${todayRank}` : '···'}
                    </Text>
                    <Text style={s.heroLabel}>{t('HOY')}</Text>
                    <Text style={s.heroHint}>
                      {purple ? t('{n}/3 morados', { n: purple.mine }) : ' '}
                    </Text>
                  </>
                )}
              </View>
            </View>

            <StatTrend points={trend || []} own={isOwnProfile} />

            <Text style={s.sectionLabel}>{t('EN PISTA')}</Text>
            <View style={s.statPanel}>
              <StatRow label={t('VUELTAS')} value={stats ? stats.laps : '—'} dim={!stats} />
              <StatRow label={t('AL VOLANTE')} value={stats ? fmtDuration(stats.raceMs) : '—'} dim={!stats} />
              <StatRow
                label={t('CHOQUES')}
                value={stats ? stats.crashes : '—'}
                hint={crashRate ? t('{n}/vuelta', { n: crashRate }) : null}
                dim={!stats}
                last
              />
            </View>

            <Text style={s.sectionLabel}>{t('COLECCIÓN')}</Text>
            <View style={s.statPanel}>
              <StatRow label={t('NIVELES')} value={career != null ? `${career}/${LEVEL_COUNT}` : '—'} />
              <StatRow
                label={t('PIEZAS')}
                value={piecesOwned != null ? `${piecesOwned}/${TOTAL_COLLECTIBLES}` : '—'}
                last={!isOwnProfile}
              />
              {/* Las monedas se quedan fuera del perfil público (JC,
                  2026-09-15: "público su avatar y sus stats" — el saldo no
                  es una stat de pista/colección, es dinero). */}
              {isOwnProfile && (
                <StatRow
                  label={lifetimeCoins != null ? t('MONEDAS GANADAS') : t('MONEDAS')}
                  value={lifetimeCoins != null ? lifetimeCoins : (wallet?.balance ?? 0)}
                  hint={lifetimeCoins != null ? t('{n} ahora', { n: wallet?.balance ?? 0 }) : null}
                  last
                />
              )}
            </View>

            {stats === null && (
              <Text style={s.statsMissing}>
                {t('Los contadores de pista se activan al correr supabase/stats.sql.')}
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
  langRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2, backgroundColor: RD_SURFACE,
    paddingVertical: 10, paddingHorizontal: 14,
  },
  langLabel: { color: RD.textSecondary, fontSize: 11, fontFamily: RD_FONT.mono, letterSpacing: 1.2 },
  langOpts: { flexDirection: 'row', gap: 6 },
  langOpt: { borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2, paddingHorizontal: 12, paddingVertical: 6 },
  langOptActive: { borderColor: RD.cream },
  langOptText: { color: RD.textTertiary, fontSize: 12, fontFamily: RD_FONT.mono },
  langOptTextActive: { color: RD.textPrimary, fontFamily: RD_FONT.monoBold },
  content: { paddingHorizontal: 18, paddingTop: 50, paddingBottom: 40, gap: 14 },
  backLink: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono, marginBottom: 4 },

  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 2 },
  identityText: { flex: 1, minWidth: 0, gap: 3 },
  nicknameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  nickname: {
    color: RD.textPrimary, fontSize: 38, lineHeight: 40, fontFamily: RD_FONT.displayBlack,
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

  // Pestañas como subrayado, no como dos botones con borde: así no compiten
  // con las tarjetas de debajo y se leen como navegación, no como acciones.
  tabsRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: RD.panelBorder },
  tab: {
    flex: 1, paddingVertical: 10, alignItems: 'center', justifyContent: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1,
  },
  tabActive: { borderBottomColor: RD.brand },
  tabText: { color: RD.textTertiary, fontSize: 12, fontFamily: RD_FONT.monoBold, letterSpacing: 1.2 },
  tabTextActive: { color: RD.textPrimary },

  // Racha y puesto de hoy en UN panel partido por una línea: son la misma
  // idea (cómo vas) y dos cajas sueltas las separaban.
  heroPanel: {
    flexDirection: 'row', borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    backgroundColor: RD_SURFACE,
  },
  heroCell: { flex: 1, paddingVertical: 18, alignItems: 'center', gap: 2 },
  heroDivider: { width: 1, backgroundColor: RD.panelBorder, marginVertical: 14 },
  // Neutro por defecto. El color se reserva para cuando dice algo (ver
  // heroValueGold); un número grande ya destaca por tamaño, no necesita
  // además un acento para que lo mires.
  heroValue: {
    color: RD.textPrimary, fontSize: 44, fontFamily: RD_FONT.displayBlack,
    fontVariant: ['tabular-nums'], lineHeight: 46,
  },
  heroValueGold: { color: RD.gold1st },
  // 'SIN CORRER' ocupa el alto de un número grande para que las dos mitades
  // del panel no queden descuadradas.
  heroValueNone: {
    color: RD.textDisabled, fontSize: 24, lineHeight: 46, fontFamily: RD_FONT.displayBlack,
  },
  heroLink: { color: RD.brand, fontSize: 10, fontFamily: RD_FONT.monoBold, letterSpacing: 0.6 },
  heroLabel: { color: RD.textSecondary, fontSize: 10, fontFamily: RD_FONT.monoBold, letterSpacing: 1.2 },
  heroHint: { color: RD.textTertiary, fontSize: 10, fontFamily: RD_FONT.mono },

  sectionLabel: {
    color: RD.textTertiary, fontSize: 10, fontFamily: RD_FONT.mono,
    letterSpacing: 1.4, marginTop: 6, marginBottom: -6,
  },
  statPanel: {
    borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    backgroundColor: RD_SURFACE, paddingHorizontal: 14,
  },
  statRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: RD.gridLine,
  },
  statRowLast: { borderBottomWidth: 0 },
  statRowLabel: { color: RD.textSecondary, fontSize: 11, fontFamily: RD_FONT.mono, letterSpacing: 0.8 },
  statRowRight: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  statRowHint: { color: RD.textDisabled, fontSize: 10, fontFamily: RD_FONT.mono },
  statRowValue: {
    color: RD.textPrimary, fontSize: 22, fontFamily: RD_FONT.displayBlack,
    fontVariant: ['tabular-nums'],
  },
  statValueDim: { color: RD.textDisabled },
  statsMissing: {
    color: RD.textDisabled, fontSize: 10, fontFamily: RD_FONT.mono,
    textAlign: 'center', marginTop: -4,
  },

  tiles: { flexDirection: 'row', gap: 8 },
  tile: {
    flex: 1, borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    backgroundColor: RD_SURFACE, paddingHorizontal: 11, paddingTop: 10, paddingBottom: 11,
    gap: 4,
  },
  tilePressed: { backgroundColor: '#1a1a1d', borderColor: '#3a3a3d' },
  tileHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileLabel: { fontSize: 12, fontFamily: RD_FONT.monoBold, letterSpacing: 0.6 },
  tileArrow: { color: RD.textDisabled, fontSize: 16, fontFamily: RD_FONT.mono, lineHeight: 18 },
  tileValueRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  tileValue: {
    color: RD.textPrimary, fontSize: 26, fontFamily: RD_FONT.displayBlack,
    fontVariant: ['tabular-nums'], lineHeight: 28,
  },
  tileCaption: { color: RD.textTertiary, fontSize: 9, fontFamily: RD_FONT.mono, letterSpacing: 0.8 },

  settings: { gap: 8, marginTop: 4 },

  // Puesto del mes, arriba a la izquierda del escenario (CAMBIAR AVATAR va a
  // la derecha).
  placeChip: {
    position: 'absolute', left: 14, top: 14,
    borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    backgroundColor: 'rgba(11,11,12,0.82)',
    paddingHorizontal: 10, paddingVertical: 8,
  },
  placeChipText: { color: RD.textSecondary, fontSize: 11, fontFamily: RD_FONT.monoBold, letterSpacing: 0.8 },
  placeChipGold: { color: RD.gold1st },

  trophies: {
    flexDirection: 'row', borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    backgroundColor: RD_SURFACE, paddingVertical: 12,
  },
  trophy: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 2 },
  trophyValue: {
    color: RD.textPrimary, fontSize: 24, lineHeight: 26, fontFamily: RD_FONT.displayBlack,
    fontVariant: ['tabular-nums'], marginTop: 2,
  },
  trophyValueDim: { color: RD.textDisabled },
  trophyLabel: {
    color: RD.textTertiary, fontSize: 9, fontFamily: RD_FONT.mono, letterSpacing: 0.6,
    textAlign: 'center',
  },

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

  // El escenario del piloto: a sangre (de borde a borde) y pegado a la
  // línea de las pestañas, con el fondo un paso más claro que la pantalla
  // para que se lea como un escenario propio (JC, 2026-09-15: "se ve
  // apagado" con negro sobre negro).
  avatarStage: {
    height: AVATAR_HEIGHT,
    marginHorizontal: -18,
    marginTop: -14, // anula el `gap` del ScrollView: sin hueco bajo las pestañas
    backgroundColor: RD_SURFACE,
    borderBottomWidth: 1, borderColor: RD.panelBorder,
  },
  stageChip: {
    position: 'absolute', right: 14, top: 14, // arriba: abajo están los escalones
    borderWidth: 1, borderColor: RD.youMagenta, borderRadius: 2,
    backgroundColor: 'rgba(11,11,12,0.82)',
    paddingHorizontal: 12, paddingVertical: 8,
  },
  stageChipPressed: { backgroundColor: RD.youMagentaBg },
  stageChipText: { color: RD.youMagenta, fontSize: 11, fontFamily: RD_FONT.monoBold, letterSpacing: 0.8 },
});

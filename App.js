// ============================================================================
//  Apexly — App.  Dirección de arte "A refinada" (oscuro moderno).
//
//  Router de pantallas: carga sesión anónima -> onboarding (nickname la 1.ª vez)
//  -> Inicio (circuito del día + ranking del grupo) -> Juego -> Resultado.
//  El juego (física/cámara/colisión/piezas) vive en src/Game.js sin tocar.
// ============================================================================

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Dimensions, Linking, Modal, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { useFonts } from 'expo-font';
import {
  BarlowCondensed_600SemiBold, BarlowCondensed_700Bold, BarlowCondensed_800ExtraBold,
} from '@expo-google-fonts/barlow-condensed';
import {
  IBMPlexMono_500Medium, IBMPlexMono_600SemiBold, IBMPlexMono_700Bold,
} from '@expo-google-fonts/ibm-plex-mono';

import Game from './src/Game';
import { todayKey, dayOffset } from './src/daily';
import { dailyCircuit } from './src/generator';
import { dailyWeather, NEUTRAL } from './src/weather';

import { fmtTime, fmtSecs, fmtCountdown } from './src/format';
import { C, MONO, RD, RD_FONT, SECTOR_RESULT_COLORS } from './src/theme';
import DangerStripe from './src/DangerStripe';
import Identicon from './src/Identicon';
import MiniRanking from './src/MiniRanking';
import MiniTrackMap from './src/MiniTrackMap';
import Garage from './src/Garage';
import Tienda from './src/Tienda';
import Profile from './src/Profile';
import CareerMode from './src/CareerMode';
import { levelSpec, gapMsFor, weatherForLevel, CAREER_AD_BATCH } from './src/career';
import { GroupHome, GrandPrixStandings } from './src/GrandPrix';
import { gpCircuitSpec, gpWeather, GP_AD_BATCH } from './src/gpData';
import ShineBadge from './src/ShineBadge';
import Tour, { tourRef, isTourDone } from './src/Tour';
import { noteRaceFinished } from './src/rate';
import { CAR_DEFAULTS } from './src/car';

const TRACKMAP_W = Dimensions.get('window').width - 18 * 2 - 14 * 2; // screenContent + panel
import {
  ensureSession, ensureDailyTrack, getLocalNickname, saveNickname, submitTime,
  listMyGroups, createGroup, joinGroup, bumpStreak, getMyStreak, notifyOvertakes,
  getLeaderboard, getGlobalBoard, getSectorBests, submitSectorSplits,
  getMyLoadout, getWallet, claimDailyReward, getRecentRewards, claimShareReward, claimCareerLevel,
  submitGpResult, notifyGpOvertake, recordLap,
} from './src/api';
import { registerPushToken } from './src/push';
import { loadGhost, saveGhostIfBest } from './src/ghost';
import { loadAttempts, consumeAttempt, grantBatch, attemptsLeft as calcLeft, AD_BATCH, FREE_ATTEMPTS } from './src/attempts';
import { PUSH_ENABLED, intentosTxt } from './src/features';
import { CONFIG } from './src/config';
import { prepareConsent, showRewarded, isPrivacyOptionsRequired, showPrivacyOptions, getLastAdError, wasConsentDenied } from './src/ads';
// SIN import de './src/iap' a propósito: el IAP "ilimitado para siempre"
// sigue desactivado en iOS por el bug de openiap/StoreKit (ver el commit de
// revert). ./src/iap.js ni siquiera existe en esta rama — si esta línea
// volviera, el bundle fallaría en el arranque.
import {
  logOnboardingComplete, logRaceStart, logRaceFinish, logPaywallView,
  logAdWatched, logGarageOpen,
} from './src/analytics';
import ShareCard from './src/ShareCard';
import { shareCardImage } from './src/share';

const PAD = 50; // hueco superior (barra de estado oculta)
const RECAP_SEEN_KEY = 'apexly_recap_seen_day'; // último día (todayKey) en que ya se mostró el pop-up de premios

// Fecha corta "DD·MM" para tarjetas.
function dayShort() {
  const [, m, d] = todayKey().split('-');
  return `${d}·${m}`;
}

// Cuenta atrás hasta el circuito de mañana. El cambio es a medianoche LOCAL
// del dispositivo (todayKey() usa fecha local), así que no hay zonas horarias
// que resolver: cada uno cuenta hasta su propia medianoche.
function msUntilMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return next.getTime() - now.getTime();
}
function useMidnightCountdown() {
  const [label, setLabel] = useState(() => fmtCountdown(msUntilMidnight()));
  useEffect(() => {
    const id = setInterval(() => setLabel(fmtCountdown(msUntilMidnight())), 30000);
    return () => clearInterval(id);
  }, []);
  return label;
}

export default function App() {
  const [fontsLoaded] = useFonts({
    BarlowCondensed_600SemiBold, BarlowCondensed_700Bold, BarlowCondensed_800ExtraBold,
    IBMPlexMono_500Medium, IBMPlexMono_600SemiBold, IBMPlexMono_700Bold,
  });
  const [screen, setScreen] = useState('loading'); // loading|error|onboarding|home|playing|results
  const [nickname, setNickname] = useState(null);
  const [result, setResult] = useState(null); // { ms, isBest, submitting, error }
  const [refreshKey, setRefreshKey] = useState(0);
  const [retry, setRetry] = useState(0);
  const [myStreak, setMyStreak] = useState(null);
  const [wallet, setWallet] = useState({ balance: 0, pendingPacks: 0 }); // monedas + sobres pendientes
  const [recap, setRecap] = useState(null); // { streak, ranking } premios de ayer, o null si no toca mostrar
  const [homeStanding, setHomeStanding] = useState(null); // { rank, total, above } resumen de rivalidad para Diario
  const [challenge, setChallenge] = useState(null); // { ms } reto recibido por deep link, si es de hoy
  const [tab, setTab] = useState('diario'); // pestaña activa de Inicio: diario | amigos | carrera
  // Recorrido guiado de la primera apertura. null = aún no sabemos si toca
  // (lo dice AsyncStorage); false = no toca o ya terminó; true = corriendo.
  const [tourOn, setTourOn] = useState(null);
  const [careerLevel, setCareerLevel] = useState(null); // nivel de Modo Carrera en juego, o null
  const [careerResult, setCareerResult] = useState(null); // { level, ms, passed, gapMs } del último intento
  const [nomoreReturn, setNomoreReturn] = useState('playing'); // a qué screen volver tras ver el anuncio en 'nomore'
  const [ghost, setGhost] = useState(null); // { ms, trace } de tu mejor vuelta de hoy
  const [sectorBests, setSectorBests] = useState(null); // { [sector]: ms } mejor del mundo hoy
  const [loadout, setLoadout] = useState(CAR_DEFAULTS); // personalización del coche (garaje)

  const [att, setAtt] = useState({ used: 0, bonus: 0 }); // intentos del día (circuito diario)
  const [careerAtt, setCareerAtt] = useState({ used: 0, bonus: 0 }); // intentos del nivel de Carrera en juego — cupo PROPIO, no comparte con el diario
  const [gpGroup, setGpGroup] = useState(null); // { id, name } grupo cuyo Grand Prix se está viendo/jugando
  const [gpActive, setGpActive] = useState(null); // fila grand_prix cargada (para jugar/ver clasificación)
  const [gpRoundIndex, setGpRoundIndex] = useState(null); // ronda en juego dentro del GP
  const [gpAtt, setGpAtt] = useState({ used: 0, bonus: 0 }); // intentos de ESTA ronda del GP — cupo propio, igual que Carrera
  const [gpResult, setGpResult] = useState(null); // { dayIndex, ms, isPractice, isBest, error } del último intento
  const [unlocking, setUnlocking] = useState(false);     // viendo el anuncio
  const [adMsg, setAdMsg] = useState('');                // aviso si el anuncio no sale
  const [privacyOptional, setPrivacyOptional] = useState(false); // ¿mostrar "Privacidad de anuncios"?
  // IAP "ilimitado para siempre": QUITADO en esta build de iOS (bug real de
  // openiap con StoreKit, ver commit de la rama). `unlimited` se queda como
  // estado (siempre false, nunca se activa) para no tocar cada sitio de la
  // app que ya lo usa como "unlimited ? X : Y" — vuelve cuando se resuelva.
  const [unlimited] = useState(false);
  const left = calcLeft(att);
  const total = FREE_ATTEMPTS + (att?.bonus || 0);
  const careerLeft = calcLeft(careerAtt);
  const gpLeft = calcLeft(gpAtt);
  const daily = useMemo(() => dailyCircuit(todayKey()), []);
  // Igual que `daily`: memoizado por nivel, NO recalculado en cada render.
  // Sin esto, `levelSpec()` devolvía un objeto `track` nuevo en cada
  // re-render (p. ej. el que dispara `startAttempt` al consumir el intento),
  // y el efecto de física de Game.js (dependiente de `[track]` por identidad)
  // se reiniciaba a mitad de carrera -> el primer toque gastaba el intento y
  // la vuelta se cortaba antes de arrancar de verdad.
  const careerSpec = useMemo(() => (careerLevel != null ? levelSpec(careerLevel) : null), [careerLevel]);
  const careerWeather = useMemo(() => (careerLevel != null ? weatherForLevel(careerLevel) : NEUTRAL), [careerLevel]);
  // Mismo motivo que careerSpec: memoizado por [gp, ronda], no recalculado en
  // cada render — si no, el mismo bug del intento que se corta a mitad.
  const gpSpec = useMemo(
    () => (gpActive && gpRoundIndex != null ? gpCircuitSpec(gpActive.id, gpRoundIndex, gpActive.circuit_count) : null),
    [gpActive?.id, gpRoundIndex],
  );
  const gpWeatherVal = useMemo(
    () => (gpActive && gpRoundIndex != null ? gpWeather(gpActive.id, gpRoundIndex) : NEUTRAL),
    [gpActive?.id, gpRoundIndex],
  );
  const midnightLabel = useMidnightCountdown();
  const weather = useMemo(() => dailyWeather(todayKey()), []);

  // Cargar el fantasma (tu mejor vuelta) del día + el mejor tiempo de cada
  // sector hoy entre todos (para el morado estilo F1 en el HUD de juego).
  useEffect(() => {
    loadGhost(todayKey()).then(setGhost).catch(() => {});
    getSectorBests(todayKey()).then(setSectorBests).catch(() => {});
  }, []);

  // Cargar los intentos del día + preparar el consentimiento de anuncios.
  //
  // `prepareConsent()` NO enseña nada: solo consulta el estado (es la llamada
  // que Google pide hacer en cada arranque). El formulario en sí sale la
  // primera vez que se pide un anuncio — antes salía aquí, encima de la
  // pantalla de bienvenida, y el usuario nuevo se encontraba la app bloqueada
  // detrás de un muro legal antes de saber siquiera qué era Apexly.
  useEffect(() => {
    loadAttempts(todayKey()).then(setAtt).catch(() => {});
    prepareConsent().then(() => isPrivacyOptionsRequired()).then(setPrivacyOptional).catch(() => {});
  }, []);

  // Intentos de Modo Carrera: cupo propio POR NIVEL (misma `attempts.js`,
  // sembrada con 'career-N' en vez de la fecha) — no caduca al día siguiente,
  // porque un nivel no es un reto diario, así que no hace falta resetearlo.
  useEffect(() => {
    if (careerLevel == null) return;
    loadAttempts('career-' + careerLevel).then(setCareerAtt).catch(() => {});
  }, [careerLevel]);

  // Intentos del Grand Prix: cupo propio POR RONDA ('gp-<id>-<ronda>'), mismo
  // patrón que Carrera. Los 2 primeros intentos son práctica (no se envían),
  // desde el 3º clasifica — ver handleGpFinish.
  useEffect(() => {
    if (gpActive == null || gpRoundIndex == null) return;
    loadAttempts('gp-' + gpActive.id + '-' + gpRoundIndex).then(setGpAtt).catch(() => {});
  }, [gpActive?.id, gpRoundIndex]);

  // Consume un intento al empezar una vuelta (con ilimitado, no hace falta llevar la cuenta).
  function startAttempt() {
    logRaceStart();
    // Refresca el mejor mundial de sector justo antes de correr: si solo se
    // cargó una vez al abrir la app, el morado no reflejaba tiempos que otros
    // jugadores hubieran puesto mientras la app seguía abierta en segundo plano.
    getSectorBests(todayKey()).then(setSectorBests).catch(() => {});
    if (unlimited) return;
    consumeAttempt(todayKey()).then(setAtt).catch(() => {});
  }

  // Igual que startAttempt, pero contra el cupo PROPIO del nivel de Carrera
  // en juego — no toca ni consulta los intentos del circuito diario.
  function startCareerAttempt() {
    logRaceStart();
    if (unlimited) return;
    consumeAttempt('career-' + careerLevel).then(setCareerAtt).catch(() => {});
  }

  // Ver anuncio → concede un lote de intentos en el cupo indicado por `day`
  // (fecha de hoy para el diario, 'career-N' para un nivel) y lo aplica con
  // `setter`. Un único flujo de anuncio para los dos modos; `amount` por
  // defecto es AD_BATCH (grantBatch ya lo asume si no se pasa nada).
  async function watchAd(day, setter, amount) {
    if (unlocking) return false;
    setUnlocking(true);
    setAdMsg('');
    try {
      const ok = await showRewarded();
      // El formulario de consentimiento puede haber salido en este mismo
      // toque (es el primer anuncio de la instalación), así que a partir de
      // aquí ya se sabe si toca ofrecer el enlace de privacidad.
      isPrivacyOptionsRequired().then(setPrivacyOptional).catch(() => {});
      if (!ok) {
        if (wasConsentDenied()) {
          // Ha dicho que no en el formulario. Es decisión suya y es
          // reversible, así que se le dice dónde: el enlace acaba de
          // aparecer al pie de Inicio.
          setAdMsg(
            'Sin consentimiento para anuncios no podemos mostrarte ninguno. ' +
            'Puedes cambiarlo en «Privacidad de anuncios», al final de Inicio.'
          );
          return false;
        }
        // Sin relleno de AdMob, sin red, o el usuario cerró el vídeo antes de
        // ganarse la recompensa. Sin aviso, el botón volvía a su sitio sin
        // explicar nada y parecía que la app se había quedado colgada.
        // El motivo técnico ("no-fill", etc.) solo se enseña en modo
        // diagnóstico: al jugador no le dice nada y ensucia el aviso.
        const why = CONFIG.DIAG ? getLastAdError() : '';
        setAdMsg(
          'Ahora mismo no hay ningún anuncio disponible. Prueba de nuevo en unos minutos.' +
          (why ? `\n(${why})` : '')
        );
        return false;
      }
      const a = await grantBatch(day, amount);
      setter(a);
      logAdWatched();
      return true;
    } catch (_) {
      setAdMsg('No se ha podido cargar el anuncio. Prueba de nuevo en unos minutos.');
      return false;
    } finally {
      setUnlocking(false);
    }
  }
  const watchAdForMore = () => watchAd(todayKey(), setAtt);
  const watchAdForCareerMore = () => watchAd('career-' + careerLevel, setCareerAtt, CAREER_AD_BATCH);

  // Intentar jugar: ilimitado o con intentos → a jugar; si no, ofrecer el anuncio/IAP.
  function tryPlay() {
    if (unlimited || left > 0) setScreen('playing');
    else { logPaywallView(); setNomoreReturn('playing'); setScreen('nomore'); }
  }

  // Modo Carrera: cupo de intentos PROPIO por nivel (no el del circuito
  // diario). Mismo patrón que tryPlay: se comprueba ANTES de entrar a la
  // pantalla del nivel, no al primer toque una vez dentro — si ya no quedan
  // intentos en ESE nivel, va directo al anuncio/IAP desde el listado.
  async function playCareerLevel(n) {
    setCareerLevel(n);
    if (unlimited) { setScreen('career-playing'); return; }
    const a = await loadAttempts('career-' + n);
    if (calcLeft(a) > 0) setScreen('career-playing');
    else { setNomoreReturn('career-playing'); setScreen('nomore'); }
  }

  async function handleCareerFinish(ms, trace, sectorSplits, impacts) {
    const n = careerLevel;
    const gapMs = gapMsFor(n, careerSpec.timeEstimate);
    const passed = ms <= gapMs;
    recordLap(ms, impacts); // cuenta para los contadores del Perfil
    if (passed) {
      try { await claimCareerLevel(n, Math.round(ms)); } catch (_) {}
    }
    setCareerResult({ level: n, ms, passed, gapMs });
    setScreen('home');
    // El otro buen momento: acabas de desbloquear el siguiente nivel. Si has
    // fallado el tiempo NO se pide — pedir valoración justo después de perder
    // es la forma más rápida de llevarte una estrella.
    noteRaceFinished(passed);
  }

  // Abrir la pantalla de un grupo concreto (desde Amigos): si ya tiene GP
  // activo se ve directamente, si no se ve el listado de miembros + arrancar.
  function openGroupHome(group) {
    setGpGroup(group);
    setGpActive(null);
    setGpRoundIndex(null);
    setScreen('group-home');
  }

  // A diferencia de startCareerAttempt/startAttempt, aquí NO se salta con
  // `unlimited`: en el GP `used` no es solo un contador de cupo, también
  // decide práctica-vs-clasifica (gpAtt.used < 3). Si un usuario ilimitado
  // se saltara esto, ese contador nunca avanzaría y NINGUNA vuelta suya
  // llegaría a clasificar de verdad. Se sigue registrando (barato, un
  // AsyncStorage local) aunque a él ya no le bloquee nada.
  function startGpAttempt() {
    logRaceStart();
    consumeAttempt('gp-' + gpActive.id + '-' + gpRoundIndex).then(setGpAtt).catch(() => {});
  }
  const watchAdForGpMore = () => watchAd('gp-' + gpActive.id + '-' + gpRoundIndex, setGpAtt, GP_AD_BATCH);

  // Entrar a jugar una ronda del GP: mismo patrón que playCareerLevel, se
  // comprueba el cupo ANTES de entrar (no al primer toque dentro). Igual que
  // arriba, SIEMPRE se recarga el cupo real de la ronda (aunque sea
  // ilimitado) — si no, un ilimitado que ya jugó otra ronda arrastraría un
  // `used` de esa ronda anterior y se saltaría sus 2 vueltas de práctica.
  // `unlimited` solo se usa para no bloquear el acceso, no para saltarse la
  // carga.
  async function playGpRound(gp, dayIndex) {
    setGpActive(gp);
    setGpRoundIndex(dayIndex);
    const a = await loadAttempts('gp-' + gp.id + '-' + dayIndex);
    setGpAtt(a);
    if (unlimited || calcLeft(a) > 0) setScreen('gp-playing');
    else { setNomoreReturn('gp-playing'); setScreen('nomore'); }
  }

  // Las 2 primeras vueltas de cada ronda son práctica (no se mandan al
  // servidor); desde la 3ª ('gpAtt.used' ya incluye el intento que se acaba
  // de gastar en startGpAttempt) cada vuelta clasifica y el servidor se
  // queda con tu mejor tiempo — igual que el resto de la app, mejor-de-N.
  async function handleGpFinish(ms, trace, sectorSplits, impacts) {
    const gp = gpActive;
    const dayIndex = gpRoundIndex;
    const isPractice = gpAtt.used < 3;
    // También las vueltas de práctica: has estado en pista y te has chocado
    // igual, aunque esa vuelta no clasifique.
    recordLap(ms, impacts);
    if (isPractice) {
      setGpResult({ dayIndex, ms, isPractice: true });
      setScreen('group-home');
      return;
    }
    try {
      const { isBest, prevMs } = await submitGpResult(gp.id, dayIndex, ms, sectorSplits);
      setGpResult({ dayIndex, ms, isPractice: false, isBest, sectorMs: sectorSplits });
      if (PUSH_ENABLED && isBest) notifyGpOvertake(gp.id, dayIndex, ms, prevMs);
    } catch (_) {
      setGpResult({ dayIndex, ms, isPractice: false, error: true });
    }
    setScreen('group-home');
  }

  // Racha propia (para Inicio): al tener nickname y tras cada partida.
  useEffect(() => {
    if (!nickname) return;
    getMyStreak().then(setMyStreak).catch(() => {});
  }, [nickname, refreshKey]);

  // Saldo de monedas (para Inicio): al tener nickname y tras cada partida/sobre.
  useEffect(() => {
    if (!nickname) return;
    getWallet().then(setWallet).catch(() => {});
  }, [nickname, refreshKey]);

  // Rivalidad de hoy (para el resumen de Diario — el ranking completo vive
  // en la pestaña Amigos, esto es solo el titular). Null si aún no has
  // jugado hoy (no hay puesto que mostrar). Misma llamada que ya usa
  // Results para su propio "standing", por eso la forma coincide.
  useEffect(() => {
    if (!nickname) return;
    let alive = true;
    getGlobalBoard()
      .then((b) => {
        if (!alive) return;
        if (!b.me) { setHomeStanding(null); return; }
        const rival = b.aboveRows?.[0];
        setHomeStanding({
          rank: b.me.rank,
          total: b.total,
          above: rival ? { nickname: rival.nickname, gapMs: b.me.bestMs - rival.bestMs } : null,
        });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [nickname, refreshKey]);

  // Pop-up de "premios de ayer": una vez por día local, la primera vez que
  // hay nickname (primera entrada del día). Si no hubo nada que cobrar
  // (racha rota, sin premio de ranking), no se muestra nada.
  useEffect(() => {
    if (!nickname) return;
    let alive = true;
    (async () => {
      const today = todayKey();
      const seen = await AsyncStorage.getItem(RECAP_SEEN_KEY).catch(() => null);
      if (seen === today) return;
      await AsyncStorage.setItem(RECAP_SEEN_KEY, today).catch(() => {});
      const since = dayOffset(today, -2);
      const rewards = await getRecentRewards(since).catch(() => null);
      if (!alive || !rewards) return;
      if (rewards.streak > 0 || rewards.ranking > 0) setRecap(rewards);
    })();
    return () => { alive = false; };
  }, [nickname]);

  // Reto recibido por deep link al compartir (circuitodiario://reto?ms=&day=).
  // Solo tiene sentido si `day` es HOY — el circuito de otro día ya no existe
  // en pantalla. Cubre apertura en frío (getInitialURL) y con la app abierta
  // (evento 'url').
  useEffect(() => {
    function applyUrl(url) {
      if (!url) return;
      try {
        // Parseo manual (sin URLSearchParams: no siempre está polyfilleado en
        // Hermes) — la query es simple, dos claves conocidas, de sobra.
        const q = url.split('?')[1] || '';
        const params = {};
        for (const pair of q.split('&')) {
          const [k, v] = pair.split('=');
          if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
        }
        const ms = parseInt(params.ms, 10);
        if (params.day === todayKey() && Number.isFinite(ms) && ms > 0) setChallenge({ ms });
      } catch (_) {}
    }
    Linking.getInitialURL().then(applyUrl).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => applyUrl(url));
    return () => sub.remove();
  }, []);


  // Loadout del coche (garaje): al tener nickname, y al volver del garaje.
  useEffect(() => {
    if (!nickname) return;
    getMyLoadout().then(setLoadout).catch(() => {});
  }, [nickname, refreshKey]);

  // Recorrido guiado: solo la primera vez que se llega a Inicio con nickname.
  // El guard de ref evita volver a consultarlo cada vez que se vuelve a Inicio
  // desde una partida (si no, al terminar el tour y luego correr una vuelta,
  // el efecto se dispararía otra vez antes de que AsyncStorage esté escrito).
  // `null` = todavía no sabemos si toca; hace falta distinguirlo de false para
  // que el permiso de notificaciones no se pida antes de tiempo (ver abajo).
  const tourChecked = useRef(false);
  useEffect(() => {
    if (tourChecked.current || !nickname || screen !== 'home') return;
    tourChecked.current = true;
    isTourDone().then((done) => setTourOn(!done));
  }, [nickname, screen]);

  // Registrar token de notificaciones una vez que hay nickname... pero NO
  // mientras corre el tour. Medido en dispositivo: el diálogo de permisos de
  // Android salta justo al entrar a Inicio, que es cuando arranca el tour, y
  // se pone por encima tapándolo. Además pedir el permiso antes de haber
  // explicado para qué sirve es la mejor forma de que te lo denieguen: ahora
  // se pide al terminar el recorrido, cuando ya sabe qué son las rachas y el
  // Grand Prix (que es de lo que avisan las notificaciones).
  useEffect(() => {
    if (PUSH_ENABLED && nickname && tourOn === false) registerPushToken().catch(() => {});
  }, [nickname, tourOn]);

  // Init: sesión anónima + ¿tenemos nickname?
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await ensureSession();
        ensureDailyTrack(daily.label).catch(() => {});
        const nick = await getLocalNickname();
        if (!alive) return;
        if (nick) { setNickname(nick); setScreen('home'); }
        else setScreen('onboarding');
      } catch (e) {
        if (alive) setScreen('error');
      }
    })();
    return () => { alive = false; };
  }, [retry]);

  async function onNicknameDone(nick) {
    try {
      const saved = await saveNickname(nick);
      setNickname(saved);
      logOnboardingComplete();
      setScreen('home');
    } catch (e) {
      // Nombre ya en uso: no dejar pasar, que el onboarding lo muestre y
      // pida otro (si no, el jugador se queda con una sesión sin fila en
      // `users`, y todo lo que dependa de ella fallará más tarde en
      // silencio: racha, coche, tiempos de sector...).
      if (e?.code === 'NICKNAME_TAKEN') throw e;
      // Cualquier otro fallo (típicamente de red): al menos deja jugar con
      // el nombre local.
      setNickname(nick.trim().slice(0, 16));
      logOnboardingComplete();
      setScreen('home');
    }
  }

  async function handleFinish(ms, trace, sectorSplits, impacts, sectorColors, sectorDeltas) {
    setResult({ ms, isBest: false, submitting: true, impacts, sectorColors, sectorDeltas });
    setScreen('results');
    // Contadores de por vida del Perfil (vueltas/choques/tiempo en pista).
    // Cuenta TODAS las vueltas, no solo las que mejoran: "cuánto has corrido"
    // no es lo mismo que "cuál es tu récord".
    recordLap(ms, impacts);
    // Guarda tu mejor vuelta (fantasma) en el móvil.
    saveGhostIfBest(todayKey(), ms, trace).then((g) => { if (g) setGhost(g); }).catch(() => {});
    // Splits de sector de ESTA vuelta (aunque no sea tu mejor tiempo general —
    // un sector suelto puede ser tu mejor aunque la vuelta entera no lo sea).
    // El servidor decide si mejora el mejor del mundo hoy; si acierta, se
    // reflejará en el próximo intento al recargar sectorBests.
    if (sectorSplits && sectorSplits.length) {
      submitSectorSplits(sectorSplits).then(() => getSectorBests(todayKey())).then(setSectorBests).catch(() => {});
    }
    try {
      const { isBest, prevMs } = await submitTime(ms);
      let streak = null;
      try { streak = await bumpStreak(); } catch (_) {}
      claimDailyReward().catch(() => {}); // monedas de racha si toca hoy (idempotente en servidor)
      setResult({ ms, isBest, submitting: false, streak, impacts, sectorColors, sectorDeltas });
      logRaceFinish({ ms, isBest });
      if (PUSH_ENABLED && isBest) notifyOvertakes(ms, prevMs); // fire-and-forget: avisa a quien adelantaste
      // Valoración: mejorar tu propia marca es el mejor momento del diario
      // para pedirla (ver src/rate.js). Va después de pintar el resultado,
      // para que el diálogo del sistema caiga sobre la pantalla de Resultado
      // y no sobre una pantalla a medias.
      noteRaceFinished(isBest);
    } catch (e) {
      setResult({ ms, isBest: false, submitting: false, error: true, impacts, sectorColors, sectorDeltas });
      noteRaceFinished(false); // cuenta el uso, pero sin pedir nada tras un error
    }
    setRefreshKey((k) => k + 1);
  }

  if (!fontsLoaded || screen === 'loading') {
    return (
      <View style={styles.centerScreen}>
        <StatusBar hidden />
        <ActivityIndicator color={C.hot} size="large" />
      </View>
    );
  }

  if (screen === 'error') {
    return (
      <View style={styles.centerScreen}>
        <StatusBar hidden />
        <Text style={styles.errTitle}>No hay conexión</Text>
        <Text style={styles.errSub}>No se pudo conectar con el servidor.</Text>
        <Pressable style={styles.primaryBtn} onPress={() => { setScreen('loading'); setRetry((r) => r + 1); }}>
          <Text style={styles.primaryBtnText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  if (screen === 'onboarding') return <Onboarding onDone={onNicknameDone} />;

  if (screen === 'group-home') {
    return (
      <GroupHome
        group={gpGroup}
        result={gpResult}
        onDismissResult={() => setGpResult(null)}
        onPlayRound={playGpRound}
        onViewStandings={(gp) => { setGpActive(gp); setScreen('gp-standings'); }}
        onBack={() => { setRefreshKey((k) => k + 1); setScreen('home'); }}
        onLeave={() => { setRefreshKey((k) => k + 1); setScreen('home'); }}
      />
    );
  }

  if (screen === 'gp-standings') {
    return (
      <GrandPrixStandings
        group={gpGroup}
        gp={gpActive}
        onBack={() => setScreen('group-home')}
      />
    );
  }

  if (screen === 'garage') {
    return (
      <Garage
        onBack={() => { setRefreshKey((k) => k + 1); setScreen('home'); }}
        onOpenTienda={() => setScreen('tienda')}
        nickname={nickname}
      />
    );
  }

  if (screen === 'tienda') {
    return (
      <Tienda
        onBack={() => { setRefreshKey((k) => k + 1); setScreen('home'); }}
      />
    );
  }

  if (screen === 'perfil') {
    return (
      <Profile
        nickname={nickname}
        myStreak={myStreak}
        wallet={wallet}
        onBack={() => setScreen('home')}
        onOpenGarage={() => { logGarageOpen(); setScreen('garage'); }}
        onOpenTienda={() => setScreen('tienda')}
      />
    );
  }

  if (screen === 'playing') {
    return (
      <Game
        track={daily.track}
        ghost={ghost?.trace}
        weather={weather}
        sectorBests={sectorBests}
        loadout={loadout}
        attemptsLeft={unlimited ? Infinity : left}
        onAttemptStart={startAttempt}
        onNeedMore={() => { logPaywallView(); setNomoreReturn('playing'); setScreen('nomore'); }}
        onFinish={handleFinish}
        onExit={() => setScreen('home')}
      />
    );
  }

  if (screen === 'career-playing') {
    return (
      <Game
        track={careerSpec.track}
        ghost={null}
        weather={careerWeather}
        sectorBests={null}
        loadout={loadout}
        attemptsLeft={unlimited ? Infinity : careerLeft}
        onAttemptStart={startCareerAttempt}
        onNeedMore={() => { setNomoreReturn('career-playing'); setScreen('nomore'); }}
        onFinish={handleCareerFinish}
        onExit={() => setScreen('home')}
      />
    );
  }

  if (screen === 'gp-playing') {
    return (
      <Game
        track={gpSpec.track}
        ghost={null}
        weather={gpWeatherVal}
        sectorBests={null}
        loadout={loadout}
        attemptsLeft={unlimited ? Infinity : gpLeft}
        onAttemptStart={startGpAttempt}
        onNeedMore={() => { setNomoreReturn('gp-playing'); setScreen('nomore'); }}
        onFinish={handleGpFinish}
        onExit={() => setScreen('group-home')}
      />
    );
  }

  if (screen === 'nomore') {
    const isCareer = nomoreReturn === 'career-playing';
    const isGp = nomoreReturn === 'gp-playing';
    return (
      <NoMoreAttempts
        title={isGp ? 'SIN INTENTOS EN ESTA RONDA' : isCareer ? 'SIN INTENTOS EN ESTE NIVEL' : 'SIN INTENTOS POR HOY'}
        adBatch={isGp ? GP_AD_BATCH : isCareer ? CAREER_AD_BATCH : AD_BATCH}
        unlocking={unlocking}
        adMsg={adMsg}
        onWatchAd={async () => {
          const ok = isGp ? await watchAdForGpMore() : isCareer ? await watchAdForCareerMore() : await watchAdForMore();
          if (ok) setScreen(nomoreReturn);
        }}
        onBack={() => { setAdMsg(''); setScreen(isGp ? 'group-home' : 'home'); }}
      />
    );
  }

  if (screen === 'results') {
    return (
      <Results
        result={result}
        label={daily.label}
        track={daily.track}
        weather={weather}
        nickname={nickname}
        attemptsLeft={unlimited ? Infinity : left}
        total={total}
        unlimited={unlimited}
        refreshKey={refreshKey}
        onRetry={tryPlay}
        onHome={() => setScreen('home')}
      />
    );
  }

  // home
  return (
    <AppShell
      tab={tab}
      setTab={setTab}
      nickname={nickname}
      wallet={wallet}
      onOpenProfile={() => setScreen('perfil')}
      tour={tourOn ? <Tour steps={TOUR_STEPS} onDone={() => setTourOn(false)} /> : null}
    >
      {tab === 'diario' && (
        <DiarioTab
          refreshKey={refreshKey}
          myStreak={myStreak}
          wallet={wallet}
          homeStanding={homeStanding}
          recap={recap}
          onCloseRecap={() => setRecap(null)}
          challenge={challenge}
          onCloseChallenge={() => setChallenge(null)}
          daily={daily}
          weather={weather}
          midnightLabel={midnightLabel}
          left={left}
          total={total}
          unlimited={unlimited}
          tryPlay={tryPlay}
          privacyOptional={privacyOptional}
        />
      )}
      {tab === 'amigos' && <AmigosTab refreshKey={refreshKey} onOpenGroup={openGroupHome} />}
      {tab === 'carrera' && (
        <CareerMode
          unlimited={unlimited}
          result={careerResult}
          onPlayLevel={playCareerLevel}
          onDismissResult={() => setCareerResult(null)}
        />
      )}
    </AppShell>
  );
}

// Camino de la racha semanal: 7 días, monedas por día (5/5/10/10/15/15/20 +
// sobre el día 7), marcando qué días ya están "conseguidos" (hoy hacia
// atrás) frente a los que faltan. Mismo cálculo de día-de-semana que
// grant_daily_reward en economy.sql: ((racha-1) % 7) + 1.
const STREAK_AMOUNTS = [5, 5, 10, 10, 15, 15, 20];

function StreakPath({ current }) {
  if (!current || current < 1) return null;
  const pos = ((current - 1) % 7) + 1;
  return (
    <View style={rd.streakPath}>
      <View style={rd.streakDotsRow}>
        {STREAK_AMOUNTS.map((_, i) => {
          const day = i + 1;
          const done = day <= pos;
          const isToday = day === pos;
          return (
            <Fragment key={day}>
              <View style={rd.streakDotCol}>
                <View style={[rd.streakDot, done && rd.streakDotDone, isToday && rd.streakDotToday]}>
                  <Text style={[rd.streakDotText, done && rd.streakDotTextDone]}>{day}</Text>
                </View>
              </View>
              {day < 7 && <View style={[rd.streakConnector, day < pos && rd.streakConnectorDone]} />}
            </Fragment>
          );
        })}
      </View>
      <View style={rd.streakLabelsRow}>
        {STREAK_AMOUNTS.map((amount, i) => {
          const day = i + 1;
          const done = day <= pos;
          const isLast = day === 7;
          return (
            <Fragment key={day}>
              <View style={[rd.streakLabelCol, isLast && rd.streakLabelColLast]}>
                <Text
                  style={[rd.streakAmount, isLast && rd.streakGiftText, done && (isLast ? rd.streakGiftDone : rd.streakAmountDone)]}
                  numberOfLines={1}
                >
                  {isLast ? 'SOBRE' : amount}
                </Text>
              </View>
              {day < 7 && <View style={rd.streakConnectorSpacer} />}
            </Fragment>
          );
        })}
      </View>
    </View>
  );
}

// Pasos del recorrido guiado (ver src/Tour.js). Los que llevan `target`
// resaltan un trozo real de la interfaz; el de la racha no puede, porque en
// la primera apertura el camino de la racha todavía no se pinta (hace falta
// racha >= 1) — así que enseña el MISMO componente con una racha de ejemplo.
// Compartir no está: vive en la pantalla de Resultado y no tiene sentido
// explicarlo antes de haber corrido una vuelta.
const TOUR_STEPS = [
  {
    title: 'Bienvenido a Apexly',
    body: 'Cada día se genera un circuito nuevo, y es el mismo para todo el mundo. Mismo trazado, mismo clima, mismas condiciones: gana quien mejor lo conduzca.\n\nTe enseño lo básico en medio minuto.',
  },
  {
    target: 'circuito',
    title: 'El circuito de hoy',
    body: 'Cambia cada 24 horas. Debajo del nombre tienes el tiempo de referencia de una vuelta limpia y el clima, que afecta al agarre y a la velocidad punta. El número de la esquina son los intentos que te quedan hoy.',
  },
  {
    target: 'cta',
    title: 'Tu vuelta',
    body: 'El coche acelera solo: tú únicamente giras, tocando el lado izquierdo o derecho de la pantalla. Cuanto más fuerte giras, más frena — trazar bien es ir rápido.\n\nTienes 3 intentos al día; cuando se acaben puedes ver un anuncio para conseguir más.',
  },
  {
    target: 'ranking',
    title: 'Ranking global',
    body: 'Tu mejor tiempo del día entra aquí solo. Compites contra todos los que han corrido exactamente el mismo circuito que tú, y al cerrar el día los primeros se llevan monedas.',
  },
  {
    title: 'La racha',
    demo: <StreakPath current={3} />,
    body: 'Corre al menos una vuelta cada día y la racha sube. Cada día paga más monedas — 5, 10, 15, 20 — y el séptimo cae un sobre con piezas para el coche.\n\nSi te saltas un día, vuelve a empezar de cero.',
  },
  {
    target: 'tab-amigos',
    title: 'Amigos y Grand Prix',
    body: 'Crea un grupo y pasa el código a tus amigos. Dentro de un grupo podéis arrancar un Grand Prix: 7 circuitos exclusivos vuestros, uno por día, con puntos de F1 (25-18-15…) y una clasificación general.',
  },
  {
    target: 'tab-carrera',
    title: 'Modo carrera',
    body: '30 niveles en solitario, de dificultad creciente. Cada uno te pide bajar de un tiempo objetivo para desbloquear el siguiente, y los últimos añaden viento y lluvia.',
  },
  {
    target: 'perfil',
    title: 'Perfil, garaje y tienda',
    body: 'Aquí ves tus estadísticas y entras al Garaje, para personalizar el coche, y a la Tienda, donde se gastan las monedas en sobres. Las piezas del coche salen de esos sobres.',
  },
];

// Pop-up "premios de ayer": una vez por día, al abrir la app por primera
// vez, resume lo que se cobró (racha + ranking) desde la última entrada.
function RecapModal({ rewards, onClose }) {
  const total = (rewards.streak || 0) + (rewards.ranking || 0);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={rd.recapBackdrop}>
        <View style={rd.recapCard}>
          <Text style={rd.recapTitle}>PREMIOS DE AYER</Text>
          <Text style={rd.recapTotal}>+{total}</Text>
          <View style={rd.recapRows}>
            {rewards.streak > 0 && (
              <View style={rd.recapRow}>
                <Text style={rd.recapRowLabel}>Racha diaria</Text>
                <Text style={rd.recapRowValue}>+{rewards.streak}</Text>
              </View>
            )}
            {rewards.ranking > 0 && (
              <View style={rd.recapRow}>
                <Text style={rd.recapRowLabel}>Posición en el ranking</Text>
                <Text style={rd.recapRowValue}>+{rewards.ranking}</Text>
              </View>
            )}
          </View>
          <Pressable style={rd.recapBtn} onPress={onClose}>
            <Text style={rd.recapBtnText}>GENIAL</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
//  Inicio — dirección "Parrilla" (rediseño, ver Rediseño visual Apexly/).
// ---------------------------------------------------------------------------
// Pestaña "Diario" — el circuito de hoy, tu racha, jugar. El saldo de
// monedas y el acceso a Garaje/Tienda viven en la cabecera fija (AppShell)
// y en Perfil, ya no aquí, para no duplicar info entre sitios.
function DiarioTab({
  refreshKey, myStreak, wallet, homeStanding, recap, onCloseRecap, challenge, onCloseChallenge, daily, weather, midnightLabel,
  left, total, unlimited, tryPlay, privacyOptional,
}) {
  return (
    <>
      {recap && <RecapModal rewards={recap} onClose={onCloseRecap} />}

      {challenge && (
        <Pressable style={rd.challengeBanner} onPress={onCloseChallenge}>
          <Text style={rd.challengeBannerText}>RETO · bate los {fmtTime(challenge.ms)}</Text>
        </Pressable>
      )}

      {/* Titular de rivalidad — el ranking completo vive en la pestaña
          Amigos, esto es solo el gancho: dónde vas y a quién persigues,
          sin tener que salir de Diario para verlo. */}
      {homeStanding && (
        <View style={[rd.panel, rd.rivalryPanel]}>
          <Text style={rd.labelMono}>TU PUESTO DE HOY</Text>
          <Text style={rd.rivalryHeadline}>
            {homeStanding.rank === 1 ? (
              <>Vas <Text style={rd.rivalryStrong}>1.º</Text> de {homeStanding.total} — nadie te ha alcanzado hoy</>
            ) : homeStanding.above ? (
              <>
                Vas <Text style={rd.rivalryStrong}>{homeStanding.rank}.º</Text> · a{' '}
                <Text style={rd.rivalryStrong}>{(homeStanding.above.gapMs / 1000).toFixed(1)}s</Text> de {homeStanding.above.nickname}
              </>
            ) : (
              <>Vas <Text style={rd.rivalryStrong}>{homeStanding.rank}.º</Text> de {homeStanding.total}</>
            )}
          </Text>
        </View>
      )}

      {myStreak?.current >= 1 && (
        <View style={rd.panel}>
          <View style={rd.panelHeadRow}>
            <Text style={rd.labelMono}>TU RACHA</Text>
            <View style={rd.streakChip}>
              <Text style={rd.streakChipText}>RACHA {myStreak.current}</Text>
            </View>
          </View>
          <StreakPath current={myStreak?.current} />
        </View>
      )}

      {/* collapsable={false}: en Android una View que solo agrupa se fusiona
          con su padre y deja de ser medible — el tour necesita medirla. */}
      <View style={rd.panel} ref={tourRef('circuito')} collapsable={false}>
        <View style={rd.panelHeadRow}>
          <Text style={rd.labelMono}>CIRCUITO DE HOY</Text>
          <View style={rd.attBadge}>
            <Text style={rd.attBadgeText}>{unlimited ? '∞' : `${Math.max(0, left)}/${total}`}</Text>
          </View>
        </View>
        <Text style={rd.trackName}>{daily.label}</Text>
        <Text style={rd.trackDesc}>Objetivo: ~{Math.round(daily.timeEstimate)}s en limpio</Text>
        <View style={rd.wxRow}>
          <View style={rd.wxDot} />
          <Text style={rd.wxText}>{weather.label.toUpperCase()} · {weather.hint}</Text>
        </View>
      </View>

      <Text style={rd.countdown}>
        Próximo circuito en <Text style={rd.countdownValue}>{midnightLabel}</Text>
      </Text>

      <Pressable style={rd.cta} onPress={tryPlay} ref={tourRef('cta')} collapsable={false}>
        <Text style={rd.ctaText}>{unlimited || left > 0 ? 'Jugar' : `Ver anuncio · +${intentosTxt(AD_BATCH)}`}</Text>
      </Pressable>

      {/* Ranking GLOBAL completo — vive aquí (es el del reto diario), no en
          Amigos (que ahora es solo grupos/Grand Prix). */}
      <View style={rd.rankingBlock} ref={tourRef('ranking')} collapsable={false}>
        <Text style={[rd.labelMono, { marginTop: 4 }]}>RANKING GLOBAL DE HOY</Text>
        <MiniRanking refreshKey={refreshKey} showTabs={false} />
      </View>

      {privacyOptional && (
        <Pressable style={rd.privacyLink} onPress={() => showPrivacyOptions()} hitSlop={8}>
          <Text style={rd.privacyLinkText}>Privacidad de anuncios</Text>
        </Pressable>
      )}
    </>
  );
}

// Pestaña "Amigos" — SOLO grupos (el ranking global vive en Diario, es el
// del reto diario). Sin grupos todavía, esto ES la pantalla de crear/unirse
// — no hace falta navegar a ningún otro sitio para verla. Tocar un grupo
// abre su pantalla propia (GroupHome): miembros+arrancar si no hay GP, o el
// GP directamente si ya lo hay.
function AmigosTab({ refreshKey, onOpenGroup }) {
  const [groups, setGroups] = useState(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { type:'ok'|'err', text }
  const nameRef = useRef(null);
  const nameShake = useRef(new Animated.Value(0)).current;

  async function refresh() {
    try { setGroups(await listMyGroups()); } catch (e) { setGroups([]); }
  }
  useEffect(() => { refresh(); }, [refreshKey]);

  // El CTA se queda siempre en rojo vivo (nunca "apagado" a la espera de que
  // rellenes el nombre): tocarlo sin nombre da foco al campo + lo sacude, en
  // vez de comportarse como un botón muerto hasta que aciertas con el input.
  function nudgeName() {
    nameRef.current?.focus();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    nameShake.setValue(0);
    Animated.sequence([
      Animated.timing(nameShake, { toValue: 1, duration: 45, useNativeDriver: true }),
      Animated.timing(nameShake, { toValue: -1, duration: 90, useNativeDriver: true }),
      Animated.timing(nameShake, { toValue: 1, duration: 90, useNativeDriver: true }),
      Animated.timing(nameShake, { toValue: 0, duration: 45, useNativeDriver: true }),
    ]).start();
  }

  async function doCreate() {
    if (busy) return;
    if (!name.trim()) { nudgeName(); return; }
    setBusy(true); setMsg(null);
    try {
      const g = await createGroup(name.trim());
      setName('');
      setMsg({ type: 'ok', text: `Grupo "${g.name}" creado. Código: ${g.join_code}` });
      await refresh();
    } catch (e) {
      setMsg({ type: 'err', text: 'No se pudo crear el grupo.' });
    } finally { setBusy(false); }
  }

  async function doJoin() {
    if (!code.trim() || busy) return;
    setBusy(true); setMsg(null);
    try {
      const g = await joinGroup(code.trim());
      setCode('');
      setMsg({ type: 'ok', text: `Te has unido a "${g.name}".` });
      await refresh();
    } catch (e) {
      const notFound = String(e?.message || '').includes('GROUP_NOT_FOUND');
      setMsg({ type: 'err', text: notFound ? 'Ese código no existe.' : 'No se pudo unir al grupo.' });
    } finally { setBusy(false); }
  }

  if (groups == null) {
    return <ActivityIndicator color={RD.brand} style={{ marginTop: 24 }} />;
  }

  return (
    <View style={{ gap: 14 }}>
      {msg && <Text style={msg.type === 'ok' ? rd.msgOk : rd.msgErr}>{msg.text}</Text>}

      {groups.length > 0 && (
        <>
          <Text style={rd.labelMono}>TUS GRUPOS</Text>
          <View style={rd.groupsList}>
            {groups.map((g) => (
              <Pressable key={g.id} style={rd.groupCard} onPress={() => onOpenGroup(g)}>
                <View style={rd.groupRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={rd.groupName} numberOfLines={1}>{g.name}</Text>
                    <Text style={rd.groupCode}>CÓDIGO {g.join_code}</Text>
                  </View>
                  <Text style={rd.groupOpenHint}>ABRIR ›</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <View style={rd.panel}>
        <Text style={rd.labelMono}>CREAR UN GRUPO</Text>
        <Animated.View style={{ transform: [{ translateX: nameShake.interpolate({ inputRange: [-1, 1], outputRange: [-8, 8] }) }] }}>
          <TextInput
            ref={nameRef}
            style={rd.input}
            value={name}
            onChangeText={setName}
            placeholder="Nombre del grupo"
            placeholderTextColor={RD.textDisabled}
            maxLength={24}
          />
        </Animated.View>
        <Pressable style={[rd.cta, busy && rd.ctaDisabled]} onPress={doCreate} disabled={busy}>
          <Text style={rd.ctaText}>Crear</Text>
        </Pressable>
      </View>

      <View style={rd.panel}>
        <Text style={rd.labelMono}>UNIRSE CON CÓDIGO</Text>
        <TextInput
          style={[rd.input, rd.inputMono]}
          value={code}
          onChangeText={setCode}
          placeholder="A1B2C3"
          placeholderTextColor={RD.textDisabled}
          autoCapitalize="characters"
          maxLength={6}
        />
        <Pressable style={[rd.secondaryBtnBig, (!code.trim() || busy) && rd.ctaDisabled]} onPress={doJoin} disabled={!code.trim() || busy}>
          <Text style={rd.secondaryBtnBigText}>Unirme</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Pestaña "Carrera" — Modo Carrera (niveles con gap). Placeholder hasta que
// se construya (siguiente fase del plan).
const TABS = [
  { id: 'diario', label: 'DIARIO' },
  { id: 'amigos', label: 'AMIGOS' },
  { id: 'carrera', label: 'CARRERA' },
];

// (Aquí vivía ProfileIcon, un contorno genérico de cabeza+hombros. Se
// sustituyó por el identicon del jugador + su nombre: el problema no era que
// no se entendiera el icono, sino que no tenía identidad y desaparecía al
// lado del chip dorado de monedas.)

// (Aquí vivía CoinIcon, dos círculos concéntricos. Se quitó porque no se leía
// como "moneda" — podía ser un objetivo, un ajuste o un disco. La palabra
// MONEDAS ocupa parecido y no deja lugar a dudas.)

// Cabecera fija + barra de pestañas — envuelve las 3 pestañas de arriba.
// Perfil (stats + Garaje + Tienda) vive fuera, es pantalla completa aparte.
function AppShell({ tab, setTab, nickname, wallet, onOpenProfile, tour, children }) {
  return (
    <View style={rd.shell}>
      <StatusBar hidden />
      <DangerStripe height={6} />

      <View style={rd.appHeader}>
        {/* Antes: contorno gris de persona sobre borde #2a2a2c — se perdía al
            lado del chip de monedas, que va en dorado sobre dorado. Ahora
            lleva el identicon del jugador (color propio, no genérico) y su
            nombre, que es lo que lo convierte en "tu sitio" y no en un botón
            de ajustes cualquiera. */}
        <Pressable
          style={rd.profileBtn}
          onPress={onOpenProfile}
          hitSlop={6}
          ref={tourRef('perfil')}
          collapsable={false}
        >
          <Identicon seed={nickname} size={20} />
          <Text style={rd.profileBtnName} numberOfLines={1}>{nickname}</Text>
          {/* El chevron es lo que dice "esto se toca". Sin él, con borde e
              icono, se leía igual que el chip de monedas de al lado, que NO
              es un botón. */}
          <Text style={rd.profileBtnChevron}>›</Text>
          {wallet?.pendingPacks > 0 && <View style={rd.profileBadge} />}
        </Pressable>
        {/* Rotulado a palabra: el icono de moneda solo no se entendía, y el
            número suelto podía ser cualquier cosa (puntos, nivel, posición). */}
        <View style={rd.coinChip}>
          <Text style={rd.coinChipLabel}>MONEDAS</Text>
          <Text style={rd.coinChipText}>{wallet?.balance ?? 0}</Text>
        </View>
      </View>

      <ScrollView style={rd.screen} contentContainerStyle={rd.tabScreenContent}>
        {children}
      </ScrollView>

      {/* SafeAreaView con edges=['bottom']: deja el hueco real de la barra
          de navegación del sistema (antes calculábamos el margen a mano con
          useSafeAreaInsets() y no se aplicaba bien — esto es el patrón
          estándar de RN para exactamente este problema, más fiable). */}
      <SafeAreaView edges={['bottom']} style={rd.tabBar}>
        {TABS.map((t) => (
          <Pressable
            key={t.id}
            style={rd.tabBarBtn}
            onPress={() => setTab(t.id)}
            hitSlop={4}
            ref={tourRef(`tab-${t.id}`)}
            collapsable={false}
          >
            <Text style={[rd.tabBarBtnText, tab === t.id && rd.tabBarBtnTextActive]}>{t.label}</Text>
            {tab === t.id && <View style={rd.tabBarIndicator} />}
          </Pressable>
        ))}
      </SafeAreaView>

      {/* El tour va DENTRO del shell y no en un Modal a propósito: mide los
          elementos con measureInWindow (coordenadas de ventana) y el shell
          arranca justo en 0,0 de la ventana, así que los recortes caen
          exactos. Un Modal en Android mete su propio desplazamiento y los
          descuadraría. Va el último para quedar por encima de todo. */}
      {tour}
    </View>
  );
}

const rd = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RD.bg },
  screenContent: { paddingHorizontal: 18, paddingTop: PAD, paddingBottom: 40, gap: 16 },

  onboardWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 18, gap: 28 },
  onboardBrand: { alignItems: 'center', gap: 6 },
  onboardTitle: {
    color: RD.textPrimary, fontSize: 44, fontFamily: RD_FONT.displayBlack,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  onboardTagline: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono, letterSpacing: 3 },

  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  coinChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    borderWidth: 1, borderColor: RD.gold1st, borderRadius: 2, paddingHorizontal: 9, paddingVertical: 5,
    backgroundColor: RD.gold1stShade,
  },
  coinChipLabel: {
    color: RD.gold1st, fontSize: 9, fontFamily: RD_FONT.mono, letterSpacing: 0.8, opacity: 0.85,
  },
  coinChipText: { color: RD.gold1st, fontSize: 13, fontFamily: RD_FONT.monoBold },

  // Cabecera fija + barra de pestañas (AppShell) — envuelve Diario/Amigos/Carrera.
  shell: { flex: 1, backgroundColor: RD.bg },
  appHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: PAD, paddingBottom: 10,
  },
  profileBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    paddingLeft: 6, paddingRight: 10, paddingVertical: 5,
    maxWidth: 190,
  },
  profileBtnName: {
    color: RD.textPrimary, fontSize: 12, fontFamily: RD_FONT.monoSemibold, flexShrink: 1,
  },
  profileBtnChevron: { color: RD.textTertiary, fontSize: 15, marginLeft: -2, marginTop: -2 },
  profileBtnText: { color: RD.textPrimary, fontSize: 14, fontFamily: RD_FONT.monoBold },
  profileBadge: {
    position: 'absolute', top: -1, right: -1, width: 9, height: 9, borderRadius: 5,
    backgroundColor: RD.brand, borderWidth: 1.5, borderColor: RD.bg,
  },
  tabScreenContent: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 24, gap: 16 },
  tabBar: {
    flexDirection: 'row', borderTopWidth: 1, borderTopColor: RD.panelBorder,
    paddingBottom: 10, paddingTop: 8, backgroundColor: RD.bg,
  },
  tabBarBtn: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 4 },
  tabBarBtnText: { color: RD.textDisabled, fontSize: 11, fontFamily: RD_FONT.monoBold, letterSpacing: 0.6 },
  tabBarBtnTextActive: { color: RD.textPrimary },
  tabBarIndicator: { width: 18, height: 2, backgroundColor: RD.brand },
  streakChip: {
    borderWidth: 1, borderColor: RD.gold1st, borderRadius: 2, paddingHorizontal: 7, paddingVertical: 4,
  },
  streakChipText: { color: RD.gold1st, fontSize: 11, fontFamily: RD_FONT.monoBold },

  challengeBanner: {
    borderWidth: 1, borderColor: RD.brand, borderRadius: 2,
    paddingVertical: 8, alignItems: 'center', backgroundColor: 'rgba(255,90,31,0.1)',
  },
  challengeBannerText: { color: RD.brand, fontSize: 11, fontFamily: RD_FONT.monoBold, letterSpacing: 0.6 },

  streakPath: { marginTop: 4 },
  streakDotsRow: { flexDirection: 'row', alignItems: 'center' },
  streakDotCol: { alignItems: 'center' },
  streakConnector: { flex: 1, height: 2, backgroundColor: RD.panelBorder, marginHorizontal: 2 },
  streakConnectorDone: { backgroundColor: RD.gold1st },
  streakDot: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: RD.panelBorder,
    backgroundColor: RD.bg, alignItems: 'center', justifyContent: 'center',
  },
  streakDotDone: { borderColor: RD.gold1st, backgroundColor: RD.gold1stShade },
  streakDotToday: { borderColor: RD.brand, borderWidth: 2 },
  streakDotText: { color: RD.textDisabled, fontSize: 10, fontFamily: RD_FONT.monoBold },
  streakDotTextDone: { color: RD.gold1st },
  streakLabelsRow: { flexDirection: 'row', marginTop: 4 },
  // Columna del día 7 igual de ancha que las demás (22, para no desalinear el
  // resto vía el reparto de los spacers flexibles) — "SOBRE" se renderiza
  // ABSOLUTO por encima, más ancho, centrado sobre esa misma columna, así
  // desborda sin arrastrar a los días 1-6 fuera de sitio.
  streakLabelCol: { width: 22, alignItems: 'center' },
  streakLabelColLast: { width: 22, alignItems: 'center', position: 'relative' },
  streakConnectorSpacer: { flex: 1, marginHorizontal: 2 },
  streakAmount: { color: RD.textDisabled, fontSize: 9, fontFamily: RD_FONT.mono },
  streakAmountDone: { color: RD.textSecondary },
  streakGiftText: {
    position: 'absolute', width: 44, left: -11, textAlign: 'center', fontSize: 7.5, letterSpacing: 0.3,
  },
  streakGiftDone: { color: RD.brand, fontFamily: RD_FONT.monoBold },

  recapBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  recapCard: {
    width: '100%', maxWidth: 320, backgroundColor: RD.bg, borderWidth: 1, borderColor: RD.gold1st,
    borderRadius: 2, padding: 22, alignItems: 'center', gap: 10,
  },
  recapTitle: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono, letterSpacing: 1.4 },
  recapTotal: { color: RD.gold1st, fontSize: 40, fontFamily: RD_FONT.displayBlack },
  recapRows: { alignSelf: 'stretch', gap: 6, marginTop: 4 },
  recapRow: { flexDirection: 'row', justifyContent: 'space-between' },
  recapRowLabel: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono },
  recapRowValue: { color: RD.textPrimary, fontSize: 12, fontFamily: RD_FONT.monoBold },
  recapBtn: {
    alignSelf: 'stretch', backgroundColor: RD.brand, borderRadius: 2,
    paddingVertical: 12, alignItems: 'center', marginTop: 6,
  },
  recapBtnText: {
    color: RD.bg, fontSize: 14, fontFamily: RD_FONT.displayBlack, textTransform: 'uppercase', letterSpacing: 0.6,
  },

  panel: { borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2, padding: 14, gap: 8 },
  rivalryPanel: { borderColor: RD.trackBlue },
  rivalryHeadline: { color: RD.textPrimary, fontSize: 15, fontFamily: RD_FONT.mono, lineHeight: 21 },
  rivalryStrong: { color: RD.trackBlue, fontFamily: RD_FONT.monoBold },
  panelHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  labelMono: { color: RD.textTertiary, fontSize: 10, fontFamily: RD_FONT.mono, letterSpacing: 1.4 },
  attBadge: { backgroundColor: RD.cream, paddingHorizontal: 6, paddingVertical: 3 },
  attBadgeText: { color: RD.bg, fontSize: 10, fontFamily: RD_FONT.monoBold },
  trackName: {
    color: RD.trackBlue, fontSize: 28, fontFamily: RD_FONT.displayBlack,
    textTransform: 'uppercase', lineHeight: 30,
  },
  trackDesc: { color: RD.textSecondary, fontSize: 13 },
  wxRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2,
    borderTopWidth: 1, borderTopColor: RD.gridLine, paddingTop: 8,
  },
  wxDot: { width: 8, height: 8, backgroundColor: RD.cream },
  wxText: { color: RD.cream, fontSize: 11, fontFamily: RD_FONT.mono, flex: 1 },

  countdown: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono, textAlign: 'center' },
  countdownValue: { color: RD.textPrimary, fontFamily: RD_FONT.monoBold, fontVariant: ['tabular-nums'] },

  cta: { backgroundColor: RD.brand, borderRadius: 2, paddingVertical: 16, alignItems: 'center' },
  ctaDisabled: { opacity: 0.4 },
  // El bloque de ranking (rótulo + lista) va envuelto para que el tour pueda
  // resaltarlo entero. El `gap` reproduce el que daba el contenedor cuando
  // eran dos hijos sueltos — sin él la lista se pegaría al rótulo.
  rankingBlock: { gap: 16 },
  ctaText: {
    color: RD.bg, fontSize: 22, fontFamily: RD_FONT.displayBlack,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },

  privacyLink: { alignItems: 'center', marginTop: 4, paddingVertical: 6 },
  privacyLinkText: { color: RD.textDisabled, fontSize: 12, fontFamily: RD_FONT.mono, textDecorationLine: 'underline' },

  resultTop: {
    alignItems: 'center', paddingTop: 20, paddingHorizontal: 8, paddingBottom: 14, gap: 8, position: 'relative',
    borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
  },
  resultBadge: { borderRadius: 2, paddingHorizontal: 14, paddingVertical: 6 },
  resultBadgeText: { fontFamily: RD_FONT.monoBold, fontSize: 12, letterSpacing: 1 },
  resultNeutral: { color: RD.textSecondary, fontSize: 15, fontFamily: RD_FONT.mono },
  resultTime: { fontFamily: RD_FONT.monoBold, fontSize: 52, fontVariant: ['tabular-nums'] },
  trackMapBox: {
    width: '100%', borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    alignItems: 'center', justifyContent: 'center', paddingVertical: 8,
  },
  sectorSplitsRow: { flexDirection: 'row', justifyContent: 'center', gap: 14 },
  sectorSplitCol: { alignItems: 'center', gap: 2 },
  sectorSplitDivider: { width: 1, alignSelf: 'stretch', backgroundColor: RD.panelBorder },
  sectorSplitLabel: { color: RD.textDisabled, fontSize: 10, fontFamily: RD_FONT.mono, letterSpacing: 1 },
  sectorSplitValue: { fontSize: 14, fontFamily: RD_FONT.monoBold, fontVariant: ['tabular-nums'] },
  resultDivider: { alignSelf: 'stretch', height: 1, backgroundColor: RD.gridLine, marginVertical: 2 },
  resultRank: { color: RD.textSecondary, fontSize: 14, fontFamily: RD_FONT.mono },
  resultChase: {
    color: RD.textPrimary, fontSize: 13, fontFamily: RD_FONT.monoBold,
    textAlign: 'center', marginTop: 2,
  },
  resultChaseTime: { color: RD.trackBlue },
  resultBtnsRow: { flexDirection: 'row', gap: 10 },
  resultSecondaryBtn: {
    flex: 1, borderWidth: 1, borderColor: '#3a3a3a', borderRadius: 2,
    paddingVertical: 14, alignItems: 'center',
  },
  resultSecondaryBtnText: { color: RD.textPrimary, fontSize: 14, fontWeight: '700' },
  shareIconBtn: {
    position: 'absolute', top: 8, right: 8, width: 34, height: 34, borderRadius: 17,
    borderWidth: 1, borderColor: RD.panelBorder, backgroundColor: RD.bg, alignItems: 'center', justifyContent: 'center',
  },

  backLink: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono, marginBottom: 8 },
  pageTitle: {
    color: RD.textPrimary, fontSize: 28, fontFamily: RD_FONT.displayBlack,
    textTransform: 'uppercase', marginBottom: 4,
  },
  msgOk: { color: RD.successGreen, fontSize: 13, fontFamily: RD_FONT.mono },
  msgErr: { color: RD.danger, fontSize: 13, fontFamily: RD_FONT.mono },
  noAttemptsBody: { color: RD.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 4 },
  noAttemptsMsg: { color: RD.brand, fontSize: 13, fontFamily: RD_FONT.mono, textAlign: 'center' },
  noAttemptsSkip: { color: RD.textTertiary, fontSize: 13, fontFamily: RD_FONT.mono, textAlign: 'center' },
  orDivider: {
    color: RD.textDisabled, fontSize: 10, fontFamily: RD_FONT.mono,
    letterSpacing: 1.4, textAlign: 'center',
  },
  input: {
    borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    paddingHorizontal: 12, paddingVertical: 10, color: RD.textPrimary, fontSize: 15,
    marginTop: 8, marginBottom: 10,
  },
  inputMono: { fontFamily: RD_FONT.mono, letterSpacing: 2, textTransform: 'uppercase' },
  secondaryBtnBig: { borderWidth: 1, borderColor: '#3a3a3a', borderRadius: 2, paddingVertical: 14, alignItems: 'center' },
  secondaryBtnBigText: { color: RD.textPrimary, fontSize: 14, fontWeight: '700' },
  actionsRow: { flexDirection: 'row', gap: 8 },
  actionBtn: { flex: 1 },
  garageBtn: { borderWidth: 1, borderColor: RD.trackBlue, borderRadius: 2, paddingVertical: 14, alignItems: 'center' },
  garageBtnText: { color: RD.trackBlue, fontSize: 14, fontFamily: RD_FONT.monoBold, letterSpacing: 0.5 },
  muted: { color: RD.textTertiary, fontSize: 13, fontFamily: RD_FONT.mono, marginTop: 8 },

  groupsList: { gap: 6 },
  groupCard: { backgroundColor: RD.bg, borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2, padding: 12 },
  groupRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  },
  groupName: { color: RD.textPrimary, fontSize: 15, fontWeight: '700' },
  groupCode: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono, marginTop: 2 },
  groupOpenHint: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.monoBold },
});

// ---------------------------------------------------------------------------
//  Grupos: crear / unirse por código / ver los míos.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
//  Sin intentos: ofrecer ver un anuncio para +3 (rewarded).
// ---------------------------------------------------------------------------
function NoMoreAttempts({ title = 'SIN INTENTOS POR HOY', adBatch = AD_BATCH, unlocking, adMsg, onWatchAd, onBack }) {
  return (
    <ScrollView style={rd.screen} contentContainerStyle={{ flexGrow: 1 }}>
      <StatusBar hidden />
      <DangerStripe height={6} />
      <View style={rd.onboardWrap}>
        <View style={rd.panel}>
          <Text style={rd.labelMono}>{title}</Text>
          <Text style={rd.noAttemptsBody}>
            Has usado tus intentos gratis. Mira un anuncio y sigue intentando bajar tu tiempo — te da {intentosTxt(adBatch)} más.
          </Text>
          <Pressable
            style={[rd.cta, unlocking && rd.ctaDisabled]}
            disabled={unlocking}
            onPress={onWatchAd}
          >
            <Text style={rd.ctaText}>{unlocking ? 'Cargando anuncio…' : `Ver anuncio · +${intentosTxt(adBatch)}`}</Text>
          </Pressable>
          {!!adMsg && !unlocking && <Text style={rd.noAttemptsMsg}>{adMsg}</Text>}
        </View>

        <Pressable style={{ marginTop: 4 }} onPress={onBack}>
          <Text style={rd.noAttemptsSkip}>Ahora no</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
//  Onboarding: pedir nickname (sin login).
// ---------------------------------------------------------------------------
function Onboarding({ onDone }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const ok = value.trim().length > 0;

  async function submit() {
    if (!ok || saving) return;
    setSaving(true);
    setError('');
    try {
      await onDone(value);
    } catch (e) {
      setError(e?.code === 'NICKNAME_TAKEN' ? e.message : 'No se pudo guardar. Inténtalo de nuevo.');
      setSaving(false);
    }
  }

  return (
    <View style={rd.screen}>
      <StatusBar hidden />
      <DangerStripe height={6} />
      <View style={rd.onboardWrap}>
        <View style={rd.onboardBrand}>
          <Text style={rd.onboardTitle}>APEX<Text style={{ color: RD.brand }}>LY</Text></Text>
          <Text style={rd.onboardTagline}>CIRCUITO DIARIO</Text>
        </View>

        <View style={rd.panel}>
          <Text style={rd.labelMono}>¿CÓMO TE LLAMAMOS?</Text>
          <TextInput
            style={rd.input}
            value={value}
            onChangeText={(v) => { setValue(v); if (error) setError(''); }}
            placeholder="Tu nombre"
            placeholderTextColor={RD.textDisabled}
            maxLength={16}
            autoFocus
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={submit}
          />
          {!!error && <Text style={rd.msgErr}>{error}</Text>}
          <Pressable
            style={[rd.cta, (!ok || saving) && rd.ctaDisabled]}
            disabled={!ok || saving}
            onPress={submit}
          >
            <Text style={rd.ctaText}>{saving ? 'Guardando…' : 'Empezar'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// Banco de frases del "gancho de rival" (justo encima del botón de reintentar
// en Resultado): rotan al azar para que no se repita siempre la misma. `gap`
// llega ya formateado (p.ej. "0.120", sin "s") y siempre se pinta en azul
// junto a la "s"; el resto del texto en blanco (ver rd.resultChase/-Time).
const CHASE_LINES = [
  (gap, rival) => <>Estás a solo <Text style={rd.resultChaseTime}>{gap}s</Text> de {rival} · ¿no quieres quitarle el puesto?</>,
  (gap, rival) => <>{rival} te saca solo <Text style={rd.resultChaseTime}>{gap}s</Text> — una curva mejor tomada y es tuyo.</>,
  (gap, rival) => <>A <Text style={rd.resultChaseTime}>{gap}s</Text> de quitarle el puesto a {rival}. Con una vuelta más lo tienes.</>,
  (gap, rival) => <>Tan solo <Text style={rd.resultChaseTime}>{gap}s</Text> separan tu nombre del de {rival}. Otra vuelta y listo.</>,
  (gap, rival) => <><Text style={rd.resultChaseTime}>{gap}s</Text>. Dale con las largas y que se aparte. Adelántalo.</>,
  (gap, rival) => <>Con una trazada más limpia le ganas esos <Text style={rd.resultChaseTime}>{gap}s</Text> a {rival}.</>,
  (gap, rival) => <>Te faltan <Text style={rd.resultChaseTime}>{gap}s</Text> para pasar a {rival} — se nota más en las frenadas que en la recta.</>,
  (gap, rival) => <><Text style={rd.resultChaseTime}>{gap}s</Text> es nada. {rival} lo sabe, tú también.</>,
  (gap, rival) => <>Ajusta un poco la entrada en curva y esos <Text style={rd.resultChaseTime}>{gap}s</Text> con {rival} desaparecerán.</>,
  (gap, rival) => <>{rival} va <Text style={rd.resultChaseTime}>{gap}s</Text> por delante. Te ve por el retrovisor.</>,
  (gap, rival) => <>Solo <Text style={rd.resultChaseTime}>{gap}s</Text> te separan de {rival} — mantén pulsado para tomar las horquillas.</>,
  (gap, rival) => <>{rival} está a tu alcance: <Text style={rd.resultChaseTime}>{gap}s</Text>, ni un suspiro.</>,
];

// Banco de frases del bloque "líder del ranking" (junto al mapa con el peor
// sector en rojo): mismo mecanismo de rotación al azar que CHASE_LINES.
// `sectorNum` llega en base 1 (S1/S2/S3, igual que las etiquetas de arriba).
const LEADER_LINES = [
  (sectorNum) => <>En el mapa puedes ver cuál es tu peor sector respecto al líder de hoy. Trabaja el <Text style={rd.resultChaseTime}>Sector {sectorNum}</Text> y te pondrás en el podio.</>,
  (sectorNum) => <>El <Text style={rd.resultChaseTime}>Sector {sectorNum}</Text> es tu talón de Aquiles hoy — ahí es donde más te saca el líder. Corrígelo y subes al podio.</>,
  (sectorNum) => <>Fíjate en el <Text style={rd.resultChaseTime}>Sector {sectorNum}</Text>, en rojo en el mapa: es tu mayor diferencia con el líder de hoy.</>,
  (sectorNum) => <>Todo tu margen para el podio está en el <Text style={rd.resultChaseTime}>Sector {sectorNum}</Text> — es donde más se aleja el líder.</>,
  (sectorNum) => <>El líder de hoy te saca la diferencia sobre todo en el <Text style={rd.resultChaseTime}>Sector {sectorNum}</Text>. Iguálalo ahí y el podio es tuyo.</>,
  (sectorNum) => <>Marcado en rojo: el <Text style={rd.resultChaseTime}>Sector {sectorNum}</Text> es tu única barrera para el podio de hoy.</>,
];

// Icono de compartir (nodo + 2 enlaces, mismo lenguaje visual que LockIcon en
// Garage.js: SVG a mano, sin librería de iconos).
function ShareIcon({ color }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24">
      <Line x1="8.6" y1="10.6" x2="15.4" y2="6.4" stroke={color} strokeWidth={1.8} />
      <Line x1="8.6" y1="13.4" x2="15.4" y2="17.6" stroke={color} strokeWidth={1.8} />
      <Circle cx="6" cy="12" r="2.6" fill="none" stroke={color} strokeWidth={1.8} />
      <Circle cx="18" cy="5" r="2.6" fill="none" stroke={color} strokeWidth={1.8} />
      <Circle cx="18" cy="19" r="2.6" fill="none" stroke={color} strokeWidth={1.8} />
    </Svg>
  );
}

// Variantes del texto de reto (rotan al azar para no repetirse siempre igual).
const SHARE_TAGLINES = ['¿Me superas?', 'No creo que la superes.', 'A ver si la bates.'];

// ---------------------------------------------------------------------------
//  Resultado: tiempo + stats + tarjeta para compartir. Micro-recompensa si récord.
// ---------------------------------------------------------------------------
function Results({ result, label, track, weather, nickname, attemptsLeft = Infinity, total = 0, unlimited = false, refreshKey, onRetry, onHome }) {
  const wx = weather || { icon: '', label: '' };
  const outOfAttempts = attemptsLeft <= 0;
  const cardRef = useRef(null);
  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const [standing, setStanding] = useState(null);      // global { rank, total, gapToLeaderMs, above }
  const [groupRank, setGroupRank] = useState(null);     // puesto en tu grupo principal

  // Logro conseguido. La celebración exige HABER MEJORADO en esta vuelta
  // (result.isBest): si corres más lento sigues 1.º del ranking, pero no es
  // un logro nuevo → tiempo dorado "sin mejora", sin badge.
  // Prioridad cuando mejoras: 1.º mundial > 1.º de tu grupo > récord personal.
  const improved = result.isBest;
  const isGlobalTop = improved && standing?.rank === 1;
  const isGroupTop = improved && !isGlobalTop && groupRank === 1;
  const isPersonalBest = improved && !isGlobalTop && !isGroupTop;
  const vibe = isGlobalTop ? 'global' : isGroupTop ? 'group' : isPersonalBest ? 'best' : 'flat';
  const celebrate = vibe !== 'flat';

  // Peor sector respecto al mejor de hoy (no morado) con más pérdida frente al
  // fantasma — es la mejor aproximación que tenemos a "tu sector más flojo
  // frente al líder", ya que no guardamos la traza de nadie más (solo el
  // mejor tiempo de sector del día, el mismo criterio del morado).
  let worstSectorIdx = null;
  if (result.sectorColors) {
    let worstMs = 0;
    result.sectorColors.forEach((color, i) => {
      if (color === 'purple') return; // ya es el mejor del día en ese tramo
      const d = result.sectorDeltas?.[i];
      if (d != null && d > worstMs) { worstMs = d; worstSectorIdx = i; }
    });
  }
  const showWorstSectorTip = worstSectorIdx != null && !isGlobalTop;

  // Una sola frase motivadora (no dos): sortea entre el banco de rival y el
  // de líder según qué dato haya disponible esta vez. Si no hay ni rival por
  // delante ni sector flojo (vas líder en todo), no hay nada que incitar.
  const finalLine = useMemo(() => {
    if (!standing) return null;
    const candidates = [];
    if (standing.above) {
      const gapTxt = fmtSecs(standing.above.gapMs);
      CHASE_LINES.forEach((tpl) => candidates.push(tpl(gapTxt, standing.above.nickname)));
    }
    if (showWorstSectorTip) {
      LEADER_LINES.forEach((tpl) => candidates.push(tpl(worstSectorIdx + 1)));
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }, [standing, showWorstSectorTip, worstSectorIdx]);

  useEffect(() => {
    if (!result.submitting && celebrate) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      scale.setValue(0.6);
      opacity.setValue(0);
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, friction: 4, tension: 90, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    }
  }, [result.submitting, vibe]);

  // Posición global (para color del tiempo + compartir).
  useEffect(() => {
    if (result.submitting) return;
    let alive = true;
    getGlobalBoard()
      .then((b) => {
        if (!alive) return;
        if (b.me) {
          const rival = b.aboveRows?.[0];
          setStanding({
            rank: b.me.rank,
            total: b.total,
            gapToLeaderMs: b.me.gapToLeaderMs,
            above: rival ? { nickname: rival.nickname, gapMs: b.me.bestMs - rival.bestMs } : null,
          });
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [result.submitting, refreshKey]);

  // Puesto en tu grupo principal (para el color morado si eres 1.º del grupo).
  useEffect(() => {
    if (result.submitting) return;
    let alive = true;
    listMyGroups()
      .then((gs) => {
        if (!gs || gs.length === 0) return null;
        return getLeaderboard(gs[0].id).then((rows) => {
          if (!alive) return;
          const me = rows.find((r) => r.isMe);
          if (me) setGroupRank(me.rank);
        });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [result.submitting, refreshKey]);

  const rankText = standing ? `${standing.rank}.º de ${standing.total} en el mundo` : null;

  const [tagline] = useState(() => SHARE_TAGLINES[Math.floor(Math.random() * SHARE_TAGLINES.length)]);

  async function shareResult() {
    // Deep link al reto: si quien lo abre lo hace HOY, ve un banner para batir
    // este tiempo concreto en Inicio (ver efecto de Linking en App()).
    const challengeUrl = `circuitodiario://reto?ms=${result.ms}&day=${todayKey()}`;
    const parts = [`Apexly · ${dayShort()} ${wx.icon}`.trim(), fmtTime(result.ms)];
    if (standing) parts.push(`${standing.rank}.º de ${standing.total} · +${fmtSecs(standing.gapToLeaderMs)}s al líder`);
    parts.push(tagline, challengeUrl);
    // Genera la imagen y la comparte (con vista previa); si no puede, texto.
    await shareCardImage(cardRef, parts.join('\n'));
    // +5 monedas por compartir (1 vez/día, idempotente en servidor) — se
    // concede al usar el flujo de compartir, no hace falta confirmar que el
    // receptor lo vio (los share sheets nativos no dan esa señal fiable).
    claimShareReward().catch(() => {});
  }

  const banner =
    vibe === 'global' ? { text: '◆  MEJOR TIEMPO MUNDIAL  ◆', bg: RD.gold1st } :
    vibe === 'group' ? { text: '★ 1.º DE TU GRUPO', bg: RD.trackBlue } :
    vibe === 'best' ? { text: '★ NUEVO RÉCORD', bg: RD.successGreen } :
    null;
  const timeColor =
    vibe === 'global' ? RD.gold1st : vibe === 'group' ? RD.trackBlue : vibe === 'best' ? RD.successGreen : RD.cream;

  return (
    <ScrollView style={rd.screen} contentContainerStyle={rd.screenContent}>
      <StatusBar hidden />

      <View style={rd.resultTop}>
        <Pressable style={rd.shareIconBtn} onPress={shareResult} hitSlop={8}>
          <ShareIcon color={RD.textSecondary} />
        </Pressable>
        {banner ? (
          vibe === 'global' ? (
            <Animated.View style={{ opacity, transform: [{ scale }] }}>
              <ShineBadge style={[rd.resultBadge, { backgroundColor: banner.bg }]}>
                <Text style={[rd.resultBadgeText, { color: RD.bg }]}>{banner.text}</Text>
              </ShineBadge>
            </Animated.View>
          ) : (
            <Animated.View style={[rd.resultBadge, { backgroundColor: banner.bg, opacity, transform: [{ scale }] }]}>
              <Text style={[rd.resultBadgeText, { color: RD.bg }]}>{banner.text}</Text>
            </Animated.View>
          )
        ) : result.submitting ? (
          <Text style={rd.resultNeutral}>Guardando…</Text>
        ) : null}
        <Text style={[rd.resultTime, { color: timeColor }]}>{fmtTime(result.ms)}</Text>

        <View style={rd.trackMapBox}>
          <MiniTrackMap track={track} w={TRACKMAP_W} h={80} worstSector={showWorstSectorTip ? worstSectorIdx : null} />
        </View>

        {result.sectorDeltas && result.sectorDeltas.length > 0 && (() => {
          const allKnown = result.sectorDeltas.every((d) => d != null);
          const total = allKnown ? result.sectorDeltas.reduce((a, b) => a + b, 0) : null;
          return (
            <View style={rd.sectorSplitsRow}>
              {result.sectorDeltas.map((delta, i) => {
                const color = SECTOR_RESULT_COLORS[result.sectorColors?.[i]] || RD.cream;
                const value = delta == null ? '—' : `${delta <= 0 ? '−' : '+'}${(Math.abs(delta) / 1000).toFixed(3)}s`;
                return (
                  <View key={i} style={rd.sectorSplitCol}>
                    <Text style={rd.sectorSplitLabel}>S{i + 1}</Text>
                    <Text style={[rd.sectorSplitValue, { color }]}>{value}</Text>
                  </View>
                );
              })}
              {total != null && (
                <>
                  <View style={rd.sectorSplitDivider} />
                  <View style={rd.sectorSplitCol}>
                    <Text style={rd.sectorSplitLabel}>TOTAL</Text>
                    <Text style={[rd.sectorSplitValue, { color: total <= 0 ? RD.successGreen : RD.danger }]}>
                      {`${total <= 0 ? '−' : '+'}${(Math.abs(total) / 1000).toFixed(3)}s`}
                    </Text>
                  </View>
                </>
              )}
            </View>
          );
        })()}

        {standing && (
          <>
            <View style={rd.resultDivider} />
            <Text style={rd.resultRank}>{standing.rank}.º de {standing.total} en el mundo</Text>
            {finalLine && <Text style={rd.resultChase}>{finalLine}</Text>}
          </>
        )}
      </View>

      <Pressable style={rd.cta} onPress={onRetry}>
        <Text style={rd.ctaText}>
          {outOfAttempts ? `Ver anuncio · +${intentosTxt(AD_BATCH)}` : unlimited ? 'Reintentar' : `Reintentar (${attemptsLeft}/${total})`}
        </Text>
      </Pressable>

      <View style={rd.resultBtnsRow}>
        <Pressable style={rd.resultSecondaryBtn} onPress={onHome}>
          <Text style={rd.resultSecondaryBtnText}>Inicio</Text>
        </Pressable>
      </View>

      <Text style={[rd.labelMono, { marginTop: 4 }]}>RANKING DE HOY</Text>
      <MiniRanking refreshKey={refreshKey} showTabs={false} />

      {/* Tarjeta para compartir: renderizada fuera de pantalla y capturada a PNG. */}
      <View style={styles.offscreen} pointerEvents="none">
        <ShareCard
          ref={cardRef}
          track={track}
          time={fmtTime(result.ms)}
          rankText={rankText}
          weather={wx}
          nickname={nickname}
          day={dayShort()}
          accent={timeColor}
          tagline={tagline}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  screenContent: { paddingHorizontal: 22, paddingTop: PAD, paddingBottom: 40 },
  centerScreen: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },

  brand: { color: C.ink, fontSize: 32, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center' },
  subtitle: { color: C.dim, fontSize: 16, textAlign: 'center', marginTop: 8, marginBottom: 24 },

  homeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  streakChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: C.card,
    borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6,
  },
  streakDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.gold },
  streakChipText: { color: C.ink, fontSize: 13, fontWeight: '700' },

  trackName: { color: C.gold, fontSize: 24, fontWeight: '800', marginTop: 6, letterSpacing: -0.5 },
  attBadge: {
    position: 'absolute', top: 14, right: 14, zIndex: 2,
    backgroundColor: 'rgba(255,184,77,0.14)', borderWidth: 1, borderColor: 'rgba(255,184,77,0.34)',
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  attBadgeText: { color: C.gold, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  attBadgeEmpty: { backgroundColor: 'rgba(255,106,61,0.14)', borderColor: 'rgba(255,106,61,0.34)' },
  attBadgeTextEmpty: { color: C.hot },
  trackDesc: { color: C.dim, fontSize: 14, marginTop: 4 },
  trackCountdown: { color: C.faint, fontSize: 12, fontFamily: MONO, fontVariant: ['tabular-nums'], marginTop: 2 },
  wxRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  wxIcon: { fontSize: 18 },
  wxRowText: { color: C.dim, fontSize: 13, flex: 1 },
  wxRowLabel: { color: C.ink, fontWeight: '800' },
  trackBest: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.line,
  },
  trackBestK: { color: C.dim, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  trackBestV: { color: C.ink, fontSize: 20, fontWeight: '700', fontFamily: MONO, fontVariant: ['tabular-nums'] },

  onboardInner: { flex: 1, justifyContent: 'center', paddingHorizontal: 22 },
  input: {
    backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 14, color: C.ink, fontSize: 20,
    fontWeight: '700', paddingHorizontal: 16, paddingVertical: 14, marginBottom: 16, textAlign: 'center',
  },


  primaryBtn: { backgroundColor: C.green, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  primaryBtnDisabled: { opacity: 0.4 },
  adMsg: {
    color: C.hot,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 18,
    backgroundColor: 'rgba(255,106,61,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,106,61,0.3)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  primaryBtnText: { color: '#04160b', fontSize: 17, fontWeight: '800' },
  secondaryBtn: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line2, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  secondaryBtnText: { color: C.ink, fontSize: 16, fontWeight: '700' },

  offscreen: { position: 'absolute', left: -5000, top: 0 },

  shareCard: {
    backgroundColor: C.card2, borderWidth: 1, borderColor: C.line2, borderRadius: 18,
    padding: 16, marginBottom: 12, gap: 10,
  },
  shareTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  shareName: { color: C.ink, fontSize: 13, fontWeight: '800' },
  shareDay: { color: C.dim, fontSize: 11, fontFamily: MONO },
  shareTime: { color: C.ink, fontSize: 34, fontWeight: '800', fontFamily: MONO, fontVariant: ['tabular-nums'] },
  shareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  shareMeta: { color: C.dim, fontSize: 11, flex: 1, marginRight: 8 },
  sharePill: { color: C.purple, backgroundColor: 'rgba(184,132,255,0.18)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, fontSize: 11, fontWeight: '700', overflow: 'hidden' },



  privacyLink: { alignItems: 'center', marginTop: 20, paddingVertical: 6 },
  privacyLinkText: { color: C.faint, fontSize: 12, fontWeight: '600', textDecorationLine: 'underline' },

  errTitle: { color: C.ink, fontSize: 22, fontWeight: '800', marginBottom: 6 },
  errSub: { color: C.dim, fontSize: 14, textAlign: 'center', marginBottom: 20 },
});

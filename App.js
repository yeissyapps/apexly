// ============================================================================
//  Apexly — App.  Dirección de arte "A refinada" (oscuro moderno).
//
//  Router de pantallas: carga sesión anónima -> onboarding (nickname la 1.ª vez)
//  -> Inicio (circuito del día + ranking del grupo) -> Juego -> Resultado.
//  El juego (física/cámara/colisión/piezas) vive en src/Game.js sin tocar.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Dimensions, Pressable, ScrollView, Share, StyleSheet, Text,
  TextInput, View,
} from 'react-native';
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
import { todayKey } from './src/daily';
import { dailyCircuit } from './src/generator';
import { dailyWeather, weatherById, WEATHER_IDS } from './src/weather';

// Modo de prueba: muestra un selector de clima en Inicio para ver los 4 efectos
// sin esperar a la fecha. false = build de producción (capturas de tienda).
const DEV_WEATHER = true; // temporal mientras iteramos Juego en vivo
import { fmtTime, fmtSecs } from './src/format';
import { C, MONO, RD, RD_FONT, SECTOR_RESULT_COLORS } from './src/theme';
import DangerStripe from './src/DangerStripe';
import MiniRanking from './src/MiniRanking';
import MiniTrackMap from './src/MiniTrackMap';

const TRACKMAP_W = Dimensions.get('window').width - 18 * 2 - 14 * 2; // screenContent + panel
import {
  ensureSession, ensureDailyTrack, getLocalNickname, saveNickname, submitTime,
  listMyGroups, createGroup, joinGroup, bumpStreak, getMyStreak, notifyOvertakes,
  getLeaderboard, getGlobalBoard, getSectorBests, submitSectorSplits,
} from './src/api';
import { registerPushToken } from './src/push';
import { loadGhost, saveGhostIfBest } from './src/ghost';
import { loadAttempts, consumeAttempt, grantBatch, resetAttempts, attemptsLeft as calcLeft, AD_BATCH, FREE_ATTEMPTS } from './src/attempts';
import { PUSH_ENABLED, intentosTxt } from './src/features';
import { CONFIG } from './src/config';
import { initAds, showRewarded, isPrivacyOptionsRequired, showPrivacyOptions, getLastAdError } from './src/ads';
import ShareCard from './src/ShareCard';
import { shareCardImage } from './src/share';

const PAD = 50; // hueco superior (barra de estado oculta)

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
function fmtCountdown(ms) {
  const totalMin = Math.max(0, Math.ceil(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}min` : `${m} min`;
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
  const [ghost, setGhost] = useState(null); // { ms, trace } de tu mejor vuelta de hoy
  const [sectorBests, setSectorBests] = useState(null); // { [sector]: ms } mejor del mundo hoy

  const [forceWx, setForceWx] = useState(null); // id de clima forzado (modo prueba)
  const [att, setAtt] = useState({ used: 0, bonus: 0 }); // intentos del día
  const [unlocking, setUnlocking] = useState(false);     // viendo el anuncio
  const [adMsg, setAdMsg] = useState('');                // aviso si el anuncio no sale
  const [privacyOptional, setPrivacyOptional] = useState(false); // ¿mostrar "Privacidad de anuncios"?
  const left = calcLeft(att);
  const total = FREE_ATTEMPTS + (att?.bonus || 0);
  const daily = useMemo(() => dailyCircuit(todayKey()), []);
  const midnightLabel = useMidnightCountdown();
  const weather = useMemo(
    () => (forceWx ? weatherById(forceWx) : dailyWeather(todayKey())),
    [forceWx],
  );

  // Cargar el fantasma (tu mejor vuelta) del día + el mejor tiempo de cada
  // sector hoy entre todos (para el morado estilo F1 en el HUD de juego).
  useEffect(() => {
    loadGhost(todayKey()).then(setGhost).catch(() => {});
    getSectorBests(todayKey()).then(setSectorBests).catch(() => {});
  }, []);

  // Cargar los intentos del día + inicializar anuncios (y, tras el consentimiento,
  // saber si hay que ofrecer un punto para revisarlo/revocarlo más adelante).
  useEffect(() => {
    loadAttempts(todayKey()).then(setAtt).catch(() => {});
    initAds().then(() => isPrivacyOptionsRequired()).then(setPrivacyOptional).catch(() => {});
  }, []);

  // Consume un intento al empezar una vuelta.
  function startAttempt() {
    consumeAttempt(todayKey()).then(setAtt).catch(() => {});
  }

  // Ver anuncio (stub) → concede un lote de +3 intentos. Devuelve si fue OK.
  async function watchAdForMore() {
    if (unlocking) return false;
    setUnlocking(true);
    setAdMsg('');
    try {
      const ok = await showRewarded();
      if (!ok) {
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
      const a = await grantBatch(todayKey());
      setAtt(a);
      return true;
    } catch (_) {
      setAdMsg('No se ha podido cargar el anuncio. Prueba de nuevo en unos minutos.');
      return false;
    } finally {
      setUnlocking(false);
    }
  }

  // Intentar jugar: si hay intentos, a jugar; si no, ofrecer el anuncio.
  function tryPlay() {
    if (left > 0) setScreen('playing');
    else setScreen('nomore');
  }

  // Racha propia (para Inicio): al tener nickname y tras cada partida.
  useEffect(() => {
    if (!nickname) return;
    getMyStreak().then(setMyStreak).catch(() => {});
  }, [nickname, refreshKey]);

  // Registrar token de notificaciones una vez que hay nickname.
  useEffect(() => {
    if (PUSH_ENABLED && nickname) registerPushToken().catch(() => {});
  }, [nickname]);

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
      setScreen('home');
    } catch (e) {
      // Si falla la red, al menos deja jugar con el nombre local.
      setNickname(nick.trim().slice(0, 16));
      setScreen('home');
    }
  }

  async function handleFinish(ms, trace, sectorSplits, impacts, sectorColors, sectorDeltas) {
    setResult({ ms, isBest: false, submitting: true, impacts, sectorColors, sectorDeltas });
    setScreen('results');
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
      setResult({ ms, isBest, submitting: false, streak, impacts, sectorColors, sectorDeltas });
      if (PUSH_ENABLED && isBest) notifyOvertakes(ms, prevMs); // fire-and-forget: avisa a quien adelantaste
    } catch (e) {
      setResult({ ms, isBest: false, submitting: false, error: true, impacts, sectorColors, sectorDeltas });
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

  if (screen === 'groups') {
    return (
      <Groups
        onBack={() => setScreen('home')}
        onChanged={() => setRefreshKey((k) => k + 1)}
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
        attemptsLeft={left}
        onAttemptStart={startAttempt}
        onNeedMore={() => setScreen('nomore')}
        onFinish={handleFinish}
        onExit={() => setScreen('home')}
      />
    );
  }

  if (screen === 'nomore') {
    return (
      <NoMoreAttempts
        left={left}
        unlocking={unlocking}
        adMsg={adMsg}
        onWatchAd={async () => { const ok = await watchAdForMore(); if (ok) setScreen('playing'); }}
        onBack={() => { setAdMsg(''); setScreen('home'); }}
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
        attemptsLeft={left}
        total={total}
        refreshKey={refreshKey}
        onRetry={tryPlay}
        onHome={() => setScreen('home')}
      />
    );
  }

  // home
  return (
    <HomeRD
      nickname={nickname}
      myStreak={myStreak}
      daily={daily}
      weather={weather}
      midnightLabel={midnightLabel}
      left={left}
      total={total}
      refreshKey={refreshKey}
      tryPlay={tryPlay}
      onManageGroups={() => setScreen('groups')}
      privacyOptional={privacyOptional}
      forceWx={forceWx}
      setForceWx={setForceWx}
      setAtt={setAtt}
    />
  );
}

// ---------------------------------------------------------------------------
//  Inicio — dirección "Parrilla" (rediseño, ver Rediseño visual Apexly/).
// ---------------------------------------------------------------------------
function HomeRD({
  nickname, myStreak, daily, weather, midnightLabel, left, total, refreshKey,
  tryPlay, onManageGroups, privacyOptional, forceWx, setForceWx, setAtt,
}) {
  return (
    <ScrollView style={rd.screen} contentContainerStyle={rd.screenContent}>
      <StatusBar hidden />
      <DangerStripe height={6} />

      {myStreak?.current >= 1 && (
        <View style={rd.headerRow}>
          <View style={rd.streakChip}>
            <Text style={rd.streakChipText}>RACHA {myStreak.current}</Text>
          </View>
        </View>
      )}

      <View style={rd.panel}>
        <View style={rd.panelHeadRow}>
          <Text style={rd.labelMono}>CIRCUITO DE HOY</Text>
          <View style={rd.attBadge}>
            <Text style={rd.attBadgeText}>{Math.max(0, left)}/{total}</Text>
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

      <Pressable style={rd.cta} onPress={tryPlay}>
        <Text style={rd.ctaText}>{left > 0 ? 'Jugar' : `Ver anuncio · +${intentosTxt(AD_BATCH)}`}</Text>
      </Pressable>

      {DEV_WEATHER && (
        <View style={styles.devRow}>
          <Text style={styles.devLabel}>🧪 Clima (prueba)</Text>
          <View style={styles.devChips}>
            <DevChip label="Real" active={!forceWx} onPress={() => setForceWx(null)} />
            {WEATHER_IDS.map((id) => (
              <DevChip key={id} label={weatherById(id).icon} active={forceWx === id} onPress={() => setForceWx(id)} />
            ))}
          </View>
          <Pressable style={styles.devReset} onPress={() => resetAttempts(todayKey()).then(setAtt).catch(() => {})}>
            <Text style={styles.devResetText}>↺ Reiniciar intentos (ahora {left})</Text>
          </Pressable>
        </View>
      )}

      <Text style={rd.labelMono}>RANKING DE HOY</Text>
      <MiniRanking refreshKey={refreshKey} onManageGroups={onManageGroups} />

      {privacyOptional && (
        <Pressable style={rd.privacyLink} onPress={() => showPrivacyOptions()} hitSlop={8}>
          <Text style={rd.privacyLinkText}>Privacidad de anuncios</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const rd = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RD.bg },
  screenContent: { paddingHorizontal: 18, paddingTop: PAD, paddingBottom: 40, gap: 16 },

  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  streakChip: {
    borderWidth: 1, borderColor: RD.gold1st, borderRadius: 2, paddingHorizontal: 7, paddingVertical: 4,
  },
  streakChipText: { color: RD.gold1st, fontSize: 11, fontFamily: RD_FONT.monoBold },

  panel: { borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2, padding: 14, gap: 8 },
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

  cta: { backgroundColor: RD.brandOrange, borderRadius: 2, paddingVertical: 16, alignItems: 'center' },
  ctaDisabled: { opacity: 0.4 },
  ctaText: {
    color: RD.bg, fontSize: 22, fontFamily: RD_FONT.displayBlack,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },

  privacyLink: { alignItems: 'center', marginTop: 4, paddingVertical: 6 },
  privacyLinkText: { color: RD.textDisabled, fontSize: 12, fontFamily: RD_FONT.mono, textDecorationLine: 'underline' },

  resultTop: { alignItems: 'center', paddingTop: 6, gap: 8 },
  resultBadge: { borderRadius: 2, paddingHorizontal: 14, paddingVertical: 6 },
  resultBadgeText: { fontFamily: RD_FONT.monoBold, fontSize: 12, letterSpacing: 1 },
  resultNeutral: { color: RD.textSecondary, fontSize: 15, fontFamily: RD_FONT.mono },
  resultTime: { fontFamily: RD_FONT.monoBold, fontSize: 52, fontVariant: ['tabular-nums'] },
  trackMapBox: {
    width: '100%', borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    alignItems: 'center', justifyContent: 'center', paddingVertical: 8,
  },
  sectorSplitsRow: { flexDirection: 'row', justifyContent: 'center', gap: 24 },
  sectorSplitCol: { alignItems: 'center', gap: 2 },
  sectorSplitDivider: { width: 1, alignSelf: 'stretch', backgroundColor: RD.panelBorder },
  sectorSplitLabel: { color: RD.textDisabled, fontSize: 10, fontFamily: RD_FONT.mono, letterSpacing: 1 },
  sectorSplitValue: { fontSize: 14, fontFamily: RD_FONT.monoBold, fontVariant: ['tabular-nums'] },
  resultRank: { color: RD.textSecondary, fontSize: 14, fontFamily: RD_FONT.mono },
  resultCrash: { color: RD.textTertiary, fontSize: 12, fontFamily: RD_FONT.mono },
  resultBtnsRow: { flexDirection: 'row', gap: 10 },
  resultSecondaryBtn: {
    flex: 1, borderWidth: 1, borderColor: '#3a3a3a', borderRadius: 2,
    paddingVertical: 14, alignItems: 'center',
  },
  resultSecondaryBtnText: { color: RD.textPrimary, fontSize: 14, fontWeight: '700' },

  backLink: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono, marginBottom: 8 },
  pageTitle: {
    color: RD.textPrimary, fontSize: 28, fontFamily: RD_FONT.displayBlack,
    textTransform: 'uppercase', marginBottom: 4,
  },
  msgOk: { color: RD.successGreen, fontSize: 13, fontFamily: RD_FONT.mono },
  msgErr: { color: RD.dangerRed, fontSize: 13, fontFamily: RD_FONT.mono },
  input: {
    borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    paddingHorizontal: 12, paddingVertical: 10, color: RD.textPrimary, fontSize: 15,
    marginTop: 8, marginBottom: 10,
  },
  inputMono: { fontFamily: RD_FONT.mono, letterSpacing: 2, textTransform: 'uppercase' },
  secondaryBtnBig: { borderWidth: 1, borderColor: '#3a3a3a', borderRadius: 2, paddingVertical: 14, alignItems: 'center' },
  secondaryBtnBigText: { color: RD.textPrimary, fontSize: 14, fontWeight: '700' },
  muted: { color: RD.textTertiary, fontSize: 13, fontFamily: RD_FONT.mono, marginTop: 8 },

  groupsList: { gap: 1, backgroundColor: RD.gridLine },
  groupRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: RD.bg, paddingVertical: 10, paddingHorizontal: 12, gap: 10,
  },
  groupName: { color: RD.textPrimary, fontSize: 15, fontWeight: '700' },
  groupCode: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono, marginTop: 2 },
  inviteBtn: { borderWidth: 1, borderColor: RD.brandOrange, paddingHorizontal: 10, paddingVertical: 6 },
  inviteBtnText: { color: RD.brandOrange, fontSize: 11, fontFamily: RD_FONT.monoBold },
});

// ---------------------------------------------------------------------------
//  Grupos: crear / unirse por código / ver los míos.
// ---------------------------------------------------------------------------
function Groups({ onBack, onChanged }) {
  const [groups, setGroups] = useState(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { type:'ok'|'err', text }

  async function refresh() {
    try { setGroups(await listMyGroups()); } catch (e) { setGroups([]); }
  }
  useEffect(() => { refresh(); }, []);

  async function doCreate() {
    if (!name.trim() || busy) return;
    setBusy(true); setMsg(null);
    try {
      const g = await createGroup(name.trim());
      setName('');
      setMsg({ type: 'ok', text: `Grupo "${g.name}" creado. Código: ${g.join_code}` });
      await refresh(); onChanged && onChanged();
    } catch (e) {
      setMsg({ type: 'err', text: 'No se pudo crear el grupo.' });
    } finally { setBusy(false); }
  }

  async function shareInvite(g) {
    const msg =
      `Únete a mi grupo "${g.name}" en Apexly 🏁\n\n` +
      `Abre la app → Grupos → "Unirse con código" e introduce:\n${g.join_code}`;
    try { await Share.share({ message: msg }); } catch (_) {}
  }

  async function doJoin() {
    if (!code.trim() || busy) return;
    setBusy(true); setMsg(null);
    try {
      const g = await joinGroup(code.trim());
      setCode('');
      setMsg({ type: 'ok', text: `Te has unido a "${g.name}".` });
      await refresh(); onChanged && onChanged();
    } catch (e) {
      const notFound = String(e?.message || '').includes('GROUP_NOT_FOUND');
      setMsg({ type: 'err', text: notFound ? 'Ese código no existe.' : 'No se pudo unir al grupo.' });
    } finally { setBusy(false); }
  }

  return (
    <ScrollView style={rd.screen} contentContainerStyle={rd.screenContent}>
      <StatusBar hidden />
      <Pressable onPress={onBack} hitSlop={12}>
        <Text style={rd.backLink}>‹ INICIO</Text>
      </Pressable>
      <Text style={rd.pageTitle}>Grupos</Text>

      {msg && (
        <Text style={msg.type === 'ok' ? rd.msgOk : rd.msgErr}>{msg.text}</Text>
      )}

      <View style={rd.panel}>
        <Text style={rd.labelMono}>CREAR UN GRUPO</Text>
        <TextInput
          style={rd.input}
          value={name}
          onChangeText={setName}
          placeholder="Nombre del grupo"
          placeholderTextColor={RD.textDisabled}
          maxLength={24}
        />
        <Pressable style={[rd.cta, (!name.trim() || busy) && rd.ctaDisabled]} onPress={doCreate} disabled={!name.trim() || busy}>
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

      <Text style={rd.labelMono}>TUS GRUPOS</Text>
      {groups == null ? (
        <ActivityIndicator color={RD.brandOrange} style={{ marginTop: 12 }} />
      ) : groups.length === 0 ? (
        <Text style={rd.muted}>Aún no estás en ningún grupo. Crea uno y comparte el código.</Text>
      ) : (
        <View style={rd.groupsList}>
          {groups.map((g) => (
            <View key={g.id} style={rd.groupRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={rd.groupName} numberOfLines={1}>{g.name}</Text>
                <Text style={rd.groupCode}>CÓDIGO {g.join_code}</Text>
              </View>
              <Pressable style={rd.inviteBtn} onPress={() => shareInvite(g)} hitSlop={8}>
                <Text style={rd.inviteBtnText}>INVITAR</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
//  Sin intentos: ofrecer ver un anuncio para +3 (rewarded).
// ---------------------------------------------------------------------------
function NoMoreAttempts({ left, unlocking, adMsg, onWatchAd, onBack }) {
  return (
    <View style={styles.screen}>
      <StatusBar hidden />
      <View style={styles.onboardInner}>
        <Text style={styles.brand}>Sin intentos por hoy</Text>
        <Text style={styles.subtitle}>
          Has usado tus intentos gratis. Mira un anuncio y sigue intentando bajar tu tiempo — te da {intentosTxt(AD_BATCH)} más.
        </Text>
        <Pressable
          style={[styles.primaryBtn, unlocking && styles.primaryBtnDisabled]}
          disabled={unlocking}
          onPress={onWatchAd}
        >
          <Text style={styles.primaryBtnText}>{unlocking ? 'Cargando anuncio…' : `Ver anuncio · +${intentosTxt(AD_BATCH)}`}</Text>
        </Pressable>
        {!!adMsg && !unlocking && <Text style={styles.adMsg}>{adMsg}</Text>}
        <Pressable style={[styles.secondaryBtn, { marginTop: 12 }]} onPress={onBack}>
          <Text style={styles.secondaryBtnText}>Ahora no</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
//  Onboarding: pedir nickname (sin login).
// ---------------------------------------------------------------------------
function Onboarding({ onDone }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const ok = value.trim().length > 0;
  return (
    <View style={styles.screen}>
      <StatusBar hidden />
      <View style={styles.onboardInner}>
        <Text style={styles.brand}>Apexly</Text>
        <Text style={styles.subtitle}>¿Cómo te llamamos?</Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          placeholder="Tu nombre"
          placeholderTextColor={C.faint}
          maxLength={16}
          autoFocus
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={() => ok && onDone(value)}
        />
        <Pressable
          style={[styles.primaryBtn, !ok && styles.primaryBtnDisabled]}
          disabled={!ok || saving}
          onPress={() => { setSaving(true); onDone(value); }}
        >
          <Text style={styles.primaryBtnText}>{saving ? 'Guardando…' : 'Empezar'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
//  Resultado: tiempo + stats + tarjeta para compartir. Micro-recompensa si récord.
// ---------------------------------------------------------------------------
function Results({ result, label, track, weather, nickname, attemptsLeft = Infinity, total = 0, refreshKey, onRetry, onHome }) {
  const wx = weather || { icon: '', label: '' };
  const outOfAttempts = attemptsLeft <= 0;
  const cardRef = useRef(null);
  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const [standing, setStanding] = useState(null);      // global { rank, total, gapToLeaderMs }
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
        if (b.me) setStanding({ rank: b.me.rank, total: b.total, gapToLeaderMs: b.me.gapToLeaderMs });
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

  async function shareResult() {
    const parts = [`Apexly · ${dayShort()} ${wx.icon}`.trim(), fmtTime(result.ms)];
    if (standing) parts.push(`${standing.rank}.º de ${standing.total} · +${fmtSecs(standing.gapToLeaderMs)}s al líder`);
    parts.push('¿Me superas?');
    // Genera la imagen y la comparte (con vista previa); si no puede, texto.
    await shareCardImage(cardRef, parts.join('\n'));
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
          <MiniTrackMap track={track} w={TRACKMAP_W} h={80} />
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
                    <Text style={[rd.sectorSplitValue, { color: total <= 0 ? RD.successGreen : RD.dangerRed }]}>
                      {`${total <= 0 ? '−' : '+'}${(Math.abs(total) / 1000).toFixed(3)}s`}
                    </Text>
                  </View>
                </>
              )}
            </View>
          );
        })()}

        {standing && (
          <Text style={rd.resultRank}>{standing.rank}.º de {standing.total} en el mundo</Text>
        )}
        <Text style={rd.resultCrash}>
          {result.impacts ? `Te has chocado ${result.impacts} ${result.impacts === 1 ? 'vez' : 'veces'}` : 'Vuelta limpia — sin choques'}
        </Text>
      </View>

      <Pressable style={rd.cta} onPress={onRetry}>
        <Text style={rd.ctaText}>
          {outOfAttempts ? `Ver anuncio · +${intentosTxt(AD_BATCH)}` : `Reintentar (${attemptsLeft}/${total})`}
        </Text>
      </Pressable>

      <View style={rd.resultBtnsRow}>
        <Pressable style={rd.resultSecondaryBtn} onPress={shareResult}>
          <Text style={rd.resultSecondaryBtnText}>Compartir</Text>
        </Pressable>
        <Pressable style={rd.resultSecondaryBtn} onPress={onHome}>
          <Text style={rd.resultSecondaryBtnText}>Inicio</Text>
        </Pressable>
      </View>

      <Text style={[rd.labelMono, { marginTop: 4 }]}>RANKING DE HOY</Text>
      <MiniRanking refreshKey={refreshKey} showEntornoLabel={false} showTabs={false} />

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
        />
      </View>
    </ScrollView>
  );
}

// Badge con "brillo" (barra de luz que barre) para el mejor tiempo mundial.
function ShineBadge({ children, style }) {
  const x = useRef(new Animated.Value(-1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(x, { toValue: 1, duration: 1200, useNativeDriver: true }),
      Animated.timing(x, { toValue: -1, duration: 0, useNativeDriver: true }),
      Animated.delay(700),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  const translateX = x.interpolate({ inputRange: [-1, 1], outputRange: [-150, 150] });
  return (
    <View style={[style, styles.shineWrap]}>
      {children}
      <Animated.View
        pointerEvents="none"
        style={[styles.shineBar, { transform: [{ translateX }, { rotate: '20deg' }] }]}
      />
    </View>
  );
}

const DevChip = ({ label, active, onPress }) => (
  <Pressable onPress={onPress} style={[styles.devChip, active && styles.devChipOn]}>
    <Text style={[styles.devChipText, active && styles.devChipTextOn]}>{label}</Text>
  </Pressable>
);

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

  shineWrap: { overflow: 'hidden' },
  shineBar: { position: 'absolute', top: -10, bottom: -10, width: 26, backgroundColor: 'rgba(255,255,255,0.55)' },
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


  devRow: { marginTop: 16, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line, borderStyle: 'dashed' },
  devLabel: { color: C.faint, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 },
  devChips: { flexDirection: 'row', gap: 8 },
  devChip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: C.card2, borderWidth: 1, borderColor: C.line },
  devChipOn: { backgroundColor: C.card, borderColor: C.hot },
  devChipText: { color: C.dim, fontSize: 15, fontWeight: '700' },
  devChipTextOn: { color: C.ink },
  devReset: { marginTop: 10, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: C.card2, borderWidth: 1, borderColor: C.line },
  devResetText: { color: C.dim, fontSize: 13, fontWeight: '700' },

  privacyLink: { alignItems: 'center', marginTop: 20, paddingVertical: 6 },
  privacyLinkText: { color: C.faint, fontSize: 12, fontWeight: '600', textDecorationLine: 'underline' },

  errTitle: { color: C.ink, fontSize: 22, fontWeight: '800', marginBottom: 6 },
  errSub: { color: C.dim, fontSize: 14, textAlign: 'center', marginBottom: 20 },
});

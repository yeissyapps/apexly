// ============================================================================
//  Circuito Diario — App.  Dirección de arte "A refinada" (oscuro moderno).
//
//  Router de pantallas: carga sesión anónima -> onboarding (nickname la 1.ª vez)
//  -> Inicio (circuito del día + ranking del grupo) -> Juego -> Resultado.
//  El juego (física/cámara/colisión/piezas) vive en src/Game.js sin tocar.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Pressable, ScrollView, Share, StyleSheet, Text,
  TextInput, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';

import Game from './src/Game';
import Leaderboard from './src/Leaderboard';
import { todayKey } from './src/daily';
import { dailyCircuit } from './src/generator';
import { dailyWeather, weatherById, WEATHER_IDS } from './src/weather';

// Modo de prueba: muestra un selector de clima en Inicio para ver los 4 efectos
// sin esperar a la fecha. Poner en false (o borrar) antes de publicar.
const DEV_WEATHER = true;
import { fmtTime, fmtSecs } from './src/format';
import { C, MONO } from './src/theme';
import {
  ensureSession, ensureDailyTrack, getLocalNickname, saveNickname, submitTime,
  listMyGroups, createGroup, joinGroup, bumpStreak, getMyStreak, notifyOvertakes,
  getLeaderboard,
} from './src/api';
import { registerPushToken } from './src/push';
import { loadGhost, saveGhostIfBest } from './src/ghost';
import { loadAttempts, consumeAttempt, grantBatch, resetAttempts, attemptsLeft as calcLeft, AD_BATCH, FREE_ATTEMPTS } from './src/attempts';
import { initAds, showRewarded } from './src/ads';
import ShareCard from './src/ShareCard';
import { shareCardImage } from './src/share';

const PAD = 50; // hueco superior (barra de estado oculta)

// Fecha corta "DD·MM" para tarjetas.
function dayShort() {
  const [, m, d] = todayKey().split('-');
  return `${d}·${m}`;
}

export default function App() {
  const [screen, setScreen] = useState('loading'); // loading|error|onboarding|home|playing|results
  const [nickname, setNickname] = useState(null);
  const [result, setResult] = useState(null); // { ms, isBest, submitting, error }
  const [refreshKey, setRefreshKey] = useState(0);
  const [retry, setRetry] = useState(0);
  const [myStreak, setMyStreak] = useState(null);
  const [ghost, setGhost] = useState(null); // { ms, trace } de tu mejor vuelta de hoy

  const [forceWx, setForceWx] = useState(null); // id de clima forzado (modo prueba)
  const [att, setAtt] = useState({ used: 0, bonus: 0 }); // intentos del día
  const [unlocking, setUnlocking] = useState(false);     // viendo el anuncio
  const left = calcLeft(att);
  const total = FREE_ATTEMPTS + (att?.bonus || 0);
  const daily = useMemo(() => dailyCircuit(todayKey()), []);
  const weather = useMemo(
    () => (forceWx ? weatherById(forceWx) : dailyWeather(todayKey())),
    [forceWx],
  );

  // Cargar el fantasma (tu mejor vuelta) del día.
  useEffect(() => {
    loadGhost(todayKey()).then(setGhost).catch(() => {});
  }, []);

  // Cargar los intentos del día + inicializar anuncios.
  useEffect(() => {
    loadAttempts(todayKey()).then(setAtt).catch(() => {});
    initAds();
  }, []);

  // Consume un intento al empezar una vuelta.
  function startAttempt() {
    consumeAttempt(todayKey()).then(setAtt).catch(() => {});
  }

  // Ver anuncio (stub) → concede un lote de +3 intentos. Devuelve si fue OK.
  async function watchAdForMore() {
    if (unlocking) return false;
    setUnlocking(true);
    try {
      const ok = await showRewarded();
      if (!ok) return false;
      const a = await grantBatch(todayKey());
      setAtt(a);
      return true;
    } catch (_) {
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
    if (nickname) registerPushToken().catch(() => {});
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

  async function handleFinish(ms, trace) {
    setResult({ ms, isBest: false, submitting: true });
    setScreen('results');
    // Guarda tu mejor vuelta (fantasma) en el móvil.
    saveGhostIfBest(todayKey(), ms, trace).then((g) => { if (g) setGhost(g); }).catch(() => {});
    try {
      const { isBest, prevMs } = await submitTime(ms);
      let streak = null;
      try { streak = await bumpStreak(); } catch (_) {}
      setResult({ ms, isBest, submitting: false, streak });
      if (isBest) notifyOvertakes(ms, prevMs); // fire-and-forget: avisa a quien adelantaste
    } catch (e) {
      setResult({ ms, isBest: false, submitting: false, error: true });
    }
    setRefreshKey((k) => k + 1);
  }

  if (screen === 'loading') {
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
        onWatchAd={async () => { const ok = await watchAdForMore(); if (ok) setScreen('playing'); }}
        onBack={() => setScreen('home')}
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
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      <StatusBar hidden />
      <View style={styles.homeHeader}>
        <Text style={styles.hi}>Hola, {nickname}</Text>
        {myStreak?.current >= 1 && (
          <View style={styles.streakChip}>
            <View style={styles.streakDot} />
            <Text style={styles.streakChipText}>Racha {myStreak.current}</Text>
          </View>
        )}
      </View>

      <View style={styles.trackCard}>
        <View style={[styles.attBadge, left <= 0 && styles.attBadgeEmpty]}>
          <Text style={[styles.attBadgeText, left <= 0 && styles.attBadgeTextEmpty]}>
            Intentos {Math.max(0, left)}/{total}
          </Text>
        </View>
        <Text style={styles.trackLabel}>Circuito de hoy</Text>
        <Text style={styles.trackName}>{daily.label}</Text>
        <Text style={styles.trackDesc}>Generado para hoy · ~{Math.round(daily.timeEstimate)}s limpio</Text>
        <View style={styles.wxRow}>
          <Text style={styles.wxIcon}>{weather.icon}</Text>
          <Text style={styles.wxRowText}>
            <Text style={styles.wxRowLabel}>{weather.label}</Text> · {weather.hint}
          </Text>
        </View>
        {ghost && (
          <View style={styles.trackBest}>
            <Text style={styles.trackBestK}>Tu mejor hoy</Text>
            <Text style={styles.trackBestV}>{fmtTime(ghost.ms)}</Text>
          </View>
        )}
      </View>

      <Pressable style={styles.primaryBtn} onPress={tryPlay}>
        <Text style={styles.primaryBtnText}>{left > 0 ? 'Jugar' : `Ver anuncio · +${AD_BATCH} intentos`}</Text>
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

      <View style={{ height: 24 }} />
      <Leaderboard refreshKey={refreshKey} onManageGroups={() => setScreen('groups')} />
    </ScrollView>
  );
}

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
      `Únete a mi grupo "${g.name}" en Circuito Diario 🏁\n\n` +
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
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      <StatusBar hidden />
      <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn}>
        <Text style={styles.backText}>‹ Inicio</Text>
      </Pressable>
      <Text style={styles.hi}>Grupos</Text>

      {msg && (
        <Text style={msg.type === 'ok' ? styles.msgOk : styles.msgErr}>{msg.text}</Text>
      )}

      <View style={styles.trackCard}>
        <Text style={styles.trackLabel}>Crear un grupo</Text>
        <TextInput
          style={styles.input2}
          value={name}
          onChangeText={setName}
          placeholder="Nombre del grupo"
          placeholderTextColor={C.faint}
          maxLength={24}
        />
        <Pressable style={[styles.primaryBtn, (!name.trim() || busy) && styles.primaryBtnDisabled]} onPress={doCreate} disabled={!name.trim() || busy}>
          <Text style={styles.primaryBtnText}>Crear</Text>
        </Pressable>
      </View>

      <View style={styles.trackCard}>
        <Text style={styles.trackLabel}>Unirse con código</Text>
        <TextInput
          style={styles.input2}
          value={code}
          onChangeText={setCode}
          placeholder="Código (p. ej. A1B2C3)"
          placeholderTextColor={C.faint}
          autoCapitalize="characters"
          maxLength={6}
        />
        <Pressable style={[styles.secondaryBtn, (!code.trim() || busy) && styles.primaryBtnDisabled]} onPress={doJoin} disabled={!code.trim() || busy}>
          <Text style={styles.secondaryBtnText}>Unirme</Text>
        </Pressable>
      </View>

      <Text style={styles.trackLabel}>Tus grupos</Text>
      {groups == null ? (
        <ActivityIndicator color={C.hot} style={{ marginTop: 12 }} />
      ) : groups.length === 0 ? (
        <Text style={styles.muted2}>Aún no estás en ningún grupo. Crea uno y comparte el código.</Text>
      ) : (
        groups.map((g) => (
          <View key={g.id} style={styles.groupRow}>
            <View style={styles.groupInfo}>
              <Text style={styles.groupName} numberOfLines={1}>{g.name}</Text>
              <Text style={styles.groupCode}>Código: {g.join_code}</Text>
            </View>
            <Pressable style={styles.inviteBtn} onPress={() => shareInvite(g)} hitSlop={8}>
              <Text style={styles.inviteBtnText}>Invitar</Text>
            </Pressable>
          </View>
        ))
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
//  Sin intentos: ofrecer ver un anuncio para +3 (rewarded).
// ---------------------------------------------------------------------------
function NoMoreAttempts({ left, unlocking, onWatchAd, onBack }) {
  return (
    <View style={styles.screen}>
      <StatusBar hidden />
      <View style={styles.onboardInner}>
        <Text style={styles.brand}>Sin intentos por hoy</Text>
        <Text style={styles.subtitle}>
          Has usado tus intentos gratis. Mira un anuncio y sigue intentando bajar tu tiempo — te da {AD_BATCH} intentos más.
        </Text>
        <Pressable
          style={[styles.primaryBtn, unlocking && styles.primaryBtnDisabled]}
          disabled={unlocking}
          onPress={onWatchAd}
        >
          <Text style={styles.primaryBtnText}>{unlocking ? 'Cargando anuncio…' : `Ver anuncio · +${AD_BATCH} intentos`}</Text>
        </Pressable>
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
        <Text style={styles.brand}>Circuito Diario</Text>
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
  const timeColor = vibe === 'global' ? C.gold : vibe === 'group' ? C.purple : vibe === 'best' ? C.green : C.gold;
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
    getLeaderboard('global')
      .then((rows) => {
        if (!alive) return;
        const me = rows.find((r) => r.isMe);
        if (me) setStanding({ rank: me.rank, total: rows.length, gapToLeaderMs: me.gapToLeaderMs });
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
    const parts = [`Circuito Diario · ${dayShort()} ${wx.icon}`.trim(), fmtTime(result.ms)];
    if (standing) parts.push(`${standing.rank}.º de ${standing.total} · +${fmtSecs(standing.gapToLeaderMs)}s al líder`);
    parts.push('¿Me superas?');
    // Genera la imagen y la comparte (con vista previa); si no puede, texto.
    await shareCardImage(cardRef, parts.join('\n'));
  }

  const banner =
    vibe === 'global' ? { text: '◆  MEJOR TIEMPO MUNDIAL  ◆', style: styles.badgeGlobal, txt: styles.badgeGlobalTxt } :
    vibe === 'group' ? { text: '★ 1.º DE TU GRUPO', style: styles.badgeGroup, txt: styles.badgeGroupTxt } :
    vibe === 'best' ? { text: '★ NUEVO RÉCORD', style: styles.badgeBest, txt: styles.badgeBestTxt } :
    null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      <StatusBar hidden />

      <View style={styles.resultTop}>
        {banner ? (
          vibe === 'global' ? (
            <Animated.View style={{ opacity, transform: [{ scale }] }}>
              <ShineBadge style={banner.style}><Text style={banner.txt}>{banner.text}</Text></ShineBadge>
            </Animated.View>
          ) : (
            <Animated.View style={[banner.style, { opacity, transform: [{ scale }] }]}>
              <Text style={banner.txt}>{banner.text}</Text>
            </Animated.View>
          )
        ) : (
          <Text style={styles.resultNeutral}>{result.submitting ? 'Guardando…' : 'Buen intento'}</Text>
        )}
        <Text style={[styles.resultTime, { color: timeColor }]}>{fmtTime(result.ms)}</Text>
        <Text style={styles.resultTrack}>{wx.icon} {label}</Text>
        {standing && (
          <Text style={styles.resultRank}>
            {standing.rank}.º de {standing.total} en el mundo
          </Text>
        )}
      </View>

      <Pressable style={styles.primaryBtn} onPress={onRetry}>
        <Text style={styles.primaryBtnText}>
          {outOfAttempts ? `Ver anuncio · +${AD_BATCH} intentos` : `Reintentar (${attemptsLeft}/${total})`}
        </Text>
      </Pressable>

      <View style={styles.resultBtns}>
        <Pressable style={[styles.secondaryBtn, styles.flex1]} onPress={shareResult}>
          <Text style={styles.secondaryBtnText}>Compartir</Text>
        </Pressable>
        <Pressable style={[styles.secondaryBtn, styles.flex1]} onPress={onHome}>
          <Text style={styles.secondaryBtnText}>Inicio</Text>
        </Pressable>
      </View>

      <View style={{ height: 22 }} />
      <Leaderboard refreshKey={refreshKey} />

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
  hi: { color: C.ink, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  streakChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: C.card,
    borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6,
  },
  streakDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.gold },
  streakChipText: { color: C.ink, fontSize: 13, fontWeight: '700' },

  trackCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 18, marginBottom: 16 },
  trackLabel: { color: C.dim, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
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

  // --- Grupos ---
  backBtn: { marginBottom: 6 },
  backText: { color: C.dim, fontSize: 16, fontWeight: '700' },
  msgOk: { color: C.green, fontSize: 14, marginBottom: 12 },
  msgErr: { color: C.hot, fontSize: 14, marginBottom: 12 },
  input2: {
    backgroundColor: C.card2, borderWidth: 1, borderColor: C.line, borderRadius: 12, color: C.ink, fontSize: 18,
    fontWeight: '700', paddingHorizontal: 14, paddingVertical: 12, marginTop: 10, marginBottom: 12,
  },
  muted2: { color: C.dim, fontSize: 14, marginTop: 10 },
  groupRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, marginTop: 8,
  },
  groupInfo: { flex: 1, marginRight: 12 },
  groupName: { color: C.ink, fontSize: 17, fontWeight: '700' },
  groupCode: { color: C.gold, fontSize: 13, fontWeight: '800', letterSpacing: 1, fontFamily: MONO, fontVariant: ['tabular-nums'], marginTop: 2 },
  inviteBtn: { backgroundColor: C.hot, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  inviteBtnText: { color: C.hotInk, fontSize: 14, fontWeight: '800' },

  primaryBtn: { backgroundColor: C.green, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { color: '#04160b', fontSize: 17, fontWeight: '800' },
  secondaryBtn: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line2, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  secondaryBtnText: { color: C.ink, fontSize: 16, fontWeight: '700' },
  flex1: { flex: 1 },

  resultTop: { alignItems: 'center', paddingTop: 10, paddingBottom: 18 },
  resultNeutral: { color: C.dim, fontSize: 16, fontWeight: '700', marginBottom: 12 },
  resultTime: {
    fontSize: 56, fontWeight: '800', fontFamily: MONO, fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 14,
  },
  resultTrack: { color: C.dim, fontSize: 15, marginTop: 6 },
  resultRank: { color: C.dim, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 6 },

  badgeBest: { backgroundColor: 'rgba(67,224,138,0.16)', borderWidth: 1, borderColor: 'rgba(67,224,138,0.40)', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7, marginBottom: 12 },
  badgeBestTxt: { color: C.green, fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  badgeGroup: { backgroundColor: 'rgba(184,132,255,0.16)', borderWidth: 1, borderColor: 'rgba(184,132,255,0.40)', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7, marginBottom: 12 },
  badgeGroupTxt: { color: C.purple, fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  badgeGlobal: { backgroundColor: 'rgba(255,184,77,0.18)', borderWidth: 1, borderColor: 'rgba(255,184,77,0.55)', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8, marginBottom: 12 },
  badgeGlobalTxt: { color: C.gold, fontSize: 14, fontWeight: '900', letterSpacing: 1 },
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

  resultBtns: { flexDirection: 'row', gap: 12, marginTop: 12 },
  resultStreak: { color: C.gold, fontSize: 14, fontWeight: '700', marginTop: 14, textAlign: 'center' },

  devRow: { marginTop: 16, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line, borderStyle: 'dashed' },
  devLabel: { color: C.faint, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 },
  devChips: { flexDirection: 'row', gap: 8 },
  devChip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: C.card2, borderWidth: 1, borderColor: C.line },
  devChipOn: { backgroundColor: C.card, borderColor: C.hot },
  devChipText: { color: C.dim, fontSize: 15, fontWeight: '700' },
  devChipTextOn: { color: C.ink },
  devReset: { marginTop: 10, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: C.card2, borderWidth: 1, borderColor: C.line },
  devResetText: { color: C.dim, fontSize: 13, fontWeight: '700' },

  errTitle: { color: C.ink, fontSize: 22, fontWeight: '800', marginBottom: 6 },
  errSub: { color: C.dim, fontSize: 14, textAlign: 'center', marginBottom: 20 },
});

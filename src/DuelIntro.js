// ============================================================================
//  DuelIntro — la pantalla de enfrentamiento que se ve ANTES de correr un 1
//  vs 1 (JC, 2026-09-19): los dos avatares cara a cara en diagonal, con el
//  nombre de cada uno y sus stats hacia abajo, y solo entonces el botón de
//  correr. Antes, al aceptar (o al abrir un duelo aceptado) se caía directo
//  a la carrera y no se veía contra quién ni por cuánto.
//
//  Va la primera vez que se entra a correr un duelo; los reintentos del
//  mismo duelo (anuncio para un intento más) no la repiten, siguen dentro de
//  la carrera.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Dimensions, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import DangerStripe from './DangerStripe';
import AvatarThumb from './AvatarThumb';
import CoinIcon from './CoinIcon';
import { getDuelMatchup } from './api';
import { fmtTime } from './format';
import { RD, RD_FONT } from './theme';

const STAGE_W = Dimensions.get('window').width - 36;
const STAGE_H = 340;
const AVATAR = 138;

// Quién gana cada fila: 'a' | 'b' | null (empate o dato que falta).
function better(a, b, lowerWins) {
  if (a == null || b == null || a === b) return null;
  return (lowerWins ? a < b : a > b) ? 'a' : 'b';
}

function buildRows(me, rival) {
  return [
    { label: 'MEJOR TIEMPO', a: me.bestMs != null ? fmtTime(me.bestMs) : '—', b: rival.bestMs != null ? fmtTime(rival.bestMs) : '—', win: better(me.bestMs, rival.bestMs, true) },
    { label: 'DÍAS CORRIDOS', a: String(me.days), b: String(rival.days), win: better(me.days, rival.days, false) },
    { label: 'RACHA', a: String(me.streak), b: String(rival.streak), win: better(me.streak, rival.streak, false) },
    { label: '1.º DEL MUNDO', a: `×${me.wins}`, b: `×${rival.wins}`, win: better(me.wins, rival.wins, false) },
  ];
}

export default function DuelIntro({ duelId, onBack, onStart }) {
  const [data, setData] = useState(undefined); // undefined = cargando, null = no existe / sin red
  const [ctaReady, setCtaReady] = useState(false);

  const enterMe = useRef(new Animated.Value(0)).current;
  const enterRival = useRef(new Animated.Value(0)).current;
  const line = useRef(new Animated.Value(0)).current;
  const vs = useRef(new Animated.Value(0)).current;
  const rowAnims = useRef([0, 1, 2, 3].map(() => new Animated.Value(0))).current;
  const cta = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let alive = true;
    getDuelMatchup(duelId).then((d) => alive && setData(d)).catch(() => alive && setData(null));
    return () => { alive = false; };
  }, [duelId]);

  const active = data && data.duel.status === 'accepted';

  useEffect(() => {
    if (!active) return undefined;
    const fade = (v, delay, duration = 320) => Animated.timing(v, {
      toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    const anim = Animated.parallel([
      fade(enterMe, 0, 560),
      fade(enterRival, 140, 560),
      fade(line, 480, 360),
      Animated.sequence([
        Animated.delay(780),
        Animated.spring(vs, { toValue: 1, friction: 5, tension: 150, useNativeDriver: true }),
      ]),
      ...rowAnims.map((v, i) => fade(v, 1050 + i * 150)),
      fade(cta, 1050 + rowAnims.length * 150 + 150),
    ]);
    anim.start(({ finished }) => { if (finished) setCtaReady(true); });
    return () => anim.stop();
  }, [active]);

  if (data === undefined) {
    return (
      <View style={s.screen}>
        <DangerStripe height={6} />
        <View style={s.centerMsg}><ActivityIndicator color={RD.brand} /></View>
      </View>
    );
  }

  if (!data || !active) {
    return (
      <View style={s.screen}>
        <DangerStripe height={6} />
        <View style={s.centerMsg}>
          <Text style={s.centerMsgText}>
            {data ? 'Este 1 vs 1 ya no está en juego.' : 'No se pudo cargar el 1 vs 1.'}
          </Text>
          <Pressable onPress={onBack} hitSlop={12}><Text style={s.backLink}>‹ VOLVER</Text></Pressable>
        </View>
      </View>
    );
  }

  const { duel, sides } = data;
  const meIdx = sides[0].userId === duel.myId ? 0 : 1;
  const me = sides[meIdx];
  const rival = sides[1 - meIdx];
  const rows = buildRows(me, rival);
  const mins = duel.raceDeadline
    ? Math.max(1, Math.ceil((new Date(duel.raceDeadline).getTime() - Date.now()) / 60000))
    : null;

  const slide = (v, dx, dy) => ({
    opacity: v,
    transform: [
      { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [dx, 0] }) },
      { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [dy, 0] }) },
    ],
  });

  return (
    <View style={s.screen}>
      <DangerStripe height={6} />
      <Pressable onPress={onBack} hitSlop={12}><Text style={s.backLink}>‹ INICIO</Text></Pressable>

      <View style={s.content}>
        <View style={s.wagerCard}>
          <CoinIcon size={18} />
          <Text style={s.wagerAmount}>{duel.wager}</Text>
          <Text style={s.wagerLabel}>cada uno · gana el mejor tiempo</Text>
        </View>

        <View style={s.stage}>
          <Animated.View style={[s.lineWrap, { opacity: line, transform: [{ scaleX: line }, { rotate: '-21deg' }] }]}>
            <View style={s.line} />
          </Animated.View>

          <Animated.View style={[s.fighter, s.fighterMe, slide(enterMe, -STAGE_W * 0.8, -80)]}>
            <AvatarThumb pilotAvatarId={me.avatarId} size={AVATAR} />
            <Text style={s.name} numberOfLines={1}>{me.nickname}</Text>
            <Text style={s.tag}>TÚ</Text>
          </Animated.View>

          <Animated.View style={[s.fighter, s.fighterRival, slide(enterRival, STAGE_W * 0.8, 80)]}>
            <AvatarThumb pilotAvatarId={rival.avatarId} size={AVATAR} />
            <Text style={s.name} numberOfLines={1}>{rival.nickname}</Text>
            <Text style={s.tag}>RIVAL</Text>
          </Animated.View>

          <Animated.View style={[s.vsBadge, { opacity: vs, transform: [{ scale: vs }] }]}>
            <Text style={s.vsText}>VS</Text>
          </Animated.View>
        </View>

        <View style={s.stats}>
          {rows.map((r, i) => (
            <Animated.View
              key={r.label}
              style={[
                s.statRow,
                {
                  opacity: rowAnims[i],
                  transform: [{ translateY: rowAnims[i].interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
                },
              ]}
            >
              <Text style={[s.statVal, s.statValLeft, r.win === 'a' && s.statWin]}>{r.a}</Text>
              <Text style={s.statLabel}>{r.label}</Text>
              <Text style={[s.statVal, s.statValRight, r.win === 'b' && s.statWin]}>{r.b}</Text>
            </Animated.View>
          ))}
        </View>

        <Animated.View style={[s.ctaWrap, { opacity: cta }]}>
          {mins != null && <Text style={s.deadline}>Te quedan {mins} min para correr</Text>}
          <Pressable style={s.ctaBtn} onPress={onStart} disabled={!ctaReady}>
            <Text style={s.ctaBtnText}>CORRER</Text>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RD.bg, paddingTop: 50 },
  backLink: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono, marginLeft: 18, marginBottom: 8 },
  centerMsg: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 24 },
  centerMsgText: { color: RD.textSecondary, fontSize: 14, fontFamily: RD_FONT.mono, textAlign: 'center' },
  content: { flex: 1, paddingHorizontal: 18, gap: 14 },

  wagerCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: RD.gold1st, borderRadius: 2,
    backgroundColor: RD.gold1stShade, paddingVertical: 10, paddingHorizontal: 14,
  },
  wagerAmount: { color: RD.gold1st, fontSize: 20, fontFamily: RD_FONT.monoBold },
  wagerLabel: { color: RD.gold1st, fontSize: 11, fontFamily: RD_FONT.mono },

  stage: { width: STAGE_W, height: STAGE_H, alignSelf: 'center' },
  lineWrap: { position: 'absolute', left: -STAGE_W * 0.08, top: STAGE_H / 2 - 1.5, width: STAGE_W * 1.16, height: 3 },
  line: { flex: 1, backgroundColor: RD.brand },
  fighter: { position: 'absolute', width: AVATAR, alignItems: 'center', gap: 2 },
  fighterMe: { left: 0, top: 0 },
  fighterRival: { right: 0, bottom: 0 },
  name: { color: RD.textPrimary, fontSize: 17, fontFamily: RD_FONT.displayBlack, textTransform: 'uppercase', maxWidth: AVATAR + 24 },
  tag: { color: RD.textTertiary, fontSize: 10, fontFamily: RD_FONT.monoBold, letterSpacing: 1.4 },
  vsBadge: {
    position: 'absolute', left: STAGE_W / 2 - 25, top: STAGE_H / 2 - 25, width: 50, height: 50,
    borderRadius: 25, backgroundColor: RD.bg, borderWidth: 2, borderColor: RD.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  vsText: { color: RD.brand, fontSize: 17, fontFamily: RD_FONT.displayBlack },

  stats: { borderTopWidth: 1, borderTopColor: RD.panelBorder },
  statRow: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: RD.gridLine, paddingVertical: 9,
  },
  statVal: { flex: 1, color: RD.textSecondary, fontSize: 15, fontFamily: RD_FONT.monoBold, fontVariant: ['tabular-nums'] },
  statValLeft: { textAlign: 'left' },
  statValRight: { textAlign: 'right' },
  statWin: { color: RD.successGreen },
  statLabel: { color: RD.textTertiary, fontSize: 10, fontFamily: RD_FONT.mono, letterSpacing: 1, paddingHorizontal: 8 },

  ctaWrap: { gap: 8, marginTop: 4 },
  deadline: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono, textAlign: 'center' },
  ctaBtn: { backgroundColor: RD.brand, borderRadius: 2, paddingVertical: 16, alignItems: 'center' },
  ctaBtnText: { color: RD.bg, fontSize: 16, fontFamily: RD_FONT.displayBlack, letterSpacing: 0.6 },
});

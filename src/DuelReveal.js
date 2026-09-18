// ============================================================================
//  DuelReveal — el "reveal" del duelo: los DOS fantasmas corriendo lado a
//  lado, ahora sí a la vista, ya que los dos han terminado (nadie los vio
//  correr mientras corrían — ver duels.sql).
//
//  Reutiliza piezas YA EXISTENTES de Game.js sin tocar su comportamiento
//  (TrackLayer/trackPalette/ghostPoseAt, exportadas para esto): esta
//  pantalla no es "otro visor", es la MISMA pista y el MISMO interpolador
//  de traza que ya usa el fantasma del líder — solo con cámara fija
//  (encuadra la pista entera) en vez de la cámara persecutoria del juego en
//  vivo, porque aquí no hay "tu coche" al que seguir, hay dos.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { G } from 'react-native-svg';

import DangerStripe from './DangerStripe';
import CarSprite from './CarSprite';
import CoinIcon from './CoinIcon';
import { TrackLayer, trackPalette, ghostPoseAt } from './Game';
import { tieredCircuit } from './generator';
import { getDuelReveal } from './api';
import { fmtTime } from './format';
import { RD, RD_FONT } from './theme';

const { width: winW } = Dimensions.get('window');
const STAGE_H = 360;
const STAGE_PAD = 24; // margen de mundo alrededor de la pista para que no toque el borde

function trackBBox(track) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of track.roadPolygon) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export default function DuelReveal({ duelId, myId, onBack, onRematch }) {
  const [data, setData] = useState(null);   // null mientras carga, false si aún no está listo
  const [poses, setPoses] = useState(null); // { a:{x,y,h}, b:{x,y,h} }
  const aIdxRef = useRef(0);
  const bIdxRef = useRef(0);
  const startRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    let alive = true;
    getDuelReveal(duelId).then((d) => { if (alive) setData(d ?? false); }).catch(() => alive && setData(false));
    return () => { alive = false; };
  }, [duelId]);

  // Mismo generador que la carrera de verdad (ver duel-race en App.js) — la
  // semilla es el propio id del duelo, así que los dos clientes reconstruyen
  // el circuito idéntico sin que el servidor lo guarde en ningún sitio.
  const track = useMemo(() => tieredCircuit(duelId, 0.5).track, [duelId]);
  const palette = useMemo(() => trackPalette(track), [track]);
  const bbox = useMemo(() => trackBBox(track), [track]);

  useEffect(() => {
    if (!data) return undefined;
    startRef.current = null;
    aIdxRef.current = 0;
    bIdxRef.current = 0;
    // Los dos coches terminan en algún punto — sin este tope, ghostPoseAt
    // se queda devolviendo el último punto para siempre y el bucle seguía
    // llamando a setPoses en CADA frame, para siempre, aunque ya no hubiera
    // nada moviéndose en pantalla (un objeto nuevo cada vez, así que React
    // sí volvía a renderizar 60 veces/segundo sin fin mientras esta
    // pantalla estuviera montada). 400ms de margen tras el más lento para
    // que se le vea cruzar meta y asentarse antes de parar del todo.
    const durationA = data.challenger.trace[data.challenger.trace.length - 1]?.[0] ?? 0;
    const durationB = data.opponent.trace[data.opponent.trace.length - 1]?.[0] ?? 0;
    const stopAt = Math.max(durationA, durationB) + 400;
    function frame(t) {
      if (startRef.current == null) startRef.current = t;
      const elapsed = t - startRef.current;
      setPoses({
        a: ghostPoseAt(data.challenger.trace, elapsed, aIdxRef),
        b: ghostPoseAt(data.opponent.trace, elapsed, bIdxRef),
      });
      if (elapsed >= stopAt) return; // ya cruzaron los dos — no se reprograma más
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [data]);

  if (data === false) {
    return (
      <View style={s.screen}>
        <DangerStripe height={6} />
        <View style={s.centerMsg}>
          <Text style={s.centerMsgText}>Este duelo todavía no tiene las dos vueltas.</Text>
          <Pressable onPress={onBack} hitSlop={12}>
            <Text style={s.backLink}>‹ VOLVER</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  if (!data) return <View style={s.screen}><DangerStripe height={6} /></View>;

  const scale = Math.min(
    (winW - STAGE_PAD * 2) / (bbox.w || 1),
    (STAGE_H - STAGE_PAD * 2) / (bbox.h || 1)
  );
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  const camTransform = `translate(${winW / 2} ${STAGE_H / 2}) scale(${scale}) translate(${-cx} ${-cy})`;

  const iWon = data.winnerId === myId;
  const tie = data.winnerId == null;
  const resultLabel = tie ? 'EMPATE — SE DEVUELVE LA APUESTA' : iWon ? `GANAS · +${data.wager * 2}` : 'PIERDES';
  const rival = data.challenger.userId === myId ? data.opponent : data.challenger;

  return (
    <View style={s.screen}>
      <DangerStripe height={6} />
      <Pressable onPress={onBack} hitSlop={12}>
        <Text style={s.backLink}>‹ INICIO</Text>
      </Pressable>
      <Text style={s.pageTitle}>Duelo</Text>

      <View style={s.stage}>
        <Svg width={winW} height={STAGE_H} viewBox={`0 0 ${winW} ${STAGE_H}`}>
          <G transform={camTransform}>
            <TrackLayer track={track} showDebug={false} wet={false} palette={palette} />
            {poses?.a && (
              <CarSprite x={poses.a.x} y={poses.a.y} deg={(poses.a.h * 180) / Math.PI} loadout={data.challenger.loadout} />
            )}
            {poses?.b && (
              <CarSprite x={poses.b.x} y={poses.b.y} deg={(poses.b.h * 180) / Math.PI} loadout={data.opponent.loadout} />
            )}
          </G>
        </Svg>
      </View>

      <View style={s.resultCard}>
        <Text style={[s.resultLabel, tie ? s.resultTie : iWon ? s.resultWin : s.resultLose]}>{resultLabel}</Text>
        <View style={s.sideRow}>
          <View style={s.side}>
            <Text style={s.sideName} numberOfLines={1}>{data.challenger.nickname}</Text>
            <Text style={s.sideTime}>{fmtTime(data.challenger.ms)}</Text>
          </View>
          <Text style={s.vs}>VS</Text>
          <View style={s.side}>
            <Text style={s.sideName} numberOfLines={1}>{data.opponent.nickname}</Text>
            <Text style={s.sideTime}>{fmtTime(data.opponent.ms)}</Text>
          </View>
        </View>
        <View style={s.wagerRow}>
          <CoinIcon size={16} />
          <Text style={s.wagerText}>{data.wager} en juego</Text>
        </View>
        <Pressable style={s.rematchBtn} onPress={() => onRematch(rival)}>
          <Text style={s.rematchBtnText}>REVANCHA</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RD.bg, paddingTop: 50 },
  backLink: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono, marginLeft: 18, marginBottom: 8 },
  pageTitle: {
    color: RD.textPrimary, fontSize: 28, fontFamily: RD_FONT.displayBlack,
    textTransform: 'uppercase', marginLeft: 18, marginBottom: 12,
  },
  centerMsg: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 24 },
  centerMsgText: { color: RD.textSecondary, fontSize: 14, fontFamily: RD_FONT.mono, textAlign: 'center' },
  stage: { backgroundColor: '#111113', borderTopWidth: 1, borderBottomWidth: 1, borderColor: RD.panelBorder },
  resultCard: { padding: 18, gap: 14 },
  resultLabel: {
    fontSize: 20, fontFamily: RD_FONT.displayBlack, textTransform: 'uppercase',
    textAlign: 'center', letterSpacing: 0.5,
  },
  resultWin: { color: RD.successGreen },
  resultLose: { color: RD.textSecondary },
  resultTie: { color: RD.textTertiary },
  sideRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  side: { flex: 1, gap: 4 },
  sideName: { color: RD.textPrimary, fontSize: 14, fontFamily: RD_FONT.monoBold },
  sideTime: { color: RD.textSecondary, fontSize: 18, fontFamily: RD_FONT.monoBold, fontVariant: ['tabular-nums'] },
  vs: { color: RD.textDisabled, fontSize: 12, fontFamily: RD_FONT.mono },
  wagerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  wagerText: { color: RD.gold1st, fontSize: 13, fontFamily: RD_FONT.monoBold },
  rematchBtn: { backgroundColor: RD.brand, borderRadius: 2, paddingVertical: 14, alignItems: 'center' },
  rematchBtnText: { color: RD.bg, fontSize: 14, fontFamily: RD_FONT.displayBlack, letterSpacing: 0.6 },
});

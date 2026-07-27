// ============================================================================
//  ShareCard — tarjeta visual del resultado, pensada para CAPTURARSE a PNG y
//  compartir (WhatsApp, Instagram, etc.). Se renderiza fuera de pantalla y se
//  captura con react-native-view-shot (ver src/share.js).
//
//  Tamaño fijo 1080×1350 (4:5) para que salga nítida sin reescalar.
// ============================================================================

import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

import { C, MONO } from './theme';

export const CARD_W = 1080;
export const CARD_H = 1350;

// Dibuja el circuito centrado y escalado dentro de un cuadro w×h.
function MiniTrack({ track, w, h, pad = 70 }) {
  const pts = track.roadPolygon;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;
  const s = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  const ox = (w - bw * s) / 2 - minX * s;
  const oy = (h - bh * s) / 2 - minY * s;
  const road = pts.map((p) => `${(p.x * s + ox).toFixed(1)},${(p.y * s + oy).toFixed(1)}`).join(' ');
  const kerb = Math.max(5, 9 * s);
  return (
    <Svg width={w} height={h}>
      <Polygon points={road} fill="#23282f" />
      <Polygon points={road} fill="none" stroke="#eef0f4" strokeWidth={kerb} strokeLinejoin="round" />
      <Polygon points={road} fill="none" stroke="#ff5a3c" strokeWidth={kerb} strokeDasharray={`${kerb * 1.2},${kerb * 1.2}`} strokeLinejoin="round" />
    </Svg>
  );
}

// time = "43.094s" ya formateado. rankText = "12.º de 1500 en el mundo" (o null).
const ShareCard = forwardRef(function ShareCard(
  { track, time, rankText, weather, nickname, day, accent = C.gold },
  ref,
) {
  const wx = weather || { icon: '', label: '' };
  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.brand}>CIRCUITO DIARIO</Text>
        <Text style={styles.day}>{day}{wx.icon ? `  ·  ${wx.icon} ${wx.label}` : ''}</Text>
      </View>

      <View style={styles.trackBox}>
        {track ? <MiniTrack track={track} w={CARD_W - 200} h={640} /> : null}
      </View>

      <Text style={styles.timeK}>TIEMPO</Text>
      <Text style={[styles.time, { color: accent }]}>{time}</Text>
      {!!rankText && <Text style={styles.rank}>{rankText}</Text>}

      <View style={styles.foot}>
        <Text style={styles.nick} numberOfLines={1}>{nickname}</Text>
        <Text style={styles.cta}>¿Me superas?</Text>
      </View>
    </View>
  );
});

export default ShareCard;

const styles = StyleSheet.create({
  card: {
    width: CARD_W, height: CARD_H, backgroundColor: C.bg,
    paddingHorizontal: 72, paddingTop: 72, paddingBottom: 64,
    justifyContent: 'space-between',
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { color: C.ink, fontSize: 40, fontWeight: '900', letterSpacing: 4 },
  day: { color: C.dim, fontSize: 34, fontWeight: '700', fontFamily: MONO },
  trackBox: {
    backgroundColor: C.card, borderRadius: 40, borderWidth: 2, borderColor: C.line,
    alignItems: 'center', justifyContent: 'center', paddingVertical: 24, marginVertical: 28,
  },
  timeK: { color: C.dim, fontSize: 34, fontWeight: '800', letterSpacing: 8, textAlign: 'center' },
  time: {
    fontSize: 200, fontWeight: '900', fontFamily: MONO, fontVariant: ['tabular-nums'],
    textAlign: 'center', marginTop: 6,
  },
  rank: { color: C.ink, fontSize: 44, fontWeight: '800', textAlign: 'center', marginTop: 10, fontVariant: ['tabular-nums'] },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 },
  nick: { color: C.ink, fontSize: 46, fontWeight: '800', flex: 1, marginRight: 20 },
  cta: { color: C.gold, fontSize: 40, fontWeight: '900' },
});

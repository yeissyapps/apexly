// ============================================================================
//  ShareCard — tarjeta visual del resultado, pensada para CAPTURARSE a PNG y
//  compartir (WhatsApp, Instagram, etc.). Se renderiza fuera de pantalla y se
//  captura con react-native-view-shot (ver src/share.js).
//
//  Tamaño fijo 1080×1350 (4:5) para que salga nítida sin reescalar.
//
//  NO lleva enlace dibujado dentro: un PNG no puede tener botones, y una URL
//  pintada que no se puede tocar invita a intentarlo y frustra. El enlace a la
//  tienda viaja en el TEXTO que acompaña a la imagen (ver shareResult en
//  App.js), donde WhatsApp lo convierte solo en una tarjeta tocable.
//
//  Sí lleva la marca bien visible arriba, porque la imagen sí se reenvía
//  suelta y sin el texto, y ahí es lo único que queda para saber de qué app
//  es esto.
// ============================================================================

import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

import { RD, RD_FONT, SECTOR_RESULT_COLORS } from './theme';

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
      <Polygon points={road} fill="none" stroke={RD.brand} strokeWidth={kerb} strokeDasharray={`${kerb * 1.2},${kerb * 1.2}`} strokeLinejoin="round" />
    </Svg>
  );
}

// time = "43.094s" ya formateado. rankText = "12.º de 1500 en el mundo" (o null).
// sectorColors = ['purple'|'green'|'yellow', ...] de esta vuelta (o null).
const ShareCard = forwardRef(function ShareCard(
  { track, time, rankText, weather, nickname, day, accent = RD.gold1st, tagline = '¿Me superas?', sectorColors = null },
  ref,
) {
  const wx = weather || { icon: '', label: '' };
  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <View>
        <View style={styles.head}>
          <Text style={styles.brand}>APEXLY</Text>
          <Text style={styles.day}>{day}{wx.icon ? `  ·  ${wx.icon} ${wx.label}` : ''}</Text>
        </View>
        {/* Regla de cabecera partida: el tramo rojo es la marca, el resto
            estructura. Un filete entero de un solo color se lee como borde;
            partido se lee como identidad. */}
        <View style={styles.ruleRow}>
          <View style={styles.ruleBrand} />
          <View style={styles.ruleRest} />
        </View>
      </View>

      <View style={styles.trackBox}>
        {track ? <MiniTrack track={track} w={CARD_W - 200} h={560} /> : null}
      </View>

      {/* Barra de sectores: la firma visual del juego. Morado = mejor del
          mundo hoy, verde = mejoraste tu fantasma, amarillo = no. Es la única
          parte de la tarjeta que dice CÓMO fue la vuelta y no solo cuánto
          marcó, y quien juega la lee de un vistazo sin leyenda. */}
      {sectorColors && sectorColors.length > 0 && (
        <View style={styles.sectorRow}>
          {sectorColors.map((c, i) => (
            <View key={i} style={styles.sectorCol}>
              <View style={[styles.sectorBar, { backgroundColor: SECTOR_RESULT_COLORS[c] || RD.textDisabled }]} />
              <Text style={styles.sectorLabel}>S{i + 1}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.timeBlock}>
        <Text style={styles.timeK}>TIEMPO</Text>
        <Text style={[styles.time, { color: accent }]}>{time}</Text>
        {!!rankText && <Text style={styles.rank}>{rankText}</Text>}
      </View>

      <View style={styles.foot}>
        <Text style={styles.nick} numberOfLines={1}>{nickname}</Text>
        <Text style={[styles.cta, { color: accent }]}>{tagline}</Text>
      </View>
    </View>
  );
});

export default ShareCard;

const styles = StyleSheet.create({
  card: {
    width: CARD_W, height: CARD_H, backgroundColor: RD.bg,
    paddingHorizontal: 72, paddingTop: 64, paddingBottom: 56,
    justifyContent: 'space-between',
  },

  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  brand: { color: RD.textPrimary, fontFamily: RD_FONT.displayBlack, fontSize: 62, letterSpacing: 6 },
  day: { color: RD.textSecondary, fontSize: 32, fontFamily: RD_FONT.mono },
  ruleRow: { flexDirection: 'row', marginTop: 18 },
  ruleBrand: { width: 180, height: 6, backgroundColor: RD.brand },
  ruleRest: { flex: 1, height: 6, backgroundColor: RD.gridLine },

  trackBox: {
    backgroundColor: '#151517', borderRadius: 32, borderWidth: 2, borderColor: RD.panelBorder,
    alignItems: 'center', justifyContent: 'center', paddingVertical: 20,
  },

  sectorRow: { flexDirection: 'row', gap: 16 },
  sectorCol: { flex: 1, alignItems: 'center', gap: 12 },
  sectorBar: { alignSelf: 'stretch', height: 16, borderRadius: 8 },
  sectorLabel: { color: RD.textDisabled, fontSize: 26, fontFamily: RD_FONT.mono, letterSpacing: 3 },

  timeBlock: { alignItems: 'center' },
  timeK: { color: RD.textDisabled, fontSize: 30, fontFamily: RD_FONT.monoSemibold, letterSpacing: 10 },
  time: {
    fontSize: 190, fontFamily: RD_FONT.monoBold, fontVariant: ['tabular-nums'],
    textAlign: 'center', marginTop: 4,
  },
  rank: {
    color: RD.textPrimary, fontSize: 40, fontFamily: RD_FONT.mono,
    textAlign: 'center', marginTop: 6, fontVariant: ['tabular-nums'],
  },

  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nick: { color: RD.textPrimary, fontFamily: RD_FONT.displayBold, fontSize: 52, flex: 1, marginRight: 20 },
  cta: { fontFamily: RD_FONT.displayBlack, fontSize: 46 },
});

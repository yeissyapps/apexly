// ============================================================================
//  SeasonRail — la firma visual del Grand Prix.
//
//  El Diario y el Grand Prix se estaban pintando igual: lista vertical de
//  filas ordenadas, mismos colores, misma cabecera de rayas. Y no son lo
//  mismo. El Diario es una CLASIFICACIÓN — una foto de hoy, ordenada por
//  tiempo. El Grand Prix es un CAMPEONATO — siete rondas, puntos que se
//  acumulan y un final.
//
//  Esto dibuja justo lo que el Diario no puede tener: por dónde vas del
//  recorrido. Un segmento por ronda — corridas, la de hoy, y las que faltan.
//  Con verlo medio segundo ya sabes que estás en otra cosa.
//
//  JC, 2026-09-09: "muy azul" — antes TODO el riel (corridas + en curso) era
//  el mismo azul de marca del GP (GP_ACCENT), solo con menos opacidad para
//  las corridas. Ahora cada estado tiene su propio color, y GP_ACCENT queda
//  reservado para lo que JC quiere que siga siendo azul: el CTA de correr y
//  el borde del circuito de hoy, no el riel entero.
//   - corrida: RD.danger (el mismo naranja que ya usa el Diario para avisos)
//   - en curso: RD.successGreen — "aquí estás jugando"
//   - futura: RD.gridLine, sin cambios — un hueco marcado, no invisible
// ============================================================================

import { StyleSheet, Text, View } from 'react-native';

import { RD, RD_FONT } from './theme';

export const GP_ACCENT = RD.trackBlue;

// total   = número de rondas del GP (circuit_count)
// current = ronda en curso (1..total), o null si ya terminó
// done    = cuántas rondas se han cerrado ya
export default function SeasonRail({ total = 7, current = null, finished = false }) {
  const segs = [];
  for (let i = 1; i <= total; i++) {
    const corrida = finished || (current != null && i < current);
    const enCurso = !finished && i === current;
    segs.push(
      <View
        key={i}
        style={[
          s.seg,
          corrida && s.segDone,
          enCurso && s.segNow,
        ]}
      />
    );
  }
  return (
    <View style={s.wrap}>
      <View style={s.rail}>{segs}</View>
      <Text style={s.label}>
        {finished ? `GRAND PRIX COMPLETO · ${total} RONDAS` : `RONDA ${current} DE ${total}`}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 7 },
  rail: { flexDirection: 'row', gap: 3 },
  // Las rondas futuras no son invisibles, son un hueco marcado: se tiene que
  // ver cuánto queda por delante, que es medio mensaje del formato.
  seg: { flex: 1, height: 7, borderRadius: 1, backgroundColor: RD.gridLine },
  segDone: { backgroundColor: RD.danger, opacity: 0.55 },
  segNow: { backgroundColor: RD.successGreen },
  label: {
    color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.monoBold,
    letterSpacing: 1.4,
  },
});

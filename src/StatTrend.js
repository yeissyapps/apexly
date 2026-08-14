// ============================================================================
//  StatTrend — gráfico de evolución de tus vueltas diarias.
//
//  EL PROBLEMA QUE RESUELVE: comparar tus tiempos en bruto entre días NO
//  significa nada, porque cada día es un circuito distinto. 39.6s en Chicanes
//  contra 43.1s en Horquillas no dice que hayas empeorado, dice que el
//  trazado era más largo. Un gráfico de tiempos crudos sería un gráfico de
//  "qué circuito tocó", disfrazado de progreso.
//
//  LA NORMALIZACIÓN: cada circuito trae su propio tiempo de referencia
//  (`timeEstimate`, lo que tarda una vuelta limpia), determinista por fecha y
//  calculable sin red para cualquier día pasado. Se dibuja tu tiempo COMO
//  PORCENTAJE de ese objetivo, así que 100% = clavaste la referencia del día,
//  y menos es mejor. Eso sí es comparable entre días.
//
//  La barra se colorea por tramos (por debajo del objetivo / cerca / lejos)
//  en vez de por valor continuo: a este tamaño, un degradado no se lee.
// ============================================================================

import { View, Text, StyleSheet } from 'react-native';
import { RD, RD_FONT } from './theme';

// Suelo y techo del eje, en % del objetivo del día. Se recorta a esta ventana
// porque una vuelta desastrosa (250% del objetivo tras varios choques)
// aplastaría todas las demás barras contra el suelo y el gráfico dejaría de
// contar nada del rango donde de verdad juegas.
const AXIS_MIN = 90;
const AXIS_MAX = 175;

// Días mínimos para poder hablar de tendencia (ver `canCompare` abajo).
const MIN_DAYS_FOR_DELTA = 4;

// Ancho máximo de barra. Sin esto, con 2-3 días salían bloques enormes
// repartiéndose toda la anchura: parecía un gráfico de otra cosa, no una
// serie temporal a medio llenar. Con tope, los primeros días se leen como
// "esto acaba de empezar", que es la verdad.
const BAR_MAX_W = 26;

function barColor(pct) {
  if (pct <= 100) return RD.successGreen; // por debajo de la referencia
  if (pct <= 115) return RD.gold1st;      // en el entorno
  return RD.danger;                        // lejos
}

export default function StatTrend({ points, title = 'TUS VUELTAS' }) {
  // points: [{ day, ms, targetMs }] de más antiguo a más reciente
  const usable = (points || []).filter((p) => p.targetMs > 0);

  if (usable.length < 2) {
    return (
      <View style={s.wrap}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.empty}>
          {usable.length === 0
            ? 'Corre un par de días y aquí verás tu evolución.'
            : 'Un día más y podrás comparar tu evolución.'}
        </Text>
      </View>
    );
  }

  const pcts = usable.map((p) => (p.ms / p.targetMs) * 100);

  // Comparación tipo diario de entrenamiento: mitad reciente contra mitad
  // anterior. Con pocos días una media global no dice nada; partirlo en dos
  // sí responde a "¿voy mejorando?".
  //
  // MÍNIMO 4 DÍAS: con 2-3, "la mitad anterior" es un solo día, así que el
  // porcentaje sería ayer-contra-hoy vendido como tendencia — y un mal día
  // suelto lo dispararía. Mejor no enseñar nada que enseñar ruido.
  const canCompare = pcts.length >= MIN_DAYS_FOR_DELTA;
  const half = Math.floor(pcts.length / 2);
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const delta = canCompare ? avg(pcts.slice(0, half)) - avg(pcts.slice(half)) : 0;
  const improving = canCompare && delta > 0.5;
  const worsening = canCompare && delta < -0.5;

  const best = Math.min(...pcts);

  return (
    <View style={s.wrap}>
      <View style={s.header}>
        <Text style={s.title}>{title}</Text>
        {canCompare && (
          <Text style={[s.delta, improving && s.deltaUp, worsening && s.deltaDown]}>
            {improving ? '▲' : worsening ? '▼' : '='} {Math.abs(delta).toFixed(1)}%
          </Text>
        )}
      </View>
      <Text style={s.subtitle}>
        {canCompare
          ? `vs. el objetivo de cada circuito · ${usable.length} días`
          : `vs. el objetivo de cada circuito · ${MIN_DAYS_FOR_DELTA - usable.length} ${
              MIN_DAYS_FOR_DELTA - usable.length === 1 ? 'día' : 'días'
            } más para ver tu tendencia`}
      </Text>

      <View style={s.chart}>
        {/* Línea del 100% = el objetivo del día. Es la referencia de todo el
            gráfico, así que va dibujada y etiquetada, no implícita. */}
        <View
          style={[
            s.targetLine,
            { bottom: `${((AXIS_MAX - 100) / (AXIS_MAX - AXIS_MIN)) * 100}%` },
          ]}
        />
        <View style={s.bars}>
          {usable.map((p, i) => {
            const pct = pcts[i];
            const clamped = Math.max(AXIS_MIN, Math.min(AXIS_MAX, pct));
            // Eje invertido: menos porcentaje = mejor vuelta = barra más alta.
            const h = ((AXIS_MAX - clamped) / (AXIS_MAX - AXIS_MIN)) * 100;
            return (
              <View key={p.day} style={s.barSlot}>
                <View
                  style={[
                    s.bar,
                    {
                      height: `${Math.max(3, h)}%`,
                      backgroundColor: barColor(pct),
                      opacity: pct === best ? 1 : 0.75,
                    },
                  ]}
                />
              </View>
            );
          })}
        </View>
      </View>

      <View style={s.legend}>
        <Text style={s.legendText}>{usable[0].day.slice(5)}</Text>
        <Text style={s.legendTarget}>— objetivo del día —</Text>
        <Text style={s.legendText}>{usable[usable.length - 1].day.slice(5)}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2, padding: 14, gap: 6 },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { color: RD.textPrimary, fontSize: 13, fontFamily: RD_FONT.monoBold, letterSpacing: 0.5 },
  subtitle: { color: RD.textTertiary, fontSize: 10, fontFamily: RD_FONT.mono },
  delta: {
    color: RD.textSecondary, fontSize: 13, fontFamily: RD_FONT.monoBold,
    fontVariant: ['tabular-nums'],
  },
  deltaUp: { color: RD.successGreen },
  deltaDown: { color: RD.danger },
  empty: { color: RD.textTertiary, fontSize: 12, fontFamily: RD_FONT.mono, lineHeight: 18 },
  chart: { height: 96, marginTop: 6, justifyContent: 'flex-end' },
  targetLine: {
    position: 'absolute', left: 0, right: 0, height: 1,
    backgroundColor: RD.panelBorder,
  },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: '100%', gap: 3 },
  barSlot: { flex: 1, maxWidth: BAR_MAX_W, height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 1 },
  legend: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  legendText: { color: RD.textTertiary, fontSize: 9, fontFamily: RD_FONT.mono },
  legendTarget: { color: RD.textDisabled, fontSize: 9, fontFamily: RD_FONT.mono },
});

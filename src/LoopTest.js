// ============================================================================
//  LoopTest — "PROBAR CIRCUITO CERRADO" (EN PRUEBAS, solo testers).
//
//  JC, 2026-10-14: antes de decidir si el diario pasa a circuitos cerrados,
//  conducir varios días del generador nuevo (src/loopGenerator.js) en el
//  móvil. Nada de lo que se corre aquí se envía al servidor: ni ranking, ni
//  racha, ni intentos — es un banco de pruebas.
//
//  Se elige el día con ‹ ›, se ve el circuito y su ficha, y CORRER lo abre
//  en el juego de siempre con 2 vueltas. Tu mejor vuelta de cada día se
//  guarda en memoria (no en disco) como fantasma para la siguiente.
// ============================================================================

import { useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';

import DangerStripe from './DangerStripe';
import MiniTrackMap from './MiniTrackMap';
import { closedDailyCircuit, LOOP_LAPS } from './loopGenerator';
import { dayOffset, todayKey } from './daily';
import { dailyWeather } from './weather';
import { fmtTime } from './format';
import { RD, RD_FONT } from './theme';
import { t, tParts } from './i18n';

const MAP_W = Dimensions.get('window').width - 36;

export default function LoopTest({ offset, onOffset, best, lastResult, onPlay, onBack }) {
  const key = dayOffset(todayKey(), offset);
  const [spec, setSpec] = useState(null);

  // El generador tarda unas décimas: se deja pintar el "cargando" antes.
  useEffect(() => {
    setSpec(null);
    const id = setTimeout(() => setSpec(closedDailyCircuit(key)), 30);
    return () => clearTimeout(id);
  }, [key]);

  const wx = dailyWeather(key);
  const mine = best[key];

  return (
    <View style={s.screen}>
      <StatusBar hidden />
      <DangerStripe height={6} />
      <ScrollView contentContainerStyle={s.content}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={s.backLink}>{t('‹ PERFIL')}</Text>
        </Pressable>
        <Text style={s.pageTitle}>{t('Circuito cerrado')}</Text>
        <Text style={s.note}>{t('En pruebas: no cuenta para el ranking, la racha ni los intentos.')}</Text>

        <View style={s.dayRow}>
          <Pressable style={s.dayBtn} onPress={() => onOffset(offset - 1)} hitSlop={8}><Text style={s.dayBtnText}>‹</Text></Pressable>
          <Text style={s.dayText}>{key}{offset === 0 ? ` · ${t('HOY')}` : ''}</Text>
          <Pressable style={s.dayBtn} onPress={() => onOffset(offset + 1)} hitSlop={8}><Text style={s.dayBtnText}>›</Text></Pressable>
        </View>

        <View style={s.panel}>
          {!spec ? (
            <View style={s.loading}><ActivityIndicator color={RD.brand} /></View>
          ) : (
            <>
              <Text style={s.trackName}>{tParts(spec.label)}</Text>
              <Text style={s.meta}>
                {t('{laps} vueltas · objetivo ~{s}s', { laps: LOOP_LAPS, s: spec.timeEstimate })} · {wx.icon} {t(wx.label)}
              </Text>
              <MiniTrackMap track={spec.track} w={MAP_W - 28} h={190} />
              {mine && <Text style={s.best}>{t('Tu mejor: {time}', { time: fmtTime(mine.ms) })}</Text>}
              {lastResult && lastResult.key === key && (
                <Text style={s.last}>{t('Última vuelta: {time}', { time: fmtTime(lastResult.ms) })}</Text>
              )}
            </>
          )}
        </View>

        <Pressable style={[s.cta, !spec && s.ctaDisabled]} disabled={!spec} onPress={() => onPlay(key, spec)}>
          <Text style={s.ctaText}>{t('CORRER')}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RD.bg },
  content: { paddingHorizontal: 18, paddingTop: 50, paddingBottom: 40, gap: 14 },
  backLink: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono },
  pageTitle: { color: RD.textPrimary, fontSize: 32, fontFamily: RD_FONT.displayBlack, textTransform: 'uppercase' },
  note: { color: RD.textTertiary, fontSize: 13, fontFamily: RD_FONT.body, lineHeight: 19 },
  dayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayBtn: { borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2, paddingHorizontal: 18, paddingVertical: 6 },
  dayBtnText: { color: RD.textPrimary, fontSize: 20, fontFamily: RD_FONT.monoBold },
  dayText: { color: RD.textPrimary, fontSize: 15, fontFamily: RD_FONT.monoBold },
  panel: { borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2, padding: 14, gap: 8 },
  loading: { height: 250, alignItems: 'center', justifyContent: 'center' },
  trackName: { color: RD.trackBlue, fontSize: 26, fontFamily: RD_FONT.displayBlack, textTransform: 'uppercase' },
  meta: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono },
  best: { color: RD.successGreen, fontSize: 13, fontFamily: RD_FONT.monoBold },
  last: { color: RD.textSecondary, fontSize: 13, fontFamily: RD_FONT.mono },
  cta: { backgroundColor: RD.brand, borderRadius: 2, paddingVertical: 16, alignItems: 'center' },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: RD.bg, fontSize: 18, fontFamily: RD_FONT.displayBlack, letterSpacing: 0.6 },
});

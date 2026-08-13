// ============================================================================
//  CareerMode — lista de la escalera de niveles (pestaña Carrera). Jugar
//  un nivel es responsabilidad de App.js (como el circuito diario: pantalla
//  completa, fuera de la barra de pestañas) — este componente solo pinta la
//  lista y el resultado del último intento. Cada nivel tiene su PROPIO cupo
//  de intentos (independiente del circuito diario y del resto de niveles):
//  Game.js lo gasta/gatea al primer toque, esta lista no necesita saberlo.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { RD, RD_FONT } from './theme';
import { fmtTime } from './format';
import { getCareerProgress } from './api';
import { LEVEL_COUNT, levelSpec, gapMsFor } from './career';
import { loadAttempts, attemptsLeft as calcLeft, FREE_ATTEMPTS } from './attempts';

export default function CareerMode({ unlimited, result, onPlayLevel, onDismissResult }) {
  const [cleared, setCleared] = useState(0);
  const [loading, setLoading] = useState(true);
  const [attByLevel, setAttByLevel] = useState({});

  // Puro por `n` (misma semilla siempre) — se calcula UNA vez, no en cada
  // render. Con 30 niveles, generar los 30 trazados en cada re-render de la
  // pestaña (p. ej. por cambios ajenos en App.js) sí se notaría.
  const levels = useMemo(
    () => Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1).map((n) => {
      const spec = levelSpec(n);
      return { n, spec, gapMs: gapMsFor(n, spec.timeEstimate) };
    }),
    [],
  );

  // Se re-consulta cuando cambia `result` (acabas de reclamar un nivel).
  useEffect(() => {
    getCareerProgress().then(setCleared).catch(() => {}).finally(() => setLoading(false));
  }, [result]);

  // Intentos restantes de CADA nivel (cupo propio, ver attempts.js con
  // clave 'career-N') — se recarga tras cada intento para reflejar lo gastado.
  useEffect(() => {
    let alive = true;
    Promise.all(levels.map(({ n }) => loadAttempts('career-' + n).then((a) => [n, a])))
      .then((pairs) => { if (alive) setAttByLevel(Object.fromEntries(pairs)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [levels, result]);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={RD.brand} />
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      {result && (
        <View style={[s.resultBanner, result.passed ? s.resultPass : s.resultFail]}>
          <Text style={s.resultText}>
            {result.passed
              ? `Nivel ${result.level} superado — ${fmtTime(result.ms)} (objetivo ${fmtTime(result.gapMs)})`
              : `No llegaste a tiempo — ${fmtTime(result.ms)} (objetivo ${fmtTime(result.gapMs)}). Inténtalo otra vez.`}
          </Text>
          <Pressable onPress={onDismissResult} hitSlop={8}>
            <Text style={s.resultClose}>✕</Text>
          </Pressable>
        </View>
      )}

      {levels.map(({ n, spec, gapMs }) => {
        const isCleared = n <= cleared;
        const isLocked = n > cleared + 1;
        const a = attByLevel[n];
        const attLeft = a ? calcLeft(a) : FREE_ATTEMPTS;
        const attTotal = FREE_ATTEMPTS + (a?.bonus || 0);
        return (
          <Pressable
            key={n}
            style={[s.levelRow, isCleared && s.levelRowCleared, isLocked && s.levelRowDisabled]}
            disabled={isLocked}
            onPress={() => onPlayLevel(n)}
          >
            <View style={s.levelNumWrap}>
              <Text style={[s.levelNum, isCleared && s.levelNumCleared]}>{isCleared ? '✓' : n}</Text>
            </View>
            <View style={s.levelInfo}>
              <Text style={s.levelLabel}>{spec.label}</Text>
              <Text style={s.levelGap}>Objetivo: {fmtTime(gapMs)}</Text>
            </View>
            {!isLocked && (
              <Text style={s.levelAtt}>{unlimited ? '∞' : `${Math.max(0, attLeft)}/${attTotal}`}</Text>
            )}
            {isLocked && <Text style={s.levelLock}>🔒</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  center: { paddingVertical: 40, alignItems: 'center' },
  wrap: { gap: 10 },

  resultBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 2, paddingHorizontal: 12, paddingVertical: 10,
  },
  resultPass: { borderColor: RD.successGreen, backgroundColor: 'rgba(56,217,122,0.1)' },
  resultFail: { borderColor: RD.danger, backgroundColor: 'rgba(255,92,92,0.1)' },
  resultText: { color: RD.textPrimary, fontSize: 12, fontFamily: RD_FONT.mono, flex: 1, marginRight: 8 },
  resultClose: { color: RD.textSecondary, fontSize: 14 },

  levelRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2, padding: 12,
  },
  levelRowCleared: { borderColor: RD.gold1st },
  levelRowDisabled: { opacity: 0.4 },
  levelNumWrap: {
    width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: RD.panelBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  levelNum: { color: RD.textSecondary, fontSize: 13, fontFamily: RD_FONT.monoBold },
  levelNumCleared: { color: RD.gold1st },
  levelInfo: { flex: 1, gap: 2 },
  levelLabel: { color: RD.textPrimary, fontSize: 14, fontFamily: RD_FONT.monoBold },
  levelGap: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono },
  levelAtt: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono },
  levelLock: { fontSize: 14 },
});

// ============================================================================
//  Grand Prix — GroupHome (pantalla propia de un grupo: miembros+arrancar si
//  no hay GP, o la info del GP directamente si ya lo hay) y la clasificación
//  general. Jugar una ronda es responsabilidad de App.js (pantalla completa,
//  como el circuito diario y Modo Carrera) — esto solo pinta el "antes" y el
//  "después".
//
//  Pasada visual "épica": reveal del líder con ShineBadge en la
//  clasificación, batalla de sectores (tú vs el líder de la ronda) en el
//  resultado, y resultados de la ronda con gap al líder. La cabecera se
//  quedó con DangerStripe de siempre (la bandera a cuadros no convenció).
//  Tarjeta de podio para compartir: pendiente, no la pide nada más de la
//  app, mejor esperar a ver si hace falta antes de construirla.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StatusBar, StyleSheet, Text, View } from 'react-native';

import DangerStripe from './DangerStripe';
import ShineBadge from './ShineBadge';
import { RD, RD_FONT } from './theme';
import { fmtTime, fmtSecs, fmtGap, fmtCountdown } from './format';
import { getActiveGrandPrix, startGrandPrix, getGroupMembers, getGpResults, getGpRoundLeader, leaveGroup } from './api';
import { gpCircuitSpec, roundLabel, currentRoundIndex, nextRoundUnlockAt, gpFinished, computeStandings } from './gpData';

// Comparativa tú-vs-líder de la ronda, sector a sector. Colores propios
// (verde/rojo simples) — NO reutiliza el morado/verde/amarillo del HUD de
// carrera, que significa otra cosa (mejor del día / mejoras tu fantasma):
// aquí es solo "vas por delante o por detrás de esta persona en concreto".
function SectorBattle({ gpId, dayIndex, myMs, mySectors }) {
  const [leader, setLeader] = useState(undefined); // undefined = cargando

  useEffect(() => {
    let alive = true;
    getGpRoundLeader(gpId, dayIndex).then((l) => { if (alive) setLeader(l); }).catch(() => { if (alive) setLeader(null); });
    return () => { alive = false; };
  }, [gpId, dayIndex]);

  if (!mySectors || mySectors.length === 0 || leader === undefined) return null;

  if (!leader || !leader.sectorMs || leader.ms >= myMs) {
    return (
      <View style={s.sectorBattle}>
        <Text style={s.labelMono}>SECTORES</Text>
        <Text style={s.body}>Vas líder de esta ronda — todavía no hay con quién comparar.</Text>
      </View>
    );
  }

  return (
    <View style={s.sectorBattle}>
      <Text style={s.labelMono}>TUS SECTORES VS {leader.nickname.toUpperCase()}</Text>
      <View style={s.sectorRow}>
        {mySectors.map((ms, i) => {
          const theirs = leader.sectorMs[i];
          const color = theirs == null ? RD.textTertiary : ms < theirs ? RD.successGreen : RD.danger;
          return (
            <View key={i} style={s.sectorChip}>
              <Text style={s.sectorChipLabel}>S{i + 1}</Text>
              <Text style={[s.sectorChipTime, { color }]}>{fmtSecs(ms)}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

async function shareInvite(group) {
  const msg =
    `Únete a mi grupo "${group.name}" en Apexly 🏁\n\n` +
    `Abre la app → Amigos → "Unirse con código" e introduce:\n${group.join_code}`;
  try { await Share.share({ message: msg }); } catch (_) {}
}

function useCountdownTo(targetTs) {
  const [label, setLabel] = useState(() => (targetTs ? fmtCountdown(targetTs - Date.now()) : null));
  useEffect(() => {
    if (!targetTs) { setLabel(null); return; }
    setLabel(fmtCountdown(targetTs - Date.now()));
    const id = setInterval(() => setLabel(fmtCountdown(targetTs - Date.now())), 30000);
    return () => clearInterval(id);
  }, [targetTs]);
  return label;
}

// Pantalla propia de un grupo. Sin GP activo: miembros + Invitar + Iniciar
// Grand Prix (el grupo "en reposo"). Con GP activo (o terminado): la info
// del GP directamente — es lo primero que se quiere ver al entrar, no un
// paso intermedio.
export function GroupHome({ group, result, onDismissResult, onPlayRound, onViewStandings, onBack, onLeave }) {
  const [gp, setGp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState(null);
  const [members, setMembers] = useState(null);
  const [leaving, setLeaving] = useState(false);

  function confirmLeave() {
    Alert.alert(
      'Salir del grupo',
      `¿Seguro que quieres salir de "${group.name}"? Necesitarás el código para volver a unirte.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Salir', style: 'destructive', onPress: async () => {
            setLeaving(true);
            try { await leaveGroup(group.id); onLeave && onLeave(); }
            catch (_) { setLeaving(false); Alert.alert('No se pudo salir del grupo. Prueba otra vez.'); }
          },
        },
      ],
    );
  }

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setGp(await getActiveGrandPrix(group.id)); } catch (_) { setGp(null); }
    setLoading(false);
  }, [group.id]);

  useEffect(() => { refresh(); }, [refresh, result]);

  // Miembros solo hacen falta cuando NO hay GP activo (es lo que se enseña
  // en su lugar) — no merece la pena cargarlos si ya se va a ver el GP.
  useEffect(() => {
    if (loading || gp) { setMembers(null); return; }
    let alive = true;
    getGroupMembers(group.id).then((m) => { if (alive) setMembers(m); }).catch(() => { if (alive) setMembers([]); });
    return () => { alive = false; };
  }, [group.id, loading, gp]);

  // Tiempos de la ronda EN CURSO (no solo puntos) — quién ha clasificado hoy
  // y con qué gap al líder. Se recarga tras cada intento (cambia `result`).
  const [roundResults, setRoundResults] = useState(null);
  useEffect(() => {
    if (!gp || gpFinished(gp)) { setRoundResults(null); return; }
    const dayIndex = currentRoundIndex(gp);
    let alive = true;
    getGpResults(gp.id).then((rows) => {
      if (!alive) return;
      setRoundResults(rows.filter((r) => r.dayIndex === dayIndex).sort((a, b) => a.ms - b.ms));
    }).catch(() => { if (alive) setRoundResults([]); });
    return () => { alive = false; };
  }, [gp?.id, result]);

  async function handleStart() {
    if (starting) return;
    setStarting(true); setErr(null);
    try {
      setGp(await startGrandPrix(group.id));
    } catch (e) {
      const already = String(e?.message || '').includes('GP_ALREADY_ACTIVE');
      setErr(already ? 'Ya hay un Grand Prix activo en este grupo.' : 'No se pudo arrancar el Grand Prix.');
      if (already) refresh();
    } finally {
      setStarting(false);
    }
  }

  const finished = gp && gpFinished(gp);
  const roundIdx = gp && !finished ? currentRoundIndex(gp) : null;
  const unlockAt = gp && !finished ? nextRoundUnlockAt(gp) : null;
  const countdown = useCountdownTo(unlockAt);
  const spec = gp && roundIdx != null ? gpCircuitSpec(gp.id, roundIdx, gp.circuit_count) : null;

  return (
    <View style={s.screen}>
      <StatusBar hidden />
      <DangerStripe height={6} />
      <ScrollView contentContainerStyle={s.content}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={s.backLink}>‹ AMIGOS</Text>
        </Pressable>
        <Text style={s.pageTitle}>{group.name}</Text>
        <Text style={s.subtitle}>CÓDIGO {group.join_code}</Text>

        {result && (
          <View style={[s.resultBanner, result.error ? s.resultErr : result.isPractice ? s.resultPractice : s.resultOk]}>
            <Text style={s.resultText}>
              {result.error
                ? 'No se pudo enviar el tiempo. Prueba otra vez.'
                : result.isPractice
                ? `Práctica — ${fmtTime(result.ms)} (no cuenta, quedan vueltas de práctica o ya clasifica la siguiente)`
                : `Clasificación ronda ${result.dayIndex} — ${fmtTime(result.ms)}${result.isBest ? ' · ¡mejor tiempo!' : ''}`}
            </Text>
            <Pressable onPress={onDismissResult} hitSlop={8}>
              <Text style={s.resultClose}>✕</Text>
            </Pressable>
          </View>
        )}

        {result && !result.isPractice && !result.error && gp && (
          <SectorBattle gpId={gp.id} dayIndex={result.dayIndex} myMs={result.ms} mySectors={result.sectorMs} />
        )}

        {loading ? (
          <ActivityIndicator color={RD.brand} style={{ marginTop: 24 }} />
        ) : !gp ? (
          <>
            <View style={s.actionsRow}>
              <Pressable style={[s.secondaryBtn, s.actionBtnFlex]} onPress={() => shareInvite(group)}>
                <Text style={s.secondaryBtnText}>Invitar</Text>
              </Pressable>
              <Pressable style={[s.cta, s.ctaFlex, starting && s.ctaDisabled]} disabled={starting} onPress={handleStart}>
                <Text style={s.ctaText}>{starting ? 'Arrancando…' : 'Iniciar Grand Prix'}</Text>
              </Pressable>
            </View>
            {!!err && <Text style={s.err}>{err}</Text>}
            <Text style={s.body}>
              7 circuitos exclusivos de este grupo, uno nuevo cada 24h desde que arranque. Clasificación
              estilo F1: 2 vueltas de práctica + la que cuenta.
            </Text>

            <Text style={s.labelMono}>MIEMBROS</Text>
            {members == null ? (
              <ActivityIndicator color={RD.brand} style={{ marginTop: 8 }} />
            ) : (
              <View style={s.membersList}>
                {members.map((m) => (
                  <View key={m.userId} style={s.memberRow}>
                    <Text style={s.memberName}>{m.nickname}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        ) : finished ? (
          <View style={s.panel}>
            <Text style={s.labelMono}>GRAND PRIX TERMINADO</Text>
            <Pressable style={s.cta} onPress={() => onViewStandings(gp)}>
              <Text style={s.ctaText}>Ver clasificación final</Text>
            </Pressable>
          </View>
        ) : (
          <View style={s.panel}>
            <Text style={s.labelMono}>{roundLabel(roundIdx, spec)}</Text>
            <Text style={s.body}>Ronda {roundIdx} de {gp.circuit_count}</Text>
            {!!countdown && <Text style={s.countdown}>Siguiente ronda en {countdown}</Text>}
            <Pressable style={s.cta} onPress={() => onPlayRound(gp, roundIdx)}>
              <Text style={s.ctaText}>Jugar</Text>
            </Pressable>
            <Pressable style={s.secondaryBtn} onPress={() => onViewStandings(gp)}>
              <Text style={s.secondaryBtnText}>Ver clasificación</Text>
            </Pressable>

            <Text style={[s.labelMono, { marginTop: 4 }]}>RESULTADOS DE HOY</Text>
            {roundResults == null ? (
              <ActivityIndicator color={RD.brand} style={{ marginTop: 8 }} />
            ) : roundResults.length === 0 ? (
              <Text style={s.body}>Nadie ha clasificado todavía en esta ronda.</Text>
            ) : (
              <View style={s.roundList}>
                {roundResults.map((r, i) => (
                  <View key={r.userId} style={s.roundRow}>
                    <Text style={s.roundPos}>{i + 1}</Text>
                    <Text style={s.roundName} numberOfLines={1}>{r.nickname}</Text>
                    <Text style={s.roundTime}>{fmtTime(r.ms)}</Text>
                    <Text style={s.roundGap}>{i === 0 ? '' : fmtGap(r.ms - roundResults[0].ms)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        <Pressable style={{ marginTop: 4 }} onPress={confirmLeave} disabled={leaving} hitSlop={8}>
          <Text style={s.leaveLink}>{leaving ? 'Saliendo…' : 'Salir del grupo'}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

export function GrandPrixStandings({ group, gp, onBack }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([getGroupMembers(group.id), getGpResults(gp.id)])
      .then(([members, results]) => { if (alive) setRows(computeStandings(results, members)); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [group.id, gp.id]);

  const leaderPoints = rows && rows.length ? rows[0].points : 0;

  return (
    <View style={s.screen}>
      <StatusBar hidden />
      <DangerStripe height={6} />
      <ScrollView contentContainerStyle={s.content}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={s.backLink}>‹ GRAND PRIX</Text>
        </Pressable>
        <Text style={s.pageTitle}>Clasificación</Text>
        <Text style={s.subtitle}>{group.name}</Text>

        {rows == null ? (
          <ActivityIndicator color={RD.brand} style={{ marginTop: 24 }} />
        ) : (
          <View style={s.standingsList}>
            {rows.map((r, i) => {
              const row = (
                <View
                  style={[
                    s.standingRow,
                    i === 0 && s.standingRowGold,
                    i === 1 && s.standingRowSilver,
                    i === 2 && s.standingRowBronze,
                  ]}
                >
                  <Text style={[s.standingPos, i === 0 && s.standingPosGold, i === 1 && s.standingPosSilver, i === 2 && s.standingPosBronze]}>
                    {i + 1}
                  </Text>
                  <View style={s.standingInfo}>
                    <Text style={s.standingName} numberOfLines={1}>{r.nickname}</Text>
                    {i > 0 && <Text style={s.standingGap}>-{leaderPoints - r.points} pts al líder</Text>}
                  </View>
                  <Text style={s.standingPoints}>{r.points}</Text>
                </View>
              );
              // El líder se revela con el brillo en bucle — mismo componente
              // que el reveal de sobres legendarios en Tienda.js.
              return i === 0
                ? <ShineBadge key={r.userId} style={s.standingRowShineWrap}>{row}</ShineBadge>
                : <View key={r.userId}>{row}</View>;
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RD.bg },
  content: { paddingHorizontal: 18, paddingTop: 50, paddingBottom: 40, gap: 14 },
  backLink: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono, marginBottom: 8 },
  pageTitle: {
    color: RD.textPrimary, fontSize: 28, fontFamily: RD_FONT.displayBlack,
    textTransform: 'uppercase', marginBottom: -8,
  },
  subtitle: { color: RD.textSecondary, fontSize: 14, fontFamily: RD_FONT.mono },

  panel: {
    borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2, padding: 16, gap: 10,
  },
  labelMono: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono, letterSpacing: 0.6 },
  body: { color: RD.textSecondary, fontSize: 13, fontFamily: RD_FONT.mono, lineHeight: 19 },
  countdown: { color: RD.brand, fontSize: 12, fontFamily: RD_FONT.monoBold },
  cta: { backgroundColor: RD.brand, borderRadius: 2, paddingVertical: 14, alignItems: 'center' },
  ctaFlex: { flex: 1.4 },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: RD.bg, fontSize: 14, fontFamily: RD_FONT.monoBold, textTransform: 'uppercase' },
  secondaryBtn: { borderWidth: 1, borderColor: RD.trackBlue, borderRadius: 2, paddingVertical: 12, alignItems: 'center' },
  secondaryBtnText: { color: RD.trackBlue, fontSize: 13, fontFamily: RD_FONT.monoBold },
  actionsRow: { flexDirection: 'row', gap: 10 },
  actionBtnFlex: { flex: 1 },
  err: { color: RD.danger, fontSize: 12, fontFamily: RD_FONT.mono, textAlign: 'center' },
  leaveLink: { color: RD.textTertiary, fontSize: 12, fontFamily: RD_FONT.mono, textAlign: 'center' },

  membersList: { gap: 1, backgroundColor: RD.gridLine },
  memberRow: { backgroundColor: RD.bg, paddingVertical: 10, paddingHorizontal: 12 },
  memberName: { color: RD.textPrimary, fontSize: 14, fontFamily: RD_FONT.monoBold },

  roundList: { gap: 1, backgroundColor: RD.gridLine },
  roundRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: RD.bg, paddingVertical: 9, paddingHorizontal: 12,
  },
  roundPos: { color: RD.textTertiary, fontSize: 12, fontFamily: RD_FONT.mono, width: 16 },
  roundName: { color: RD.textPrimary, fontSize: 13, fontWeight: '700', flex: 1 },
  roundTime: { color: RD.cream, fontSize: 12, fontFamily: RD_FONT.mono },
  roundGap: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono, width: 56, textAlign: 'right' },

  resultBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 2, paddingHorizontal: 12, paddingVertical: 10,
  },
  resultOk: { borderColor: RD.successGreen, backgroundColor: 'rgba(56,217,122,0.1)' },
  resultPractice: { borderColor: RD.panelBorder, backgroundColor: 'rgba(255,255,255,0.03)' },
  resultErr: { borderColor: RD.danger, backgroundColor: 'rgba(255,92,92,0.1)' },
  resultText: { color: RD.textPrimary, fontSize: 12, fontFamily: RD_FONT.mono, flex: 1, marginRight: 8 },
  resultClose: { color: RD.textSecondary, fontSize: 14 },

  sectorBattle: { borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2, padding: 12, gap: 8 },
  sectorRow: { flexDirection: 'row', gap: 10 },
  sectorChip: { flex: 1, alignItems: 'center', gap: 2, borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2, paddingVertical: 8 },
  sectorChipLabel: { color: RD.textTertiary, fontSize: 9, fontFamily: RD_FONT.mono, letterSpacing: 0.6 },
  sectorChipTime: { fontSize: 14, fontFamily: RD_FONT.monoBold, fontVariant: ['tabular-nums'] },

  standingsList: { gap: 8 },
  standingRowShineWrap: { borderRadius: 2 },
  standingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2, paddingVertical: 12, paddingHorizontal: 14,
  },
  standingRowGold: { borderColor: RD.gold1st },
  standingRowSilver: { borderColor: RD.silver2nd },
  standingRowBronze: { borderColor: RD.bronze3rd },
  standingPos: {
    width: 24, textAlign: 'center', color: RD.textSecondary, fontSize: 15, fontFamily: RD_FONT.monoBold,
  },
  standingPosGold: { color: RD.gold1st },
  standingPosSilver: { color: RD.silver2nd },
  standingPosBronze: { color: RD.bronze3rd },
  standingInfo: { flex: 1, gap: 2 },
  standingName: { color: RD.textPrimary, fontSize: 14, fontFamily: RD_FONT.monoBold },
  standingGap: { color: RD.textTertiary, fontSize: 10, fontFamily: RD_FONT.mono },
  standingPoints: {
    color: RD.textPrimary, fontSize: 16, fontFamily: RD_FONT.displayBlack, fontVariant: ['tabular-nums'],
  },
});

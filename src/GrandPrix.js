// ============================================================================
//  Grand Prix — GroupHome (pantalla propia de un grupo) y la clasificación de
//  la temporada. Jugar una ronda es responsabilidad de App.js (pantalla
//  completa, como el circuito diario y Modo Carrera) — esto pinta el "antes"
//  y el "después".
//
//  POR QUÉ NO SE PARECE AL DIARIO
//  ------------------------------
//  Antes sí se parecía, y ese era el problema: misma cabecera de rayas, mismo
//  rojo, misma lista vertical de filas ordenadas. Parecía el ranking global
//  en pequeño.
//
//  Pero son cosas distintas. El Diario es una CLASIFICACIÓN: una foto de hoy,
//  ordenada por tiempo, sin memoria y sin final. El Grand Prix es una
//  TEMPORADA: siete rondas, puntos que se acumulan, y un campeón al acabar.
//
//  Todo lo de aquí sale de esa diferencia:
//   - SeasonRail arriba: por dónde vas del recorrido. El Diario no puede
//     tener esto porque no va a ningún sitio.
//   - Azul (RD.trackBlue) en vez del rojo de marca: en esta app el azul ya
//     significaba "tu grupo".
//   - En la clasificación manda el PUNTO, no el tiempo, y cada jugador
//     arrastra su tira de rondas — de dónde vienen sus puntos. Eso es una
//     temporada contada de un vistazo, y es justo lo que una lista ordenada
//     por tiempo no dice.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, Pressable, ScrollView, Share, StatusBar, StyleSheet, Text, View } from 'react-native';

import SeasonRail, { GP_ACCENT } from './SeasonRail';
import ShineBadge from './ShineBadge';
import MiniTrackMap from './MiniTrackMap';
import AvatarThumb from './AvatarThumb';
import { RD, RD_FONT, SECTOR_RESULT_COLORS } from './theme';
import { CONFIG } from './config';
import { fmtTime, fmtSecs, fmtGap, fmtCountdown } from './format';
import { getActiveGrandPrix, startGrandPrix, getGroupMembers, getGpResults, getGpRoundLeader, getGpSectorRecords, leaveGroup, getMyId } from './api';
import { gpCircuitSpec, roundLabel, currentRoundIndex, nextRoundUnlockAt, gpFinished, computeStandings, lapTimesFromSectorMs } from './gpData';

// Ancho útil del mapa: pantalla menos el padding del ScrollView (18×2) menos
// el de la tarjeta de ronda (16×2).
const TRACK_W = Dimensions.get('window').width - 18 * 2 - 16 * 2;

// Diferencia con signo: negativo = vas más rápido. fmtSecs no lleva signo
// (recorta a 0), así que aquí se compone a mano.
function signed(ms) {
  return `${ms <= 0 ? '−' : '+'}${fmtSecs(Math.abs(ms))}s`;
}


// ---------------------------------------------------------------------------
//  Comparativa tú-vs-líder de la ronda, sector a sector.
//
//  Antes esto enseñaba TUS tiempos de sector coloreados en verde o rojo, y no
//  había forma de saber qué significaban: veías "13.402" en rojo sin saber
//  respecto a qué. Ahora se enseña LA DIFERENCIA, que es el dato que
//  importaba, con su signo, y con una línea que dice cómo se lee. El tiempo
//  absoluto no aportaba nada aquí: nadie compara 13.402 contra 13.615 de
//  cabeza, lo que quieres saber es que perdiste dos décimas.
// ---------------------------------------------------------------------------
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
      <View style={s.panel}>
        <Text style={s.panelLabel}>SECTORES</Text>
        <Text style={s.body}>Vas líder de esta ronda — todavía no hay con quién comparar.</Text>
      </View>
    );
  }

  const totalDelta = myMs - leader.ms;
  // Con las 3 vueltas cerradas del GP, mySectors/leader.sectorMs son 9
  // valores en orden vuelta-mayor ([v1_s1,v1_s2,v1_s3, v2_s1,...]) — se
  // agrupan de 3 en 3 para mostrar cada vuelta por separado, con su propio
  // subtotal, en vez de una lista plana de "sector 1/2/3" que ya no
  // describe la carrera entera.
  const laps = [];
  for (let lap = 0; lap * 3 < mySectors.length; lap++) {
    laps.push(mySectors.slice(lap * 3, lap * 3 + 3));
  }

  return (
    <View style={s.panel}>
      <Text style={s.panelLabel}>DÓNDE PIERDES CONTRA {leader.nickname.toUpperCase()}</Text>
      <Text style={s.hint}>En verde ganas tiempo, en rojo lo pierdes.</Text>

      <View style={s.deltaList}>
        {laps.map((lapSectors, lap) => {
          let lapDelta = 0;
          let lapHasData = false;
          const rows = lapSectors.map((ms, i) => {
            const theirs = leader.sectorMs[lap * 3 + i];
            if (theirs == null) {
              return (
                <View key={i} style={s.deltaRow}>
                  <Text style={s.deltaSector}>VUELTA {lap + 1} · SECTOR {i + 1}</Text>
                  <Text style={s.deltaNone}>sin dato</Text>
                </View>
              );
            }
            lapHasData = true;
            const d = ms - theirs;
            lapDelta += d;
            return (
              <View key={i} style={s.deltaRow}>
                <Text style={s.deltaSector}>VUELTA {lap + 1} · SECTOR {i + 1}</Text>
                <Text style={[s.deltaValue, { color: d <= 0 ? RD.successGreen : RD.danger }]}>{signed(d)}</Text>
              </View>
            );
          });
          return (
            <View key={lap}>
              {rows}
              {lapHasData && (
                <View style={s.deltaRow}>
                  <Text style={[s.deltaSector, s.deltaSectorTotal]}>VUELTA {lap + 1} COMPLETA</Text>
                  <Text style={[s.deltaValue, { color: lapDelta <= 0 ? RD.successGreen : RD.danger }]}>
                    {signed(lapDelta)}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
        <View style={s.deltaRule} />
        <View style={s.deltaRow}>
          <Text style={[s.deltaSector, s.deltaSectorTotal]}>CARRERA COMPLETA</Text>
          <Text style={[s.deltaValue, s.deltaValueTotal, { color: totalDelta <= 0 ? RD.successGreen : RD.danger }]}>
            {signed(totalDelta)}
          </Text>
        </View>
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

// Color por puesto del podio de LA RONDA (no de la general): 1.º morado —
// mismo tono que "mejor del mundo" en el resto de la app, el techo de
// prestigio — 2.º oro, 3.º plata, 4.º bronce. Antes solo el 1.º se
// distinguía (stripCellWin/GP_ACCENT); esto extiende el mismo patrón
// (relleno saturado + texto RD.bg) a las cuatro primeras plazas, que es
// donde de verdad se juega la general — JC: "aporta un poco más de color a
// la clasificación".
const ROUND_PODIUM = [
  SECTOR_RESULT_COLORS.purple, // 1.º — 25 pts
  RD.gold1st,                  // 2.º — 18 pts
  RD.silver2nd,                // 3.º — 15 pts
  RD.bronze3rd,                // 4.º — 12 pts
];

// Oro/plata/bronce — el morado de ROUND_PODIUM (arriba) es la firma de
// "mejor del mundo/sesión" en el resto de la app, no encaja para "quién va
// 1.º" a secas. Mismo patrón de array ya usado en MiniRanking.js
// (PODIUM_COLOR). Se reutiliza tanto para la clasificación de temporada
// (SEASON_PODIUM, nombre histórico) como para el 1-2-3 de la ronda de hoy
// (JC, 2026-09-09).
const SEASON_PODIUM = [RD.gold1st, RD.silver2nd, RD.bronze3rd];

// Tira de la temporada de un jugador: un hueco por ronda con los puntos que
// sacó. Es lo que convierte "tiene 61 puntos" en "de dónde salen esos 61".
function RoundStrip({ rounds, total }) {
  const cells = [];
  for (let i = 1; i <= total; i++) {
    const r = rounds[i];
    const podiumColor = r && ROUND_PODIUM[r.pos - 1];
    cells.push(
      <View
        key={i}
        style={[
          s.stripCell,
          r && s.stripCellRun,
          podiumColor && { backgroundColor: podiumColor },
        ]}
      >
        {/* Emblema morado de vuelta rápida (JC, 2026-09-09): un dato más
            sobre la misma celda, no sustituye los puntos — mismo espíritu
            que el color de podio de ROUND_PODIUM. */}
        {r?.fastestLap && <View style={s.stripFastestLap} />}
        <Text style={[s.stripText, r && s.stripTextRun, podiumColor && s.stripTextWin]}>
          {r ? r.pts : '·'}
        </Text>
      </View>
    );
  }
  return <View style={s.strip}>{cells}</View>;
}

// ---------------------------------------------------------------------------
//  Pantalla propia de un grupo.
// ---------------------------------------------------------------------------
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

  // Los miembros se cargan SIEMPRE (antes solo sin GP activo): ahora la lista
  // vive al pie de la pantalla en las dos situaciones, porque "quién está en
  // este grupo" es la pregunta que uno se hace también con el GP en marcha.
  useEffect(() => {
    if (loading) return;
    let alive = true;
    getGroupMembers(group.id).then((m) => { if (alive) setMembers(m); }).catch(() => { if (alive) setMembers([]); });
    return () => { alive = false; };
  }, [group.id, loading]);

  const [roundResults, setRoundResults] = useState(null);
  const [myId, setMyId] = useState(null);
  useEffect(() => { getMyId().then(setMyId).catch(() => {}); }, []);

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
      const msg = String(e?.message || '');
      const already = msg.includes('GP_ALREADY_ACTIVE');
      const needsMore = msg.includes('GP_NEEDS_3_PLAYERS');
      setErr(
        already ? 'Ya hay un Grand Prix activo en este grupo.'
        : needsMore ? 'Hacen falta al menos 3 jugadores en el grupo para arrancar un Grand Prix.'
        : 'No se pudo arrancar el Grand Prix.'
      );
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

  // Vuelta rápida de la ronda (JC: "si es vuelta rápida del circuito hay que
  // mostrarlo también") — `sectorMs` ahora son 9 valores en orden
  // vuelta-mayor (3 sectores × 3 vueltas, ver src/pieces.js/Game.js), no
  // "un valor por vuelta" — el tiempo de cada vuelta es la SUMA de su trío
  // de sectores. Mismo criterio que la "vuelta rápida" de la F1: la más
  // corta de TODAS las vueltas de TODOS, no el tiempo total.
  const fastestLap = useMemo(() => {
    if (!roundResults || roundResults.length === 0) return null;
    let best = null;
    for (const r of roundResults) {
      for (const lap of lapTimesFromSectorMs(r.sectorMs)) {
        if (best == null || lap < best.ms) best = { ms: lap, nickname: r.nickname, userId: r.userId };
      }
    }
    return best;
  }, [roundResults]);
  const myLapTimes = result && !result.isPractice && !result.error
    ? lapTimesFromSectorMs(result.sectorMs)
    : [];
  const myBestLap = myLapTimes.length ? Math.min(...myLapTimes) : null;

  // Récord de cada sector de HOY (JC, 2026-09-09: "en la clasificación diaria
  // hay que mostrar... quien tiene el récord de cada sector") — mismo dato
  // que ya usa Game.js para pintar el morado en pista (gp_sector_bests), solo
  // que aquí además hace falta saber QUIÉN (holder_id -> nickname via members,
  // ya cargado más abajo para la lista "EN EL GRUPO").
  const [sectorRecords, setSectorRecords] = useState(null);
  useEffect(() => {
    if (!gp || roundIdx == null) { setSectorRecords(null); return; }
    let alive = true;
    getGpSectorRecords(gp.id, roundIdx).then((r) => { if (alive) setSectorRecords(r); }).catch(() => { if (alive) setSectorRecords(null); });
    return () => { alive = false; };
  }, [gp?.id, roundIdx, result]);

  return (
    <View style={s.screen}>
      <StatusBar hidden />
      <ScrollView contentContainerStyle={s.content}>

        {/* Cabecera: el grupo es el sujeto, el GP es lo que le está pasando. */}
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={s.backLink}>‹ AMIGOS</Text>
        </Pressable>
        <View style={s.titleRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.pageTitle} numberOfLines={1}>{group.name}</Text>
            <Text style={s.subtitle}>CÓDIGO {group.join_code}</Text>
          </View>
          {/* Compartir SIEMPRE visible. Antes solo salía cuando NO había un GP
              activo, así que en cuanto arrancabas la temporada desaparecía la
              única forma de meter gente — justo cuando más ganas dan. */}
          <Pressable style={s.inviteBtn} onPress={() => shareInvite(group)} hitSlop={8}>
            <Text style={s.inviteBtnText}>COMPARTIR</Text>
          </Pressable>
        </View>

        {gp && <SeasonRail total={gp.circuit_count} current={roundIdx} finished={!!finished} />}

        {result && (
          <View style={[s.resultBanner, result.error ? s.resultErr : result.isPractice ? s.resultPractice : s.resultOk]}>
            <Text style={s.resultText}>
              {result.error
                ? 'No se pudo enviar el tiempo. Prueba otra vez.' +
                  (CONFIG.DIAG && result.errorMsg ? `\n(${result.errorMsg})` : '')
                : result.isPractice
                ? `Práctica — ${fmtTime(result.ms)} (no cuenta, quedan vueltas de práctica o ya clasifica la siguiente)`
                : `Clasificación ronda ${result.dayIndex} — ${fmtTime(result.ms)}${result.isBest ? ' · ¡mejor tiempo!' : ''}`}
              {myBestLap != null && (
                <Text style={s.resultLap}>
                  {'\n'}Vuelta rápida: {fmtTime(myBestLap)}
                  {fastestLap && fastestLap.userId === myId && fastestLap.ms === myBestLap ? ' · ¡la más rápida de la ronda!' : ''}
                </Text>
              )}
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
          <ActivityIndicator color={GP_ACCENT} style={{ marginTop: 24 }} />
        ) : !gp ? (
          <View style={s.panel}>
            <Text style={s.panelLabel}>GRAND PRIX</Text>
            <Text style={s.bigStatement}>Vuestro campeonato. 7 circuitos exclusivos del grupo.</Text>
            <Text style={s.body}>
              Un circuito cerrado nuevo cada día, con clima real. Sector a sector contra el resto del
              grupo, puntos como en la F1 — y al cabo de la semana, uno se corona campeón.
            </Text>
            <Text style={s.hint}>Mínimo 3 jugadores para arrancarlo.</Text>
            <Pressable style={[s.cta, starting && s.ctaDisabled]} disabled={starting} onPress={handleStart}>
              <Text style={s.ctaText}>{starting ? 'Arrancando…' : 'Arrancar Grand Prix'}</Text>
            </Pressable>
            {!!err && <Text style={s.err}>{err}</Text>}
          </View>
        ) : finished ? (
          <View style={s.panel}>
            <Text style={s.panelLabel}>GRAND PRIX TERMINADO</Text>
            <Text style={s.bigStatement}>Ya hay campeón.</Text>
            <Pressable style={s.cta} onPress={() => onViewStandings(gp)}>
              <Text style={s.ctaText}>Ver clasificación final</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* La ronda de hoy es lo único accionable de la pantalla, así que
                es lo único que va sobre fondo elevado y con el CTA lleno. */}
            <View style={s.roundCard}>
              {/* Sin "Ronda N": el SeasonRail de arriba ya dice "RONDA N DE 7"
                  — repetirlo aquí era ruido. Solo el circuito. */}
              <Text style={s.roundKicker}>{spec?.label}</Text>
              {/* El circuito, dibujado. El argumento del modo es "7 circuitos
                  que solo existen para este grupo" y la pantalla no enseñaba
                  ninguno: era una promesa en texto. Verlo es lo que lo hace
                  exclusivo, y además cada ronda pasa a tener cara propia. */}
              {spec?.track && (
                <View style={s.trackBox}>
                  <MiniTrackMap track={spec.track} w={TRACK_W} h={92} />
                </View>
              )}
              {!!countdown && <Text style={s.countdown}>La ronda {roundIdx + 1} abre en {countdown}</Text>}
              <Pressable style={s.cta} onPress={() => onPlayRound(gp, roundIdx)}>
                <Text style={s.ctaText}>Correr la ronda {roundIdx}</Text>
              </Pressable>
            </View>

            <View style={s.panel}>
              <View style={s.panelHead}>
                <Text style={s.panelLabel}>RONDA {roundIdx} · EN PISTA</Text>
                <Pressable onPress={() => onViewStandings(gp)} hitSlop={8}>
                  <Text style={s.linkAccent}>CLASIFICACIÓN ›</Text>
                </Pressable>
              </View>
              {(!!fastestLap || (!!sectorRecords && Object.keys(sectorRecords).length > 0)) && (
                <View style={s.recordsBlock}>
                  {!!fastestLap && (
                    <View style={s.fastestLapRow}>
                      <Text style={s.fastestLapLabel}>VUELTA RÁPIDA</Text>
                      <Text style={s.fastestLapText}>{fmtTime(fastestLap.ms)}</Text>
                      <Text style={s.fastestLapName} numberOfLines={1}>{fastestLap.nickname}</Text>
                    </View>
                  )}
                  {!!sectorRecords && Object.keys(sectorRecords).length > 0 && (
                    <View style={s.sectorRecordsGrid}>
                      {[0, 1, 2].map((sec) => {
                        const rec = sectorRecords[sec];
                        const holder = rec ? (members || []).find((m) => m.userId === rec.holderId) : null;
                        return (
                          <View key={sec} style={[s.sectorRecordCell, sec > 0 && s.sectorRecordCellDivider]}>
                            <Text style={s.sectorRecordLabel}>S{sec + 1}</Text>
                            <Text style={s.sectorRecordTime}>{rec ? `${fmtSecs(rec.ms)}s` : '—'}</Text>
                            <Text style={s.sectorRecordName} numberOfLines={1}>{holder ? holder.nickname : ''}</Text>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}
              {roundResults == null ? (
                <ActivityIndicator color={GP_ACCENT} style={{ marginTop: 8 }} />
              ) : roundResults.length === 0 ? (
                <Text style={s.body}>Nadie ha marcado tiempo todavía. Sé el primero y sal en cabeza.</Text>
              ) : (
                <View style={s.roundList}>
                  {roundResults.map((r, i) => {
                    // Podio de la ronda: 1.º oro, 2.º plata, 3.º bronce, el
                    // resto en azul (JC, 2026-09-09) — "LÍDER" va del mismo
                    // color que su número, el resto de gaps se quedan neutros.
                    const podiumColor = SEASON_PODIUM[i] || GP_ACCENT;
                    return (
                      <View key={r.userId} style={s.roundRow}>
                        <Text style={[s.roundPos, { color: podiumColor }]}>{i + 1}</Text>
                        <Text style={s.roundName} numberOfLines={1}>{r.nickname}</Text>
                        <Text style={s.roundTime}>{fmtTime(r.ms)}</Text>
                        <Text style={[s.roundGap, i === 0 && { color: podiumColor, fontFamily: RD_FONT.monoBold }]}>
                          {i === 0 ? 'LÍDER' : fmtGap(r.ms - roundResults[0].ms)}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </>
        )}

        <View style={s.panel}>
          <Text style={s.panelLabel}>EN EL GRUPO {members ? `· ${members.length}` : ''}</Text>
          {members == null ? (
            <ActivityIndicator color={GP_ACCENT} style={{ marginTop: 8 }} />
          ) : (
            <View style={s.membersWrap}>
              {members.map((m) => (
                <View key={m.userId} style={s.memberChip}>
                  <Text style={s.memberName}>{m.nickname}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <Pressable style={{ marginTop: 4 }} onPress={confirmLeave} disabled={leaving} hitSlop={8}>
          <Text style={s.leaveLink}>{leaving ? 'Saliendo…' : 'Salir del grupo'}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
//  Antesala de una ronda: calentar o jugártela a una vuelta.
//
//  Sale UNA vez por ronda, la primera que entras. Cada una de las 7 rondas es
//  un circuito distinto, así que la decisión no es la misma cada día: hay
//  trazados que pides calentar y otros que te ves capaz de bordar a la
//  primera.
//
//  No es una eleccion "cual es mejor" — a una vuelta tienes menos intentos y
//  ninguna red. Es "cuanto quieres arriesgar hoy", y por eso se enseña el
//  circuito antes de decidir.
// ---------------------------------------------------------------------------
export function RoundStart({ gp, roundIdx, onChoose, onBack }) {
  const spec = gpCircuitSpec(gp.id, roundIdx, gp.circuit_count);

  return (
    <View style={s.screen}>
      <StatusBar hidden />
      <ScrollView contentContainerStyle={s.content}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={s.backLink}>‹ VOLVER</Text>
        </Pressable>

        <SeasonRail total={gp.circuit_count} current={roundIdx} />
        <Text style={s.pageTitle}>{roundLabel(roundIdx, spec)}</Text>

        {spec?.track && (
          <View style={[s.panel, { paddingVertical: 10 }]}>
            <View style={s.trackBox}>
              <MiniTrackMap track={spec.track} w={TRACK_W} h={110} />
            </View>
          </View>
        )}

        <Text style={s.hint}>Solo se pregunta la primera vez que entras a esta ronda.</Text>

        <Pressable style={s.choiceCard} onPress={() => onChoose('practica')}>
          <Text style={s.choiceTitle}>Calentar primero</Text>
          <Text style={s.choiceBody}>
            Una carrera de prueba que no cuenta y luego la que clasifica. Si quieres repetir
            después, puedes ver un vídeo para un intento más.
          </Text>
          <Text style={s.choiceMeta}>2 INTENTOS · EL 2.º CUENTA</Text>
        </Pressable>

        <Pressable style={[s.choiceCard, s.choiceCardRisk]} onPress={() => onChoose('directo')}>
          <Text style={s.choiceTitle}>A la primera</Text>
          <Text style={s.choiceBody}>
            Sales y lo que marques en tus 3 vueltas es tu tiempo de la ronda. Sin ensayo — pero
            si quieres repetir, puedes ver un vídeo para un intento más.
          </Text>
          <Text style={[s.choiceMeta, { color: RD.danger }]}>1 INTENTO · CUENTA</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
//  Clasificación de la temporada.
//
//  Aquí manda el PUNTO, no el tiempo — es la diferencia de fondo con el
//  ranking del Diario. Y cada jugador arrastra su tira de rondas, que es de
//  dónde salen sus puntos: una temporada contada de un vistazo.
// ---------------------------------------------------------------------------
// Fila de clasificación con podio oro/plata/bronce — misma paleta que ya usa
// el panel "en pista" de GroupHome, extraída aquí porque la reutilizan tanto
// la general como el histórico por día.
function PodiumRow({ pos, nickname, ms, isLeader, gapMs }) {
  const podiumColor = SEASON_PODIUM[pos] || GP_ACCENT;
  return (
    <View style={s.roundRow}>
      <Text style={[s.roundPos, { color: podiumColor }]}>{pos + 1}</Text>
      <Text style={s.roundName} numberOfLines={1}>{nickname}</Text>
      <Text style={s.roundTime}>{fmtTime(ms)}</Text>
      <Text style={[s.roundGap, isLeader && { color: podiumColor, fontFamily: RD_FONT.monoBold }]}>
        {isLeader ? 'LÍDER' : fmtGap(gapMs)}
      </Text>
    </View>
  );
}

// Histórico de clasificaciones: la clasificación del DÍA para cada ronda ya
// jugada del GP — antes solo se veía la del día en curso (en GroupHome) y se
// perdía en cuanto abría la siguiente ronda (JC, 2026-09-09: "que se puedan
// ver las clasificaciones del día 1, del día 2, etc").
function HistoricStandings({ results, maxDay }) {
  const days = [];
  for (let d = 1; d <= maxDay; d++) days.push(d);
  const [day, setDay] = useState(maxDay);

  const dayRows = (results || [])
    .filter((r) => r.dayIndex === day)
    .sort((a, b) => a.ms - b.ms);

  if (days.length === 0) {
    return <Text style={s.body}>Todavía no se ha cerrado ninguna ronda.</Text>;
  }

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.dayPickerRow}>
        {days.map((d) => (
          <Pressable key={d} onPress={() => setDay(d)} style={[s.dayChip, d === day && s.dayChipActive]}>
            <Text style={[s.dayChipText, d === day && s.dayChipTextActive]}>RONDA {d}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {dayRows.length === 0 ? (
        <Text style={s.body}>Nadie marcó tiempo en esta ronda.</Text>
      ) : (
        <View style={s.roundList}>
          {dayRows.map((r, i) => (
            <PodiumRow key={r.userId} pos={i} nickname={r.nickname} ms={r.ms} isLeader={i === 0} gapMs={r.ms - dayRows[0].ms} />
          ))}
        </View>
      )}
    </>
  );
}

export function GrandPrixStandings({ group, gp, onBack, onOpenPlayer }) {
  const [members, setMembers] = useState(null);
  const [results, setResults] = useState(null);
  const [view, setView] = useState('general'); // 'general' | 'historico'

  useEffect(() => {
    let alive = true;
    Promise.all([getGroupMembers(group.id), getGpResults(gp.id)])
      .then(([m, r]) => { if (alive) { setMembers(m); setResults(r); } })
      .catch(() => { if (alive) { setMembers([]); setResults([]); } });
    return () => { alive = false; };
  }, [group.id, gp.id]);

  const rows = useMemo(() => (results && members ? computeStandings(results, members) : null), [results, members]);
  const leaderPoints = rows && rows.length ? rows[0].points : 0;
  const finished = gpFinished(gp);
  const roundIdx = finished ? null : currentRoundIndex(gp);
  // Días con ronda ya cerrada — la actual (en curso) no cuenta como
  // "histórico" todavía, ya se ve entera en la pantalla principal del GP.
  const maxHistoricDay = finished ? gp.circuit_count : Math.max(0, (roundIdx || 1) - 1);

  return (
    <View style={s.screen}>
      <StatusBar hidden />
      <ScrollView contentContainerStyle={s.content}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={s.backLink}>‹ {group.name.toUpperCase()}</Text>
        </Pressable>
        <Text style={s.pageTitle}>{finished ? 'Campeonato' : 'Clasificación'}</Text>
        <SeasonRail total={gp.circuit_count} current={roundIdx} finished={finished} />

        <View style={s.viewTabs}>
          <Pressable style={[s.viewTab, view === 'general' && s.viewTabActive]} onPress={() => setView('general')}>
            <Text style={[s.viewTabText, view === 'general' && s.viewTabTextActive]}>GENERAL</Text>
          </Pressable>
          <Pressable style={[s.viewTab, view === 'historico' && s.viewTabActive]} onPress={() => setView('historico')}>
            <Text style={[s.viewTabText, view === 'historico' && s.viewTabTextActive]}>HISTÓRICO</Text>
          </Pressable>
        </View>

        {rows == null ? (
          <ActivityIndicator color={GP_ACCENT} style={{ marginTop: 24 }} />
        ) : view === 'historico' ? (
          <HistoricStandings results={results} maxDay={maxHistoricDay} />
        ) : (
          <>
            <Text style={s.hint}>Cada hueco es una ronda. El número, los puntos que sacaste.</Text>
            <View style={s.standingsList}>
              {rows.map((r, i) => {
                const podiumColor = SEASON_PODIUM[i];
                const RowWrap = onOpenPlayer ? Pressable : View;
                const row = (
                  <RowWrap
                    style={[s.standingRow, i === 0 && s.standingRowLead, podiumColor && { borderColor: podiumColor }]}
                    {...(onOpenPlayer ? { onPress: () => onOpenPlayer(r) } : null)}
                  >
                    <Text style={[s.standingPos, i === 0 && s.standingPosLead]}>{i + 1}</Text>
                    <AvatarThumb pilotAvatarId={r.pilotAvatarId} size={52} />
                    <View style={s.standingInfo}>
                      <View style={s.standingNameRow}>
                        <Text style={s.standingName} numberOfLines={1}>{r.nickname}</Text>
                        {i > 0 && <Text style={s.standingGap}>−{leaderPoints - r.points}</Text>}
                      </View>
                      <RoundStrip rounds={r.rounds} total={gp.circuit_count} />
                    </View>
                    <View style={s.pointsBox}>
                      <Text style={[s.standingPoints, i === 0 && s.standingPointsLead]}>{r.points}</Text>
                      <Text style={s.pointsUnit}>PTS</Text>
                    </View>
                  </RowWrap>
                );
                return i === 0
                  ? <ShineBadge key={r.userId} style={{ borderRadius: 2 }}>{row}</ShineBadge>
                  : <View key={r.userId}>{row}</View>;
              })}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RD.bg },
  content: { paddingHorizontal: 18, paddingTop: 50, paddingBottom: 40, gap: 16 },
  backLink: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono, marginBottom: 4 },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  pageTitle: {
    color: RD.textPrimary, fontSize: 30, fontFamily: RD_FONT.displayBlack,
    textTransform: 'uppercase', marginBottom: -6,
  },
  subtitle: { color: RD.textTertiary, fontSize: 12, fontFamily: RD_FONT.mono },

  inviteBtn: {
    borderWidth: 1, borderColor: GP_ACCENT, borderRadius: 2,
    paddingHorizontal: 12, paddingVertical: 7, marginTop: 4,
  },
  inviteBtnText: { color: GP_ACCENT, fontSize: 11, fontFamily: RD_FONT.monoBold, letterSpacing: 1 },

  panel: { borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2, padding: 14, gap: 10 },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  panelLabel: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono, letterSpacing: 1.2 },
  linkAccent: { color: GP_ACCENT, fontSize: 11, fontFamily: RD_FONT.monoBold, letterSpacing: 0.8 },
  body: { color: RD.textSecondary, fontSize: 13, fontFamily: RD_FONT.mono, lineHeight: 20 },
  hint: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono, lineHeight: 16 },
  bigStatement: {
    color: RD.textPrimary, fontSize: 22, fontFamily: RD_FONT.displayBold,
    lineHeight: 25,
  },
  err: { color: RD.danger, fontSize: 12, fontFamily: RD_FONT.mono, textAlign: 'center' },
  leaveLink: { color: RD.textTertiary, fontSize: 12, fontFamily: RD_FONT.mono, textAlign: 'center' },

  // La ronda de hoy: lo único con fondo elevado de la pantalla.
  roundCard: {
    backgroundColor: '#12161b', borderWidth: 1, borderColor: GP_ACCENT,
    borderRadius: 2, padding: 16, gap: 10,
  },
  roundKicker: {
    color: RD.textPrimary, fontSize: 20, fontFamily: RD_FONT.displayBold,
    textTransform: 'uppercase',
  },
  countdown: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono },
  trackBox: { alignItems: 'center', paddingVertical: 4 },

  cta: { backgroundColor: GP_ACCENT, borderRadius: 2, paddingVertical: 14, alignItems: 'center' },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: RD.bg, fontSize: 14, fontFamily: RD_FONT.monoBold, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Las dos opciones pesan lo mismo en pantalla: no hay una "recomendada".
  // Lo único que las separa es el filete rojo de la arriesgada, que es un
  // aviso, no una jerarquía.
  choiceCard: {
    borderWidth: 1, borderColor: GP_ACCENT, borderRadius: 2,
    backgroundColor: '#12161b', padding: 16, gap: 7,
  },
  choiceCardRisk: { borderColor: RD.danger },
  choiceTitle: { color: RD.textPrimary, fontSize: 21, fontFamily: RD_FONT.displayBold },
  choiceBody: { color: RD.textSecondary, fontSize: 13, fontFamily: RD_FONT.mono, lineHeight: 19 },
  choiceMeta: { color: GP_ACCENT, fontSize: 11, fontFamily: RD_FONT.monoBold, letterSpacing: 1.2 },

  membersWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  memberChip: {
    borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  memberName: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.monoBold },

  roundList: { gap: 1, backgroundColor: RD.gridLine },
  roundRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: RD.bg, paddingVertical: 10, paddingHorizontal: 10,
  },
  roundPos: { fontSize: 12, fontFamily: RD_FONT.monoBold, width: 14 },
  roundName: { color: RD.textPrimary, fontSize: 13, fontFamily: RD_FONT.monoBold, flex: 1 },
  roundTime: { color: RD.cream, fontSize: 12, fontFamily: RD_FONT.mono, fontVariant: ['tabular-nums'] },
  roundGap: {
    color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono,
    width: 58, textAlign: 'right', fontVariant: ['tabular-nums'],
  },

  resultBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 2, paddingHorizontal: 12, paddingVertical: 10,
  },
  resultOk: { borderColor: RD.successGreen, backgroundColor: 'rgba(56,217,122,0.1)' },
  resultPractice: { borderColor: RD.panelBorder, backgroundColor: 'rgba(255,255,255,0.03)' },
  resultErr: { borderColor: RD.danger, backgroundColor: 'rgba(255,92,92,0.1)' },
  resultText: { color: RD.textPrimary, fontSize: 12, fontFamily: RD_FONT.mono, flex: 1, marginRight: 8 },
  resultLap: { color: SECTOR_RESULT_COLORS.purple, fontFamily: RD_FONT.monoBold },
  resultClose: { color: RD.textSecondary, fontSize: 14 },
  // Records de la ronda (vuelta rápida + mejor de cada sector) — un bloque
  // propio con borde de hairline, no una fila de texto que se parte en dos
  // líneas (JC, 2026-09-09: "no me gusta que ocupen fila y media").
  recordsBlock: {
    borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    marginBottom: 10, overflow: 'hidden',
  },
  fastestLapRow: {
    flexDirection: 'row', alignItems: 'baseline', gap: 8,
    paddingHorizontal: 10, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: RD.panelBorder,
  },
  fastestLapLabel: {
    color: SECTOR_RESULT_COLORS.purple, fontSize: 10, fontFamily: RD_FONT.monoBold,
    letterSpacing: 0.8,
  },
  fastestLapText: {
    color: SECTOR_RESULT_COLORS.purple, fontSize: 13, fontFamily: RD_FONT.monoBold,
    fontVariant: ['tabular-nums'],
  },
  fastestLapName: { color: RD.textSecondary, fontSize: 11, fontFamily: RD_FONT.mono, flex: 1, textAlign: 'right' },
  sectorRecordsGrid: { flexDirection: 'row' },
  sectorRecordCell: { flex: 1, alignItems: 'center', paddingVertical: 8, gap: 2 },
  sectorRecordCellDivider: { borderLeftWidth: 1, borderLeftColor: RD.panelBorder },
  sectorRecordLabel: { color: RD.textTertiary, fontSize: 10, fontFamily: RD_FONT.mono, letterSpacing: 0.8 },
  sectorRecordTime: { color: RD.textPrimary, fontSize: 13, fontFamily: RD_FONT.monoBold, fontVariant: ['tabular-nums'] },
  sectorRecordName: { color: RD.textTertiary, fontSize: 10, fontFamily: RD_FONT.mono, maxWidth: '100%' },

  deltaList: { gap: 1, backgroundColor: RD.gridLine },
  deltaRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: RD.bg, paddingVertical: 9, paddingHorizontal: 10,
  },
  deltaSector: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono, letterSpacing: 0.8 },
  deltaSectorTotal: { color: RD.textPrimary, fontFamily: RD_FONT.monoBold },
  deltaValue: { fontSize: 15, fontFamily: RD_FONT.monoBold, fontVariant: ['tabular-nums'] },
  deltaValueTotal: { fontSize: 18 },
  deltaNone: { color: RD.textDisabled, fontSize: 12, fontFamily: RD_FONT.mono },
  deltaRule: { height: 1, backgroundColor: RD.panelBorder },

  // General vs. Histórico (JC, 2026-09-09) — mismo lenguaje de pestaña ya
  // usado en el resto de la app (subrayado + texto de marca en la activa).
  viewTabs: { flexDirection: 'row', gap: 4, isolation: 'isolate' },
  viewTab: {
    flex: 1, alignItems: 'center', paddingVertical: 9,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  viewTabActive: { borderBottomColor: GP_ACCENT },
  viewTabText: { color: RD.textTertiary, fontSize: 12, fontFamily: RD_FONT.monoBold, letterSpacing: 1 },
  viewTabTextActive: { color: RD.textPrimary },

  dayPickerRow: { flexDirection: 'row', flexGrow: 0, marginBottom: 4 },
  dayChip: {
    borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    paddingHorizontal: 12, paddingVertical: 7, marginRight: 6,
  },
  dayChipActive: { borderColor: GP_ACCENT, backgroundColor: 'rgba(79,169,255,0.12)' },
  dayChipText: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.monoBold, letterSpacing: 0.5 },
  dayChipTextActive: { color: GP_ACCENT },

  standingsList: { gap: 8 },
  standingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    paddingVertical: 12, paddingHorizontal: 12, backgroundColor: RD.bg,
  },
  standingRowLead: { borderColor: GP_ACCENT, backgroundColor: '#12161b' },
  standingPos: {
    width: 20, textAlign: 'center', color: RD.textTertiary,
    fontSize: 15, fontFamily: RD_FONT.monoBold,
  },
  standingPosLead: { color: GP_ACCENT },
  standingInfo: { flex: 1, gap: 7, minWidth: 0 },
  standingNameRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  standingName: { color: RD.textPrimary, fontSize: 15, fontFamily: RD_FONT.monoBold, flexShrink: 1 },
  standingGap: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono },

  strip: { flexDirection: 'row', gap: 3 },
  stripCell: {
    flex: 1, height: 18, borderRadius: 1, backgroundColor: RD.gridLine,
    alignItems: 'center', justifyContent: 'center',
    isolation: 'isolate',
  },
  stripCellRun: { backgroundColor: 'rgba(79,169,255,0.18)' },
  // Anillo con borde de contraste garantizado: la celda de la ronda que
  // ganaste (ROUND_PODIUM) YA es de fondo morado, así que un punto morado a
  // secas se camuflaba encima (visto en el dispositivo real) — el borde del
  // color de fondo de la propia app lo separa de cualquier color de celda.
  stripFastestLap: {
    position: 'absolute', top: 1, right: 1, width: 7, height: 7, borderRadius: 4,
    backgroundColor: SECTOR_RESULT_COLORS.purple,
    borderWidth: 1.5, borderColor: RD.bg,
  },
  stripText: { color: RD.textDisabled, fontSize: 10, fontFamily: RD_FONT.mono },
  stripTextRun: { color: RD.textPrimary, fontFamily: RD_FONT.monoBold },
  stripTextWin: { color: RD.bg, fontFamily: RD_FONT.monoBold },

  pointsBox: { alignItems: 'center', minWidth: 40 },
  standingPoints: {
    color: RD.textPrimary, fontSize: 26, fontFamily: RD_FONT.displayBlack,
    fontVariant: ['tabular-nums'], lineHeight: 28,
  },
  standingPointsLead: { color: GP_ACCENT },
  pointsUnit: { color: RD.textDisabled, fontSize: 9, fontFamily: RD_FONT.mono, letterSpacing: 1 },
});

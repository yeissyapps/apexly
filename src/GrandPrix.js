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

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, Pressable, ScrollView, Share, StatusBar, StyleSheet, Text, View } from 'react-native';

import SeasonRail, { GP_ACCENT } from './SeasonRail';
import ShineBadge from './ShineBadge';
import MiniTrackMap from './MiniTrackMap';
import { RD, RD_FONT, SECTOR_RESULT_COLORS } from './theme';
import { CONFIG } from './config';
import { fmtTime, fmtSecs, fmtGap, fmtCountdown } from './format';
import { getActiveGrandPrix, startGrandPrix, getGroupMembers, getGpResults, getGpRoundLeader, leaveGroup, getMyId } from './api';
import { gpCircuitSpec, roundLabel, currentRoundIndex, nextRoundUnlockAt, gpFinished, computeStandings } from './gpData';

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

  return (
    <View style={s.panel}>
      <Text style={s.panelLabel}>DÓNDE PIERDES CONTRA {leader.nickname.toUpperCase()}</Text>
      <Text style={s.hint}>En verde ganas tiempo, en rojo lo pierdes.</Text>

      <View style={s.deltaList}>
        {mySectors.map((ms, i) => {
          const theirs = leader.sectorMs[i];
          if (theirs == null) {
            return (
              <View key={i} style={s.deltaRow}>
                <Text style={s.deltaSector}>SECTOR {i + 1}</Text>
                <Text style={s.deltaNone}>sin dato</Text>
              </View>
            );
          }
          const d = ms - theirs;
          return (
            <View key={i} style={s.deltaRow}>
              <Text style={s.deltaSector}>SECTOR {i + 1}</Text>
              <Text style={[s.deltaValue, { color: d <= 0 ? RD.successGreen : RD.danger }]}>{signed(d)}</Text>
            </View>
          );
        })}
        <View style={s.deltaRule} />
        <View style={s.deltaRow}>
          <Text style={[s.deltaSector, s.deltaSectorTotal]}>VUELTA COMPLETA</Text>
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

// La frase que SOLO puede decir un campeonato.
//
// El ranking del Diario nunca puede escribir esto: no tiene acumulado ni
// final, así que lo máximo que sabe decir es en qué puesto vas hoy. Aquí hay
// un marcador que se arrastra y unas rondas que se acaban, y eso es lo que
// genera la tensión — "a 12 puntos y quedan dos" es una situación, no un dato.
//
// Devuelve null si no hay nada que contar todavía (nadie ha puntuado).
function fraseCampeonato(standings, myId, roundIdx, total) {
  if (!standings || standings.length === 0 || !myId) return null;
  const quedan = total - roundIdx + 1; // incluye la ronda en curso
  const cola = quedan === 1 ? 'última ronda' : `quedan ${quedan} rondas`;

  const i = standings.findIndex((r) => r.userId === myId);
  if (i < 0) return null;
  const yo = standings[i];

  // Nadie ha puntuado aún: no hay campeonato del que hablar.
  if (standings[0].points === 0) return null;

  if (yo.points === 0) return `Todavía sin puntuar · ${cola}`;

  if (i === 0) {
    const segundo = standings[1];
    const ventaja = segundo ? yo.points - segundo.points : 0;
    if (!segundo || ventaja === 0) return `Vas líder · ${cola}`;
    return `Vas líder · ${ventaja} pts sobre ${segundo.nickname} · ${cola}`;
  }

  const lider = standings[0];
  return `Vas ${i + 1}.º · a ${lider.points - yo.points} pts de ${lider.nickname} · ${cola}`;
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

  // De la MISMA consulta salen dos cosas: los tiempos de la ronda en curso y
  // la general acumulada (para la frase de campeonato). Antes solo se sacaba
  // lo primero y se tiraba el resto.
  const [roundResults, setRoundResults] = useState(null);
  const [standings, setStandings] = useState(null);
  const [myId, setMyId] = useState(null);
  useEffect(() => { getMyId().then(setMyId).catch(() => {}); }, []);

  useEffect(() => {
    if (!gp || gpFinished(gp)) { setRoundResults(null); setStandings(null); return; }
    const dayIndex = currentRoundIndex(gp);
    let alive = true;
    getGpResults(gp.id).then((rows) => {
      if (!alive) return;
      setRoundResults(rows.filter((r) => r.dayIndex === dayIndex).sort((a, b) => a.ms - b.ms));
      setStandings(computeStandings(rows, members || []));
    }).catch(() => { if (alive) { setRoundResults([]); setStandings([]); } });
    return () => { alive = false; };
  }, [gp?.id, result, members]);

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
  const frase = gp && !finished ? fraseCampeonato(standings, myId, roundIdx, gp.circuit_count) : null;

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
            <Text style={s.panelLabel}>TEMPORADA</Text>
            <Text style={s.bigStatement}>7 circuitos que solo existen para este grupo.</Text>
            <Text style={s.body}>
              Uno nuevo cada 24 h desde que arranque. Formato clasificación: 2 vueltas de práctica y
              la siguiente ya cuenta. Puntos como en la F1 — 25 al primero, 18 al segundo — y quien
              más sume en las 7 rondas gana.
            </Text>
            <Pressable style={[s.cta, starting && s.ctaDisabled]} disabled={starting} onPress={handleStart}>
              <Text style={s.ctaText}>{starting ? 'Arrancando…' : 'Arrancar temporada'}</Text>
            </Pressable>
            {!!err && <Text style={s.err}>{err}</Text>}
          </View>
        ) : finished ? (
          <View style={s.panel}>
            <Text style={s.panelLabel}>TEMPORADA TERMINADA</Text>
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
              <Text style={s.roundKicker}>{roundLabel(roundIdx, spec)}</Text>
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

            {!!frase && (
              <View style={s.tensionBar}>
                <Text style={s.tensionText}>{frase}</Text>
              </View>
            )}

            <View style={s.panel}>
              <View style={s.panelHead}>
                <Text style={s.panelLabel}>RONDA {roundIdx} · EN PISTA</Text>
                <Pressable onPress={() => onViewStandings(gp)} hitSlop={8}>
                  <Text style={s.linkAccent}>CLASIFICACIÓN ›</Text>
                </Pressable>
              </View>
              {roundResults == null ? (
                <ActivityIndicator color={GP_ACCENT} style={{ marginTop: 8 }} />
              ) : roundResults.length === 0 ? (
                <Text style={s.body}>Nadie ha marcado tiempo todavía. Sé el primero y sal en cabeza.</Text>
              ) : (
                <View style={s.roundList}>
                  {roundResults.map((r, i) => (
                    <View key={r.userId} style={s.roundRow}>
                      <Text style={[s.roundPos, i === 0 && s.roundPosLead]}>{i + 1}</Text>
                      <Text style={s.roundName} numberOfLines={1}>{r.nickname}</Text>
                      <Text style={s.roundTime}>{fmtTime(r.ms)}</Text>
                      <Text style={[s.roundGap, i === 0 && s.roundGapLead]}>
                        {i === 0 ? 'LÍDER' : fmtGap(r.ms - roundResults[0].ms)}
                      </Text>
                    </View>
                  ))}
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
            Dos vueltas de prueba que no cuentan y luego la que clasifica. Tres intentos en total.
          </Text>
          <Text style={s.choiceMeta}>3 VUELTAS · LA 3.ª CUENTA</Text>
        </Pressable>

        <Pressable style={[s.choiceCard, s.choiceCardRisk]} onPress={() => onChoose('directo')}>
          <Text style={s.choiceTitle}>A la primera</Text>
          <Text style={s.choiceBody}>
            Sales y lo que marques es tu tiempo de la ronda. Sin ensayo y sin segunda oportunidad.
          </Text>
          <Text style={[s.choiceMeta, { color: RD.danger }]}>1 VUELTA · CUENTA</Text>
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
  const finished = gpFinished(gp);
  const roundIdx = finished ? null : currentRoundIndex(gp);

  return (
    <View style={s.screen}>
      <StatusBar hidden />
      <ScrollView contentContainerStyle={s.content}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={s.backLink}>‹ {group.name.toUpperCase()}</Text>
        </Pressable>
        <Text style={s.pageTitle}>{finished ? 'Campeonato' : 'Clasificación'}</Text>
        <SeasonRail total={gp.circuit_count} current={roundIdx} finished={finished} />

        {rows == null ? (
          <ActivityIndicator color={GP_ACCENT} style={{ marginTop: 24 }} />
        ) : (
          <>
            <Text style={s.hint}>Cada hueco es una ronda. El número, los puntos que sacaste.</Text>
            <View style={s.standingsList}>
              {rows.map((r, i) => {
                const row = (
                  <View style={[s.standingRow, i === 0 && s.standingRowLead]}>
                    <Text style={[s.standingPos, i === 0 && s.standingPosLead]}>{i + 1}</Text>
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
                  </View>
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

  // La frase de campeonato va en su propia banda, pegada bajo la ronda: es
  // una situación, no un dato más de un panel.
  tensionBar: {
    borderLeftWidth: 3, borderLeftColor: GP_ACCENT,
    paddingLeft: 11, paddingVertical: 3,
  },
  tensionText: { color: RD.textPrimary, fontSize: 14, fontFamily: RD_FONT.monoBold, lineHeight: 19 },

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
  roundPos: { color: RD.textTertiary, fontSize: 12, fontFamily: RD_FONT.monoBold, width: 14 },
  roundPosLead: { color: GP_ACCENT },
  roundName: { color: RD.textPrimary, fontSize: 13, fontFamily: RD_FONT.monoBold, flex: 1 },
  roundTime: { color: RD.cream, fontSize: 12, fontFamily: RD_FONT.mono, fontVariant: ['tabular-nums'] },
  roundGap: {
    color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono,
    width: 58, textAlign: 'right', fontVariant: ['tabular-nums'],
  },
  roundGapLead: { color: GP_ACCENT, fontFamily: RD_FONT.monoBold },

  resultBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 2, paddingHorizontal: 12, paddingVertical: 10,
  },
  resultOk: { borderColor: RD.successGreen, backgroundColor: 'rgba(56,217,122,0.1)' },
  resultPractice: { borderColor: RD.panelBorder, backgroundColor: 'rgba(255,255,255,0.03)' },
  resultErr: { borderColor: RD.danger, backgroundColor: 'rgba(255,92,92,0.1)' },
  resultText: { color: RD.textPrimary, fontSize: 12, fontFamily: RD_FONT.mono, flex: 1, marginRight: 8 },
  resultClose: { color: RD.textSecondary, fontSize: 14 },

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
  },
  stripCellRun: { backgroundColor: 'rgba(79,169,255,0.18)' },
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

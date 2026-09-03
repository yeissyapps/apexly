// Ranking compacto del rediseño "Parrilla": pestañas GLOBAL + tus grupos + Grupo,
// podio 3 columnas (líderes fijos, top 1-3) + bloque "tu entorno" (siempre 3
// filas, formato lista horizontal). Usado en Inicio y Resultado.
//
// No hay pantalla de Ranking dedicada — este widget lleva su propio cambio de
// ámbito (Global/grupo) para que "tu entorno" y el ranking del grupo vivan
// aquí directamente.
//
// La ventana de "tu entorno" (solo en Global, donde puede haber miles de
// filas) reutiliza la misma lógica que el antiguo GlobalBoard de Leaderboard.js
// (líderes fijos + ventana de 3 sin invadir el podio ni salirse del total). En
// un grupo (siempre pocos miembros) no hace falta ventana: se listan todos.

import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { getGlobalBoard, getLeaderboard, listMyGroups, getWorldWinCounts } from './api';
import { fmtTime } from './format';
import { RD, RD_FONT } from './theme';
import { frameById, frameStyle, frameGlyphColor } from './frames';

export default function MiniRanking({ refreshKey = 0, showTabs = true, onManageGroups }) {
  const [groups, setGroups] = useState([]);
  const [scope, setScope] = useState('global');
  const isGlobal = scope === 'global';

  useEffect(() => {
    let alive = true;
    listMyGroups().then((gs) => { if (alive) setGroups(gs); }).catch(() => {});
    return () => { alive = false; };
  }, [refreshKey]);

  const [board, setBoard] = useState(null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);
  // Cuántas veces ha sido cada uno 1.º del mundo — JC: "molaría que fuera
  // acumulativo y que se pudiera ver las veces que ha quedado primero del
  // mundo". Un solo lote por las filas que de verdad están en pantalla, no
  // una consulta por fila.
  const [winCounts, setWinCounts] = useState({});

  useEffect(() => {
    let alive = true;
    setError(false); setBoard(null); setRows(null); setWinCounts({});
    const load = isGlobal ? getGlobalBoard() : getLeaderboard(scope);
    load
      .then((res) => {
        if (!alive) return;
        if (isGlobal) setBoard(res); else setRows(res);
        const ids = isGlobal
          ? [...(res.top || []), res.me, ...(res.aboveRows || []), ...(res.belowRows || [])].filter(Boolean).map((r) => r.userId)
          : (res || []).map((r) => r.userId);
        getWorldWinCounts(ids).then((wc) => { if (alive) setWinCounts(wc); }).catch(() => {});
      })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [scope, refreshKey]);

  const tabs = showTabs ? (
    <View style={styles.tabsRow}>
      <Tab label="GLOBAL" active={isGlobal} onPress={() => setScope('global')} />
      {groups.map((g, i) => (
        <Tab
          key={g.id}
          label={g.name}
          active={scope === g.id}
          color={GROUP_TAB_COLORS[i % GROUP_TAB_COLORS.length]}
          onPress={() => setScope(g.id)}
        />
      ))}
      <Tab label="+ GRUPO" dashed onPress={onManageGroups} />
    </View>
  ) : null;

  if (isGlobal) {
    if (error) return <>{tabs}<Text style={styles.muted}>No se pudo cargar el ranking.</Text></>;
    if (!board) return <>{tabs}<View style={styles.center}><ActivityIndicator color={RD.brand} /></View></>;
    if (board.total === 0) return <>{tabs}<Text style={styles.muted}>Aún no hay tiempos. ¡Sé el primero!</Text></>;

    const { top, me, aboveRows, belowRows, total } = board;
    const podium = top.slice(0, 3);

    let entorno = [];
    if (me) {
      if (me.rank <= 3 || total <= 6) {
        entorno = top.slice(3, 6);
      } else {
        const windowStart = Math.max(4, Math.min(me.rank - 1, total - 2));
        const delta = windowStart - me.rank; // -2 (último), -1 (centrado), 0 (4.º)
        if (delta === -1) entorno = [aboveRows[0], me, belowRows[0]].filter(Boolean);
        else if (delta === 0) entorno = [me, belowRows[0], belowRows[1]].filter(Boolean);
        else entorno = [aboveRows[1], aboveRows[0], me].filter(Boolean);
      }
    }

    return (
      <>
        {tabs}
        <Text style={styles.totalLabel}>
          {total} {total === 1 ? 'jugador ha corrido hoy' : 'jugadores han corrido hoy'}
        </Text>
        {podium.length >= 3 ? (
          <Podium rows={podium} winCounts={winCounts} />
        ) : (
          <View style={styles.list}>
            {podium.map((r, i) => <RankRow key={r.userId} r={{ ...r, rank: i + 1 }} wins={winCounts[r.userId]} />)}
          </View>
        )}

        {entorno.length > 0 ? (
          <View style={styles.list}>
            {entorno.map((r) => <RankRow key={r.userId} r={r} wins={winCounts[r.userId]} />)}
          </View>
        ) : !me ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>— · Juega para entrar</Text>
            <Text style={styles.placeholderHint}>tu puesto aparecerá aquí</Text>
          </View>
        ) : null}
      </>
    );
  }

  // Ámbito de grupo: siempre pocos miembros, se listan todos sin ventana.
  if (error) return <>{tabs}<Text style={styles.muted}>No se pudo cargar el ranking.</Text></>;
  if (!rows) return <>{tabs}<View style={styles.center}><ActivityIndicator color={RD.brand} /></View></>;
  if (rows.length === 0) return <>{tabs}<Text style={styles.muted}>Nadie de este grupo ha jugado hoy.</Text></>;

  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <>
      {tabs}
      {podium.length >= 3 ? (
        <Podium rows={podium} winCounts={winCounts} />
      ) : (
        <View style={styles.list}>
          {podium.map((r) => <RankRow key={r.userId} r={r} wins={winCounts[r.userId]} />)}
        </View>
      )}
      {rest.length > 0 && (
        <View style={styles.list}>
          {rest.map((r) => <RankRow key={r.userId} r={r} wins={winCounts[r.userId]} />)}
        </View>
      )}
    </>
  );
}

// Cada grupo (máx. 3 por jugador) tiene su propio color fijo según su posición
// en la lista — así se reconoce de un vistazo sin leer el nombre. Global se
// queda neutro (crema/gris) porque no es "uno más", es el ámbito por defecto.
const GROUP_TAB_COLORS = [RD.trackBlue, RD.youMagenta, RD.successGreen];

function Tab({ label, active, dashed, onPress, color }) {
  const borderColor = color || (active ? RD.cream : '#3a3a3a');
  const textColor = color || (active ? RD.cream : RD.textDisabled);
  return (
    <Pressable onPress={onPress} style={[styles.tab, { borderColor }, dashed && styles.tabDashed]}>
      <Text style={[styles.tabText, { color: textColor }, active && styles.tabTextBold]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

// Fila de lista horizontal: puesto — nombre — tiempo. Sin avatar.
//
// El MARCO va sobre el estilo de "tú" (fondo magenta), no en su lugar: el
// magenta sigue diciendo "esta fila eres tú" y el marco añade el acabado. Y
// se pinta el de TODOS, no solo el propio — es justo lo que hace que la
// pieza tenga sentido: es la única de la colección que ve el resto.
function RankRow({ r, wins }) {
  const f = frameById(r.frame);
  return (
    <View style={[styles.row, r.isMe && styles.rowMe, frameStyle(f, RD)]}>
      <View style={styles.rowLeft}>
        <Text style={[styles.rowRank, r.isMe && styles.rowRankMe]}>{String(r.rank).padStart(2, '0')}</Text>
        <Text style={[styles.rowName, r.isMe && styles.rowNameMe]} numberOfLines={1}>
          {r.isMe ? `${r.nickname} (tú)` : r.nickname}
        </Text>
        {!!f.glyph && <Text style={[styles.rowGlyph, { color: frameGlyphColor(f, RD) }]}>{f.glyph}</Text>}
        {/* Cuántas veces ha sido 1.º del mundo, no solo si lo ha sido —
            independiente de si hoy lleva puesta la corona o cambió de marco:
            es un hecho de la cuenta, no del cosmético equipado. */}
        {wins > 0 && <Text style={[styles.rowWins, { color: RD.gold1st }]}>×{wins}</Text>}
      </View>
      <Text style={styles.rowTime}>{fmtTime(r.bestMs)}</Text>
    </View>
  );
}

// Podio clásico: 1º al centro (más grande, oro), 2º a la izquierda (plata),
// 3º a la derecha (bronce), ambos más pequeños — siempre visible sea cual sea
// tu posición (no se sustituye por "tu entorno", va aparte y encima). El
// puesto es el propio número, grande, en mono (como el resto de datos
// numéricos de la app), con una sombra de contraste dura (sin difuminar) que
// da un aire de placa grabada/metálica en vez del halo de neón anterior.
const PODIUM_COLOR = [RD.gold1st, RD.silver2nd, RD.bronze3rd];
const PODIUM_SHADE = [RD.gold1stShade, RD.silver2ndShade, RD.bronze3rdShade];

function Podium({ rows, winCounts = {} }) {
  const order = [rows[1], rows[0], rows[2]]; // 2º - 1º - 3º
  return (
    <View style={styles.podiumRow}>
      {order.map((r) => {
        const place = r === rows[0] ? 1 : r === rows[1] ? 2 : 3;
        const color = PODIUM_COLOR[place - 1];
        const shade = PODIUM_SHADE[place - 1];
        const big = place === 1;
        const wins = winCounts[r.userId];
        return (
          <View key={r.userId} style={styles.podiumCol}>
            <Text
              style={[
                big ? styles.podiumNumBig : styles.podiumNumSmall,
                { color, textShadowColor: shade },
              ]}
            >
              {place}
            </Text>
            <Text style={styles.rowName} numberOfLines={1}>{r.isMe ? 'Tú' : r.nickname}</Text>
            <Text style={styles.rowTime}>{fmtTime(r.bestMs)}</Text>
            {wins > 0 && <Text style={[styles.rowWins, { color: RD.gold1st }]}>×{wins} mundial{wins === 1 ? '' : 'es'}</Text>}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { paddingVertical: 20, alignItems: 'center' },
  muted: { color: RD.textTertiary, fontSize: 14, fontFamily: RD_FONT.mono, paddingVertical: 10 },

  tabsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 2 },
  tab: { borderWidth: 1, borderColor: '#3a3a3a', paddingHorizontal: 10, paddingVertical: 5, maxWidth: 150 },
  tabDashed: { borderStyle: 'dashed' },
  tabText: { color: RD.textDisabled, fontSize: 11, fontFamily: RD_FONT.mono },
  tabTextBold: { fontFamily: RD_FONT.monoBold },

  podiumRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 18, paddingVertical: 4 },
  podiumCol: { alignItems: 'center', gap: 2, width: 80 },
  podiumNumBig: {
    fontSize: 48, lineHeight: 52, fontFamily: RD_FONT.monoBold,
    textShadowOffset: { width: 2, height: 2 }, textShadowRadius: 0,
  },
  podiumNumSmall: {
    fontSize: 34, lineHeight: 38, fontFamily: RD_FONT.monoBold,
    textShadowOffset: { width: 1.5, height: 1.5 }, textShadowRadius: 0,
  },

  list: { flexDirection: 'column', gap: 1, backgroundColor: RD.gridLine },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: RD.bg, paddingVertical: 9, paddingHorizontal: 12, gap: 10,
  },
  rowMe: { backgroundColor: RD.youMagentaBg, borderWidth: 1, borderColor: RD.youMagenta },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  rowRank: { color: RD.textTertiary, fontSize: 12, fontFamily: RD_FONT.mono, width: 18 },
  rowRankMe: { color: RD.youMagenta },
  rowName: { color: RD.textPrimary, fontSize: 13, fontWeight: '700', flexShrink: 1 },
  rowGlyph: { fontSize: 13, marginLeft: 5 },
  rowWins: { fontSize: 10, fontFamily: RD_FONT.monoBold, marginLeft: 3 },
  rowNameMe: { color: RD.textPrimary },
  rowTime: { color: RD.cream, fontSize: 12, fontFamily: RD_FONT.mono },

  totalLabel: {
    color: RD.textDisabled, fontSize: 9, fontFamily: RD_FONT.mono,
    letterSpacing: 1, marginTop: 2, marginBottom: 2,
  },
  placeholder: {
    backgroundColor: RD.youMagentaBg, borderWidth: 1, borderColor: RD.youMagenta,
    paddingVertical: 9, paddingHorizontal: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  placeholderText: { color: RD.youMagenta, fontSize: 12, fontFamily: RD_FONT.monoBold },
  placeholderHint: { color: RD.textTertiary, fontSize: 11 },
});

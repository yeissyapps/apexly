// Pestaña "Ranking" — el ranking global de HOY, completo, no solo el podio +
// tu entorno de MiniRanking. Petición de varios jugadores: poder buscarse
// entre amigos o ver el puesto de alguien en concreto sin tener que jugar
// para que aparezca tu propia ventana.
//
// Carga por páginas con un botón "Cargar más" (nunca de golpe — mismo
// espíritu que getGlobalBoard, ver api.js) en vez de scroll infinito con
// FlatList: el resto de la app (MiniRanking, AmigosTab) renderiza listas
// como Views normales dentro del ScrollView compartido de AppShell, y un
// FlatList anidado en ese ScrollView no se lleva bien con RN (pierde su
// propio scroll/virtualización). Con nombres random y search-heavy en
// hasta miles de filas, "cargar más" explícito es además más barato que
// paginar sola de fondo.
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { getMonthlyRanking, getRankingPage, getWorldWinCounts, pointsForDailyRank, searchRanking } from './api';
import { RD, RD_FONT } from './theme';
import { RankRow } from './MiniRanking';

// Agrupa una lista YA ORDENADA en tramos consecutivos del mismo valor
// (puntos o monedas) — para pintar una línea divisoria cada vez que cambia
// la banda, en vez de un número repetido fila a fila. JC, 2026-09-09: "hay
// que indicarlo de alguna forma visual, por colores, o líneas divisorias".
function groupByBand(rows, valueOf) {
  const groups = [];
  for (const r of rows) {
    const value = valueOf(r);
    const last = groups[groups.length - 1];
    if (last && last.value === value) last.items.push(r);
    else groups.push({ value, items: [r] });
  }
  return groups;
}

function BandDivider({ value, unit, zeroLabel = 'NO PUNTÚA', formatLabel }) {
  const scores = value > 0;
  const label = scores ? (formatLabel ? formatLabel(value) : `${value} ${unit}`) : zeroLabel;
  return (
    <View style={styles.bandDivider}>
      <View style={[styles.bandDividerLine, scores && styles.bandDividerLineGold]} />
      <Text style={[styles.bandDividerText, scores && styles.bandDividerTextGold]}>{label}</Text>
      <View style={[styles.bandDividerLine, scores && styles.bandDividerLineGold]} />
    </View>
  );
}

// Filas fuera del 50% que puntúa: atenuadas, no ocultas — se sigue viendo
// dónde queda cada uno, solo queda claro de un vistazo que ese tramo no
// se lleva nada.
function BandedRows({ rows, valueOf, unit, zeroLabel, formatLabel, wins, extraRowProps, onOpenPlayer }) {
  return groupByBand(rows, valueOf).map((g, gi) => (
    <Fragment key={gi}>
      <BandDivider value={g.value} unit={unit} zeroLabel={zeroLabel} formatLabel={formatLabel} />
      {g.items.map((r) => (
        <View key={r.userId} style={g.value <= 0 && styles.rowDimmed}>
          <RankRow r={r} wins={wins[r.userId]} onPress={onOpenPlayer} {...(extraRowProps ? extraRowProps(r) : null)} />
        </View>
      ))}
    </Fragment>
  ));
}

const PAGE_SIZE = 30;
const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// `new Date(y, m + 1, 0)` es el último día del mes `m` — el truco estándar
// de JS (día 0 del mes siguiente = último día de este), así sale bien el
// largo real de cada mes (28, 29, 30 o 31) sin tabla escrita a mano.
function daysUntilNextMonth(ref = new Date()) {
  const lastDay = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
  return lastDay - ref.getDate();
}

export default function RankingTab({ refreshKey = 0, onOpenPlayer }) {
  const [view, setView] = useState('hoy'); // 'hoy' | 'mes'
  // JC, 2026-09-16: "en lugar de MES ponga el nombre del mes... que el uno
  // de octubre se actualice" — new Date() se lee en cada render, así que
  // en cuanto alguien abra Ranking ya en octubre esto sale solo sin tocar
  // nada más (mismo cálculo que ya usaba MonthlyRanking para monthLabel).
  const monthLabel = MONTH_NAMES[new Date().getMonth()].toUpperCase();

  return (
    <View style={styles.wrap}>
      <View style={styles.viewTabs}>
        <Pressable style={styles.viewTab} onPress={() => setView('hoy')} hitSlop={6}>
          <Text style={[styles.viewTabText, view === 'hoy' && styles.viewTabTextActive]}>HOY</Text>
          {view === 'hoy' && <View style={styles.viewTabIndicator} />}
        </Pressable>
        <Pressable style={styles.viewTab} onPress={() => setView('mes')} hitSlop={6}>
          <Text style={[styles.viewTabText, view === 'mes' && styles.viewTabTextActive]}>{monthLabel}</Text>
          {view === 'mes' && <View style={styles.viewTabIndicator} />}
        </Pressable>
      </View>
      {view === 'hoy'
        ? <DailyRanking refreshKey={refreshKey} onOpenPlayer={onOpenPlayer} />
        : <MonthlyRanking refreshKey={refreshKey} onOpenPlayer={onOpenPlayer} />}
    </View>
  );
}

// Ranking del día — el que ya había, sin más cambio que vivir en su propio
// componente (antes era el cuerpo entero de RankingTab).
function DailyRanking({ refreshKey = 0, onOpenPlayer }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(null); // null = aún no se sabe
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [winCounts, setWinCounts] = useState({});

  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState(null); // null | 'loading' | 'done'
  const [searchResults, setSearchResults] = useState([]);
  const searchSeq = useRef(0);

  const loadPage = useCallback((offset) => {
    setLoadingMore(true);
    setError(false);
    getRankingPage(undefined, offset, PAGE_SIZE)
      .then(({ rows: page, total: t }) => {
        setRows((prev) => (offset === 0 ? page : [...prev, ...page]));
        setTotal(t);
        getWorldWinCounts(page.map((r) => r.userId))
          .then((wc) => setWinCounts((prev) => ({ ...prev, ...wc })))
          .catch(() => {});
      })
      .catch(() => setError(true))
      .finally(() => setLoadingMore(false));
  }, []);

  useEffect(() => {
    setRows([]);
    setTotal(null);
    loadPage(0);
  }, [refreshKey, loadPage]);

  function runSearch(text) {
    const seq = ++searchSeq.current;
    const clean = text.trim();
    if (!clean) { setSearchState(null); setSearchResults([]); return; }
    setSearchState('loading');
    searchRanking(clean)
      .then((res) => {
        if (searchSeq.current !== seq) return; // respuesta obsoleta, ya se escribió otra cosa
        setSearchResults(res);
        setSearchState('done');
        getWorldWinCounts(res.map((r) => r.userId))
          .then((wc) => setWinCounts((prev) => ({ ...prev, ...wc })))
          .catch(() => {});
      })
      .catch(() => { if (searchSeq.current === seq) setSearchState('done'); });
  }

  const showingSearch = query.trim().length > 0;
  const remaining = total != null ? total - rows.length : null;

  return (
    <View style={styles.section}>
      <View style={styles.searchBox}>
        <TextInput
          value={query}
          onChangeText={(t) => { setQuery(t); runSearch(t); }}
          placeholder="Buscar jugador por nombre…"
          placeholderTextColor={RD.textTertiary}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {showingSearch && (
          <Pressable onPress={() => { setQuery(''); setSearchState(null); setSearchResults([]); }} hitSlop={8}>
            <Text style={styles.searchClear}>✕</Text>
          </Pressable>
        )}
      </View>

      {showingSearch ? (
        searchState === 'loading' ? (
          <View style={styles.center}><ActivityIndicator color={RD.brand} /></View>
        ) : searchResults.length === 0 ? (
          <Text style={styles.muted}>Nadie con ese nombre ha corrido hoy.</Text>
        ) : (
          <View style={styles.list}>
            {searchResults.map((r) => (
              <RankRow key={r.userId} r={r} wins={winCounts[r.userId]} onPress={onOpenPlayer} />
            ))}
          </View>
        )
      ) : (
        <>
          {total != null && (
            <Text style={styles.totalLabel}>
              {total} {total === 1 ? 'jugador ha corrido hoy' : 'jugadores han corrido hoy'}
            </Text>
          )}

          {error && rows.length === 0 ? (
            <Text style={styles.muted}>No se pudo cargar el ranking.</Text>
          ) : rows.length === 0 && !loadingMore ? (
            <Text style={styles.muted}>Aún no hay tiempos. ¡Sé el primero!</Text>
          ) : (
            <View style={styles.list}>
              <BandedRows
                rows={rows}
                valueOf={(r) => pointsForDailyRank(r.rank, total || rows.length)}
                unit="PTS"
                wins={winCounts}
                onOpenPlayer={onOpenPlayer}
              />
            </View>
          )}

          {loadingMore ? (
            <View style={styles.center}><ActivityIndicator color={RD.brand} /></View>
          ) : remaining != null && remaining > 0 ? (
            <Pressable style={styles.moreBtn} onPress={() => loadPage(rows.length)}>
              <Text style={styles.moreBtnText}>CARGAR MÁS · {remaining} restantes</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

// Ranking del MES — media de tiempo por jugador entre los días corridos de
// este mes de calendario (no la suma: ver el comentario de getMonthlyRanking
// en api.js). Búsqueda en cliente, no en servidor: a diferencia del ranking
// diario (que puede tener miles de filas y pide páginas al servidor), aquí
// solo entran los jugadores que han corrido al menos un día del mes — la
// lista ya está entera en memoria, filtrar en el propio array es más simple
// y no hace falta una consulta nueva.
function MonthlyRanking({ refreshKey = 0, onOpenPlayer }) {
  const [rows, setRows] = useState(null); // null = cargando
  const [error, setError] = useState(false);
  const [winCounts, setWinCounts] = useState({});
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(false);
    getMonthlyRanking()
      .then((res) => {
        if (!alive) return;
        setRows(res.rows);
        getWorldWinCounts(res.rows.map((r) => r.userId))
          .then((wc) => { if (alive) setWinCounts(wc); })
          .catch(() => {});
      })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [refreshKey]);

  const now = new Date();
  const monthLabel = MONTH_NAMES[now.getMonth()];
  const daysLeft = daysUntilNextMonth(now);
  const countdown = daysLeft <= 0
    ? `Hoy cierra ${monthLabel}`
    : `Quedan ${daysLeft} ${daysLeft === 1 ? 'día' : 'días'} para que cierre ${monthLabel}`;

  const showingSearch = query.trim().length > 0;
  const filteredRows = showingSearch && rows
    ? rows.filter((r) => r.nickname.toLowerCase().includes(query.trim().toLowerCase()))
    : rows;

  return (
    <View style={styles.section}>
      <Text style={styles.monthCountdown}>{countdown}</Text>
      <Text style={styles.muted}>
        Puntos por posición cada día (top 50%, como en la F1). Al cerrar el mes, el top 50%
        se lleva monedas: cuanto más arriba, más premio.
      </Text>

      <View style={styles.searchBox}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar jugador por nombre…"
          placeholderTextColor={RD.textTertiary}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {showingSearch && (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Text style={styles.searchClear}>✕</Text>
          </Pressable>
        )}
      </View>

      {error && !rows ? (
        <Text style={styles.muted}>No se pudo cargar el ranking del mes.</Text>
      ) : !rows ? (
        <View style={styles.center}><ActivityIndicator color={RD.brand} /></View>
      ) : rows.length === 0 ? (
        <Text style={styles.muted}>Todavía nadie ha corrido este mes. ¡Sé el primero!</Text>
      ) : filteredRows.length === 0 ? (
        <Text style={styles.muted}>Nadie con ese nombre ha corrido este mes.</Text>
      ) : (
        <View style={styles.list}>
          <BandedRows
            rows={filteredRows}
            valueOf={(r) => r.coins}
            unit="MONEDAS"
            zeroLabel="SIN PREMIO"
            formatLabel={(v) => `PREMIO: ${v} MONEDAS`}
            wins={winCounts}
            onOpenPlayer={onOpenPlayer}
            extraRowProps={(r) => ({
              timeLabel: `${r.points} pts`,
              sub: `${r.daysPlayed} ${r.daysPlayed === 1 ? 'día jugado' : 'días jugados'}`,
            })}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  section: { gap: 10 },

  viewTabs: { flexDirection: 'row', gap: 28, borderBottomWidth: 1, borderBottomColor: RD.gridLine, isolation: 'isolate' },
  viewTab: { paddingBottom: 12, position: 'relative' },
  viewTabText: {
    color: RD.textTertiary, fontSize: 17, fontFamily: RD_FONT.displayBlack, letterSpacing: 0.4,
  },
  viewTabTextActive: { color: RD.textPrimary },
  viewTabIndicator: { position: 'absolute', left: 0, right: 0, bottom: -1, height: 3, backgroundColor: RD.brand },

  title: {
    color: RD.textTertiary, fontSize: 12, fontFamily: RD_FONT.monoBold,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  center: { paddingVertical: 20, alignItems: 'center' },
  muted: { color: RD.textTertiary, fontSize: 14, fontFamily: RD_FONT.mono, paddingVertical: 10 },
  monthCountdown: {
    color: RD.gold1st, fontSize: 13, fontFamily: RD_FONT.monoBold, letterSpacing: 0.4,
  },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: '#3a3a3a', paddingHorizontal: 12, paddingVertical: 2,
  },
  searchInput: { flex: 1, color: RD.textPrimary, fontSize: 14, paddingVertical: 8, fontFamily: RD_FONT.mono },
  searchClear: { color: RD.textTertiary, fontSize: 14, fontFamily: RD_FONT.monoBold, padding: 4 },

  totalLabel: {
    color: RD.textDisabled, fontSize: 9, fontFamily: RD_FONT.mono,
    letterSpacing: 1, marginTop: 2, marginBottom: 2,
  },
  list: { flexDirection: 'column', gap: 1, backgroundColor: RD.gridLine },

  bandDivider: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 6, backgroundColor: RD.bg,
  },
  bandDividerLine: { flex: 1, height: 1, backgroundColor: RD.gridLine },
  bandDividerLineGold: { backgroundColor: RD.gold1st, opacity: 0.5 },
  bandDividerText: {
    color: RD.textDisabled, fontSize: 9, fontFamily: RD_FONT.monoBold, letterSpacing: 1,
  },
  bandDividerTextGold: { color: RD.gold1st },
  rowDimmed: { opacity: 0.4 },

  moreBtn: {
    borderWidth: 1, borderColor: '#3a3a3a', paddingVertical: 12, alignItems: 'center', marginTop: 4,
  },
  moreBtnText: { color: RD.textDisabled, fontSize: 11, fontFamily: RD_FONT.monoBold, letterSpacing: 0.6 },
});

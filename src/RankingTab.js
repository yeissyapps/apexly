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
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { getRankingPage, getWorldWinCounts, searchRanking } from './api';
import { RD, RD_FONT } from './theme';
import { RankRow } from './MiniRanking';

const PAGE_SIZE = 30;

export default function RankingTab({ refreshKey = 0 }) {
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
      .then((page) => {
        setRows((prev) => (offset === 0 ? page : [...prev, ...page]));
        if (page.length < PAGE_SIZE) setTotal(offset + page.length);
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
    <View style={styles.wrap}>
      <Text style={styles.title}>Ranking de hoy</Text>

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
            {searchResults.map((r) => <RankRow key={r.userId} r={r} wins={winCounts[r.userId]} />)}
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
              {rows.map((r) => <RankRow key={r.userId} r={r} wins={winCounts[r.userId]} />)}
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

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  title: {
    color: RD.textTertiary, fontSize: 12, fontFamily: RD_FONT.monoBold,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  center: { paddingVertical: 20, alignItems: 'center' },
  muted: { color: RD.textTertiary, fontSize: 14, fontFamily: RD_FONT.mono, paddingVertical: 10 },

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

  moreBtn: {
    borderWidth: 1, borderColor: '#3a3a3a', paddingVertical: 12, alignItems: 'center', marginTop: 4,
  },
  moreBtnText: { color: RD.textDisabled, fontSize: 11, fontFamily: RD_FONT.monoBold, letterSpacing: 0.6 },
});

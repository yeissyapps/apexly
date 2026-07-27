// ============================================================================
//  Leaderboard — ranking del grupo (no una tabla fría).  Dirección A refinada.
//
//  Decisiones de diseño deliberadas:
//   1) Vista del GRUPO con nombres reconocibles (no IDs). Selector de ámbito:
//      cada grupo tuyo + Global (todo el mundo). Por defecto, tu grupo principal.
//   2) La diferencia con el líder va en PRIMER PLANO ("te faltan 0.4s").
//   3) NADA negativo para las últimas posiciones (sin rojos, sin "último").
//   4) Podio (top 3) + avatares con iniciales; color con significado.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Avatar from './Avatar';
import { getLeaderboard, listMyGroups } from './api';
import { fmtTime, fmtSecs } from './format';
import { C, MONO } from './theme';

const PODIUM_RING = [C.gold, C.silver, C.bronze];

export default function Leaderboard({ refreshKey = 0, onManageGroups }) {
  const [groups, setGroups] = useState([]);
  const [scope, setScope] = useState('global'); // 'global' o id de grupo
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);
  const picked = useRef(false);

  // Cargar mis grupos (y al refrescar, por si me acabo de unir a uno).
  useEffect(() => {
    let alive = true;
    listMyGroups()
      .then((gs) => {
        if (!alive) return;
        setGroups(gs);
        if (!picked.current && gs.length > 0) setScope(gs[0].id); // por defecto: 1er grupo
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [refreshKey]);

  // Cargar el ranking del ámbito seleccionado.
  useEffect(() => {
    let alive = true;
    setError(false);
    setRows(null);
    getLeaderboard(scope)
      .then((r) => { if (alive) setRows(r); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [scope, refreshKey]);

  function selectScope(s) { picked.current = true; setScope(s); }

  const leaderMs = rows && rows.length ? rows[0].bestMs : 0;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Ranking de hoy</Text>

      {/* Selector de ámbito: Global + cada grupo + gestionar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsRow}>
        <Chip label="Global" active={scope === 'global'} onPress={() => selectScope('global')} />
        {groups.map((g) => (
          <Chip key={g.id} label={g.name} active={scope === g.id} onPress={() => selectScope(g.id)} />
        ))}
        {onManageGroups && <Chip label="＋ Grupo" active={false} onPress={onManageGroups} dashed />}
      </ScrollView>

      {error ? (
        <Text style={styles.muted}>No se pudo cargar el ranking.</Text>
      ) : !rows ? (
        <View style={styles.center}><ActivityIndicator color={C.hot} /></View>
      ) : rows.length === 0 ? (
        <Text style={styles.muted}>
          {scope === 'global' ? 'Aún no hay tiempos. ¡Sé el primero!' : 'Nadie de este grupo ha jugado hoy.'}
        </Text>
      ) : (
        <>
          {rows.length >= 3 && <Podium rows={rows} />}
          <Banner me={rows.find((r) => r.isMe) || null} rows={rows} />
          <View style={styles.list}>
            {rows.map((r) => {
              const gap = r.bestMs - leaderMs;
              return (
                <View key={r.userId} style={[styles.row, r.isMe && styles.rowMe]}>
                  <Text style={[styles.pos, r.isMe && styles.posMe]}>{r.rank}</Text>
                  <Avatar name={r.nickname} colorKey={r.userId} size={34} ring={r.isMe ? C.purple : undefined} />
                  <View style={styles.who}>
                    <Text style={[styles.name, r.isMe && styles.nameMe]} numberOfLines={1}>
                      {r.nickname}{r.isMe ? ' (tú)' : ''}
                    </Text>
                    {r.streak >= 2 && <Text style={styles.sub}>racha {r.streak}</Text>}
                  </View>
                  <View style={styles.rt}>
                    <Text style={styles.time}>{fmtTime(r.bestMs)}</Text>
                    {r.rank === 1 ? (
                      <Text style={[styles.delta, styles.deltaLead]}>líder</Text>
                    ) : (
                      <Text style={[styles.delta, styles.deltaGap]}>+{fmtSecs(gap)}</Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

const Chip = ({ label, active, onPress, dashed }) => (
  <Pressable
    onPress={onPress}
    style={[styles.chip, active && styles.chipActive, dashed && styles.chipDashed]}
  >
    <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{label}</Text>
  </Pressable>
);

// Podio: top 3 con el 1.º en el centro y más grande.
function Podium({ rows }) {
  const order = [rows[1], rows[0], rows[2]]; // 2 - 1 - 3
  return (
    <View style={styles.podium}>
      {order.map((r, i) => {
        const place = r === rows[0] ? 1 : r === rows[1] ? 2 : 3;
        const ring = PODIUM_RING[place - 1];
        const big = place === 1;
        return (
          <View key={r.userId} style={[styles.pod, big && styles.podBig]}>
            <View>
              <Avatar name={r.nickname} colorKey={r.userId} size={big ? 58 : 46} ring={ring} />
              <View style={[styles.podRank, { backgroundColor: ring }]}>
                <Text style={styles.podRankTxt}>{place}</Text>
              </View>
            </View>
            <Text style={styles.podName} numberOfLines={1}>{r.isMe ? 'Tú' : r.nickname}</Text>
            <Text style={styles.podTime}>{fmtTime(r.bestMs)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Banner({ me, rows }) {
  if (!me) {
    return (
      <View style={styles.banner}>
        <Text style={styles.bannerBig}>Juega para entrar en el ranking</Text>
      </View>
    );
  }
  // Si vas primero, no hace falta banner: ya se ve en el podio y la lista.
  if (me.rank === 1) return null;
  const gapUp = me.bestMs - rows[me.rank - 2].bestMs;
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerBig}>−{fmtSecs(me.gapToLeaderMs)}s al 1.º</Text>
      <Text style={styles.bannerSub}>{fmtSecs(gapUp)}s para subir al {me.rank - 1}.º puesto</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  center: { paddingVertical: 24, alignItems: 'center' },
  title: {
    color: C.dim, fontSize: 12, fontWeight: '700',
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 12,
  },
  muted: { color: C.dim, fontSize: 14, paddingVertical: 12 },

  chips: { marginBottom: 14, marginHorizontal: -2 },
  chipsRow: { gap: 8, paddingHorizontal: 2 },
  chip: {
    backgroundColor: C.card2, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
    maxWidth: 160, borderWidth: 1, borderColor: C.line,
  },
  chipActive: { backgroundColor: C.card, borderColor: C.line2 },
  chipDashed: { backgroundColor: 'transparent', borderColor: C.line2, borderStyle: 'dashed' },
  chipText: { color: C.dim, fontSize: 13, fontWeight: '700' },
  chipTextActive: { color: C.ink },

  // Podio
  podium: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 14, paddingVertical: 6, marginBottom: 14 },
  pod: { alignItems: 'center', gap: 6, width: 84 },
  podBig: { marginBottom: 0 },
  podRank: {
    position: 'absolute', bottom: -3, right: -3, width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.bg,
  },
  podRankTxt: { color: C.bg, fontSize: 11, fontWeight: '900', fontFamily: MONO },
  podName: { color: C.ink, fontSize: 12, fontWeight: '700', maxWidth: 84 },
  podTime: { color: C.dim, fontSize: 12, fontFamily: MONO, fontVariant: ['tabular-nums'] },

  banner: {
    backgroundColor: 'rgba(67,224,138,0.10)', borderWidth: 1, borderColor: 'rgba(67,224,138,0.28)',
    borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 14,
  },
  bannerBig: { color: C.green, fontSize: 20, fontWeight: '900', fontVariant: ['tabular-nums'] },
  bannerSub: { color: C.dim, fontSize: 13, marginTop: 4 },

  list: { alignSelf: 'stretch' },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.card,
    borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12,
    marginBottom: 8, gap: 12,
  },
  rowMe: { backgroundColor: 'rgba(184,132,255,0.13)', borderColor: 'rgba(184,132,255,0.34)' },
  pos: { width: 20, textAlign: 'center', color: C.faint, fontSize: 14, fontWeight: '700', fontFamily: MONO },
  posMe: { color: C.purple },
  who: { flex: 1, minWidth: 0 },
  name: { color: C.ink, fontSize: 15, fontWeight: '700' },
  nameMe: { color: '#ffffff' },
  sub: { color: C.faint, fontSize: 11, fontFamily: MONO, marginTop: 1 },
  rt: { alignItems: 'flex-end', gap: 2 },
  time: { color: C.ink, fontSize: 15, fontWeight: '700', fontFamily: MONO, fontVariant: ['tabular-nums'] },
  delta: { fontSize: 11, fontWeight: '700', fontFamily: MONO, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, overflow: 'hidden' },
  deltaLead: { color: C.gold, backgroundColor: 'rgba(255,184,77,0.16)' },
  deltaGap: { color: C.dim, backgroundColor: C.card2 },
});

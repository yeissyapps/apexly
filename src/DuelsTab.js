// ============================================================================
//  Pestaña "1 VS 1" — todos tus duelos en un sitio (JC, 2026-09-19): los que
//  siguen vivos (responder, esperar, correr) y el historial de los últimos.
//  Antes solo se veían desde el perfil, y un reto enviado quedaba
//  invisible hasta salir y volver a entrar en el perfil del rival.
//
//  Los datos los posee App.js (los necesita también para el aviso de la
//  pestaña); esta pantalla solo los pinta y pide refrescarlos.
// ============================================================================

import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import AvatarThumb from './AvatarThumb';
import CoinIcon from './CoinIcon';
import { RD, RD_FONT } from './theme';

const POLL_MS = 8000;

function minsLeft(deadline) {
  return Math.max(1, Math.ceil((new Date(deadline).getTime() - Date.now()) / 60000));
}

function ActiveCard({ d, onOpen, onCancel, cancelling }) {
  let status;
  let action = null;
  let hot = false; // pide algo al jugador ahora mismo
  if (d.status === 'pending' && d.role === 'incoming') {
    status = `Te reta · te quedan ${minsLeft(d.deadline)} min para responder`;
    action = { label: 'RESPONDER', onPress: () => onOpen(d.id) };
    hot = true;
  } else if (d.status === 'pending') {
    status = `Esperando su respuesta · caduca en ${minsLeft(d.deadline)} min`;
  } else if (!d.myRunDone) {
    status = `Aceptado · te quedan ${minsLeft(d.deadline)} min para correr`;
    action = { label: 'CORRER', onPress: () => onOpen(d.id) };
    hot = true;
  } else {
    status = 'Ya has corrido · falta su vuelta';
    action = { label: 'VER', onPress: () => onOpen(d.id) };
  }
  const canCancel = d.status === 'pending' && d.role === 'outgoing';

  return (
    <View style={[s.card, hot && s.cardHot]}>
      <AvatarThumb pilotAvatarId={d.otherAvatarId} size={52} />
      <View style={s.cardBody}>
        <Text style={s.cardName} numberOfLines={1}>{d.otherName}</Text>
        <View style={s.wagerRow}>
          <CoinIcon size={12} />
          <Text style={s.wagerText}>{d.wager}</Text>
        </View>
        <Text style={s.cardStatus}>{status}</Text>
      </View>
      <View style={s.cardActions}>
        {action && (
          <Pressable style={s.actionBtn} onPress={action.onPress}>
            <Text style={s.actionBtnText}>{action.label}</Text>
          </Pressable>
        )}
        {canCancel && (
          <Pressable onPress={() => onCancel(d.id)} disabled={cancelling} hitSlop={10}>
            <Text style={s.cancelText}>{cancelling ? '…' : 'CANCELAR'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const OUTCOME = {
  won: { text: (h) => `Ganaste · +${h.wager}`, color: RD.successGreen },
  lost: { text: (h) => `Perdiste · −${h.wager}`, color: RD.textSecondary },
  tie: { text: () => 'Empate · apuesta devuelta', color: RD.textTertiary },
  refunded: { text: () => 'Sin resolver · apuesta devuelta', color: RD.textTertiary },
  expired: { text: () => 'Caducó sin respuesta', color: RD.textTertiary },
  declined: { text: (h) => (h.role === 'outgoing' ? 'Te lo rechazó' : 'Lo rechazaste'), color: RD.textTertiary },
  cancelled: { text: () => 'Cancelado', color: RD.textTertiary },
};

function HistoryRow({ h, onOpen }) {
  const o = OUTCOME[h.outcome] || OUTCOME.expired;
  // Solo los terminados tienen reveal que ver.
  const canOpen = h.outcome === 'won' || h.outcome === 'lost' || h.outcome === 'tie';
  const Wrap = canOpen ? Pressable : View;
  return (
    <Wrap style={s.histRow} {...(canOpen ? { onPress: () => onOpen(h.id) } : null)}>
      <AvatarThumb pilotAvatarId={h.otherAvatarId} size={34} />
      <View style={s.histBody}>
        <Text style={s.histName} numberOfLines={1}>{h.otherName}</Text>
        <Text style={[s.histOutcome, { color: o.color }]}>{o.text(h)}</Text>
      </View>
      {canOpen && <Text style={s.histLink}>VER ›</Text>}
    </Wrap>
  );
}

export default function DuelsTab({ duels, cancelBusy, onRefresh, onOpenDuel, onCancel }) {
  useEffect(() => {
    onRefresh();
    const t = setInterval(onRefresh, POLL_MS);
    return () => clearInterval(t);
  }, []);

  if (!duels) return <Text style={s.muted}>Cargando…</Text>;
  const { active, past } = duels;

  return (
    <View style={s.wrap}>
      <Text style={s.sectionTitle}>EN JUEGO</Text>
      {active.length === 0 ? (
        <Text style={s.muted}>
          No tienes ningún 1 vs 1 en marcha. Entra en el perfil de un jugador desde el Ranking y pulsa RETAR.
        </Text>
      ) : (
        active.map((d) => (
          <ActiveCard
            key={d.id}
            d={d}
            onOpen={onOpenDuel}
            onCancel={onCancel}
            cancelling={cancelBusy === d.id}
          />
        ))
      )}

      {past.length > 0 && (
        <>
          <Text style={[s.sectionTitle, s.sectionGap]}>HISTORIAL</Text>
          {past.map((h) => <HistoryRow key={h.id} h={h} onOpen={onOpenDuel} />)}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10 },
  muted: { color: RD.textTertiary, fontSize: 12, fontFamily: RD_FONT.mono, lineHeight: 18 },
  sectionTitle: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.monoBold, letterSpacing: 1.2 },
  sectionGap: { marginTop: 10 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2, padding: 12,
  },
  cardHot: { borderColor: RD.brand },
  cardBody: { flex: 1, gap: 3 },
  cardName: { color: RD.textPrimary, fontSize: 17, fontFamily: RD_FONT.displayBlack, textTransform: 'uppercase' },
  wagerRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  wagerText: { color: RD.gold1st, fontSize: 12, fontFamily: RD_FONT.monoBold },
  cardStatus: { color: RD.textSecondary, fontSize: 11, fontFamily: RD_FONT.mono, lineHeight: 15 },
  cardActions: { alignItems: 'center', gap: 10 },
  actionBtn: { backgroundColor: RD.brand, borderRadius: 2, paddingVertical: 10, paddingHorizontal: 14 },
  actionBtnText: { color: RD.bg, fontSize: 12, fontFamily: RD_FONT.displayBlack, letterSpacing: 0.6 },
  cancelText: { color: RD.textSecondary, fontSize: 11, fontFamily: RD_FONT.monoBold },

  histRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderBottomWidth: 1, borderBottomColor: RD.gridLine, paddingVertical: 8,
  },
  histBody: { flex: 1, gap: 2 },
  histName: { color: RD.textPrimary, fontSize: 14, fontFamily: RD_FONT.monoBold },
  histOutcome: { fontSize: 11, fontFamily: RD_FONT.mono },
  histLink: { color: RD.brand, fontSize: 11, fontFamily: RD_FONT.monoBold },
});

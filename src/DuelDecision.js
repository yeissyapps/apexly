// ============================================================================
//  DuelDecision — pantalla de "te han retado": nickname/avatar/apuesta del
//  rival, Aceptar o Rechazar. Aceptar es el ÚNICO momento en que se cobra la
//  apuesta a los dos (ver accept_duel en duels.sql) — por eso el botón pide
//  confirmación clara del importe antes de tocarlo, no un simple "OK".
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import DangerStripe from './DangerStripe';
import AvatarThumb from './AvatarThumb';
import CoinIcon from './CoinIcon';
import { getDuel, acceptDuel, declineDuel } from './api';
import { RD, RD_FONT } from './theme';

export default function DuelDecision({ duelId, onBack, onAccepted, onDeclined }) {
  const [duel, setDuel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Guarda real contra doble-toque — MISMO bug ya visto en Tienda.js: `busy`
  // (useState) no se actualiza a tiempo entre dos toques casi simultáneos,
  // así que un doble tap rápido en ACEPTAR podía pasar el `if (busy) return`
  // dos veces y lanzar accept_duel() por duplicado. El servidor ya lo
  // bloquea igualmente (DUEL_NOT_PENDING en el segundo intento — nunca se
  // cobra dos veces), pero la ref evita hasta el intento de más.
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  useEffect(() => {
    let alive = true;
    getDuel(duelId).then((d) => alive && setDuel(d)).catch(() => alive && setError('No se pudo cargar el reto.'));
    return () => { alive = false; };
  }, [duelId]);

  async function handleAccept() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await acceptDuel(duelId);
      onAccepted(duelId);
    } catch (e) {
      const code = String(e?.message || e);
      const text = code.includes('DUEL_EXPIRED') ? 'Se te ha pasado el tiempo para responder.'
        : code.includes('INSUFFICIENT_FUNDS') ? 'No te llega el saldo para esta apuesta.'
        : code.includes('CHALLENGER_INSUFFICIENT_FUNDS') ? `${duel?.challengerName || 'El retador'} ya no tiene saldo suficiente.`
        : code.includes('DUEL_NOT_PENDING') ? 'Este reto ya no está disponible.'
        : 'No se pudo aceptar. Inténtalo otra vez.';
      busyRef.current = false;
      // El componente puede haber sido desmontado mientras esperaba (p.ej.
      // el padre ya cambió de pantalla) — actualizar estado ahí sería un
      // warning de React sobre un componente ya fuera del árbol.
      if (aliveRef.current) { setError(text); setBusy(false); }
    }
  }

  async function handleDecline() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await declineDuel(duelId);
      onDeclined();
    } catch (_) {
      busyRef.current = false;
      if (aliveRef.current) setBusy(false);
      onDeclined();
    }
  }

  if (error && !duel) {
    return (
      <View style={s.screen}>
        <DangerStripe height={6} />
        <View style={s.centerMsg}>
          <Text style={s.centerMsgText}>{error}</Text>
          <Pressable onPress={onBack} hitSlop={12}><Text style={s.backLink}>‹ VOLVER</Text></Pressable>
        </View>
      </View>
    );
  }
  if (!duel) return <View style={s.screen}><DangerStripe height={6} /></View>;

  const alreadyDecided = duel.status !== 'pending';

  return (
    <View style={s.screen}>
      <DangerStripe height={6} />
      <Pressable onPress={onBack} hitSlop={12}><Text style={s.backLink}>‹ INICIO</Text></Pressable>

      <View style={s.content}>
        <Text style={s.eyebrow}>TE HA RETADO</Text>
        <AvatarThumb pilotAvatarId={duel.challengerAvatarId} size={96} />
        <Text style={s.name}>{duel.challengerName}</Text>

        <View style={s.wagerCard}>
          <CoinIcon size={22} />
          <Text style={s.wagerAmount}>{duel.wager}</Text>
          <Text style={s.wagerLabel}>en juego — gana quien haga mejor tiempo</Text>
        </View>

        {alreadyDecided ? (
          <Text style={s.doneText}>
            {duel.status === 'declined' ? 'Ya rechazaste este reto.' : 'Este reto ya no está disponible.'}
          </Text>
        ) : (
          <>
            {!!error && <Text style={s.errorText}>{error}</Text>}
            <Pressable style={[s.acceptBtn, busy && s.btnDisabled]} onPress={handleAccept} disabled={busy}>
              <Text style={s.acceptBtnText}>{busy ? 'UN MOMENTO…' : `ACEPTAR · -${duel.wager}`}</Text>
            </Pressable>
            <Pressable onPress={handleDecline} disabled={busy} hitSlop={10}>
              <Text style={s.declineText}>Rechazar</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RD.bg, paddingTop: 50 },
  backLink: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono, marginLeft: 18, marginBottom: 8 },
  centerMsg: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 24 },
  centerMsgText: { color: RD.textSecondary, fontSize: 14, fontFamily: RD_FONT.mono, textAlign: 'center' },
  content: { flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 20, gap: 14 },
  eyebrow: { color: RD.brand, fontSize: 12, fontFamily: RD_FONT.monoBold, letterSpacing: 1.5 },
  name: {
    color: RD.textPrimary, fontSize: 26, fontFamily: RD_FONT.displayBlack, textTransform: 'uppercase',
  },
  wagerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8,
    borderWidth: 1, borderColor: RD.gold1st, borderRadius: 2,
    backgroundColor: RD.gold1stShade, paddingVertical: 14, paddingHorizontal: 18,
  },
  wagerAmount: { color: RD.gold1st, fontSize: 22, fontFamily: RD_FONT.monoBold },
  wagerLabel: { color: RD.gold1st, fontSize: 11, fontFamily: RD_FONT.mono, flexShrink: 1 },
  doneText: { color: RD.textTertiary, fontSize: 13, fontFamily: RD_FONT.mono, marginTop: 20 },
  errorText: { color: RD.danger, fontSize: 12, fontFamily: RD_FONT.monoBold, textAlign: 'center' },
  acceptBtn: {
    alignSelf: 'stretch', backgroundColor: RD.brand, borderRadius: 2,
    paddingVertical: 16, alignItems: 'center', marginTop: 12,
  },
  btnDisabled: { opacity: 0.5 },
  acceptBtnText: { color: RD.bg, fontSize: 16, fontFamily: RD_FONT.displayBlack, letterSpacing: 0.6 },
  declineText: { color: RD.textTertiary, fontSize: 13, fontFamily: RD_FONT.mono, marginTop: 4 },
});

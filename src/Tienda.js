// ============================================================================
//  Tienda — comprar y abrir sobres con monedas ganadas por racha/ranking.
//
//  Un sobre = 125 monedas = 1 pieza premium aleatoria del garaje (color,
//  alerón o librea), sin duplicados (el servidor excluye lo que ya tienes).
//  Mismo lenguaje visual que Garage.js (esqueleto, tokens RD/RD_FONT).
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Ellipse } from 'react-native-svg';

import DangerStripe from './DangerStripe';
import CarSprite from './CarSprite';
import ShineBadge from './ShineBadge';
import PackArt from './PackArt';
import PackReveal from './PackReveal';
import { RD, RD_FONT, RARITY_COLOR, RARITY_LABEL } from './theme';
import { CAR_DEFAULTS, CAR_COLORS, WING_SHAPES, LIVERY_PATTERNS, LIGHT_COLORS, TOTAL_PIECES } from './car';
import { CHASSIS } from './chassis';
import { FRAMES } from './frames';
import { SHARE_LINK } from './links';
import {
  getWallet, getInventory, getMyLoadout, saveLoadout, openPack,
  getMyReferralCode, hasRedeemedReferral, redeemReferralCode,
} from './api';

const PACK_COST = 125;
// Solo para el texto — el número real y la validación viven en el servidor
// (v_bonus en redeem_referral_code, supabase/referrals.sql). Si se cambia
// ahí, cambiar aquí también.
const REFERRAL_BONUS = 50;

// Nombre bonito de la pieza que acaba de salir. Faltaban 'chassis' y 'frame'
// desde que se añadieron: caían al genérico y el sobre anunciaba "Monoplaza"
// por casualidad (el id se parecía) o "Filo" a secas.
function pieceLabel(category, pieceId) {
  const find = (list) => list.find((o) => o.id === pieceId)?.label;
  if (category === 'wing') return find(WING_SHAPES) ?? pieceId;
  if (category === 'livery') return find(LIVERY_PATTERNS) ?? pieceId;
  if (category === 'chassis') return find(CHASSIS) ?? pieceId;
  if (category === 'light') return find(LIGHT_COLORS) ?? pieceId;
  if (category === 'frame') return find(FRAMES) ?? pieceId;
  return pieceId.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

// Cómo se ve el coche con la pieza recién ganada puesta. Un chasis o un faro
// que salía de un sobre no cambiaban NADA en la vista previa: enseñaba el
// coche de siempre mientras el cartel decía que habías ganado algo.
function previewLoadoutFor(base, category, pieceId) {
  if (category === 'color') {
    return { ...base, bodyColor: CAR_COLORS.find((c) => c.id === pieceId)?.c ?? base.bodyColor };
  }
  if (category === 'wing') return { ...base, wingShape: pieceId };
  // Sin color de franja no se vería el patrón, así que se pone uno por
  // defecto solo para la vista previa.
  if (category === 'livery') return { ...base, liveryPattern: pieceId, livery: base.livery || '#f0eee8' };
  if (category === 'chassis') return { ...base, chassis: pieceId };
  if (category === 'light') {
    return { ...base, lightsColor: LIGHT_COLORS.find((l) => l.id === pieceId)?.c ?? base.lightsColor };
  }
  return base; // 'frame' no se ve en el coche: se ve en la fila del ranking
}

export default function Tienda({ onBack }) {
  const [wallet, setWallet] = useState({ balance: 0, pendingPacks: 0 });
  const [ownedCount, setOwnedCount] = useState(0);
  const [loadout, setLoadout] = useState(CAR_DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [reveal, setReveal] = useState(null); // { category, pieceId, rarity }
  const [revealSource, setRevealSource] = useState('paid'); // para dibujar el sobre correcto al abrirlo
  // Ref además de estado: `busy` (useState) no se actualiza a tiempo entre
  // dos taps casi simultáneos (React no re-renderiza entre medias), así que
  // un doble tap rápido pasaba el check `if (busy) return` dos veces y
  // abría dos sobres de golpe (el servidor cobraba bien los dos, pero el
  // segundo se abría en silencio, sin mostrar su revelación). La ref se lee
  // y escribe al instante, en el mismo tick del primer tap.
  const openingRef = useRef(false);

  // Código de invitación: el tuyo (permanente, para repartir) + si esta
  // cuenta ya canjeó uno ajeno alguna vez (solo se puede una vez en la vida,
  // ver supabase/referrals.sql — por eso el formulario de canjear desaparece
  // en cuanto se sabe que ya se gastó).
  const [myCode, setMyCode] = useState(null);
  const [alreadyRedeemed, setAlreadyRedeemed] = useState(null); // null = aún no se sabe
  const [redeemInput, setRedeemInput] = useState('');
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState(null); // { type:'ok'|'err', text }

  const refresh = () => {
    getWallet().then(setWallet).catch(() => {});
    getInventory().then((items) => setOwnedCount(items.length)).catch(() => {});
    getMyLoadout().then(setLoadout).catch(() => {});
    getMyReferralCode().then(setMyCode).catch(() => {});
    hasRedeemedReferral().then(setAlreadyRedeemed).catch(() => setAlreadyRedeemed(false));
  };

  useEffect(refresh, []);

  function shareMyCode() {
    Share.share({
      message:
        `¡Échale un ojo a Apexly! Un circuito nuevo cada día, batallas contra ` +
        `tus amigos y contra el mundo.\n\nMete mi código ${myCode} en la Tienda ` +
        `al instalarte la app — ganamos monedas los dos.\n\n${SHARE_LINK}`,
    }).catch(() => {});
  }

  async function handleRedeem() {
    const code = redeemInput.trim();
    if (!code || redeemBusy) return;
    setRedeemBusy(true);
    setRedeemMsg(null);
    try {
      const bonus = await redeemReferralCode(code);
      setRedeemMsg({ type: 'ok', text: `¡Código válido! +${bonus} monedas para los dos.` });
      setAlreadyRedeemed(true);
      refresh();
    } catch (e) {
      const msg = String(e?.message || '');
      const text = msg.includes('CODE_NOT_FOUND') ? 'Ese código no existe.'
        : msg.includes('CANNOT_REDEEM_OWN_CODE') ? 'No puedes usar tu propio código.'
        : msg.includes('ALREADY_REDEEMED') ? 'Ya has canjeado un código antes.'
        : 'No se pudo canjear. Inténtalo de nuevo.';
      setRedeemMsg({ type: 'err', text });
    } finally {
      setRedeemBusy(false);
    }
  }

  // La animación de apertura vive entera en PackReveal (secuencia de tres
  // actos, escalada por rareza) — aquí solo se decide QUÉ se revela.

  async function handleOpen(source) {
    if (openingRef.current) return;
    openingRef.current = true;
    setBusy(true);
    setErrorMsg(null);
    try {
      const result = await openPack(source);
      setRevealSource(source);
      setReveal(result);
      refresh();
    } catch (e) {
      const code = String(e?.message || e);
      if (code.includes('INSUFFICIENT_FUNDS')) setErrorMsg('No te llega el saldo para otro sobre.');
      else if (code.includes('NO_PENDING_PACK')) setErrorMsg('No tienes sobres pendientes.');
      else if (code.includes('COLLECTION_COMPLETE')) setErrorMsg('Ya tienes todas las piezas — colección completa.');
      else setErrorMsg('No se pudo abrir el sobre. Inténtalo de nuevo.');
    } finally {
      openingRef.current = false;
      setBusy(false);
    }
  }

  async function handleEquip() {
    if (!reveal) return;
    const next = previewLoadoutFor(loadout, reveal.category, reveal.pieceId);
    try {
      await saveLoadout(next);
      setLoadout(next);
    } catch (_) {
      // si falla el equipar, la pieza ya es tuya igualmente — se puede
      // equipar luego desde el Garaje.
    }
    setReveal(null);
  }

  const previewLoadout = reveal ? previewLoadoutFor(loadout, reveal.category, reveal.pieceId) : loadout;
  const complete = ownedCount >= TOTAL_PIECES;

  return (
    <View style={s.screen}>
      <StatusBar hidden />
      <DangerStripe height={6} />
      <ScrollView contentContainerStyle={s.content}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={s.backLink}>‹ INICIO</Text>
        </Pressable>
        {/* Título y monedas en la MISMA fila: el saldo ocupaba un panel
            entero para un solo número, y encima lo llamaba "saldo" cuando en
            Inicio se llama "monedas". Mismo nombre en toda la app. */}
        <View style={s.titleRow}>
          <Text style={s.pageTitle}>Tienda</Text>
          <View style={s.coinChip}>
            <Text style={s.coinChipLabel}>MONEDAS</Text>
            <Text style={s.coinChipValue}>{wallet.balance}</Text>
          </View>
        </View>
        <Text style={s.disclaimer}>Solo estético — no afecta al rendimiento del coche</Text>

        {wallet.pendingPacks > 0 && (
          <View style={[s.card, s.cardWithArt, s.freeCard]}>
            <PackArt width={76} variant="free" serial={wallet.pendingPacks} />
            <View style={s.cardText}>
              <Text style={s.cardTitle}>YA SON TUYOS · {wallet.pendingPacks}</Text>
              <Text style={s.cardBody}>Regalo de tu racha de 7 días — sin caducar.</Text>
              <Pressable style={[s.cardBtn, s.freeBtn]} onPress={() => handleOpen('free')} disabled={busy}>
                <Text style={[s.cardBtnText, s.freeBtnText]}>ABRIR</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* El sobre, en grande y centrado: es el producto de la tienda, así
            que es lo que hay que mirar. En miniatura a un lado competía con
            el texto y no invitaba a nada. */}
        <View style={s.hero}>
          <PackArt width={186} variant="paid" serial={ownedCount + 1} />
          <Text style={s.heroName}>Sobre de paddock</Text>
          <Text style={s.heroBody}>
            1 pieza aleatoria, nunca repetida.
          </Text>
          <View style={s.oddsRow}>
            <Text style={[s.odd, { color: RD.trackBlue }]}>65% rara</Text>
            <Text style={s.oddSep}>·</Text>
            <Text style={[s.odd, { color: RD.youMagenta }]}>30% épica</Text>
            <Text style={s.oddSep}>·</Text>
            <Text style={[s.odd, { color: RD.gold1st }]}>5% legendaria</Text>
          </View>
          <Pressable
            style={[s.heroBtn, (busy || complete || wallet.balance < PACK_COST) && s.heroBtnDisabled]}
            onPress={() => handleOpen('paid')}
            disabled={busy || complete || wallet.balance < PACK_COST}
          >
            <Text style={[s.heroBtnText, (busy || complete || wallet.balance < PACK_COST) && s.heroBtnTextDisabled]}>
              {complete ? 'COLECCIÓN COMPLETA'
                : wallet.balance < PACK_COST ? `TE FALTAN ${PACK_COST - wallet.balance} MONEDAS`
                : `COMPRAR · ${PACK_COST}`}
            </Text>
          </Pressable>
        </View>

        {errorMsg && <Text style={s.errorText}>{errorMsg}</Text>}

        <Text style={s.progressText}>Colección: {ownedCount}/{TOTAL_PIECES} piezas</Text>

        {/* Invitar a un amigo. JC: "a la gente le gusta el concepto pero no
            aumentan los jugadores" — el enlace de compartir una vuelta no
            puede premiar instalaciones nuevas (pasa por un redirector a la
            tienda que no lleva ningún dato de vuelta). Un código que se
            reparte a mano y se escribe a mano esquiva ese agujero entero:
            no depende de ninguna infraestructura de atribución. */}
        <View style={s.card}>
          <Text style={s.cardTitle}>INVITA A UN AMIGO</Text>
          <Text style={s.cardBody}>
            Comparte tu código. Cuando un amigo lo mete en su Tienda al
            instalarse la app, ganáis {REFERRAL_BONUS} monedas los dos.
          </Text>
          <Pressable style={s.referralCodeBox} onPress={shareMyCode} disabled={!myCode}>
            <Text style={s.referralCodeText}>{myCode || '······'}</Text>
            <Text style={s.referralCodeShare}>COMPARTIR ›</Text>
          </Pressable>

          {alreadyRedeemed === false && (
            <>
              <Text style={s.referralRedeemLabel}>¿TE HAN DADO UN CÓDIGO?</Text>
              <View style={s.referralRedeemRow}>
                <TextInput
                  style={s.referralInput}
                  value={redeemInput}
                  onChangeText={(t) => setRedeemInput(t.toUpperCase())}
                  placeholder="CÓDIGO"
                  placeholderTextColor={RD.textDisabled}
                  autoCapitalize="characters"
                  maxLength={6}
                />
                <Pressable
                  style={[s.referralRedeemBtn, (!redeemInput.trim() || redeemBusy) && s.heroBtnDisabled]}
                  onPress={handleRedeem}
                  disabled={!redeemInput.trim() || redeemBusy}
                >
                  <Text style={s.referralRedeemBtnText}>{redeemBusy ? '…' : 'CANJEAR'}</Text>
                </Pressable>
              </View>
              {redeemMsg && (
                <Text style={redeemMsg.type === 'ok' ? s.referralMsgOk : s.referralMsgErr}>
                  {redeemMsg.text}
                </Text>
              )}
            </>
          )}
          {alreadyRedeemed === true && !redeemMsg && (
            <Text style={s.referralRedeemLabel}>YA HAS CANJEADO UN CÓDIGO — SOLO SE PUEDE UNA VEZ</Text>
          )}
        </View>
      </ScrollView>

      {reveal && (
        <View style={s.revealOverlay}>
          <PackReveal
            rarity={reveal.rarity}
            rarityColor={RARITY_COLOR[reveal.rarity]}
            variant={revealSource}
            serial={ownedCount}
          >
            <View style={s.revealCard}>
              <Svg width="100%" height={150} viewBox="0 0 200 140">
                <Ellipse cx={100} cy={104} rx={44} ry={8} fill="#000000" opacity={0.35} />
                <CarSprite x={100} y={68} deg={-20} scale={3.15} loadout={previewLoadout} />
              </Svg>
              {reveal.rarity === 'legendaria' ? (
                <ShineBadge style={[s.rarityBadge, { backgroundColor: RARITY_COLOR[reveal.rarity] }]}>
                  <Text style={s.rarityBadgeText}>{RARITY_LABEL[reveal.rarity]}</Text>
                </ShineBadge>
              ) : (
                <View style={[s.rarityBadge, { backgroundColor: RARITY_COLOR[reveal.rarity] }]}>
                  <Text style={s.rarityBadgeText}>{RARITY_LABEL[reveal.rarity]}</Text>
                </View>
              )}
              <Text style={s.revealLabel}>{pieceLabel(reveal.category, reveal.pieceId)}</Text>
              <Pressable style={s.equipBtn} onPress={handleEquip}>
                <Text style={s.equipBtnText}>EQUIPAR AHORA</Text>
              </Pressable>
              <Pressable onPress={() => setReveal(null)} hitSlop={12}>
                <Text style={s.laterLink}>Seguir</Text>
              </Pressable>
            </View>
          </PackReveal>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RD.bg },
  content: { paddingHorizontal: 18, paddingTop: 50, paddingBottom: 40, gap: 16 },
  backLink: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono, marginBottom: 8 },
  pageTitle: {
    color: RD.textPrimary, fontSize: 28, fontFamily: RD_FONT.displayBlack,
    textTransform: 'uppercase',
  },
  disclaimer: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono, marginBottom: -4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  coinChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    borderWidth: 1, borderColor: RD.gold1st, borderRadius: 2,
    paddingHorizontal: 9, paddingVertical: 5, backgroundColor: RD.gold1stShade,
  },
  coinChipLabel: { color: RD.gold1st, fontSize: 9, fontFamily: RD_FONT.mono, letterSpacing: 0.8, opacity: 0.85 },
  coinChipValue: { color: RD.gold1st, fontSize: 13, fontFamily: RD_FONT.monoBold },

  hero: {
    borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    paddingVertical: 22, paddingHorizontal: 18, alignItems: 'center', gap: 8,
  },
  heroName: {
    color: RD.textPrimary, fontSize: 24, fontFamily: RD_FONT.displayBlack,
    textTransform: 'uppercase', marginTop: 8,
  },
  heroBody: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono, textAlign: 'center' },
  // Las probabilidades van con el color de SU rareza, que es el mismo que
  // luego lleva el badge al abrirlo: así el 5% legendaria ya enseña de qué
  // color es el premio gordo antes de comprarlo.
  oddsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  odd: { fontSize: 11, fontFamily: RD_FONT.monoBold },
  oddSep: { color: RD.textDisabled, fontSize: 11, fontFamily: RD_FONT.mono },
  heroBtn: {
    alignSelf: 'stretch', backgroundColor: RD.brand, borderRadius: 2,
    paddingVertical: 15, alignItems: 'center', marginTop: 10,
  },
  // Deshabilitado sin perder legibilidad: al pintarlo de gris el texto
  // seguía en color de fondo (oscuro sobre oscuro) y no se leía justo el
  // mensaje que explica POR QUÉ no puedes comprar, que es lo único útil de
  // ese estado. Se invierte a borde + texto claro.
  heroBtnDisabled: { backgroundColor: 'transparent', borderWidth: 1, borderColor: RD.panelBorder },
  heroBtnText: {
    color: RD.bg, fontSize: 16, fontFamily: RD_FONT.displayBlack,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  heroBtnTextDisabled: { color: RD.textTertiary },
  freeCard: { borderColor: RD.successGreen },
  freeBtn: { borderColor: RD.successGreen },
  freeBtnText: { color: RD.successGreen },
  card: { borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2, padding: 14, gap: 8 },
  // Con el sobre dibujado, la tarjeta pasa a dos columnas: arte a la
  // izquierda, texto y acción a la derecha.
  cardWithArt: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  cardText: { flex: 1, minWidth: 0, gap: 8 },
  cardTitle: { color: RD.textPrimary, fontSize: 13, fontFamily: RD_FONT.monoBold, letterSpacing: 0.5 },
  cardBody: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono, lineHeight: 17 },
  cardBtn: { borderWidth: 1, borderColor: RD.brand, borderRadius: 2, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  cardBtnDisabled: { borderColor: RD.panelBorder, opacity: 0.5 },
  cardBtnText: { color: RD.brand, fontSize: 13, fontFamily: RD_FONT.monoBold, letterSpacing: 0.5 },
  errorText: { color: RD.danger, fontSize: 12, fontFamily: RD_FONT.mono, textAlign: 'center' },
  progressText: { color: RD.textTertiary, fontSize: 12, fontFamily: RD_FONT.mono, textAlign: 'center' },

  // Código propio: grande y en mono (se lee y se dicta en voz alta), con el
  // "compartir" como única acción del bloque — todo el rectángulo es tocable.
  referralCodeBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: RD.gold1st, borderRadius: 2,
    backgroundColor: RD.gold1stShade, paddingVertical: 12, paddingHorizontal: 14,
  },
  referralCodeText: {
    color: RD.gold1st, fontSize: 22, fontFamily: RD_FONT.monoBold, letterSpacing: 3,
  },
  referralCodeShare: { color: RD.gold1st, fontSize: 11, fontFamily: RD_FONT.monoBold, letterSpacing: 0.5 },
  referralRedeemLabel: {
    color: RD.textDisabled, fontSize: 10, fontFamily: RD_FONT.mono, letterSpacing: 1, marginTop: 4,
  },
  referralRedeemRow: { flexDirection: 'row', gap: 8 },
  referralInput: {
    flex: 1, borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    paddingVertical: 10, paddingHorizontal: 12, color: RD.textPrimary,
    fontSize: 15, fontFamily: RD_FONT.monoBold, letterSpacing: 2,
  },
  referralRedeemBtn: {
    borderWidth: 1, borderColor: RD.brand, borderRadius: 2,
    paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center',
  },
  referralRedeemBtnText: { color: RD.brand, fontSize: 12, fontFamily: RD_FONT.monoBold, letterSpacing: 0.5 },
  referralMsgOk: { color: RD.successGreen, fontSize: 12, fontFamily: RD_FONT.mono },
  referralMsgErr: { color: RD.danger, fontSize: 12, fontFamily: RD_FONT.mono },

  revealOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.82)', alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  revealCard: {
    width: '100%', borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    backgroundColor: RD.bg, padding: 18, alignItems: 'center', gap: 10,
  },
  rarityBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 2 },
  rarityBadgeText: { color: RD.bg, fontSize: 11, fontFamily: RD_FONT.monoBold, letterSpacing: 0.6 },
  revealLabel: { color: RD.textPrimary, fontSize: 18, fontFamily: RD_FONT.displayBold, textTransform: 'uppercase' },
  equipBtn: { alignSelf: 'stretch', backgroundColor: RD.brand, borderRadius: 2, paddingVertical: 13, alignItems: 'center', marginTop: 6 },
  equipBtnText: { color: '#04160b', fontSize: 14, fontFamily: RD_FONT.monoBold, letterSpacing: 0.5 },
  laterLink: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono, marginTop: 2 },
});

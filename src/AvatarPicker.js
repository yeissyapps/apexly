// ============================================================================
//  AvatarPicker — selector real de avatar (JC, 2026-09-16: "el selector de
//  avatar, con las previews y las 4 rarezas, como en garaje").
//
//  Mismo patrón visual y de datos que Garage.js: agrupado por rareza,
//  candado + enlace a Tienda en lo que no tienes, tocar una pieza bloqueada
//  la PREVISUALIZA en el visor de arriba sin guardar nada. La diferencia es
//  que aquí cada "swatch" es la miniatura real del muñeco (avatarCatalog.js
//  .thumb), no un cuadrado de color — y arriba del todo hay un AvatarViewer
//  en vivo, no un Showcase de coche.
//
//  Inventario real (pilot_avatar_inventory.sql, JC 2026-09-16 — revisado el
//  mismo día: "cuando lancemos la 2.4.4 todos deben tener el base y todos
//  los demás bloqueados"): SOLO la base es gratis (isFreeAvatar). Las 6
//  comunes ya no van con la base en "LIBRES" — tienen su propio grupo
//  bloqueado, mecánicamente en el mismo bombo 'rara' del sobre que los 4
//  raros (catalog_pieces no tiene un cuarto escalón de rareza).
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import DangerStripe from './DangerStripe';
import AvatarViewer from './AvatarViewer';
import { AVATARS, isFreeAvatar, avatarDisplayLabel } from './avatarCatalog';
import { RD, RD_FONT, RARITY_COLOR } from './theme';
import { getInventory, getPilotAvatarId, savePilotAvatar } from './api';

const GROUP_ORDER = [null, 'comun', 'rara', 'epica', 'legendaria'];
const GROUP_LABEL = {
  null: 'LIBRE', comun: 'COMUNES', rara: 'RARAS', epica: 'ÉPICAS', legendaria: 'LEGENDARIAS',
};
// Color de cabecera por grupo — RARITY_COLOR (theme.js) solo cubre las 3
// rarezas de PAGO que también usa el coche; "comun" es una categoría nueva
// solo de avatares, sin acento propio en el resto de la app, así que se
// queda en un gris neutro en vez de inventar un color de marca para ella.
const GROUP_COLOR = { ...RARITY_COLOR, comun: RD.textSecondary };
// Grupo por rareza para el desplegado — solo 'base' va en "LIBRE" ahora;
// 'comun' tiene su propia sección, ya bloqueada como cualquier otra.
const groupKeyFor = (a) => (a.rarity === 'base' ? null : a.rarity);

function LockIcon({ color }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 16 16">
      <Path d="M4,7 V5 A4,4 0 0,1 12,5 V7" fill="none" stroke={color} strokeWidth={1.9} />
      <Rect x={3} y={7} width={10} height={7} rx={1.5} fill={color} />
    </Svg>
  );
}

export default function AvatarPicker({ onBack, onOpenTienda }) {
  const [owned, setOwned] = useState(null);       // Set de piece_id de categoría 'avatar', o null cargando
  const [equipped, setEquipped] = useState(null);  // key guardada de verdad
  const [preview, setPreview] = useState(null);    // key que se está mirando sin guardar (piezas bloqueadas)
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    getInventory()
      .then((items) => {
        if (!alive) return;
        setOwned(new Set(items.filter((p) => p.category === 'avatar').map((p) => p.pieceId)));
      })
      .catch(() => alive && setOwned(new Set()));
    getPilotAvatarId()
      .then((id) => alive && setEquipped(id || 'base'))
      .catch(() => alive && setEquipped('base'));
    return () => { alive = false; };
  }, []);

  const isOwned = (a) => isFreeAvatar(a.key) || !!owned?.has(a.key);

  const groups = useMemo(() => {
    const by = new Map();
    for (const a of AVATARS) {
      const key = groupKeyFor(a);
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(a);
    }
    return GROUP_ORDER.filter((k) => by.has(k)).map((k) => ({ rarity: k, items: by.get(k) }));
  }, []);

  const shownKey = preview || equipped || 'base';
  const shownAvatar = AVATARS.find((a) => a.key === shownKey) || AVATARS[0];

  async function handlePick(a) {
    if (!isOwned(a)) { setPreview(a.key); return; }
    if (a.key === equipped) { setPreview(null); return; }
    setSaving(true);
    setError(null);
    try {
      await savePilotAvatar(a.key, a.thumb);
      setEquipped(a.key);
      setPreview(null);
    } catch (e) {
      setError('No se pudo guardar tu avatar — inténtalo otra vez.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={s.screen}>
      <StatusBar hidden />
      <DangerStripe height={6} />
      <ScrollView contentContainerStyle={s.content}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={s.backLink}>‹ PERFIL</Text>
        </Pressable>

        <Text style={s.pageTitle}>Avatar</Text>
        <Text style={s.disclaimer}>Elige tu muñeco — los sobres reparten los más raros.</Text>
        {!!error && <Text style={s.saveError}>{error}</Text>}

        <View style={s.preview}>
          <AvatarViewer key={shownAvatar.key} source={shownAvatar.glb} cacheKey={shownAvatar.key} />
          {preview && (
            <View style={s.previewBadge}>
              <Text style={s.previewBadgeText}>SOLO ESTÁS MIRANDO — NO ES TUYO</Text>
              <Pressable onPress={onOpenTienda} hitSlop={8}>
                <Text style={s.previewBadgeLink}>CONSEGUIR ›</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={{ gap: 14 }}>
          {groups.map(({ rarity, items }) => {
            const have = items.filter(isOwned).length;
            const rc = rarity ? GROUP_COLOR[rarity] : RD.textTertiary;
            return (
              <View key={String(rarity)} style={{ gap: 10 }}>
                <View style={s.groupHeader}>
                  <Text style={[s.groupLabel, { color: rc }]}>{GROUP_LABEL[String(rarity)]}</Text>
                  <View style={[s.groupRule, { backgroundColor: rc, opacity: 0.25 }]} />
                  <Text style={s.groupCount}>{rarity ? `${have}/${items.length}` : items.length}</Text>
                </View>
                <View style={s.grid}>
                  {items.map((a) => {
                    const locked = !isOwned(a);
                    const isSelected = !preview && a.key === equipped;
                    const isPreviewing = preview === a.key;
                    return (
                      <Pressable
                        key={a.key}
                        style={s.swatchWrap}
                        onPress={() => handlePick(a)}
                        disabled={saving}
                      >
                        <View style={s.swatchStack}>
                          <Image
                            source={a.thumb}
                            resizeMode="cover"
                            style={[
                              s.swatch,
                              rarity && { borderColor: rc },
                              locked && s.swatchLocked,
                              isSelected && s.swatchSelected,
                              isPreviewing && s.swatchPreviewing,
                            ]}
                          />
                          {locked && !isPreviewing && (
                            <View style={s.lockBadge} pointerEvents="none">
                              <LockIcon color={rarity ? rc : RD.brand} />
                            </View>
                          )}
                          {!locked && rarity && (
                            <View style={[s.ownedPip, { backgroundColor: rc }]} pointerEvents="none" />
                          )}
                        </View>
                        <Text
                          style={[
                            s.swatchLabel,
                            isPreviewing && s.swatchLabelPreviewing,
                            !locked && rarity && { color: rc },
                          ]}
                          numberOfLines={1}
                        >
                          {isPreviewing ? 'Mirando' : avatarDisplayLabel(a)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RD.bg },
  content: { paddingHorizontal: 18, paddingTop: 50, paddingBottom: 40, gap: 16 },
  backLink: { color: RD.textSecondary, fontSize: 12, fontFamily: RD_FONT.mono, marginBottom: 8 },
  pageTitle: {
    color: RD.textPrimary, fontSize: 28, fontFamily: RD_FONT.displayBlack,
    textTransform: 'uppercase', marginTop: -8,
  },
  disclaimer: { color: RD.textTertiary, fontSize: 11, fontFamily: RD_FONT.mono, marginTop: -8 },
  saveError: { color: RD.danger, fontSize: 11, fontFamily: RD_FONT.monoBold, marginTop: -8 },

  preview: {
    height: 320, borderWidth: 1, borderColor: RD.panelBorder, borderRadius: 2,
    backgroundColor: '#111113', overflow: 'hidden',
  },
  previewBadge: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.8)', borderTopWidth: 1, borderTopColor: RD.brand,
    paddingVertical: 7, paddingHorizontal: 10,
  },
  previewBadgeText: { color: RD.textSecondary, fontSize: 9, fontFamily: RD_FONT.mono, letterSpacing: 0.5 },
  previewBadgeLink: { color: RD.brand, fontSize: 10, fontFamily: RD_FONT.monoBold, letterSpacing: 0.5 },

  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupLabel: { fontSize: 10, fontFamily: RD_FONT.monoBold, letterSpacing: 1.2 },
  groupRule: { flex: 1, height: 1 },
  groupCount: {
    color: RD.textTertiary, fontSize: 10, fontFamily: RD_FONT.mono,
    fontVariant: ['tabular-nums'],
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  swatchWrap: { width: 84, alignItems: 'center' },
  swatchStack: { width: 76, height: 96 },
  swatch: {
    width: 76, height: 96, borderRadius: 4, borderWidth: 2, borderColor: 'transparent',
    backgroundColor: RD.gridLine,
  },
  swatchSelected: { borderColor: '#ffffff', borderWidth: 3 },
  swatchPreviewing: { borderColor: RD.brand, borderWidth: 3 },
  swatchLocked: { opacity: 0.32 },
  lockBadge: { position: 'absolute', top: 0, left: 0, width: 76, height: 96, alignItems: 'center', justifyContent: 'center' },
  ownedPip: {
    position: 'absolute', top: -3, right: -3, width: 10, height: 10, borderRadius: 5,
    borderWidth: 1.5, borderColor: RD.bg,
  },
  swatchLabel: { color: RD.textTertiary, fontSize: 9, fontFamily: RD_FONT.mono, marginTop: 6, textAlign: 'center' },
  swatchLabelPreviewing: { color: RD.brand, fontFamily: RD_FONT.monoBold },
});

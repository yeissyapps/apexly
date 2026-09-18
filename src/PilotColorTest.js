// ============================================================================
//  PilotColorTest — envoltorio DEV del visor de piloto con un selector de
//  color básico por pieza (casco/mono/guantes/botas). Todavía NO es el
//  configurador real: sin guardado, sin inventario/rareza, sin Supabase —
//  solo local, para poder ver en caliente cómo queda cada combinación antes
//  de construir la pantalla "Piloto" de verdad (Fase 4 del plan).
//
//  Reutiliza la paleta LIBRE de CAR_COLORS (car.js) tal cual, para no
//  inventar colores nuevos en esta prueba.
// ============================================================================

import { useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import PilotViewer, { PILOT_GROUPS, DEFAULT_PILOT_COLORS } from './PilotViewer';
import { CAR_COLORS } from './car';
import { uploadPilotThumbnail } from './api';

const GROUP_LABEL = {
  casco_v1: 'CASCO',
  mono_v1: 'MONO',
  guantes_v1: 'GUANTES',
  botas_v1: 'BOTAS',
  pelo_v1: 'PELO',
};

const FREE_COLORS = CAR_COLORS.filter((c) => !c.locked);

function hexStrToNum(hex) {
  return parseInt(hex.replace('#', ''), 16);
}

// 6 combos fijos para generar las "variantes por defecto" (JC, 2026-09-15:
// "genera un avatar para cada jugador... no el cuadrado gris"). Renderizado
// 3D DE VERDAD, no un icono aproximado — pero no se puede generar una
// miniatura distinta para cada jugador real desde aquí sin tocar la cuenta
// de cada uno (las policies de Storage solo dejan escribir en tu propia
// carpeta, a propósito). La solución: unas pocas variantes reales,
// asignadas a cada jugador por hash de su nick (ver AvatarThumb.js) — así
// nadie ve un cuadrado gris y no todo el mundo sale igual, sin necesitar
// credenciales de administrador para escribir en cuentas ajenas.
const DEFAULT_VARIANTS = [
  { casco_v1: 0x2b5fb8, mono_v1: 0xf0eee8, guantes_v1: 0x17171a, botas_v1: 0x17171a }, // azul/blanco
  { casco_v1: 0xd32b1e, mono_v1: 0xf0eee8, guantes_v1: 0x17171a, botas_v1: 0x17171a }, // rojo/blanco
  { casco_v1: 0x1f5c3a, mono_v1: 0xf0eee8, guantes_v1: 0x17171a, botas_v1: 0x17171a }, // verde/blanco
  { casco_v1: 0x17171a, mono_v1: 0xf5c518, guantes_v1: 0x17171a, botas_v1: 0x17171a }, // negro/amarillo
  { casco_v1: 0xf0eee8, mono_v1: 0x17171a, guantes_v1: 0xf0eee8, botas_v1: 0xf0eee8 }, // blanco/negro
  { casco_v1: 0xe8611a, mono_v1: 0x2b5fb8, guantes_v1: 0x17171a, botas_v1: 0x17171a }, // naranja/azul
];

export default function PilotColorTest({ onBack }) {
  const [colors, setColors] = useState(DEFAULT_PILOT_COLORS);
  const viewerRef = useRef(null);
  const [thumbState, setThumbState] = useState('idle'); // idle | capturing | uploading | done | error
  const [thumbUrl, setThumbUrl] = useState(null);
  const [thumbError, setThumbError] = useState(null);

  async function handleSaveThumbnail() {
    setThumbError(null);
    try {
      setThumbState('capturing');
      const localUri = await viewerRef.current.capture();
      setThumbState('uploading');
      const url = await uploadPilotThumbnail(localUri);
      setThumbUrl(url);
      setThumbState('done');
    } catch (e) {
      setThumbError(String(e?.message || e));
      setThumbState('error');
    }
  }

  const [variantsState, setVariantsState] = useState('idle'); // idle | running | done | error
  const [variantsLog, setVariantsLog] = useState([]);

  // Genera las 6 variantes de golpe: cambia de color, espera a que el
  // visor termine de re-teñir y pinte un frame nuevo, captura, sube con
  // updateUser=false (esto NO es tu miniatura, son plantillas). El log de
  // cada URL sale por consola — se recogen ahí para copiarlas al repo como
  // assets locales (ver AvatarThumb.js).
  async function handleGenerateVariants() {
    setVariantsState('running');
    setVariantsLog([]);
    try {
      for (let i = 0; i < DEFAULT_VARIANTS.length; i++) {
        setColors(DEFAULT_VARIANTS[i]);
        await new Promise((resolve) => setTimeout(resolve, 400));
        const localUri = await viewerRef.current.capture();
        const url = await uploadPilotThumbnail(localUri, `variant-${i}.png`, false);
        console.log(`[avatar-variant] ${i} -> ${url}`);
        setVariantsLog((prev) => [...prev, `${i}: OK`]);
      }
      setVariantsState('done');
    } catch (e) {
      console.warn('[avatar-variant] fallo', e);
      setVariantsState('error');
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Pressable onPress={onBack} style={styles.back} hitSlop={12}>
        <Text style={styles.backText}>‹ PERFIL</Text>
      </Pressable>

      <View style={{ flex: 1 }}>
        <PilotViewer ref={viewerRef} colors={colors} />
      </View>

      {/* Prueba de humo de la Fase 2 (miniatura para listas) — captura lo
          que se ve AHORA en el visor, lo sube a Storage, y enseña el
          resultado aquí mismo como confirmación de que el ida-y-vuelta
          completo funciona antes de tocar ninguna pantalla de ranking. */}
      <View style={styles.thumbBar}>
        <Pressable
          onPress={handleSaveThumbnail}
          disabled={thumbState === 'capturing' || thumbState === 'uploading'}
          style={styles.thumbBtn}
        >
          <Text style={styles.thumbBtnText}>
            {thumbState === 'capturing' ? 'CAPTURANDO…'
              : thumbState === 'uploading' ? 'SUBIENDO…'
              : '[DEV] GUARDAR MINIATURA'}
          </Text>
        </Pressable>
        {thumbState === 'done' && thumbUrl && (
          <Image source={{ uri: thumbUrl }} style={styles.thumbPreview} />
        )}
        {thumbState === 'error' && (
          <Text style={styles.thumbError} numberOfLines={2}>{thumbError}</Text>
        )}
      </View>

      {/* Generador de variantes por defecto (una sola vez, JC lo pulsa y ya
          está) — ver DEFAULT_VARIANTS arriba. */}
      <View style={styles.variantsBar}>
        <Pressable
          onPress={handleGenerateVariants}
          disabled={variantsState === 'running'}
          style={styles.thumbBtn}
        >
          <Text style={styles.thumbBtnText}>
            {variantsState === 'running'
              ? `GENERANDO ${variantsLog.length}/${DEFAULT_VARIANTS.length}…`
              : '[DEV] GENERAR 6 VARIANTES POR DEFECTO'}
          </Text>
        </Pressable>
        {variantsState === 'done' && <Text style={styles.variantsDone}>Listo — mira la consola de Metro</Text>}
        {variantsState === 'error' && <Text style={styles.thumbError}>Fallo generando variantes, mira la consola</Text>}
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={{ padding: 14, gap: 14 }}>
        {PILOT_GROUPS.map((group) => (
          <View key={group} style={{ gap: 8 }}>
            <Text style={styles.label}>{GROUP_LABEL[group]}</Text>
            <View style={styles.row}>
              {FREE_COLORS.map((opt) => {
                const hex = hexStrToNum(opt.c);
                const selected = colors[group] === hex;
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() => setColors((prev) => ({ ...prev, [group]: hex }))}
                    style={[
                      styles.swatch,
                      { backgroundColor: opt.c },
                      selected && styles.swatchSelected,
                    ]}
                  />
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', top: 50, left: 18, zIndex: 10 },
  backText: { color: '#fff', fontFamily: 'monospace' },
  panel: { maxHeight: 220, backgroundColor: '#111' },
  label: { color: '#aaa', fontFamily: 'monospace', fontSize: 11, letterSpacing: 1 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  swatch: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 2, borderColor: '#333',
  },
  swatchSelected: { borderColor: '#fff' },

  thumbBar: {
    position: 'absolute', bottom: 232, left: 14, right: 14,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  thumbBtn: {
    borderWidth: 1, borderColor: '#665', borderStyle: 'dashed', borderRadius: 4,
    paddingVertical: 8, paddingHorizontal: 12,
  },
  thumbBtnText: { color: '#aa8', fontFamily: 'monospace', fontSize: 11 },
  thumbPreview: {
    width: 40, height: 40, borderRadius: 4,
    borderWidth: 1, borderColor: '#333', backgroundColor: '#222',
  },
  thumbError: { color: '#e05a5a', fontFamily: 'monospace', fontSize: 10, flex: 1 },

  variantsBar: {
    position: 'absolute', bottom: 264, left: 14, right: 14,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  variantsDone: { color: '#8a8', fontFamily: 'monospace', fontSize: 10 },
});

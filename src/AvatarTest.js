// ============================================================================
//  AvatarTest — pantalla DEV para los "muñecos enteros" de la Fase 4 (JC,
//  2026-09-15): visor real con textura horneada, y generador de miniaturas
//  en lote (mismo patrón que "GENERAR 6 VARIANTES" de PilotColorTest.js,
//  adaptado a un solo avatar completo por captura en vez de un recolor).
// ============================================================================

import { useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AvatarViewer from './AvatarViewer';
import { uploadPilotThumbnail } from './api';
import { AVATARS } from './avatarCatalog';

export default function AvatarTest({ onBack }) {
  const [current, setCurrent] = useState(AVATARS[0]);
  const viewerRef = useRef(null);
  const readyResolveRef = useRef(null);

  const [genState, setGenState] = useState('idle'); // idle | running | done | error
  const [genLog, setGenLog] = useState([]);

  function waitForReady() {
    return new Promise((resolve) => { readyResolveRef.current = resolve; });
  }

  // Recorre los 5, uno a uno: cambia de avatar, espera el frame real
  // (onReady, no un timeout a ciegas), captura, sube a Storage con
  // updateUser=false (son plantillas, no la miniatura de JC) y deja la
  // URL en el log para bajarlas al repo después.
  //
  // OJO: si el avatar ya estaba seleccionado (típicamente el primero de
  // la lista, que es el que se ve al entrar), cambiar `current` al mismo
  // valor no fuerza un remount de AvatarViewer (React no ve un `key`
  // distinto) — y `onReady` solo dispara una vez por montaje, así que
  // `waitForReady()` se queda esperando para siempre. Se fuerza un
  // desmontaje real (current=null) antes de cada paso para garantizar
  // un montaje fresco y un onReady nuevo siempre.
  async function handleGenerateAll() {
    setGenState('running');
    setGenLog([]);
    try {
      for (const a of AVATARS) {
        setCurrent(null);
        await new Promise((r) => setTimeout(r, 50));
        setCurrent(a);
        await waitForReady();
        await new Promise((r) => setTimeout(r, 150)); // un frame extra de margen
        const localUri = await viewerRef.current.capture();
        const url = await uploadPilotThumbnail(localUri, `avatar-${a.key}.png`, false);
        console.log(`[avatar-thumb] ${a.key} -> ${url}`);
        setGenLog((prev) => [...prev, `${a.key}: OK`]);
      }
      setGenState('done');
    } catch (e) {
      console.warn('[avatar-thumb] fallo', e);
      setGenState('error');
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Pressable onPress={onBack} style={styles.back} hitSlop={12}>
        <Text style={styles.backText}>‹ PERFIL</Text>
      </Pressable>

      <View style={{ flex: 1 }}>
        {current && (
          <AvatarViewer
            key={current.key}
            ref={viewerRef}
            source={current.glb}
            cacheKey={current.key}
            onReady={() => readyResolveRef.current && readyResolveRef.current()}
          />
        )}
      </View>

      <View style={styles.genBar}>
        <Pressable
          onPress={handleGenerateAll}
          disabled={genState === 'running'}
          style={styles.genBtn}
        >
          <Text style={styles.genBtnText}>
            {genState === 'running' ? `GENERANDO ${genLog.length}/${AVATARS.length}…` : `[DEV] GENERAR ${AVATARS.length} MINIATURAS`}
          </Text>
        </Pressable>
        {genState === 'done' && <Text style={styles.genDone}>Listo — mira la consola de Metro</Text>}
        {genState === 'error' && <Text style={styles.genError}>Fallo generando, mira la consola</Text>}
      </View>

      <ScrollView
        horizontal
        style={styles.panel}
        contentContainerStyle={{ padding: 14, gap: 10 }}
        showsHorizontalScrollIndicator={false}
      >
        {AVATARS.map((a) => (
          <Pressable
            key={a.key}
            onPress={() => setCurrent(a)}
            style={[styles.chip, current?.key === a.key && styles.chipSelected]}
          >
            <Text style={[styles.chipText, current?.key === a.key && styles.chipTextSelected]}>
              {a.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', top: 50, left: 18, zIndex: 10 },
  backText: { color: '#fff', fontFamily: 'monospace' },
  genBar: {
    position: 'absolute', bottom: 74, left: 14, right: 14,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  genBtn: {
    borderWidth: 1, borderColor: '#665', borderStyle: 'dashed', borderRadius: 4,
    paddingVertical: 8, paddingHorizontal: 12,
  },
  genBtnText: { color: '#aa8', fontFamily: 'monospace', fontSize: 11 },
  genDone: { color: '#8a8', fontFamily: 'monospace', fontSize: 10 },
  genError: { color: '#e05a5a', fontFamily: 'monospace', fontSize: 10 },
  panel: { position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: 70, backgroundColor: '#111' },
  chip: {
    borderWidth: 1, borderColor: '#333', borderRadius: 4,
    paddingVertical: 10, paddingHorizontal: 14, justifyContent: 'center',
  },
  chipSelected: { borderColor: '#fff', backgroundColor: '#222' },
  chipText: { color: '#888', fontFamily: 'monospace', fontSize: 11 },
  chipTextSelected: { color: '#fff' },
});

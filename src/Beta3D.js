// ============================================================================
//  Beta3D — Fase 1 del plan de evaluación 3D (kits de Kenney).
//
//  Fase 0 (cubo girando) confirmó que expo-gl + three arrancan limpios en
//  este proyecto (New Architecture activa) — ver el plan en
//  C:\Users\JC\.claude\plans\ticklish-dazzling-wand.md para el escollo de
//  versión (three>=r163 exige WebGL2, expo-gl da WebGL1: hay que quedarse en
//  expo-three@7.0.1 + three@0.145.0).
//
//  Esta fase: cargar el modelo real (`race.glb`, del kit de coches de
//  Kenney — mide 1.2×0.93×2.56, encaja con holgura en el canal de 2.0 del
//  kit de pistas) y probar el recoloreado por material en vez del atlas de
//  color de fábrica. La técnica (ver plan, Fase 1): el kit pinta todo con
//  un único `colormap.png` compartido — así que en vez de intentar
//  recolorear esa textura, se sustituye el material de la carrocería
//  (mesh "body", confirmado leyendo el glTF) por uno propio, con el color
//  fijado por código. Las ruedas se dejan con su material de fábrica.
//
//  Pantalla oculta a propósito (ver BETA3D_AUTOSTART en App.js).
// ============================================================================

import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GLView } from 'expo-gl';
import { Renderer } from 'expo-three';
import { Asset } from 'expo-asset';
// SDK 57 movió readAsStringAsync a una API nueva (File/Directory) y la
// dejó deprecada aquí — para esta beta, la legacy sigue haciendo
// exactamente lo que necesitamos (leer un asset local a base64).
import * as FileSystem from 'expo-file-system/legacy';
import { toByteArray } from 'base64-js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Acabados a probar — mismo vocabulario que car.js (flat/metalizado/
// holografico), para que la comparación con el SVG actual sea justa.
const FINISHES = [
  { id: 'flat_rojo', label: 'PLANO ROJO', color: 0xff5a3c, metalness: 0.1, roughness: 0.6 },
  { id: 'flat_azul', label: 'PLANO AZUL', color: 0x3c7dff, metalness: 0.1, roughness: 0.6 },
  { id: 'metalizado', label: 'METALIZADO', color: 0xb8bec7, metalness: 0.85, roughness: 0.25 },
  { id: 'holografico', label: 'HOLOGRÁFICO', color: 0xffffff, metalness: 0.4, roughness: 0.3, holo: true },
];

export default function Beta3D({ onBack }) {
  const [fps, setFps] = useState(0);
  const [status, setStatus] = useState('cargando modelo…');
  const [finishIdx, setFinishIdx] = useState(0);
  const bodyMeshRef = useRef(null);
  const finishIdxRef = useRef(0);

  function applyFinish(idx) {
    finishIdxRef.current = idx;
    const mesh = bodyMeshRef.current;
    if (!mesh) return;
    const f = FINISHES[idx];
    mesh.material.color.setHex(f.color);
    mesh.material.metalness = f.metalness;
    mesh.material.roughness = f.roughness;
    setStatus(`race.glb cargado · ${f.label}`);
  }

  function nextFinish() {
    const idx = (finishIdxRef.current + 1) % FINISHES.length;
    setFinishIdx(idx);
    applyFinish(idx);
  }

  async function onContextCreate(gl) {
    const renderer = new Renderer({ gl });
    renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
    renderer.setClearColor(0x11151c);

    const camera = new THREE.PerspectiveCamera(
      50,
      gl.drawingBufferWidth / gl.drawingBufferHeight,
      0.05,
      50,
    );
    // El coche mide 2.56 de largo (eje Z) — en un móvil en vertical el FOV
    // horizontal es más estrecho que el vertical (aspect < 1), así que con
    // la distancia ajustada solo al alto se salía por los lados. Alejada
    // ~1.5x para que quepa entera con el morro/cola girando.
    camera.position.set(3.3, 2.1, 3.9);
    camera.lookAt(0, 0.3, 0);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(3, 5, 2);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x6f9bff, 0.5);
    rim.position.set(-3, 2, -2);
    scene.add(rim);

    let carRoot = null;

    try {
      setStatus('resolviendo asset…');
      const asset = Asset.fromModule(require('../assets/beta3d/race.glb'));
      await asset.downloadAsync();
      const uri = asset.localUri || asset.uri;

      // Dos intentos previos fallaron con este mismo archivo local:
      // GLTFLoader.load() (fetch propio de three, vía FileLoader) parseaba
      // basura como si fuera JSON, y `fetch(uri).arrayBuffer()` a secas se
      // quedaba colgado sin resolver ni rechazar nunca — ninguno de los dos
      // caminos de red lee bien un file:// local aquí. Vía fiable en Expo:
      // leer el archivo como base64 con expo-file-system (pensado para
      // esto) y decodificarlo a bytes a mano con base64-js — cero fetch,
      // cero XHR, solo lectura de fichero + un decode síncrono.
      setStatus('leyendo fichero (base64)…');
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const bytes = toByteArray(base64);

      setStatus('parseando glTF…');
      // El monkeypatch de expo-three sobre THREE.TextureLoader.prototype.load
      // (ver node_modules/expo-three/build/loadTexture.js) solo llama a
      // onLoad si el loader tiene un "asset provider" puesto con setPath() —
      // pensado para texturas en ficheros sueltos junto al modelo (OBJ+MTL),
      // no para las que vienen EMBEBIDAS en el propio .glb (nuestro caso, un
      // único colormap.png dentro del binario). Sin eso, onLoad no se
      // llama nunca y GLTFLoader.parse() se queda esperando esa promesa
      // para siempre. No necesitamos ese atlas de fábrica (el cuerpo ya
      // lleva su propio material, ver más abajo), así que para esta fase se
      // fuerza a que cualquier textura resuelva al instante sin decodificar
      // nada — el material del cuerpo no la usa, y las ruedas se quedan sin
      // textura de fábrica (planas), que es aceptable para validar el
      // recoloreado.
      const origLoad = THREE.TextureLoader.prototype.load;
      THREE.TextureLoader.prototype.load = function (url, onLoad) {
        const tex = new THREE.Texture();
        if (onLoad) onLoad(tex);
        return tex;
      };
      let gltf;
      try {
        gltf = await new Promise((resolve, reject) => {
          new GLTFLoader().parse(bytes.buffer, '', resolve, reject);
        });
      } finally {
        THREE.TextureLoader.prototype.load = origLoad;
      }
      carRoot = gltf.scene;
      scene.add(carRoot);

      carRoot.traverse((obj) => {
        if (obj.isMesh && obj.name === 'body') {
          // Material propio, SIN el atlas de color de fábrica — así el
          // color se controla por código (ver applyFinish). El resto de
          // piezas (ruedas) se quedan con su material tal cual venía.
          obj.material = new THREE.MeshStandardMaterial();
          bodyMeshRef.current = obj;
        }
      });
      applyFinish(finishIdxRef.current);
    } catch (err) {
      setStatus('ERROR cargando el modelo: ' + String(err?.message || err));
    }

    let frames = 0;
    let lastFpsAt = Date.now();

    const render = () => {
      requestAnimationFrame(render);

      if (carRoot) {
        // Plato giratorio, mismo espíritu que el garaje 2D actual — deja
        // ver el coche desde todos los ángulos sin necesitar controles
        // táctiles de cámara en esta fase.
        carRoot.rotation.y += 0.012;

        const mesh = bodyMeshRef.current;
        if (mesh && FINISHES[finishIdxRef.current].holo) {
          const hue = (Date.now() % 4000) / 4000;
          mesh.material.color.setHSL(hue, 0.85, 0.6);
        }
      }

      renderer.render(scene, camera);
      gl.endFrameEXP();

      frames++;
      const now = Date.now();
      if (now - lastFpsAt >= 500) {
        setFps(Math.round((frames * 1000) / (now - lastFpsAt)));
        frames = 0;
        lastFpsAt = now;
      }
    };
    render();
  }

  return (
    <View style={styles.root}>
      <GLView style={styles.gl} onContextCreate={onContextCreate} />
      <View style={styles.hud}>
        <Text style={styles.hudText}>BETA 3D · Fase 1 · {fps} fps</Text>
        <Text style={styles.hudSub}>{status}</Text>
      </View>
      <Pressable style={styles.back} onPress={onBack}>
        <Text style={styles.backText}>← VOLVER</Text>
      </Pressable>
      <Pressable style={styles.finishBtn} onPress={nextFinish}>
        <Text style={styles.backText}>ACABADO: {FINISHES[finishIdx].label} →</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#11151c' },
  gl: { flex: 1 },
  hud: { position: 'absolute', top: 50, left: 16 },
  hudText: { color: '#eef0f4', fontSize: 14, fontWeight: '700' },
  hudSub: { color: '#9aa3b2', fontSize: 11, marginTop: 2, maxWidth: 260 },
  back: { position: 'absolute', top: 48, right: 16, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 8 },
  backText: { color: '#eef0f4', fontSize: 13, fontWeight: '700' },
  finishBtn: { position: 'absolute', bottom: 48, alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 20, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 10 },
});

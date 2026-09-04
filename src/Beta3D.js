// ============================================================================
//  Beta3D — Fase 2 del plan de evaluación 3D (kits de Kenney).
//
//  Fase 0 (cubo girando) y Fase 1 (coche recolorable) — ver el plan en
//  C:\Users\JC\.claude\plans\ticklish-dazzling-wand.md para los escollos ya
//  resueltos (versión de three/expo-gl, lectura de assets locales, texturas
//  embebidas en el .glb).
//
//  Esta fase: un circuito de PRUEBA fijo (no generado a diario todavía — ver
//  "Fuera de alcance" del plan) ensamblado con piezas 3D reales del kit de
//  pistas de Kenney. El banco de piezas (`src/beta3d/piecesKenney.js`) usa
//  el MISMO patrón que el generador diario (`src/pieces.js` + `src/track.js`
//  vía `buildTrackFromCenterline`), así que el centerline resultante es
//  compatible con la física real del juego sin tocarla — aquí solo se
//  RENDERIZA, no se conduce todavía (eso es la Fase 3).
// ============================================================================

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GLView } from 'expo-gl';
import { Renderer } from 'expo-three';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { toByteArray } from 'base64-js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assembleBeta } from './beta3d/piecesKenney';

const GLB_MODULES = {
  race: require('../assets/beta3d/race.glb'),
  'track-straight': require('../assets/beta3d/track-straight.glb'),
  'track-corner-small': require('../assets/beta3d/track-corner-small.glb'),
};

// Óvalo cerrado de prueba: 2 rectas + 2 "U" de 180° (cada una, 2 curvas de
// 90° seguidas en el mismo sentido) — con las 4 curvas iguales y las 2
// rectas iguales, cierra en posición Y en rumbo por simetría, sin tener que
// calcular nada a mano.
const TEST_LOOP = [
  'straight', 'corner_small_L', 'corner_small_L',
  'straight', 'corner_small_L', 'corner_small_L',
];

// Lee un .glb empaquetado como bytes (ver Fase 1 del plan: ni
// GLTFLoader.load() ni fetch(uri).arrayBuffer() leen bien un file:// local
// aquí) y lo parsea, con las texturas de fábrica stubadas a resolución
// instantánea (ver el mismo comentario en la Fase 1 del plan — el
// monkeypatch de expo-three sobre TextureLoader solo dispara onLoad con un
// asset provider por setPath(), que no aplica a texturas EMBEBIDAS).
async function loadGlb(moduleRef) {
  const asset = Asset.fromModule(moduleRef);
  await asset.downloadAsync();
  const base64 = await FileSystem.readAsStringAsync(asset.localUri || asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = toByteArray(base64);

  const origLoad = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = function (url, onLoad) {
    const tex = new THREE.Texture();
    if (onLoad) onLoad(tex);
    return tex;
  };
  try {
    const gltf = await new Promise((resolve, reject) => {
      new GLTFLoader().parse(bytes.buffer, '', resolve, reject);
    });
    return gltf.scene;
  } finally {
    THREE.TextureLoader.prototype.load = origLoad;
  }
}

// pose del centerline (x,y,angle en el plano 2D del juego) -> transform 3D.
//
// Mapeo: mundo.X = juego.x, mundo.Z = -juego.y (OJO al signo — ver abajo),
// mundo.Y = arriba (pista plana, Y=0 en todos los puntos por ahora).
//
// El signo de Z NO es arbitrario: con mundo.Z=+juego.y directo, la recta
// encajaba con la curva siguiente (una recta es simétrica, cualquier signo
// "cuela") pero DOS curvas seguidas dejaban un hueco — la pieza se
// dibujaba en espejo lateral. Motivo: una rotación pura alrededor de Y no
// puede a la vez (a) apuntar el eje +Z local de la pieza (su "frente") en
// la dirección de avance Y (b) apuntar su eje +X local (su lateral, el
// ancho del canal) en la lateral correcta — con el mapeo directo, esas dos
// condiciones se contradicen entre sí (una rotación conserva orientación;
// arreglar solo el frente deja el lateral en espejo). Con mundo.Z=-juego.y
// las dos condiciones coinciden en el mismo ángulo — comprobado analítica
// y luego en dispositivo (el óvalo cierra sin huecos).
function gameToWorldXZ(x, y) {
  return { x, z: -y };
}
function headingToRotationY(angleRad) {
  return angleRad + Math.PI / 2;
}
function poseToObject3D(pose) {
  const { x, z } = gameToWorldXZ(pose.x, pose.y);
  return { position: new THREE.Vector3(x, 0, z), rotationY: headingToRotationY(pose.angle) };
}

const FINISHES = [
  { id: 'flat_rojo', label: 'PLANO ROJO', color: 0xff5a3c, metalness: 0.1, roughness: 0.6 },
  { id: 'flat_azul', label: 'PLANO AZUL', color: 0x3c7dff, metalness: 0.1, roughness: 0.6 },
  { id: 'metalizado', label: 'METALIZADO', color: 0xb8bec7, metalness: 0.85, roughness: 0.25 },
  { id: 'holografico', label: 'HOLOGRÁFICO', color: 0xffffff, metalness: 0.4, roughness: 0.3, holo: true },
];

export default function Beta3D({ onBack }) {
  const [fps, setFps] = useState(0);
  const [status, setStatus] = useState('cargando pista…');

  async function onContextCreate(gl) {
    const renderer = new Renderer({ gl });
    renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
    renderer.setClearColor(0x11151c);

    const camera = new THREE.PerspectiveCamera(
      55,
      gl.drawingBufferWidth / gl.drawingBufferHeight,
      0.05,
      100,
    );

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(4, 8, 3);
    scene.add(sun);

    let carMesh = null;
    const bodyMeshHolder = { current: null };
    let finishIdx = 0;

    try {
      setStatus('ensamblando circuito…');
      const { center, placements } = assembleBeta(TEST_LOOP);

      setStatus('cargando piezas de pista…');
      const straightProto = await loadGlb(GLB_MODULES['track-straight']);
      const cornerProto = await loadGlb(GLB_MODULES['track-corner-small']);
      const protoByGlb = { 'track-straight': straightProto, 'track-corner-small': cornerProto };

      // Igual que con el cuerpo del coche (Fase 1): el material de fábrica
      // usa la textura "stub" vacía de loadGlb, que en las ruedas cuela
      // (negro = neumático) pero en el asfalto se ve como un agujero sin
      // luz. Material propio, plano, tono asfalto — no hace falta que sea
      // recolorable todavía, esta fase es sobre si las piezas ENCAJAN.
      const roadMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.05, roughness: 0.9 });
      for (const proto of [straightProto, cornerProto]) {
        proto.traverse((obj) => { if (obj.isMesh) obj.material = roadMat; });
      }

      for (const pl of placements) {
        const proto = protoByGlb[pl.glb];
        const inst = proto.clone(true);
        const { position, rotationY } = poseToObject3D(pl.pose);
        inst.position.copy(position);
        inst.rotation.y = rotationY;
        scene.add(inst);
      }

      // Encuadre general: cámara elevada mirando al centro del bbox del
      // circuito entero, igual de espíritu que el bbox del césped en el
      // juego 2D (Game.js) — aquí para que la cámara SIEMPRE quepa el óvalo
      // entero sea cual sea su tamaño, sin números mágicos por trazado.
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of center) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minZ) minZ = p.y; if (p.y > maxZ) maxZ = p.y;
      }
      // minZ/maxZ están en coordenadas de JUEGO (p.y), no de mundo three —
      // pasan por el mismo gameToWorldXZ que las piezas para que la cámara
      // apunte al centro real de lo que se ha dibujado.
      const { x: worldCx, z: worldCz } = gameToWorldXZ((minX + maxX) / 2, (minZ + maxZ) / 2);
      const spanMax = Math.max(maxX - minX, maxZ - minZ, 4);
      // Cenital casi exacto (un pelín de offset para que lookAt no degenere
      // con la cámara justo encima del objetivo).
      camera.position.set(worldCx, spanMax * 4, worldCz + 0.01);
      camera.lookAt(worldCx, 0, worldCz);

      setStatus('cargando coche…');
      const raceScene = await loadGlb(GLB_MODULES.race);
      raceScene.traverse((obj) => {
        if (obj.isMesh && obj.name === 'body') {
          obj.material = new THREE.MeshStandardMaterial();
          bodyMeshHolder.current = obj;
        }
      });
      const start = center[0];
      const startNext = center[1];
      const startHeading = Math.atan2(startNext.y - start.y, startNext.x - start.x);
      const startXZ = gameToWorldXZ(start.x, start.y);
      raceScene.position.set(startXZ.x, 0.02, startXZ.z);
      raceScene.rotation.y = headingToRotationY(startHeading);
      scene.add(raceScene);
      carMesh = raceScene;

      if (bodyMeshHolder.current) {
        const f = FINISHES[0];
        bodyMeshHolder.current.material.color.setHex(f.color);
        bodyMeshHolder.current.material.metalness = f.metalness;
        bodyMeshHolder.current.material.roughness = f.roughness;
      }

      setStatus(`óvalo (${placements.length} piezas) + race.glb cargados`);
    } catch (err) {
      setStatus('ERROR: ' + String(err?.message || err));
    }

    let frames = 0;
    let lastFpsAt = Date.now();
    const render = () => {
      requestAnimationFrame(render);
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
        <Text style={styles.hudText}>BETA 3D · Fase 2 · {fps} fps</Text>
        <Text style={styles.hudSub}>{status}</Text>
      </View>
      <Pressable style={styles.back} onPress={onBack}>
        <Text style={styles.backText}>← VOLVER</Text>
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
});

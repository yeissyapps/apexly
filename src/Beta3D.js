// ============================================================================
//  Beta3D — Fase 3 del plan de evaluación 3D (kits de Kenney).
//
//  Fases 0/1/2 — ver el plan en C:\Users\JC\.claude\plans\ticklish-dazzling-wand.md
//  para los escollos ya resueltos (versión de three/expo-gl, lectura de
//  assets locales, texturas embebidas en el .glb, ángulo analítico de las
//  piezas, espejo lateral en el mapeo 2D->3D).
//
//  Esta fase: TODO junto y jugable — el circuito de piezas Kenney (ahora
//  abierto, no un óvalo cerrado: ver FASE3_PATH) + la física REAL del juego
//  (stepSimulation/initialState, importadas tal cual de Game.js, sin tocar
//  ni una línea) + el mismo esquema de entrada táctil que la pantalla de
//  producción (resolveEntrada con su "pulso" al soltar) + un cronómetro que
//  usa el mismo criterio de meta que ya existe (track.finish). Cámara en
//  persecución (no cenital como en la Fase 2): es la que de verdad deja
//  sentir velocidad y control en un circuito 3D real.
// ============================================================================

import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GLView } from 'expo-gl';
import { Renderer } from 'expo-three';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { toByteArray } from 'base64-js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { assembleBeta, SCALE } from './beta3d/piecesKenney';
import { buildTrackFromCenterline } from './track';
import { initialState, stepSimulation, FIXED_DT } from './Game';
import { CONFIG } from './config';
import { fmt } from './format';

const now = () => Date.now();
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const GLB_MODULES = {
  race: require('../assets/beta3d/race.glb'),
  'track-straight': require('../assets/beta3d/track-straight.glb'),
  'track-corner-small': require('../assets/beta3d/track-corner-small.glb'),
};

// Circuito de prueba ABIERTO (a diferencia del óvalo cerrado de la Fase 2):
// salida y meta separadas ~416 unidades (verificado en Node antes de tocar
// el dispositivo — ver el plan), porque track.finish se coloca en el ÚLTIMO
// punto de la línea central (igual que en el juego real, donde salida y
// meta NUNCA coinciden — los combos de pieces.js son todos de punta a
// punta). Con un óvalo cerrado la meta cae encima mismo de la salida y
// stepSimulation la daría por cruzada en el primer frame.
const FASE3_PATH = [
  'straight', 'straight',
  'corner_small_L',
  'straight',
  'corner_small_L',
  'straight', 'straight',
];

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

// Mismo mapeo 2D->3D validado en la Fase 2 (ver el comentario largo de esa
// fase en el plan): mundo.Z = -juego.y es lo que hace que el eje lateral de
// cada pieza (y del coche) no salga en espejo.
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
// Vector de avance en el mundo 3D para un rumbo de juego dado — MISMA
// convención que gameToWorldXZ pero aplicada a una dirección, no a un punto
// (se deriva de cómo stepSimulation mueve x,y: vx=cos(heading), vy=sin(heading)).
// La cámara de persecución la usa para colocarse "detrás" del coche.
function headingToWorldForward(heading) {
  return { x: Math.cos(heading), z: -Math.sin(heading) };
}

const GROUND_Y = 0.02 * SCALE;
// Cámara en persecución: constantes en las mismas "unidades de mundo" que la
// pista (straight=208, radio de curva=104 — ver piecesKenney.js). Ajustables
// a ojo tras probar en mano.
const CHASE_BEHIND = 190;
const CHASE_HEIGHT = 125;
const CHASE_LOOKAHEAD = 90;
const CHASE_LOOK_HEIGHT = 25;

function fmtMain(ms) {
  const s = fmt(ms);
  return s.slice(0, s.length - 2);
}
function fmtFrac(ms) {
  const s = fmt(ms);
  return s.slice(-2);
}

export default function Beta3D({ onBack }) {
  const [hud, setHud] = useState({ status: 'cargando circuito…', fps: 0, elapsed: 0, phase: 'loading' });

  const pressLeft = useRef(false);
  const pressRight = useRef(false);
  const entrada = useRef(0);
  const ultimoLado = useRef(0);
  const pulsoDir = useRef(0);
  const pulsoHasta = useRef(0);
  const relojAbajo = useRef(0);
  const entradaEfectiva = useRef(0);
  const gameRef = useRef(null);
  const trackRef = useRef(null);
  const statusRef = useRef('cargando circuito…');

  // Copia exacta de resolveEntrada() en Game.js — mismo esquema de entrada
  // que la pantalla de producción (remate fijo al soltar, desempate del
  // último lado si los dos están pulsados a la vez).
  function resolveEntrada() {
    const left = pressLeft.current;
    const right = pressRight.current;
    if (left && right) entrada.current = ultimoLado.current || -1;
    else if (left) entrada.current = -1;
    else if (right) entrada.current = 1;
    else entrada.current = 0;

    if (entrada.current !== 0) {
      if (pulsoDir.current !== entrada.current || relojAbajo.current === 0) {
        relojAbajo.current = now();
      }
      pulsoDir.current = entrada.current;
    } else if (relojAbajo.current !== 0) {
      const hasta = relojAbajo.current + CONFIG.MIN_INPUT_MS;
      pulsoHasta.current = hasta > now() ? hasta : 0;
      relojAbajo.current = 0;
    }
  }

  function startRun() {
    const s = gameRef.current;
    if (s && s.phase === 'ready') {
      s.phase = 'running';
      s.startTime = now();
      s.lastTime = now();
      s.acc = 0;
    }
  }

  function onSidePress(lado) {
    const yaEstaba = lado === -1 ? pressLeft.current : pressRight.current;
    if (!yaEstaba) ultimoLado.current = lado;
    if (lado === -1) pressLeft.current = true; else pressRight.current = true;
    resolveEntrada();
    startRun();
  }
  function onSideRelease(lado) {
    if (lado === -1) pressLeft.current = false; else pressRight.current = false;
    resolveEntrada();
  }

  function resetRun() {
    const track = trackRef.current;
    if (!track || !gameRef.current) return;
    Object.assign(gameRef.current, initialState(track));
    pressLeft.current = false;
    pressRight.current = false;
    entrada.current = 0;
    pulsoDir.current = 0;
    pulsoHasta.current = 0;
    relojAbajo.current = 0;
  }

  async function onContextCreate(gl) {
    const renderer = new Renderer({ gl });
    renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
    renderer.setClearColor(0x11151c);

    const camera = new THREE.PerspectiveCamera(
      62,
      gl.drawingBufferWidth / gl.drawingBufferHeight,
      1,
      4000,
    );

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(4, 8, 3);
    scene.add(sun);

    let carObj = null;

    const setStatus = (msg) => {
      statusRef.current = msg;
    };

    try {
      setStatus('ensamblando circuito…');
      const { center, placements } = assembleBeta(FASE3_PATH);
      const track = buildTrackFromCenterline(center);
      trackRef.current = track;
      const s = initialState(track);
      gameRef.current = s;

      setStatus('cargando piezas de pista…');
      const straightProto = await loadGlb(GLB_MODULES['track-straight']);
      const cornerProto = await loadGlb(GLB_MODULES['track-corner-small']);
      const protoByGlb = { 'track-straight': straightProto, 'track-corner-small': cornerProto };

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
        inst.scale.setScalar(SCALE);
        scene.add(inst);
      }

      setStatus('cargando coche…');
      const raceScene = await loadGlb(GLB_MODULES.race);
      raceScene.traverse((obj) => {
        if (obj.isMesh && obj.name === 'body') {
          obj.material = new THREE.MeshStandardMaterial({ color: 0xff5a3c, metalness: 0.1, roughness: 0.6 });
        }
      });
      raceScene.scale.setScalar(SCALE);
      scene.add(raceScene);
      carObj = raceScene;

      setStatus('listo — toca para arrancar');
    } catch (err) {
      setStatus('ERROR: ' + String(err?.message || err));
    }

    let frames = 0;
    let fpsNow = 0;
    let lastFpsAt = now();
    let lastHudAt = 0;

    const render = () => {
      requestAnimationFrame(render);
      const s = gameRef.current;
      const track = trackRef.current;
      const t = now();

      if (s && track) {
        let dt = (t - (s.lastTime || t)) / 1000;
        s.lastTime = t;
        dt = clamp(dt, 0, 1 / 15);

        if (s.phase === 'running') {
          s.acc += dt;
          let guard = 0;
          entradaEfectiva.current =
            t - s.startTime < CONFIG.LAUNCH_STRAIGHT_MS
              ? 0
              : entrada.current !== 0
                ? entrada.current
                : t < pulsoHasta.current
                  ? pulsoDir.current
                  : 0;
          while (s.acc >= FIXED_DT && guard < 10) {
            stepSimulation(s, FIXED_DT, t, track, entradaEfectiva, null, null, null);
            s.acc -= FIXED_DT;
            guard++;
            if (s.phase !== 'running') break;
          }
          s.elapsed = t - s.startTime;
        }

        if (carObj) {
          const { position, rotationY } = poseToObject3D({ x: s.x, y: s.y, angle: s.heading });
          carObj.position.set(position.x, GROUND_Y, position.z);
          carObj.rotation.y = rotationY;

          const fwd = headingToWorldForward(s.heading);
          camera.position.set(
            position.x - fwd.x * CHASE_BEHIND,
            CHASE_HEIGHT,
            position.z - fwd.z * CHASE_BEHIND,
          );
          camera.lookAt(
            position.x + fwd.x * CHASE_LOOKAHEAD,
            CHASE_LOOK_HEIGHT,
            position.z + fwd.z * CHASE_LOOKAHEAD,
          );
        }

        renderer.render(scene, camera);
        gl.endFrameEXP();
      }

      frames++;
      if (t - lastFpsAt >= 500) {
        fpsNow = Math.round((frames * 1000) / (t - lastFpsAt));
        frames = 0;
        lastFpsAt = t;
      }
      if (t - lastHudAt >= 100) {
        lastHudAt = t;
        setHud({
          status: statusRef.current,
          fps: fpsNow,
          elapsed: s ? s.elapsed : 0,
          phase: s ? s.phase : 'loading',
        });
      }
    };
    render();
  }

  return (
    <View style={styles.root}>
      <GLView style={styles.gl} onContextCreate={onContextCreate} />

      <View style={styles.hud} pointerEvents="none">
        <Text style={styles.hudText}>BETA 3D · Fase 3 · {hud.fps} fps</Text>
        <Text style={styles.hudSub}>{hud.status}</Text>
      </View>

      {hud.phase !== 'loading' && (
        <View style={styles.timerBox} pointerEvents="none">
          <Text style={styles.timerMain}>
            {fmtMain(hud.elapsed)}
            <Text style={styles.timerFrac}>{fmtFrac(hud.elapsed)}</Text>
          </Text>
          {hud.phase === 'ready' && <Text style={styles.timerHint}>toca izq/der para arrancar</Text>}
          {hud.phase === 'finished' && <Text style={styles.timerHint}>¡META!</Text>}
        </View>
      )}

      <Pressable style={styles.back} onPress={onBack}>
        <Text style={styles.backText}>← VOLVER</Text>
      </Pressable>

      {hud.phase === 'finished' && (
        <Pressable style={styles.retry} onPress={resetRun}>
          <Text style={styles.retryText}>REINTENTAR</Text>
        </Pressable>
      )}

      {hud.phase !== 'finished' && (
        // Ocultas tras la meta: si no, quedan encima del botón REINTENTAR
        // (mismo espacio en pantalla) y se comen el toque.
        <View style={styles.steerRow} pointerEvents="box-none">
          <Pressable
            style={styles.steerZone}
            onPressIn={() => onSidePress(-1)}
            onPressOut={() => onSideRelease(-1)}
          />
          <Pressable
            style={styles.steerZone}
            onPressIn={() => onSidePress(1)}
            onPressOut={() => onSideRelease(1)}
          />
        </View>
      )}
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
  timerBox: { position: 'absolute', top: 44, left: 0, right: 0, alignItems: 'center' },
  timerMain: { color: '#fff', fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] },
  timerFrac: { fontSize: 18, color: '#c7ccd6' },
  timerHint: { color: '#9aa3b2', fontSize: 12, marginTop: 2 },
  retry: { position: 'absolute', bottom: 140, alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 20, backgroundColor: '#ff5a3c', borderRadius: 10 },
  retryText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  steerRow: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%', flexDirection: 'row' },
  steerZone: { flex: 1 },
});

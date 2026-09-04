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
import * as Haptics from 'expo-haptics';
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

// Mapeo 2D->3D SIN reflejar (mundo.Z = +juego.y), a diferencia de la Fase 2.
// La Fase 2 solo se vio con cámara CENITAL (mirando derecho hacia abajo),
// donde reflejar un eje es invisible: el óvalo cierra igual de bien visto
// desde arriba. Con cámara en PERSECUCIÓN eso deja de ser gratis — reflejar
// una posición invierte la ORIENTACIÓN del mundo (determinante -1), y con
// ella el sentido en que "girar a la derecha" se ve en pantalla (probado:
// con el mapeo de la Fase 2, tocar la derecha giraba el coche hacia la
// IZQUIERDA de cámara — justo el bug reportado). Con este mapeo sin
// reflejar, el sentido de giro coincide con el juego real para cualquier
// rumbo (comprobado en Node con producto escalar = 1 para todo heading).
function gameToWorldXZ(x, y) {
  return { x, z: y };
}
// Reformulada para el mapeo sin reflejar: antes de la Fase 3 era
// `angle + PI/2`, ligada al mapeo reflejado de la Fase 2 (con ese mapeo, el
// eje +Z local de la malla apuntaba al avance solo con esa fórmula). Con
// `z=+y`, la fórmula que alinea el +Z local con el avance es esta otra
// (deducida y comprobada en Node: error de encaje ~1e-16 en TODO el
// contorno de la pieza, no solo en las juntas — más estricto que el check
// de la Fase 2).
function headingToRotationY(angleRad) {
  return Math.PI / 2 - angleRad;
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
  return { x: Math.cos(heading), z: Math.sin(heading) };
}

// El coche SÍ flotaba por encima de la pista. Primera medición (solo la
// carrocería, `meshes[0]`) decía que el punto más bajo estaba en Y=0 —
// cierto, pero INCOMPLETO: race.glb son 5 nodos (carrocería + 4 ruedas),
// cada uno con su propia traslación. Repitiendo la medición con los 5
// nodos combinados (rueda: translation.y=0.3, radio de malla local 0.3 →
// punto más bajo = 0.3-0.3 = 0 EXACTO — coincide con la superficie de la
// pista, también en Y=0), el punto más bajo real del coche completo SÍ es
// Y=0. Así que CUALQUIER margen aquí, por pequeño que sea proporcionalmente
// al mundo, se nota como hueco real bajo las ruedas — con 0.5 (el intento
// anterior) el hueco es casi el 15% del radio de la rueda ya escalada
// (0.3 * CAR_SCALE ≈ 3.75), de sobra visible. Bajado a un margen mínimo,
// solo para evitar parpadeo de renderizado, no para "levantar" el coche.
const GROUND_Y = 0.08;
// Los choques solo se notaban con el coche prácticamente fuera de la
// pista — no era el ancho (ya ajustado dos veces), era el LARGO. La
// colisión de stepSimulation (sin tocar, es la misma de producción) solo
// mira la distancia del CENTRO del coche al carril — no tiene en cuenta su
// longitud. Eso no se nota en el juego real porque el coche está
// dibujado a las proporciones de CONFIG (CAR_LENGTH=32, CAR_WIDTH=17,
// ratio 1.88), pero el kart de Kenney es más largo de por sí (2.56 x 1.2
// m, ratio 2.13) — con CAR_SCALE ajustado solo por ancho, el coche salía
// proporcionalmente MÁS LARGO que en el juego real, así que en una curva
// el morro asomaba fuera del carril mucho antes de que el CENTRO (el
// único punto que mira la física) cruzase el límite. Fix: calibrar el
// tamaño por el LARGO real de producción, no por el ancho —
// CAR_SCALE = CONFIG.CAR_LENGTH / 2.56 (largo real del kart en metros).
// De paso el ancho también mejora: sale un pelín más estrecho que el
// margen de colisión (52 - CAR_WIDTH/2 = 43.5) en vez de más ancho, así
// que ahora sobra margen en vez de faltar.
const CAR_SCALE = CONFIG.CAR_LENGTH / 2.56;
// Cámara en persecución: constantes en las mismas "unidades de mundo" que la
// pista (straight=208, radio de curva=104 — ver piecesKenney.js). Más alta
// que el primer intento (125->170): JC la pedía más subida, y además así se
// ve más pista por delante. Ajustables a ojo tras probar en mano.
const CHASE_BEHIND = 200;
const CHASE_HEIGHT = 170;
const CHASE_LOOKAHEAD = 110;
const CHASE_LOOK_HEIGHT = 15;
// La cámara persiguiendo el rumbo EXACTO del coche, frame a frame y sin
// retraso, es justo lo que hacía que "no se sintiera" girar: el coche
// siempre aparece perfectamente centrado y mirando al frente respecto a la
// cámara (nunca rota RELATIVO a ella), así que la única señal de que hay
// una curva es que la PISTA barre por la pantalla — se lee como "se mueve
// la cámara", no como "estoy girando". Mismo arreglo que ya usa la cámara
// 2D de Game.js (`camAngle` con retraso suave, ver CAM_TURN_LERP allí): la
// cámara persigue el rumbo del coche con un lag, no lo copia al instante,
// así que en una curva el coche SÍ rota visiblemente respecto a la cámara
// durante un momento — esa rotación relativa es la sensación de girar.
const CAM_TURN_LERP = 3.5; // mismo valor que CAM_TURN_LERP en Game.js

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
    renderer.setClearColor(0x8fc2e8); // cielo liso — antes negro, no ayudaba a "imaginarlo"

    // near=15/far=3000 (1:200) no bastó — la pista seguía desapareciendo
    // en cuanto el césped estaba en la escena, incluso separándolo mucho
    // más en altura (-1 -> -20, sin cambio). Sospecha: el depth buffer en
    // este puente WebGL1 puede ser de solo 16 bits (no 24, como en
    // desktop) — con MUCHA menos resolución, y ahí hasta un 1:200 se queda
    // corto a la distancia real de la pista. Aprieto mucho más: 1:15.
    const camera = new THREE.PerspectiveCamera(
      62,
      gl.drawingBufferWidth / gl.drawingBufferHeight,
      100,
      1500,
    );

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(4, 8, 3);
    scene.add(sun);

    let carObj = null;

    // Escribe el ref (lo lee el bucle de render en cada frame) Y el estado
    // de React directamente — solo el ref no basta durante la carga: el
    // bucle de render no arranca hasta que ESTE try/catch entero termina,
    // así que sin el setHud aquí cualquier mensaje intermedio (incluida
    // una pausa de depuración) queda invisible y la pantalla se queda
    // clavada en el texto inicial hasta el final.
    const setStatus = (msg) => {
      statusRef.current = msg;
      setHud((prev) => ({ ...prev, status: msg }));
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

      // Color plano, no la textura real del kit (los "pianos"): confirmado
      // por qué no sale, con causa exacta — ver el plan (sección Fase 3,
      // segunda ronda) para el detalle completo. Resumen: el fichero SÍ se
      // descarga bien (confirmado con un diagnóstico en el propio HUD —
      // bytes=8706, exactos), pero three.js sube una textura marcada
      // `isDataTexture` con la firma LARGA de `texImage2D` (ancho/alto
      // explícitos + un buffer de píxeles) — y lo que expo-three pone ahí
      // como "buffer" es en realidad un objeto `{localUri, width, height}`,
      // pensado para la firma CORTA que usa el puente nativo de expo-gl
      // para decodificar imágenes locales de verdad. Incompatibilidad real
      // entre expo-three (código de esta librería sin mantener desde hace
      // tiempo — tiene hasta un `console.warn` de depuración olvidado) y la
      // versión de expo-gl de este SDK, no un parámetro nuestro.
      //
      // DoubleSide: las piezas llevan escala negativa en X (el espejo
      // local que explica headingToRotationY más arriba) — eso invierte
      // el sentido de las caras (determinante -1), y el volteo automático
      // de frontFace que hace three.js con un WebGLRenderer normal no se
      // aplicaba aquí: la pista entera desaparecía. DoubleSide la hace
      // visible sin depender de eso.
      const roadMat = new THREE.MeshStandardMaterial({ color: 0x4d525c, metalness: 0.05, roughness: 0.9, side: THREE.DoubleSide });
      for (const proto of [straightProto, cornerProto]) {
        proto.traverse((obj) => { if (obj.isMesh) obj.material = roadMat; });
      }

      // CAUSA REAL de por qué el coche "flotaba": no era el coche, era la
      // pista. El nodo raíz de las dos piezas (comprobado en Node, JSON del
      // .glb) lleva un `translation: [0,-1,0]` incrustado — un desplazamiento
      // de -1 METRO en Y, aparte de los vértices de la propia malla. Es
      // probablemente el pivote que usa el editor de Kenney para "agarrar"
      // la pieza 1m por encima de la base, no algo pensado para exportarse
      // tal cual.
      //
      // El primer intento de arreglarlo (cancelar solo el -1 del nodo,
      // dejando el MÍNIMO de la malla en Y=0) resultó estar mirando la cara
      // EQUIVOCADA del bloque: la malla es un bloque SÓLIDO de Y=0 (la
      // base, por debajo del suelo) a Y=0.3 (la cara de ARRIBA, por donde
      // se conduce) — confirmado porque con esa primera corrección JC vio
      // el coche "dentro" de la pista (hundido en el bloque, no encima).
      // Lo que hay que poner en el suelo (Y=0 de mundo) es el MÁXIMO de la
      // malla (0.3, la superficie de arriba), no el mínimo.
      const PIECE_MESH_TOP_Y = 0.3; // medido del accessor POSITION del .glb
      const PIECE_Y_FIX = (1 - PIECE_MESH_TOP_Y) * SCALE; // cancela el -1 del nodo Y deja la cara de ARRIBA en Y=0
      for (const pl of placements) {
        const proto = protoByGlb[pl.glb];
        const inst = proto.clone(true);
        const { position, rotationY } = poseToObject3D(pl.pose);
        inst.position.set(position.x, PIECE_Y_FIX, position.z);
        inst.rotation.y = rotationY;
        // Espejo local en X (además de la escala): con el mapeo de posición
        // ya sin reflejar, una rotación pura no puede alinear a la vez el
        // avance Y el ancho de canal de la pieza con su vecina (mismo
        // problema que en la Fase 2, demostrado otra vez por álgebra para
        // este mapeo — ver el comentario de headingToRotationY). El espejo
        // absorbe esa reflexión LOCALMENTE, en la malla, en vez de en todo
        // el mundo — así no vuelve a afectar al sentido de giro del coche
        // (que no usa esta función, usa headingToWorldForward directamente).
        inst.scale.set(-SCALE, SCALE, SCALE);
        scene.add(inst);
      }

      setStatus('cargando coche…');
      const raceScene = await loadGlb(GLB_MODULES.race);
      raceScene.traverse((obj) => {
        if (obj.isMesh && obj.name === 'body') {
          obj.material = new THREE.MeshStandardMaterial({ color: 0xff5a3c, metalness: 0.1, roughness: 0.6 });
        }
      });
      // Sin espejo: el coche no necesita encajar con nada a los lados, solo
      // apuntar al frente (que ya resuelve headingToRotationY solo) — y
      // reflejarlo sin verificar podría dejar algún detalle asimétrico del
      // modelo (tubo de escape, etc.) al revés.
      raceScene.scale.setScalar(CAR_SCALE);
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
    let camHeading = null; // null hasta el primer frame con estado listo

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
          const wasTouching = s.touching;
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
          // Sin esto el choque contra el muro es invisible: la física SÍ
          // frena/rebota (mismo código que producción), pero no hay ninguna
          // señal — ni háptica ni en pantalla — de que ha pasado. Un pulso
          // al entrar en contacto (no en cada frame rozando, por eso el
          // flag) hace que se note.
          if (s.touching && !wasTouching) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          }
        }

        if (carObj) {
          const { position, rotationY } = poseToObject3D({ x: s.x, y: s.y, angle: s.heading });
          carObj.position.set(position.x, GROUND_Y, position.z);
          carObj.rotation.y = rotationY;

          // La cámara persigue el rumbo del coche CON RETRASO (igual que
          // camAngle en Game.js) — si lo copiara al instante, el coche
          // nunca rotaría respecto a la cámara y una curva se leería como
          // "se mueve la pista", no como "estoy girando".
          if (camHeading == null) camHeading = s.heading;
          let da = s.heading - camHeading;
          while (da > Math.PI) da -= 2 * Math.PI;
          while (da < -Math.PI) da += 2 * Math.PI;
          camHeading += da * Math.min(1, dt * CAM_TURN_LERP);

          const fwd = headingToWorldForward(camHeading);
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

// ============================================================================
//  PilotViewer — visor 3D del piloto (prueba de humo de la Fase 1).
//
//  Reutiliza el pipeline de carga de .glb ya probado en la rama beta3d
//  (src/Beta3D.js): GLView (expo-gl) + Renderer (expo-three) + GLTFLoader.
//
//  Las texturas de este .glb van EMBEBIDAS en el propio binario (así las
//  exporta Blender, referenciadas por bufferView en vez de por URL) — y ahí
//  GLTFLoader intenta crear un `Blob` a partir del ArrayBuffer para
//  decodificar la imagen, algo que React Native no soporta ("Creating blobs
//  from 'ArrayBuffer'... are not supported", comprobado en el móvil real).
//  El parche de TextureLoader que sí funcionó en beta3d NO cubre este
//  camino (beta3d nunca llegaba a esta rama porque sus .glb no llevaban
//  textura embebida referenciada así). La solución: quitar del JSON del
//  .glb toda referencia a imágenes/texturas ANTES de parsear — GLTFLoader
//  nunca llega a intentar el Blob porque no hay textura que cargar. No es
//  una pérdida: el plan tiñe cada pieza con un color plano, nunca iba a
//  usarse la textura horneada.
//
//  Cada grupo de piezas (casco_v1_*, mono_v1_*, guantes_v1_*, botas_v1_*)
//  se tiñe según la prop `colors` — ver PilotColorTest.js para el selector
//  de humo que la alimenta. Esto TODAVÍA no es el configurador real de la
//  Fase 4 (sin inventario, sin rareza, sin guardado en Supabase): solo deja
//  ver en caliente cómo queda cada combinación de color.
// ============================================================================

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { View, StyleSheet, PanResponder } from 'react-native';
import { GLView } from 'expo-gl';
import { Renderer } from 'expo-three';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { toByteArray } from 'base64-js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Segunda generación (JC, 2026-09-15): piloto barbudo con cresta, separado a
// mano en Blender pieza a pieza a partir de un único mesh fusionado. Las 4
// piezas de abajo vienen del MISMO mesh original (nunca se movieron entre
// sí durante la separación), así que encajan en su sitio sin reajuste
// manual de posición — sustituyen a `cuerpo_base`/`casco_v1` de la Fase 1.
// Pendiente todavía: `guantes_v1_1.glb` se exportó mal (trajo 33 objetos
// sueltos de la escena entera en vez de solo el guante — falta reexportar
// marcando "Solo objetos seleccionados" en Blender) y no hay botas
// separadas aún (siguen fusionadas dentro de `mono_v1_1`, tintadas del
// color del mono hasta que se aíslen).
const GLB_CARA = require('../assets/pilot/cara_v1_1.glb');
const GLB_MONO = require('../assets/pilot/mono_v1_1.glb');
const GLB_PELO = require('../assets/pilot/pelo_v1_1.glb');
const GLB_CASCO = require('../assets/pilot/casco_v1_1.glb');

// Combo por defecto con la MISMA paleta que ya usa el coche (CAR_COLORS en
// car.js: azul_francia #2b5fb8, blanco #f0eee8, negro #17171a) — así piloto
// y coche comparten familia de color en vez de inventar una paleta aparte.
// Se puede sustituir en caliente vía la prop `colors` (ver más abajo); esto
// es solo lo que se usa si el llamador no pasa nada. `guantes_v1`/`botas_v1`
// se quedan en la lista aunque hoy no tengan malla propia cargada — en
// cuanto lleguen sus archivos, se tintan solos sin tocar más código.
export const PILOT_GROUPS = ['casco_v1', 'mono_v1', 'guantes_v1', 'botas_v1', 'pelo_v1'];
export const DEFAULT_PILOT_COLORS = {
  casco_v1: 0x2b5fb8,   // azul Francia
  mono_v1: 0xf0eee8,    // blanco
  guantes_v1: 0x17171a, // negro
  botas_v1: 0x17171a,   // negro
  pelo_v1: 0x3d2817,    // castaño oscuro
};
const SKIN_COLOR = 0xe8b98a;

// Las mismas 6 variantes de color usadas para generar las miniaturas por
// defecto (ver PilotColorTest.js -> DEFAULT_VARIANTS, y AvatarThumb.js que
// pinta la miniatura ya renderizada de cada una). Viven aquí, no repetidas
// en cada sitio que las necesita, para que el visor EN VIVO del Perfil
// muestre el mismo combo de color que ya vería en su miniatura estática —
// misma semilla, mismo índice, mismo aspecto en los dos sitios. `pelo_v1`
// no se especifica aquí a propósito: cae al castaño de DEFAULT_PILOT_COLORS
// en las 6, hasta que se decida si el pelo también varía por variante.
export const DEFAULT_VARIANTS = [
  { casco_v1: 0x2b5fb8, mono_v1: 0xf0eee8, guantes_v1: 0x17171a, botas_v1: 0x17171a }, // azul/blanco
  { casco_v1: 0xd32b1e, mono_v1: 0xf0eee8, guantes_v1: 0x17171a, botas_v1: 0x17171a }, // rojo/blanco
  { casco_v1: 0x1f5c3a, mono_v1: 0xf0eee8, guantes_v1: 0x17171a, botas_v1: 0x17171a }, // verde/blanco
  { casco_v1: 0x17171a, mono_v1: 0xf5c518, guantes_v1: 0x17171a, botas_v1: 0x17171a }, // negro/amarillo
  { casco_v1: 0xf0eee8, mono_v1: 0x17171a, guantes_v1: 0xf0eee8, botas_v1: 0xf0eee8 }, // blanco/negro
  { casco_v1: 0xe8611a, mono_v1: 0x2b5fb8, guantes_v1: 0x17171a, botas_v1: 0x17171a }, // naranja/azul
];

// Hash barato pero con buena dispersión: un userId es un uuid (hex
// aleatorio de por sí), así que basta con leer sus últimos 4 hex como
// número — mismo criterio que ya usaba AvatarThumb.js, ahora en un solo
// sitio para que las miniaturas y el visor en vivo nunca diverjan.
export function variantIndexForSeed(seed, count = DEFAULT_VARIANTS.length) {
  if (!seed) return 0;
  const tail = String(seed).replace(/-/g, '').slice(-4);
  const n = parseInt(tail, 16);
  return Number.isFinite(n) ? n % count : 0;
}

// A qué grupo pertenece un nodo (o el de un antepasado, por si el nombre
// vive en el padre y no en la malla en sí). null = no es un grupo
// pintable (cabeza/pelo/resto), se queda en el tono de piel fijo.
function groupForNode(node) {
  let n = node;
  while (n) {
    const hit = PILOT_GROUPS.find((g) => n.name && n.name.startsWith(g));
    if (hit) return hit;
    n = n.parent;
  }
  return null;
}

// El JSON de un .glb es ASCII-seguro por spec (glTF 2.0, sección "Binary
// glTF Layout") — no hace falta un decodificador UTF-8 completo (ni
// TextEncoder/TextDecoder, de disponibilidad incierta en Hermes), un mapeo
// byte<->char directo basta y es más barato.
function bytesToAsciiString(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return str;
}
function asciiStringToBytes(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

const GLTF_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

// Quita toda referencia a imágenes/texturas del JSON de un .glb binario,
// manteniendo intacto el buffer binario (la geometría vive ahí, en nada
// afectada). Si el .glb no trae chunk JSON reconocible (formato
// inesperado), devuelve los bytes tal cual — GLTFLoader seguirá pudiendo
// intentar parsearlos, solo sin este arreglo.
function stripGlbTextures(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || dv.getUint32(0, true) !== GLTF_MAGIC) return bytes.buffer;
  const totalLength = dv.getUint32(8, true);

  let offset = 12;
  let jsonBytes = null;
  let binBytes = null;
  while (offset + 8 <= totalLength && offset + 8 <= bytes.length) {
    const chunkLen = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    if (chunkType === CHUNK_JSON) jsonBytes = bytes.subarray(chunkStart, chunkStart + chunkLen);
    else if (chunkType === CHUNK_BIN) binBytes = bytes.subarray(chunkStart, chunkStart + chunkLen);
    offset = chunkStart + chunkLen;
  }
  if (!jsonBytes) return bytes.buffer;

  const json = JSON.parse(bytesToAsciiString(jsonBytes));
  delete json.images;
  delete json.textures;
  if (Array.isArray(json.materials)) {
    for (const mat of json.materials) {
      if (mat.pbrMetallicRoughness) {
        delete mat.pbrMetallicRoughness.baseColorTexture;
        delete mat.pbrMetallicRoughness.metallicRoughnessTexture;
      }
      delete mat.normalTexture;
      delete mat.occlusionTexture;
      delete mat.emissiveTexture;
    }
  }

  let newJsonStr = JSON.stringify(json);
  while (newJsonStr.length % 4 !== 0) newJsonStr += ' '; // padding, spec 4-byte align
  const newJsonBytes = asciiStringToBytes(newJsonStr);

  const binLen = binBytes ? binBytes.length : 0;
  const binPadded = (binLen + 3) & ~3;
  const totalSize = 12 + 8 + newJsonBytes.length + (binBytes ? 8 + binPadded : 0);

  const out = new ArrayBuffer(totalSize);
  const outDv = new DataView(out);
  const outBytes = new Uint8Array(out);
  outDv.setUint32(0, GLTF_MAGIC, true);
  outDv.setUint32(4, 2, true);
  outDv.setUint32(8, totalSize, true);

  let p = 12;
  outDv.setUint32(p, newJsonBytes.length, true);
  outDv.setUint32(p + 4, CHUNK_JSON, true);
  outBytes.set(newJsonBytes, p + 8);
  p += 8 + newJsonBytes.length;

  if (binBytes) {
    outDv.setUint32(p, binPadded, true);
    outDv.setUint32(p + 4, CHUNK_BIN, true);
    outBytes.set(binBytes, p + 8);
  }

  return out;
}

// Libera geometrías/materiales al desmontar — ver aliveRef más abajo.
function disposeGroup(obj) {
  if (!obj) return;
  obj.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry?.dispose();
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    mats.forEach((m) => m && m.dispose());
  });
}

async function loadGlb(moduleRef) {
  const asset = Asset.fromModule(moduleRef);
  await asset.downloadAsync();
  const base64 = await FileSystem.readAsStringAsync(asset.localUri || asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = toByteArray(base64);
  const stripped = stripGlbTextures(bytes);
  const gltf = await new Promise((resolve, reject) => {
    new GLTFLoader().parse(stripped, '', resolve, reject);
  });
  return gltf.scene;
}

const PilotViewer = forwardRef(function PilotViewer({ colors }, ref) {
  const groupRef = useRef(null);
  const dragRef = useRef(0);
  const glRef = useRef(null);
  const rendererRef = useRef(null);
  // Mismo bug que se encontró en AvatarViewer.js (JC, 2026-09-16: "bucle
  // infinito de errores"): el render() de onContextCreate programaba el
  // SIGUIENTE requestAnimationFrame ANTES de intentar renderizar, así que
  // un fallo se repetía cada fotograma para siempre, y el bucle tampoco se
  // paraba nunca al desmontar (dejando bucles zombis sobre un contexto GL
  // ya destruido). Mismo arreglo aquí: aliveRef corta el bucle al
  // desmontar, y un fallo de render detiene el bucle en vez de reintentar.
  const aliveRef = useRef(true);
  // Mallas ya cargadas, agrupadas por categoría — para re-teñir en caliente
  // cuando cambia `colors` sin tener que recargar el .glb entero (eso
  // reiniciaría el giro y sería mucho más lento que solo cambiar un color).
  const meshesByGroupRef = useRef({});
  const colorsRef = useRef({ ...DEFAULT_PILOT_COLORS, ...colors });

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      disposeGroup(groupRef.current);
      rendererRef.current?.dispose();
    };
  }, []);

  // Expone capture(): una foto fija de lo que se ve AHORA MISMO en el
  // visor, para el pipeline de miniaturas (Fase 2, ver PilotColorTest.js).
  // GLView.takeSnapshotAsync ya hace exactamente esto de fábrica — no hace
  // falta montar un render-to-texture a mano.
  useImperativeHandle(ref, () => ({
    capture: async () => {
      if (!glRef.current) throw new Error('El visor todavía no está listo');
      const { uri } = await GLView.takeSnapshotAsync(glRef.current, { format: 'png' });
      return uri;
    },
  }));

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 2,
      onPanResponderMove: (_, g) => {
        if (groupRef.current) {
          groupRef.current.rotation.y = dragRef.current + g.dx * 0.01;
        }
      },
      onPanResponderRelease: (_, g) => {
        dragRef.current += g.dx * 0.01;
      },
    })
  ).current;

  // Re-teñido en caliente: cuando cambian los colores desde fuera, solo se
  // actualiza el `.color` de los materiales ya cargados — el modelo no se
  // recarga ni se pierde el giro actual.
  useEffect(() => {
    colorsRef.current = { ...DEFAULT_PILOT_COLORS, ...colors };
    for (const group of PILOT_GROUPS) {
      const hex = colorsRef.current[group];
      const meshes = meshesByGroupRef.current[group] || [];
      for (const mesh of meshes) mesh.material.color.setHex(hex);
    }
  }, [colors]);

  async function onContextCreate(gl) {
    glRef.current = gl;
    const renderer = new Renderer({ gl });
    rendererRef.current = renderer;
    renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
    // Alpha 0: fondo transparente, no un cuadro sólido detrás del piloto.
    // Importa sobre todo para las miniaturas capturadas (PilotColorTest.js
    // -> GENERAR VARIANTES) — sin esto, cada avatar en las listas lleva un
    // recuadro gris pegado (JC, 2026-09-15). En el visor en vivo esto solo
    // cambia el fondo a lo que haya detrás del GLView en React Native (hoy,
    // negro sólido igualmente) — visualmente casi nada cambia ahí.
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    // Menos ambiente y tres focos direccionales (clave/relleno/contra) en
    // vez de una sola luz plana — es lo que hace que un plástico brillante
    // de verdad LEA como brillante: sin el contraste entre zona iluminada y
    // zona en sombra, el brillo especular del material no se nota aunque el
    // material en sí sea muy pulido.
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(2, 4, 3);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcd4ff, 0.35); // azulado, suaviza la sombra sin aplanar
    fill.position.set(-3, 1, 2);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.3); // contraluz, separa la silueta del fondo oscuro
    rim.position.set(-1, 2, -3);
    scene.add(rim);

    const group = new THREE.Group();
    scene.add(group);
    groupRef.current = group;

    try {
      const [cara, mono, pelo, casco] = await Promise.all([
        loadGlb(GLB_CARA), loadGlb(GLB_MONO), loadGlb(GLB_PELO), loadGlb(GLB_CASCO),
      ]);
      // Pudo desmontarse mientras cargaba — seguir montando sobre un
      // gl/renderer ya tirados es lo que dejaba bucles zombis.
      if (!aliveRef.current) return;
      group.add(cara);
      group.add(mono);
      group.add(pelo);
      group.add(casco);

      // Vinilo de figura de colección: nada de metal (metalness casi 0,
      // esto es plástico) pero MUY pulido (roughness bajo) para que salgan
      // brillos especulares marcados — es lo que de verdad lee como
      // "juguete brillante" en vez de "plástico mate genérico". Cada malla
      // se apunta en meshesByGroupRef según su categoría, para poder
      // re-teñirla luego sin recorrer la escena entera otra vez.
      meshesByGroupRef.current = {};
      group.traverse((node) => {
        if (node.isMesh) {
          const grp = groupForNode(node);
          const hex = grp ? colorsRef.current[grp] : SKIN_COLOR;
          node.material = new THREE.MeshStandardMaterial({
            color: hex,
            metalness: 0.05,
            roughness: 0.55,
          });
          if (grp) {
            if (!meshesByGroupRef.current[grp]) meshesByGroupRef.current[grp] = [];
            meshesByGroupRef.current[grp].push(node);
          }
        }
      });

      // Encuadre automático: no sabemos a qué escala exportó Blender, así
      // que en vez de adivinar cámara/distancia, se mide la caja del
      // conjunto ya cargado y se coloca la cámara a una distancia
      // proporcional a su tamaño real.
      const box = new THREE.Box3().setFromObject(group);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const radius = Math.max(size.x, size.y, size.z) * 0.6 || 1;

      group.position.sub(center); // centra el conjunto en el origen

      const camera = new THREE.PerspectiveCamera(
        45,
        gl.drawingBufferWidth / gl.drawingBufferHeight,
        radius / 100,
        radius * 20
      );
      // fov=45° -> semiángulo 22.5°, sin(22.5°)≈0.383: la distancia MÍNIMA
      // para que un objeto de este radio quepa entero en el encuadre es
      // radius/0.383 ≈ radius*2.61 — con 2.4 se quedaba corto y se salía
      // del encuadre por arriba/abajo (el "muy grande" reportado). 3.4 iba
      // sobrado de margen (JC, 2026-09-15: "reducir márgenes... se ve
      // apagado" en la pantalla de Perfil, donde el piloto es el
      // protagonista) — 2.85 deja aire de sobra sin dejar tanto hueco
      // muerto arriba/abajo.
      camera.position.set(0, radius * 0.15, radius * 2.85);
      camera.lookAt(0, 0, 0);

      const render = () => {
        if (!aliveRef.current) return;
        try {
          renderer.render(scene, camera);
          gl.endFrameEXP();
        } catch (e) {
          console.warn('PilotViewer: fallo renderizando, se detiene el bucle', e);
          return;
        }
        requestAnimationFrame(render);
      };
      render();
    } catch (e) {
      // Prueba de humo: si algo falla al cargar, mejor un log claro que una
      // pantalla en negro sin pista de qué pasó.
      console.warn('PilotViewer: fallo cargando el modelo', e);
    }
  }

  return (
    <View style={styles.fill} {...panResponder.panHandlers}>
      <GLView style={styles.fill} onContextCreate={onContextCreate} />
    </View>
  );
});

export default PilotViewer;

const styles = StyleSheet.create({
  fill: { flex: 1 },
});

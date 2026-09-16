// ============================================================================
//  AvatarViewer — visor 3D de un AVATAR COMPLETO (Fase 4: "muñecos enteros"
//  desbloqueables por rareza, JC 2026-09-15 — sustituye al configurador por
//  piezas de PilotViewer.js para el contenido nuevo; ese archivo se queda
//  vivo tal cual para no romper lo que ya está en producción con las 6
//  variantes actuales, hasta que se decida migrar de verdad).
//
//  Reto técnico nuevo: aquí SÍ queremos la textura horneada real (rayas,
//  logos, diseño) en vez de tinte plano — pero va embebida en el propio
//  .glb (bufferView, no URL externa), y GLTFLoader, para imágenes
//  embebidas, arma un `Blob` internamente para decodificarlas —React
//  Native no soporta `new Blob([arrayBuffer])` (mismo error de la Fase 1).
//  El parche de `beta3d` (monkey-patch de TextureLoader.prototype.load)
//  NO cubre este camino: las imágenes embebidas se resuelven por un
//  método interno de GLTFParser que va derecho al Blob, sin pasar por
//  TextureLoader en absoluto.
//
//  Solución (mismo espíritu que stripGlbTextures de PilotViewer, un paso
//  más): 1) parsear el .glb a mano y sacar los bytes de la imagen
//  baseColor del chunk binario, 2) escribirlos a un archivo temporal del
//  dispositivo, 3) quitar toda referencia a imágenes/texturas del JSON
//  ANTES de parsear con GLTFLoader (así nunca intenta el Blob), 4) cargar
//  la imagen ya escrita en disco con el mismo truco de gl.texImage2D que
//  ya probó beta3d para sus colormaps (sube los píxeles directo, sin
//  pasar por la lógica de subida de three.js), 5) asignarla como `.map`
//  del material.
// ============================================================================

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { View, StyleSheet, PanResponder } from 'react-native';
import { GLView } from 'expo-gl';
import { Renderer } from 'expo-three';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { toByteArray, fromByteArray } from 'base64-js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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

function parseGlbChunks(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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
  return { json: JSON.parse(bytesToAsciiString(jsonBytes)), binBytes };
}

// Mismo criterio de padding a 4 bytes que stripGlbTextures (PilotViewer.js).
function rebuildGlb(json, binBytes) {
  let newJsonStr = JSON.stringify(json);
  while (newJsonStr.length % 4 !== 0) newJsonStr += ' ';
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

// Extrae la imagen baseColor del propio .glb (la única que pintamos hoy —
// normal/metallicRoughness se ignoran, el material con 3 luces ya da
// brillo de sobra sin ellas), la escribe a un archivo temporal, y quita
// toda referencia a texturas del JSON para que GLTFLoader no intente el
// camino del Blob al parsear.
async function loadAvatarGlb(moduleRef, cacheKey) {
  const asset = Asset.fromModule(moduleRef);
  await asset.downloadAsync();
  const base64 = await FileSystem.readAsStringAsync(asset.localUri || asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = toByteArray(base64);
  const { json, binBytes } = parseGlbChunks(bytes);

  let textureUri = null;
  const mat = (json.materials || [])[0];
  const texIndex = mat && mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorTexture
    ? mat.pbrMetallicRoughness.baseColorTexture.index
    : undefined;
  if (texIndex !== undefined && json.textures && json.images) {
    const tex = json.textures[texIndex];
    const img = json.images[tex.source];
    if (img && img.bufferView !== undefined && binBytes) {
      const bv = json.bufferViews[img.bufferView];
      const start = bv.byteOffset || 0;
      const imgBytes = binBytes.subarray(start, start + bv.byteLength);
      const ext = img.mimeType === 'image/png' ? 'png' : 'jpg';
      const path = `${FileSystem.cacheDirectory}avatar_tex_${cacheKey}.${ext}`;
      await FileSystem.writeAsStringAsync(path, fromByteArray(imgBytes), {
        encoding: FileSystem.EncodingType.Base64,
      });
      textureUri = path;
    }
  }

  delete json.images;
  delete json.textures;
  if (Array.isArray(json.materials)) {
    for (const m of json.materials) {
      if (m.pbrMetallicRoughness) {
        delete m.pbrMetallicRoughness.baseColorTexture;
        delete m.pbrMetallicRoughness.metallicRoughnessTexture;
      }
      delete m.normalTexture;
      delete m.occlusionTexture;
      delete m.emissiveTexture;
    }
  }
  const stripped = rebuildGlb(json, binBytes);
  const gltf = await new Promise((resolve, reject) => {
    new GLTFLoader().parse(stripped, '', resolve, reject);
  });
  return { scene: gltf.scene, textureUri };
}

// Libera geometrías/texturas/materiales del avatar cargado. Sin esto, cada
// vez que el visor se desmonta (cambiar de pestaña, remount de Fast
// Refresh, o AvatarTest.js recorriendo los 14 avatares para las
// miniaturas) la GPU se queda con la malla y la textura viejas sin
// recolectar — en una sesión larga con muchos montajes eso se acumula.
function disposeAvatarScene(obj) {
  if (!obj) return;
  obj.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry?.dispose();
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    mats.forEach((m) => { if (m) { m.map?.dispose(); m.dispose(); } });
  });
}

// Mismo truco de beta3d: sube los píxeles con gl.texImage2D directo y
// engancha el resultado a mano en la caché de texturas de three.js, sin
// pasar por expo-three (que falla con imágenes locales de este tipo).
function loadTextureFromFile(gl, renderer, localUri) {
  const glTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, glTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, { localUri });
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);

  const texture = new THREE.Texture();
  renderer.properties.get(texture).__webglTexture = glTex;
  texture.flipY = false; // el UV de glTF ya viene en el sistema de three.js
  texture.encoding = THREE.sRGBEncoding; // baseColor es sRGB, no lineal
  return texture;
}

const AvatarViewer = forwardRef(function AvatarViewer({ source, cacheKey, onReady }, ref) {
  const groupRef = useRef(null);
  const dragRef = useRef(0);
  const glRef = useRef(null);
  const rendererRef = useRef(null);
  // El bucle de render de onContextCreate es autónomo (su propio
  // requestAnimationFrame, no ligado a ningún efecto) y antes NUNCA se
  // paraba al desmontar — JC, 2026-09-16: "bucle infinito de errores".
  // Cada cambio de pestaña, remount de Fast Refresh o vuelta del
  // generador de miniaturas de AvatarTest.js dejaba el bucle VIEJO
  // renderizando para siempre sobre un contexto GL ya destruido; con
  // varios de esos bucles zombis acumulados en una sesión larga, en
  // cuanto uno fallaba volvía a fallar EN CADA FOTOGRAMA sin parar
  // nunca (decenas de errores en segundos). aliveRef corta el bucle en
  // cuanto el componente se desmonta.
  const aliveRef = useRef(true);

  useImperativeHandle(ref, () => ({
    capture: async () => {
      if (!glRef.current) throw new Error('El visor todavía no está listo');
      const { uri } = await GLView.takeSnapshotAsync(glRef.current, { format: 'png' });
      return uri;
    },
  }));

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      disposeAvatarScene(groupRef.current);
      rendererRef.current?.dispose();
    };
  }, []);

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

  async function onContextCreate(gl) {
    glRef.current = gl;
    const renderer = new Renderer({ gl });
    rendererRef.current = renderer;
    renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(2, 4, 3);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcd4ff, 0.35);
    fill.position.set(-3, 1, 2);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.3);
    rim.position.set(-1, 2, -3);
    scene.add(rim);

    const group = new THREE.Group();
    scene.add(group);
    groupRef.current = group;

    try {
      const { scene: avatarScene, textureUri } = await loadAvatarGlb(source, cacheKey);
      // El componente pudo desmontarse MIENTRAS esto cargaba (p.ej.
      // AvatarTest.js ya pasó al siguiente avatar del lote) — seguir
      // montando la escena sobre un `gl`/`renderer` ya tirados es
      // exactamente lo que dejaba bucles zombis antes.
      if (!aliveRef.current) return;
      const texture = textureUri ? loadTextureFromFile(gl, renderer, textureUri) : null;

      avatarScene.traverse((node) => {
        if (node.isMesh) {
          node.material = new THREE.MeshStandardMaterial({
            map: texture,
            color: 0xffffff,
            metalness: 0.05,
            roughness: 0.55,
          });
        }
      });
      group.add(avatarScene);

      const box = new THREE.Box3().setFromObject(group);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const radius = Math.max(size.x, size.y, size.z) * 0.6 || 1;

      group.position.sub(center);

      const camera = new THREE.PerspectiveCamera(
        45,
        gl.drawingBufferWidth / gl.drawingBufferHeight,
        radius / 100,
        radius * 20
      );
      camera.position.set(0, radius * 0.15, radius * 2.85);
      camera.lookAt(0, 0, 0);

      // Antes: requestAnimationFrame(render) iba ANTES de renderer.render(),
      // así que si render() lanzaba, el siguiente fotograma YA estaba
      // programado — la misma excepción se repetía sin parar, para
      // siempre, en vez de fallar una vez (JC, 2026-09-16: "bucle
      // infinito de errores"). Ahora: 1) si el componente se desmontó, no
      // se reprograma nada más; 2) un fallo de render se registra UNA vez
      // y detiene el bucle en vez de reintentar cada fotograma.
      const render = () => {
        if (!aliveRef.current) return;
        try {
          renderer.render(scene, camera);
          gl.endFrameEXP();
        } catch (e) {
          console.warn('AvatarViewer: fallo renderizando, se detiene el bucle', e);
          return;
        }
        requestAnimationFrame(render);
      };
      render();
      // Avisa a quien nos pidió cargar (p.ej. el generador de miniaturas en
      // lote de AvatarTest.js) que ya hay un frame real dibujado — mejor
      // que un temporizador a ciegas, que o se queda corto (captura en
      // negro) o de sobra (espera sin necesidad).
      if (onReady) {
        requestAnimationFrame(() => requestAnimationFrame(() => aliveRef.current && onReady()));
      }
    } catch (e) {
      console.warn('AvatarViewer: fallo cargando el modelo', e);
    }
  }

  return (
    <View style={styles.fill} {...panResponder.panHandlers}>
      <GLView style={styles.fill} onContextCreate={onContextCreate} />
    </View>
  );
});

export default AvatarViewer;

const styles = StyleSheet.create({
  fill: { flex: 1 },
});

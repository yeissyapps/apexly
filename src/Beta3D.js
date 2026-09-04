// ============================================================================
//  Beta3D — Fase 0 del plan de evaluación 3D (kits de Kenney).
//
//  Objetivo de ESTA fase: confirmar que expo-gl + three arrancan sin crashear
//  en este proyecto concreto (Expo SDK 57, RN 0.86, New Architecture activa —
//  ver newArchEnabled en android/gradle.properties). Nada de assets de Kenney
//  todavía: un cubo girando es la prueba mínima. Solo si esto va limpio en el
//  Samsung tiene sentido pasar a la Fase 1 (cargar el .glb del coche).
//
//  Pantalla oculta a propósito (ver BETA3D_AUTOSTART en App.js) — no hay
//  entrada de navegación normal, no debe verla un jugador real.
// ============================================================================

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GLView } from 'expo-gl';
import { Renderer } from 'expo-three';
import * as THREE from 'three';

export default function Beta3D({ onBack }) {
  const [fps, setFps] = useState(0);

  function onContextCreate(gl) {
    const renderer = new Renderer({ gl });
    renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
    renderer.setClearColor(0x11151c);

    const camera = new THREE.PerspectiveCamera(
      60,
      gl.drawingBufferWidth / gl.drawingBufferHeight,
      0.1,
      100,
    );
    camera.position.set(2.5, 2, 3.5);
    camera.lookAt(0, 0, 0);

    const scene = new THREE.Scene();

    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xff5a3c, metalness: 0.3, roughness: 0.4 }),
    );
    scene.add(cube);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(3, 5, 2);
    scene.add(sun);

    // Contador de FPS a ojo: es el número que hay que comparar contra el HUD
    // de depuración de Game.js (s.fps) para saber si esto rinde de verdad.
    let frames = 0;
    let lastFpsAt = Date.now();

    const render = () => {
      requestAnimationFrame(render);
      cube.rotation.x += 0.01;
      cube.rotation.y += 0.02;
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
        <Text style={styles.hudText}>BETA 3D · Fase 0 · {fps} fps</Text>
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
  back: { position: 'absolute', top: 48, right: 16, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 8 },
  backText: { color: '#eef0f4', fontSize: 13, fontWeight: '700' },
});

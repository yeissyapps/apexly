// ============================================================================
//  RainOverlay — efecto visual de lluvia para los días de lluvia.
//
//  Capa en espacio de PANTALLA (no de mundo): gotas diagonales cayendo en bucle
//  + un velo azulado tenue para dar sensación de día gris. pointerEvents="none"
//  para no interceptar los toques de conducción. Las gotas usan el driver nativo
//  (transform) → animan fuera del hilo JS y no pelean con el bucle del juego.
// ============================================================================

import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

const N_DROPS = 34;

function Drop({ d, h }) {
  const t = useRef(new Animated.Value(Math.random())).current; // arranque escalonado

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: d.dur, easing: Easing.linear, useNativeDriver: true }),
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [-40, h + 40] });
  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [8, -18] }); // deriva (viento)
  return (
    <Animated.View
      style={[
        styles.drop,
        { left: d.x, height: d.len, opacity: d.op, transform: [{ translateX }, { translateY }, { rotate: '15deg' }] },
      ]}
    />
  );
}

export default function RainOverlay({ w, h }) {
  const drops = useRef(
    Array.from({ length: N_DROPS }, () => ({
      x: Math.random() * w,
      len: 9 + Math.random() * 15,
      dur: 480 + Math.random() * 460,
      op: 0.12 + Math.random() * 0.22,
    })),
  ).current;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wrap]}>
      <View style={[StyleSheet.absoluteFill, styles.gloom]} />
      {drops.map((d, i) => (
        <Drop key={i} d={d} h={h} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  gloom: { backgroundColor: 'rgba(24,34,54,0.20)' },
  drop: { position: 'absolute', top: 0, width: 2, borderRadius: 1, backgroundColor: 'rgba(200,220,255,0.85)' },
});

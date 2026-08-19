// ============================================================================
//  WeatherFX — efectos visuales del clima del día (espacio de PANTALLA).
//
//  Refuerza visualmente lo que ya dice el parte meteorológico:
//    · rain  -> gotas diagonales + velo azulado (asfalto mojado lo pone Game).
//    · wind  -> rachas: líneas barriendo en la dirección del viento del día.
//    · dry   -> tinte cálido tenue (día soleado).
//    · clear -> nada (despejado, neutro).
//
//  pointerEvents="none" para no interceptar los toques. Todo con driver nativo
//  (transform/opacity) → anima fuera del hilo JS, no pelea con el bucle del juego.
// ============================================================================

import { memo, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Rect, Circle } from 'react-native-svg';

// ---------------------------------------------------------------- Lluvia -----
const N_DROPS = 52;

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
  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [8, -18] }); // deriva
  return (
    <Animated.View
      style={[styles.drop, { left: d.x, height: d.len, opacity: d.op, transform: [{ translateX }, { translateY }, { rotate: '15deg' }] }]}
    />
  );
}

function RainLayer({ w, h }) {
  const drops = useRef(
    Array.from({ length: N_DROPS }, () => ({
      x: Math.random() * w, len: 13 + Math.random() * 20, dur: 420 + Math.random() * 420, op: 0.28 + Math.random() * 0.34,
    })),
  ).current;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
      <View style={[StyleSheet.absoluteFill, styles.gloom]} />
      {drops.map((d, i) => <Drop key={i} d={d} h={h} />)}
    </View>
  );
}

// ---------------------------------------------------------------- Viento -----
const N_GUSTS = 22;

function Gust({ g, dx, dy, range, angleDeg }) {
  const p = useRef(new Animated.Value(Math.random())).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(p, { toValue: 1, duration: g.dur, easing: Easing.linear, useNativeDriver: true }),
    );
    anim.start();
    return () => anim.stop();
  }, []);
  // Barre a lo largo de la dirección del viento, pasando por su posición base.
  const translateX = p.interpolate({ inputRange: [0, 1], outputRange: [-dx * range / 2, dx * range / 2] });
  const translateY = p.interpolate({ inputRange: [0, 1], outputRange: [-dy * range / 2, dy * range / 2] });
  // Aparece y se desvanece a mitad de recorrido -> sensación de racha.
  const opacity = p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, g.op, 0] });
  return (
    <Animated.View
      style={[styles.gust, { left: g.x, top: g.y, width: g.len, opacity, transform: [{ translateX }, { translateY }, { rotate: `${angleDeg}deg` }] }]}
    />
  );
}

function WindLayer({ w, h, windX, windY }) {
  const angle = Math.atan2(windY || 0.0001, windX || 1);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const range = Math.hypot(w, h) + 180;
  const angleDeg = (angle * 180) / Math.PI;
  // Rachas: pocas, rápidas y muy alargadas -> lectura de "líneas de velocidad"
  // en vez de las gotas de lluvia (finas, numerosas, caída constante).
  const gusts = useRef(
    Array.from({ length: N_GUSTS }, () => ({
      x: Math.random() * w, y: Math.random() * h, len: 130 + Math.random() * 220,
      dur: 380 + Math.random() * 420, op: 0.22 + Math.random() * 0.3,
    })),
  ).current;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
      <View style={[StyleSheet.absoluteFill, styles.haze]} />
      {gusts.map((g, i) => <Gust key={i} g={g} dx={dx} dy={dy} range={range} angleDeg={angleDeg} />)}
    </View>
  );
}

// ------------------------------------------------------------------- Sol -----
// Antes era un tinte plano al 6% de opacidad — casi no se veía. Un destello
// solar (glow radial + un par de reflejos, como un lens flare de cámara) se
// lee como "sol" mucho más claro que un simple tinte de color.
function SunLayer({ w, h }) {
  const cx = w * 0.16, cy = h * 0.10;
  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={w} height={h}>
      <Defs>
        <RadialGradient id="sunGlow" cx={cx} cy={cy} r={Math.max(w, h) * 0.5} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#fff1c4" stopOpacity="0.6" />
          <Stop offset="0.35" stopColor="#ffcf7a" stopOpacity="0.2" />
          <Stop offset="1" stopColor="#ffcf7a" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect width={w} height={h} fill="url(#sunGlow)" />
      <Circle cx={cx + w * 0.32} cy={cy + h * 0.24} r={12} fill="#fff1c4" opacity={0.28} />
      <Circle cx={cx + w * 0.48} cy={cy + h * 0.37} r={6} fill="#fff1c4" opacity={0.2} />
    </Svg>
  );
}

// ------------------------------------------------------------- Despachador ---
// memo: weather/w/h no cambian durante la vuelta (Game.js sí re-renderiza a
// 60fps por el coche), y las gotas/rachas ya animan con driver nativo — sin
// memo, las 52+22 lo volvían a montar/diffear en cada frame para nada.
function WeatherFX({ weather, w, h }) {
  const id = weather && weather.id;
  if (id === 'rain') return <RainLayer w={w} h={h} />;
  if (id === 'wind') return <WindLayer w={w} h={h} windX={weather.windX} windY={weather.windY} />;
  if (id === 'dry') return <SunLayer w={w} h={h} />;
  return null;
}
export default memo(WeatherFX);

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  gloom: { backgroundColor: 'rgba(20,28,46,0.30)' },
  haze: { backgroundColor: 'rgba(130,116,88,0.10)' }, // tinte cálido/polvoriento — distingue el viento de la lluvia (azulada)
  drop: { position: 'absolute', top: 0, width: 2.4, borderRadius: 1, backgroundColor: 'rgba(200,220,255,0.9)' },
  gust: { position: 'absolute', height: 1.6, borderRadius: 1, backgroundColor: 'rgba(216,202,168,0.85)' },
});

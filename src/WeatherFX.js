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

import { Fragment, memo, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Rect, Circle } from 'react-native-svg';

import { CONFIG } from './config';

// ---------------------------------------------------------------- Lluvia -----
//
//  POR LÁMINAS, no gota a gota. Antes cada una de las 52 gotas era un
//  Animated.View con su propio Animated.loop infinito: 52 animaciones y 52
//  vistas semitransparentes componiéndose encima del SVG del juego, cada
//  frame.
//
//  Eso es lo que rompía el control en iOS. El hilo de UI —el mismo por el que
//  entran los toques— se saturaba, los toques llegaban tarde o se perdían, y
//  salía el volantazo fantasma. Encajaba con todo lo observado en campo:
//  pasaba en iPhone 13 y no en 15 Pro ni 17, y SOLO con lluvia y viento, que
//  son justo las dos condiciones que animan. Con sol (SVG estático) y
//  despejado (nada) no fallaba nunca. Y pasaba igual con los botones de
//  volante y sin ellos, así que nunca fueron los botones.
//
//  Ahora son 3 láminas: cada una agrupa sus gotas y se mueve entera. 3
//  animaciones en vez de 52, y menos de la mitad de vistas. El paralaje se
//  conserva dando a cada lámina su propia velocidad, que es lo que hacía que
//  la lluvia no pareciera un bloque.
const N_SHEETS = 3;
const DROPS_PER_SHEET = 6;

function RainSheet({ w, h, dur, delay }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // El desfase va como RETARDO al arrancar, no como valor inicial: cada
    // iteración del bucle vuelve al valor de partida, así que arrancar en
    // mitad del recorrido dejaría la lámina recorriendo solo un trozo y
    // rompería el empalme de las dos copias.
    const anim = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: dur, easing: Easing.linear, useNativeDriver: true }),
    );
    const id = setTimeout(() => anim.start(), delay);
    return () => { clearTimeout(id); anim.stop(); };
  }, []);
  const span = h + 80;
  const drops = useRef(
    Array.from({ length: DROPS_PER_SHEET }, () => ({
      x: Math.random() * w,
      y: Math.random() * span,
      len: 13 + Math.random() * 20,
      op: 0.28 + Math.random() * 0.34,
    })),
  ).current;
  // DOS copias del mismo grupo, separadas justo `span`. La lámina baja `span`
  // y vuelve a cero: cuando la copia de abajo sale por el borde, la de arriba
  // ha ocupado su sitio exacto, así que el reinicio del bucle no se ve. Sin
  // esto, la lluvia daría un salto cada vuelta.
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, span] });
  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [8, -18] }); // deriva
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { transform: [{ translateX }, { translateY }] }]}
    >
      {drops.map((d, i) => (
        <Fragment key={i}>
          <View style={[styles.drop, { left: d.x, top: d.y - span, height: d.len, opacity: d.op }]} />
          <View style={[styles.drop, { left: d.x, top: d.y - span * 2, height: d.len, opacity: d.op }]} />
        </Fragment>
      ))}
    </Animated.View>
  );
}

function RainLayer({ w, h }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
      <View style={[StyleSheet.absoluteFill, styles.gloom]} />
      {Array.from({ length: N_SHEETS }, (_, i) => (
        <RainSheet key={i} w={w} h={h} dur={520 + i * 240} delay={i * 190} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- Viento -----
// Mismo tratamiento que la lluvia: por grupos, no racha a racha. Eran 22
// Animated.View con 22 bucles propios; ahora son 3 grupos que barren enteros.
const N_GUST_GROUPS = 3;
const GUSTS_PER_GROUP = 4;

function GustGroup({ w, h, dx, dy, range, angleDeg, dur, delay }) {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // Desfase por retardo, mismo motivo que en RainSheet.
    const anim = Animated.loop(
      Animated.timing(p, { toValue: 1, duration: dur, easing: Easing.linear, useNativeDriver: true }),
    );
    const id = setTimeout(() => anim.start(), delay);
    return () => { clearTimeout(id); anim.stop(); };
  }, []);
  const gusts = useRef(
    Array.from({ length: GUSTS_PER_GROUP }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      len: 130 + Math.random() * 220, op: 0.22 + Math.random() * 0.3,
    })),
  ).current;
  // Barre a lo largo de la dirección del viento, pasando por el centro.
  const translateX = p.interpolate({ inputRange: [0, 1], outputRange: [-dx * range / 2, dx * range / 2] });
  const translateY = p.interpolate({ inputRange: [0, 1], outputRange: [-dy * range / 2, dy * range / 2] });
  // Aparece y se desvanece a mitad de recorrido -> sensación de racha. Aquí sí
  // va por grupo y no por línea: las 4 de un grupo entran y salen juntas, que
  // es exactamente como se ve una racha de verdad.
  const opacity = p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 0] });
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { opacity, transform: [{ translateX }, { translateY }] }]}
    >
      {gusts.map((g, i) => (
        <View
          key={i}
          style={[styles.gust, { left: g.x, top: g.y, width: g.len, opacity: g.op, transform: [{ rotate: `${angleDeg}deg` }] }]}
        />
      ))}
    </Animated.View>
  );
}

function WindLayer({ w, h, windX, windY }) {
  const angle = Math.atan2(windY || 0.0001, windX || 1);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const range = Math.hypot(w, h) + 180;
  const angleDeg = (angle * 180) / Math.PI;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
      <View style={[StyleSheet.absoluteFill, styles.haze]} />
      {Array.from({ length: N_GUST_GROUPS }, (_, i) => (
        <GustGroup
          key={i} w={w} h={h} dx={dx} dy={dy} range={range} angleDeg={angleDeg}
          dur={600 + i * 220} delay={i * 210}
        />
      ))}
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
  if (!CONFIG.CLIMA_FX) return null; // interruptor para aislar render vs física
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

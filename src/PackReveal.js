// ============================================================================
//  PackReveal — la apertura del sobre, en tres actos y con tres intensidades.
//
//  ACTOS: el sobre entra -> se agita y se rompe -> aparece la pieza.
//  Antes esto era un `Animated.spring` de 220 ms sobre la tarjeta final: no
//  había sobre, ni espera, ni sorpresa. Lo que hace que un sobre se sienta
//  bien es la PAUSA antes de saber qué te ha tocado, no el brillo de después.
//
//  INTENSIDAD POR RAREZA (la anticipación escala, no solo el adorno):
//    rara       -> 1 sacudida corta, sin rayos. Rápido: la mayoría de sobres
//                  son raros y tienen que poder pasarse deprisa.
//    épica      -> 3 sacudidas, rayos girando, impacto medio.
//    legendaria -> 5 sacudidas cada vez más largas, rayos + destello a
//                  pantalla completa + ShineBadge en la pieza + haptic
//                  fuerte. La espera es casi el doble de larga a propósito:
//                  ese "algo va a pasar" ES el premio.
//
//  Todo en `transform`/`opacity` con `useNativeDriver`, que es lo único que
//  se anima fuera del hilo de JS — durante la apertura la app sigue haciendo
//  sus cosas (refrescar saldo, inventario) y una animación en el hilo de JS
//  se vería a tirones justo en el momento que más importa.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

import PackArt from './PackArt';
import { RD } from './theme';

const AnimatedSvg = Animated.createAnimatedComponent(Svg);

// Cuántas sacudidas y cuánto dura cada una, por rareza.
const SHAKE = {
  rara: { count: 1, step: 55, amp: 5 },
  epica: { count: 3, step: 60, amp: 8 },
  legendaria: { count: 5, step: 68, amp: 12 },
};

const HAPTIC = {
  rara: Haptics.ImpactFeedbackStyle.Light,
  epica: Haptics.ImpactFeedbackStyle.Medium,
  legendaria: Haptics.ImpactFeedbackStyle.Heavy,
};

// Rayos de fondo: geometría real (cuñas), no un halo difuminado. Un glow
// borroso detrás del objeto es justo el recurso que hace que algo parezca
// plantilla; unas cuñas girando pertenecen al mundo gráfico del juego.
function Rays({ color }) {
  const wedges = [];
  for (let i = 0; i < 12; i++) {
    const a0 = (i * 30 * Math.PI) / 180;
    const a1 = a0 + 0.19;
    const R = 150;
    wedges.push(
      <Path
        key={i}
        d={`M0,0 L${Math.cos(a0) * R},${Math.sin(a0) * R} L${Math.cos(a1) * R},${Math.sin(a1) * R} Z`}
        fill={color}
      />,
    );
  }
  return <>{wedges}</>;
}

export default function PackReveal({ rarity, rarityColor, variant, serial, children, onDone }) {
  const [phase, setPhase] = useState('pack'); // 'pack' -> 'piece'

  const packScale = useRef(new Animated.Value(0.7)).current;
  const packOpacity = useRef(new Animated.Value(0)).current;
  const shakeX = useRef(new Animated.Value(0)).current;
  const packExit = useRef(new Animated.Value(0)).current; // 0..1
  const rayRotate = useRef(new Animated.Value(0)).current;
  const rayOpacity = useRef(new Animated.Value(0)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const pieceScale = useRef(new Animated.Value(0.6)).current;
  const pieceOpacity = useRef(new Animated.Value(0)).current;

  const showRays = rarity === 'epica' || rarity === 'legendaria';
  const isLegendary = rarity === 'legendaria';

  useEffect(() => {
    const cfg = SHAKE[rarity] || SHAKE.rara;

    // Acto 1 — el sobre entra.
    const enter = Animated.parallel([
      Animated.spring(packScale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
      Animated.timing(packOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]);

    // Acto 2 — se agita. Cada sacudida es un poco más lenta y más amplia:
    // acelerar sería "nervioso", frenar es "está a punto de".
    const shakes = [];
    for (let i = 0; i < cfg.count; i++) {
      const amp = cfg.amp * (1 + i * 0.35);
      const dur = cfg.step + i * 14;
      shakes.push(
        Animated.sequence([
          Animated.timing(shakeX, { toValue: -amp, duration: dur, useNativeDriver: true }),
          Animated.timing(shakeX, { toValue: amp, duration: dur, useNativeDriver: true }),
          Animated.timing(shakeX, { toValue: 0, duration: dur * 0.6, useNativeDriver: true }),
        ]),
      );
    }

    // Acto 3 — se rompe y sale la pieza.
    const burst = Animated.parallel([
      Animated.timing(packExit, { toValue: 1, duration: 200, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(rayOpacity, { toValue: showRays ? 0.16 : 0, duration: 260, useNativeDriver: true }),
      Animated.timing(flash, {
        toValue: isLegendary ? 1 : 0,
        duration: 120,
        useNativeDriver: true,
      }),
    ]);

    const seq = Animated.sequence([
      enter,
      Animated.delay(isLegendary ? 220 : 120),
      ...shakes,
      burst,
    ]);

    // Los rayos giran despacio y en bucle aparte: si giraran dentro de la
    // secuencia, se pararían justo al acabar y se notaría el corte.
    const spin = Animated.loop(
      Animated.timing(rayRotate, {
        toValue: 1, duration: 14000, easing: Easing.linear, useNativeDriver: true,
      }),
    );
    if (showRays) spin.start();

    Haptics.impactAsync(HAPTIC[rarity] || HAPTIC.rara).catch(() => {});

    seq.start(({ finished }) => {
      if (!finished) return;
      setPhase('piece');
      if (isLegendary) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        Animated.timing(flash, { toValue: 0, duration: 320, useNativeDriver: true }).start();
      }
      Animated.parallel([
        Animated.spring(pieceScale, {
          toValue: 1,
          friction: isLegendary ? 4 : 6,
          tension: isLegendary ? 90 : 70,
          useNativeDriver: true,
        }),
        Animated.timing(pieceOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start(() => onDone && onDone());
    });

    return () => { seq.stop(); spin.stop(); };
  }, []);

  const spin = rayRotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={s.stage}>
      {showRays && (
        <AnimatedSvg
          pointerEvents="none"
          width={300}
          height={300}
          viewBox="-150 -150 300 300"
          style={[s.rays, { opacity: rayOpacity, transform: [{ rotate: spin }] }]}
        >
          <Rays color={rarityColor} />
        </AnimatedSvg>
      )}

      {phase === 'pack' && (
        <Animated.View
          style={{
            opacity: Animated.multiply(packOpacity, packExit.interpolate({
              inputRange: [0, 1], outputRange: [1, 0],
            })),
            transform: [
              { translateX: shakeX },
              {
                scale: Animated.multiply(
                  packScale,
                  packExit.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }),
                ),
              },
            ],
          }}
        >
          <PackArt width={132} variant={variant} serial={serial} />
        </Animated.View>
      )}

      {phase === 'piece' && (
        <Animated.View
          style={{ opacity: pieceOpacity, transform: [{ scale: pieceScale }], alignSelf: 'stretch' }}
        >
          {children}
        </Animated.View>
      )}

      {isLegendary && (
        <Animated.View pointerEvents="none" style={[s.flash, { opacity: flash }]} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  stage: { alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  rays: { position: 'absolute' },
  flash: {
    position: 'absolute', top: -400, left: -400, right: -400, bottom: -400,
    backgroundColor: RD.cream,
  },
});

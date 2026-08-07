// ============================================================================
//  ShineBadge — badge con "brillo" (barra de luz que barre en bucle).
//
//  Extraído de App.js (donde vivía solo para el badge de mejor tiempo
//  mundial en Resultado) para poder reutilizarlo también en la revelación de
//  sobres legendarios (Tienda.js). Autocontenido: estilos en rgba fijo, sin
//  depender de theme — funciona igual en cualquier pantalla.
// ============================================================================

import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

export default function ShineBadge({ children, style }) {
  const x = useRef(new Animated.Value(-1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(x, { toValue: 1, duration: 1200, useNativeDriver: true }),
      Animated.timing(x, { toValue: -1, duration: 0, useNativeDriver: true }),
      Animated.delay(700),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  const translateX = x.interpolate({ inputRange: [-1, 1], outputRange: [-150, 150] });
  return (
    <View style={[style, styles.shineWrap]}>
      {children}
      <Animated.View
        pointerEvents="none"
        style={[styles.shineBar, { transform: [{ translateX }, { rotate: '20deg' }] }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shineWrap: { overflow: 'hidden' },
  shineBar: { position: 'absolute', top: -10, bottom: -10, width: 26, backgroundColor: 'rgba(255,255,255,0.55)' },
});

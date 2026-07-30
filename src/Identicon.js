// Identicon "lite" del rediseño: cuadrado partido en diagonal en dos tonos del
// mismo hash — versión sin la forma geométrica blanca (esa llega en la fase de
// avatares dedicada). Reemplaza al Avatar redondo de iniciales en las pantallas
// ya migradas a la dirección "Parrilla".

import { View } from 'react-native';
import { rdIdenticonPair } from './theme';

export default function Identicon({ seed, size = 22 }) {
  const [light, dark] = rdIdenticonPair(seed);
  return (
    <View style={{ width: size, height: size, backgroundColor: light, overflow: 'hidden' }}>
      <View
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 0,
          height: 0,
          borderTopWidth: size,
          borderRightWidth: size,
          borderTopColor: dark,
          borderRightColor: 'transparent',
        }}
      />
    </View>
  );
}

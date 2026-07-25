// Avatar redondo con iniciales y color determinista por usuario.
// size: diámetro en px. ring: color de aro opcional (p. ej. oro para el líder).

import { StyleSheet, Text, View } from 'react-native';
import { avatarColor, initials } from './theme';

export default function Avatar({ name, colorKey, size = 34, ring }) {
  const bg = avatarColor(colorKey || name);
  return (
    <View
      style={[
        styles.av,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
        ring && { borderWidth: 2, borderColor: ring },
      ]}
    >
      <Text style={[styles.txt, { fontSize: size * 0.4 }]} numberOfLines={1}>
        {initials(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  av: { alignItems: 'center', justifyContent: 'center' },
  txt: { color: '#0a0c0f', fontWeight: '800' },
});

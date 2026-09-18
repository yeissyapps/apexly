// Icono de moneda — círculo dorado con un "$" grabado en el centro. Vivía
// duplicado dentro de App.js (chip de cabecera y camino de racha); se
// extrae aquí para que Tienda.js (JC, 2026-09-16: "lo mismo para tienda")
// use exactamente el mismo símbolo en vez de reinventarlo por pantalla.
//
// Antes hubo una versión SOLO de dos círculos concéntricos — se quitó
// porque un aro dentro de otro no dice nada por sí solo (podía ser un
// objetivo, un ajuste, un disco). El "$" es lo que de verdad comunica
// "esto es dinero"; el aro solo le da forma de moneda.

import Svg, { Circle, Text as SvgText } from 'react-native-svg';
import { RD } from './theme';

export default function CoinIcon({ size = 15 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="10" fill={RD.gold1st} stroke={RD.gold1stShade} strokeWidth="1.5" />
      <SvgText x="12" y="16.5" fontSize="13" fontWeight="700" textAnchor="middle" fill={RD.bg}>
        $
      </SvgText>
    </Svg>
  );
}

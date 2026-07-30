// Franja diagonal naranja/negro — firma visual del rediseño "Parrilla".
// Motivo repetido: repeating-linear-gradient(135deg, brandOrange 0 10px, bg 10px 20px).

import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import { RD } from './theme';

export default function DangerStripe({ height = 6, style }) {
  const id = 'danger-stripe';
  return (
    <Svg width="100%" height={height} style={style}>
      <Defs>
        <Pattern id={id} patternUnits="userSpaceOnUse" width="14.14" height="14.14" patternTransform="rotate(45)">
          <Rect width="14.14" height="14.14" fill={RD.bg} />
          <Rect width="7.07" height="14.14" fill={RD.brandOrange} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

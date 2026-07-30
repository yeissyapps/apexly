// ============================================================================
//  CarSprite — coche cenital vectorial estilo Porsche 911 GT3 RS.
//
//  Componente compartido: lo usa Game.js (en pista) y Garage.js (preview del
//  garaje), para que el coche se vea SIEMPRE igual en los dos sitios. El eje
//  local +x apunta al morro. La carrocería/alerón/franja/faros son
//  personalizables vía `loadout`; el resto de detalles son fijos.
// ============================================================================

import { G, Path, Polygon, Rect, Circle } from 'react-native-svg';
import { CAR_DEFAULTS, findLivery } from './car';

const CAR_BODY =
  'M16,0 C15,-4 13,-6.5 10,-7.2 C6,-7.8 2,-7.2 -2,-7.6 ' +
  'C-6,-8 -9,-8.6 -12,-8.2 C-14,-7.9 -15.5,-6 -16,0 ' +
  'C-15.5,6 -14,7.9 -12,8.2 C-9,8.6 -6,8 -2,7.6 ' +
  'C2,7.2 6,7.8 10,7.2 C13,6.5 15,4 16,0 Z';

// Piezas del alerón por forma. Cada una es una lista de <Rect> (props planas).
function wingRects(shape, color) {
  const swan = [
    { x: -16.5, y: -4, width: 3.6, height: 8, rx: 1 },
    { x: -18.6, y: -10.8, width: 3.6, height: 21.6, rx: 1.6 },
    { x: -18.9, y: -11.2, width: 5.2, height: 2.4, rx: 1 },
    { x: -18.9, y: 8.8, width: 5.2, height: 2.4, rx: 1 },
  ];
  if (shape === 'sin_aleron') return [];
  if (shape === 'calle') {
    return [
      { x: -16.5, y: -4, width: 3, height: 8, rx: 1 },
      { x: -18, y: -7.6, width: 2.6, height: 15.2, rx: 1.4 },
    ];
  }
  if (shape === 'doble_plano') {
    return [...swan, { x: -17.4, y: -9.6, width: 2.6, height: 19.2, rx: 1.2 }];
  }
  return swan; // cuello_cisne (por defecto)
}

export default function CarSprite({ x, y, deg, scale = 1, loadout }) {
  const lo = { ...CAR_DEFAULTS, ...loadout };
  const livery = findLivery(lo.livery);
  return (
    <G transform={`translate(${x} ${y}) rotate(${deg}) scale(${scale})`}>
      {/* Alerón trasero (forma y color personalizables) */}
      {wingRects(lo.wingShape, lo.wingColor).map((r, i) => (
        <Rect key={i} {...r} fill={lo.wingColor} />
      ))}
      {/* Carrocería */}
      <Path d={CAR_BODY} fill={lo.bodyColor} />
      {/* Franja/librea sobre el cuerpo */}
      {livery.c && <Rect x={-8} y={-1.4} width={20} height={2.8} fill={livery.c} />}
      {/* Rejilla del motor (trasera) */}
      <Rect x={-12} y={-4.6} width={8} height={9.2} rx={2} fill="rgba(0,0,0,0.18)" />
      {/* Cabina / cristales */}
      <Rect x={-1} y={-4.8} width={9} height={9.6} rx={3.4} fill="#1b2733" />
      {/* Splitter delantero (sobresale del morro) */}
      <Rect x={13.6} y={-6.6} width={2.6} height={13.2} rx={1} fill="#0f1218" />
      {/* Faros + haz de luz (color personalizable) */}
      <Polygon points="11.4,-5 30,-11 30,-1" fill={lo.lightsColor} opacity={0.22} />
      <Polygon points="11.4,5 30,1 30,11" fill={lo.lightsColor} opacity={0.22} />
      <Polygon points="11.4,-5 20,-6.6 20,-3.4" fill={lo.lightsColor} opacity={0.4} />
      <Polygon points="11.4,5 20,3.4 20,6.6" fill={lo.lightsColor} opacity={0.4} />
      <Circle cx={11.4} cy={-5} r={1.7} fill={lo.lightsColor} />
      <Circle cx={11.4} cy={5} r={1.7} fill={lo.lightsColor} />
    </G>
  );
}

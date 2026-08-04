// ============================================================================
//  CarSprite — coche cenital vectorial estilo Porsche 911 GT3 RS.
//
//  Componente compartido: lo usa Game.js (en pista) y Garage.js (preview del
//  garaje), para que el coche se vea SIEMPRE igual en los dos sitios. El eje
//  local +x apunta al morro. La carrocería/alerón/franja/faros son
//  personalizables vía `loadout`; el resto de detalles son fijos.
//
//  Acabados premium (metalizado/cromado/holográfico): en vez de un fill
//  plano, se resuelven a un degradado SVG (ver `resolveFill`). El
//  holográfico "gira" con el tiempo real (Date.now()) en vez de necesitar un
//  timer propio — el coche ya se re-renderiza solo (plato del garaje o rAF
//  del juego), así que el degradado se recalcula gratis en cada frame.
// ============================================================================

import { Defs, G, LinearGradient, Path, Polygon, Rect, Circle, Stop, Text as SvgText } from 'react-native-svg';
import { CAR_DEFAULTS, findColorEntry } from './car';

const CAR_BODY =
  'M16,0 C15,-4 13,-6.5 10,-7.2 C6,-7.8 2,-7.2 -2,-7.6 ' +
  'C-6,-8 -9,-8.6 -12,-8.2 C-14,-7.9 -15.5,-6 -16,0 ' +
  'C-15.5,6 -14,7.9 -12,8.2 C-9,8.6 -6,8 -2,7.6 ' +
  'C2,7.2 6,7.8 10,7.2 C13,6.5 15,4 16,0 Z';

// Cuánto ha girado el degradado holográfico ahora mismo (0..1), a partir del
// reloj real — un ciclo completo cada 4s, igual que la muestra que vio JC.
function holoPhase() {
  return (Date.now() % 4000) / 4000;
}

// Resuelve un color de catálogo (ver `findColorEntry` en car.js) al `fill`
// real de SVG: un hex plano, o `url(#id)` de un degradado ya declarado en
// <Defs>. `id` identifica el <LinearGradient> (uno por pieza pintable, para
// que carrocería/alerón/franja no compartan degradado aunque sean el mismo
// color).
function resolveFill(hex, id) {
  const entry = findColorEntry(hex);
  if (entry.finish === 'flat' || !entry.stops) return { fill: entry.c, gradient: null };
  return { fill: `url(#${id})`, gradient: { id, stops: entry.stops, finish: entry.finish } };
}

function GradientDef({ id, stops, finish }) {
  const n = stops.length;
  const animated = finish === 'holografico';
  // Estático (metalizado): degradado fijo de esquina a esquina, un único
  // barrido suave — acabado satinado.
  // Animado (holográfico): el punto central se desliza con el tiempo
  // manteniendo siempre un vano de 100 puntos, para que "recorra" el coche
  // sin saltos (nada de módulo con el vano completo, que colapsaría x1=x2).
  const center = animated ? holoPhase() * 100 : 50;
  if (finish === 'cromado') {
    // Metal pulido/espejo: vano MUY estrecho + spreadMethod="reflect" hace
    // que los mismos stops reboten y se repitan en 2-3 franjas de luz/sombra
    // a lo largo del coche, en vez de un único barrido — así se lee como
    // metal pulido y no como "el mismo satinado con otro tinte".
    return (
      <LinearGradient id={id} x1={`${center - 15}%`} y1="0%" x2={`${center + 15}%`} y2="100%" spreadMethod="reflect">
        {stops.map((c, i) => <Stop key={i} offset={i / (n - 1)} stopColor={c} />)}
      </LinearGradient>
    );
  }
  return (
    <LinearGradient id={id} x1={`${center - 50}%`} y1="0%" x2={`${center + 50}%`} y2="100%">
      {stops.map((c, i) => <Stop key={i} offset={i / (n - 1)} stopColor={c} />)}
    </LinearGradient>
  );
}

// Piezas del alerón por forma. Cada una es una lista de <Rect> (props planas).
function wingRects(shape, color) {
  const swan = [
    { x: -16.5, y: -4, width: 3.6, height: 8, rx: 1 },
    { x: -18.6, y: -10.8, width: 3.6, height: 21.6, rx: 1.6 },
    { x: -18.9, y: -11.2, width: 5.2, height: 2.4, rx: 1 },
    { x: -18.9, y: 8.8, width: 5.2, height: 2.4, rx: 1 },
  ];
  if (shape === 'sin_aleron') return [];
  if (shape === 'cuello_cisne') return swan;
  if (shape === 'gt') {
    // Plano recto + placas trapezoidales en los extremos + puntales finos.
    return [
      { x: -18.5, y: -9, width: 3, height: 18, rx: 1 },
      { x: -20.5, y: -11, width: 3.4, height: 2.6, rx: 0.8 },
      { x: -20.5, y: 8.4, width: 3.4, height: 2.6, rx: 0.8 },
      { x: -16, y: -3.4, width: 2.2, height: 6.8, rx: 1 },
    ];
  }
  if (shape === 'barrido') {
    // Forma angulada/barrida, minimalista (menos piezas que el GT).
    return [
      { x: -19, y: -9.5, width: 3, height: 19, rx: 1.4 },
      { x: -16.2, y: -3, width: 2, height: 6, rx: 1 },
    ];
  }
  if (shape === 'cola_de_pato') {
    // Plano ancho pegado a la carrocería, sin puntales visibles — más
    // ancho que el propio coche (whale-tail).
    return [{ x: -17.5, y: -10, width: 4.5, height: 20, rx: 1.6 }];
  }
  return swan;
}

// Geometría de la franja de librea por patrón. `simple`/`doble` = rects
// paralelos; `diagonal` = polígono; `numero` = círculo con dorsal.
function LiveryShape({ pattern, color }) {
  if (pattern === 'doble') {
    return (
      <>
        <Rect x={-8} y={-2.6} width={20} height={1.6} fill={color} />
        <Rect x={-8} y={1} width={20} height={1.6} fill={color} />
      </>
    );
  }
  if (pattern === 'diagonal') {
    return <Polygon points="-2,-7.4 4,-7.4 -4,7.4 -10,7.4" fill={color} />;
  }
  if (pattern === 'numero') {
    return (
      <>
        <Circle cx={-2} cy={0} r={4.4} fill="none" stroke={color} strokeWidth={1} />
        <SvgText x={-2} y={1.6} fontSize={5} fontWeight="700" textAnchor="middle" fill={color}>7</SvgText>
      </>
    );
  }
  // simple (por defecto)
  return <Rect x={-8} y={-1.4} width={20} height={2.8} fill={color} />;
}

export default function CarSprite({ x, y, deg, scale = 1, loadout }) {
  const lo = { ...CAR_DEFAULTS, ...loadout };
  const body = resolveFill(lo.bodyColor, 'body');
  const wing = resolveFill(lo.wingColor, 'wing');
  const gradients = [body.gradient, wing.gradient].filter(Boolean);

  return (
    <G transform={`translate(${x} ${y}) rotate(${deg}) scale(${scale})`}>
      {gradients.length > 0 && (
        <Defs>
          {gradients.map((g) => <GradientDef key={g.id} {...g} />)}
        </Defs>
      )}
      {/* Alerón trasero (forma y color personalizables) */}
      {wingRects(lo.wingShape, lo.wingColor).map((r, i) => (
        <Rect key={i} {...r} fill={wing.fill} />
      ))}
      {/* Carrocería */}
      <Path d={CAR_BODY} fill={body.fill} />
      {/* Franja/librea sobre el cuerpo (patrón + color, por separado) */}
      {lo.livery && <LiveryShape pattern={lo.liveryPattern} color={lo.livery} />}
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

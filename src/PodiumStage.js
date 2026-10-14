// ============================================================================
//  PodiumStage — escenario del avatar en el Perfil: podio 1-2-3 con foco.
//
//  JC, 2026-10-14: "que no tenga ese fondo negro feo, no sé, un podio o algo
//  chulo". El muñeco 3D (AvatarViewer, fondo transparente) va ENCIMA de esto
//  y se encuadra con los pies sobre su sitio (ver podiumFraming).
//
//  En el Perfil el muñeco va SIEMPRE en el escalón del 1 (JC, 2026-10-14:
//  "en el perfil lo pondría siempre en el top 1"; se probó subirlo al
//  escalón de su puesto del mes y en el suelo fuera del podio no cuadraba).
//  `place` 2/3/null sigue soportado (escalón lateral / suelo sin podio) por
//  si se quiere volver a usar.
//
//  Capas: pared de patrocinadores (el "photocall" de los podios de verdad,
//  con APEXLY repetido casi invisible) -> haz de foco -> suelo -> escalones
//  2, 1, 3 -> luz y sombra bajo los pies. El color del foco es el de la
//  rareza del avatar (azul rara, magenta épica, oro legendaria; crema para
//  los normales): el mismo código de color que la Tienda y el Garaje.
//
//  Todo es SVG estático: se dibuja una vez, no anima, no cuesta nada.
// ============================================================================

import { memo } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Polygon, Ellipse, Line, G, Text as SvgText } from 'react-native-svg';
import { RD, RD_FONT } from './theme';

// Geometría del podio en fracciones del escenario (alto H, ancho W). Los
// encuadres de cámara de abajo salen de estos mismos números: si cambia uno,
// cambia el otro.
const TOP = { 1: 0.75, 2: 0.815, 3: 0.855 }; // cara de arriba de cada escalón
const FLOOR_FEET = 0.86;                     // fuera del podio: pies en el suelo, sin escalones
const stepWidths = (W) => ({ w1: Math.min(W * 0.36, 170), w2: Math.min(W * 0.25, 120) });

// El escenario va a sangre (todo el ancho de la pantalla) en el Perfil.
const SCREEN_W = Dimensions.get('window').width;

// Encuadre de AvatarViewer para cada sitio (ver framingTarget allí). zoom
// aleja la cámara; lift sube el muñeco en el cuadro; panX lo lleva a un
// lado. Calibrado en el A53: con zoom z, los pies quedan en
// 0.5 + 0.36/z - lift. En los escalones laterales (más estrechos) el muñeco
// se aleja más para caber.
function framingFor(place) {
  const { w1, w2 } = stepWidths(SCREEN_W);
  const side = (w1 + w2) / 2 / SCREEN_W;
  const liftFor = (zoom, feet) => 0.5 + 0.36 / zoom - feet;
  if (place === 1) return { zoom: 1.12, lift: liftFor(1.12, TOP[1]), panX: 0 };
  if (place === 2) return { zoom: 1.55, lift: liftFor(1.55, TOP[2]), panX: -side };
  if (place === 3) return { zoom: 1.55, lift: liftFor(1.55, TOP[3]), panX: side };
  return { zoom: 1.12, lift: liftFor(1.12, FLOOR_FEET), panX: 0 };
}
// Objetos fijos: AvatarViewer compara por identidad para saber si cambió.
const FRAMINGS = { 1: framingFor(1), 2: framingFor(2), 3: framingFor(3), floor: framingFor(null) };
export const podiumFraming = (place) => FRAMINGS[place] || FRAMINGS.floor;

const WALL = '#121216';
const FLOOR = '#0c0c0e';
const STEP_TOP = '#2e2e34';
const STEP_FACE = '#1a1a1f';
const STEP_EDGE = '#3a3a41';

function PodiumStage({ width: W, height: H, accent = RD.cream, place = null }) {
  const cx = W / 2;
  const { w1, w2 } = stepWidths(W);
  const x1 = cx - w1 / 2;
  const onStep = place === 1 || place === 2 || place === 3;
  const floorY = onStep ? H * (TOP[1] + 0.06) : H * FLOOR_FEET;
  const lip = 7; // grosor de la cara de arriba de cada escalón

  // Dónde está el muñeco: el foco y la luz del suelo van ahí.
  const spotX = place === 2 ? x1 - w2 / 2 : place === 3 ? x1 + w1 + w2 / 2 : cx;
  const spotY = onStep ? H * TOP[place] : H * FLOOR_FEET;
  const spotW = place === 2 || place === 3 ? w2 : w1;

  // Pared de patrocinadores: filas de APEXLY, cada una desplazada media
  // celda, como el photocall de detrás de un podio.
  const wall = [];
  const cellW = 104;
  const cellH = 34;
  for (let r = 0, y = 26; y < floorY - 6; r++, y += cellH) {
    for (let x = (r % 2 ? -cellW / 2 : 0) + 8; x < W; x += cellW) {
      wall.push(
        <SvgText key={`${r}-${x}`} x={x} y={y} fontSize={17} fontFamily={RD_FONT.displayBlack} letterSpacing={1.5} fill={RD.cream} fillOpacity={0.035}>
          APEXLY
        </SvgText>
      );
    }
  }

  const step = (x, w, top, num, numColor, numSize) => (
    <G key={num}>
      <Rect x={x} y={top} width={w} height={H - top} fill={STEP_FACE} />
      <Rect x={x} y={top} width={w} height={lip} fill={STEP_TOP} />
      <Line x1={x} y1={top + lip} x2={x + w} y2={top + lip} stroke={STEP_EDGE} strokeWidth={1} />
      <Rect x={x} y={top + lip + 1} width={w} height={2} fill={RD.brand} />
      <SvgText
        x={x + w / 2}
        y={top + lip + 3 + (H - top - lip - 3) * 0.5 + numSize * 0.36}
        fontSize={numSize}
        fontFamily={RD_FONT.displayBlack}
        fill={numColor}
        textAnchor="middle"
      >
        {num}
      </SvgText>
    </G>
  );

  const beam = `${spotX - 26},0 ${spotX + 26},0 ${spotX + spotW * 0.62},${spotY} ${spotX - spotW * 0.62},${spotY}`;

  return (
    <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={accent} stopOpacity={0.2} />
          <Stop offset="1" stopColor={accent} stopOpacity={0.02} />
        </LinearGradient>
        <RadialGradient id="pool" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={accent} stopOpacity={0.55} />
          <Stop offset="1" stopColor={accent} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={accent} stopOpacity={0.1} />
          <Stop offset="1" stopColor={accent} stopOpacity={0} />
        </RadialGradient>
      </Defs>

      <Rect x={0} y={0} width={W} height={H} fill={WALL} />
      {wall}

      {/* Halo detrás del muñeco + haz de foco desde arriba */}
      <Ellipse cx={spotX} cy={H * 0.42} rx={W * 0.42} ry={H * 0.4} fill="url(#halo)" />
      <Polygon points={beam} fill="url(#beam)" />

      {/* Suelo */}
      <Rect x={0} y={floorY} width={W} height={H - floorY} fill={FLOOR} />
      <Line x1={0} y1={floorY} x2={W} y2={floorY} stroke={RD.gridLine} strokeWidth={1} />

      {/* Escalones: 2 a la izquierda, 1 en el centro, 3 a la derecha */}
      {onStep && step(x1 - w2, w2, H * TOP[2], '2', RD.silver2nd, 30)}
      {onStep && step(x1 + w1, w2, H * TOP[3], '3', RD.bronze3rd, 28)}
      {onStep && step(x1, w1, H * TOP[1], '1', RD.gold1st, 46)}

      {/* Luz del foco donde está el muñeco y sombra de los pies */}
      <Ellipse cx={spotX} cy={spotY + lip / 2} rx={spotW * 0.5} ry={lip * 0.9} fill="url(#pool)" />
      <Ellipse cx={spotX} cy={spotY + 2} rx={spotW * 0.24} ry={4} fill="#000" fillOpacity={0.5} />
    </Svg>
  );
}

export default memo(PodiumStage);

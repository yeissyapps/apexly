// Mini-mapa del circuito: la traza completa en un solo color liso, SIEMPRE en
// horizontal (si el trazado real es más alto que ancho, se rota 90° al
// proyectar) para que quepa en una franja baja sin robar espacio vertical.
// El desglose por sector (tiempo + color de resultado) va aparte, debajo, como
// texto — ver Resultado en App.js.

import Svg, { Polyline, Circle, Rect, G } from 'react-native-svg';
import { RD } from './theme';

// Lado de cada cuadro del mini-damero de meta (mismo blanco/negro que el
// damero real del juego — ver ROAD.checkLight/checkDark en Game.js).
const CHK = 5;

// Rojo del tramo "peor sector" — deliberadamente más saturado que RD.danger
// (ese es un rojo-coral suave, aquí queremos que grite "atención" a simple vista).
const WORST_SECTOR_RED = '#ff1a1a';

// Mismo nº de sectores que el juego (ver SECTOR_COUNT en Game.js) — hace
// falta aquí para recortar el tercio de traza a resaltar en rojo.
const SECTOR_COUNT = 3;

export default function MiniTrackMap({ track, w, h, pad = 10, worstSector = null }) {
  if (!track || !track.center || track.center.length < 2) return null;
  const pts = track.center;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;
  const rotate = bh > bw; // fuerza horizontal: si es más alto que ancho, gira 90°
  const rw = rotate ? bh : bw;
  const rh = rotate ? bw : bh;
  const s = Math.min((w - pad * 2) / rw, (h - pad * 2) / rh);
  const offX = (w - rw * s) / 2;
  const offY = (h - rh * s) / 2;

  function projXY(p) {
    const rx = rotate ? p.y - minY : p.x - minX;
    const ry = rotate ? p.x - minX : p.y - minY;
    return { x: rx * s + offX, y: ry * s + offY };
  }
  function proj(p) {
    const { x, y } = projXY(p);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }

  const points = pts.map(proj).join(' ');
  // Marcadores de sentido: sin esto la traza es una silueta simétrica y no se
  // sabe por dónde se corre — punto verde en la salida, damero en la meta
  // (mismo lenguaje visual que usa el juego de verdad).
  const start = projXY(pts[0]);
  const end = projXY(pts[pts.length - 1]);

  // Tercio de traza a pintar en rojo (tu peor sector respecto al mejor de
  // hoy) — mismo criterio de fronteras que sectorOfIdx() en Game.js.
  let worstPoints = null;
  if (worstSector != null && worstSector >= 0 && worstSector < SECTOR_COUNT) {
    const totalPts = pts.length;
    const startIdx = Math.round((worstSector / SECTOR_COUNT) * (totalPts - 1));
    const endIdx = Math.round(((worstSector + 1) / SECTOR_COUNT) * (totalPts - 1));
    worstPoints = pts.slice(startIdx, endIdx + 1).map(proj).join(' ');
  }

  return (
    <Svg width={w} height={h}>
      <Polyline points={points} fill="none" stroke={RD.cream} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      {worstPoints && (
        <Polyline points={worstPoints} fill="none" stroke={WORST_SECTOR_RED} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      )}
      <Circle cx={start.x} cy={start.y} r={4} fill={RD.successGreen} stroke={RD.bg} strokeWidth={1.5} />
      <G>
        <Rect x={end.x - CHK} y={end.y - CHK} width={CHK} height={CHK} fill="#f2f2f2" />
        <Rect x={end.x} y={end.y - CHK} width={CHK} height={CHK} fill="#15171c" />
        <Rect x={end.x - CHK} y={end.y} width={CHK} height={CHK} fill="#15171c" />
        <Rect x={end.x} y={end.y} width={CHK} height={CHK} fill="#f2f2f2" />
      </G>
    </Svg>
  );
}

// Mini-mapa del circuito: la traza completa en un solo color liso, SIEMPRE en
// horizontal (si el trazado real es más alto que ancho, se rota 90° al
// proyectar) para que quepa en una franja baja sin robar espacio vertical.
// El desglose por sector (tiempo + color de resultado) va aparte, debajo, como
// texto — ver Resultado en App.js.

import Svg, { Polyline } from 'react-native-svg';
import { RD } from './theme';

export default function MiniTrackMap({ track, w, h, pad = 10 }) {
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

  function proj(p) {
    const rx = rotate ? p.y - minY : p.x - minX;
    const ry = rotate ? p.x - minX : p.y - minY;
    return `${(rx * s + offX).toFixed(1)},${(ry * s + offY).toFixed(1)}`;
  }

  const points = pts.map(proj).join(' ');

  return (
    <Svg width={w} height={h}>
      <Polyline points={points} fill="none" stroke={RD.cream} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

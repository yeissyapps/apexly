// ============================================================================
//  Game — la pantalla jugable (física, cámara, colisión ya validadas).
//
//  Recibe el circuito ya construido por `track`, avisa con `onFinish(ms)` al meta
//  (una sola vez) y con `onExit()` para volver a Inicio. NO contiene lógica de
//  backend ni de resultados: eso lo maneja App.js.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Svg, { G, Line, Polygon, Polyline, Rect, Circle } from 'react-native-svg';

import { CONFIG } from './config';
import { fmt } from './format';
import { NEUTRAL } from './weather';
import RainOverlay from './RainOverlay';

const now = () => Date.now();
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Punto más cercano de la línea central a (px,py) + medio-ancho (w) interpolado.
function nearestOnPolyline(pts, px, py) {
  let best = { dist: Infinity, x: px, y: py, w: pts[0].w };
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].x;
    const ay = pts[i].y;
    const dx = pts[i + 1].x - ax;
    const dy = pts[i + 1].y - ay;
    const len2 = dx * dx + dy * dy || 1;
    let tt = ((px - ax) * dx + (py - ay) * dy) / len2;
    tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
    const cx = ax + dx * tt;
    const cy = ay + dy * tt;
    const d = Math.hypot(px - cx, py - cy);
    if (d < best.dist) {
      const w = pts[i].w + (pts[i + 1].w - pts[i].w) * tt;
      best = { dist: d, x: cx, y: cy, w };
    }
  }
  return best;
}

const STATUS_PAD = 44;
const HUD_H = 52 + STATUS_PAD;

// --- Cámara (solo render; no afecta a la física) ---------------------------
const CAM_VIEW_W = 260; // unidades de mundo visibles a lo ancho (mayor = menos zoom)
const CAM_ANCHOR = 0.68; // posición vertical del coche (0=arriba, 1=abajo)
const CAM_TURN_LERP = 3.5; // suavizado del giro de cámara (menor = más suave)

const SCREEN = Dimensions.get('window');

export default function Game({ track, ghost, weather, onFinish, onExit }) {
  const playW = SCREEN.width;
  const playH = SCREEN.height - HUD_H;
  const wx = weather || NEUTRAL;

  const g = useRef(null);
  const pressLeft = useRef(false);
  const pressRight = useRef(false);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const ghostRef = useRef(ghost);
  ghostRef.current = ghost;
  const weatherRef = useRef(wx);
  weatherRef.current = wx;
  const traceRef = useRef([]); // grabación de la vuelta actual
  const lastSampleRef = useRef(-999);
  const ghostIdxRef = useRef(0);

  const [view, setView] = useState(null);

  function resetRun() {
    traceRef.current = [];
    lastSampleRef.current = -999;
    ghostIdxRef.current = 0;
  }

  function resetGame() {
    resetRun();
    g.current = initialState(track);
    pressLeft.current = false;
    pressRight.current = false;
    setView(toView(g.current, false, ghostPoseAt(ghostRef.current, 0, ghostIdxRef)));
  }

  function startRun() {
    const s = g.current;
    if (s && s.phase === 'ready') {
      s.phase = 'running';
      s.startTime = now();
      s.lastTime = now();
    }
  }

  useEffect(() => {
    resetRun();
    g.current = initialState(track);
    pressLeft.current = false;
    pressRight.current = false;
    setView(toView(g.current, false, ghostPoseAt(ghostRef.current, 0, ghostIdxRef)));

    let raf;
    let mounted = true;
    g.current.lastTime = now();

    const frame = () => {
      if (!mounted) return;
      const s = g.current;
      const t = now();
      let dt = (t - s.lastTime) / 1000;
      s.lastTime = t;
      dt = clamp(dt, 0, 1 / 30);

      if (s.phase === 'running') {
        stepSimulation(s, dt, t, track, pressLeft, pressRight, weatherRef.current);
        s.elapsed = t - s.startTime;

        // Grabar la traza de la vuelta (para el fantasma), con throttle.
        const tr = traceRef.current;
        if (tr.length === 0 || s.elapsed - lastSampleRef.current >= 50) {
          tr.push([Math.round(s.elapsed), Math.round(s.x * 10) / 10, Math.round(s.y * 10) / 10, Math.round(s.heading * 1000) / 1000]);
          lastSampleRef.current = s.elapsed;
        }

        // Avisa (con la traza) una sola vez al cruzar la meta.
        if (s.phase === 'finished' && !s.reported) {
          s.reported = true;
          tr.push([Math.round(s.elapsed), Math.round(s.x * 10) / 10, Math.round(s.y * 10) / 10, Math.round(s.heading * 1000) / 1000]);
          if (onFinishRef.current) onFinishRef.current(s.elapsed, tr);
        }
      }

      // Cámara: el rumbo persigue (con lag suave) el del coche.
      let da = s.heading - s.camAngle;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      s.camAngle += da * Math.min(1, dt * CAM_TURN_LERP);

      const gp = ghostPoseAt(ghostRef.current, s.elapsed, ghostIdxRef);
      setView(toView(s, t < s.flashUntil, gp));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      mounted = false;
      cancelAnimationFrame(raf);
    };
  }, [track]);

  if (!view) return <View style={styles.root}><StatusBar hidden /></View>;

  const carDeg = (view.heading * 180) / Math.PI;
  const carColor = view.flash ? '#ff5a3c' : '#ffd23f';
  const noseX = view.x + Math.cos(view.heading) * CONFIG.CAR_LENGTH * 0.32;
  const noseY = view.y + Math.sin(view.heading) * CONFIG.CAR_LENGTH * 0.32;

  const camZoom = playW / CAM_VIEW_W;
  const camRot = -((view.camAngle * 180) / Math.PI + 90);
  const camTransform =
    `translate(${playW / 2} ${playH * CAM_ANCHOR}) ` +
    `scale(${camZoom}) rotate(${camRot}) translate(${-view.x} ${-view.y})`;

  return (
    <View style={styles.root}>
      <StatusBar hidden />

      <View style={[styles.playArea, { top: HUD_H, width: playW, height: playH }]}>
        <Svg width={playW} height={playH} viewBox={`0 0 ${playW} ${playH}`}>
          <G transform={camTransform}>
            <TrackLayer track={track} showDebug={CONFIG.SHOW_DEBUG} wet={wx.id === 'rain'} />
            {/* Coche fantasma (tu mejor vuelta), translúcido, por debajo */}
            {view.ghost && (
              <Rect
                x={view.ghost.x - CONFIG.CAR_LENGTH / 2}
                y={view.ghost.y - CONFIG.CAR_WIDTH / 2}
                width={CONFIG.CAR_LENGTH}
                height={CONFIG.CAR_WIDTH}
                rx={3}
                fill="#9fb3d0"
                opacity={0.35}
                transform={`rotate(${(view.ghost.h * 180) / Math.PI} ${view.ghost.x} ${view.ghost.y})`}
              />
            )}
            <Rect
              x={view.x - CONFIG.CAR_LENGTH / 2}
              y={view.y - CONFIG.CAR_WIDTH / 2}
              width={CONFIG.CAR_LENGTH}
              height={CONFIG.CAR_WIDTH}
              rx={3}
              fill={carColor}
              transform={`rotate(${carDeg} ${view.x} ${view.y})`}
            />
            <Circle cx={noseX} cy={noseY} r={3.5} fill="#20242e" />
            {CONFIG.SHOW_DEBUG && (
              <Line
                x1={view.x}
                y1={view.y}
                x2={view.x + Math.cos(view.heading) * 40}
                y2={view.y + Math.sin(view.heading) * 40}
                stroke="#4ad6ff"
                strokeWidth={2}
              />
            )}
          </G>
        </Svg>

        {/* Zonas táctiles invisibles (mitad izq / der) */}
        <Pressable
          style={[styles.touchZone, { left: 0, width: playW / 2 }]}
          onPressIn={() => { startRun(); pressLeft.current = true; }}
          onPressOut={() => { pressLeft.current = false; }}
        >
          {CONFIG.SHOW_TOUCH_HINTS && <Text style={styles.hint}>‹</Text>}
        </Pressable>
        <Pressable
          style={[styles.touchZone, { right: 0, width: playW / 2 }]}
          onPressIn={() => { startRun(); pressRight.current = true; }}
          onPressOut={() => { pressRight.current = false; }}
        >
          {CONFIG.SHOW_TOUCH_HINTS && <Text style={styles.hint}>›</Text>}
        </Pressable>

        {/* Efecto de lluvia (solo días de lluvia) */}
        {wx.id === 'rain' && <RainOverlay w={playW} h={playH} />}

        {/* Parte meteorológico (siempre visible) */}
        <View pointerEvents="none" style={styles.wxPill}>
          <Text style={styles.wxPillText}>{wx.icon} {wx.label}</Text>
        </View>

        {view.phase === 'ready' && (
          <View pointerEvents="none" style={styles.overlay}>
            <Text style={styles.overlayBig}>TOCA PARA ARRANCAR</Text>
            <Text style={styles.overlaySmall}>
              Mitad izquierda gira ‹  ·  mitad derecha gira ›
            </Text>
            {wx.id !== 'clear' && (
              <Text style={styles.overlayWx}>{wx.icon} {wx.label} · {wx.hint}</Text>
            )}
          </View>
        )}
      </View>

      <View style={[styles.hud, { height: HUD_H, paddingTop: STATUS_PAD }]}>
        <Pressable style={styles.hudBtn} onPress={onExit} hitSlop={10}>
          <Text style={styles.hudBtnText}>‹ Salir</Text>
        </Pressable>
        <Text style={styles.timer}>{fmt(view.elapsed)}</Text>
        <Pressable style={styles.hudBtn} onPress={resetGame} hitSlop={10}>
          <Text style={styles.hudBtnText}>↻</Text>
        </Pressable>
      </View>
    </View>
  );
}

// --- Paleta de la pista (solo render) --------------------------------------
const ROAD = {
  asphalt:    '#23282f',
  kerbWhite:  '#eef0f4',
  kerbRed:    '#ff5a3c',
  lane:       '#5d646e',
  start:      '#ffb84d',
  checkLight: '#f2f2f2',
  checkDark:  '#15171c',
};
const KERB_W = 9;   // ancho del piano (centrado en el borde)
const CHECK_SQ = 11; // lado de cada cuadro de la meta

// Cuadros del damero de meta, alineados a la línea a→b y al sentido de marcha.
function checkeredQuads(finish) {
  const { a, b } = finish;
  const ax = b.x - a.x, ay = b.y - a.y;
  const L = Math.hypot(ax, ay) || 1;
  const ux = ax / L, uy = ay / L;            // a lo ancho de la pista
  const tx = finish.tangent.x, ty = finish.tangent.y; // sentido de marcha
  const cols = Math.max(1, Math.round(L / CHECK_SQ));
  const cw = L / cols;                        // encaje exacto a lo ancho
  const quads = [];
  for (let i = 0; i < cols; i++) {
    for (let r = -1; r < 1; r++) {            // dos filas a caballo de la línea
      const light = (i + (r + 1)) % 2 === 0;
      const bx = a.x + ux * (i * cw) + tx * (r * CHECK_SQ);
      const by = a.y + uy * (i * cw) + ty * (r * CHECK_SQ);
      const p = [
        `${bx},${by}`,
        `${bx + ux * cw},${by + uy * cw}`,
        `${bx + ux * cw + tx * CHECK_SQ},${by + uy * cw + ty * CHECK_SQ}`,
        `${bx + tx * CHECK_SQ},${by + ty * CHECK_SQ}`,
      ].join(' ');
      quads.push({ p, color: light ? ROAD.checkLight : ROAD.checkDark });
    }
  }
  return quads;
}

const TrackLayer = ({ track, showDebug, wet }) => {
  const road = track.roadPolygon.map((p) => `${p.x},${p.y}`).join(' ');
  const lane = track.center.map((p) => `${p.x},${p.y}`).join(' ');
  const checks = checkeredQuads(track.finish);
  const asphalt = wet ? '#181f29' : ROAD.asphalt; // asfalto más oscuro/frío mojado
  return (
    <G>
      {/* Asfalto */}
      <Polygon points={road} fill={asphalt} />
      {/* Piano rojo/blanco continuo: base blanca + rayas rojas, sobre el borde */}
      <Polygon points={road} fill="none" stroke={ROAD.kerbWhite} strokeWidth={KERB_W} strokeLinejoin="round" />
      <Polygon points={road} fill="none" stroke={ROAD.kerbRed} strokeWidth={KERB_W} strokeLinejoin="round" strokeDasharray="11,11" />
      {/* Línea de carril discontinua */}
      <Polyline points={lane} fill="none" stroke={ROAD.lane} strokeWidth={2} strokeDasharray="10,16" opacity={0.7} />
      {/* Salida (sutil, dorada) */}
      <Line
        x1={track.startLine.a.x} y1={track.startLine.a.y}
        x2={track.startLine.b.x} y2={track.startLine.b.y}
        stroke={ROAD.start} strokeWidth={3} opacity={0.85}
      />
      {/* Meta a cuadros */}
      {checks.map((q, i) => (
        <Polygon key={i} points={q.p} fill={q.color} />
      ))}
      {showDebug && (
        <G>
          <Polyline points={track.left.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#ff5a3c" strokeWidth={1} />
          <Polyline points={track.right.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#ff5a3c" strokeWidth={1} />
          <Polyline points={track.center.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#4ad6ff" strokeWidth={1} />
        </G>
      )}
    </G>
  );
};

function initialState(track) {
  return {
    phase: 'ready', // 'ready' | 'running' | 'finished'
    x: track.startPose.x,
    y: track.startPose.y,
    heading: track.startPose.heading,
    camAngle: track.startPose.heading,
    speed: 0,
    steer: 0,
    lastImpact: -9999,
    stunUntil: 0,
    flashUntil: 0,
    startTime: 0,
    lastTime: 0,
    elapsed: 0,
    reported: false, // ¿ya avisamos del final?
  };
}

function toView(s, flash, ghost) {
  return { x: s.x, y: s.y, heading: s.heading, camAngle: s.camAngle, elapsed: s.elapsed, phase: s.phase, flash, ghost };
}

// Pose del fantasma (tu mejor vuelta) en el instante `e` (ms). Avanza un puntero
// monótono e interpola entre muestras. trace = [[t,x,y,h], ...].
function ghostPoseAt(trace, e, idxRef) {
  if (!trace || trace.length === 0) return null;
  let i = idxRef.current;
  if (i > trace.length - 1) i = trace.length - 1;
  while (i < trace.length - 1 && trace[i + 1][0] <= e) i++;
  idxRef.current = i;
  const a = trace[i];
  const b = trace[i + 1];
  if (!b) return { x: a[1], y: a[2], h: a[3] }; // ya terminó -> se queda en meta
  const span = b[0] - a[0] || 1;
  const f = Math.max(0, Math.min(1, (e - a[0]) / span));
  let dh = b[3] - a[3];
  while (dh > Math.PI) dh -= 2 * Math.PI;
  while (dh < -Math.PI) dh += 2 * Math.PI;
  return { x: a[1] + (b[1] - a[1]) * f, y: a[2] + (b[2] - a[2]) * f, h: a[3] + dh * f };
}

// --- Un paso de simulación (feel del coche; no tocar) ----------------------
//  El clima entra SOLO como modificadores (steerMul/speedMul/viento) encima de
//  las constantes; con NEUTRAL el comportamiento es idéntico al de siempre.
function stepSimulation(s, dt, t, track, pressLeft, pressRight, weather) {
  const C = CONFIG;
  const W = weather || NEUTRAL;

  let target = 0;
  if (pressLeft.current) target -= 1;
  if (pressRight.current) target += 1;

  const easeTime = (target !== 0 ? C.STEER_EASE_IN : C.STEER_EASE_OUT) * W.steerMul;
  const maxDelta = dt / Math.max(0.001, easeTime);
  s.steer += clamp(target - s.steer, -maxDelta, maxDelta);
  s.steer = clamp(s.steer, -1, 1);

  const cap = C.MAX_SPEED * W.speedMul;
  s.speed = Math.min(cap, s.speed + C.ACCEL * dt);

  const stunned = t < s.stunUntil;
  if (!stunned) {
    const speedFrac = cap > 0 ? s.speed / cap : 0;
    const turnFactor = 1 + (C.TURN_RATE_AT_MAX_SPEED - 1) * speedFrac;
    const turnRateRad = ((C.TURN_RATE_MAX_DEG * Math.PI) / 180) * turnFactor;
    s.heading += turnRateRad * s.steer * dt;
  }

  const vx = Math.cos(s.heading) * s.speed;
  const vy = Math.sin(s.heading) * s.speed;
  s.x += (vx + W.windX) * dt;
  s.y += (vy + W.windY) * dt;

  const near = nearestOnPolyline(track.center, s.x, s.y);
  const radius = near.w - C.CAR_WIDTH / 2;
  if (near.dist > radius) {
    const inv = near.dist || 1;
    const nx = (near.x - s.x) / inv;
    const ny = (near.y - s.y) / inv;
    s.x = near.x - nx * radius;
    s.y = near.y - ny * radius;
    const vn = vx * nx + vy * ny;
    if (vn < 0) {
      const k = (1 + C.CRASH_BOUNCE) * vn;
      let rvx = vx - k * nx;
      let rvy = vy - k * ny;
      let mag = Math.hypot(rvx, rvy) || 0;
      if (t - s.lastImpact > C.CRASH_STUN_MS + 80) {
        mag *= 1 - C.CRASH_SPEED_LOSS;
        s.stunUntil = t + C.CRASH_STUN_MS;
        s.flashUntil = t + 140;
        s.lastImpact = t;
      }
      s.speed = mag;
      if (rvx !== 0 || rvy !== 0) s.heading = Math.atan2(rvy, rvx);
    }
  }

  const f = track.finish;
  const dx = s.x - f.point.x;
  const dy = s.y - f.point.y;
  const proj = dx * f.tangent.x + dy * f.tangent.y;
  if (proj >= 0 && Math.hypot(dx, dy) < C.TRACK_WIDTH) {
    s.phase = 'finished';
    s.elapsed = t - s.startTime;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d0f13' },
  playArea: { position: 'absolute', left: 0, backgroundColor: '#0d0f13' },
  touchZone: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' },
  hint: { fontSize: 64, color: 'rgba(255,255,255,0.10)', fontWeight: '800' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' },
  overlayBig: { color: '#ffffff', fontSize: 24, fontWeight: '800', letterSpacing: 1 },
  overlaySmall: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 10 },
  overlayWx: { color: '#ffb84d', fontSize: 14, fontWeight: '700', marginTop: 16 },
  wxPill: {
    position: 'absolute', top: 12, right: 12,
    backgroundColor: 'rgba(13,15,19,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6,
  },
  wxPillText: { color: '#ecebe5', fontSize: 13, fontWeight: '700' },
  hud: {
    position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#151a26',
  },
  timer: { color: '#ffffff', fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] },
  hudBtn: { backgroundColor: '#2a3242', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  hudBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
});

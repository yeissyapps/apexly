// ============================================================================
//  Game — la pantalla jugable (física, cámara, colisión ya validadas).
//
//  Recibe el circuito ya construido por `track`, avisa con `onFinish(ms)` al meta
//  (una sola vez) y con `onExit()` para volver a Inicio. NO contiene lógica de
//  backend ni de resultados: eso lo maneja App.js.
// ============================================================================

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Svg, { G, Line, Path, Polygon, Polyline, Rect, Circle } from 'react-native-svg';

import { CONFIG } from './config';
import { fmt } from './format';
import { NEUTRAL } from './weather';
import WeatherFX from './WeatherFX';

const now = () => Date.now();
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Punto más cercano de la línea central a (px,py) + medio-ancho (w) interpolado.
//
// `hint` = índice del tramo donde estaba el coche en el paso anterior. Se busca
// SOLO en una ventana a su alrededor. Importa por rendimiento: con el paso fijo,
// cuantos menos FPS va el móvil MÁS sub-pasos se ejecutan por frame, y recorrer
// los ~250 puntos en cada uno realimentaba la caída (menos FPS -> más CPU ->
// menos FPS). De paso evita que en un tramo donde la pista se dobla sobre sí
// misma el punto más cercano salte a la otra rama.
function nearestOnPolyline(pts, px, py, hint, window) {
  const n = pts.length;
  let lo = 0;
  let hi = n - 2;
  if (hint != null && window != null) {
    lo = Math.max(0, hint - window);
    hi = Math.min(n - 2, hint + window);
  }
  let best = { dist: Infinity, x: px, y: py, w: pts[0].w, idx: lo };
  for (let i = lo; i <= hi; i++) {
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
      best = { dist: d, x: cx, y: cy, w, idx: i };
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

// Paso fijo de la simulación (s). La física NO depende de los FPS de pantalla:
// se acumula el tiempo real y se resuelven pasos de este tamaño.
const FIXED_DT = 1 / 120;

// Tramos de la línea central que se miran alrededor del último conocido para
// localizar el coche. A tope de velocidad avanza ~2 unidades por sub-paso y los
// puntos están a ~35 de media, así que el índice se mueve como mucho de 1 en 1:
// 25 da muchísimo margen incluso tras un choque.
const TRACK_WINDOW = 25;

const SCREEN = Dimensions.get('window');

export default function Game({ track, ghost, weather, attemptsLeft = Infinity, onAttemptStart, onNeedMore, onFinish, onExit }) {
  const playW = SCREEN.width;
  const playH = SCREEN.height - HUD_H;
  const wx = weather || NEUTRAL;

  const g = useRef(null);
  const pressLeft = useRef(false);
  const pressRight = useRef(false);
  const touchMap = useRef(new Map()); // identifier del dedo -> pageX
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
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

  function startRun() {
    const s = g.current;
    if (s && s.phase === 'ready') {
      if (attemptsLeft <= 0) { if (onNeedMore) onNeedMore(); return; } // sin intentos → anuncio
      s.phase = 'running';
      s.startTime = now();
      s.lastTime = now();
      s.acc = 0; // que un acumulador viejo no suelte un golpe de sub-pasos al arrancar
      if (onAttemptStart) onAttemptStart();
    }
  }

  // Volante: se lleva la cuenta de CADA dedo por su identifier y se borra
  // explícitamente al levantarlo (`changedTouches`), en vez de recalcular desde
  // `nativeEvent.touches`. Motivo: en iOS ese array puede seguir incluyendo el
  // dedo que se acaba de soltar, así que el volante no se soltaba hasta el
  // siguiente evento — y si no llegaba ninguno (dedo quieto, típico al mantener
  // pulsado en una horquilla), el coche seguía girando de más.
  function applyTouches() {
    let left = false;
    let right = false;
    touchMap.current.forEach((x) => {
      if (x < playW / 2) left = true;
      else right = true;
    });
    pressLeft.current = left;
    pressRight.current = right;
    return left || right;
  }

  function onTouchDown(evt) {
    const ch = evt.nativeEvent.changedTouches || [];
    for (let i = 0; i < ch.length; i++) touchMap.current.set(ch[i].identifier, ch[i].pageX);
    if (applyTouches()) startRun();
  }

  function onTouchMove(evt) {
    const ch = evt.nativeEvent.changedTouches || [];
    for (let i = 0; i < ch.length; i++) touchMap.current.set(ch[i].identifier, ch[i].pageX);
    applyTouches();
  }

  function onTouchUp(evt) {
    const ch = evt.nativeEvent.changedTouches || [];
    for (let i = 0; i < ch.length; i++) touchMap.current.delete(ch[i].identifier);
    // Red de seguridad: si el sistema dice que ya no queda ningún dedo, se
    // suelta todo aunque `changedTouches` viniera incompleto.
    if ((evt.nativeEvent.touches || []).length === 0) touchMap.current.clear();
    applyTouches();
  }

  function onTouchCancel() {
    touchMap.current.clear();
    applyTouches();
  }

  useEffect(() => {
    resetRun();
    g.current = initialState(track);
    pressLeft.current = false;
    pressRight.current = false;
    touchMap.current.clear();
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
      // Tope de tiempo simulado por frame. Por debajo de este ritmo el juego
      // entra en cámara lenta MIENTRAS el cronómetro sigue en tiempo real (usa
      // Date.now()), así que recorres menos pista por segundo y encima te
      // penaliza el tiempo. Antes estaba en 1/30, que en un móvil con tirones
      // se notaba mucho; ahora los sub-pasos de FIXED_DT evitan que un dt
      // grande atraviese muros, así que se puede subir a 1/15.
      dt = clamp(dt, 0, 1 / 15);

      if (s.phase === 'running') {
        // Física a PASO FIJO, desacoplada de los FPS de pantalla. Antes se
        // simulaba un paso por frame, así que un móvil de 120Hz (ProMotion)
        // resolvía el doble de colisiones por segundo que uno de 60Hz: distinto
        // tacto Y distintos tiempos con la misma conducción, lo que en un juego
        // de ranking es además injusto.
        s.acc += dt;
        let guard = 0;
        while (s.acc >= FIXED_DT && guard < 10) {
          stepSimulation(s, FIXED_DT, t, track, pressLeft, pressRight, weatherRef.current);
          s.acc -= FIXED_DT;
          guard++;
          if (s.phase !== 'running') break;
        }
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

      // FPS reales, para diagnosticar en beta si el rendimiento se degrada
      // entre intentos (JC: "cada intento va peor que el anterior").
      s.fpsCount++;
      if (t - s.fpsTime >= 500) {
        s.fps = Math.round((s.fpsCount * 1000) / (t - s.fpsTime));
        s.fpsCount = 0;
        s.fpsTime = t;
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

  // Anti-trampa: si sales de la app EN MITAD de una carrera, se anula.
  //  El intento ya se gastó al arrancar; no se contabiliza tiempo (solo se
  //  envía al cruzar meta). Así no se puede pausar para planear la vuelta.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background' && g.current && g.current.phase === 'running') {
        g.current.phase = 'ready'; // detiene la simulación en curso
        if (onExitRef.current) onExitRef.current();
      }
    });
    return () => sub.remove();
  }, []);

  if (!view) return <View style={styles.root}><StatusBar hidden /></View>;

  const carDeg = (view.heading * 180) / Math.PI;
  const carColor = view.flash ? '#ff5a3c' : '#ffd23f';

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
            {/* Coche fantasma (tu mejor vuelta), muy tenue, por debajo */}
            {view.ghost && (
              <Rect
                x={view.ghost.x - CONFIG.CAR_LENGTH / 2}
                y={view.ghost.y - CONFIG.CAR_WIDTH / 2}
                width={CONFIG.CAR_LENGTH}
                height={CONFIG.CAR_WIDTH}
                rx={4}
                fill="#d5deeb"
                opacity={0.2}
                transform={`rotate(${(view.ghost.h * 180) / Math.PI} ${view.ghost.x} ${view.ghost.y})`}
              />
            )}
            <CarSprite x={view.x} y={view.y} deg={carDeg} color={carColor} />
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

        {/* Zona táctil única: se recalcula izq/der desde TODOS los toques activos
            en cada evento (ver handleTouch), más fiable en iOS que dos Pressable
            independientes con press-in/press-out. */}
        <View
          style={styles.touchZone}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
          onResponderGrant={onTouchDown}
          onResponderStart={onTouchDown}
          onResponderMove={onTouchMove}
          onResponderEnd={onTouchUp}
          onResponderRelease={onTouchUp}
          onResponderTerminate={onTouchCancel}
        >
          {CONFIG.SHOW_TOUCH_HINTS && (
            <>
              <Text style={[styles.hint, styles.hintLeft, { width: playW / 2 }]}>‹</Text>
              <Text style={[styles.hint, styles.hintRight, { width: playW / 2 }]}>›</Text>
            </>
          )}
        </View>

        {/* Efecto visual del clima del día (lluvia / viento / seco) */}
        <WeatherFX weather={wx} w={playW} h={playH} />

        {/* Parte meteorológico (siempre visible) */}
        <View pointerEvents="none" style={styles.wxPill}>
          <Text style={styles.wxPillText}>{wx.icon} {wx.label}</Text>
        </View>

        {/* FPS — solo para la beta, quitar cuando esté diagnosticado */}
        <View pointerEvents="none" style={styles.fpsPill}>
          <Text style={styles.fpsText}>{view.fps} fps</Text>
        </View>

        {view.phase === 'ready' && (
          <View pointerEvents="none" style={styles.startPanel}>
            <Text style={styles.startTitle}>Toca para arrancar</Text>
            <Text style={styles.startSub}>Izquierda gira ‹    ·    derecha gira ›</Text>
            <View style={styles.startMeta}>
              {Number.isFinite(attemptsLeft) && (
                <View style={styles.startTag}>
                  <Text style={styles.startTagText}>
                    {attemptsLeft > 0 ? `${attemptsLeft} ${attemptsLeft === 1 ? 'intento' : 'intentos'}` : 'Sin intentos'}
                  </Text>
                </View>
              )}
              {wx.id !== 'clear' && (
                <View style={[styles.startTag, styles.startTagWx]}>
                  <Text style={styles.startTagWxText}>{wx.icon} {wx.hint}</Text>
                </View>
              )}
            </View>
          </View>
        )}
      </View>

      <View style={[styles.hud, { height: HUD_H, paddingTop: STATUS_PAD }]}>
        <View style={styles.hudSide}>
          {view.phase === 'ready' && (
            <Pressable style={styles.hudBtn} onPress={onExit} hitSlop={10}>
              <Text style={styles.hudBtnText}>‹ Salir</Text>
            </Pressable>
          )}
        </View>
        <Text style={styles.timer}>{fmt(view.elapsed)}</Text>
        <View style={styles.hudSide} />
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
const KERB_W = 9;    // ancho del piano (centrado en el borde)
const KERB_BLOCK = 11; // largo objetivo de cada tramo rojo/blanco del piano
const CHECK_SQ = 11; // lado de cada cuadro de la meta

// Tramos ROJOS del piano como geometría explícita, recorriendo el borde por
// longitud de arco. Devuelve UN solo path (`d`) con un subtrazado por bloque.
//
// Antes esto se hacía con `strokeDasharray` sobre el contorno de la pista, pero
// el patrón discontinuo se rasteriza de forma distinta en iOS (bloques de
// anchos desiguales, sobre todo en curva). Generando los bloques a mano el
// resultado es idéntico en ambas plataformas, igual que ya se hace con el
// damero de meta. Además encaja un nº ENTERO de bloques para que el patrón
// cierre sin un trozo corto al final.
//
// OJO: son ~450 bloques por borde. Van todos en un único <Path> (no un nodo por
// bloque) porque el <G> de cámara cambia de transform en CADA frame y arrastra
// consigo el redibujado de todo lo que cuelgue de él.
function kerbPath(pts, blockLen, halfW) {
  const n = pts.length;
  if (n < 2) return '';

  // Longitud acumulada por vértice.
  const cum = [0];
  for (let i = 1; i < n; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = cum[n - 1];
  if (total <= 0) return '';

  // Normal por vértice (perpendicular a la tangente promediada).
  const nor = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[Math.min(n - 1, i + 1)];
    const tx = p1.x - p0.x;
    const ty = p1.y - p0.y;
    const L = Math.hypot(tx, ty) || 1;
    nor.push({ x: -ty / L, y: tx / L });
  }

  const count = Math.max(2, Math.round(total / blockLen));
  const len = total / count;

  // Muestreo a longitud de arco `s`. `seg` solo avanza (s es monótona).
  let seg = 0;
  const at = (s) => {
    while (seg < n - 2 && cum[seg + 1] < s) seg++;
    const a = cum[seg];
    const b = cum[seg + 1];
    const f = b > a ? (s - a) / (b - a) : 0;
    return {
      x: pts[seg].x + (pts[seg + 1].x - pts[seg].x) * f,
      y: pts[seg].y + (pts[seg + 1].y - pts[seg].y) * f,
      nx: nor[seg].x + (nor[seg + 1].x - nor[seg].x) * f,
      ny: nor[seg].y + (nor[seg + 1].y - nor[seg].y) * f,
    };
  };

  const SUB = 3; // sub-muestras por bloque (para que siga la curva)
  const out = [];
  for (let k = 0; k < count; k += 2) {
    const s0 = k * len;
    const s1 = Math.min(total, (k + 1) * len);
    const inner = [];
    const outer = [];
    for (let m = 0; m <= SUB; m++) {
      const p = at(s0 + ((s1 - s0) * m) / SUB);
      const nl = Math.hypot(p.nx, p.ny) || 1;
      const ux = (p.nx / nl) * halfW;
      const uy = (p.ny / nl) * halfW;
      inner.push(`${p.x - ux},${p.y - uy}`);
      outer.push(`${p.x + ux},${p.y + uy}`);
    }
    const ring = inner.concat(outer.reverse());
    out.push(`M${ring[0]}L${ring.slice(1).join('L')}Z`);
  }
  return out.join('');
}

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

// memo + useMemo: la geometría de la pista es fija durante toda la vuelta, pero
// el componente se re-renderizaba en CADA frame (al moverse el coche) y volvía
// a construir todas las cadenas de puntos. Ahora se calcula una sola vez.
const TrackLayer = memo(function TrackLayer({ track, showDebug, wet }) {
  const asphalt = wet ? '#181f29' : ROAD.asphalt; // asfalto más oscuro/frío mojado

  const geom = useMemo(() => ({
    road: track.roadPolygon.map((p) => `${p.x},${p.y}`).join(' '),
    lane: track.center.map((p) => `${p.x},${p.y}`).join(' '),
    edgeL: track.left.map((p) => `${p.x},${p.y}`).join(' '),
    edgeR: track.right.map((p) => `${p.x},${p.y}`).join(' '),
    kerbL: kerbPath(track.left, KERB_BLOCK, KERB_W / 2),
    kerbR: kerbPath(track.right, KERB_BLOCK, KERB_W / 2),
    checks: checkeredQuads(track.finish),
  }), [track]);

  return (
    <G>
      {/* Asfalto */}
      <Polygon points={geom.road} fill={asphalt} />
      {/* Piano rojo/blanco: base blanca por BORDE (no por el contorno cerrado,
          que cruzaba la pista por salida y meta) + tramos rojos explícitos. */}
      <Polyline points={geom.edgeL} fill="none" stroke={ROAD.kerbWhite} strokeWidth={KERB_W} strokeLinejoin="round" />
      <Polyline points={geom.edgeR} fill="none" stroke={ROAD.kerbWhite} strokeWidth={KERB_W} strokeLinejoin="round" />
      <Path d={geom.kerbL} fill={ROAD.kerbRed} />
      <Path d={geom.kerbR} fill={ROAD.kerbRed} />
      {/* Línea de carril discontinua */}
      <Polyline points={geom.lane} fill="none" stroke={ROAD.lane} strokeWidth={2} strokeDasharray="10,16" opacity={0.7} />
      {/* Salida (sutil, dorada) */}
      <Line
        x1={track.startLine.a.x} y1={track.startLine.a.y}
        x2={track.startLine.b.x} y2={track.startLine.b.y}
        stroke={ROAD.start} strokeWidth={3} opacity={0.85}
      />
      {/* Meta a cuadros */}
      {geom.checks.map((q, i) => (
        <Polygon key={i} points={q.p} fill={q.color} />
      ))}
      {showDebug && (
        <G>
          <Polyline points={geom.edgeL} fill="none" stroke="#ff5a3c" strokeWidth={1} />
          <Polyline points={geom.edgeR} fill="none" stroke="#ff5a3c" strokeWidth={1} />
          <Polyline points={geom.lane} fill="none" stroke="#4ad6ff" strokeWidth={1} />
        </G>
      )}
    </G>
  );
});

// Coche cenital estilo Porsche 911 GT3 RS: morro afilado, aletas traseras
// anchas, gran alerón "cuello de cisne", splitter y faros redondos. El eje
// local +x apunta al morro. La carrocería usa `color` (personalizable en el
// futuro); los detalles son fijos.
const CAR_BODY =
  'M16,0 C15,-4 13,-6.5 10,-7.2 C6,-7.8 2,-7.2 -2,-7.6 ' +
  'C-6,-8 -9,-8.6 -12,-8.2 C-14,-7.9 -15.5,-6 -16,0 ' +
  'C-15.5,6 -14,7.9 -12,8.2 C-9,8.6 -6,8 -2,7.6 ' +
  'C2,7.2 6,7.8 10,7.2 C13,6.5 15,4 16,0 Z';

function CarSprite({ x, y, deg, color }) {
  return (
    <G transform={`rotate(${deg} ${x} ${y}) translate(${x} ${y})`}>
      {/* Alerón trasero "cuello de cisne": montante + plano ancho + derivas */}
      <Rect x={-16.5} y={-4} width={3.6} height={8} rx={1} fill="#0f1218" />
      <Rect x={-18.6} y={-10.8} width={3.6} height={21.6} rx={1.6} fill="#0f1218" />
      <Rect x={-18.9} y={-11.2} width={5.2} height={2.4} rx={1} fill="#0f1218" />
      <Rect x={-18.9} y={8.8} width={5.2} height={2.4} rx={1} fill="#0f1218" />
      {/* Carrocería */}
      <Path d={CAR_BODY} fill={color} />
      {/* Rejilla del motor (trasera) */}
      <Rect x={-12} y={-4.6} width={8} height={9.2} rx={2} fill="rgba(0,0,0,0.18)" />
      {/* Cabina / cristales */}
      <Rect x={-1} y={-4.8} width={9} height={9.6} rx={3.4} fill="#1b2733" />
      {/* Splitter delantero (sobresale del morro) */}
      <Rect x={13.6} y={-6.6} width={2.6} height={13.2} rx={1} fill="#0f1218" />
      {/* Faros */}
      <Circle cx={11.4} cy={-5} r={1.7} fill="#fff6cf" />
      <Circle cx={11.4} cy={5} r={1.7} fill="#fff6cf" />
    </G>
  );
}

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
    trackIdx: 0,     // último tramo conocido de la línea central (búsqueda local)
    touching: false, // ¿pegado al muro ahora mismo? (para no recontar el choque)
    stunUntil: 0,
    flashUntil: 0,
    startTime: 0,
    lastTime: 0,
    acc: 0, // acumulador del paso fijo de física
    fps: 0, fpsCount: 0, fpsTime: 0, // medición de FPS (diagnóstico de beta)
    elapsed: 0,
    reported: false, // ¿ya avisamos del final?
  };
}

function toView(s, flash, ghost) {
  return { x: s.x, y: s.y, heading: s.heading, camAngle: s.camAngle, elapsed: s.elapsed, phase: s.phase, flash, ghost, fps: s.fps };
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

  const near = nearestOnPolyline(track.center, s.x, s.y, s.trackIdx, TRACK_WINDOW);
  s.trackIdx = near.idx;
  const radius = near.w - C.CAR_WIDTH / 2;
  if (near.dist > radius) {
    const inv = near.dist || 1;
    const nx = (near.x - s.x) / inv;
    const ny = (near.y - s.y) / inv;
    s.x = near.x - nx * radius;
    s.y = near.y - ny * radius;
    const vn = vx * nx + vy * ny;
    if (vn < 0) {
      // ¿Impacto NUEVO o seguimos rozando el mismo muro? Se decide por CONTACTO
      // (flag s.touching), no por tiempo: con un temporizador, ir rozando la
      // pared contaba como choque nuevo cada 230 ms y encadenaba castigos.
      const fresh = !s.touching;
      s.touching = true;

      // Cuán DE FRENTE llegas al muro: 0 = paralelo (roce), 1 = perpendicular.
      const head = s.speed > 1 ? Math.min(1, -vn / s.speed) : 0;

      if (fresh && head > C.CRASH_MIN_IMPACT) {
        // CHOQUE de verdad: rebota, castiga y aturde.
        const k = (1 + C.CRASH_BOUNCE) * vn;
        const rvx = vx - k * nx;
        const rvy = vy - k * ny;
        s.speed = Math.hypot(rvx, rvy) * (1 - C.CRASH_SPEED_LOSS);
        if (rvx !== 0 || rvy !== 0) s.heading = Math.atan2(rvy, rvx);
        s.stunUntil = t + C.CRASH_STUN_MS;
        s.flashUntil = t + 140;
        s.lastImpact = t;
      } else {
        // ROCE: el coche ya ha quedado recolocado sobre el borde (desliza), y
        // aquí NO se toca el rumbo. Es la diferencia clave: como la velocidad
        // va siempre en la dirección del rumbo, reescribirlo mientras rozas
        // significaba que en una curva larga el muro te llevaba a ti y las
        // pulsaciones no hacían nada. Ahora conservas el control y puedes
        // salir girando; el castigo es de velocidad, no de dirección.
        //   WALL_DRAG  = arrastre, siempre que toques (aunque vayas paralelo)
        //   WALL_SCRUB = extra según lo de frente que llegues
        s.speed *= Math.max(0, 1 - (C.WALL_DRAG + C.WALL_SCRUB * head) * dt);
      }
    }
  } else if (near.dist < radius - C.WALL_RELEASE) {
    // Se ha separado del muro con margen: el próximo toque sí es un choque
    // nuevo. El margen evita que el ruido numérico lo reactive mientras rozas.
    s.touching = false;
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
  touchZone: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  hint: { position: 'absolute', top: 0, bottom: 0, textAlign: 'center', textAlignVertical: 'center', fontSize: 64, color: 'rgba(255,255,255,0.10)', fontWeight: '800' },
  hintLeft: { left: 0 },
  hintRight: { right: 0 },
  startPanel: {
    position: 'absolute', left: 24, right: 24, bottom: 46, alignItems: 'center',
    backgroundColor: 'rgba(13,15,19,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 18, paddingVertical: 16, paddingHorizontal: 18,
  },
  startTitle: { color: '#ffffff', fontSize: 20, fontWeight: '800', letterSpacing: 0.3 },
  startSub: { color: 'rgba(255,255,255,0.62)', fontSize: 13, marginTop: 6 },
  startMeta: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' },
  startTag: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  startTagText: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '700' },
  startTagWx: { backgroundColor: 'rgba(255,184,77,0.16)' },
  startTagWxText: { color: '#ffb84d', fontSize: 12, fontWeight: '700' },
  wxPill: {
    position: 'absolute', top: 12, right: 12,
    backgroundColor: 'rgba(13,15,19,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6,
  },
  wxPillText: { color: '#ecebe5', fontSize: 13, fontWeight: '700' },
  fpsPill: {
    position: 'absolute', top: 12, left: 12,
    backgroundColor: 'rgba(13,15,19,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  fpsText: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  hud: {
    position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 18,
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#151a26',
  },
  hudSide: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  timer: { color: '#ffffff', fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] },
  hudBtn: { backgroundColor: '#2a3242', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  hudBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
});

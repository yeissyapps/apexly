// ============================================================================
//  Game — la pantalla jugable (física, cámara, colisión ya validadas).
//
//  Recibe el circuito ya construido por `track`, avisa con `onFinish(ms)` al meta
//  (una sola vez) y con `onExit()` para volver a Inicio. NO contiene lógica de
//  backend ni de resultados: eso lo maneja App.js.
// ============================================================================

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Dimensions, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Svg, { G, Line, Path, Polygon, Polyline, Rect, Circle } from 'react-native-svg';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CONFIG } from './config';
import { fmt } from './format';
import { NEUTRAL } from './weather';
import WeatherFX from './WeatherFX';
import { RD, RD_FONT } from './theme';
import CarSprite from './CarSprite';
import { CAR_DEFAULTS } from './car';

const now = () => Date.now();
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Crono en dos tonos (grande + centésimas atenuadas): parte entera+punto vs
// los 2 dígitos finales de fmt(), p. ej. "22." + "41".
function fmtMain(ms) {
  const s = fmt(ms);
  return s.slice(0, s.length - 2);
}
function fmtFrac(ms) {
  const s = fmt(ms);
  return s.slice(-2);
}

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

// Cabecera del rediseño "Parrilla": fila de crono + barra de sectores + label,
// todo dentro del mismo panel opaco (antes la barra de sectores flotaba
// encima de la pista) — por eso ahora reserva más alto que antes. El inset
// superior real (notch / dynamic island / cámara) se suma aparte con
// useSafeAreaInsets(), no es un número fijo — ver dentro del componente.
const HUD_CONTENT_H = 122;

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

// --- Sectores (barra de progreso + comparación con el fantasma / el mundo) -
const SECTOR_COUNT = 3;

// ¿En qué sector cae el punto `idx` de la línea central? (0..SECTOR_COUNT-1)
function sectorOfIdx(idx, totalPoints) {
  const s = Math.floor((idx / Math.max(1, totalPoints - 1)) * SECTOR_COUNT);
  return clamp(s, 0, SECTOR_COUNT - 1);
}

// Convierte la traza del fantasma [[t,x,y,h],...] en una tabla progreso->tiempo:
// para cada muestra, en qué punto de la línea central estaba (nearestOnPolyline)
// y a qué tiempo. Se hace UNA VEZ al cargar el fantasma (no en el bucle de
// física) y se fuerza monótona en idx (un fantasma real solo avanza; cualquier
// ruido de la búsqueda más cercana no debe hacer que la tabla vaya hacia atrás,
// o la búsqueda binaria de abajo daría resultados inconsistentes).
function buildGhostProgress(trace, track) {
  if (!trace || trace.length === 0) return null;
  const out = [];
  let hint = 0;
  let lastIdx = 0;
  for (let i = 0; i < trace.length; i++) {
    const [t, x, y] = trace[i];
    const near = nearestOnPolyline(track.center, x, y, hint, TRACK_WINDOW);
    hint = near.idx;
    const idx = Math.max(lastIdx, near.idx);
    lastIdx = idx;
    out.push({ idx, t });
  }
  return out;
}

// Tiempo (ms) al que el fantasma pasó por el punto `idx` de la línea central,
// interpolando entre las dos muestras más cercanas de la tabla. `progress` es
// el resultado de buildGhostProgress(); null si no hay fantasma todavía.
function ghostTimeAtIdx(progress, idx) {
  if (!progress || progress.length === 0) return null;
  if (idx <= progress[0].idx) return progress[0].t;
  if (idx >= progress[progress.length - 1].idx) return progress[progress.length - 1].t;
  let lo = 0, hi = progress.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (progress[mid].idx <= idx) lo = mid; else hi = mid;
  }
  const a = progress[lo], b = progress[hi];
  const span = b.idx - a.idx || 1;
  const f = (idx - a.idx) / span;
  return a.t + (b.t - a.t) * f;
}

// --- Grabadora de diagnóstico (solo beta; quitar al cerrar el caso) ---------
// Búfer circular con los últimos frames. Con una sola foto del instante no se
// ve CÓMO se llegó al fallo: aquí queda la secuencia de entradas y estado.
// Se usa un Float64Array preasignado en vez de ir creando objetos por frame,
// para no meter presión de basura justo en el bucle que estamos midiendo.
// 20 s a 120 fps (subido de 6s): el episodio de la horquilla es más largo que
// el caso original que calibró los 6s — el giro sostenido en sí ya son unos
// segundos, más soltar, más los "latigazos" que describe JC, más su tiempo de
// reacción hasta pulsar el botón. Mejor sobrar margen que perder el disparo.
const REC_N = 2400;
const REC_FIELDS = 9;    // t, entrada, volante, velocidad, rumbo, muro, dt, dedos, ambos
const TOUCH_LOG_N = 150; // últimos eventos táctiles en crudo (solo con DIAG)

const SCREEN = Dimensions.get('window');

export default function Game({ track, ghost, weather, sectorBests, attemptsLeft = Infinity, loadout, onAttemptStart, onNeedMore, onFinish, onExit }) {
  const insets = useSafeAreaInsets();
  const HUD_H = insets.top + HUD_CONTENT_H;
  const playW = SCREEN.width;
  const playH = SCREEN.height - HUD_H;
  const wx = weather || NEUTRAL;

  const g = useRef(null);
  const pressLeft = useRef(false);
  const pressRight = useRef(false);
  const dedos = useRef(0); // nº de dedos apoyados en el último evento (diagnóstico)
  // Orden final que recibe la física: -1 izq, 0 nada, 1 der. Se calcula UNA vez
  // por evento táctil (no en la física) para que "izq+der a la vez" se resuelva
  // en un solo sitio. Ver applyTouches.
  const entrada = useRef(0);
  const ultimoLado = useRef(0); // último lado que pasó de suelto a pulsado
  // Pulso mínimo garantizado por toque (ver applyTouches).
  const pulsoDir = useRef(0);
  const pulsoHasta = useRef(0);
  const entradaEfectiva = useRef(0); // lo que realmente lee la física
  const rec = useRef(new Float64Array(REC_N * REC_FIELDS)); // grabadora (beta)
  const recAt = useRef(0); // nº total de frames escritos (el índice va en módulo)
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const ghostRef = useRef(ghost);
  ghostRef.current = ghost;
  const weatherRef = useRef(wx);
  weatherRef.current = wx;
  const sectorBestsRef = useRef(sectorBests);
  sectorBestsRef.current = sectorBests;
  const traceRef = useRef([]); // grabación de la vuelta actual
  const lastSampleRef = useRef(-999);
  const ghostIdxRef = useRef(0);
  // Tabla progreso->tiempo del fantasma, para el delta en vivo y los splits de
  // sector. Se recalcula solo cuando cambia la traza (no en el bucle de física).
  const ghostProgressRef = useRef(null);
  useEffect(() => {
    ghostProgressRef.current = ghost ? buildGhostProgress(ghost, track) : null;
  }, [ghost, track]);

  const [view, setView] = useState(null);
  const [snap, setSnap] = useState(null); // foto de diagnóstico (solo beta)

  function resetRun() {
    traceRef.current = [];
    lastSampleRef.current = -999;
    ghostIdxRef.current = 0;
    recAt.current = 0; // la grabación es por intento
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

  // Volante SIN ESTADO PROPIO: en cada evento se recalcula desde la lista de
  // dedos activos que da el sistema. Antes se mantenía un Map por identifier
  // (añadir al tocar, borrar al levantar) y eso tiene un fallo grave: si se
  // pierde un evento de "levantar", o llega con otro identifier, la entrada se
  // queda ahí PARA SIEMPRE y el coche gira solo como si tuvieras el dedo
  // apoyado — justo lo que pasaba dando toquecitos rápidos. Sin estado propio,
  // ese fallo no puede existir: cada evento parte de cero.
  //
  // El matiz de iOS: en un evento de levantar, `touches` puede seguir
  // incluyendo el dedo que se acaba de soltar (Android lo excluye), así que se
  // descuenta explícitamente lo que venga en `changedTouches`.
  //
  // POR QUÉ ESTO FALLA EN iOS Y NO EN ANDROID (la asimetría de fondo):
  // el volante no tiene estado propio, se recalcula en cada evento. Pero
  // ANDROID manda `onResponderMove` continuamente (reporta hasta el micro-
  // temblor del dedo), así que si un evento deja el estado mal, el siguiente
  // lo corrige a los milisegundos y no lo llegas a notar. iOS NO manda nada
  // mientras el dedo está quieto: si un evento deja el estado mal, se queda
  // mal HASTA QUE LEVANTES EL DEDO. Y "dedo quieto mucho rato" es exactamente
  // una horquilla hecha del tirón — de ahí que falle justo ahí y solo en iOS.
  //
  // El estado malo que más duele es "izq y der pulsadas a la vez": la física
  // hacía -1+1 = 0, o sea VOLANTE MUERTO. Con un dedo fantasma en un lado y el
  // dedo real en el otro, el coche se va recto toda la horquilla por mucho que
  // aprietes. Por eso aquí gana EL ÚLTIMO LADO PULSADO en vez de anularse:
  // un fantasma ya no puede dejarte sin volante.
  function applyTouches(evt, esFinDeToque) {
    const ne = evt.nativeEvent;
    const activos = ne.touches || [];
    const soltados = esFinDeToque ? (ne.changedTouches || []) : null;

    let left = false;
    let right = false;
    let n = 0;
    for (let i = 0; i < activos.length; i++) {
      const tq = activos[i];
      if (soltados) {
        let yaSoltado = false;
        for (let j = 0; j < soltados.length; j++) {
          if (soltados[j].identifier === tq.identifier) { yaSoltado = true; break; }
        }
        if (yaSoltado) continue;
      }
      n++;
      if (tq.pageX < playW / 2) left = true;
      else right = true;
    }
    // ¿Qué lado acaba de pasar de suelto a pulsado? (comparar ANTES de asignar)
    if (left && !pressLeft.current) ultimoLado.current = -1;
    if (right && !pressRight.current) ultimoLado.current = 1;

    pressLeft.current = left;
    pressRight.current = right;
    dedos.current = n;

    // Resolución del volante. El caso "los dos a la vez" NO se anula: manda el
    // último lado que pulsaste, que es el que de verdad estás pidiendo.
    if (left && right) entrada.current = ultimoLado.current || -1;
    else if (left) entrada.current = -1;
    else if (right) entrada.current = 1;
    else entrada.current = 0;

    // PULSO MÍNIMO POR TOQUE.
    // Medido en grabaciones reales de iOS: la MITAD de los toques llegan con
    // GRANT y END en el mismo frame, o sea que el sistema dice que el dedo
    // estuvo apoyado menos de 16 ms. 18 de 37 toques en una vuelta. Eso es lo
    // de "toco y el coche no responde, solo si aprieto fuerte" — apretando, el
    // toque dura más y sobrevive.
    //
    // No sabemos POR QUÉ iOS los reporta así (la dirección siempre llega bien,
    // eso está comprobado), pero da igual: si el jugador ha tocado, la orden
    // tiene que valer. Aquí se garantiza que todo toque mande durante al menos
    // MIN_INPUT_MS aunque el dedo ya se haya levantado.
    //
    // Un solo frame NO basta: el volante tarda STEER_EASE_IN (0,1 s) en meterse
    // del todo, así que en un frame se queda en 0,17 de 1,00 y no gira nada.
    // Con 130 ms el volante llega a tope y el toque se nota de verdad.
    if (entrada.current !== 0) {
      pulsoDir.current = entrada.current;
      pulsoHasta.current = now() + CONFIG.MIN_INPUT_MS;
    }

    return left || right;
  }

  // --- Registro EN CRUDO de lo que entrega el sistema táctil -----------------
  // Lo que nunca hemos podido ver: qué manda iOS de verdad en cada evento.
  // Todo el volante se deduce de `nativeEvent.touches`, y si ese array llega
  // vacío o incompleto en algún evento, en iOS el estado se queda ASÍ hasta que
  // levantes el dedo (iOS no manda nada mientras el dedo está quieto, Android
  // manda `move` sin parar y lo corrige solo). Esto lo deja por escrito.
  const touchLog = useRef([]);
  function logTouch(tipo, ne) {
    if (!CONFIG.DIAG) return;
    const fmt = (arr) =>
      arr && arr.length
        ? Array.from(arr).map((x) => `${x.identifier}@${Math.round(x.pageX)}`).join(' ')
        : 'VACIO';
    const ms = (g.current && g.current.elapsed) || 0;
    const l = touchLog.current;
    l.push(
      `${(ms / 1000).toFixed(2)}s ${tipo}` +
        ` | touches(${(ne.touches || []).length}): ${fmt(ne.touches)}` +
        ` | changed(${(ne.changedTouches || []).length}): ${fmt(ne.changedTouches)}` +
        ` | -> izq:${pressLeft.current ? 1 : 0} der:${pressRight.current ? 1 : 0} orden:${entrada.current}`,
    );
    if (l.length > TOUCH_LOG_N) l.shift();
  }

  function onTouchGrant(evt) {
    if (applyTouches(evt, false)) startRun();
    logTouch('GRANT ', evt.nativeEvent);
  }

  function onTouchStart(evt) {
    if (applyTouches(evt, false)) startRun();
    logTouch('START ', evt.nativeEvent);
  }

  function onTouchMove(evt) {
    applyTouches(evt, false);
    logTouch('MOVE  ', evt.nativeEvent);
  }

  function onTouchEnd(evt) {
    applyTouches(evt, true);
    logTouch('END   ', evt.nativeEvent);
  }

  function onTouchRelease(evt) {
    applyTouches(evt, true);
    logTouch('RELEAS', evt.nativeEvent);
  }

  function onTouchCancel(evt) {
    pressLeft.current = false;
    pressRight.current = false;
    dedos.current = 0;
    entrada.current = 0;
    ultimoLado.current = 0;
    if (evt && evt.nativeEvent) logTouch('TERMIN', evt.nativeEvent);
  }

  // --- Marcar anomalía (solo beta) -----------------------------------------
  // Congela una foto del estado en el instante en que el jugador ve el fallo.
  // Incluye los PEORES valores de toda la vuelta porque, para cuando pulsa, la
  // anomalía puede haber pasado ya. Lo más revelador es "volante" e "dedos":
  // si el jugador NO está tocando y ahí sigue marcando izq/der, el problema es
  // el táctil; si los FPS/sub-pasos están disparados, es rendimiento.
  function marcar() {
    const s = g.current;
    if (!s) return;
    setSnap({
      t: (s.elapsed / 1000).toFixed(2),
      fps: s.fps,
      fpsMin: s.fpsMin,
      dtMax: Math.round(s.dtMax * 1000),
      steps: s.stepsMax,
      capped: s.stepsCapped,
      dedos: dedos.current,
      izq: pressLeft.current,
      der: pressRight.current,
      steer: s.steer.toFixed(2),
      vel: Math.round(s.speed),
      muro: s.touching,
      golpes: s.impacts,
      pegado: Math.round(s.contactMs),
    });
  }

  // Vuelca la grabación en texto plano para poder mandarla. En una captura no
  // caben 700 filas, y lo interesante es justo la SECUENCIA previa al fallo:
  // qué se pulsó, qué hizo el volante y cómo respondió el coche.
  //
  // Se antepone un ÍNDICE DE EVENTOS (cambios de pulsación, entradas/salidas de
  // muro y volantazos) para poder ir directo a los momentos interesantes sin
  // leer la tabla entera.
  function compartirGrabacion() {
    const b = rec.current;
    const total = recAt.current;
    const n = Math.min(total, REC_N);
    const desde = total - n;
    const filas = [];
    const eventos = [];
    let prevIn = null;
    let prevMuro = null;
    let prevRumbo = null;
    let prevFantasma = false;
    let prevAmbos = 0;
    const nombreIn = (v) => (v === -1 ? 'IZQ' : v === 1 ? 'DER' : 'suelta');

    for (let k = 0; k < n; k++) {
      const o = ((desde + k) % REC_N) * REC_FIELDS;
      const t = b[o] / 1000;
      const inp = b[o + 1];
      const muro = b[o + 5] ? 1 : 0;
      const rumbo = b[o + 4];
      const nDedos = b[o + 7];
      const ambos = b[o + 8] ? 1 : 0;

      // EL CASO DELATOR: el coche recibe orden de girar con CERO dedos en
      // pantalla. Si esto aparece, el bug es del táctil, no de la física.
      const fantasma = nDedos === 0 && inp !== 0;
      if (fantasma && !prevFantasma) eventos.push(`${t.toFixed(2)}s  *** GIRO FANTASMA (0 dedos, orden ${nombreIn(inp)}) ***`);
      prevFantasma = fantasma;

      // EL OTRO CASO DELATOR (invisible hasta ahora): izq y der marcadas a la
      // vez. Con un solo dedo en pantalla, significa dedo fantasma en el otro
      // lado — la causa candidata de "aprieto y no gira" en las horquillas.
      if (ambos && !prevAmbos) eventos.push(`${t.toFixed(2)}s  *** IZQ+DER A LA VEZ (dedos ${nDedos}) ***`);
      prevAmbos = ambos;

      if (prevIn !== null && inp !== prevIn) {
        eventos.push(`${t.toFixed(2)}s  ${nombreIn(prevIn)} -> ${nombreIn(inp)}  (dedos ${nDedos})`);
      }
      if (prevMuro !== null && muro !== prevMuro) {
        eventos.push(`${t.toFixed(2)}s  ${muro ? 'TOCA muro' : 'sale del muro'}`);
      }
      if (prevRumbo !== null) {
        let d = rumbo - prevRumbo;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        if (Math.abs(d) > 20) eventos.push(`${t.toFixed(2)}s  VOLANTAZO ${d.toFixed(0)}°`);
      }
      prevIn = inp; prevMuro = muro; prevRumbo = rumbo;

      filas.push(
        [
          t.toFixed(2),                    // t (s)
          inp === -1 ? 'IZQ' : inp === 1 ? 'DER' : '-', // qué se pulsa
          b[o + 2].toFixed(2),             // volante
          Math.round(b[o + 3]),            // velocidad
          Math.round(rumbo),               // rumbo
          muro ? 'MURO' : '-',             // contacto
          b[o + 6].toFixed(1),             // dt del frame (ms)
          nDedos,                          // dedos apoyados
          ambos ? 'AMBOS' : '-',           // izq y der marcadas a la vez
        ].join('\t'),
      );
    }
    const s = g.current || {};
    const marcadoEn = n > 0 ? (b[((total - 1) % REC_N) * REC_FIELDS] / 1000).toFixed(2) : '?';
    const cab = [
      `Apexly · grabación de ${n} frames · marcado en ${marcadoEn}s`,
      `fps ${s.fps} (mín ${s.fpsMin}) · frame máx ${Math.round((s.dtMax || 0) * 1000)}ms`,
      `sub-pasos máx ${s.stepsMax} · frames al límite ${s.stepsCapped}`,
      `golpes ${s.impacts} · pegado ${Math.round(s.contactMs || 0)}ms`,
      '',
      `EVENTOS (${eventos.length}):`,
      eventos.length ? eventos.join('\n') : '  (ninguno)',
      '',
      't\tpulsa\tvolante\tvel\trumbo\tmuro\tdt\tdedos\tambos',
    ].join('\n');
    // Lo que entregó el sistema táctil en crudo. Es la pieza que nos faltaba:
    // dice si el problema entra ya mal por la puerta (touches vacío/incompleto)
    // o si el táctil está bien y el fallo es de la física.
    const tl = touchLog.current;
    const cola = tl.length
      ? `\n\nEVENTOS TÁCTILES EN CRUDO (${tl.length}):\n${tl.join('\n')}`
      : '';
    Share.share({ message: `${cab}\n${filas.join('\n')}${cola}` }).catch(() => {});
  }

  useEffect(() => {
    resetRun();
    g.current = initialState(track);
    pressLeft.current = false;
    pressRight.current = false;
    dedos.current = 0;
    entrada.current = 0;
    ultimoLado.current = 0;
    pulsoDir.current = 0;
    pulsoHasta.current = 0;
    entradaEfectiva.current = 0;
    touchLog.current = [];
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
        const wasTouching = s.touching;
        // Si el dedo sigue apoyado manda lo que hay. Si ya se levantó, sigue
        // mandando el pulso mínimo hasta que se agote (ver applyTouches).
        entradaEfectiva.current =
          entrada.current !== 0
            ? entrada.current
            : t < pulsoHasta.current
              ? pulsoDir.current
              : 0;
        while (s.acc >= FIXED_DT && guard < 10) {
          stepSimulation(s, FIXED_DT, t, track, entradaEfectiva, weatherRef.current, ghostProgressRef.current, sectorBestsRef.current);
          s.acc -= FIXED_DT;
          guard++;
          if (s.phase !== 'running') break;
        }
        if (guard > s.stepsMax) s.stepsMax = guard;
        if (guard >= 10) s.stepsCapped++; // se descartó tiempo: el móvil no da más
        if (s.touching) s.contactMs += dt * 1000;
        if (s.touching && !wasTouching) s.impacts++;
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
          if (onFinishRef.current) onFinishRef.current(s.elapsed, tr, s.sectorSplits, s.impacts, s.sectorColors, s.sectorDeltas);
        }
      }

      // FPS reales, para diagnosticar en beta si el rendimiento se degrada
      // entre intentos (JC: "cada intento va peor que el anterior").
      s.fpsCount++;
      if (t - s.fpsTime >= 500) {
        s.fps = Math.round((s.fpsCount * 1000) / (t - s.fpsTime));
        if (s.fps > 0 && (s.fpsMin === 0 || s.fps < s.fpsMin)) s.fpsMin = s.fps;
        s.fpsCount = 0;
        s.fpsTime = t;
      }
      // Peores valores de TODA la vuelta: cuando el jugador pulsa el botón de
      // marcar, la anomalía puede haber pasado ya.
      if (dt > s.dtMax) s.dtMax = dt;

      // Grabadora: una fila por frame en el búfer circular.
      {
        const o = (recAt.current % REC_N) * REC_FIELDS;
        const b = rec.current;
        b[o] = s.elapsed;
        // OJO: aquí antes se guardaba der(1) - izq(1), así que "las dos a la
        // vez" se grababa como 0, IDÉNTICO a "no estoy tocando" — el bug más
        // probable era justo el invisible en la grabación. Ahora va la orden
        // real y un flag aparte de si había dos lados pulsados.
        b[o + 1] = entradaEfectiva.current;
        b[o + 2] = s.steer;
        b[o + 3] = s.speed;
        b[o + 4] = (s.heading * 180) / Math.PI;
        b[o + 5] = s.touching ? 1 : 0;
        b[o + 6] = dt * 1000;
        b[o + 7] = dedos.current;
        b[o + 8] = pressLeft.current && pressRight.current ? 1 : 0;
        recAt.current++;
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
  const carLoadout = {
    ...CAR_DEFAULTS,
    ...loadout,
    bodyColor: view.flash ? '#ff5a3c' : (loadout?.bodyColor || CAR_DEFAULTS.bodyColor),
  };

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
            <CarSprite x={view.x} y={view.y} deg={carDeg} loadout={carLoadout} />
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
          onResponderGrant={onTouchGrant}
          onResponderStart={onTouchStart}
          onResponderMove={onTouchMove}
          onResponderEnd={onTouchEnd}
          onResponderRelease={onTouchRelease}
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

        {/* Recordatorio de las zonas táctiles — no ocupa alto propio, va
            superpuesto sobre el borde inferior de la pista. Oculto en reposo:
            el panel "Toca para arrancar" ya lleva su propio texto y se solapan. */}
        {view.phase !== 'ready' && (
          <View pointerEvents="none" style={[rd.footer, { bottom: insets.bottom + 12 }]}>
            <Text style={rd.footerText}>IZQUIERDA GIRA ‹ · DERECHA GIRA ›</Text>
          </View>
        )}

        {/* FPS — solo con CONFIG.DIAG */}
        {CONFIG.DIAG && (
          <View pointerEvents="none" style={styles.fpsPill}>
            <Text style={styles.fpsText}>{view.fps} fps</Text>
          </View>
        )}

        {/* Foto de diagnóstico al marcar una anomalía (solo con CONFIG.DIAG) */}
        {CONFIG.DIAG && snap && (
          <View style={styles.snapPanel}>
            <Text style={styles.snapTitle}>Marcado en {snap.t}s</Text>
            <Text style={styles.snapRow}>
              fps {snap.fps} (mín {snap.fpsMin}) · frame máx {snap.dtMax}ms
            </Text>
            <Text style={[styles.snapRow, (snap.steps >= 10 || snap.capped > 0) && styles.snapBad]}>
              sub-pasos máx {snap.steps} · frames al límite {snap.capped}
            </Text>
            <Text style={[styles.snapRow, (snap.dedos === 0 && (snap.izq || snap.der)) && styles.snapBad]}>
              dedos {snap.dedos} · izq {snap.izq ? 'SÍ' : 'no'} · der {snap.der ? 'SÍ' : 'no'} · volante {snap.steer}
            </Text>
            <Text style={styles.snapRow}>
              vel {snap.vel} · muro {snap.muro ? 'SÍ' : 'no'} · golpes {snap.golpes} · pegado {snap.pegado}ms
            </Text>
            <View style={styles.snapBtns}>
              <Pressable style={styles.snapBtn} onPress={compartirGrabacion} hitSlop={8}>
                <Text style={styles.snapBtnText}>Enviar grabación</Text>
              </Pressable>
              <Pressable style={styles.snapBtn} onPress={() => setSnap(null)} hitSlop={8}>
                <Text style={styles.snapBtnText}>Cerrar</Text>
              </Pressable>
            </View>
          </View>
        )}

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

      {/* Cabecera "Parrilla": crono + barra de sectores + label, todo dentro
          del mismo panel opaco (antes la barra de sectores flotaba encima de
          la pista, ahora reserva su propio alto — ver HUD_CONTENT_H). */}
      <View style={[rd.hud, { height: HUD_H, paddingTop: insets.top }]}>
        <View style={rd.hudTopRow}>
          <View style={rd.hudSide}>
            {view.phase === 'ready' && (
              <Pressable onPress={onExit} hitSlop={10}>
                <Text style={rd.exitText}>‹ SALIR</Text>
              </Pressable>
            )}
          </View>
          <Text style={rd.timer}>
            {fmtMain(view.elapsed)}<Text style={rd.timerFrac}>{fmtFrac(view.elapsed)}</Text>
          </Text>
          <View style={[rd.hudSide, { justifyContent: 'flex-end', gap: 8 }]}>
            <View style={rd.wxBadge}>
              <Text style={rd.wxBadgeText}>{wx.label.toUpperCase()}</Text>
            </View>
            {/* Marcar anomalía — solo con CONFIG.DIAG. */}
            {CONFIG.DIAG && (
              <Pressable style={styles.flagBtn} onPress={marcar} hitSlop={12}>
                <Text style={styles.flagBtnText}>⚑</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* Morado = mejor del mundo hoy en ese sector, verde = mejoras tu
            fantasma, amarillo = no lo mejoras. Naranja = el que recorres
            ahora; gris = aún no llegas. */}
        <View style={rd.sectorBlock}>
          <View style={rd.sectorBar}>
            {Array.from({ length: SECTOR_COUNT }).map((_, i) => {
              const done = i < view.sector;
              const active = i === view.sector && view.phase === 'running';
              const color = done
                ? SECTOR_COLORS[view.sectorColors[i]] || SECTOR_COLORS.none
                : active ? SECTOR_COLORS.active : SECTOR_COLORS.pending;
              return <View key={i} style={[rd.sectorSeg, { backgroundColor: color }]} />;
            })}
          </View>
          <View style={rd.sectorLabelRow}>
            <Text style={rd.sectorLabel}>
              SECTOR {Math.min(view.sector + 1, SECTOR_COUNT)}/{SECTOR_COUNT}
            </Text>
            {view.phase !== 'ready' && view.ghostDeltaMs != null && (
              <Text style={[rd.sectorDelta, { color: view.ghostDeltaMs <= 0 ? RD.successGreen : RD.dangerRed }]}>
                {view.ghostDeltaMs <= 0 ? 'FANTASMA −' : 'FANTASMA +'}{Math.abs(view.ghostDeltaMs / 1000).toFixed(2)}
              </Text>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

const SECTOR_COLORS = {
  purple: '#b884ff',
  green: RD.successGreen,
  yellow: '#ffd83d',
  none: RD.cream,          // sector cerrado sin con qué compararlo
  pending: RD.panelBorder, // aún no llegas
  active: RD.brandOrange,  // el que estás recorriendo ahora
};

const rd = StyleSheet.create({
  hud: {
    position: 'absolute', top: 0, left: 0, right: 0,
    backgroundColor: RD.bg, borderBottomWidth: 1, borderBottomColor: RD.gridLine,
    paddingHorizontal: 16, paddingBottom: 14,
    justifyContent: 'space-between', // reparte el hueco sobrante entre crono y sectores
  },
  hudTopRow: { flexDirection: 'row', alignItems: 'center', height: 42 },
  hudSide: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  exitText: { color: RD.textSecondary, fontSize: 11, fontFamily: RD_FONT.mono },
  timer: {
    color: RD.textPrimary, fontSize: 30, lineHeight: 38, fontFamily: RD_FONT.monoBold,
    fontVariant: ['tabular-nums'], letterSpacing: 0.5,
  },
  timerFrac: { color: RD.textTertiary, fontSize: 16, lineHeight: 20 },
  wxBadge: { borderWidth: 1, borderColor: '#3a3a3a', paddingHorizontal: 6, paddingVertical: 3 },
  wxBadgeText: { color: RD.cream, fontSize: 11, fontFamily: RD_FONT.mono },

  sectorBlock: { marginTop: 8, gap: 6 },
  sectorBar: { flexDirection: 'row', gap: 2 },
  sectorSeg: { flex: 1, height: 5 },
  sectorLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectorLabel: { color: RD.textDisabled, fontSize: 11, fontFamily: RD_FONT.mono, letterSpacing: 0.5 },
  sectorDelta: { fontSize: 12, fontFamily: RD_FONT.monoBold, fontVariant: ['tabular-nums'] },

  footer: {
    position: 'absolute', left: 0, right: 0, paddingVertical: 6,
    backgroundColor: 'rgba(11,11,12,0.55)', alignItems: 'center',
  },
  footerText: { color: RD.textTertiary, fontSize: 10, fontFamily: RD_FONT.mono, letterSpacing: 1 },
});

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

// Línea de carril discontinua como geometría explícita (mismo motivo que
// kerbPath: `strokeDasharray` se rasteriza distinto en iOS, con bloques de
// tamaño desigual sobre todo en curva y al cerrar el patrón). Nº ENTERO de
// periodos dash+hueco para que cierre limpio sin trozo corto al final.
function dashedPath(pts, dashLen, gapLen) {
  const n = pts.length;
  if (n < 2) return '';
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = cum[n - 1];
  if (total <= 0) return '';

  let seg = 0;
  const at = (s) => {
    while (seg < n - 2 && cum[seg + 1] < s) seg++;
    const a = cum[seg], b = cum[seg + 1];
    const f = b > a ? (s - a) / (b - a) : 0;
    return { x: pts[seg].x + (pts[seg + 1].x - pts[seg].x) * f, y: pts[seg].y + (pts[seg + 1].y - pts[seg].y) * f };
  };

  const period = dashLen + gapLen;
  const count = Math.max(1, Math.round(total / period));
  const p = total / count; // periodo ajustado para encajar un nº entero exacto
  const dash = p * (dashLen / period);
  const SUB = 4; // sub-muestras por raya (para que siga la curva)
  const out = [];
  for (let k = 0; k < count; k++) {
    const s0 = k * p;
    const s1 = Math.min(total, s0 + dash);
    const raya = [];
    for (let m = 0; m <= SUB; m++) {
      const pt = at(s0 + ((s1 - s0) * m) / SUB);
      raya.push(`${pt.x},${pt.y}`);
    }
    out.push(`M${raya[0]}L${raya.slice(1).join('L')}`);
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
    lanePath: dashedPath(track.center, 10, 16),
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
      {/* Línea de carril discontinua (geometría explícita, no strokeDasharray:
          en iOS se rasterizaba con rayas de tamaño desigual, sobre todo cerca
          de meta — mismo motivo que el piano). */}
      <Path d={geom.lanePath} fill="none" stroke={ROAD.lane} strokeWidth={2} strokeLinecap="round" opacity={0.7} />
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
    // --- Diagnóstico de beta (quitar cuando esté cerrado) ---
    fps: 0, fpsCount: 0, fpsTime: 0,
    fpsMin: 0,      // peor FPS de la vuelta
    dtMax: 0,       // frame más largo (s)
    stepsMax: 0,    // máx. sub-pasos de física en un frame
    stepsCapped: 0, // frames donde se agotó el presupuesto (se perdió tiempo)
    impacts: 0,     // veces que se ha tocado muro
    contactMs: 0,   // tiempo total pegado al muro
    elapsed: 0,
    reported: false, // ¿ya avisamos del final?
    // --- Sectores ---
    bestTrackIdx: 0,       // máx. trackIdx visto (evita que un rebote haga retroceder la comparación con el fantasma)
    sector: 0,              // sector actual (0..SECTOR_COUNT-1)
    lastSectorElapsed: 0,   // tiempo (ms) al que se cerró el último sector
    sectorSplits: [],       // ms de cada sector ya completado
    sectorColors: [],       // 'purple'|'green'|'yellow'|null por sector completado
    sectorDeltas: [],       // ms vs el fantasma por sector (null si no había fantasma)
    ghostDeltaMs: null,     // delta en vivo contra el fantasma (null si no hay fantasma)
  };
}

function toView(s, flash, ghost) {
  return {
    x: s.x, y: s.y, heading: s.heading, camAngle: s.camAngle, elapsed: s.elapsed, phase: s.phase, flash, ghost, fps: s.fps,
    sector: s.sector, sectorColors: s.sectorColors, ghostDeltaMs: s.ghostDeltaMs, impacts: s.impacts,
  };
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
function stepSimulation(s, dt, t, track, entrada, weather, ghostProgress, sectorBests) {
  const C = CONFIG;
  const W = weather || NEUTRAL;

  // Cierra el sector `s.sector` en el instante `elapsedNow`, decidiendo el
  // color estilo F1: MORADO si es el mejor de ese sector hoy entre todos los
  // jugadores (no "más rápido que el líder", así funciona el morado real:
  // el mejor de la sesión, lo ponga quien lo ponga); si no, VERDE si mejoras
  // tu propio fantasma; si no, AMARILLO. Sin fantasma ni mejor mundial -> null
  // (se muestra el tiempo sin colorear).
  function closeSector(elapsedNow) {
    const total = track.center.length;
    const boundaryIdx = Math.round(((s.sector + 1) / SECTOR_COUNT) * (total - 1));
    const startIdx = Math.round((s.sector / SECTOR_COUNT) * (total - 1));
    const mySplit = elapsedNow - s.lastSectorElapsed;
    const ghostSplit = ghostProgress
      ? ghostTimeAtIdx(ghostProgress, boundaryIdx) - ghostTimeAtIdx(ghostProgress, startIdx)
      : null;
    const worldBest = sectorBests ? sectorBests[s.sector] : null;
    let color = null;
    if (worldBest != null && mySplit <= worldBest) color = 'purple';
    else if (ghostSplit != null) color = mySplit < ghostSplit ? 'green' : 'yellow';
    // Primera vuelta del día: no hay fantasma que batir, así que no hay nada
    // "peor" contra lo que perder — cuenta como mejora.
    else color = 'green';
    s.sectorSplits.push(mySplit);
    s.sectorColors.push(color);
    s.sectorDeltas.push(ghostSplit != null ? mySplit - ghostSplit : null);
    s.lastSectorElapsed = elapsedNow;
    s.sector++;
  }

  // Si hay que cerrar varios sectores de golpe (p. ej. la meta llega antes de
  // que el progreso por la línea central se ponga al día del último sector),
  // reparte el tiempo transcurrido a partes iguales en vez de darle 0 ms al
  // segundo sector en adelante — si no, ese sector queda "batido" con un
  // tiempo imposible que nadie puede superar el resto del día.
  function closeSectorsUpTo(upToSector, elapsedNow) {
    const remaining = upToSector - s.sector;
    if (remaining <= 0) return;
    const per = (elapsedNow - s.lastSectorElapsed) / remaining;
    for (let i = 0; i < remaining; i++) closeSector(s.lastSectorElapsed + per);
  }

  // Ya viene resuelto desde applyTouches (-1 / 0 / 1). Antes se sumaba aquí
  // izq(-1) + der(+1), y "las dos a la vez" daba 0: volante muerto.
  const target = entrada.current;

  const easeTime = (target !== 0 ? C.STEER_EASE_IN : C.STEER_EASE_OUT) * W.steerMul;
  const maxDelta = dt / Math.max(0.001, easeTime);
  s.steer += clamp(target - s.steer, -maxDelta, maxDelta);
  s.steer = clamp(s.steer, -1, 1);

  const cap = C.MAX_SPEED * W.speedMul;
  const turnBrake = C.TURN_SPEED_DRAG * Math.abs(s.steer);
  // El suelo solo actúa MIENTRAS giras: el frenado por volante nunca puede
  // dejarte parado a mitad de curva (a 0 u/s el coche pirueta sobre sí mismo).
  // Chocar y rozar sí siguen pudiendo bajarte de aquí: eso se aplica más abajo
  // y no pasa por este clamp.
  const floor = Math.abs(s.steer) > 0.01 ? Math.min(C.MIN_TURN_SPEED, cap) : 0;
  s.speed = clamp(s.speed + (C.ACCEL - turnBrake) * dt, floor, cap);

  const stunned = t < s.stunUntil;
  if (!stunned) {
    // El giro se define por el RADIO del arco, no por grados/segundo. Antes era
    // al revés (grados/segundo fijos, y encima MÁS altos cuanto más lento ibas),
    // así que al bajar la velocidad el radio se desplomaba y el coche trompeaba:
    // a 110 u/s daba un radio de 34, cuando la curva más cerrada del generador
    // tiene radio 72. Giraba tres veces más de lo que ninguna curva pide.
    //
    // Con omega = velocidad / radio, el coche describe SIEMPRE el mismo arco
    // vaya como vaya, y a velocidad 0 sencillamente no gira (no puede piruetear
    // sobre sí mismo, que era el otro fallo). A tope de velocidad da 143°/s,
    // exactamente lo mismo que la versión que iba bien.
    const speedFrac = cap > 0 ? s.speed / cap : 0;
    const radioGiro = C.TURN_RADIUS_SLOW + (C.TURN_RADIUS_FAST - C.TURN_RADIUS_SLOW) * speedFrac;
    const turnRateRad = s.speed / radioGiro; // rad/s
    s.heading += turnRateRad * s.steer * dt;
  }

  const vx = Math.cos(s.heading) * s.speed;
  const vy = Math.sin(s.heading) * s.speed;
  s.x += (vx + W.windX) * dt;
  s.y += (vy + W.windY) * dt;

  const near = nearestOnPolyline(track.center, s.x, s.y, s.trackIdx, TRACK_WINDOW);
  s.trackIdx = near.idx;

  if (s.phase === 'running') {
    s.bestTrackIdx = Math.max(s.bestTrackIdx, s.trackIdx);
    const elapsedNow = t - s.startTime;
    if (ghostProgress) s.ghostDeltaMs = elapsedNow - ghostTimeAtIdx(ghostProgress, s.bestTrackIdx);
    const newSector = sectorOfIdx(s.bestTrackIdx, track.center.length);
    closeSectorsUpTo(newSector, elapsedNow);
  }

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
        // El rumbo del rebote (billar, sin tope) puede girar 100-150° de golpe
        // en un impacto casi de frente — grabación real: +147° y -102° en un
        // solo frame, sin que el jugador tocara nada. Se tapa a CRASH_MAX_TURN
        // por rebote en vez de aplicar el ángulo de billar entero.
        if (rvx !== 0 || rvy !== 0) {
          const bounceHeading = Math.atan2(rvy, rvx);
          let dh = bounceHeading - s.heading;
          while (dh > Math.PI) dh -= 2 * Math.PI;
          while (dh < -Math.PI) dh += 2 * Math.PI;
          dh = Math.max(-C.CRASH_MAX_TURN, Math.min(C.CRASH_MAX_TURN, dh));
          s.heading += dh;
        }
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
    // La meta puede llegar antes de que bestTrackIdx alcance el último punto
    // exacto de la línea central (son dos criterios distintos) — cierra
    // cualquier sector que se hubiera quedado a medias con el tiempo final.
    closeSectorsUpTo(SECTOR_COUNT, s.elapsed);
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
  fpsPill: {
    position: 'absolute', top: 12, left: 12,
    backgroundColor: 'rgba(13,15,19,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  fpsText: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  flagBtn: {
    backgroundColor: '#2a3242', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
  },
  flagBtnText: { color: '#ffb84d', fontSize: 16, fontWeight: '800' },
  snapPanel: {
    position: 'absolute', left: 12, right: 12, top: 54,
    backgroundColor: 'rgba(8,10,14,0.94)', borderWidth: 1, borderColor: 'rgba(255,184,77,0.5)',
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
  },
  snapTitle: { color: '#ffb84d', fontSize: 12, fontWeight: '800', marginBottom: 6 },
  snapRow: { color: 'rgba(255,255,255,0.88)', fontSize: 12, lineHeight: 18, fontVariant: ['tabular-nums'] },
  snapBad: { color: '#ff6a3d', fontWeight: '800' },
  snapBtns: { flexDirection: 'row', gap: 8, marginTop: 10 },
  snapBtn: {
    flex: 1, backgroundColor: '#2a3242', borderRadius: 9,
    paddingVertical: 8, alignItems: 'center',
  },
  snapBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
});

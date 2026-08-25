// ============================================================================
//  Game — la pantalla jugable (física, cámara, colisión ya validadas).
//
//  Recibe el circuito ya construido por `track`, avisa con `onFinish(ms)` al meta
//  (una sola vez) y con `onExit()` para volver a Inicio. NO contiene lógica de
//  backend ni de resultados: eso lo maneja App.js.
// ============================================================================

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Dimensions, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
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
const REC_FIELDS = 10;   // t, entrada, volante, velocidad, rumbo, muro, dt, dedos, ambos, pieza
// Tipo de pieza de pista en el que va el coche (índice en track.center[idx].type,
// ver pieces.js) — para saber si el volantazo fantasma pega más en rectas,
// curvas o horquillas. Mismo orden que BANK en pieces.js, sin duplicar nombres.
const PIECE_TYPES = ['recta', 'curva_amplia', 'curva', 'curva_cerrada', 'horquilla'];
const TOUCH_LOG_N = 150; // últimos eventos táctiles en crudo (solo con DIAG)
const LIDER_VISTO_KEY = 'apexly_lider_explicado'; // ya se explicó qué es el coche del líder

const SCREEN = Dimensions.get('window');

export default function Game({ track, ghost, leaderRun: leaderRunProp, weather, sectorBests, refSectors, attemptsLeft = Infinity, loadout, onAttemptStart, onNeedMore, onFinish, onExit }) {
  // Se anula aquí arriba y no en cada sitio de uso: con leaderRun a null, el
  // coche del líder, su etiqueta y su interpolación por frame desaparecen
  // enteros, que es justo lo que queremos medir. Ver CONFIG.SIN_COCHE_LIDER.
  const leaderRun = CONFIG.SIN_COCHE_LIDER ? null : leaderRunProp;
  const insets = useSafeAreaInsets();
  const HUD_H = insets.top + HUD_CONTENT_H;
  const playW = SCREEN.width;
  const playH = SCREEN.height - HUD_H;
  const wx = weather || NEUTRAL;

  const g = useRef(null);
  const pressLeft = useRef(false);
  const pressRight = useRef(false);
  const dedos = useRef(0); // nº de dedos apoyados en el último evento (diagnóstico)
  const entradaEfectiva = useRef(0); // lo que realmente lee la física
  const rec = useRef(new Float64Array(REC_N * REC_FIELDS)); // grabadora (beta)
  const recAt = useRef(0); // nº total de frames escritos (el índice va en módulo)
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const ghostRef = useRef(ghost);
  ghostRef.current = ghost;
  // Vuelta del líder de hoy (traza + su livery real). Puntero propio: se
  // interpola igual que el fantasma pero con su propio avance, porque su
  // vuelta dura otra cosa que la tuya.
  const leaderTraceRef = useRef(null);
  leaderTraceRef.current = leaderRun ? leaderRun.trace : null;
  const leaderIdxRef = useRef(0);
  const weatherRef = useRef(wx);
  weatherRef.current = wx;
  const sectorBestsRef = useRef(sectorBests);
  sectorBestsRef.current = sectorBests;
  // Referencia por sector cuando NO hay fantasma. En el Grand Prix son tus
  // propios splits de tu mejor vuelta de esa ronda: en una ronda tiras varios
  // intentos y solo cuenta el mejor, asi que "¿voy mejor que mi mejor intento
  // de hoy?" es justo la pregunta que te haces conduciendo.
  const refSectorsRef = useRef(refSectors);
  refSectorsRef.current = refSectors;
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

  // Celebración del sector morado: qué sector fue (para el texto) + el valor
  // animado que lo hace aparecer y desvanecerse. `useRef` y no estado para el
  // valor animado, porque el bucle de frame ya re-renderiza a 60fps y no
  // queremos que la animación dependa de eso.
  const [moradoIdx, setMoradoIdx] = useState(null);
  const moradoAnim = useRef(new Animated.Value(0)).current;

  // ¿Toca explicar qué es el coche del líder? Solo la primerísima vez que el
  // jugador se encuentra uno. Empieza en false y se enciende si el flag no
  // está puesto — así, mientras se consulta AsyncStorage, no parpadea el
  // texto en pantalla.
  const [explicarLider, setExplicarLider] = useState(false);
  useEffect(() => {
    if (!leaderRun) return;
    let alive = true;
    AsyncStorage.getItem(LIDER_VISTO_KEY)
      .then((v) => {
        if (!alive || v) return;
        setExplicarLider(true);
        AsyncStorage.setItem(LIDER_VISTO_KEY, '1').catch(() => {});
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [leaderRun]);

  // Tanda de N vibraciones seguidas. El NÚMERO es el mensaje: uno para
  // amarillo, dos para verde, tres para morado. Un solo golpe más fuerte no
  // se distingue de otro más flojo con el móvil en las manos y el coche en
  // movimiento; contar golpes sí, y encadenarlos pone nervioso, que es justo
  // lo que se busca al cerrar sector.
  //
  // 70ms es el hueco: por debajo se funden en una sola vibración larga, por
  // encima dejan de leerse como una tanda.
  const pulsoTimers = useRef([]);
  function pulsos(n, estilo) {
    if (CONFIG.SIN_HAPTICOS_SECTOR) return; // bisección del volantazo fantasma
    for (let i = 0; i < n; i++) {
      if (i === 0) { Haptics.impactAsync(estilo).catch(() => {}); continue; }
      pulsoTimers.current.push(setTimeout(() => Haptics.impactAsync(estilo).catch(() => {}), i * 70));
    }
  }
  // Que una tanda a medias no siga sonando con el juego ya cerrado.
  useEffect(() => () => {
    pulsoTimers.current.forEach(clearTimeout);
    pulsoTimers.current = [];
  }, []);

  function celebrarMorado(index) {
    setMoradoIdx(index);
    moradoAnim.setValue(0);
    Animated.sequence([
      Animated.spring(moradoAnim, { toValue: 1, useNativeDriver: true, friction: 5, tension: 90 }),
      Animated.delay(900),
      Animated.timing(moradoAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) setMoradoIdx(null); });
  }

  function resetRun() {
    traceRef.current = [];
    lastSampleRef.current = -999;
    ghostIdxRef.current = 0;
    leaderIdxRef.current = 0;
    recAt.current = 0; // la grabación es por intento
    // Que un morado del intento anterior no se quede colgado en pantalla al
    // empezar el siguiente.
    moradoAnim.stopAnimation();
    moradoAnim.setValue(0);
    setMoradoIdx(null);
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

  // VOLANTE SIN ESTADO PROPIO — modelo de la build 21, restaurado.
  //
  // Por qué se vuelve aquí: la 21 es la que esta viva en la App Store y la
  // referencia de "asi se juega". Todo lo que vino despues (builds 45-70)
  // fueron intentos de arreglar el volantazo fantasma tocando la ENTRADA:
  // reconstruir la duracion del toque por timestamp, un remate fijo al soltar
  // (MIN_INPUT_MS), botones en vez de zona unica, alejarlos del borde. Ninguno
  // lo arreglo, y entre todos dejaron una conduccion distinta a la de la 21.
  //
  // Asi que se descarta la rama entera y se vuelve al modelo simple: en cada
  // evento se recalcula desde la lista de dedos activos que da el sistema.
  // Antes de la 21 se mantenia un Map por identifier (añadir al tocar, borrar
  // al levantar) y eso tiene un fallo grave: si se pierde un evento de
  // "levantar", o llega con otro identifier, la entrada se queda ahi PARA
  // SIEMPRE y el coche gira solo como si tuvieras el dedo apoyado. Sin estado
  // propio ese fallo no puede existir: cada evento parte de cero.
  //
  // El matiz de iOS: en un evento de levantar, `touches` puede seguir
  // incluyendo el dedo que se acaba de soltar (Android lo excluye), asi que se
  // descuenta explicitamente lo que venga en `changedTouches`.
  //
  // Izquierda + derecha a la vez = volante al centro, igual que en la 21. Es
  // deliberado: lo que despues intento arreglar ese caso ("manda el ultimo
  // lado pulsado") solo hace falta si hay dedos fantasma persistentes, y aqui
  // no puede haberlos porque no se guarda estado entre eventos.
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
    pressLeft.current = left;
    pressRight.current = right;
    dedos.current = n;
    return left || right;
  }

  function onTouchDown(evt) {
    logTouch('ABAJO', evt.nativeEvent);
    if (applyTouches(evt, false)) startRun();
  }

  function onTouchMove(evt) {
    applyTouches(evt, false);
  }

  function onTouchUp(evt) {
    applyTouches(evt, true);
    logTouch('ARRIBA', evt.nativeEvent);
  }

  function onTouchCancel() {
    pressLeft.current = false;
    pressRight.current = false;
    dedos.current = 0;
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
        // tsNat = timestamp que pone el SISTEMA al evento; reloj = cuándo lo
        // procesó el JS. Si el sistema dice que dos eventos van separados 125 ms
        // pero el JS los ve en el mismo instante, es entrega en bloque, no un
        // toque corto de verdad.
        ` | tsNat:${Math.round(ne.timestamp || 0)} reloj:${now() % 100000}` +
        ` | -> izq:${pressLeft.current ? 1 : 0} der:${pressRight.current ? 1 : 0} dedos:${dedos.current}`,
    );
    if (l.length > TOUCH_LOG_N) l.shift();
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
      const pieza = PIECE_TYPES[b[o + 9]] || '?';

      // EL CASO DELATOR: el coche recibe orden de girar con CERO dedos en
      // pantalla. Si esto aparece, el bug es del táctil, no de la física.
      const fantasma = nDedos === 0 && inp !== 0;
      if (fantasma && !prevFantasma) eventos.push(`${t.toFixed(2)}s  *** GIRO FANTASMA (0 dedos, orden ${nombreIn(inp)}, ${pieza}) ***`);
      prevFantasma = fantasma;

      // EL OTRO CASO DELATOR (invisible hasta ahora): izq y der marcadas a la
      // vez. Con un solo dedo en pantalla, significa dedo fantasma en el otro
      // lado — la causa candidata de "aprieto y no gira" en las horquillas.
      if (ambos && !prevAmbos) eventos.push(`${t.toFixed(2)}s  *** IZQ+DER A LA VEZ (dedos ${nDedos}, ${pieza}) ***`);
      prevAmbos = ambos;

      if (prevIn !== null && inp !== prevIn) {
        eventos.push(`${t.toFixed(2)}s  ${nombreIn(prevIn)} -> ${nombreIn(inp)}  (dedos ${nDedos}, ${pieza})`);
      }
      if (prevMuro !== null && muro !== prevMuro) {
        eventos.push(`${t.toFixed(2)}s  ${muro ? 'TOCA muro' : 'sale del muro'}  (${pieza})`);
      }
      if (prevRumbo !== null) {
        let d = rumbo - prevRumbo;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        if (Math.abs(d) > 20) eventos.push(`${t.toFixed(2)}s  VOLANTAZO ${d.toFixed(0)}°  (${pieza})`);
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
          pieza,                           // tipo de pieza de pista
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
      't\tpulsa\tvolante\tvel\trumbo\tmuro\tdt\tdedos\tambos\tpieza',
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
    entradaEfectiva.current = 0;
    touchLog.current = [];
    setView(toView(
      g.current,
      false,
      ghostPoseAt(ghostRef.current, 0, ghostIdxRef),
      ghostPoseAt(leaderTraceRef.current, 0, leaderIdxRef),
    ));

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
        // La orden sale DIRECTA de los dedos apoyados, igual que en la build
        // 21: sin remate al soltar, sin pulso mínimo, sin nada reconstruido.
        // Los dos lados a la vez se anulan (-1+1 = 0), que es el
        // comportamiento de la 21.
        entradaEfectiva.current =
          (pressRight.current ? 1 : 0) - (pressLeft.current ? 1 : 0);
        while (s.acc >= FIXED_DT && guard < 10) {
          stepSimulation(s, FIXED_DT, t, track, entradaEfectiva, weatherRef.current, ghostProgressRef.current, sectorBestsRef.current, refSectorsRef.current);
          s.acc -= FIXED_DT;
          guard++;
          if (s.phase !== 'running') break;
        }
        if (guard > s.stepsMax) s.stepsMax = guard;
        if (guard >= 10) s.stepsCapped++; // se descartó tiempo: el móvil no da más
        if (s.touching) s.contactMs += dt * 1000;
        if (s.touching && !wasTouching) s.impacts++;
        s.elapsed = t - s.startTime;

        // Acabas de cerrar un sector: darle cuerpo al momento. El morado (mejor
        // del mundo hoy en ese sector) es el mejor instante del juego y hasta
        // ahora solo cambiaba el color de una barra de 5px — pasaba
        // desapercibido justo cuando más mérito tiene.
        if (s.sectorEvents.length > 0) {
          // Si en el mismo paso se cerraron varios sectores, manda el mejor:
          // vibrar tres veces seguidas no se distingue de vibrar una, y la
          // celebración en pantalla es una sola. El morado gana al verde.
          const evs = s.sectorEvents;
          s.sectorEvents = [];
          const morado = evs.find((e) => e.color === 'purple');
          if (morado) {
            pulsos(3, Haptics.ImpactFeedbackStyle.Heavy);
            celebrarMorado(morado.index);
          } else if (evs.some((e) => e.color === 'green')) {
            pulsos(2, Haptics.ImpactFeedbackStyle.Medium);
          } else {
            // Amarillo, y también el sector SIN color (Grand Prix y Carrera,
            // donde no hay ni mejor mundial ni fantasma contra los que
            // medirse): un solo golpe suave. Antes el amarillo se callaba,
            // con la idea de reservar el tacto para las buenas noticias; en
            // pista resulta que enterarte de que has cerrado sector —fuera
            // bien o mal— es lo que mantiene la tensión.
            pulsos(1, Haptics.ImpactFeedbackStyle.Light);
          }
        }

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
        const pieza = track.center[s.trackIdx] && track.center[s.trackIdx].type;
        b[o + 9] = Math.max(0, PIECE_TYPES.indexOf(pieza));
        recAt.current++;
      }

      // Cámara: el rumbo persigue (con lag suave) el del coche.
      let da = s.heading - s.camAngle;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      s.camAngle += da * Math.min(1, dt * CAM_TURN_LERP);

      const gp = ghostPoseAt(ghostRef.current, s.elapsed, ghostIdxRef);
      // Mismo interpolador que el fantasma: una traza es una traza, venga de
      // AsyncStorage (la tuya) o de Supabase (la del líder).
      const lp = ghostPoseAt(leaderTraceRef.current, s.elapsed, leaderIdxRef);
      setView(toView(s, t < s.flashUntil, gp, lp));
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

  // Dónde cae el coche del líder EN PANTALLA. Hace falta calcularlo a mano
  // (aplicando la misma cadena que camTransform) porque la etiqueta con su
  // nombre NO puede ir dentro del <G> de cámara: ese grupo rota con el rumbo
  // del coche, así que el texto saldría torcido o boca abajo, y además se
  // escalaría con el zoom. Fuera del grupo, el cartelito siempre se lee recto.
  let leaderTagPos = null;
  if (view.leader && leaderRun) {
    const rad = (camRot * Math.PI) / 180;
    const dx = view.leader.x - view.x;
    const dy = view.leader.y - view.y;
    const sx = playW / 2 + camZoom * (dx * Math.cos(rad) - dy * Math.sin(rad));
    const sy = playH * CAM_ANCHOR + camZoom * (dx * Math.sin(rad) + dy * Math.cos(rad));
    // Solo si está realmente a la vista; si no, el cartel se quedaría pegado
    // a un borde señalando a un coche que no está en pantalla.
    const margin = 60;
    if (sx > -margin && sx < playW + margin && sy > -margin && sy < playH + margin) {
      leaderTagPos = { x: sx, y: sy };
    }
  }

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
            {/* Coche del LÍDER de hoy: su livery real y opacidad completa —
                no es un fantasma, es "compartís circuito". Va por debajo del
                tuyo para que el tuyo nunca quede tapado. */}
            {view.leader && leaderRun && (
              <CarSprite
                x={view.leader.x}
                y={view.leader.y}
                deg={(view.leader.h * 180) / Math.PI}
                loadout={leaderRun.loadout}
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

        {/* ZONA TÁCTIL ÚNICA a pantalla completa, invisible — modelo de la
            build 21. El lado se decide por `pageX` de cada dedo dentro de
            applyTouches, no por qué vista recibió el toque, así que no hay dos
            manejadores independientes que puedan desincronizarse.
            Va antes que el HUD en el árbol: lo de después se dibuja encima y
            se lleva sus propios toques (salir, ⚑, panel de inicio). */}
        <View
          style={StyleSheet.absoluteFill}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
          onResponderGrant={onTouchDown}
          onResponderStart={onTouchDown}
          onResponderMove={onTouchMove}
          onResponderEnd={onTouchUp}
          onResponderRelease={onTouchUp}
          onResponderTerminate={onTouchCancel}
        />

        {/* Nombre flotando sobre el coche del líder. Es lo que evita que un
            coche sólido que te atraviesa se lea como un fallo de colisión:
            con el nombre encima queda claro que es la vuelta grabada de otra
            persona, no un rival físico. */}
        {leaderTagPos && (
          <View
            pointerEvents="none"
            style={[
              styles.leaderNameWrap,
              { left: leaderTagPos.x - 70, top: leaderTagPos.y - 42 },
            ]}
          >
            <View style={styles.leaderNamePill}>
              <Text style={styles.leaderNameText} numberOfLines={1}>
                {leaderRun.nickname}
              </Text>
            </View>
          </View>
        )}

        {/* Efecto visual del clima del día (lluvia / viento / seco) */}
        <WeatherFX weather={wx} w={playW} h={playH} />

        {/* SECTOR MORADO: mejor del mundo hoy en ese sector. Va bajo el HUD y
            con pointerEvents none — no puede robar ni un toque del volante. */}
        {moradoIdx != null && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.moradoWrap,
              {
                opacity: moradoAnim,
                transform: [
                  { scale: moradoAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
                ],
              },
            ]}
          >
            <View style={styles.moradoPill}>
              <Text style={styles.moradoTitle}>SECTOR {moradoIdx + 1} MORADO</Text>
              <Text style={styles.moradoSub}>MEJOR DEL MUNDO HOY</Text>
            </View>
          </Animated.View>
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
            {/* Explicación LA PRIMERA VEZ que te toca correr contra alguien:
                sin esto, un coche sólido que se cruza contigo y al que
                atraviesas parece un bug de colisión. Después de la primera
                vez basta con el nombre flotando sobre el coche. */}
            {leaderRun && explicarLider && (
              <Text style={styles.startLeaderNote}>
                Hoy corres contra la vuelta de {leaderRun.nickname}, el tiempo
                más rápido en pista. Es una repetición: podéis atravesaros.
              </Text>
            )}
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
              <Text style={[rd.sectorDelta, { color: view.ghostDeltaMs <= 0 ? RD.successGreen : RD.danger }]}>
                {view.ghostDeltaMs <= 0 ? 'FANTASMA −' : 'FANTASMA +'}{Math.abs(view.ghostDeltaMs / 1000).toFixed(2)}
              </Text>
            )}
            {/* Sin esto, el coche del líder parece un rival inventado. Con el
                nombre delante, adelantarlo (o comértelo) tiene destinatario. */}
            {view.phase === 'ready' && leaderRun && (
              <Text style={rd.leaderTag} numberOfLines={1}>
                EN PISTA · {leaderRun.nickname.toUpperCase()} {fmt(leaderRun.ms)}
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
  active: RD.brand,  // el que estás recorriendo ahora
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
  leaderTag: {
    color: RD.gold1st, fontSize: 11, fontFamily: RD_FONT.mono,
    letterSpacing: 0.5, maxWidth: 200,
  },
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
    sectorEvents: [],       // cola de {index,color,ms} que vacía el bucle de frame
  };
}

function toView(s, flash, ghost, leader) {
  return {
    x: s.x, y: s.y, heading: s.heading, camAngle: s.camAngle, elapsed: s.elapsed, phase: s.phase, flash, ghost, leader, fps: s.fps,
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
function stepSimulation(s, dt, t, track, entrada, weather, ghostProgress, sectorBests, refSectors) {
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
    // `sectorBests` distingue DOS cosas que antes se confundían, y de ahí
    // salía que en Grand Prix y Modo Carrera se pintara morado todo, siempre:
    //
    //   - un OBJETO (aunque esté vacío) = este modo sí tiene mejores del
    //     mundo. Que falte el sector significa "nadie lo ha marcado hoy", así
    //     que lo que mandes ES el mejor del momento -> morado. Es el Diario.
    //   - null = este modo NO tiene mejores del mundo. Es el caso del GP y de
    //     Carrera, donde cada circuito es de un grupo o de un nivel y no hay
    //     una tabla mundial contra la que medirse.
    //
    // Antes solo se miraba `worldBest == null`, así que la AUSENCIA de tabla
    // se leía igual que "eres el primero del día" y todo salía morado en cada
    // vuelta, aunque fueras más lento en todos los sectores.
    const hayMundial = sectorBests != null;
    const worldBest = hayMundial ? sectorBests[s.sector] : null;
    // Referencia de respaldo cuando no hay fantasma: en el GP, tus propios
    // splits del mejor intento de esa ronda.
    const refSplit = refSectors ? refSectors[s.sector] : null;
    let color = null;
    if (hayMundial && (worldBest == null || mySplit <= worldBest)) color = 'purple';
    else if (ghostSplit != null) color = mySplit < ghostSplit ? 'green' : 'yellow';
    else if (refSplit != null) color = mySplit < refSplit ? 'green' : 'yellow';
    // Hay mejor mundial pero no lo bates, y no hay fantasma propio que batir:
    // no hay nada "peor" contra lo que perder -> cuenta como mejora.
    else if (hayMundial) color = 'green';
    // Sin mundial, sin fantasma y sin referencia (primera vuelta de una ronda
    // de GP, Carrera): no hay nada contra lo que comparar, así que el sector
    // se queda sin color en vez de inventarse un veredicto.
    s.sectorSplits.push(mySplit);
    s.sectorColors.push(color);
    // La diferencia sigue la misma jerarquía que el color: fantasma primero,
    // y si no hay, la referencia de la ronda.
    const contra = ghostSplit != null ? ghostSplit : refSplit;
    s.sectorDeltas.push(contra != null ? mySplit - contra : null);
    s.lastSectorElapsed = elapsedNow;
    s.sector++;
    // COLA (no un buzón de un hueco) para que el bucle de frame reaccione
    // (háptico + celebración del morado). Se encola aquí y NO se dispara nada
    // desde dentro de la física: stepSimulation corre hasta 10 veces por frame
    // a paso fijo, así que llamar a Haptics desde aquí podría vibrar varias
    // veces por el mismo sector. El frame la vacía.
    //
    // Tiene que ser una cola porque closeSectorsUpTo puede cerrar dos o tres
    // sectores dentro del mismo paso: con un solo hueco, los primeros se
    // pisaban antes de que nadie los leyera y se perdía su celebración —
    // justo la del morado, que es la que más importa.
    s.sectorEvents.push({ index: s.sector - 1, color, ms: mySplit });
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

  // Llega ya resuelto a -1 / 0 / 1 desde el bucle de frame, que lo saca
  // directamente de los dedos apoyados (izq -1, der +1, las dos a la vez 0).
  // `entrada` es el parámetro, no un estado propio de la física.
  const target = entrada.current;

  const easeTime = (target !== 0 ? C.STEER_EASE_IN : C.STEER_EASE_OUT) * W.steerMul;
  const maxDelta = dt / Math.max(0.001, easeTime);
  s.steer += clamp(target - s.steer, -maxDelta, maxDelta);
  s.steer = clamp(s.steer, -1, 1);

  const cap = C.MAX_SPEED * W.speedMul;
  const turnBrake = C.TURN_SPEED_DRAG * Math.abs(s.steer);
  // Suelo del FRENADO POR VOLANTE. Una horquilla necesita más de un segundo de
  // volante mantenido, y a -200 u/s² eso te deja en 0 a mitad de curva; a 0 el
  // coche gira sobre sí mismo sin avanzar y se queda clavado al muro. Visto en
  // la traza del nivel 2 (Horquillas): choque a 54 u/s, sigues girando porque
  // la curva lo pide, 0 u/s en 0,28 s y luego 100° de giro parado contra la
  // pared.
  //
  // OJO con la forma de escribirlo: un `Math.max(suelo, ...)` a secas SUBE la
  // velocidad de golpe si venías más lento (medido: 63 -> 110 u/s en un frame
  // justo después de un choque). Por eso el suelo se limita a `s.speed`: si ya
  // vas por debajo, el volante deja de frenarte pero no te empuja. Chocar y
  // rozar siguen pudiendo bajarte de aquí, se aplican más abajo.
  const sueloGiro = Math.abs(s.steer) > 0.01 ? Math.min(C.MIN_TURN_SPEED, cap, s.speed) : 0;
  s.speed = clamp(s.speed + (C.ACCEL - turnBrake) * dt, sueloGiro, cap);

  // REVERTIDO al modelo de producción (grados/segundo, más giro cuanto más
  // lento vas) tras confirmar que la build de Android que JC llama "perfecta"
  // (versionCode 7, ya en la Play Store) usa EXACTAMENTE esta fórmula y este
  // TURN_SPEED_DRAG — sin suelo de velocidad, sin giro por radio, sin tope de
  // rebote, sin empuje pasivo al rozar. Esa build funciona bien en Android, así
  // que la física nunca fue el problema. El bug es de entrega de eventos
  // táctiles en iOS (ver MIN_INPUT_MS más arriba y resolveEntrada — a fecha
  // de este comentario, todavía en investigación). Ver también el historial
  // de este archivo si hace falta recuperar el modelo por radio para otra cosa.
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
        // EL RUMBO GIRA HACIA EL REFLEJO, PERO CON TOPE.
        //
        // Aquí estaba el "volantazo fantasma". Antes esto era
        // `s.heading = Math.atan2(rvy, rvx)`: el rumbo se reescribía DE GOLPE
        // a la dirección reflejada. En una grabación real del iPhone 13 se
        // midieron saltos de 59°, 65°, 76° y 85° en un solo frame, los seis
        // exactamente en el mismo instante que un golpe contra el muro, y uno
        // de ellos con CERO dedos apoyados. Se siente como si el coche girara
        // solo porque, literalmente, gira solo.
        //
        // Es el mismo razonamiento que ya estaba escrito en la rama del roce,
        // justo debajo: como la velocidad va siempre en la dirección del
        // rumbo, reescribir el rumbo es girar el coche. Allí se decidió no
        // tocarlo; aquí se había quedado sin aplicar.
        //
        // No se puede eliminar del todo el giro: el reflejo es lo único que
        // despega al coche del muro (ver CRASH_BOUNCE en config.js, con la
        // medición de que a 0 se queda pegado 5,5 s y no sale). Así que se
        // conserva, pero acotado.
        if (rvx !== 0 || rvy !== 0) {
          const objetivo = Math.atan2(rvy, rvx);
          let d = objetivo - s.heading;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          const tope = (C.CRASH_MAX_TURN_DEG * Math.PI) / 180;
          s.heading += Math.max(-tope, Math.min(tope, d));
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
  // Celebración del sector morado. Arriba del todo del área de juego (justo
  // bajo el HUD, cerca de la barra de sectores que acaba de cambiar de color)
  // y no en el centro: el coche va a 250 u/s y taparle la pista sería
  // castigar al jugador justo por hacerlo bien.
  moradoWrap: { position: 'absolute', top: 12, left: 0, right: 0, alignItems: 'center' },
  // Etiqueta con el nombre del líder, anclada sobre su coche. Ancho fijo +
  // centrado para poder posicionarla restando la mitad, sin medir el texto.
  leaderNameWrap: { position: 'absolute', width: 140, alignItems: 'center' },
  leaderNamePill: {
    backgroundColor: 'rgba(13,15,19,0.82)', borderWidth: 1, borderColor: RD.gold1st,
    borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, maxWidth: 140,
  },
  leaderNameText: {
    color: RD.gold1st, fontSize: 10, fontFamily: RD_FONT.mono, letterSpacing: 0.4,
  },
  moradoPill: {
    backgroundColor: 'rgba(13,15,19,0.88)', borderWidth: 1.5, borderColor: SECTOR_COLORS.purple,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 9, alignItems: 'center',
  },
  moradoTitle: {
    color: SECTOR_COLORS.purple, fontSize: 15, fontFamily: RD_FONT.monoBold, letterSpacing: 1,
  },
  moradoSub: {
    color: 'rgba(255,255,255,0.6)', fontSize: 10, fontFamily: RD_FONT.mono,
    letterSpacing: 1.2, marginTop: 3,
  },
  startPanel: {
    position: 'absolute', left: 24, right: 24, bottom: 46, alignItems: 'center',
    backgroundColor: 'rgba(13,15,19,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 18, paddingVertical: 16, paddingHorizontal: 18,
  },
  startTitle: { color: '#ffffff', fontSize: 20, fontWeight: '800', letterSpacing: 0.3 },
  startSub: { color: 'rgba(255,255,255,0.62)', fontSize: 13, marginTop: 6 },
  startLeaderNote: {
    color: RD.gold1st, fontSize: 12, marginTop: 10, textAlign: 'center', lineHeight: 17,
  },
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

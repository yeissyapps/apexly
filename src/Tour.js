// ============================================================================
//  Tour — recorrido guiado de la primera apertura.
//
//  Oscurece la app y va resaltando trozos de la interfaz real, uno por paso,
//  explicando qué es cada cosa.
//
//  OJO con la premisa, que es lo que marca el diseño de este archivo: en la
//  PRIMERA apertura media app todavía no existe. El camino de la racha no se
//  pinta hasta tener racha >= 1, el puesto del día necesita haber corrido, el
//  Grand Prix necesita un grupo... Un tour de "resaltar la UI" a secas
//  señalaría huecos vacíos justo en los pasos que más enganchan.
//
//  Por eso un paso puede ser de dos tipos:
//    - CON `target`: resalta un elemento real (recorte + borde) y pone la
//      tarjeta al lado.
//    - SIN `target` (con `demo` opcional): tarjeta centrada que puede
//      renderizar el COMPONENTE REAL con datos de ejemplo — no una captura ni
//      un dibujo aparte, el mismo componente que verá luego. Así se explica la
//      racha enseñando el camino de la racha, aunque todavía no tenga ninguna.
//
//  El recorte se hace con cuatro rectángulos oscuros alrededor del hueco en
//  vez de una máscara SVG: es exacto igual, no mete una dependencia de dibujo
//  para un rectángulo, y evita el coste de rasterizar una máscara a pantalla
//  completa en cada paso.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';

import { RD, RD_FONT } from './theme';

// Sube la versión para volver a lanzar el tour a TODO el mundo (p. ej. si
// entra un modo nuevo que merece explicación). Los que ya lo vieron con la
// versión anterior lo verán otra vez; los que lo salten, no.
const TOUR_KEY = 'tour:v1';

export async function isTourDone() {
  try {
    return (await AsyncStorage.getItem(TOUR_KEY)) === 'done';
  } catch (_) {
    // Si el almacenamiento falla, mejor NO enseñar el tour: repetirlo en cada
    // apertura molesta mucho más que no verlo.
    return true;
  }
}

export async function markTourDone() {
  try { await AsyncStorage.setItem(TOUR_KEY, 'done'); } catch (_) {}
}

// ---- Registro de objetivos --------------------------------------------------
// Registro a nivel de módulo en vez de contexto de React: los elementos a
// resaltar viven en componentes distintos (AppShell tiene las pestañas y el
// perfil, DiarioTab el circuito y el CTA) y pasarlos por props obligaría a
// atravesar media App.js con props que solo sirven para esto.
const targets = new Map();

export function tourRef(id) {
  return (node) => {
    if (node) targets.set(id, node);
    else targets.delete(id);
  };
}

// measureInWindow puede responder con ceros si el layout aún no ha asentado
// (típico justo después de montar). Devolvemos null en ese caso y el paso cae
// a tarjeta centrada en vez de dibujar un recorte en la esquina superior.
function measureTarget(id) {
  return new Promise((resolve) => {
    const node = targets.get(id);
    if (!node || typeof node.measureInWindow !== 'function') { resolve(null); return; }
    node.measureInWindow((x, y, width, height) => {
      resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
    });
  });
}

const HOLE_PAD = 8;      // aire entre el elemento y el borde del recorte
const CARD_GAP = 14;     // separación entre el recorte y la tarjeta
const CARD_MIN_ROOM = 260; // hueco mínimo para poner la tarjeta debajo

export default function Tour({ steps, onDone }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const doneRef = useRef(false);
  const { width: winW, height: winH } = Dimensions.get('window');

  const step = steps[i];
  const isLast = i === steps.length - 1;

  // Medimos al entrar en cada paso. El pequeño retardo deja que termine
  // cualquier animación de layout pendiente antes de leer la posición.
  useEffect(() => {
    let alive = true;
    if (!step?.target) { setRect(null); return undefined; }
    setRect(null);
    const t = setTimeout(() => {
      measureTarget(step.target).then((r) => { if (alive) setRect(r); });
    }, 80);
    return () => { alive = false; clearTimeout(t); };
  }, [i, step?.target]);

  function finish() {
    if (doneRef.current) return; // evita doble cierre (toque rápido en "Listo")
    doneRef.current = true;
    markTourDone();
    onDone?.();
  }

  if (!step) return null;

  // El recorte se recorta a la pantalla: un elemento pegado al borde (la
  // pestaña CARRERA, sin ir más lejos) más el margen del recorte se salía por
  // la derecha y el borde de resalte quedaba cortado.
  const hole = rect
    ? (() => {
        const x = Math.max(0, rect.x - HOLE_PAD);
        const y = Math.max(0, rect.y - HOLE_PAD);
        return {
          x,
          y,
          w: Math.min(rect.width + HOLE_PAD * 2, winW - x),
          h: Math.min(rect.height + HOLE_PAD * 2, winH - y),
        };
      })()
    : null;

  // La tarjeta va debajo del recorte si cabe; si no, encima. Se posiciona con
  // `top` o con `bottom` (nunca las dos) para no tener que saber su altura.
  const below = hole ? winH - (hole.y + hole.h) >= CARD_MIN_ROOM : true;
  const cardPos = !hole
    ? { top: Math.round(winH * 0.28) }
    : below
      ? { top: hole.y + hole.h + CARD_GAP }
      : { bottom: winH - hole.y + CARD_GAP };

  return (
    <View style={[s.root, { width: winW, height: winH }]}>
      {/* Capas oscuras. Sin recorte es una sola a pantalla completa; con
          recorte son cuatro bandas que lo rodean. Capturan el toque para que
          no se pueda tocar la app por detrás del tour.
          Todas van con ancho/alto EXPLÍCITOS en vez de estirarse con
          right/bottom: medido en dispositivo (Samsung A53, RN 0.86), una capa
          dimensionada solo por insets dentro de este árbol no llegaba a
          pintarse — con tamaño explícito sí. */}
      {!hole ? (
        <Pressable style={[s.dim, { left: 0, top: 0, width: winW, height: winH }]} onPress={() => {}} />
      ) : (
        <>
          <Pressable style={[s.dim, { left: 0, top: 0, width: winW, height: hole.y }]} onPress={() => {}} />
          <Pressable
            style={[s.dim, { left: 0, top: hole.y + hole.h, width: winW, height: Math.max(0, winH - (hole.y + hole.h)) }]}
            onPress={() => {}}
          />
          <Pressable style={[s.dim, { left: 0, top: hole.y, width: hole.x, height: hole.h }]} onPress={() => {}} />
          <Pressable
            style={[s.dim, { left: hole.x + hole.w, top: hole.y, width: Math.max(0, winW - (hole.x + hole.w)), height: hole.h }]}
            onPress={() => {}}
          />
          <View
            pointerEvents="none"
            style={[s.highlight, { left: hole.x, top: hole.y, width: hole.w, height: hole.h }]}
          />
        </>
      )}

      <View style={[s.card, cardPos, { left: 18, width: winW - 36 }]}>
        <Text style={s.stepCount}>{i + 1}/{steps.length}</Text>
        <Text style={s.title}>{step.title}</Text>

        {/* Demo del componente real, para los pasos cuyo elemento todavía no
            existe en la app de un jugador nuevo. */}
        {step.demo && <View style={s.demo}>{step.demo}</View>}

        <Text style={s.body}>{step.body}</Text>

        <View style={s.actions}>
          <Pressable onPress={finish} hitSlop={10}>
            <Text style={s.skip}>{isLast ? ' ' : 'Saltar'}</Text>
          </Pressable>
          <Pressable
            style={s.nextBtn}
            onPress={() => (isLast ? finish() : setI((n) => n + 1))}
            hitSlop={6}
          >
            <Text style={s.nextBtnText}>{isLast ? 'EMPEZAR' : 'SIGUIENTE'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // El tamaño real (ancho/alto de la ventana) se pasa en línea, no aquí: ver
  // el comentario del render. zIndex alto para quedar por encima de la barra
  // de pestañas y de la cabecera del shell.
  root: { position: 'absolute', top: 0, left: 0, zIndex: 9999 },
  dim: { position: 'absolute', backgroundColor: 'rgba(6,6,7,0.88)' },
  highlight: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: RD.brandOrange,
    borderRadius: 3,
  },
  card: {
    // left/width se pasan en línea (mismo motivo que las capas oscuras).
    position: 'absolute',
    backgroundColor: RD.bg,
    borderWidth: 1,
    borderColor: RD.panelBorder,
    borderRadius: 2,
    padding: 16,
    gap: 10,
  },
  stepCount: {
    color: RD.textDisabled, fontSize: 10, fontFamily: RD_FONT.mono, letterSpacing: 1,
  },
  title: {
    color: RD.textPrimary, fontSize: 24, fontFamily: RD_FONT.displayBlack,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  body: { color: RD.textSecondary, fontSize: 14, fontFamily: RD_FONT.mono, lineHeight: 21 },
  demo: {
    borderWidth: 1, borderColor: RD.gridLine, borderRadius: 2,
    paddingVertical: 14, paddingHorizontal: 10,
  },
  actions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 4,
  },
  skip: { color: RD.textDisabled, fontSize: 12, fontFamily: RD_FONT.mono },
  nextBtn: {
    backgroundColor: RD.brandOrange, borderRadius: 2,
    paddingHorizontal: 18, paddingVertical: 10,
  },
  nextBtnText: { color: RD.bg, fontSize: 13, fontFamily: RD_FONT.monoBold, letterSpacing: 0.8 },
});

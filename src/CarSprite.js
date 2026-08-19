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

import { useMemo } from 'react';
import { Defs, Ellipse, G, LinearGradient, Path, Polygon, Rect, Circle, Stop, Text as SvgText } from 'react-native-svg';
import { CAR_DEFAULTS, findColorEntry } from './car';
// La FORMA del coche vive en carGeometry.js, como datos puros: así la puede
// pintar también la hoja de contactos (tools/contact-sheet.mjs) sin arrastrar
// React, y cambiar una pieza es editar números en un sitio y no JSX en dos.
import { wingGeomFor, liveryGeomFor, highlightEllipses, lightBeamsFor, lightRadius } from './carGeometry';
import { chassisById } from './chassis';

// Cuánto ha girado el degradado holográfico ahora mismo (0..1), a partir del
// reloj real — un ciclo completo cada 4s, igual que la muestra que vio JC.
function holoPhase() {
  return (Date.now() % 4000) / 4000;
}

// Resuelve un color de catálogo (ver `findColorEntry` en car.js) al `fill`
// real de SVG. `id` identifica el degradado (uno por pieza pintable, para
// que carrocería/alerón/franja no compartan degradado aunque sean el mismo
// color).
//
// Metalizado/cromado: el cuerpo se queda en color PLANO (nunca un degradado
// de esquina a esquina sobre la silueta — en una carrocería larga y
// estrecha eso se lee como rayas diagonales cruzando el coche, no como un
// material, porque un degradado lineal no respeta la curva de la
// carrocería). El efecto de metal va aparte, en una veta de brillo angosta
// (ver `highlight` más abajo) que sí usa los `stops` pero confinada a una
// franja pequeña, donde una elipse ya aporta el estrechamiento en los
// extremos sin necesitar más matemática.
//
// Holográfico: sí cubre el cuerpo entero con degradado (el material real
// cambia de color en toda la superficie, no en una veta) y ese SÍ anima con
// el tiempo — ver GradientDef.
function resolveFill(hex, id) {
  const entry = findColorEntry(hex);
  if (entry.finish === 'flat' || !entry.stops) return { fill: entry.c, gradient: null, highlight: null };
  if (entry.finish === 'holografico') {
    return { fill: `url(#${id})`, gradient: { id, stops: entry.stops, finish: entry.finish }, highlight: null };
  }
  return { fill: entry.c, gradient: null, highlight: { id, stops: entry.stops, finish: entry.finish } };
}

// Degradado del cuerpo holográfico: el punto central se desliza con el
// tiempo manteniendo siempre un vano de 100 puntos, para que "recorra" el
// coche sin saltos (nada de módulo con el vano completo, que colapsaría
// x1=x2).
function GradientDef({ id, stops }) {
  const n = stops.length;
  const center = holoPhase() * 100;
  return (
    <LinearGradient id={id} x1={`${center - 50}%`} y1="0%" x2={`${center + 50}%`} y2="100%">
      {stops.map((c, i) => <Stop key={i} offset={i / (n - 1)} stopColor={c} />)}
    </LinearGradient>
  );
}

// Degradado HORIZONTAL (a lo largo del coche, morro a cola) para la veta de
// brillo de metalizado/cromado — nada de diagonal, así no vuelve a leerse
// como raya cruzando la carrocería.
function HighlightGradientDef({ id, stops }) {
  const n = stops.length;
  return (
    <LinearGradient id={id} x1="0%" y1="0%" x2="100%" y2="0%">
      {stops.map((c, i) => <Stop key={i} offset={i / (n - 1)} stopColor={c} />)}
    </LinearGradient>
  );
}

// Pinta el vocabulario de formas de carGeometry (rect/polygon/circle/text).
// Lo usan alerones y libreas por igual — cuando eran dos pintores distintos,
// meter un polígono en un alerón simplemente no se dibujaba.
//
// `stroke: true`   -> el color va al trazo, no al relleno.
// `knockout: true` -> se pinta con el color de DEBAJO (el del coche), para
//                     calar el dorsal dentro de su disco sin máscaras.
function Shapes({ shapes, color, under }) {
  return (
    <>
      {shapes.map((p, i) => {
        const fill = p.knockout ? under : color;
        if (p.type === 'rect') {
          return <Rect key={i} x={p.x} y={p.y} width={p.width} height={p.height} rx={p.rx} fill={fill} />;
        }
        if (p.type === 'polygon') return <Polygon key={i} points={p.points} fill={fill} />;
        if (p.type === 'circle') {
          return (
            <Circle
              key={i} cx={p.cx} cy={p.cy} r={p.r}
              fill={p.stroke ? 'none' : fill}
              stroke={p.stroke ? color : undefined}
              strokeWidth={p.strokeWidth}
            />
          );
        }
        if (p.type === 'text') {
          return (
            <SvgText
              key={i} x={p.x} y={p.y} fontSize={p.fontSize} fontWeight={p.fontWeight}
              textAnchor={p.anchor} fill={fill}
            >
              {p.value}
            </SvgText>
          );
        }
        return null;
      })}
    </>
  );
}

export default function CarSprite({ x, y, deg, scale = 1, loadout }) {
  const lo = { ...CAR_DEFAULTS, ...loadout };
  const ch = chassisById(lo.chassis);
  const body = resolveFill(lo.bodyColor, 'body');
  const wing = resolveFill(lo.wingColor, 'wing');

  // La forma y el color del coche (~20 elementos SVG: alerón, cuerpo,
  // rejilla, librea, cabina, splitter, faros) solo cambian cuando cambia el
  // loadout — x/y/deg cambian en CADA frame porque el coche se mueve, pero
  // eso es solo el transform del <G> de fuera. Sin memoizar, react-native-svg
  // reconstruía y recomitía TODA esta geometría 60 veces/segundo solo para
  // desplazarla, compitiendo por el hilo principal de iOS con la entrega de
  // los toques: medido en grabación real, el frame JS nunca pasaba de 67ms
  // pero el toque nativo tardaba hasta 467ms en llegar a JS — la causa real
  // de los GIRO FANTASMA / "no responde" de Game.js, no un problema de
  // reconstrucción de duración. Memoizado, el único cambio por frame es el
  // transform.
  const shapeTree = useMemo(() => (
    <>
      {/* Alerón trasero (forma y color personalizables), recolocado al
          anclaje del chasis */}
      <Shapes shapes={wingGeomFor(ch, lo.wingShape)} color={wing.fill} under={body.fill} />
      {/* Añadidos del chasis que son parte de la carrocería (p. ej. las
          ruedas descubiertas del monoplaza): heredan su color, así que van
          justo antes del cuerpo */}
      {(ch.extras || []).map((r, i) => (
        <Rect key={i} {...r} fill={body.fill} />
      ))}
      {/* Carrocería (color plano) */}
      <Path d={ch.body} fill={body.fill} />
      {/* Veta de brillo (metalizado/cromado) — ver highlightEllipses. */}
      {body.highlight && highlightEllipses(body.highlight.finish).map((e, i) => (
        <Ellipse
          key={i} cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry}
          fill={`url(#${body.highlight.id})`} opacity={e.opacity}
        />
      ))}
      {/* Rejilla del motor (trasera). Va ANTES de la librea: es un negro al
          18% y, pintada encima, apagaba la mitad trasera de cualquier franja
          — se veía una raya de dos tonos, como si estuviera sucia. */}
      <Rect {...ch.grille} fill="rgba(0,0,0,0.18)" />
      {/* Franja/librea sobre el cuerpo (patrón + color, por separado).
          `under` es el color del coche: es lo que cala el dorsal. */}
      {lo.livery && (
        <Shapes shapes={liveryGeomFor(ch, lo.liveryPattern)} color={lo.livery} under={body.fill} />
      )}
      {/* Cabina / cristales */}
      <Rect {...ch.cabin} fill="#1b2733" />
      {/* Splitter delantero (sobresale del morro) */}
      <Rect {...ch.splitter} fill="#0f1218" />
      {/* Faros + haz de luz (color personalizable). El haz se calcula DESDE
          las lámparas del chasis: cuando era una constante con las del GT,
          en los otros tres coches la luz salía de un sitio y la lámpara
          estaba en otro. */}
      {lightBeamsFor(ch).map((b, i) => (
        <Polygon key={i} points={b.points} fill={lo.lightsColor} opacity={b.opacity} />
      ))}
      {ch.lights.map((b, i) => (
        <Circle key={i} cx={b.x} cy={b.y} r={lightRadius(ch)} fill={lo.lightsColor} />
      ))}
    </>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [lo.chassis, lo.wingShape, lo.bodyColor, lo.wingColor, lo.livery, lo.liveryPattern, lo.lightsColor]);

  // El metalizado/cromado (highlight) no anima — entra en el memo de arriba.
  // Solo el holográfico gira con Date.now() (ver holoPhase) y por eso se
  // queda FUERA del memo, recalculándose cada frame como hasta ahora.
  const highlightDef = useMemo(() => (
    body.highlight ? <HighlightGradientDef {...body.highlight} /> : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [lo.bodyColor]);
  const hasHolo = !!(body.gradient || wing.gradient);

  return (
    <G transform={`translate(${x} ${y}) rotate(${deg}) scale(${scale})`}>
      {(hasHolo || highlightDef) && (
        <Defs>
          {body.gradient && <GradientDef {...body.gradient} />}
          {wing.gradient && <GradientDef {...wing.gradient} />}
          {highlightDef}
        </Defs>
      )}
      {shapeTree}
    </G>
  );
}

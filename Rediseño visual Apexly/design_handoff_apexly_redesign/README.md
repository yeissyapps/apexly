# Handoff: Rediseño visual Apexly — Dirección "Parrilla" (1a)

## Overview
Rediseño visual completo de Apexly (React Native + Expo, iOS/Android), un "Wordle de conducción" diario. Se exploraron 3 direcciones visuales para Inicio, Juego, Resultado y Ranking; el cliente eligió **1a — "Parrilla / timing tower"** como dirección base (referenciada en `mockups.html` como sección `#1a`). Las otras dos (`#1b` Clúster analógico, `#1c` Telemetría/HUD) quedan en el archivo como alternativas descartadas, no implementar salvo indicación.

## About the Design Files
El archivo `mockups.html` de este paquete es una **referencia de diseño hecha en HTML** — una maqueta estática que muestra la dirección de arte, layout y contenido pretendidos, no código de producción. La tarea es **recrear este diseño en el stack existente de Apexly** (React Native + Expo, con `react-native-svg` ya instalado) usando los patrones y componentes ya establecidos en el codebase — no incrustar HTML/WebView.

## Fidelity
**Alta fidelidad (hifi)**: colores exactos, tipografía, espaciados y contenido real (no lorem ipsum) están definidos. Recrear pixel-perfect adaptando a componentes nativos (View, Text, SVG) según los patrones ya usados en el proyecto.

## Sistema de diseño — Dirección 1a "Parrilla"
Referencia visual: cartón de notas de rally / panel de cronometraje motorsport. Negro casi puro, franjas de peligro diagonales naranja-negro como firma visual recurrente, esquinas rectas (sin border-radius en tarjetas internas), tipografía condensada muy pesada + monoespaciada tabular tipo cronómetro.

### Paleta
- Fondo app: `#0b0b0c` (casi negro, ligeramente más cálido que el `#0a0c0f` actual)
- Fondo tarjetas/paneles: `#0b0b0c` con separadores `#232324` (grid de 1px) o bordes `#2a2a2c`
- Texto principal: `#f2ede2` (crema cálido, no blanco puro)
- Texto secundario: `#a7a7a7` / `#8c8c8c` (labels, metadata)
- Texto terciario/deshabilitado: `#6f6f6f`
- **Naranja de marca** `#ff5a1f`: reservado SOLO para el CTA principal ("Jugar"/"Reintentar"), el segmento activo de la barra de progreso de sector, y el detalle del alerón/curbing del coche. Tras la iteración de color, se retiró de badges, tabs y textos secundarios para no saturar la pantalla — ahí se usa crema `#eae4d6`/`#f2ede2`.
- Dorado (1º puesto / récord): `#e8b23d`
- Plata (2º puesto): `#a7a7a7`
- Bronce (3º puesto): `#c07a3a`
- Verde mejora/récord nuevo: `#38d97a`
- Magenta "tú" / tu entorno en ranking: `#d63384` (reemplaza el morado `#b884ff` del sistema actual en esta dirección — confirmar con marca si se mantiene el morado o se adopta este magenta)
- Franja de peligro (motivo repetido): `repeating-linear-gradient(135deg, #ff5a1f 0 10px, #0b0b0c 10px 20px)`, usada como separador decorativo en Inicio y Ranking

### Tipografía
- Titulares / UI condensada: **Barlow Condensed**, pesos 600/700/800, siempre en mayúsculas para labels y nombres de circuito
- Tiempos / datos numéricos / metadata técnica: **IBM Plex Mono**, pesos 500–700, tabular — sustituye a la monoespaciada genérica anterior; mantiene el lenguaje "cronómetro" pero con más carácter que una mono de sistema
- Texto de apoyo (descripciones cortas): system-ui sans, 13–14px

### Motivos recurrentes
- Esquinas rectas (border-radius 0–2px) en tarjetas y botones — contraste deliberado frente a apps genéricas de "tarjetas redondeadas idénticas"
- Separadores de 1px de grid (`background:#232324` con `gap:1px` entre celdas) en vez de cards individuales con sombra
- Franjas diagonales naranja-negro como firma de marca en vez de gradientes difusos

## Screens / Views

### 1. Inicio
**Propósito**: hub diario — saludo, streak, circuito de hoy, condición climática, countdown a medianoche, acceso a jugar, vista compacta del ranking.

**Layout** (columna única, padding 20px 18px, gap 16px):
1. Franja diagonal decorativa de 6px de alto (naranja/negro), ancho completo — firma de marca en la cabecera
2. Fila: "Hola, {nombre}" (Barlow Condensed 800, 26px, mayúsculas) ↔ badge de racha ("RACHA {n}", IBM Plex Mono 700 11px, borde dorado `#e8b23d`, sin relleno)
3. Panel "Circuito de hoy" (borde 1px `#2a2a2c`, padding 14px, sin radius):
   - Label "CIRCUITO DE HOY" (mono 10px, letter-spacing .12em, `#8c8c8c`) + badge de intentos restantes ("3/3", fondo crema `#eae4d6`, texto negro)
   - Nombre del circuito generado (Barlow Condensed 800, 28px, color crema `#f2ede2`)
   - Subtítulo: "Generado para hoy · ~41s limpio" (system-ui 13px, `#a7a7a7`)
   - Fila de clima con separador superior: icono/indicador + texto (ej. "VIENTO · te empuja de lado"), mono 11px
4. Countdown: "Próximo circuito en **07:42:11**" (mono 11px, el valor del tiempo en `#f2ede2` 700) — cuenta atrás hasta las 00:00 hora local del dispositivo (usa `todayKey()` ya existente, sin lógica de zona horaria)
5. CTA "Jugar" — fondo naranja `#ff5a1f`, texto negro, Barlow Condensed 800 22px mayúsculas, padding 16px, ancho completo, sin radius
6. Label "RANKING DE HOY" (mono 10px)
7. Tabs GLOBAL / + GRUPO (borde 1px, GLOBAL activo con borde crema, GRUPO inactivo con borde discontinuo `#3a3a3a`)
8. **Podio compacto de 3 columnas** (P1/P2/P3): cada celda muestra avatar-identicon (ver sección Avatares), nombre, tiempo — separadas por grid de 1px `#232324`
9. Bloque "TU ENTORNO — SIEMPRE VISIBLE" (label mono 9px `#6f6f6f`): si el usuario no ha jugado hoy, muestra placeholder con borde magenta `#d63384` y texto "— · Juega para entrar"

### 2. Juego (HUD de carrera)
**Propósito**: HUD minimalista durante la carrera — cronómetro, progreso de circuito, clima, vista superior del circuito y coche.

**Layout**:
- **Header** (padding 14px 16px, borde inferior `#232324`):
  - Fila: "‹ SALIR" (mono 11px) ↔ **cronómetro grande** (mono 700, 30px para segundos enteros + 16px para centésimas, ej. "22.4" + "17" en gris) ↔ badge de clima (borde 1px, ej. "VIENTO")
  - **Barra de progreso segmentada por sectores** (no una barra continua): 4 segmentos de ancho proporcional al sector, el sector completado en crema `#eae4d6`, el sector activo en naranja `#ff5a1f`, los pendientes en gris oscuro `#2a2a2c` — resuelve el "hueco muerto" de la barra superior anterior dándole función real de progreso por sector
  - Fila inferior: "SECTOR 2/4" (mono 11px, `#6f6f6f`) ↔ "FANTASMA -0.31" (mono 11px 700, verde `#38d97a` si vas por delante de tu mejor vuelta, rojo si vas por detrás)
- **Vista de circuito** (área principal, flex:1, fondo `#0b0b0c`):
  - Pista vista cenital con `clip-path` trapezoidal simulando perspectiva, bordes con curbing rayado naranja/crema
  - Líneas de textura de asfalto sutiles (diagonales blancas al 10-18% opacidad) para dar sensación de velocidad/movimiento — clima "viento" no tiene overlay propio en esta dirección (se comunica solo por texto/badge); en las direcciones 1b/1c sí se visualiza lluvia (streaks azulados) y sol (glow + destellos), evaluar si se traslada ese lenguaje a 1a
  - **Coche en vista cenital tipo GT3, con piezas diferenciadas** (para futura personalización, ver sección Coche):
    1. Alerón trasero (barra superior con endplates laterales naranjas)
    2. Chasis/carrocería (forma trapezoidal crema con parabrisas más estrecho arriba)
    3. Difusor/parte trasera (banda oscura en la base con sombra de contacto)
    4. Retrovisores (dos rectángulos oscuros a los lados, altura del habitáculo)
    5. Faros (dos rectángulos blancos redondeados en el morro)
- **Footer** (padding 14px 16px, borde superior `#232324`): "IZQUIERDA GIRA ‹ · DERECHA GIRA ›" (mono 10px, centrado) — recuerda las dos zonas táctiles

### 3. Resultado
**Propósito**: feedback post-carrera — tiempo conseguido, posición, ranking contextual, acciones de reintentar/compartir.

**Layout** (gap 12px):
1. Badge superior condicional: "NUEVO RÉCORD" (fondo verde `#38d97a`, texto negro, mono 800 12px) — solo si aplica; si no es récord, mostrar variante neutra o delta vs. mejor marca
2. Tiempo final gigante (mono 800, 52px, verde si récord / crema si no)
3. Contexto: "{Circuito} — {puesto}.º de {total} en el mundo" (system-ui 14px, `#a7a7a7`)
4. CTA "Reintentar (n/3)" — mismo estilo que botón Jugar
5. Fila secundaria: "Compartir" / "Inicio" — botones outline 1px `#3a3a3a`, mitad de ancho cada uno
6. Sección "RANKING DE HOY": podio P1/P2/P3 igual que en Inicio
7. **Sección "TU ENTORNO — 4º-5º-6º" (o el tramo que corresponda, ver lógica de ranking abajo)**: fila de 3 celdas, la del usuario resaltada con borde magenta `#d63384` y fondo `#1a1210`

### 4. Ranking (pantalla dedicada)
**Propósito**: ranking completo con tabs Global/Grupo — resuelve el problema de "si vas 1º-3º no ves quién va 4º-6º".

**Layout**:
1. Título "Ranking" (Barlow Condensed 800 26px)
2. Tabs GLOBAL / AMIGOS GT (mismo patrón que en Inicio)
3. Label "LÍDERES · FIJO" (mono 9px, `#8c8c8c`) — **sección SIEMPRE fija, independiente de tu posición**:
   - Filas 01/02/03 con número de puesto (mono 800 16px, dorado/plata/bronce), avatar-identicon 20×20, nombre, tiempo — fondo `#0b0b0c`, separador de 1px `#232324` entre filas
4. Separador visual: franja diagonal decorativa de 6px (mismo motivo que en Inicio, versión fina)
5. Label "TU ENTORNO · SIEMPRE VISIBLE" (mono 9px)
6. **Bloque de entorno** — ver lógica exacta de casos borde abajo. Fila del propio usuario con fondo `#1a1210` y borde 1px magenta `#d63384`; el resto con fondo `#141414` sin borde.

## Lógica de ranking — "Líderes fijos" + "Tu entorno" (CRÍTICO, especificar con precisión)

El ranking se divide siempre en dos bloques independientes:

**Bloque A — Líderes (fijo, siempre 1º-2º-3º)**: nunca cambia según la posición del usuario. Es un podio/lista de exactamente 3 elementos.

**Bloque B — Tu entorno (siempre exactamente 3 personas, reglas por caso)**:
- **Si tu posición ≥ 5**: el bloque muestra (tú-1, **tú**, tú+1) — tú siempre en el centro.
- **Si tu posición == 4**: no tiene sentido repetir al 3º (ya está en el bloque A), así que el bloque muestra (4º, 5º, 6º) y tú apareces a la **izquierda**, no al centro.
- **Si tu posición ∈ {1, 2, 3}**: ya estás en el bloque A (líderes). El bloque B muestra a quien te persigue: (4º, 5º, 6º), **sin repetirte**.
- **Si eres el último del ranking global**: no hay nadie por debajo, así que el bloque se desplaza y tú quedas a la **derecha**: (últ-2, últ-1, **últ**).
- Si el usuario aún no ha jugado hoy: el bloque B muestra un placeholder ("— · Juega para entrar") en vez de datos.

Estos son los casos borde donde es fácil que la implementación se rompa (repetir un usuario en ambos bloques, o dejar el bloque B con menos de 3 personas) — verificar explícitamente con tests unitarios los 4 casos: posición 1-3, posición 4, posición ≥5 genérica, y posición = última.

## Avatares — Identicon determinista (reemplaza iniciales + color plano)
El sistema actual (`avatarColor(userId)`) da solo 2 letras + 1 de 10 colores posibles — poca variedad real. Nueva especificación:
- A partir del mismo hash usado hoy para `avatarColor(userId)`, derivar también una **forma/patrón geométrico simple** con lenguaje de casco de piloto: franjas diagonales, sectores partidos en diagonal, formas geométricas centradas (rombo, triángulo, círculo, cruz...).
- Implementar con `react-native-svg` (ya instalado) generando el patrón en cliente a partir del hash — sin servicio externo, sin subida de foto.
- Determinismo: mismo `userId` → siempre el mismo dibujo y color.
- En las maquetas se representa como un cuadrado dividido diagonalmente en dos tonos del mismo color-hash, con una forma blanca centrada (rombo/triángulo/círculo) que varía según el hash — usar esto como punto de partida, no como especificación final de las formas exactas (el desarrollador puede ampliar el set de patrones).
- Tamaños usados: 18-22px en listas/podio, 8-9px como badge superpuesto en avatares circulares (dirección 1b).

## Coche en vista cenital — piezas para personalización futura
El coche debe tener piezas diferenciadas (no una silueta única) para soportar personalización futura. Mínimo 5 partes reconocibles, cada una como elemento/capa independiente:
1. **Alerón trasero** con endplates laterales (color de acento — hoy naranja de marca)
2. **Chasis/carrocería** (forma principal, trapezoidal, más estrecha en el parabrisas)
3. **Difusor/parte trasera** (banda oscura en la base, con sombra de contacto suelo)
4. **Retrovisores** (dos elementos laterales a la altura del habitáculo)
5. **Faros** (dos elementos redondeados en el morro)

Recomendación de implementación: SVG con grupos nombrados por pieza (`<G id="wing">`, `<G id="body">`, etc.) para que cada parte pueda tener su propio color/skin cuando se implemente personalización.

## Clima — hacerlo visible, no solo textual
El brief pide que lluvia/sol/viento se noten visualmente en pantalla de juego, no solo como badge de texto:
- **Lluvia**: overlay azulado translúcido sobre la pista + streaks diagonales (líneas finas claras) simulando reflejo de agua
- **Sol**: glow radial cálido en una esquina + 2-3 destellos lineales cortos
- **Viento**: en esta dirección (1a) se comunica hoy solo por texto/badge — evaluar si conviene añadir un indicador visual (ej. líneas de racha horizontales) para consistencia con lluvia/sol

## Barra superior de carrera — rediseño del "hueco muerto"
Decisión de diseño (no pedida explícitamente, aplicada por criterio): la barra ya no es un elemento decorativo vacío — ahora es una **barra de progreso segmentada por sector** (ver Screen 2) que comunica en qué sector vas y cuánto queda del circuito, más el delta contra el fantasma justo debajo. Esto sustituye cualquier espacio muerto por información útil sin añadir más altura al HUD.

## Interactions & Behavior
- Tabs GLOBAL/GRUPO: cambian el dataset de "Líderes" y "Tu entorno" sin cambiar el layout
- CTA "Jugar"/"Reintentar": navega a pantalla de Juego; "Reintentar" respeta el contador de intentos restantes del día (3 por defecto)
- Countdown de Inicio: recalcula cada segundo hasta 00:00 local; al llegar a cero, refresca el circuito del día
- Zonas táctiles de giro: mitad izquierda/derecha de la pantalla de Juego (no hay elementos visuales de botón — son zonas invisibles, ya existente en el producto, mantener)

## Design Tokens
```
Colores
  --bg: #0b0b0c
  --panel-border: #2a2a2c
  --grid-line: #232324
  --text-primary: #f2ede2
  --text-secondary: #a7a7a7
  --text-tertiary: #8c8c8c
  --text-disabled: #6f6f6f
  --brand-orange: #ff5a1f     (uso restringido: CTA, sector activo, detalle coche)
  --gold-1st: #e8b23d
  --silver-2nd: #a7a7a7
  --bronze-3rd: #c07a3a
  --success-green: #38d97a
  --you-magenta: #d63384
  --cream: #eae4d6

Tipografía
  --font-display: 'Barlow Condensed' (600/700/800)
  --font-mono: 'IBM Plex Mono' (500/600/700)
  --font-body: system-ui

Radios: 0-2px en toda la UI (esquinas rectas es parte de la identidad)
Separadores: grid de 1px (#232324) entre celdas de listas, en vez de gap+shadow
```

## Assets
Ninguna imagen/foto — todos los avatares son SVG generativo (identicon), el coche es SVG por piezas, sin iconografía externa. Fuentes vía Google Fonts (Barlow Condensed, IBM Plex Mono) — ya enlazadas en el HTML de referencia.

## Files
- `mockups.html` — maqueta completa (3 direcciones × 4 pantallas). Implementar únicamente la sección marcada `id="1a"`.

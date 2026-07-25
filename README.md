# Circuito Diario — prototipo de control

Prototipo para validar el *feel* de conducir antes de construir nada más
(sin backend, sin leaderboard, sin monetización, sin arte). Un solo circuito
hardcodeado, un coche, cronómetro y reinicio.

## Arrancar

```bash
cd circuito-diario
npx expo start
```

Escanea el QR con **Expo Go** en el móvil. Se juega en portrait.

## Cómo se juega

- El coche **acelera solo** hasta un techo de velocidad.
- **Mitad izquierda** de la pantalla = girar a la izquierda; **mitad derecha**
  = girar a la derecha. No hay botones dibujados (zonas táctiles invisibles).
- A más velocidad, **gira menos** (curvas cerradas obligan a controlar la
  velocidad chocando o trazando).
- Al **chocar**: rebota, pierde velocidad y hay un breve aturdimiento en el
  que el volante no responde.
- El **cronómetro** cuenta desde que arrancas hasta cruzar la **meta**.
- Botón **↻ Reiniciar** arriba a la derecha.

## Tunear el "feel"  →  `src/config.js`

Todos los números ajustables viven ahí, comentados: aceleración, velocidad
máxima, relación velocidad→giro, ease del volante, pérdida de velocidad y
aturdimiento al chocar, tamaño del coche y del carril.

Dos flags útiles al final del config:

- `SHOW_TOUCH_HINTS`: dibuja una flecha sutil en cada zona táctil (para
  comparar con/sin pista visual).
- `SHOW_DEBUG`: dibuja las cajas de colisión y el vector de velocidad.

Cambia un valor, guarda (Fast Refresh recarga solo) y vuelve a probar.

## Cambiar el circuito  →  `src/track.js`

El trazado es la lista `CENTERLINE_NORM` (puntos 0..1). Mueve/añade puntos y
los muros y el asfalto se regeneran solos.

## Arquitectura (2 minutos)

- **Movimiento del coche**: lógica propia en `stepSimulation()` (App.js).
  Aceleración, giro con ease-in/out y dependencia velocidad→giro.
- **Colisión**: Matter.js **solo** para detectar el choque y su normal
  (`Matter.Query.collides`). El rebote/aturdimiento los aplicamos nosotros;
  no usamos la física rígida de Matter para el control.
- **Render**: `react-native-svg` con un `viewBox` en unidades de mundo, así
  los números del config se sienten igual en cualquier móvil. Bucle con
  `requestAnimationFrame`; solo el coche y el HUD se repintan cada frame.

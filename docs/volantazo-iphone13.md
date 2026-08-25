# El volantazo fantasma del iPhone 13

Estado a 25/08/2026: **sin resolver, y descartado que sea código.**

Este documento existe porque la investigación entera vivía en comentarios
dentro de `src/config.js` y `src/Game.js`, y el revert que devolvió el código
al estado de la 2.4.0 de Android se los llevó por delante. Sin esto, la
próxima persona que vea el bug —incluido yo— vuelve a empezar por el mismo
sitio equivocado.

## El síntoma

En algunos iPhone, el coche da un giro brusco que el jugador no ha pedido.
JC lo llama "latigazo" o "volantazo".

## Quién falla y quién no

| Dispositivo | Falla |
|---|---|
| iPhone 13 (A15, panel 60 Hz) | Sí, y es la mayoría de los jugadores |
| iPhone 15 Pro (A17, ProMotion 120 Hz) | Nunca |
| iPhone 17 (A19, ProMotion 120 Hz) | Nunca |
| Android | Nunca reportado |

Falla igual en la build 21 (producción, sin botones) y en las betas 50-64
(con botones). Falla en seco, con lluvia y con viento.

## Hipótesis probadas y descartadas

Cada una costó al menos un build:

1. **Reconstrucción de la duración del toque** — `MAX_PULSO_CATCHUP_MS`,
   después remate fijo con `MIN_INPUT_MS`. No lo arregló.
2. **Zona táctil única contra dos botones** — se probaron las dos. Falla con
   ambas.
3. **Cercanía al borde de pantalla** (gestos del sistema iOS reteniendo el
   toque) — botones alejados de 18 a 50px. No lo arregló.
4. **Bloqueo del hilo** — Sentry con detección de App Hang más un vigilante
   propio en JS. Dos herramientas independientes, ninguna detectó nada
   durante el volantazo.
5. **Carga de render del clima** — 52 animaciones de lluvia y 22 de viento
   reescritas a 3 y 3. JC: "sigue funcionando mal en seco".
6. **Las tres funciones nuevas en carrera** (hápticos, coche del líder,
   anuncios) — bisecadas con interruptores. JC: "va un poco mejor pero no del
   todo fino".
7. **El rebote de la colisión** — ver abajo. Tope de 30° al giro del choque.
   Probado en la build 74: sigue igual.

## El único dato duro que tenemos

Grabación de diagnóstico de la build 73, iPhone 13, 26,6 s y 1709 frames:

- `fps 60 (mín 60) · sub-pasos máx 3 · frames al límite 0` → **no es
  rendimiento**. El bucle de física nunca se saturó.
- Ninguna marca de `*** GIRO FANTASMA (0 dedos) ***` → **no es entrega de
  toques**. El motor nunca giró sin dedos en pantalla.
- Los seis eventos de `VOLANTAZO` cayeron **en el mismo milisegundo** que un
  `TOCA muro`, con saltos de rumbo de 59°, 65°, 76° y 85° en un solo frame.
- 8 impactos y 2851 ms de contacto con el muro en 26 s (11 % del tiempo).

De ahí salió la hipótesis 7: el "volantazo" que ve el jugador **es el rebote
de la colisión**, `s.heading = Math.atan2(rvy, rvx)` reescribiendo el rumbo de
golpe. Se le puso un tope de 30° (`CRASH_MAX_TURN_DEG`) y **siguió fallando**,
así que la hipótesis tampoco se sostiene por sí sola.

Queda en pie la correlación, que sí es sólida: el iPhone 13 va a 60 Hz contra
los 120 Hz de los que no fallan, o sea el doble de latencia de entrada. Más
latencia significa más contacto con el muro, y el contacto con el muro es
donde aparecen los saltos de rumbo.

## Herramientas que quedan en el repo

- `CONFIG.DIAG` en `src/config.js`. En `true` graba la partida y JC puede
  compartir el registro desde la pantalla de resultado. **Es lo primero que
  hay que encender**, antes de proponer ninguna teoría. Este documento existe
  en buena parte porque no se hizo así.

## Decisión de JC (25/08/2026)

> "Está claro que lo que sea que afecta a los iPhone 13 no es código. El
> código funciona. Necesito de una vez tener una versión buena y poder
> compartirla con el mundo."

Se deja de perseguir. La 2.4.1 sale con el código de la 2.4.0 de Android en
las dos tiendas.

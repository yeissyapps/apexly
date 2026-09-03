# Notas para App Review (Apple) — copiar en las Review Notes de cada envío

Estas notas existen por un rechazo real, y hay que pegarlas **en cada envío
a la App Store**. Sin ellas, el revisor vuelve a llegar a la misma conclusión
equivocada.

---

## Qué pasó (2.4.0, build 64, 21-08-2026)

Rechazo por **Guideline 5.1.2(i)** — el revisor concluyó que la app no pide
permiso de seguimiento antes de rastrear.

**La app SÍ lo pide.** `src/ads.js` llama a `requestTrackingPermissionsAsync()`
después del formulario UMP y **antes** de inicializar el SDK de AdMob, que es
el orden que exige Apple (el SDK lee el identificador al inicializarse, así
que pedirlo después no serviría de nada).

El problema era *dónde* estaba: dentro de `ensureAds()`, que solo se disparaba
desde `showRewarded()`. Para ver el diálogo había que gastar los 3 intentos del
día y elegir ver un anuncio. El revisor jugó en un iPad Air y no llegó nunca,
así que no vio la petición.

**Ya corregido** (commit `fb642a4`, en la 2.4.1): ahora se pide nada más
terminar UNA vuelta, sea cual sea el resultado — no hace falta agotar
intentos ni tocar "Ver anuncio". El texto de más abajo ya refleja esto.

**Y las etiquetas de privacidad son correctas**: la app sí rastrea. Los
anuncios son personalizados desde el commit `7b4ce25`, que quitó
`requestNonPersonalizedAdsOnly` — con NPA forzado el eCPM de iOS era 0,24 €
contra 3,63 € en Android, 15 veces menos.

## Qué pasó (2.4.1, build 75, 02-09-2026)

Segundo rechazo, esta vez **Guideline 2.1 - Information Needed**: "unable to
locate the App Tracking Transparency permission request", revisado en un
iPad Air 11" (M3) con iPadOS 26.6. Apple pide una **grabación de pantalla en
dispositivo real** demostrando el diálogo, adjunta en las Notes.

Esta vez SÍ había un bug de verdad, no solo un problema de dónde mirar.
Dentro de `ensureAdsReady()` (`src/ads.js`), la comprobación de si el
formulario de consentimiento UMP permitía pedir anuncios (`canRequestAds`)
vivía **antes** de la línea que pide ATT, con un `return false` en medio. Si
esa comprobación salía en `false` — denegado, o el valor por defecto en
ciertas regiones o cuentas, plausible en el entorno de revisión de Apple —
la función salía sin haber llegado nunca a pedir el permiso de seguimiento.

**Corregido** (commit `5be5b63`): el permiso de seguimiento ya no depende de
si luego se puede servir un anuncio o no. Se pide siempre, justo después del
formulario UMP, tal y como estaba pensado desde el principio.

## Qué pasó (2.4.2, build 79, tercer y cuarto rechazo, 02 y 03-09-2026)

Mismo texto exacto, dos veces seguidas, en DOS iPads distintos (Air M3 y
luego Air M4) — mismo submission ID, así que la segunda vez fue Apple
re-revisando tras nuestra respuesta en el Resolution Center, no un envío
nuevo. Con el bug de `canRequestAds` ya arreglado y una grabación real de
iPhone (vista por JC, el diálogo salía claro) adjunta desde el primer
intento, esto dejó de parecer un bug de lógica del código.

Investigado contra reportes públicos (Apple Developer Forums, GitHub de
Expo): es un patrón conocido, no exclusivo de esta app — afecta también a
Flutter, Cordova y React Native puro. Un desarrollador identificó la causa
en un caso similar: si la petición de UI de sistema (ATT) se dispara desde
un callback asíncrono que no nace dentro de un toque real del usuario, iOS
puede ignorarla en silencio — el código "la pide" pero nunca se presenta.

Nuestra llamada vivía exactamente ahí: dentro del handler de fin de vuelta,
disparado por el bucle de física (`requestAnimationFrame`), nunca dentro de
un `onPress`. Movida (App.js) a los botones de la pantalla de resultado —
"Reintentar"/"Otra vuelta", "Inicio", o cerrar el resultado de Carrera/GP—
así la llamada real a `requestTrackingPermissionsAsync()` ocurre síncrona
dentro de un toque de verdad. Sigue siendo "después de correr, no al
arrancar" — el contexto que sostiene la tasa de aceptación no cambia, solo
CUÁNDO exactamente dentro de ese momento se hace la llamada nativa.

## Por qué NO se mueve el diálogo al arranque

Sería la forma fácil de que el revisor tropiece con él, pero pedir permiso
antes de que el jugador entienda para qué hunde la tasa de aceptación, y eso
pega justo donde ya se midió el daño (los 15x de arriba). Apple contempla
explícitamente la alternativa: *"indicate in the Review Notes where the
permission request is located"*. Es lo que hacemos.

---

## TEXTO A PEGAR EN REVIEW NOTES

```
This app uses the AppTrackingTransparency framework. The permission request is
presented before the Google Mobile Ads SDK is initialized, so no advertising
identifier is accessed before the user responds.

The prompt is shown at the first moment the app uses advertising, rather than
on first launch. How to reach it:

1. Open the app and complete the short name entry.
2. Play one lap on the daily circuit (or in Career / Grand Prix) — no need
   to run out of attempts or watch an ad first.
3. On the results screen, tap any button ("Reintentar"/"Otra vuelta" to
   retry, or "Inicio" to go back). The App Tracking Transparency prompt is
   displayed at that point, before the tap's own action completes.

Note for EEA/UK/Switzerland reviewers: a Google UMP consent form is shown
immediately before the ATT prompt, in that order.

The app has no login and no paid content gate; everything is reachable from a
fresh install without credentials.
```

**Añadir SOLO en el próximo envío** (el que lleve el fix del `onPress` —
build 79 y anteriores NO lo llevan; en envíos posteriores a ese, si no hay
nada nuevo que demostrar, quitar este párrafo):

```
Between the previous submission and this one we made two fixes, in order:

1. The ATT request could previously be skipped if the Google UMP consent
   form determined ads could not be requested. Fixed: the tracking
   permission request no longer depends on whether an ad can subsequently
   be shown.

2. The ATT request was triggered from an asynchronous callback (fired by
   our game loop when a lap finishes) rather than from within a user tap.
   We found this matches a known pattern reported by other teams (React
   Native, Flutter, Cordova apps) where iOS can silently decline to present
   system UI — including the ATT prompt — when requested outside of a
   direct user gesture, even though the call itself does not error. The
   request is now made synchronously inside the onPress handler of the
   results-screen buttons (see updated steps above), while keeping the same
   timing philosophy (after a lap, not on first launch).

We verified the current build shows the prompt reliably on a physical
iPhone after a fresh install and a tracking-permissions reset. A screen
recording of that test is attached.
```

---

## Si vuelven a rechazar por lo mismo

Antes de tocar código, comprobar en App Store Connect que las etiquetas de
privacidad siguen coincidiendo con la realidad: la app **sí** recopila el
identificador de publicidad y **sí** lo usa para rastrear. Si algún día se
vuelve a forzar NPA, entonces las etiquetas dejan de ser ciertas y hay que
cambiarlas — y ese es un cambio de App Store Connect, no de código.

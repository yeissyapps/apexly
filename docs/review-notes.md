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

El problema es *dónde* está: dentro de `ensureAds()`, que solo se dispara desde
`showRewarded()`. Para ver el diálogo hay que gastar los 3 intentos del día y
elegir ver un anuncio. El revisor jugó en un iPad Air y no llegó nunca, así que
no vio la petición.

**Y las etiquetas de privacidad son correctas**: la app sí rastrea. Los
anuncios son personalizados desde el commit `7b4ce25`, que quitó
`requestNonPersonalizedAdsOnly` — con NPA forzado el eCPM de iOS era 0,24 €
contra 3,63 € en Android, 15 veces menos.

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
2. Play three laps on the daily circuit (three free attempts per day).
3. After the third lap, the "no attempts left" screen appears.
4. Tap "Ver anuncio" (Watch ad).
5. The App Tracking Transparency prompt is displayed at this point.

Note for EEA/UK/Switzerland reviewers: a Google UMP consent form is shown
immediately before the ATT prompt, in that order.

The app has no login and no paid content gate; everything is reachable from a
fresh install without credentials.
```

---

## Si vuelven a rechazar por lo mismo

Antes de tocar código, comprobar en App Store Connect que las etiquetas de
privacidad siguen coincidiendo con la realidad: la app **sí** recopila el
identificador de publicidad y **sí** lo usa para rastrear. Si algún día se
vuelve a forzar NPA, entonces las etiquetas dejan de ser ciertas y hay que
cambiarlas — y ese es un cambio de App Store Connect, no de código.

# Nota para el revisor — build 80, sin ATT

Reemplaza al contenido (obsoleto) de `review-notes.md`. Pegar en **Notes**
de App Review Information si el campo sigue editable en esta submission; si
ya está bloqueada, mandarlo como respuesta en el hilo del Resolution Center
para que quede asociado a esta build.

---

```
Hello,

Following previous feedback on this app regarding App Tracking Transparency
(Guideline 2.1), we want to let you know that as of this build we have
removed tracking-based advertising entirely.

The app no longer uses the AppTrackingTransparency framework or requests
tracking permission anywhere. Ads are now served as non-personalized only
(AdMob requestNonPersonalizedAdsOnly), with no advertising identifier used
for tracking purposes. We have updated the App Privacy answers in App Store
Connect accordingly to reflect that the app does not track users.

No further action is needed regarding ATT — there is no prompt to locate,
as the app simply does not implement it in this build. Thank you for your
time reviewing.
```

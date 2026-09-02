# Respuesta en el Resolution Center — 2.4.2, tercer rechazo idéntico

Pegar tal cual como respuesta al mensaje de Apple en App Store Connect
(Resolution Center → hilo de esta submission). Vuelve a adjuntar el mismo
vídeo del iPhone por si acaso, aunque ya se adjuntó una vez.

---

```
Hello,

Thank you for reviewing again. We want to make sure we understand the
situation correctly before submitting another build, since this is the
third rejection citing the same issue (Guideline 2.1, ATT permission
request not located), always on an iPad Air review device.

We have verified the following on our end, on a physical iPhone:

1. After a fresh install and resetting tracking permissions (Settings >
   General > Transfer or Reset iPhone > Reset > Reset Location & Privacy),
   we launched the app, played one lap on the daily circuit, and the App
   Tracking Transparency prompt appeared immediately after the lap finished
   — before any advertising SDK initialization. We recorded this and
   attached the video to a previous submission's Review Notes.

2. Between our first and second submission, we found and fixed a real bug:
   the ATT request was previously gated behind a Google UMP consent check
   (canRequestAds), so if that check resolved to false, ATT was never
   requested. This is fixed as of the current build — ATT is now requested
   unconditionally, right after the UMP consent form and before the ads SDK
   initializes.

Given the prompt is confirmed working on a physical iPhone but still not
appearing during review on iPad, we would like to ask two things to help us
diagnose whether this is device- or account-specific rather than a code
issue:

- Was the reviewer able to fully complete one lap of the daily circuit
  (reach the results screen) before waiting for the prompt? The prompt is
  triggered right after a lap finishes, not on app launch — if the lap
  never completes for any reason, the prompt would never have a chance to
  appear.

- Is "Allow Apps to Request to Track" enabled in Settings > Privacy &
  Security > Tracking on the review device? If that system-wide toggle is
  off, no app can present the ATT dialog, regardless of implementation.

We are attaching the iPhone recording again for reference. We are happy to
provide any additional recording, build, or information that would help
pinpoint what's different about the iPad review environment. Thank you for
your help.
```

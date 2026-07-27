# Apexly

Juego móvil de contrarreloj diaria: **cada día un circuito nuevo**, generado igual
para todo el mundo, y todos compiten por el **mejor tiempo**. Estilo "Wordle de
conducción" — un reto al día, piques con amigos y clasificaciones.

Conducción cenital de precisión: el coche acelera solo, tú solo gestionas el
volante y la velocidad para no chocar. Condiciones meteorológicas del día, coche
fantasma de tu mejor vuelta, grupos, rachas y ranking global.

## Stack

- **React Native + Expo** (SDK 57)
- **react-native-svg** (pista y coche vectoriales, cámara)
- **Supabase** (auth anónima, tiempos, grupos, rachas)
- **AdMob** (anuncios recompensados) + IAP (intentos ilimitados)

## Arrancar

Como usa módulos nativos (AdMob, view-shot), necesita un *dev build* (no basta
Expo Go):

```bash
npm install
npx expo run:android   # o run:ios (requiere macOS)
```

## Estructura

- `src/generator.js` — genera el circuito determinista del día (por fecha).
- `src/Game.js` — el juego: física, cámara, colisión, render, clima, fantasma.
- `src/config.js` — todas las constantes de *feel* (aceleración, giro, colisión…).
- `src/api.js` — capa de datos Supabase (identidad anónima, tiempos, leaderboard).
- `src/Leaderboard.js` — ranking de grupo y global (podio + tu ventana).
- `src/weather.js` — clima diario y sus efectos sobre el coche.
- `supabase/` — esquema SQL y Edge Function de notificaciones.

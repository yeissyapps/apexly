import { registerRootComponent } from 'expo';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Sentry from '@sentry/react-native';

import App from './App';

// Experimento del volantazo fantasma en iOS (ver historial de src/Game.js y
// src/config.js): sabemos que el timestamp NATIVO de pulsar/soltar y lo que
// procesa JS no cuadran (60-360ms sin explicar en la última medición), pero
// los frames de JS van finos — así que no es el hilo JS bloqueado por
// nuestro código, es algo antes de que el evento nos llegue. La detección de
// "app hang" de Sentry vigila el hilo principal NATIVO y, si se congela,
// manda la traza real de qué estaba haciendo el sistema en ese instante —
// algo que nunca hemos podido ver desde JS.
//
// El umbral por defecto es 2s (pensado para congelaciones de verdad); lo
// bajamos a 0,2s porque nuestra ventana es de cientos de ms, no segundos. Si
// genera demasiado ruido (bloqueos irrelevantes de carga/arranque, etc.) hay
// que subirlo — esto es un experimento, no una config definitiva.
Sentry.init({
  dsn: 'https://c96c7de148c64f964e978901c8e1aaf8@o4511939029106688.ingest.de.sentry.io/4511939032711248',
  appHangTimeoutInterval: 0.2,
});

function Root() {
  return (
    <SafeAreaProvider>
      <App />
    </SafeAreaProvider>
  );
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(Sentry.wrap(Root));

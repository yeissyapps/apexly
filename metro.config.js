const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);

// Avatares de piloto (visor 3D, ver src/PilotViewer.js): Metro no empaqueta
// .glb/.gltf como asset por defecto — sin esto, require('...glb') resuelve
// a texto/undefined en vez de al fichero binario. Mismo fix ya probado en
// la rama beta3d.
config.resolver.assetExts.push('glb', 'gltf');

module.exports = config;

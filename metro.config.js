const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);

// Beta 3D (ver plan en C:\Users\JC\.claude\plans\ticklish-dazzling-wand.md):
// Metro no empaqueta .glb por defecto — sin esto, require('...race.glb')
// resuelve a texto/undefined en vez de al asset.
config.resolver.assetExts.push('glb', 'gltf');

module.exports = config;

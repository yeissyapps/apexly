// ============================================================================
//  Config plugin: inyecta la firma de producción (upload key) en cada
//  `expo prebuild`, para que no se pierda cuando android/ se regenera.
//
//  Lee las credenciales de `keystore.properties` (raíz del proyecto, fuera de
//  git) y añade un signingConfigs.release a android/app/build.gradle. Si el
//  archivo no existe (p. ej. en la máquina de otro dev sin la keystore), cae
//  al firmado de debug para no romper el build.
// ============================================================================

const { withAppBuildGradle } = require('@expo/config-plugins');

const SIGNING_SNIPPET = `
def keystorePropertiesFile = rootProject.file("../keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
`;

function withAndroidSigning(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    if (!contents.includes('keystorePropertiesFile')) {
      // Inserta la lectura de keystore.properties justo antes de `android {`
      contents = contents.replace(/\napply plugin:.*\n/, (m) => m + SIGNING_SNIPPET);
    }

    // Añade signingConfigs.release (con fallback a debug si no hay properties file)
    if (!contents.includes('signingConfigs.release')) {
      contents = contents.replace(
        /signingConfigs\s*\{\s*debug\s*\{[^}]*\}\s*\}/,
        (m) => `${m.replace(/\}\s*$/, '')}
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            } else {
                storeFile file('debug.keystore')
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
            }
        }
    }`
      );
      // Hay VARIOS "release {" en el archivo (el que acabamos de insertar en
      // signingConfigs, y el de buildTypes) y DOS "signingConfig
      // signingConfigs.debug" (debug y release) -> anclamos a "buildTypes {"
      // primero para no confundir el bloque de signingConfigs con el correcto.
      contents = contents.replace(
        /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?signingConfig signingConfigs)\.debug/,
        '$1.release'
      );
    }

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = withAndroidSigning;

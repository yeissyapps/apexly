// ============================================================================
//  Config plugin: inyecta la firma de producción (upload key) en cada
//  `expo prebuild`, para que no se pierda cuando android/ se regenera.
//
//  Lee las credenciales de `keystore.properties` (raíz del proyecto, fuera de
//  git) y añade un signingConfigs.release a android/app/build.gradle.
//
//  Si el archivo NO existe: las tareas de release revientan con un mensaje
//  claro, y las de debug siguen funcionando con la keystore de debug. Antes
//  caía a debug siempre, también en release — y eso significaba que compilar
//  en una máquina sin la keystore te daba un AAB "correcto" firmado con la
//  clave de debug, sin un solo aviso, que Play rechaza al subirlo.
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

    // Añade signingConfigs.release. Sin keystore.properties, release peta y
    // debug sigue vivo (ver cabecera).
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
                // signingConfigs se evalua SIEMPRE, tambien al compilar debug,
                // asi que no se puede lanzar el error aqui sin romperle el
                // debug a quien no tenga la keystore. Miramos que tareas se han
                // pedido de verdad y solo cortamos si alguna es de release.
                def wantsRelease = gradle.startParameter.taskNames.any {
                    it.toLowerCase().contains('release')
                }
                if (wantsRelease) {
                    throw new GradleException(
                        "No hay keystore.properties en la raiz del proyecto, asi que esta release " +
                        "se firmaria con la keystore de DEBUG y Play la rechazaria. Copia " +
                        "keystore.properties y el .jks que apunta (los dos estan fuera de git) " +
                        "antes de compilar release."
                    )
                }
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
      // El "=" es opcional: la plantilla de Gradle lo ha usado con y sin él
      // según la versión de Expo/RN (visto romperse en el cambio a SDK 57.0.9).
      contents = contents.replace(
        /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?signingConfig\s*=?\s*signingConfigs)\.debug/,
        '$1.release'
      );
    }

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = withAndroidSigning;

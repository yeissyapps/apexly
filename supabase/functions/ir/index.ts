// ============================================================================
//  Edge Function: ir  — redirector público a la tienda que toque.
//
//  Es el enlace que viaja en los mensajes compartidos ("comparte tu vuelta").
//  Un solo link para las dos plataformas: mira el User-Agent de quien lo abre
//  y le manda a Play Store o a App Store.
//
//  Por qué existe, en vez de pegar las dos URLs en el mensaje:
//   - Una tarjeta compartida acaba en un grupo con gente de Android y de
//     iPhone a la vez. Dos enlaces obligan a cada uno a elegir el suyo.
//   - Los previsualizadores (WhatsApp, Telegram) SIGUEN la redirección y
//     pintan la ficha de destino, así que en el chat se ve el icono y el
//     nombre de la app, no este dominio. Por eso el enlace puede ser feo.
//   - El día que haya dominio propio, se cambia SHARE_LINK en src/links.js y
//     esto se queda como está.
//
//  OJO AL DESPLEGAR: esto lo abre un navegador sin sesión, así que hay que
//  saltarse la verificación de JWT que Supabase pone por defecto:
//
//      supabase functions deploy ir --no-verify-jwt
//
//  Sin ese flag, el enlace devuelve 401 a todo el mundo.
// ============================================================================

const BUNDLE_ID = 'com.yeissyapps.circuitodiario';
const PLAY_URL = `https://play.google.com/store/apps/details?id=${BUNDLE_ID}`;

// El id numérico de App Store no se puede construir desde el bundle id (lo
// asigna Apple), así que se resuelve con la API pública de iTunes y se cachea
// mientras la instancia siga viva. Si falla, se cae a la búsqueda de App
// Store: peor experiencia, pero nunca un enlace roto.
let cachedAppStore: string | null = null;

async function appStoreUrl(): Promise<string> {
  if (cachedAppStore) return cachedAppStore;
  try {
    const res = await fetch(`https://itunes.apple.com/lookup?bundleId=${BUNDLE_ID}`);
    const json = await res.json();
    const url = json?.results?.[0]?.trackViewUrl;
    if (url) {
      cachedAppStore = url;
      return url;
    }
  } catch (_) {
    // cae a la búsqueda
  }
  return 'https://apps.apple.com/search?term=apexly';
}

Deno.serve(async (req) => {
  const ua = (req.headers.get('user-agent') || '').toLowerCase();

  // iPhone/iPad -> App Store. Android -> Play. Cualquier otra cosa (un
  // ordenador, y sobre todo los bots de previsualización de WhatsApp y
  // compañía) -> Play, que es la ficha con mejor previsualización y la que
  // más gente del grupo va a poder abrir.
  const isApple = /iphone|ipad|ipod/.test(ua) && !/android/.test(ua);
  const target = isApple ? await appStoreUrl() : PLAY_URL;

  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      // Sin caché: el destino depende del User-Agent, y un intermediario que
      // guarde la respuesta de un Android se la serviría luego a un iPhone.
      'Cache-Control': 'no-store',
    },
  });
});

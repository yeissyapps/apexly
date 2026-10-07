// ============================================================================
//  Textos de las notificaciones push en español e inglés, y lectura de tokens
//  con su idioma (2026-10-07: la app se puede usar en inglés).
//
//  El idioma va guardado por DISPOSITIVO en push_tokens.lang (lo manda la app
//  al registrar el token, ver supabase/push_lang.sql): un aviso se manda a un
//  móvil, así que es el idioma de ese móvil el que cuenta.
//
//  Compartido por todas las funciones que mandan avisos (las Edge Functions
//  pueden importar de _shared/ con ruta relativa).
// ============================================================================

export type Lang = 'es' | 'en';

const TEXTS: Record<string, Record<Lang, string>> = {
  overtake: {
    es: '{name} te ha superado. ¿Lo vas a permitir?',
    en: '{name} just overtook you. Are you going to let that happen?',
  },
  gpOvertake: {
    es: '{name} te ha superado en la ronda {n}. ¿Lo vas a permitir?',
    en: '{name} overtook you in round {n}. Are you going to let that happen?',
  },
  duelChallenge: {
    es: '{name} te reta a una carrera por {n} monedas. ¿Aceptas?',
    en: '{name} challenges you to a race for {n} coins. Do you accept?',
  },
  duelAccepted: {
    es: '{name} ha aceptado tu reto — tienes 15 minutos para correr.',
    en: '{name} accepted your challenge — you have 15 minutes to race.',
  },
  reminderStreak: {
    es: 'Tu racha de {n} días se rompe a medianoche. Una vuelta y la salvas.',
    en: 'Your {n}-day streak breaks at midnight. One lap saves it.',
  },
  reminder: {
    es: 'El circuito de hoy desaparece a medianoche, y el reto del día con él. ¿Una vuelta?',
    en: "Today's circuit disappears at midnight, and the daily challenge with it. One lap?",
  },
  gpFinished: {
    es: '¡Terminado! {podium}',
    en: 'Finished! {podium}',
  },
  gpNoResults: {
    es: 'Sin resultados esta vez.',
    en: 'No results this time.',
  },
  gpRoundOpen: {
    es: 'Circuito {n}/{total} ya disponible.',
    en: 'Circuit {n}/{total} is now open.',
  },
  gpLastChance: {
    es: 'Últimas horas para clasificar en el circuito de hoy.',
    en: "Last hours to qualify on today's circuit.",
  },
  someone: { es: 'Alguien', en: 'Someone' },
};

export function pushText(lang: string | null | undefined, key: string, params: Record<string, unknown> = {}): string {
  const l: Lang = lang === 'en' ? 'en' : 'es';
  const s = TEXTS[key]?.[l] ?? TEXTS[key]?.es ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
}

// Tokens (con idioma) de unos usuarios, sin repetir dispositivo. Si la columna
// `lang` aún no existe (SQL sin correr), cae a leer solo el token: el aviso
// sale en español, como antes, en vez de no salir.
export async function tokensFor(admin: any, userIds: string[]): Promise<{ user_id: string; token: string; lang: Lang }[]> {
  if (userIds.length === 0) return [];
  let res = await admin.from('push_tokens').select('user_id, token, lang').in('user_id', userIds);
  if (res.error) res = await admin.from('push_tokens').select('user_id, token').in('user_id', userIds);
  const seen = new Set<string>();
  return (res.data ?? [])
    .filter((t: any) => t.token && !seen.has(t.token) && seen.add(t.token))
    .map((t: any) => ({ user_id: t.user_id, token: t.token, lang: t.lang === 'en' ? 'en' : 'es' }));
}

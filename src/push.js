// ============================================================================
//  Push — registro del token de notificación del dispositivo.
//
//  Pide permiso, obtiene el Expo push token y lo guarda en `push_tokens`. La
//  Edge Function `notify-overtakes` lo usa para avisar cuando te superan.
// ============================================================================

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import { supabase } from './supabase';
import { ensureSession } from './api';

const EAS_PROJECT_ID = '93215df9-b32e-46ce-b086-f562f66db6f3';

// Cómo se muestran las notificaciones con la app en primer plano.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Pre-aviso propio antes del diálogo del sistema. El del sistema solo se puede
// denegar una vez de verdad (en iOS, para siempre), así que no se lanza en
// frío: primero se ofrece en el Resultado de la primera vuelta, con el motivo
// delante, y solo si el jugador dice que sí se pide el permiso. Un "Ahora no"
// no gasta el diálogo del sistema; se vuelve a ofrecer una vez más y ya.
const OFFER_KEY = 'push:offer:v1';
const MAX_OFFER_DISMISSALS = 2;

async function offerDismissals() {
  try { return Number(await AsyncStorage.getItem(OFFER_KEY)) || 0; } catch (_) { return 0; }
}

// Solo si el permiso está sin decidir: 'granted' no necesita oferta y
// 'denied' no se puede revertir desde la app.
export async function shouldOfferPush() {
  try {
    if ((await offerDismissals()) >= MAX_OFFER_DISMISSALS) return false;
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'undetermined';
  } catch (_) {
    return false;
  }
}

export async function notePushOfferDismissed() {
  try { await AsyncStorage.setItem(OFFER_KEY, String((await offerDismissals()) + 1)); } catch (_) {}
}

// `prompt: false` = solo refresca el token si el permiso YA está concedido,
// sin sacar nunca el diálogo del sistema (arranque de la app).
export async function registerPushToken({ prompt = true } = {}) {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Apexly',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted' && prompt) {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return null;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
    if (!token) return null;

    await ensureSession();
    // Por RPC y no por upsert directo: además de guardar el token, suelta las
    // identidades anteriores que colgaban de este mismo móvil. El upsert de
    // antes solo tocaba tu fila, así que cada reinstalación dejaba una
    // identidad huérfana apuntando al mismo token — hasta once llegaron a
    // acumularse en un solo dispositivo, y eso hacía que el recordatorio de
    // las 20:00 llegara aunque hubieras jugado.
    // Ver supabase/register_push_token.sql.
    await supabase.rpc('register_push_token', { p_token: token });
    return token;
  } catch (e) {
    return null; // sin push no pasa nada crítico
  }
}

// ============================================================================
//  Push — registro del token de notificación del dispositivo.
//
//  Pide permiso, obtiene el Expo push token y lo guarda en `push_tokens`. La
//  Edge Function `notify-overtakes` lo usa para avisar cuando te superan.
// ============================================================================

import { Platform } from 'react-native';
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

export async function registerPushToken() {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Circuito Diario',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return null;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
    if (!token) return null;

    const user = await ensureSession();
    await supabase
      .from('push_tokens')
      .upsert({ user_id: user.id, token, updated_at: new Date().toISOString() });
    return token;
  } catch (e) {
    return null; // sin push no pasa nada crítico
  }
}

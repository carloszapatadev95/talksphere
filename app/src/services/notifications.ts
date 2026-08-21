import { Platform, Alert } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import api from './api';
import { debug } from '../utils/debug';
import { Colors } from '../theme';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  debug.log('[Push] registerForPushNotifications started');

  if (Platform.OS === 'web') {
    debug.log('[Push] Web — push notifications no disponibles sin VAPID');
    return null;
  }

  if (!Device.isDevice) {
    debug.log('[Push] SIMULADOR detectado — push notifications no disponibles');
    debug.log('[Push] Para probar push, ejecuta en un dispositivo físico o usa "expo run:android --variant release"');
    return null;
  }

  // Android: create notification channel BEFORE requesting permissions
  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Notificaciones generales',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: Colors.primary,
      });
      debug.log('[Push] Canal Android "default" creado');
    } catch (channelErr) {
      console.error('[Push] Error al crear canal Android:', channelErr);
    }
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  debug.log('[Push] Permiso actual:', existingStatus);
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    debug.log('[Push] Solicitando permiso de notificaciones...');
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
    debug.log('[Push] Nuevo permiso:', finalStatus);
  }

  if (finalStatus !== 'granted') {
    console.warn('[Push] Permiso de notificaciones DENEGADO');
    return null;
  }

  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as any).easConfig?.projectId;

    if (!projectId) {
      console.error('[Push] ERROR: Falta projectId. Debes configurar extra.eas.projectId en app.json');
      console.error('[Push] Crea un proyecto en https://expo.dev y agrega:');
      console.error('[Push]   "extra": { "eas": { "projectId": "tu-project-id" } }');
      console.error('[Push] O usa "npx eas init" para configurarlo automáticamente.');
      return null;
    }

    debug.log('[Push] Project ID:', projectId);

    let tokenData;
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
        break;
      } catch (fetchErr: any) {
        if (attempt < maxRetries) {
          const delay = attempt * 2000;
          console.warn(`[Push] Intento ${attempt}/${maxRetries} falló: ${fetchErr?.message?.substring(0, 80)}. Reintentando en ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          throw fetchErr;
        }
      }
    }
    const token = tokenData!.data;
    debug.log('[Push] ExpoPushToken obtenido:', token.substring(0, 30) + '...');

    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    debug.log('[Push] Enviando token al servidor...');

    try {
      await api.put('/users/push-token', { token, platform });
      debug.log('[Push] Token registrado exitosamente en el servidor');
    } catch (apiErr: any) {
      console.error('[Push] Error al registrar token en servidor:', apiErr?.message || apiErr);
      // No retornamos null aquí porque el token se obtuvo, solo falló el registro backend
    }

    return token;
  } catch (err: any) {
    const message = err?.message || String(err);

    if (message.includes('Firebase') || message.includes('google-services')) {
      console.error(
        '[Push] Firebase NO CONFIGURADO. Para Android necesitas google-services.json en android/app/'
      );
      console.error('[Push] Guía: https://docs.expo.dev/push-notifications/fcm-credentials/');
    } else if (err?.code === 'ERR_NOTIFICATIONS_NO_EXPERIENCE_ID') {
      console.error(
        '[Push] Falta projectId. Configura extra.eas.projectId en app.json o usa "npx eas init"'
      );
    } else {
      console.error('[Push] Error al obtener token push:', message);
    }

    return null;
  }
}

export const CALL_CATEGORY_ID = 'incoming_call';
export const CALL_ACTION_ACCEPT = 'accept_call';
export const CALL_ACTION_REJECT = 'reject_call';

export async function setupNotificationCategories(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.setNotificationCategoryAsync(CALL_CATEGORY_ID, [
      {
        identifier: CALL_ACTION_ACCEPT,
        buttonTitle: 'Aceptar',
        options: {
          opensAppToForeground: true,
        },
      },
      {
        identifier: CALL_ACTION_REJECT,
        buttonTitle: 'Rechazar',
        options: {
          opensAppToForeground: false,
          isDestructive: true,
        },
      },
    ]);
    debug.log('[Push] Categoría de llamada entrante registrada');
  } catch (err) {
    console.error('[Push] Error al registrar categoría de llamada:', err);
  }
}

export async function dismissCallNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    const callNotifs = presented.filter((n) => n.request.content.data?.callData);
    for (const n of callNotifs) {
      await Notifications.dismissNotificationAsync(n.request.identifier);
    }
  } catch (err) {
    console.warn('[Push] Error al limpiar notificaciones de llamada:', err);
  }
}

export function setupNotificationHandler(
  onNavigateToChat: (userId: number) => void,
  onNavigateToCall: (data: any) => void,
  onNavigateToGroupChat?: (groupId: number) => void,
  onRejectCall?: (callData: any) => void,
) {
  const handleResponse = (response: Notifications.NotificationResponse) => {
    const data = response.notification.request.content.data;
    const actionId = response.actionIdentifier;

    let callData = data?.callData;
    if (typeof callData === 'string') {
      try {
        callData = JSON.parse(callData);
      } catch (err) {
        console.warn('[Push] Error al parsear callData:', err);
      }
    }

    if (callData) {
      if (actionId === CALL_ACTION_REJECT) {
        onRejectCall?.(callData);
        return;
      }
      onNavigateToCall(callData);
    } else if (data?.chatUserId) {
      onNavigateToChat(data.chatUserId as number);
    } else if (data?.groupId) {
      onNavigateToGroupChat?.(data.groupId as number);
    }
  };

  const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);

  Notifications.getLastNotificationResponseAsync()
    .then((lastResponse) => {
      if (lastResponse) {
        handleResponse(lastResponse);
      }
    })
    .catch((err) => {
      console.error('[Push] Error al leer última respuesta de notificación:', err);
    });

  return subscription;
}

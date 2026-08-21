import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { debug } from '../utils/debug';

export const CALL_BACKGROUND_TASK = 'onIncomingCall';

export interface CallData {
  callerId?: number;
  callerUsername?: string;
  callType?: 'voice' | 'video';
  groupId?: number;
  groupName?: string;
  roomName?: string;
}

function parseCallData(raw: any): CallData | null {
  if (!raw || typeof raw !== 'object') return null;
  let callData = raw.callData;
  if (typeof callData === 'string') {
    try {
      callData = JSON.parse(callData);
    } catch (err) {
      console.warn('[Push] Error al parsear callData en background:', err);
      return null;
    }
  }
  return callData && typeof callData === 'object' ? callData : null;
}

async function presentCallNotification(remote: Record<string, any>): Promise<void> {
  const callData = parseCallData(remote);
  if (!callData) {
    console.warn('[Push] Background task sin callData, ignorando');
    return;
  }

  const title =
    typeof remote.title === 'string' ? remote.title : callData.callerUsername || 'Llamada entrante';
  const body =
    typeof remote.message === 'string' ? remote.message : 'Llamada entrante';
  const categoryId =
    typeof remote.categoryId === 'string' ? remote.categoryId : 'incoming_call';
  const channelId =
    typeof remote.channelId === 'string' ? remote.channelId : 'default';

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: { callData },
      categoryIdentifier: categoryId,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.HIGH,
    },
    trigger: {
      channelId,
    },
  });
  debug.log('[Push] Notificación de llamada presentada desde background');
}

// Definición del task en module scope (requisito de expo-task-manager para ejecución headless).
// El payload que llega al task (NotificationTaskPayload) es:
//   { notification, data: { dataString, callData, title, message, categoryId, channelId }, ... }
// El serializador nativo (RemoteMessageSerializer) copia cada key del FCM data payload
// dentro de `data` y pone en `dataString` el valor de la key "body" (que no enviamos).
TaskManager.defineTask<Notifications.NotificationTaskPayload>(
  CALL_BACKGROUND_TASK,
  async ({ data, error }) => {
    if (error) {
      console.error('[PushBG] Background task error:', error);
      return;
    }

    // Si el task se dispara por la pulsación de una acción de la notificación
    // (solo Android), el manejo de la respuesta lo hace setupNotificationHandler.
    if (data && 'actionIdentifier' in data) {
      return;
    }

    const payload = data as { data?: Record<string, any> } | null;
    const rawData = payload?.data ?? {};
    console.warn('[PushBG] Task data:', JSON.stringify(rawData));

    // El Expo Push Service entrega el payload original como JSON string en
    // `dataString` (o `body`). Si no hay string serializado, las keys vienen sueltas.
    let remote = rawData;
    const serialized =
      typeof rawData.dataString === 'string' && rawData.dataString.length
        ? rawData.dataString
        : typeof rawData.body === 'string' && rawData.body.length
          ? rawData.body
          : '';
    if (serialized) {
      try {
        const parsed = JSON.parse(serialized);
        if (parsed && typeof parsed === 'object') {
          remote = parsed;
        }
      } catch (err) {
        console.warn('[PushBG] Error al parsear dataString:', err);
      }
    }

    try {
      await presentCallNotification(remote);
    } catch (err) {
      console.error('[PushBG] Error al presentar notificación en background:', err);
    }
  },
);

export async function registerCallBackgroundTask(): Promise<void> {
  try {
    await Notifications.registerTaskAsync(CALL_BACKGROUND_TASK);
    debug.log('[Push] Background task registrado:', CALL_BACKGROUND_TASK);
  } catch (err) {
    console.error('[Push] Error al registrar background task:', err);
  }
}
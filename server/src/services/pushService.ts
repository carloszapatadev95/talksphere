import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import pool from '../db/connection';

const expo = new Expo();

export function isUserOnline(userId: number, io: any): boolean {
  const room = io.sockets.adapter.rooms.get(`user:${userId}`);
  return !!(room && room.size > 0);
}

export async function getUserPushTokens(userId: number): Promise<{ token: string; platform: string }[]> {
  const [rows] = await pool.query(
    'SELECT token, platform FROM push_tokens WHERE user_id = ?',
    [userId]
  );
  return rows as { token: string; platform: string }[];
}

export interface SendPushOptions {
  priority?: 'default' | 'normal' | 'high';
  categoryId?: string;
  channelId?: string;
  dataOnly?: boolean;
}

export async function sendPush(
  recipientId: number,
  title: string,
  body: string,
  data?: Record<string, any>,
  options?: SendPushOptions
): Promise<{ sent: number; failed: number; details: string[] }> {
  const result = { sent: 0, failed: 0, details: [] as string[] };

  try {
    const tokens = await getUserPushTokens(recipientId);

    if (tokens.length === 0) {
      result.details.push(`No push tokens found for user ${recipientId}`);
      console.log(`[Push] No tokens for user ${recipientId}`);
      return result;
    }

    result.details.push(`Found ${tokens.length} token(s) for user ${recipientId}`);

    const messages: ExpoPushMessage[] = [];

    for (const entry of tokens) {
      const rawToken: string = entry.token;
      const tokenPreview = rawToken.substring(0, 20);
      if (!Expo.isExpoPushToken(rawToken)) {
        result.details.push(`Invalid Expo push token: ${tokenPreview}...`);
        continue;
      }
      const msg: ExpoPushMessage = {
        to: rawToken,
        data: { ...(data || {}) },
      };

      if (options?.dataOnly && entry.platform !== 'ios') {
        // Android: mensaje data-only (sin title/body top-level). El Expo Push Service lo
        // entrega como headless background notification → expo-task-manager ejecuta el
        // background task registrado en la app, que presenta la notificación local con
        // las acciones de la categoría.
        // _contentAvailable: true es obligatorio para que el Expo Push Service genere la
        // Headless Background Notification (ver docs expo push message request format).
        msg.data = {
          ...(data || {}),
          title,
          message: body,
          categoryId: options.categoryId || 'incoming_call',
          channelId: options.channelId || 'default',
        };
        msg._contentAvailable = true;
        if (options?.priority) {
          msg.priority = options.priority;
        }
      } else {
        msg.sound = 'default';
        msg.title = title;
        msg.body = body;
        if (options?.priority) {
          msg.priority = options.priority;
        }
        if (options?.categoryId) {
          msg.categoryId = options.categoryId;
        }
        if (options?.channelId) {
          msg.channelId = options.channelId;
        }
      }

      messages.push(msg);
    }

    if (messages.length === 0) {
      result.details.push('No valid Expo push tokens to send to');
      return result;
    }

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        const tickets: ExpoPushTicket[] = await expo.sendPushNotificationsAsync(chunk);
        for (const ticket of tickets) {
          if (ticket.status === 'ok') {
            result.sent++;
            result.details.push(`Push sent OK (id: ${ticket.id})`);
          } else if (ticket.status === 'error') {
            result.failed++;
            const errMsg = ticket.message || 'unknown error';
            result.details.push(`Push failed: ${errMsg}`);
            console.error(`[Push] Expo error: ${errMsg}`);

            if (ticket.details?.error) {
              result.details.push(`  Error code: ${ticket.details.error}`);
            }
          }
        }
      } catch (chunkErr) {
        result.failed += chunk.length;
        result.details.push(`Chunk send error: ${(chunkErr as Error).message}`);
        console.error('[Push] Chunk send error:', chunkErr);
      }
    }
  } catch (err) {
    result.details.push(`Unexpected error: ${(err as Error).message}`);
    console.error('[Push] sendPush unexpected error:', err);
  }

  console.log(`[Push] Result for user ${recipientId}: ${result.sent} sent, ${result.failed} failed`);
  result.details.forEach(d => console.log(`[Push]   ${d}`));

  return result;
}

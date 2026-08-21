import { components } from './openapi';

export type User = components['schemas']['User'];
export type UserBrief = components['schemas']['UserBrief'];
export type AdminUser = components['schemas']['AdminUser'];
export type InvitationCode = components['schemas']['InvitationCode'];
export type Tenant = components['schemas']['Tenant'];
export type Message = components['schemas']['Message'];
export type Group = components['schemas']['Group'];
export type GroupWithActivity = Group & {
  unread_count?: number;
  last_message?: string;
  last_message_at?: string;
  message_type?: 'text' | 'image' | 'system';
};
export type GroupMember = components['schemas']['GroupMember'];
export type Conversation = components['schemas']['Conversation'];
export type AuthResponse = components['schemas']['AuthResponse'];

export interface PendingMessage {
  receiverId?: number;
  groupId?: number;
  content: string;
  messageType: string;
  _clientId?: string;
  replyToId?: number;
  onAck?: (response: { status: string; id: number; _clientId?: string }) => void;
}

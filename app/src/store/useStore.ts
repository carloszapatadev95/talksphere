import { create } from 'zustand';
import { User, UserBrief, Conversation, GroupWithActivity, Message, PendingMessage, Tenant } from '../types';
import { deleteToken } from '../services/persist';

interface AppState {
  token: string | null;
  user: UserBrief | null;
  tenantName: string | null;
  /** Alias workspace-scoped de tenantName (migración multi-workspace) */
  workspaceName: string | null;
  /** Workspace activo (fuente de verdad: user.active_workspace_id) */
  activeWorkspaceId: number | null;
  /** Workspaces a los que pertenece el usuario */
  workspaces: Tenant[];
  contacts: User[];
  conversations: Conversation[];
  groups: GroupWithActivity[];
  messages: { [key: string]: Message[] };
  onlineUsers: Set<number>;
  incomingCall: { callerId: number; callerUsername: string; callType: 'voice' | 'video'; offer?: any } | null;
  incomingGroupCall: { groupId: number; groupName: string; roomName: string; callType: 'voice' | 'video'; startedBy: number; startedByName: string } | null;
  isCallActive: boolean;
  callType: 'voice' | 'video' | null;
  callPartner: User | null;
  socketConnected: boolean;
  pendingMessages: PendingMessage[];
  activeChatUserId: number | null;
  activeGroupId: number | null;

  setToken: (token: string | null) => void;
  setUser: (user: UserBrief | null) => void;
  setTenantName: (name: string | null) => void;
  setWorkspaceName: (name: string | null) => void;
  setActiveWorkspaceId: (id: number | null) => void;
  setWorkspaces: (workspaces: Tenant[]) => void;
  setContacts: (contacts: User[]) => void;
  setConversations: (conversations: Conversation[]) => void;
  setGroups: (groups: GroupWithActivity[]) => void;
  addMessage: (key: string, message: Message) => void;
  setMessages: (key: string, messages: Message[]) => void;
  setOnlineUsers: (users: Set<number> | ((prev: Set<number>) => Set<number>)) => void;
  setIncomingCall: (call: { callerId: number; callerUsername: string; callType: 'voice' | 'video'; offer?: any } | null) => void;
  setIncomingGroupCall: (call: { groupId: number; groupName: string; roomName: string; callType: 'voice' | 'video'; startedBy: number; startedByName: string } | null) => void;
  setCallActive: (active: boolean) => void;
  setCallType: (type: 'voice' | 'video' | null) => void;
  setCallPartner: (user: User | null) => void;
  setSocketConnected: (connected: boolean) => void;
  addPendingMessage: (msg: PendingMessage) => void;
  clearPendingMessages: () => void;
  setActiveChatUserId: (id: number | null) => void;
  setActiveGroupId: (id: number | null) => void;
  logout: () => void;
}

export const useStore = create<AppState>((set) => ({
  token: null,
  user: null,
  contacts: [],
  conversations: [],
  groups: [],
  messages: {},
  onlineUsers: new Set(),
  incomingCall: null,
  incomingGroupCall: null,
  isCallActive: false,
  callType: null,
  callPartner: null,
  socketConnected: false,
  pendingMessages: [],
  activeChatUserId: null,
  activeGroupId: null,
  tenantName: null,
  workspaceName: null,
  activeWorkspaceId: null,
  workspaces: [],

  setToken: (token) => set({ token }),
  setUser: (user) => set({ user, activeWorkspaceId: user?.active_workspace_id ?? null }),
  setContacts: (contacts) => set({ contacts }),
  setConversations: (conversations) => set({ conversations }),
  setGroups: (groups) => set({ groups }),
  setTenantName: (tenantName: string | null) => set({ tenantName }),
  setWorkspaceName: (workspaceName) => set({ workspaceName }),
  setActiveWorkspaceId: (activeWorkspaceId) => set({ activeWorkspaceId }),
  setWorkspaces: (workspaces) => set({ workspaces }),
  addMessage: (key, message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [key]: [...(state.messages[key] || []), message],
      },
    })),
  setMessages: (key, messages) =>
    set((state) => ({
      messages: { ...state.messages, [key]: messages },
    })),
  setOnlineUsers: (onlineUsers) =>
    set((state) => {
      const next =
        typeof onlineUsers === 'function'
          ? (onlineUsers as (prev: Set<number>) => Set<number>)(state.onlineUsers)
          : onlineUsers;
      if (state.onlineUsers.size === next.size && [...state.onlineUsers].every((id) => next.has(id))) {
        return state;
      }
      return { onlineUsers: next };
    }),
  setIncomingCall: (incomingCall) => set({ incomingCall }),
  setIncomingGroupCall: (incomingGroupCall) => set({ incomingGroupCall }),
  setCallActive: (isCallActive) => set({ isCallActive }),
  setCallType: (callType) => set({ callType }),
  setCallPartner: (callPartner) => set({ callPartner }),
   setSocketConnected: (socketConnected) => set({ socketConnected }),
   addPendingMessage: (msg) => set((state) => ({ pendingMessages: [...state.pendingMessages, msg] })),
  clearPendingMessages: () => set({ pendingMessages: [] }),
  setActiveChatUserId: (activeChatUserId) => set({ activeChatUserId }),
  setActiveGroupId: (activeGroupId) => set({ activeGroupId }),
  logout: () => {
    deleteToken();
    set({
      token: null,
      user: null,
      contacts: [],
      conversations: [],
      groups: [],
      messages: {},
      onlineUsers: new Set(),
      socketConnected: false,
      pendingMessages: [],
      incomingCall: null,
      incomingGroupCall: null,
      isCallActive: false,
      callType: null,
      callPartner: null,
       activeChatUserId: null,
       activeGroupId: null,
       tenantName: null,
       workspaceName: null,
       activeWorkspaceId: null,
       workspaces: [],
     });
  },
}));

export function isAdminUser(user: UserBrief | null): boolean {
  return !!user && (user.workspace_ids?.length ?? 0) > 0;
}

import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, Alert,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../store/useStore';
import { useChat } from '../hooks/useChat';
import { useImagePicker } from '../hooks/useImagePicker';
import api from '../services/api';
import { getSocket, disconnectSocket } from '../services/socket';
import { teardownCall } from '../services/callGlobals';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';
import { SOCKET_URL } from '../constants/config';
import Avatar from '../components/Avatar';
import CreateGroupModal from '../components/CreateGroupModal';
import WorkspaceSwitcher from '../components/WorkspaceSwitcher';
import BatteryWizardModal from '../components/BatteryWizardModal';
import { getOemInfo } from '../utils/oemBattery';
import { getBatteryWizardSeen, saveBatteryWizardSeen } from '../services/persist';

type Props = { navigation: NativeStackNavigationProp<any> };

export default function DashboardScreen({ navigation }: Props) {
  const { user, conversations, contacts, groups, onlineUsers } = useStore();
  const { fetchConversations, fetchContacts } = useChat();
  const { pickFromGallery, takePhoto, uploadImage, uploading } = useImagePicker();
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showBatteryWizard, setShowBatteryWizard] = useState(false);
  const SERVER_BASE = SOCKET_URL;

  const handleAvatarPress = () => {
    Alert.alert('Foto de perfil', 'Selecciona una opción', [
      { text: 'Tomar foto', onPress: async () => {
        const uri = await takePhoto();
        if (uri) await uploadAvatar(uri);
      }},
      { text: 'Elegir de galería', onPress: async () => {
        const uri = await pickFromGallery();
        if (uri) await uploadAvatar(uri);
      }},
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const uploadAvatar = async (uri: string) => {
    try {
      const formData = new FormData();
      const filename = uri.split('/').pop() || 'photo.jpg';
      const ext = filename.split('.').pop() || 'jpg';
      const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      formData.append('avatar', { uri, name: filename, type: mimeType } as any);
      const { data } = await api.post('/users/avatar', formData, {
        headers: { 'Content-Type': null },
        maxBodyLength: Infinity,
        timeout: 30000,
      });
      if (user) {
        useStore.getState().setUser({ ...user, avatar_url: data.url });
      }
    } catch (err) {
      console.error('Avatar upload error:', err);
      Alert.alert('Error', 'No se pudo actualizar la foto de perfil');
    }
  };

  useEffect(() => {
    (async () => {
      const oem = getOemInfo();
      if (!oem.isAggressive) return;
      if (await getBatteryWizardSeen()) return;
      setShowBatteryWizard(true);
    })();
  }, []);

  useEffect(() => {
    console.time('[Perf] Dashboard fetchConversations');
    console.time('[Perf] Dashboard fetchContacts');
    fetchConversations().then(() => console.timeEnd('[Perf] Dashboard fetchConversations'));
    fetchContacts().then(() => console.timeEnd('[Perf] Dashboard fetchContacts'));
    api.get('/groups').then(({ data }) => useStore.getState().setGroups(data.groups)).catch(() => {});
    const socket = getSocket();
    if (!socket) return;
    const onReconnect = () => {
      fetchConversations();
      fetchContacts();
    };
    socket.on('connect', onReconnect);
    return () => {
      socket.off('connect', onReconnect);
    };
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchConversations(), fetchContacts(), api.get('/groups').then(({ data }) => useStore.getState().setGroups(data.groups))]);
    setRefreshing(false);
  };

  const handleGroupCreated = useCallback(() => {
    api.get('/groups').then(({ data }) => useStore.getState().setGroups(data.groups)).catch(() => {});
  }, []);

  const onlineContacts = contacts.filter(c => onlineUsers.has(c.id));

  type RecentItem = {
    key: string;
    isGroup: boolean;
    groupId?: number;
    contact_id?: number;
    name: string;
    avatar_url: string | null;
    last_message?: string;
    last_message_at: string;
    unread_count?: number;
    message_type?: 'text' | 'image' | 'system';
  };

  const groupItems: RecentItem[] = groups
    .filter((g) => g.last_message_at)
    .map((g) => ({
      key: `group-${g.id}`,
      isGroup: true,
      groupId: g.id,
      name: g.name,
      avatar_url: g.avatar_url,
      last_message: g.last_message,
      last_message_at: g.last_message_at!,
      unread_count: g.unread_count,
      message_type: g.message_type,
    }));

  const convItems: RecentItem[] = conversations.map((c) => ({
    key: `conv-${c.contact_id}`,
    isGroup: false,
    contact_id: c.contact_id,
    name: c.username,
    avatar_url: c.avatar_url,
    last_message: c.last_message,
    last_message_at: c.last_message_at,
    unread_count: c.unread_count,
    message_type: c.message_type,
  }));

  const allRecent = [...convItems, ...groupItems].sort(
    (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
  );
  const recentConversations = allRecent.slice(0, 5);
  const totalUnread = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0)
    + groups.reduce((sum, g) => sum + (g.unread_count || 0), 0);
  const totalConversations = conversations.length + groups.filter((g) => g.last_message_at).length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Perfil */}
      <View style={styles.profileCard}>
        <View style={styles.profileRow}>
          <TouchableOpacity onPress={handleAvatarPress} disabled={uploading}>
            <Avatar
              uri={user?.avatar_url}
              name={user?.username || '?'}
              size={56}
              online={onlineUsers.has(user?.id || 0)}
              baseUrl={SERVER_BASE}
            />
          </TouchableOpacity>
        <View style={styles.profileInfo}>
          <Text style={styles.greeting}>Bienvenido,</Text>
          <Text style={styles.userName}>{user?.username || 'Usuario'}</Text>
          <View style={styles.statusRow}>
            <Text style={styles.status}>
              {onlineUsers.has(user?.id || 0) ? '🟢 En línea' : '⚪ Desconectado'}
            </Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.logoutBtn}
            onPress={() => {
              const state = useStore.getState();
              if (state.isCallActive) {
                if (state.incomingGroupCall) {
                  getSocket()?.emit('group_call_ended', {
                    groupId: state.incomingGroupCall.groupId,
                    roomName: state.incomingGroupCall.roomName,
                  });
                } else if (state.callPartner) {
                  getSocket()?.emit('end_call', { targetId: state.callPartner.id });
                }
              }
              teardownCall();
              getSocket()?.emit('logout');
              disconnectSocket();
              useStore.getState().logout();
              (globalThis as any).__token = null;
            }}
          >
            <Ionicons name="log-out-outline" size={20} color={Colors.error} />
          </TouchableOpacity>
          <WorkspaceSwitcher />
        </View>
      </View>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <StatCard icon="chatbubbles" label={totalUnread > 0 ? `Pendientes (${totalUnread})` : 'Conversaciones'} value={totalConversations} color={Colors.primary} />
        <StatCard icon="people" label="En línea" value={onlineContacts.length} color={Colors.success} />
        <StatCard icon="folder" label="Grupos" value={groups.length} color={Colors.warning} />
      </View>

      {/* Conversaciones recientes */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Conversaciones recientes</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Chats')}>
            <Text style={styles.seeAll}>Ver todo</Text>
          </TouchableOpacity>
        </View>
        {recentConversations.length === 0 ? (
          <View style={styles.emptySection}>
            <Ionicons name="chatbubble-ellipses-outline" size={40} color={Colors.textTertiary} />
            <Text style={styles.emptyText}>Sin conversaciones aún</Text>
            <Text style={styles.emptySubtext}>Ve a Contactos para iniciar un chat</Text>
          </View>
        ) : (
          recentConversations.map((item) => {
            const online = item.isGroup ? false : onlineUsers.has(item.contact_id || 0);
            return (
              <TouchableOpacity
                key={item.key}
                style={styles.convItem}
                onPress={() =>
                  item.isGroup
                    ? navigation.navigate('GroupChat', { group: { id: item.groupId, name: item.name } })
                    : navigation.navigate('Chat', {
                        user: {
                          id: item.contact_id,
                          username: item.name,
                          avatar_url: item.avatar_url,
                        },
                      })
                }
              >
                <Avatar
                  uri={item.avatar_url}
                  name={item.name}
                  size={44}
                  online={online}
                  baseUrl={SERVER_BASE}
                />
                <View style={styles.convInfo}>
                  <Text style={styles.convName}>{item.name}</Text>
                  <Text style={styles.convLastMsg} numberOfLines={1}>{item.last_message || (item.isGroup ? 'Grupo' : '')}</Text>
                </View>
                <View style={styles.convRightCol}>
                  <Text style={styles.convTime}>
                    {new Date(item.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  {(item.unread_count || 0) > 0 && (
                    <View style={styles.convBadge}>
                      <Text style={styles.convBadgeText}>{item.unread_count! > 99 ? '99+' : item.unread_count}</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </View>

      {/* Contactos en línea */}
      {onlineContacts.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contactos en línea</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.onlineScroll}>
            {onlineContacts.map(c => (
              <TouchableOpacity
                key={c.id}
                style={styles.onlineItem}
                onPress={() => navigation.navigate('Chat', { user: c })}
              >
                <Avatar uri={c.avatar_url} name={c.username} size={48} online baseUrl={SERVER_BASE} />
                <Text style={styles.onlineName} numberOfLines={1}>{c.username}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Acciones rápidas */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: Colors.primary }]}
          onPress={() => navigation.navigate('Contacts')}
        >
          <Ionicons name="chatbubble-ellipses" size={20} color="#FFF" />
          <Text style={styles.actionText}>Nuevo Chat</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: Colors.success }]}
          onPress={() => setShowCreateGroup(true)}
        >
          <Ionicons name="people" size={20} color="#FFF" />
          <Text style={styles.actionText}>Nuevo Grupo</Text>
        </TouchableOpacity>
      </View>

      <CreateGroupModal
        visible={showCreateGroup}
        onClose={() => setShowCreateGroup(false)}
        onCreated={handleGroupCreated}
      />

      <BatteryWizardModal
        visible={showBatteryWizard}
        oem={getOemInfo()}
        onDone={() => {
          saveBatteryWizardSeen();
          setShowBatteryWizard(false);
        }}
      />
    </ScrollView>
  );
}

function StatCard({ icon, label, value, color }: { icon: string; label: string; value: number; color: string }) {
  return (
    <View style={[styles.statCard, { borderLeftColor: color }]}>
      <Ionicons name={icon as any} size={24} color={color} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingBottom: Spacing.xl },
  profileCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.primary, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.xl,
    paddingTop: Spacing.xxl + 20,
  },
  profileRow: { flexDirection: 'row', alignItems: 'center' },
  profileInfo: { marginLeft: Spacing.md, flex: 1 },
  greeting: { color: 'rgba(255,255,255,0.8)', fontSize: 14 },
  userName: { color: '#FFF', fontSize: 20, fontWeight: '700' },
  status: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  headerRight: { marginLeft: Spacing.sm, alignItems: 'center', gap: 6 },
  logoutBtn: { padding: Spacing.sm },
  statsRow: {
    flexDirection: 'row', marginHorizontal: Spacing.lg, marginTop: -20, gap: Spacing.sm,
  },
  statCard: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    padding: Spacing.md, alignItems: 'center', borderLeftWidth: 3,
    ...Shadows.card,
  },
  statValue: { fontSize: 22, fontWeight: '700', color: Colors.text, marginTop: Spacing.xs },
  statLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  section: { marginTop: Spacing.xl, marginHorizontal: Spacing.lg },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: Spacing.md,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },
  seeAll: { color: Colors.primary, fontSize: 14, fontWeight: '500', marginBottom: Spacing.md },
  convItem: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface,
    padding: Spacing.md, borderRadius: BorderRadius.lg, marginBottom: Spacing.sm,
    ...Shadows.card,
  },
  convInfo: { marginLeft: Spacing.md, flex: 1 },
  convName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  convLastMsg: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  convTime: { fontSize: 11, color: Colors.textTertiary },
  convRightCol: { alignItems: 'center', gap: 4 },
  convBadge: {
    backgroundColor: Colors.error, borderRadius: 10, minWidth: 20,
    height: 20, paddingHorizontal: 6, justifyContent: 'center', alignItems: 'center',
  },
  convBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  emptySection: { alignItems: 'center', paddingVertical: Spacing.xl },
  emptyText: { fontSize: 16, color: Colors.textSecondary, marginTop: Spacing.md },
  emptySubtext: { fontSize: 13, color: Colors.textTertiary, marginTop: Spacing.xs },
  onlineScroll: { marginBottom: Spacing.sm },
  onlineItem: { alignItems: 'center', marginRight: Spacing.lg, width: 64 },
  onlineName: { fontSize: 12, color: Colors.text, marginTop: Spacing.xs, textAlign: 'center' },
  actionsRow: {
    flexDirection: 'row', marginHorizontal: Spacing.lg, marginTop: Spacing.xl, gap: Spacing.md,
  },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: Spacing.md, borderRadius: BorderRadius.lg, gap: Spacing.sm,
    ...Shadows.card,
  },
  actionText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
});

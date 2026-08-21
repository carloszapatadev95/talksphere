import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, Alert, ActivityIndicator, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../services/api';
import { useStore } from '../store/useStore';
import { useChat } from '../hooks/useChat';
import { Tenant } from '../types';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';

type WorkspacesResponse = { workspaces: Tenant[] };

export default function WorkspaceSwitcher({ light = false }: { light?: boolean }) {
  const { workspaceName, activeWorkspaceId, setActiveWorkspaceId, setWorkspaces, setUser, workspaces: storeWorkspaces } = useStore();
  const { fetchConversations, fetchContacts } = useChat();
  const [visible, setVisible] = useState(false);
  const [workspaces, setLocalWorkspaces] = useState<Tenant[]>([]);
  const [switchingId, setSwitchingId] = useState<number | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinCode, setJoinCode] = useState('');

  const activeWs = (workspaces.length ? workspaces : storeWorkspaces).find((w) => w.id === activeWorkspaceId);
  const activeRole = activeWs?.role === 'member' ? 'Miembro' : 'Admin';

  const open = async () => {
    setVisible(true);
    try {
      const { data } = await api.get<WorkspacesResponse>('/workspaces');
      setLocalWorkspaces(data.workspaces);
      setWorkspaces(data.workspaces);
    } catch (err) {
      console.error('WorkspaceSwitcher open', err);
    }
  };

  const switchTo = async (ws: Tenant) => {
    if (ws.id === activeWorkspaceId) {
      setVisible(false);
      return;
    }
    setSwitchingId(ws.id);
    try {
      await api.patch(`/workspaces/activate/${ws.id}`);
      const state = useStore.getState();
      if (state.user) {
        setUser({ ...state.user, active_workspace_id: ws.id });
      } else {
        setActiveWorkspaceId(ws.id);
      }
      setVisible(false);
      fetchConversations();
      fetchContacts();
      api.get('/groups').then(({ data }) => useStore.getState().setGroups(data.groups)).catch(() => {});
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'No se pudo cambiar de workspace');
    } finally {
      setSwitchingId(null);
    }
  };

  const own = workspaces.filter((w) => w.is_owner);
  const invited = workspaces.filter((w) => !w.is_owner);

  const joinWithCode = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) { Alert.alert('Error', 'Ingresa un código de invitación'); return; }
    setJoining(true);
    try {
      await api.post('/workspaces/join', { code });
      setJoinCode('');
      const { data } = await api.get<WorkspacesResponse>('/workspaces');
      setLocalWorkspaces(data.workspaces);
      setWorkspaces(data.workspaces);
      const state = useStore.getState();
      if (state.user && data.workspaces.length) {
        const joined = data.workspaces.find((w) => w.slug?.toLowerCase() === code.split('-')[0]?.toLowerCase()) || data.workspaces[data.workspaces.length - 1];
        setUser({ ...state.user, active_workspace_id: joined.id });
      }
      fetchConversations();
      fetchContacts();
      api.get('/groups').then(({ data: g }) => useStore.getState().setGroups(g.groups)).catch(() => {});
      Alert.alert('Listo', 'Te uniste al workspace');
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'No se pudo unir al workspace');
    } finally {
      setJoining(false);
    }
  };

  const renderRow = (ws: Tenant) => {
    const active = ws.id === activeWorkspaceId;
    return (
      <TouchableOpacity
        key={String(ws.id)}
        style={[styles.row, active && styles.rowActive]}
        onPress={() => switchTo(ws)}
        disabled={switchingId !== null}
      >
        <View style={styles.rowInfo}>
          <View style={styles.rowNameRow}>
            <Text style={styles.rowName} numberOfLines={1}>{ws.name}</Text>
            {ws.is_owner ? (
              <View style={[styles.badge, styles.badgeOwn]}>
                <Text style={styles.badgeOwnText}>TUYO</Text>
              </View>
            ) : (
              <View style={[styles.badge, styles.badgeInvited]}>
                <Text style={styles.badgeInvitedText}>INVITADO</Text>
              </View>
            )}
          </View>
          <Text style={styles.rowMeta}>
            /{ws.slug}
            {!ws.is_owner && ws.invited_by_username ? ` · invitado por ${ws.invited_by_username}` : ''}
          </Text>
        </View>
        {switchingId === ws.id ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : active ? (
          <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
        )}
      </TouchableOpacity>
    );
  };

  const renderSection = (title: string, list: Tenant[]) => {
    if (list.length === 0) return null;
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {list.map(renderRow)}
      </View>
    );
  };

  return (
    <>
      <TouchableOpacity style={[styles.switcher, light && styles.switcherLight]} onPress={open}>
        <Ionicons name="business" size={16} color={light ? Colors.primary : '#FFF'} />
        <Text style={[styles.switcherLabel, light && styles.switcherLabelLight]} numberOfLines={1}>
          {workspaceName || 'Workspace'}
        </Text>
        {activeWs && (
          <View style={[styles.roleChip, light && styles.roleChipLight]}>
            <Text style={[styles.roleChipText, light && styles.roleChipTextLight]}>{activeRole}</Text>
          </View>
        )}
        <Ionicons name="chevron-down" size={16} color={light ? Colors.primary : 'rgba(255,255,255,0.85)'} />
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.title}>Tus workspaces</Text>
            <ScrollView style={styles.scroll}>
              {renderSection('Tuyos', own)}
              {renderSection('Invitados', invited)}
              {workspaces.length === 0 && (
                <Text style={styles.emptyText}>No tienes workspaces aún</Text>
              )}
            </ScrollView>

            <View style={styles.joinBox}>
              <Text style={styles.joinLabel}>Unirme con código</Text>
              <View style={styles.joinRow}>
                <TextInput
                  value={joinCode}
                  onChangeText={setJoinCode}
                  placeholder="ej: CARLOS-7A3F9B2E"
                  placeholderTextColor={Colors.textTertiary}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={styles.joinInput}
                />
                <TouchableOpacity
                  style={[styles.joinBtn, joining && styles.joinBtnDisabled]}
                  onPress={joinWithCode}
                  disabled={joining}
                >
                  {joining ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <Text style={styles.joinBtnText}>Unirme</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity style={styles.closeBtn} onPress={() => setVisible(false)}>
              <Text style={styles.closeText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  switcher: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    maxWidth: 220,
  },
  switcherLight: {
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  switcherLabel: { color: '#FFF', fontSize: 13, fontWeight: '600', flexShrink: 1 },
  switcherLabelLight: { color: Colors.primary },
  roleChip: {
    backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: BorderRadius.sm,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  roleChipLight: { backgroundColor: Colors.primaryLight, borderWidth: 1, borderColor: Colors.border },
  roleChipText: { color: '#FFF', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  roleChipTextLight: { color: Colors.primaryDark },
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', padding: Spacing.xl,
  },
  card: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    padding: Spacing.lg, maxHeight: '75%', ...Shadows.card,
  },
  title: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },
  scroll: { flexGrow: 0 },
  section: { marginBottom: Spacing.md },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', color: Colors.textTertiary,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.sm,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.background,
    borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border,
  },
  rowActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  rowInfo: { flex: 1 },
  rowNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rowName: { fontSize: 15, fontWeight: '600', color: Colors.text, flexShrink: 1 },
  rowMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  badge: {
    borderRadius: BorderRadius.sm, paddingHorizontal: 6, paddingVertical: 2,
  },
  badgeOwn: { backgroundColor: '#E6F4EA' },
  badgeOwnText: { color: Colors.success, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  badgeInvited: { backgroundColor: Colors.primaryLight },
  badgeInvitedText: { color: Colors.primaryDark, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  emptyText: { fontSize: 14, color: Colors.textTertiary, textAlign: 'center', paddingVertical: Spacing.xl },
  joinBox: {
    marginTop: Spacing.sm, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  joinLabel: {
    fontSize: 12, fontWeight: '700', color: Colors.textTertiary,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.sm,
  },
  joinRow: { flexDirection: 'row', gap: Spacing.sm },
  joinInput: {
    flex: 1, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    fontSize: 13, color: Colors.text,
  },
  joinBtn: {
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg, justifyContent: 'center', alignItems: 'center',
  },
  joinBtnDisabled: { opacity: 0.6 },
  joinBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  closeBtn: {
    marginTop: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md,
    backgroundColor: Colors.background, alignItems: 'center',
  },
  closeText: { color: Colors.textSecondary, fontWeight: '500' },
});

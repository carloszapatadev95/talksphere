import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert, Modal, TextInput, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import api from '../services/api';
import { useStore } from '../store/useStore';
import { useChat } from '../hooks/useChat';
import WorkspaceSwitcher from '../components/WorkspaceSwitcher';
import BatteryWizardModal from '../components/BatteryWizardModal';
import { getOemInfo } from '../utils/oemBattery';
import { saveBatteryWizardSeen } from '../services/persist';
import { AdminUser } from '../types';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';

type UsersResponse = {
  users: AdminUser[];
  total: number;
  offset: number;
  limit: number;
};

export default function AdminScreen() {
  const navigation = useNavigation<any>();
  const { user, activeWorkspaceId, workspaceName, setUser, workspaces } = useStore();
  const { fetchConversations, fetchContacts } = useChat();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showBatteryWizard, setShowBatteryWizard] = useState(false);
  const oemInfo = getOemInfo();
  const [createName, setCreateName] = useState('');
  const [createSlug, setCreateSlug] = useState('');
  const [creating, setCreating] = useState(false);

  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId);
  const isOwner = !!activeWs?.is_owner;

  const loadUsers = useCallback(async () => {
    try {
      const { data } = await api.get<UsersResponse>('/admin/users?limit=100');
      setUsers(data.users);
      setUsersTotal(data.total);
    } catch (err) {
      console.error('loadUsers', err);
    }
  }, [activeWorkspaceId]);

  const refresh = async () => {
    setRefreshing(true);
    await loadUsers();
    setRefreshing(false);
  };

  useEffect(() => {
    refresh();
  }, [activeWorkspaceId]);

  const handleCreate = async () => {
    if (!createName.trim() || !createSlug.trim()) {
      Alert.alert('Error', 'Nombre y slug son obligatorios');
      return;
    }
    setCreating(true);
    try {
      const created = await api.post('/workspaces', {
        name: createName.trim(),
        slug: createSlug.trim().toLowerCase(),
      });
      const createdWs = created.data as { id: number; name: string };
      setShowCreate(false);
      setCreateName('');
      setCreateSlug('');
      await api.patch(`/workspaces/activate/${createdWs.id}`);
      const state = useStore.getState();
      if (state.user) {
        setUser({ ...state.user, active_workspace_id: createdWs.id });
      }
      setWorkspaceNames();
      fetchConversations();
      fetchContacts();
      api.get('/groups').then(({ data }) => useStore.getState().setGroups(data.groups)).catch(() => {});
      refresh();
      navigation.navigate('Invite', { workspaceId: createdWs.id });
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'No se pudo crear el workspace');
    } finally {
      setCreating(false);
    }
  };

  const setWorkspaceNames = async () => {
    try {
      const { data } = await api.get('/tenants/me');
      const ws = data?.workspace || data;
      if (ws && ws.name) {
        useStore.getState().setWorkspaceName(ws.name);
      }
    } catch {}
  };

  const afterWorkspaceChanged = () => {
    setWorkspaceNames();
    fetchConversations();
    fetchContacts();
    api.get('/groups').then(({ data }) => useStore.getState().setGroups(data.groups)).catch(() => {});
    refresh();
  };

  const handleToggleSuspend = () => {
    if (!activeWs) return;
    const action = activeWs.is_active ? 'Suspender' : 'Reactivar';
    Alert.alert(`${action} workspace`, `¿${action} el workspace "${activeWs.name}"?\n\nLos miembros no podrán usarlo mientras esté suspendido.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: action, style: 'destructive', onPress: async () => {
        try {
          await api.patch(`/workspaces/${activeWs.id}`, { isActive: !activeWs.is_active });
          Alert.alert('Listo', `Workspace ${action.toLowerCase()}.`);
          afterWorkspaceChanged();
        } catch (err: any) {
          Alert.alert('Error', err.response?.data?.error || 'No se pudo cambiar el estado');
        }
      } },
    ]);
  };

  const handleDeleteWorkspace = () => {
    if (!activeWs) return;
    Alert.alert('Eliminar workspace', `¿Eliminar "${activeWs.name}"?\n\nLos datos se conservan (soft-delete) pero el workspace se oculta y no podrás usarlo.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => {
        try {
          await api.delete(`/workspaces/${activeWs.id}`);
          Alert.alert('Eliminado', 'Workspace eliminado (sus datos se conservan).');
          // Si el ws activo era el eliminado, cambiar a otro o al propio
          const state = useStore.getState();
          if (state.user) {
            const fallback = state.workspaces.find((w) => w.id !== activeWs.id && !w.is_owner) ?? state.workspaces.find((w) => w.is_owner && w.id !== activeWs.id);
            if (fallback) {
              await api.patch(`/workspaces/activate/${fallback.id}`);
              setUser({ ...state.user, active_workspace_id: fallback.id });
            }
          }
          afterWorkspaceChanged();
        } catch (err: any) {
          Alert.alert('Error', err.response?.data?.error || 'No se pudo eliminar el workspace');
        }
      } },
    ]);
  };

  const handleSuspend = (u: AdminUser) => {
    const action = u.is_suspended ? 'Reactivar' : 'Suspender';
    Alert.alert(`${action} usuario`, `¿${action} a ${u.username}?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: action, style: 'destructive', onPress: async () => {
        try {
          await api.patch(`/admin/users/${u.id}`, { isSuspended: !u.is_suspended });
          loadUsers();
        } catch (err: any) {
          Alert.alert('Error', err.response?.data?.error || 'No se pudo actualizar');
        }
      } },
    ]);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <View style={styles.wsRow}>
        <Ionicons name="business" size={20} color={Colors.primary} />
        <Text style={styles.wsName} numberOfLines={1}>
          {workspaceName || `Workspace #${activeWorkspaceId ?? ''}`}
        </Text>
        <WorkspaceSwitcher />
      </View>

      <View style={styles.header}>
        <Ionicons name="shield-checkmark" size={32} color={Colors.primary} />
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>Panel de Admin</Text>
          <Text style={styles.headerSub}>Gestiona invitaciones y usuarios de tu workspace</Text>
        </View>
      </View>

      {isOwner && activeWs && (
        <View style={styles.wsManageRow}>
          <View style={styles.wsManageInfo}>
            <Text style={styles.wsManageTitle}>{workspaceName || activeWs.name}</Text>
            <Text style={styles.wsManageMeta}>
              {activeWs.is_active ? 'Activo' : 'Suspendido'}
              {activeWs.is_active ? ' · Tú lo creaste' : ' · Tú lo creaste'}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.wsManageBtn, activeWs.is_active ? styles.wsManageSuspend : styles.wsManageActivate]}
            onPress={handleToggleSuspend}
          >
            <Ionicons name={activeWs.is_active ? 'pause' : 'play'} size={16} color={activeWs.is_active ? Colors.warning : Colors.success} />
            <Text style={[styles.wsManageBtnText, activeWs.is_active ? styles.wsManageSuspendText : styles.wsManageActivateText]}>
              {activeWs.is_active ? 'Suspender' : 'Reactivar'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.wsManageDelete} onPress={handleDeleteWorkspace}>
            <Ionicons name="trash-outline" size={16} color={Colors.error} />
            <Text style={styles.wsManageDeleteText}>Eliminar</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.actionsRow}>
        <TouchableOpacity style={[styles.actionsBtn, styles.actionsPrimary]} onPress={() => navigation.navigate('Invite', {})}>
          <Ionicons name="people" size={18} color="#FFF" />
          <Text style={styles.actionsBtnText}>Invitar</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionsBtn, styles.actionsOutline]} onPress={() => setShowCreate(true)}>
          <Ionicons name="add-circle" size={18} color={Colors.primary} />
          <Text style={styles.actionsOutlineText}>Crear workspace</Text>
        </TouchableOpacity>
      </View>

      {oemInfo.isAggressive && (
        <TouchableOpacity
          style={styles.batteryRow}
          onPress={() => setShowBatteryWizard(true)}
        >
          <Ionicons name="battery-half" size={18} color={Colors.textSecondary} />
          <Text style={styles.batteryText}>Llamadas en segundo plano (batería)</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
        </TouchableOpacity>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionMeta}>{usersTotal} usuario(s) en tu workspace</Text>
        <FlatList
          data={users}
          keyExtractor={(item) => String(item.id)}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <View style={styles.item}>
              <View style={styles.userInfo}>
                <Text style={styles.userName}>{item.username}</Text>
                <Text style={styles.userEmail}>{item.email}</Text>
                <View style={styles.userBadges}>
                  {item.is_suspended && <Text style={styles.badgeSuspended}>SUSPENDIDO</Text>}
                  {item.is_online && <Text style={styles.badgeOnline}>ONLINE</Text>}
                </View>
              </View>
              <View style={styles.userActions}>
                <TouchableOpacity onPress={() => handleSuspend(item)} style={styles.iconBtn}>
                  <Ionicons name={item.is_suspended ? 'lock-open' : 'lock-closed'} size={18} color={item.is_suspended ? Colors.success : Colors.error} />
                </TouchableOpacity>
              </View>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>Sin usuarios en tu workspace</Text>}
        />
      </View>

      <Modal visible={showCreate} transparent animationType="fade" onRequestClose={() => setShowCreate(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Nuevo workspace</Text>
            <Text style={styles.modalLabel}>Nombre de la empresa</Text>
            <TextInput
              style={styles.modalInput}
              value={createName}
              onChangeText={setCreateName}
              placeholder="Ej: Zapata Dev"
              placeholderTextColor={Colors.textTertiary}
            />
            <Text style={styles.modalLabel}>Slug (minúsculas y guiones)</Text>
            <TextInput
              style={styles.modalInput}
              value={createSlug}
              onChangeText={(v) => setCreateSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="Ej: zapata-dev"
              placeholderTextColor={Colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowCreate(false)}>
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirmBtn} onPress={handleCreate} disabled={creating}>
                <Text style={styles.modalConfirmText}>{creating ? 'Creando...' : 'Crear'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <BatteryWizardModal
        visible={showBatteryWizard}
        oem={oemInfo}
        onDone={() => {
          saveBatteryWizardSeen();
          setShowBatteryWizard(false);
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xl + 20, paddingBottom: Spacing.xxl },
  batteryRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    marginBottom: Spacing.lg, ...Shadows.card,
  },
  batteryText: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  wsRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    marginBottom: Spacing.lg, ...Shadows.card,
  },
  wsName: { flex: 1, fontSize: 16, fontWeight: '700', color: Colors.text },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md, gap: Spacing.md },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: Colors.text },
  headerSub: { fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
  wsManageRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    padding: Spacing.md, marginBottom: Spacing.lg, borderWidth: 1, borderColor: Colors.border,
  },
  wsManageInfo: { flex: 1 },
  wsManageTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  wsManageMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  wsManageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  wsManageSuspend: { borderColor: Colors.warning, backgroundColor: '#FFF8E1' },
  wsManageActivate: { borderColor: Colors.success, backgroundColor: '#E6F4EA' },
  wsManageBtnText: { fontSize: 13, fontWeight: '600' },
  wsManageSuspendText: { color: '#8A5B00' },
  wsManageActivateText: { color: Colors.success },
  wsManageDelete: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.error, backgroundColor: '#FFEBEE',
  },
  wsManageDeleteText: { fontSize: 13, fontWeight: '600', color: Colors.error },
  section: { marginBottom: Spacing.xl },
  sectionMeta: { fontSize: 13, color: Colors.textSecondary, marginBottom: Spacing.md },
  actionsRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
  actionsBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    paddingVertical: Spacing.md, borderRadius: BorderRadius.lg,
  },
  actionsPrimary: { backgroundColor: Colors.primary },
  actionsOutline: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.primary },
  actionsBtnText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  actionsOutlineText: { color: Colors.primary, fontSize: 15, fontWeight: '600' },
  item: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface,
    padding: Spacing.md, borderRadius: BorderRadius.lg, marginBottom: Spacing.sm, ...Shadows.card,
  },
  badgeOnline: { fontSize: 10, color: Colors.success, fontWeight: '700', backgroundColor: '#E0FFE0', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeSuspended: { fontSize: 10, color: Colors.error, fontWeight: '700', backgroundColor: '#FFE0E0', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  userInfo: { flex: 1 },
  userName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  userEmail: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  userBadges: { flexDirection: 'row', gap: 6, marginTop: 4 },
  userActions: { flexDirection: 'row', gap: 4 },
  iconBtn: { padding: Spacing.sm },
  emptyText: { fontSize: 14, color: Colors.textTertiary, textAlign: 'center', paddingVertical: Spacing.xl },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: Spacing.xl },
  modalCard: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg, ...Shadows.card },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },
  modalLabel: { fontSize: 13, color: Colors.textSecondary, marginBottom: 4 },
  modalInput: {
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    fontSize: 15, marginBottom: Spacing.md,
  },
  modalBtns: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  cancelBtn: { flex: 1, paddingVertical: Spacing.md, borderRadius: BorderRadius.md, backgroundColor: Colors.background },
  cancelBtnText: { color: Colors.textSecondary, textAlign: 'center', fontWeight: '500' },
  modalConfirmBtn: { flex: 1, paddingVertical: Spacing.md, borderRadius: BorderRadius.md, backgroundColor: Colors.primary },
  modalConfirmText: { color: '#FFF', textAlign: 'center', fontWeight: '600' },
});

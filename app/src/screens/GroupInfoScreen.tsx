import { useState, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Alert, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { useRoute, useNavigation, RouteProp, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../store/useStore';
import { useChat } from '../hooks/useChat';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { Colors, BorderRadius } from '../theme';
import { SOCKET_URL } from '../constants/config';
import Avatar from '../components/Avatar';

type RouteParams = { GroupInfo: { group: { id: number; name: string } } };

type Member = {
  id: number;
  username: string;
  avatar_url: string | null;
  is_online: boolean;
  role: 'admin' | 'member';
};

export default function GroupInfoScreen() {
  const route = useRoute<RouteProp<RouteParams, 'GroupInfo'>>();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { group } = route.params;
  const { user: me, contacts } = useStore();
  const { fetchContacts } = useChat();
  const [groupInfo, setGroupInfo] = useState<any>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [adding, setAdding] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const SERVER_BASE = SOCKET_URL;

  const isAdmin = members.some((m) => m.id === me?.id && m.role === 'admin');
  const isOwner = groupInfo?.created_by === me?.id;
  const creatorName = members.find((m) => m.id === groupInfo?.created_by)?.username;

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get(`/groups/${group.id}`),
      api.get(`/groups/${group.id}/members`),
    ]).then(([infoRes, membersRes]) => {
      setGroupInfo(infoRes.data.group);
      setMembers(membersRes.data.members);
    }).catch(() => {
      console.error('Failed to load group info');
    }).finally(() => setLoading(false));
  }, [group.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = ({ groupId }: { groupId: number }) => {
      if (groupId === group.id) load();
    };
    const removedHandler = ({ groupId }: { groupId: number }) => {
      if (groupId === group.id) {
        Alert.alert('Eliminado del grupo', 'Ya no eres miembro de este grupo');
        navigation.goBack();
      }
    };
    socket.on('group_members_updated', handler);
    socket.on('group_info_updated', handler);
    socket.on('removed_from_group', removedHandler);
    return () => {
      socket.off('group_members_updated', handler);
      socket.off('group_info_updated', handler);
      socket.off('removed_from_group', removedHandler);
    };
  }, [group.id, load, navigation]);

  const handleRemove = (member: Member) => {
    Alert.alert(
      'Eliminar miembro',
      `¿Eliminar a ${member.username} del grupo?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/groups/${group.id}/members/${member.id}`);
              setMembers((prev) => prev.filter((m) => m.id !== member.id));
            } catch {
              Alert.alert('Error', 'No se pudo eliminar el miembro');
            }
          },
        },
      ]
    );
  };

  const handleLeaveGroup = () => {
    Alert.alert(
      'Salir del grupo',
      '¿Estás seguro de que quieres salir del grupo?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Salir',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/groups/${group.id}/members/me`);
              navigation.goBack();
            } catch {
              Alert.alert('Error', 'No se pudo salir del grupo');
            }
          },
        },
      ]
    );
  };

  const handleTransfer = (targetId: number) => {
    const target = members.find((m) => m.id === targetId);
    if (!target) return;
    Alert.alert(
      'Transferir propiedad',
      `¿Estás seguro de transferir la propiedad del grupo a ${target.username}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Transferir',
          style: 'destructive',
          onPress: async () => {
            setTransferring(true);
            try {
              await api.post(`/groups/${group.id}/transfer`, { userId: targetId });
              setShowTransferModal(false);
              load();
            } catch {
              Alert.alert('Error', 'No se pudo transferir la propiedad');
            } finally {
              setTransferring(false);
            }
          },
        },
      ]
    );
  };

  const openAddModal = () => {
    fetchContacts();
    setSelectedIds([]);
    setShowAddModal(true);
  };

  const handleAddMembers = async () => {
    if (selectedIds.length === 0) return;
    setAdding(true);
    try {
      await api.post(`/groups/${group.id}/members`, { memberIds: selectedIds });
      setShowAddModal(false);
      load();
    } catch {
      Alert.alert('Error', 'No se pudieron agregar los miembros');
    } finally {
      setAdding(false);
    }
  };

  const handleEdit = () => {
    setEditName(groupInfo?.name || group.name);
    setEditDescription(groupInfo?.description || '');
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
  };

  const handleSave = async () => {
    if (!editName.trim()) {
      Alert.alert('Error', 'El nombre del grupo es obligatorio');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.put(`/groups/${group.id}`, {
        name: editName.trim(),
        description: editDescription.trim() || null,
      });
      setGroupInfo((prev: any) => ({ ...prev, name: data.name, description: data.description }));
      setEditing(false);
    } catch {
      Alert.alert('Error', 'No se pudo actualizar el grupo');
    } finally {
      setSaving(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const alreadyMemberIds = new Set(members.map((m) => m.id));

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const selectedSet = new Set(selectedIds);

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text><Ionicons name="arrow-back" size={24} color="#FFFFFF" /></Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Info del grupo</Text>
        <View style={styles.backBtn} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.headerSection}>
          <Avatar
            uri={groupInfo?.avatar_url}
            name={groupInfo?.name || group.name}
            size={72}
            baseUrl={SERVER_BASE}
          />
          {editing ? (
            <View style={styles.editFields}>
              <TextInput
                style={styles.editInput}
                value={editName}
                onChangeText={setEditName}
                placeholder="Nombre del grupo"
                autoFocus
              />
              <TextInput
                style={[styles.editInput, styles.editInputMultiline]}
                value={editDescription}
                onChangeText={setEditDescription}
                placeholder="Descripción del grupo (opcional)"
                multiline
                numberOfLines={3}
              />
              <View style={styles.editActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={handleCancelEdit} disabled={saving}>
                  <Text style={styles.cancelBtnText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
                  <Text style={styles.saveBtnText}>{saving ? 'Guardando...' : 'Guardar'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.nameRow}>
              <Text style={styles.groupName}>{groupInfo?.name || group.name}</Text>
              {isAdmin && (
                <TouchableOpacity style={styles.editBtn} onPress={handleEdit}>
                  <Ionicons name="pencil" size={18} color={Colors.primary} />
                </TouchableOpacity>
              )}
            </View>
          )}
          {!editing && groupInfo?.description ? (
            <Text style={styles.groupDescription}>{groupInfo.description}</Text>
          ) : null}
          {groupInfo?.created_at ? (
            <Text style={styles.createdAt}>
              Creado el {new Date(groupInfo.created_at).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}
            </Text>
          ) : null}
          {creatorName ? (
            <Text style={styles.createdBy}>Creado por @{creatorName}</Text>
          ) : null}
          <View style={styles.membersCount}>
            <Text><Ionicons name="people" size={16} color={Colors.textSecondary} /></Text>
            <Text style={styles.membersCountText}>
              {members.length} {members.length === 1 ? 'miembro' : 'miembros'}
            </Text>
          </View>
          {isAdmin && (
            <TouchableOpacity style={styles.addBtn} onPress={openAddModal}>
              <Text><Ionicons name="person-add" size={18} color="#FFFFFF" /></Text>
              <Text style={styles.addBtnText}>Agregar miembro</Text>
            </TouchableOpacity>
          )}
          {isOwner ? (
            <TouchableOpacity style={styles.transferBtn} onPress={() => setShowTransferModal(true)}>
              <Text><Ionicons name="swap-horizontal" size={18} color="#FFFFFF" /></Text>
              <Text style={styles.transferBtnText}>Transferir propiedad</Text>
            </TouchableOpacity>
          ) : null}
          <View style={styles.divider} />
          <Text style={styles.membersSectionTitle}>Miembros</Text>
        </View>
        {members.map((item) => (
          <View key={item.id} style={styles.memberItem}>
            <Avatar
              uri={item.avatar_url}
              name={item.username}
              size={44}
              online={item.is_online}
              baseUrl={SERVER_BASE}
            />
            <View style={styles.memberInfo}>
              <Text style={styles.memberName}>{item.username}</Text>
              <Text style={styles.memberRole}>
                {item.role === 'admin' ? 'Admin' : 'Miembro'}
              </Text>
            </View>
            {isAdmin && item.id !== me?.id ? (
              <TouchableOpacity style={styles.removeBtn} onPress={() => handleRemove(item)}>
                <Text><Ionicons name="close-circle-outline" size={22} color={Colors.error} /></Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
        {!isOwner ? (
          <TouchableOpacity style={[styles.leaveBtn, { marginBottom: Math.max(insets.bottom, 12) }]} onPress={handleLeaveGroup}>
            <Text style={styles.leaveBtnText}>Salir del grupo</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.ownerNote}>Eres el creador del grupo. Transfiere la propiedad antes de salir.</Text>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      {showAddModal ? <Modal visible animationType="slide" transparent onRequestClose={() => setShowAddModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 30) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Agregar miembros</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Text><Ionicons name="close" size={24} color={Colors.text} /></Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.contactList}>
              {contacts.filter((c) => !alreadyMemberIds.has(c.id)).length === 0 ? (
                <Text style={styles.emptyText}>No hay contactos disponibles</Text>
              ) : (
                contacts.filter((c) => !alreadyMemberIds.has(c.id)).map((item) => (
                  <TouchableOpacity key={item.id} style={styles.contactItem} onPress={() => toggleSelect(item.id)}>
                    <Avatar uri={item.avatar_url} name={item.username} size={36} baseUrl={SERVER_BASE} />
                    <Text style={styles.contactName}>{item.username}</Text>
                    <View style={[styles.checkbox, selectedSet.has(item.id) ? styles.checkboxSelected : null]}>
                      {selectedSet.has(item.id) ? <Text><Ionicons name="checkmark" size={16} color="#FFFFFF" /></Text> : null}
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
            <TouchableOpacity
              style={[styles.confirmBtn, selectedIds.length === 0 ? styles.confirmBtnDisabled : null]}
              onPress={handleAddMembers}
              disabled={selectedIds.length === 0 || adding}
            >
              <Text style={styles.confirmBtnText}>
                {adding ? 'Agregando...' : `Agregar (${selectedIds.length})`}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal> : null}

      {showTransferModal ? <Modal visible animationType="slide" transparent onRequestClose={() => setShowTransferModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 30) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Transferir propiedad</Text>
              <TouchableOpacity onPress={() => setShowTransferModal(false)}>
                <Text><Ionicons name="close" size={24} color={Colors.text} /></Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.transferHint}>Selecciona el nuevo administrador:</Text>
            <ScrollView style={styles.contactList}>
              {members.filter((m) => m.id !== me?.id).map((item) => (
                <TouchableOpacity key={item.id} style={styles.contactItem} onPress={() => handleTransfer(item.id)}>
                  <Avatar uri={item.avatar_url} name={item.username} size={36} online={item.is_online} baseUrl={SERVER_BASE} />
                  <Text style={styles.contactName}>{item.username}</Text>
                  <Text style={styles.memberRole}>{item.role === 'admin' ? 'Admin' : 'Miembro'}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingBottom: 24 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.primary, paddingHorizontal: 16, paddingBottom: 12,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#FFFFFF' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  headerSection: { alignItems: 'center', paddingTop: 24, paddingHorizontal: 20 },
  groupName: { fontSize: 22, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 },
  editBtn: { padding: 4 },
  editFields: { width: '100%', paddingTop: 16, gap: 10 },
  editInput: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderLight,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: Colors.text,
  },
  editInputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  editActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  saveBtn: {
    flex: 1, backgroundColor: Colors.primary, borderRadius: 8, paddingVertical: 10,
    alignItems: 'center',
  },
  saveBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 15 },
  cancelBtn: {
    flex: 1, backgroundColor: Colors.border, borderRadius: 8, paddingVertical: 10,
    alignItems: 'center',
  },
  cancelBtnText: { color: Colors.text, fontWeight: '600', fontSize: 15 },
  groupDescription: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  createdAt: { fontSize: 12, color: Colors.textTertiary, marginTop: 8 },
  createdBy: { fontSize: 12, color: Colors.textTertiary, marginTop: 4 },
  membersCount: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12,
    paddingHorizontal: 12, paddingVertical: 4, backgroundColor: Colors.primaryLight, borderRadius: 12,
  },
  membersCountText: { fontSize: 13, color: Colors.primary, fontWeight: '500' },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14,
    backgroundColor: Colors.primary, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20,
  },
  addBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 14 },
  transferBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10,
    backgroundColor: Colors.warning, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20,
  },
  transferBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 14 },
  transferHint: { fontSize: 14, color: Colors.textSecondary, paddingHorizontal: 20, paddingVertical: 12 },
  divider: { width: '100%', height: 1, backgroundColor: Colors.border, marginVertical: 16 },
  membersSectionTitle: { fontSize: 16, fontWeight: '600', color: Colors.text, alignSelf: 'flex-start', marginBottom: 8 },
  memberItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 20,
  },
  memberInfo: { flex: 1, marginLeft: 12 },
  memberName: { fontSize: 16, fontWeight: '500', color: Colors.text },
  memberRole: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  removeBtn: { padding: 6 },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '80%', paddingBottom: 30,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: 18, fontWeight: '600', color: Colors.text },
  contactList: { paddingHorizontal: 20, maxHeight: 400 },
  contactItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  contactName: { flex: 1, marginLeft: 12, fontSize: 15, color: Colors.text },
  checkbox: {
    width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: Colors.borderLight,
    justifyContent: 'center', alignItems: 'center',
  },
  checkboxSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  emptyText: { textAlign: 'center', color: Colors.textTertiary, marginTop: 24, fontSize: 14 },
  confirmBtn: {
    backgroundColor: Colors.primary, marginHorizontal: 20, marginTop: 12,
    paddingVertical: 12, borderRadius: 10, alignItems: 'center',
  },
  confirmBtnDisabled: { backgroundColor: Colors.textTertiary },
  confirmBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },
  leaveBtn: {
    marginHorizontal: 20, marginTop: 24, marginBottom: 12,
    paddingVertical: 12, borderRadius: 10, alignItems: 'center',
    backgroundColor: Colors.error,
  },
  leaveBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },
  ownerNote: {
    textAlign: 'center', color: Colors.textTertiary, fontSize: 13,
    marginHorizontal: 20, marginTop: 24, marginBottom: 12,
  },
});

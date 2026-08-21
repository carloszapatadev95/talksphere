import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, RefreshControl, Alert, Clipboard,
  Modal, ActivityIndicator, Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import api from '../services/api';
import { useStore } from '../store/useStore';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';

type WorkspaceInfo = {
  id: number;
  name: string;
  slug: string;
  created_by: number | null;
  max_seats: number;
  used_seats?: number;
};

type Member = {
  id: number;
  username: string;
  email: string;
  avatar_url: string | null;
  is_online: boolean;
  is_suspended: boolean;
};

type PhoneContact = {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  registeredUserId: number | null;
  invitationCode: string | null;
  isMember: boolean;
};

type ContactsResponse = { contacts: PhoneContact[] };
type UsersResponse = { users: Member[]; total: number };

export default function InviteScreen({ route }: any) {
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const wsId = route?.params?.workspaceId ?? activeWorkspaceId;
  const [ws, setWs] = useState<WorkspaceInfo | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [contacts, setContacts] = useState<PhoneContact[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');

  const loadWorkspace = useCallback(async () => {
    if (!wsId) return;
    try {
      const { data } = await api.get(`/workspaces/${wsId}`);
      setWs(data.workspace);
    } catch (err) {
      console.error('loadWorkspace', err);
    }
  }, [wsId]);

  const loadMembers = useCallback(async () => {
    if (!wsId) return;
    try {
      const { data } = await api.get<UsersResponse>(`/admin/users?workspace_id=${wsId}&limit=100`);
      setMembers(data.users);
    } catch (err) {
      console.error('loadMembers', err);
    }
  }, [wsId]);

  const loadContacts = useCallback(async () => {
    if (!wsId) return;
    try {
      const { data } = await api.get<ContactsResponse>(`/workspaces/${wsId}/contacts`);
      setContacts(data.contacts);
    } catch (err) {
      console.error('loadContacts', err);
    }
  }, [wsId]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadWorkspace(), loadMembers(), loadContacts()]);
    setRefreshing(false);
  }, [loadWorkspace, loadMembers, loadContacts]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const importFromPhone = async () => {
    try {
      const perm = await Contacts.requestPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permiso requerido', 'Necesitas permitir el acceso a tus contactos para invitarlos.');
        return;
      }
      setImporting(true);
      const details = await Contacts.Contact.getAllDetails(
        [Contacts.ContactField.FULL_NAME, Contacts.ContactField.EMAILS, Contacts.ContactField.PHONES] as const,
        { limit: 500 }
      );
      const mapped = (details as any[])
        .filter((d: any) => d.fullName || d.emails?.length || d.phones?.length)
        .map((d: any) => ({
          name: d.fullName || null,
          email: d.emails?.[0]?.email ?? null,
          phone: d.phones?.[0]?.number ?? null,
        }));
      if (mapped.length === 0) {
        Alert.alert('Sin contactos', 'No se encontraron contactos en tu agenda.');
        return;
      }
      await api.post(`/workspaces/${wsId}/contacts`, { contacts: mapped });
      await loadContacts();
      Alert.alert('Contactos importados', `Se importaron ${mapped.length} contactos de tu agenda.`);
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'No se pudieron leer los contactos');
    } finally {
      setImporting(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectedContacts = contacts.filter((c) => selected[c.id]);

  const addSelectedToMembers = async () => {
    const toAdd = selectedContacts.filter((c) => c.registeredUserId && !c.isMember);
    if (toAdd.length === 0) {
      Alert.alert('Nada que agregar', 'Selecciona contactos que ya sean usuarios de la app.');
      return;
    }
    setAdding(true);
    try {
      let added = 0;
      for (const c of toAdd) {
        try {
          await api.post(`/workspaces/${wsId}/members`, { userId: c.registeredUserId });
          added += 1;
        } catch (err) {
          console.error('add member', err);
        }
      }
      setSelected({});
      await Promise.all([loadMembers(), loadContacts()]);
      Alert.alert('Listo', `${added} contacto(s) agregado(s) al workspace.`);
    } finally {
      setAdding(false);
    }
  };

  const generateCodeForSelected = async () => {
    const pending = selectedContacts.filter((c) => !c.registeredUserId);
    if (pending.length === 0) {
      Alert.alert('Selección inválida', 'Selecciona contactos que no estén registrados en la app.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/invitations', {
        maxUses: pending.length,
        expiresInDays: 7,
        contactIds: pending.map((c) => c.id),
      });
      setGeneratedCode(data.code);
      setSelected({});
      loadContacts();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'No se pudo generar el código');
    } finally {
      setBusy(false);
    }
  };

  const copyCode = () => {
    if (!generatedCode) return;
    Clipboard.setString(generatedCode);
    Alert.alert('Copiado', 'Código copiado al portapapeles');
  };

  const shareCode = () => {
    if (!generatedCode) return;
    const wsName = ws?.name || 'mi workspace';
    Share.share({
      message: `Únete a "${wsName}" en TalkSphere con este código de invitación: ${generatedCode}`,
    }).catch(() => {});
  };

  const removeMember = (m: Member) => {
    Alert.alert('Quitar miembro', `¿Quitar a ${m.username} del workspace?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Quitar',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/workspaces/${wsId}/members/${m.id}`);
            loadMembers();
          } catch (err: any) {
            Alert.alert('Error', err.response?.data?.error || 'No se pudo quitar al miembro');
          }
        },
      },
    ]);
  };

  const selectedCount = selectedContacts.length;
  const toAddCount = selectedContacts.filter((c) => c.registeredUserId && !c.isMember).length;
  const toInviteCount = selectedContacts.filter((c) => !c.registeredUserId).length;

  const filteredContacts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => {
      const name = (c.name || '').toLowerCase();
      const email = (c.email || '').toLowerCase();
      const phone = (c.phone || '').toLowerCase();
      return name.includes(q) || email.includes(q) || phone.includes(q);
    });
  }, [contacts, search]);

  const renderContact = ({ item: c }: { item: PhoneContact }) => {
    const checked = !!selected[c.id];
    const selectable = !c.isMember;
    return (
      <TouchableOpacity
        key={c.id}
        style={[styles.item, checked && styles.itemSelected]}
        onPress={() => selectable && toggleSelect(c.id)}
        disabled={!selectable}
      >
        <Ionicons
          name={checked ? 'checkbox' : 'square-outline'}
          size={22}
          color={checked ? Colors.primary : Colors.textTertiary}
        />
        <View style={styles.itemInfo}>
          <Text style={styles.itemName}>{c.name || 'Sin nombre'}</Text>
          <Text style={styles.itemSub} numberOfLines={1}>
            {c.email || c.phone || '—'}
          </Text>
          <View style={styles.badgesRow}>
            {c.isMember ? <Text style={styles.badgeMember}>MIEMBRO</Text> : null}
            {!c.isMember && c.registeredUserId ? <Text style={styles.badgeRegistered}>REGISTRADO</Text> : null}
            {!c.isMember && c.invitationCode ? <Text style={styles.badgeInvited}>CÓDIGO: {c.invitationCode}</Text> : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.stickyHeader}>
        <View style={styles.header}>
          <Ionicons name="people" size={32} color={Colors.primary} />
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle}>{ws?.name || 'Workspace'}</Text>
            <Text style={styles.headerSub}>
              {members.length} miembro(s){ws?.used_seats != null ? ` · ${ws.used_seats}/${ws.max_seats} asientos` : ''}
            </Text>
          </View>
        </View>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={Colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar contacto (nombre, email o teléfono)..."
            placeholderTextColor="#9AA0A6"
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={18} color={Colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {selectedCount > 0 && (
        <View style={styles.actionBar}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionSecondary]}
            onPress={addSelectedToMembers}
            disabled={adding}
          >
            <Text style={styles.actionSecondaryText}>{adding ? 'Agregando...' : `Agregar a miembros (${toAddCount})`}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionPrimary]}
            onPress={generateCodeForSelected}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Ionicons name="key" size={16} color="#FFF" />
            )}
            <Text style={styles.actionPrimaryText}>{busy ? 'Generando...' : `Generar código (${toInviteCount})`}</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={filteredContacts}
        keyExtractor={(c) => String(c.id)}
        renderItem={renderContact}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Miembros</Text>
              {members.map((m) => {
                const isCreator = ws?.created_by != null && m.id === ws.created_by;
                return (
                  <View key={m.id} style={styles.item}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{m.username.slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <View style={styles.itemInfo}>
                      <View style={styles.nameRow}>
                        <Text style={styles.itemName}>{m.username}</Text>
                        {isCreator ? <Text style={styles.badgeCreator}>CREADOR</Text> : null}
                        {m.is_online ? <Text style={styles.badgeOnline}>ONLINE</Text> : null}
                      </View>
                      <Text style={styles.itemSub}>{m.email}</Text>
                    </View>
                    {!isCreator && (
                      <TouchableOpacity onPress={() => removeMember(m)} style={styles.iconBtn}>
                        <Ionicons name="remove-circle" size={20} color={Colors.error} />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
              {members.length === 0 && <Text style={styles.emptyText}>Sin miembros aún</Text>}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Contactos del móvil</Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={importFromPhone} disabled={importing}>
                {importing ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Ionicons name="phone-portrait" size={18} color="#FFF" />
                )}
                <Text style={styles.primaryBtnText}>
                  {importing ? 'Importando...' : 'Acceder a contactos del móvil'}
                </Text>
              </TouchableOpacity>
              {search.length > 0 && (
                <Text style={styles.searchResultHint}>
                  {filteredContacts.length} resultado(s) para "{search.trim()}"
                </Text>
              )}
            </View>
          </>
        }
        ListEmptyComponent={
          contacts.length === 0
            ? <Text style={styles.emptyText}>Aún no importas contactos a este workspace</Text>
            : <Text style={styles.emptyText}>Sin resultados para tu búsqueda</Text>
        }
      />

      <Modal visible={!!generatedCode} transparent animationType="fade" onRequestClose={() => setGeneratedCode(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Ionicons name="key" size={40} color={Colors.primary} />
            <Text style={styles.modalTitle}>Código de invitación</Text>
            <Text style={styles.modalCode}>{generatedCode}</Text>
            <Text style={styles.modalHint}>
              Envía este código por WhatsApp o SMS. Los contactos lo usarán al registrarse para unirse a tu workspace.
            </Text>
            <TouchableOpacity style={styles.modalBtn} onPress={copyCode}>
              <Ionicons name="copy" size={16} color="#FFF" />
              <Text style={styles.modalBtnText}>Copiar código</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modalBtn, styles.modalBtnOutline]} onPress={shareCode}>
              <Ionicons name="share-social" size={16} color={Colors.primary} />
              <Text style={styles.modalBtnOutlineText}>Compartir (WhatsApp/SMS)</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setGeneratedCode(null)} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.xxl },
  stickyHeader: {
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl + 20,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md, gap: Spacing.md },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: Colors.text },
  headerSub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md, paddingVertical: 2,
    borderWidth: 1, borderColor: Colors.border,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: Colors.text },
  searchResultHint: { fontSize: 13, color: Colors.textSecondary, marginBottom: Spacing.sm, marginTop: -Spacing.xs },
  section: { marginBottom: Spacing.xl },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: Spacing.sm },
  sectionHint: { fontSize: 13, color: Colors.textSecondary, marginBottom: Spacing.md },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, padding: Spacing.md, borderRadius: BorderRadius.lg,
    marginBottom: Spacing.sm, ...Shadows.card,
  },
  itemSelected: { borderWidth: 2, borderColor: Colors.primary },
  avatar: {
    width: 36, height: 36, borderRadius: BorderRadius.full,
    backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: Colors.primary, fontWeight: '700', fontSize: 15 },
  itemInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  itemName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  itemSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  badgesRow: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  badgeCreator: { fontSize: 10, fontWeight: '700', color: Colors.primaryDark, backgroundColor: Colors.primaryLight, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeOnline: { fontSize: 10, fontWeight: '700', color: Colors.success, backgroundColor: '#E0FFE0', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeMember: { fontSize: 10, fontWeight: '700', color: Colors.success, backgroundColor: '#E0FFE0', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeRegistered: { fontSize: 10, fontWeight: '700', color: Colors.primary, backgroundColor: Colors.primaryLight, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeInvited: { fontSize: 10, fontWeight: '700', color: Colors.textTertiary, backgroundColor: '#EEE', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  iconBtn: { padding: Spacing.sm },
  emptyText: { fontSize: 14, color: Colors.textTertiary, textAlign: 'center', paddingVertical: Spacing.lg },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    backgroundColor: Colors.primary, paddingVertical: Spacing.md, borderRadius: BorderRadius.lg,
    marginBottom: Spacing.md,
  },
  primaryBtnText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  actionBar: {
    flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.surface,
    padding: Spacing.md, borderRadius: BorderRadius.lg, ...Shadows.card, marginBottom: Spacing.xl,
  },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: Spacing.md, borderRadius: BorderRadius.md,
  },
  actionPrimary: { backgroundColor: Colors.primary },
  actionPrimaryText: { color: '#FFF', fontWeight: '600', fontSize: 13 },
  actionSecondary: { backgroundColor: Colors.primaryLight },
  actionSecondaryText: { color: Colors.primary, fontWeight: '600', fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: Spacing.xl },
  modalCard: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.xl, alignItems: 'center', ...Shadows.card },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginTop: Spacing.sm, marginBottom: Spacing.sm },
  modalCode: { fontSize: 22, fontWeight: '700', color: Colors.primary, fontFamily: 'monospace', marginBottom: Spacing.sm },
  modalHint: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginBottom: Spacing.lg },
  modalBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'stretch',
    backgroundColor: Colors.primary, paddingVertical: Spacing.md, borderRadius: BorderRadius.md, marginBottom: Spacing.sm,
  },
  modalBtnText: { color: '#FFF', fontWeight: '600', fontSize: 14 },
  modalBtnOutline: { backgroundColor: Colors.primaryLight },
  modalBtnOutlineText: { color: Colors.primary, fontWeight: '600', fontSize: 14 },
  modalClose: { marginTop: Spacing.xs, paddingVertical: Spacing.sm },
  modalCloseText: { color: Colors.textTertiary, fontWeight: '500', fontSize: 14 },
});

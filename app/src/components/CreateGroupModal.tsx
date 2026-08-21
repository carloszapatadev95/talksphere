import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, FlatList, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../services/api';
import { User } from '../types';
import { Colors, Spacing, BorderRadius } from '../theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated?: () => void;
};

export default function CreateGroupModal({ visible, onClose, onCreated }: Props) {
  const insets = useSafeAreaInsets();
  const [groupName, setGroupName] = useState('');
  const [contacts, setContacts] = useState<User[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setGroupName('');
    setSelectedIds([]);
    setError('');
    setKeyboardHeight(0);
    api.get('/users/contacts').then(({ data }) => setContacts(data.contacts)).catch(() => {});
  }, [visible]);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const createGroup = async () => {
    if (!groupName.trim() || selectedIds.length === 0) {
      setError('Nombre y al menos un miembro requerido');
      return;
    }
    setError('');
    try {
      await api.post('/groups', { name: groupName.trim(), memberIds: selectedIds });
      onClose();
      onCreated?.();
    } catch {
      setError('Error al crear grupo');
    }
  };

  const toggleMember = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.content, { paddingBottom: Spacing.xl + insets.bottom + keyboardHeight }]}>
          <Text style={styles.title}>Nuevo Grupo</Text>
          <TextInput
            style={styles.input}
            placeholder="Nombre del grupo"
            placeholderTextColor={Colors.textTertiary}
            value={groupName}
            onChangeText={setGroupName}
          />
          <Text style={styles.sectionTitle}>Miembros:</Text>
          <FlatList
            data={contacts}
            keyExtractor={(item) => String(item.id)}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.memberItem} onPress={() => toggleMember(item.id)}>
                <View style={[styles.checkbox, selectedIds.includes(item.id) && styles.checked]}>
                  {selectedIds.includes(item.id) && (
                    <Ionicons name="checkmark" size={16} color="#FFF" />
                  )}
                </View>
                <Text style={styles.memberName}>{item.username}</Text>
              </TouchableOpacity>
            )}
          />
          <View style={styles.buttons}>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveButton} onPress={createGroup}>
              <Text style={styles.saveText}>Crear</Text>
            </TouchableOpacity>
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  content: {
    backgroundColor: Colors.surface, borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl, padding: Spacing.xl, maxHeight: '80%',
  },
  title: { fontSize: 20, fontWeight: '700', color: Colors.text, marginBottom: Spacing.lg },
  input: {
    borderWidth: 1, borderColor: Colors.borderLight, borderRadius: BorderRadius.md,
    padding: Spacing.md, fontSize: 16, color: Colors.text, marginBottom: Spacing.lg,
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: Colors.text, marginBottom: Spacing.sm },
  memberItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm, gap: Spacing.md,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: Colors.borderLight,
    justifyContent: 'center', alignItems: 'center',
  },
  checked: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  memberName: { fontSize: 16, color: Colors.text },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: Spacing.lg, gap: Spacing.lg },
  cancelText: { color: Colors.textSecondary, fontSize: 16, fontWeight: '500' },
  saveButton: {
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
  },
  saveText: { color: '#FFF', fontWeight: '600', fontSize: 16 },
  errorText: { color: Colors.error, fontSize: 14, textAlign: 'center', marginTop: Spacing.md },
});

import { useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../store/useStore';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';
import { SOCKET_URL } from '../constants/config';
import Avatar from '../components/Avatar';
import CreateGroupModal from '../components/CreateGroupModal';

type Props = { navigation: NativeStackNavigationProp<any> };

export default function GroupsScreen({ navigation }: Props) {
  const { groups, setGroups, activeWorkspaceId } = useStore();
  const [modalVisible, setModalVisible] = useState(false);
  const SERVER_BASE = SOCKET_URL;

  useEffect(() => {
    loadGroups();
  }, [activeWorkspaceId]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = ({ groupId: removedId }: { groupId: number }) => {
      const current = useStore.getState().groups;
      useStore.getState().setGroups(current.filter((g) => g.id !== removedId));
    };
    const addedHandler = () => {
      loadGroups();
    };
    const infoHandler = () => {
      loadGroups();
    };
    socket.on('removed_from_group', handler);
    socket.on('added_to_group', addedHandler);
    socket.on('group_info_updated', infoHandler);
    return () => {
      socket.off('removed_from_group', handler);
      socket.off('added_to_group', addedHandler);
      socket.off('group_info_updated', infoHandler);
    };
  }, []);

  const loadGroups = async () => {
    try {
      const { data } = await api.get('/groups');
      setGroups(data.groups);
    } catch {}
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.createButton} onPress={() => setModalVisible(true)}>
        <Ionicons name="add" size={20} color="#FFF" />
        <Text style={styles.createText}>Crear Grupo</Text>
      </TouchableOpacity>

      <FlatList
        data={groups}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.item}
            onPress={() => navigation.navigate('GroupChat', { group: item })}
          >
            <Avatar
              uri={item.avatar_url}
              name={item.name}
              size={48}
              baseUrl={SERVER_BASE}
            />
            <View style={styles.info}>
              <Text style={styles.name}>{item.name}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textTertiary} />
          </TouchableOpacity>
        )}
      />

      <CreateGroupModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onCreated={loadGroups}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.md },
  createButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    margin: Spacing.md, backgroundColor: Colors.primary, borderRadius: BorderRadius.lg,
    padding: Spacing.md, gap: Spacing.sm, ...Shadows.card,
  },
  createText: { color: '#FFF', fontWeight: '600', fontSize: 16 },
  item: {
    flexDirection: 'row', alignItems: 'center', padding: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    marginBottom: Spacing.sm, ...Shadows.card,
  },
  info: { marginLeft: Spacing.md, flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: Colors.text },
});

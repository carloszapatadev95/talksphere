import { useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../store/useStore';
import { useChat } from '../hooks/useChat';
import { getSocket } from '../services/socket';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';
import { SOCKET_URL } from '../constants/config';
import Avatar from '../components/Avatar';

type Props = { navigation: NativeStackNavigationProp<any> };

export default function ChatListScreen({ navigation }: Props) {
  const { conversations, onlineUsers, activeWorkspaceId } = useStore();
  const { fetchConversations } = useChat();
  const [refreshing, setRefreshing] = useState(false);
  const SERVER_BASE = SOCKET_URL;

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchConversations();
    setRefreshing(false);
  };

  useEffect(() => {
    fetchConversations();
    const socket = getSocket();
    if (socket) {
      socket.on('connect', fetchConversations);
      socket.on('removed_from_group', fetchConversations);
      return () => {
        socket.off('connect', fetchConversations);
        socket.off('removed_from_group', fetchConversations);
      };
    }
  }, [activeWorkspaceId]);

  const renderItem = ({ item }: any) => (
    <TouchableOpacity
      style={styles.item}
      onPress={() =>
        navigation.navigate('Chat', {
          user: {
            id: item.contact_id,
            username: item.username,
            avatar_url: item.avatar_url,
          },
        })
      }
    >
      <Avatar
        uri={item.avatar_url}
        name={item.username}
        size={48}
        online={onlineUsers.has(item.contact_id)}
        baseUrl={SERVER_BASE}
      />
      <View style={styles.info}>
        <Text style={styles.name}>{item.username}</Text>
        <Text style={styles.lastMessage} numberOfLines={1}>
          {item.last_message || 'Sin mensajes'}
        </Text>
      </View>
      <View style={styles.rightCol}>
        <Text style={styles.time}>
          {new Date(item.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
        {item.unread_count > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{item.unread_count > 99 ? '99+' : item.unread_count}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {conversations.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="chatbubble-ellipses-outline" size={56} color={Colors.textTertiary} />
          <Text style={styles.emptyText}>Sin conversaciones aún</Text>
          <Text style={styles.emptySubtext}>Ve a Contactos para iniciar un chat</Text>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => String(item.contact_id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.md },
  item: {
    flexDirection: 'row', alignItems: 'center', padding: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    marginBottom: Spacing.sm, ...Shadows.card,
  },
  info: { marginLeft: Spacing.md, flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: Colors.text },
  lastMessage: { fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
  time: { fontSize: 12, color: Colors.textTertiary },
  rightCol: { alignItems: 'center', gap: 4 },
  badge: {
    backgroundColor: Colors.error, borderRadius: 10, minWidth: 20,
    height: 20, paddingHorizontal: 6, justifyContent: 'center', alignItems: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 18, color: Colors.textSecondary, marginTop: Spacing.md },
  emptySubtext: { fontSize: 14, color: Colors.textTertiary, marginTop: Spacing.sm },
});

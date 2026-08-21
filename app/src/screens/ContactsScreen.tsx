import { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../store/useStore';
import { useChat } from '../hooks/useChat';
import { User } from '../types';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';
import { SOCKET_URL } from '../constants/config';
import Avatar from '../components/Avatar';

type Props = { navigation: NativeStackNavigationProp<any> };

export default function ContactsScreen({ navigation }: Props) {
  const { contacts, onlineUsers, activeWorkspaceId } = useStore();
  const { fetchContacts, searchUsers } = useChat();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const SERVER_BASE = SOCKET_URL;

  useEffect(() => {
    fetchContacts();
    setQuery('');
    setResults([]);
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (query.length >= 2) {
      searchUsers(query).then(setResults);
    } else {
      setResults([]);
    }
  }, [query]);

  const displayList = query.length >= 2 ? results : contacts;

  const renderItem = ({ item }: { item: User }) => (
    <TouchableOpacity
      style={styles.item}
      onPress={() => navigation.navigate('Chat', { user: item })}
    >
      <Avatar
        uri={item.avatar_url}
        name={item.username}
        size={48}
        online={onlineUsers.has(item.id)}
        baseUrl={SERVER_BASE}
      />
      <View style={styles.info}>
        <Text style={styles.name}>{item.username}</Text>
        <Text style={styles.status}>
          {onlineUsers.has(item.id) ? 'En línea' : 'Desconectado'}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color={Colors.textTertiary} style={styles.searchIcon} />
        <TextInput
          style={styles.search}
          placeholder="Buscar usuarios..."
          placeholderTextColor={Colors.textTertiary}
          value={query}
          onChangeText={setQuery}
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={20} color={Colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        data={displayList}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  searchContainer: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface,
    margin: Spacing.md, borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.md,
    borderWidth: 1, borderColor: Colors.border, ...Shadows.card,
  },
  searchIcon: { marginRight: Spacing.sm },
  search: { flex: 1, paddingVertical: Spacing.md, fontSize: 16, color: Colors.text },
  item: {
    flexDirection: 'row', alignItems: 'center', padding: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    marginBottom: Spacing.sm, ...Shadows.card,
  },
  info: { marginLeft: Spacing.md, flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: Colors.text },
  status: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
});

import { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Keyboard, Platform, ActivityIndicator, Alert } from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { useChat } from '../hooks/useChat';
import { useImagePicker } from '../hooks/useImagePicker';
import api from '../services/api';
import MessageBubble from '../components/MessageBubble';
import TypingIndicator from '../components/TypingIndicator';
import { Message } from '../types';
import { getSocket } from '../services/socket';
import { Colors } from '../theme';
import { useGroupCall } from '../hooks/useGroupCall';

type NavProp = NativeStackNavigationProp<any>;

type RouteParams = { GroupChat: { group: { id: number; name: string } } };

export default function GroupChatScreen() {
  const route = useRoute<RouteProp<RouteParams, 'GroupChat'>>();
  const navigation = useNavigation<NavProp>();
  const insets = useSafeAreaInsets();
  const { user: me, messages, setMessages } = useStore();
  const [text, setText] = useState('');
  const [groupMessages, setGroupMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [typingUsers, setTypingUsers] = useState<number[]>([]);
  const isNearBottom = useRef(true);
  const flatListRef = useRef<FlatList>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memberNames = useRef<Map<number, string>>(new Map());
  const offsetRef = useRef(0);
  const paginatingRef = useRef(false);
  const hasScrolledInitial = useRef(false);
  const tempIdRef = useRef(0);
  const pendingClientIds = useRef<Map<string, number>>(new Map());
  const group = route.params.group;
  const PAGE_SIZE = 30;
  const { sendGroupMessage, sendGroupTyping } = useChat();
  const { pickFromGallery, takePhoto, uploadImage, uploading } = useImagePicker();
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const { fetchToken, loading: tokenLoading } = useGroupCall();

  const handleGroupImageSend = async (localUri: string) => {
    const url = await uploadImage(localUri);
    if (!url) return;
    sendGroupMessage(group.id, url, 'image');
  };

  const pickGroupImage = () => {
    Alert.alert('Enviar imagen', 'Selecciona una opción', [
      { text: 'Galería', onPress: async () => {
        const uri = await pickFromGallery();
        if (uri) handleGroupImageSend(uri);
      }},
      { text: 'Cámara', onPress: async () => {
        const uri = await takePhoto();
        if (uri) handleGroupImageSend(uri);
      }},
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const startGroupCall = (callType: 'voice' | 'video') => {
    const room = `group-${group.id}`;
    fetchToken(room).then((token) => {
      if (!token) {
        Alert.alert('Error', 'No se pudo iniciar la llamada grupal');
        return;
      }
      navigation.navigate('Call', {
        isGroupCall: true,
        groupId: group.id,
        groupName: group.name,
        roomName: room,
        token,
        callType,
      });
      getSocket()?.emit('group_call_started', { groupId: group.id, roomName: room, callType, groupName: group.name });
    });
  };

  useEffect(() => {
    navigation.setOptions({
      title: group.name,
      headerRight: () => (
        <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
          <TouchableOpacity onPress={() => startGroupCall('voice')} disabled={tokenLoading} style={{ paddingHorizontal: 8 }}>
            <Ionicons name="call" size={22} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => startGroupCall('video')} disabled={tokenLoading} style={{ paddingHorizontal: 8 }}>
            <Ionicons name="videocam" size={22} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('GroupInfo', { group: { id: group.id, name: group.name } })}>
            <Ionicons name="information-circle-outline" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      ),
    });
    loadMessages();
    api.get(`/groups/${group.id}/members`).then(({ data }) => {
      const map = new Map<number, string>();
      for (const m of data.members) {
        map.set(m.id, m.username);
      }
      memberNames.current = map;
    }).catch(() => {});
  }, [group.id]);

  useEffect(() => {
    useStore.getState().setActiveGroupId(group.id);
    return () => {
      useStore.getState().setActiveGroupId(null);
    };
  }, [group.id]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const msgHandler = (msg: Message & { _clientId?: string }) => {
      if (msg.group_id === group.id) {
        if (msg._clientId) {
          const tempId = pendingClientIds.current.get(msg._clientId);
          if (tempId !== undefined) {
            setGroupMessages((prev) =>
              prev.map((m) => (m.id === tempId ? { ...m, id: msg.id } : m))
            );
            pendingClientIds.current.delete(msg._clientId);
            return;
          }
        }
        setGroupMessages((prev) => [...prev, msg]);
        if (isNearBottom.current) {
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
        }
      }
    };
    const typingHandler = ({ userId, groupId: gid, isTyping: typing }: { userId: number; groupId?: number; isTyping: boolean }) => {
      if (gid !== group.id) return;
      if (typing) {
        if (typingTimeout.current) clearTimeout(typingTimeout.current);
        typingTimeout.current = setTimeout(() => {
          typingTimeout.current = null;
          setTypingUsers((prev) =>
            prev.includes(userId) ? prev : [...prev, userId]
          );
        }, 300);
      } else {
        if (typingTimeout.current) {
          clearTimeout(typingTimeout.current);
          typingTimeout.current = null;
        }
        setTypingUsers((prev) => prev.filter((id) => id !== userId));
      }
    };
    socket.on('new_message', msgHandler);
    socket.on('typing_indicator', typingHandler);
    const removedHandler = ({ groupId }: { groupId: number }) => {
      if (groupId === group.id) {
        Alert.alert('Eliminado del grupo', 'Ya no eres miembro de este grupo');
        navigation.goBack();
      }
    };
    socket.on('removed_from_group', removedHandler);
    return () => {
      socket.off('new_message', msgHandler);
      socket.off('typing_indicator', typingHandler);
      socket.off('removed_from_group', removedHandler);
    };
  }, [group.id]);

  const loadMessages = async (reset = true) => {
    if (reset) {
      setLoading(true);
      offsetRef.current = 0;
      setHasMore(true);
    }
    try {
      const { data } = await api.get(`/groups/${group.id}/messages`, {
        params: { limit: PAGE_SIZE, offset: reset ? 0 : offsetRef.current },
      });
      if (reset) {
        setGroupMessages(data.messages);
      } else {
        setGroupMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newMsgs = data.messages.filter((m: Message) => !existingIds.has(m.id));
          if (newMsgs.length === 0) return prev;
          return [...newMsgs, ...prev];
        });
      }
      setHasMore(data.hasMore);
    } catch {}
    setLoading(false);
  };

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || paginatingRef.current) return;
    setLoadingMore(true);
    paginatingRef.current = true;
    offsetRef.current += PAGE_SIZE;
    await loadMessages(false);
    setLoadingMore(false);
    paginatingRef.current = false;
  }, [loadingMore, hasMore]);

  const handleScroll = (e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    isNearBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 120;
    if (contentOffset.y <= 2 && hasMore && !loadingMore) {
      loadMore();
    }
  };

  const handleSend = () => {
    if (!text.trim()) return;
    const _clientId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    tempIdRef.current -= 1;
    const tempId = tempIdRef.current;
    pendingClientIds.current.set(_clientId, tempId);
    const optimisticMsg: Message = {
      id: tempId,
      sender_id: me?.id || 0,
      receiver_id: null,
      group_id: group.id,
      content: text.trim(),
      message_type: 'text',
      created_at: new Date().toISOString(),
      read_at: null,
      reply_to_id: replyToMessage?.id || null,
      replied_to: replyToMessage ? {
        id: replyToMessage.id,
        sender_id: replyToMessage.sender_id,
        sender_name: replyToMessage.sender_name || '',
        content: replyToMessage.content,
        message_type: replyToMessage.message_type,
      } : null,
    };
    setGroupMessages((prev) => [...prev, optimisticMsg]);
    if (isNearBottom.current) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    }
    sendGroupMessage(group.id, text.trim(), 'text', replyToMessage?.id, _clientId);
    setText('');
    setReplyToMessage(null);
    sendGroupTyping(group.id, false);
  };

  const handleTextChange = useCallback((value: string) => {
    setText(value);
    sendGroupTyping(group.id, value.trim().length > 0);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      typingTimeout.current = null;
      sendGroupTyping(group.id, false);
    }, 2000);
  }, [group.id, sendGroupTyping]);

  const inner = (
    <>
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={groupMessages}
          keyExtractor={(item, idx) => String(item.id || idx)}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              isMine={item.sender_id === me?.id}
              onReply={setReplyToMessage}
            />
          )}
          onScroll={handleScroll}
          scrollEventThrottle={100}
          onContentSizeChange={() => {
            if (!hasScrolledInitial.current) {
              flatListRef.current?.scrollToEnd({ animated: false });
              hasScrolledInitial.current = true;
            } else if (isNearBottom.current) {
              flatListRef.current?.scrollToEnd({ animated: true });
            }
          }}
          ListHeaderComponent={loadingMore ? (
            <View style={styles.loadingMore}><ActivityIndicator size="small" color={Colors.primary} /></View>
          ) : null}
          contentContainerStyle={styles.messagesList}
        />
      )}

      {typingUsers.length > 0 && (
        <TypingIndicator
          usernames={typingUsers.map((id) => memberNames.current.get(id) || 'Alguien')}
        />
      )}

      {replyToMessage && (
        <View style={styles.replyBanner}>
          <View style={styles.replyBannerLine} />
          <View style={styles.replyBannerContent}>
            <Text style={styles.replyBannerLabel}>Respondiendo a {replyToMessage.sender_name}</Text>
            <Text style={styles.replyBannerText} numberOfLines={1}>
              {replyToMessage.message_type === 'image' ? '📷 Imagen' : replyToMessage.content}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setReplyToMessage(null)} style={styles.replyBannerClose}>
            <Ionicons name="close" size={20} color="#5F6368" />
          </TouchableOpacity>
        </View>
      )}

      <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
        <TouchableOpacity style={styles.imageButton} onPress={pickGroupImage} disabled={uploading}>
          <Ionicons name={uploading ? 'hourglass' : 'camera-outline'} size={22} color="#5F6368" />
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder="Escribe un mensaje..."
          value={text}
          onChangeText={handleTextChange}
          multiline
        />
        <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
          <Text style={styles.sendText}>Enviar</Text>
        </TouchableOpacity>
      </View>

      {Platform.OS === 'android' && keyboardHeight > 0 && <View style={{ height: keyboardHeight }} />}
    </>
  );

  if (Platform.OS === 'ios') {
    return <KeyboardAvoidingView style={styles.container} behavior="padding" keyboardVerticalOffset={90}>{inner}</KeyboardAvoidingView>;
  }
  return <View style={styles.container}>{inner}</View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  messagesList: { padding: 12 },
  loadingMore: { paddingVertical: 12, alignItems: 'center' },
  inputBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#E8EAED',
  },
  input: {
    flex: 1, backgroundColor: '#F1F3F4', borderRadius: 20, paddingHorizontal: 16,
    paddingVertical: 8, maxHeight: 100, fontSize: 16,
  },
  imageButton: { padding: 8, marginRight: 4 },
  sendButton: { marginLeft: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: Colors.primary, borderRadius: 20 },
  sendText: { color: '#FFFFFF', fontWeight: '600' },
  replyBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F1F3F4', paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#E8EAED' },
  replyBannerLine: { width: 3, backgroundColor: Colors.primary, borderRadius: 2, marginRight: 8 },
  replyBannerContent: { flex: 1 },
  replyBannerLabel: { fontSize: 11, color: Colors.primary, fontWeight: '600' },
  replyBannerText: { fontSize: 13, color: '#5F6368', marginTop: 2 },
  replyBannerClose: { padding: 4, marginLeft: 8 },
});

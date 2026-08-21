import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Keyboard, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { FlashList, FlashListRef } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation, useFocusEffect, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { useChat } from '../hooks/useChat';
import { useImagePicker } from '../hooks/useImagePicker';
import { getSocket } from '../services/socket';
import { Colors } from '../theme';
import { Message } from '../types';
import MessageBubble from '../components/MessageBubble';
import TypingIndicator from '../components/TypingIndicator';

const keyExtractor = (item: Message) => String(item.id);

type RouteParams = { Chat: { user: { id: number; username: string } } };

export default function ChatScreen() {
  const route = useRoute<RouteProp<RouteParams, 'Chat'>>();
  const navigation = useNavigation();
  const { user: me, setMessages, socketConnected } = useStore();
  const { fetchMessages, sendMessage, sendTyping, markAsRead } = useChat();
  const [text, setText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState<number[]>([]);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const flatListRef = useRef<FlashListRef<Message>>(null);
  const isNearBottom = useRef(true);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offsetRef = useRef(0);
  const paginatingRef = useRef(false);
  const hasScrolledInitial = useRef(false);
  const PAGE_SIZE = 30;
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const insets = useSafeAreaInsets();
  const partner = route.params.user;
  const chatKey = String(partner.id);
  const handlersAttached = useRef(false);
  const markReadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tempIdRef = useRef(0);
  const pendingClientIds = useRef<Map<string, number>>(new Map());
  const { pickFromGallery, takePhoto, uploadImage, uploading } = useImagePicker();
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);

  const pickImage = () => {
    Alert.alert('Enviar imagen', 'Selecciona una opción', [
      { text: 'Galería', onPress: async () => {
        const uri = await pickFromGallery();
        if (uri) handleImageSend(uri);
      }},
      { text: 'Cámara', onPress: async () => {
        const uri = await takePhoto();
        if (uri) handleImageSend(uri);
      }},
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const handleImageSend = async (localUri: string) => {
    const url = await uploadImage(localUri);
    if (!url) return;
    sendMessage(partner.id, url, 'image');
  };

  const debouncedMarkAsRead = useCallback((senderId: number) => {
    if (markReadTimer.current) clearTimeout(markReadTimer.current);
    markReadTimer.current = setTimeout(() => {
      markReadTimer.current = null;
      markAsRead(senderId);
    }, 500);
  }, [markAsRead]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || handlersAttached.current) return;

    const newMsgHandler = (msg: Message & { _clientId?: string }) => {
      if (msg._clientId && msg.sender_id === me?.id) {
        console.timeEnd('[Perf] send:' + msg._clientId);
      }
      const isRelevant =
        (msg.sender_id === partner.id && msg.receiver_id === me?.id) ||
        (msg.sender_id === me?.id && msg.receiver_id === partner.id);
      if (isRelevant) {
        setChatMessages((prev) => {
          if (msg._clientId && msg.sender_id === me?.id) {
            const tempId = pendingClientIds.current.get(msg._clientId);
            if (tempId !== undefined) {
              const idx = prev.findIndex((m) => m.id === tempId);
              if (idx !== -1) {
                const updated = [...prev];
                updated[idx] = msg;
                pendingClientIds.current.delete(msg._clientId);
                return updated;
              }
            }
          }
          if (prev.length === 0 || msg.id > prev[prev.length - 1].id) return [...prev, msg];
          const exists = prev.some((m) => m.id === msg.id);
          if (exists) return prev;
          const idx = prev.findIndex((m) => m.id > msg.id);
          return idx === -1 ? [...prev, msg] : [...prev.slice(0, idx), msg, ...prev.slice(idx)];
        });
        if (msg.sender_id === partner.id) {
          debouncedMarkAsRead(partner.id);
        }
      }
    };
    const readHandler = ({ readBy }: { readBy: number }) => {
      if (readBy === partner.id) {
        setLastReadAt(new Date().toISOString());
      }
    };
    const typingHandler = ({ userId, isTyping: typing }: { userId: number; isTyping: boolean }) => {
      if (userId === partner.id) {
        if (typing) {
          if (typingTimer.current) clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => {
            typingTimer.current = null;
            setTypingUsers((prev) =>
              prev.includes(userId) ? prev : [...prev, userId]
            );
          }, 300);
        } else {
          if (typingTimer.current) {
            clearTimeout(typingTimer.current);
            typingTimer.current = null;
          }
          setTypingUsers((prev) => prev.filter((id) => id !== userId));
        }
      }
    };
    socket.on('new_message', newMsgHandler);
    socket.on('messages_read', readHandler);
    socket.on('typing_indicator', typingHandler);
    handlersAttached.current = true;

    return () => {
      socket.off('new_message', newMsgHandler);
      socket.off('messages_read', readHandler);
      socket.off('typing_indicator', typingHandler);
      handlersAttached.current = false;
    };
  }, [partner.id, me?.id, markAsRead]);

  useEffect(() => {
    useStore.getState().setActiveChatUserId(partner.id);
    return () => {
      useStore.getState().setActiveChatUserId(null);
    };
  }, [partner.id]);

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
    navigation.setOptions({
      title: partner.username,
      headerRight: () => (
        <View style={{ flexDirection: 'row', gap: 4 }}>
            <TouchableOpacity
            onPress={() => (navigation as any).navigate('Call', { user: partner, callType: 'voice', isIncoming: false })}
            style={{ paddingHorizontal: 8 }}
          >
            <Ionicons name="call" size={22} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => (navigation as any).navigate('Call', { user: partner, callType: 'video', isIncoming: false })}
            style={{ paddingHorizontal: 8 }}
          >
            <Ionicons name="videocam" size={22} color="#FFF" />
          </TouchableOpacity>
        </View>
      ),
    });
    setLoading(true);
    offsetRef.current = 0;
    setHasMore(true);
    fetchMessages(partner.id, { limit: PAGE_SIZE }).then(({ messages: msgs, hasMore: more }) => {
      setChatMessages(msgs);
      setMessages(chatKey, msgs);
      setHasMore(more);
      setLoading(false);
    });
  }, [partner.id]);

  useEffect(() => {
    if (!loading && chatMessages.length > 0) {
      console.timeEnd('[Perf] Chat fetchMessages');
    }
  }, [loading]);

  useFocusEffect(
    useCallback(() => {
      if (me?.id && partner.id) {
        markAsRead(partner.id);
      }
    }, [me?.id, partner?.id, markAsRead])
  );

  useEffect(() => {
    if (chatMessages.length === 0) return;
    if (!hasScrolledInitial.current) {
      if (!loading) {
        const timer = setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: false });
          hasScrolledInitial.current = true;
        }, 100);
        return () => clearTimeout(timer);
      }
      return;
    }
    const last = chatMessages[chatMessages.length - 1];
    if (last?.sender_id === me?.id || isNearBottom.current) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [chatMessages.length, loading]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    paginatingRef.current = true;
    const newOffset = offsetRef.current + PAGE_SIZE;
    const result = await fetchMessages(partner.id, { limit: PAGE_SIZE, offset: newOffset });
    if (result.messages.length > 0) {
      setChatMessages(prev => {
        const existingIds = new Set(prev.map(m => m.id));
        const newMsgs = result.messages.filter(m => !existingIds.has(m.id));
        if (newMsgs.length === 0) return prev;
        return [...newMsgs, ...prev];
      });
      offsetRef.current = newOffset;
    }
    setHasMore(result.hasMore);
    setLoadingMore(false);
  }, [partner.id, fetchMessages, loadingMore, hasMore]);

  const handleScroll = useCallback((e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    isNearBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 120;
    if (contentOffset.y <= 2 && hasMore && !loadingMore) {
      loadMore();
    }
  }, [hasMore, loadingMore, loadMore]);

  const handleSend = () => {
    if (!text.trim()) return;
    const _clientId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    tempIdRef.current -= 1;
    const tempId = tempIdRef.current;
    pendingClientIds.current.set(_clientId, tempId);
    const optimisticMsg: Message = {
      id: tempId,
      sender_id: me?.id || 0,
      receiver_id: partner.id,
      group_id: null,
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
    setChatMessages((prev) => [...prev, optimisticMsg]);
    sendMessage(partner.id, text.trim(), 'text', replyToMessage?.id, _clientId, (ack) => {
      if (ack.status === 'ok') {
        setChatMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, id: ack.id } : m))
        );
      }
    });
    setText('');
    setReplyToMessage(null);
  };

  const handleChangeText = (t: string) => {
    setText(t);
    if (!isTyping) {
      setIsTyping(true);
      sendTyping(partner.id, true);
    }
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      setIsTyping(false);
      sendTyping(partner.id, false);
    }, 2000);
  };

  const renderMessage = useCallback(
    ({ item }: { item: Message }) => (
      <MessageBubble
        message={item}
        isMine={item.sender_id === me?.id}
        lastReadAt={lastReadAt}
        onReply={setReplyToMessage}
      />
    ),
    [me?.id, lastReadAt]
  );

  const inner = (
    <>
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlashList
          ref={flatListRef}
          data={chatMessages}
          keyExtractor={keyExtractor}
          renderItem={renderMessage}
          onScroll={handleScroll}
          scrollEventThrottle={100}
          ListHeaderComponent={loadingMore ? (
            <View style={styles.loadingMore}><ActivityIndicator size="small" color={Colors.primary} /></View>
          ) : null}
          contentContainerStyle={styles.messagesList}
          maintainVisibleContentPosition={{ startRenderingFromBottom: true }}
        />
      )}

      {!socketConnected && (
        <View style={styles.connectingBanner}>
          <ActivityIndicator size="small" color="#FFF" />
          <Text style={styles.connectingText}>Sin conexión...</Text>
        </View>
      )}

      {typingUsers.length > 0 && <TypingIndicator username={partner.username} />}

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
        <TouchableOpacity style={styles.imageButton} onPress={pickImage} disabled={uploading}>
          <Ionicons name={uploading ? 'hourglass' : 'camera-outline'} size={22} color="#5F6368" />
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder="Escribe un mensaje..."
          value={text}
          onChangeText={handleChangeText}
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
  connectingBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F9A825', paddingVertical: 4, gap: 8,
  },
  connectingText: { color: '#FFF', fontSize: 13, fontWeight: '500' },
  replyBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F1F3F4', paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#E8EAED' },
  replyBannerLine: { width: 3, backgroundColor: Colors.primary, borderRadius: 2, marginRight: 8 },
  replyBannerContent: { flex: 1 },
  replyBannerLabel: { fontSize: 11, color: Colors.primary, fontWeight: '600' },
  replyBannerText: { fontSize: 13, color: '#5F6368', marginTop: 2 },
  replyBannerClose: { padding: 4, marginLeft: 8 },
});

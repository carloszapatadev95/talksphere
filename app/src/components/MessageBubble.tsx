import { memo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Image, TouchableOpacity, Modal, Dimensions, Pressable } from 'react-native';
import { Message } from '../types';
import { SOCKET_URL } from '../constants/config';
import Avatar from './Avatar';
import { Colors } from '../theme';

type Props = { message: Message; isMine: boolean; onReply?: (message: Message) => void };

const SCREEN_WIDTH = Dimensions.get('window').width;
const SERVER_BASE = SOCKET_URL;

function MessageBubble({ message, isMine, onReply }: Props) {
  const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isSending = isMine && message.id < 0;
  const isRead = isMine && !!message.read_at;
  const [imageModal, setImageModal] = useState(false);
  const isImage = message.message_type === 'image';
  const isLocalUri = isImage && message.content && !message.content.startsWith('/uploads');

  const imageUrl = message.content
    ? (message.content.startsWith('/uploads')
        ? `${SERVER_BASE}${message.content}`
        : message.content)
    : null;

  const showPlaceholder = isImage && message.id < 0 && isLocalUri;

  const replied = message.replied_to;

  return (
    <Pressable onLongPress={() => onReply?.(message)}>
      <View style={[styles.container, { maxWidth: replied ? '88%' : '80%' }, isMine ? styles.mine : styles.theirs]}>
        <View style={styles.row}>
          {!isMine && (
            <View style={styles.avatarCol}>
              <Avatar
                uri={message.sender_avatar}
                name={message.sender_name || ''}
                size={28}
                baseUrl={SERVER_BASE}
              />
            </View>
          )}
          <View style={styles.bubbleCol}>
            {!isMine && message.sender_name && (
              <Text style={styles.senderName}>{message.sender_name}</Text>
            )}
            <View style={[styles.bubble, isImage && styles.bubbleNoPadding, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
              {replied && (
                <View style={[styles.repliedContainer, isMine && styles.repliedContainerMine]}>
                  <View style={[styles.repliedBorder, isMine && styles.repliedBorderMine]} />
                  <Text style={[styles.repliedText, isMine && styles.repliedTextMine]} numberOfLines={1}>
                    {replied.message_type === 'image' ? '📷 Imagen' : replied.content}
                  </Text>
                </View>
              )}
              {isImage ? (
                <>
                  {showPlaceholder ? (
                    <View style={[styles.imagePlaceholder, isMine && styles.imagePlaceholderMine]}>
                      <ActivityIndicator size="small" color="#999" />
                      <Text style={styles.imagePlaceholderText}>Subiendo...</Text>
                    </View>
                  ) : (
                    <TouchableOpacity onPress={() => setImageModal(true)} disabled={isSending || isLocalUri}>
                      <Image
                        source={{ uri: imageUrl || undefined }}
                        style={styles.image}
                        resizeMode="cover"
                      />
                      {isSending && (
                        <View style={styles.imageOverlay}>
                          <ActivityIndicator size="small" color="#FFF" />
                        </View>
                      )}
                    </TouchableOpacity>
                  )}
                  <View style={[styles.imageFooter, isMine && styles.imageFooterMine]}>
                    <Text style={[styles.time, isMine && styles.timeMine]}>{time}</Text>
                    {isMine && (
                      isSending ? (
                        <ActivityIndicator size={10} color="rgba(255,255,255,0.7)" />
                      ) : (
                        <Text style={styles.readStatus}>
                          {isRead ? '✓✓' : '✓'}
                        </Text>
                      )
                    )}
                  </View>
                </>
              ) : (
                <>
                  <Text style={[styles.text, isMine && styles.textMine]}>{message.content}</Text>
                  <View style={[styles.footer, isMine && styles.footerMine]}>
                    <Text style={[styles.time, isMine && styles.timeMine]}>{time}</Text>
                    {isMine && (
                      isSending ? (
                        <ActivityIndicator size={10} color="rgba(255,255,255,0.7)" />
                      ) : (
                        <Text style={styles.readStatus}>
                          {isRead ? '✓✓' : '✓'}
                        </Text>
                      )
                    )}
                  </View>
                </>
              )}
            </View>
          </View>
        </View>

        <Modal visible={imageModal} transparent animationType="fade" onRequestClose={() => setImageModal(false)}>
          <TouchableOpacity style={styles.imagePreview} activeOpacity={1} onPress={() => setImageModal(false)}>
            <Image
              source={{ uri: imageUrl || undefined }}
              style={styles.previewImage}
              resizeMode="contain"
            />
          </TouchableOpacity>
        </Modal>
      </View>
    </Pressable>
  );
}

export default memo(MessageBubble, (prev, next) => {
  if (prev.message.id !== next.message.id) return false;
  if (prev.isMine !== next.isMine) return false;
  if (prev.message.content !== next.message.content) return false;
  if (prev.message.created_at !== next.message.created_at) return false;
  if (prev.message.read_at !== next.message.read_at) return false;
  if (prev.message.reply_to_id !== next.message.reply_to_id) return false;
  if (!!prev.message.replied_to !== !!next.message.replied_to) return false;
  return true;
});

const styles = StyleSheet.create({
  container: { marginVertical: 4 },
  mine: { alignSelf: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  avatarCol: { marginRight: 4, alignItems: 'flex-start' },
  bubbleCol: { flexShrink: 1 },
  senderName: { fontSize: 12, color: '#5F6368', marginBottom: 2, marginLeft: 4 },
  bubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 },
  bubbleNoPadding: { paddingHorizontal: 0, paddingVertical: 0, overflow: 'hidden' },
  bubbleMine: { backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: '#FFFFFF', borderBottomLeftRadius: 4 },
  text: { fontSize: 16, color: '#202124' },
  textMine: { color: '#FFFFFF' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4, gap: 4 },
  footerMine: { justifyContent: 'flex-end' },
  time: { fontSize: 11, color: '#9AA0A6', textAlign: 'right' },
  timeMine: { color: 'rgba(255,255,255,0.7)' },
  image: {
    width: SCREEN_WIDTH * 0.55,
    height: 200,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  imageFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 10, paddingVertical: 4,
  },
  imageFooterMine: { justifyContent: 'flex-end', gap: 8 },
  imagePreview: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center', alignItems: 'center',
  },
  previewImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH,
  },
  imagePlaceholder: {
    width: SCREEN_WIDTH * 0.55,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#E8EAED',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  imagePlaceholderMine: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  imagePlaceholderText: {
    marginTop: 6,
    fontSize: 12,
    color: '#999',
  },
  readStatus: { fontSize: 11, color: 'rgba(255,255,255,0.7)' },
  repliedContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.04)', borderRadius: 6, paddingVertical: 4, paddingHorizontal: 6, marginBottom: 4 },
  repliedContainerMine: { backgroundColor: 'rgba(255,255,255,0.15)' },
  repliedBorder: { width: 3, backgroundColor: '#9AA0A6', borderRadius: 2, marginRight: 6 },
  repliedBorderMine: { backgroundColor: 'rgba(255,255,255,0.5)' },
  repliedText: { fontSize: 13, color: '#5F6368', flexShrink: 1 },
  repliedTextMine: { color: 'rgba(255,255,255,0.7)' },
});

import { View, Text, TouchableOpacity, StyleSheet, FlatList, Platform } from 'react-native';
import { useTracks, useLocalParticipant, useRemoteParticipants, VideoTrack, useRoomContext } from '@livekit/react-native';
import { Track, RoomEvent, Room } from 'livekit-client';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { setAudioModeAsync } from 'expo-audio';
import { getSocket } from '../services/socket';
import DraggableView from './DraggableView';
import { RTCView } from '../services/webrtc';
import { Colors } from '../theme';
import { useStore } from '../store/useStore';

interface Props {
  groupId: number;
  groupName: string;
  roomName: string;
  callType: 'voice' | 'video';
}

export default function GroupCallContent({ groupId, groupName, roomName, callType }: Props) {
  const navigation = useNavigation();
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const [muted, setMuted] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(callType === 'video');
  const audioContextRef = useRef<any>(null);
  const hangingUpRef = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx && !audioContextRef.current) {
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;
        const gain = ctx.createGain();
        gain.gain.value = 1.0;
        gain.connect(ctx.destination);
      }
    }
    (async () => {
      try {
        await setAudioModeAsync({ shouldRouteThroughEarpiece: false, allowsRecording: true, shouldPlayInBackground: true });
      } catch (e) {
        console.warn('[GroupCallContent] setAudioModeAsync failed:', e);
      }
    })();

    useStore.getState().setCallActive(true);

    const socket = getSocket();
    const handleGroupCallEnded = ({ groupId: endedGroupId }: { groupId: number }) => {
      if (endedGroupId === groupId) {
        try {
          room?.disconnect();
        } catch (e) {
          console.warn('[GroupCallContent] room.disconnect error:', e);
        }
        if (navigation.isFocused()) {
          navigation.goBack();
        }
      }
    };
    if (socket) {
      socket.on('group_call_ended', handleGroupCallEnded);
    }

    const handleDisconnected = () => {
      useStore.getState().setCallActive(false);
    };
    if (room) {
      room.on(RoomEvent.Disconnected, handleDisconnected);
    }

    return () => {
      useStore.getState().setCallActive(false);
      if (socket) {
        socket.off('group_call_ended', handleGroupCallEnded);
      }
      if (room) {
        room.off(RoomEvent.Disconnected, handleDisconnected);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, [groupId, room, navigation]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    localParticipant?.setMicrophoneEnabled(!next);
  };

  const toggleVideo = () => {
    const next = !videoEnabled;
    setVideoEnabled(next);
    localParticipant?.setCameraEnabled(next);
  };

  const switchCamera = async () => {
    try {
      const devices = await Room.getLocalDevices('videoinput');
      const cameras = devices.filter((d: any) => (d.kind === 'videoinput' || d.kind === '') && d.deviceId);
      if (cameras.length < 2) {
        const track = (localParticipant?.getTrackPublication(Track.Source.Camera)?.track as any)?.mediaStreamTrack;
        if (track && typeof track._switchCamera === 'function') {
          track._switchCamera();
        }
        return;
      }
      const current = room?.getActiveDevice('videoinput');
      const idx = Math.max(0, cameras.findIndex((d: any) => d.deviceId === current));
      const next = cameras[(idx + 1) % cameras.length];
      await room?.switchActiveDevice('videoinput', next.deviceId);
    } catch (err) {
      console.warn('[GroupCallContent] switchCamera error:', err);
    }
  };

  const handleHangup = () => {
    hangingUpRef.current = true;
    room?.disconnect();
    getSocket()?.emit('group_call_ended', { groupId, roomName });
    navigation.goBack();
  };

  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', () => {
      if (!hangingUpRef.current && useStore.getState().isCallActive) {
        hangingUpRef.current = true;
        room?.disconnect();
        getSocket()?.emit('group_call_ended', { groupId, roomName });
      }
    });
    return unsub;
  }, [navigation, groupId, roomName, room]);

  const tracks = useTracks(
    [Track.Source.Camera, Track.Source.Microphone],
    { onlySubscribed: false }
  );

  const videoTracks = tracks.filter(
    (t) => t.source === Track.Source.Camera && t.publication?.isSubscribed
  );

  const localTracks = tracks.filter(
    (t) => t.participant?.identity === localParticipant?.identity
  );
  const localVideoTrack = localTracks.find(
    (t) => t.source === Track.Source.Camera
  );

  const renderParticipant = ({ item }: { item: any }) => {
    const identity = item.identity;
    const participantTracks = tracks.filter((t) => t.participant.identity === identity);
    const camTrack = participantTracks.find((t) => t.source === Track.Source.Camera);
    const isSubscribed = camTrack?.publication?.isSubscribed;
    const audioTrack = participantTracks.find((t) => t.source === Track.Source.Microphone);
    const isAudioMuted = audioTrack?.publication?.isMuted ?? true;

    return (
      <View style={[styles.tile, !isSubscribed && styles.tileEmpty]}>
        {isSubscribed && camTrack ? (
          <VideoTrack
            trackRef={camTrack}
            style={styles.video}
            objectFit="cover"
            zOrder={0}
          />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Ionicons name="person" size={40} color="#5F6368" />
          </View>
        )}
        <View style={styles.participantInfo}>
          <Text style={styles.participantName} numberOfLines={1}>
            {item.name || `#${item.identity}`}
          </Text>
          {isAudioMuted && <Ionicons name="mic-off" size={14} color="#EA4335" />}
        </View>
      </View>
    );
  };

  const remoteList = [...remoteParticipants].filter(
    (p: any) => p.identity !== localParticipant?.identity
  ) as any[];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{groupName}</Text>
        <Text style={styles.headerSubtitle}>
          {remoteList.length + 1} participantes
        </Text>
      </View>

      {callType === 'video' && localVideoTrack && (
        <DraggableView width={120} height={180}>
          <RTCView
            streamURL={(localVideoTrack.publication?.track as any)?.mediaStream?.toURL?.() || ''}
            style={{ width: 120, height: 180 }}
            objectFit="cover"
            zOrder={1}
            pointerEvents="none"
          />
        </DraggableView>
      )}

      <FlatList
        data={remoteList}
        keyExtractor={(item) => item.identity}
        renderItem={renderParticipant}
        numColumns={remoteList.length > 2 ? 2 : 1}
        contentContainerStyle={styles.grid}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="people" size={48} color="#5F6368" />
            <Text style={styles.emptyText}>Esperando participantes...</Text>
          </View>
        }
      />

      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.controlButton, muted && styles.activeButton]}
          onPress={toggleMute}
        >
          <Ionicons name={muted ? 'mic-off' : 'mic'} size={24} color="#FFFFFF" />
        </TouchableOpacity>
        {callType === 'video' && (
          <>
            <TouchableOpacity
              style={[styles.controlButton, !videoEnabled && styles.activeButton]}
              onPress={toggleVideo}
            >
              <Ionicons name={videoEnabled ? 'videocam' : 'videocam-off'} size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.controlButton}
              onPress={switchCamera}
            >
              <Ionicons name="camera-reverse-outline" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity style={[styles.controlButton, styles.endCall]} onPress={handleHangup}>
          <Ionicons name="call" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1A1A2E' },
  header: { alignItems: 'center', paddingTop: 60, paddingBottom: 16 },
  headerTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '600' },
  headerSubtitle: { color: '#9AA0A6', fontSize: 14, marginTop: 4 },
  localVideo: { width: 120, height: 180, borderRadius: 12, overflow: 'hidden' },
  grid: { flexGrow: 1, padding: 8 },
  tile: {
    flex: 1,
    margin: 4,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#2A2A4E',
    minHeight: 200,
    justifyContent: 'center',
  },
  tileEmpty: { backgroundColor: '#1E1E3E' },
  video: { flex: 1, minHeight: 200 },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center', minHeight: 200 },
  participantInfo: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  participantName: { color: '#FFFFFF', fontSize: 12, flex: 1 },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText: { color: '#9AA0A6', fontSize: 16, marginTop: 16 },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
    gap: 24,
  },
  controlButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#3A3A5E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  endCall: { backgroundColor: '#EA4335' },
  activeButton: { backgroundColor: '#EA4335' },
});

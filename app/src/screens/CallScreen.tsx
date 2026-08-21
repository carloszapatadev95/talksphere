import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, BackHandler } from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LiveKitRoom } from '@livekit/react-native';
import { RTCView } from '../services/webrtc';
import { useCall } from '../hooks/useCall';
import GroupCallContent from '../components/GroupCallContent';
import DraggableView from '../components/DraggableView';
import { setAudioModeAsync } from 'expo-audio';
import { SOCKET_URL, LIVEKIT_URL } from '../constants/config';
import Avatar from '../components/Avatar';
import { debug } from '../utils/debug';
import { Colors } from '../theme';
import { useStore } from '../store/useStore';

type RouteParams = { Call: { user?: { id: number; username: string }; callType: 'voice' | 'video'; isIncoming?: boolean; offer?: any; callerId?: number; isGroupCall?: boolean; groupId?: number; groupName?: string; roomName?: string; token?: string } };

function GroupCallView({ params }: { params: RouteParams['Call'] }) {
  const [liveKitError, setLiveKitError] = useState<string | null>(null);
  const navigation = useNavigation();

  useEffect(() => {
    useStore.getState().setCallActive(true);
    return () => useStore.getState().setCallActive(false);
  }, []);

  if (!params.token) {
    return (
      <View style={{ flex: 1, backgroundColor: '#1A1A2E', justifyContent: 'center', alignItems: 'center' }}>
        <Ionicons name="alert-circle" size={48} color="#EA4335" />
        <Text style={{ color: '#FFF', marginTop: 16, fontSize: 16 }}>No se pudo iniciar la llamada grupal</Text>
        <Text style={{ color: '#9AA0A6', marginTop: 8, fontSize: 14 }}>Token de conexión no disponible.</Text>
        <TouchableOpacity
          style={{ marginTop: 24, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: '#EA4335', borderRadius: 8 }}
          onPress={() => navigation.goBack()}
        >
          <Text style={{ color: '#FFF' }}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (liveKitError) {
    return (
      <View style={{ flex: 1, backgroundColor: '#1A1A2E', justifyContent: 'center', alignItems: 'center' }}>
        <Ionicons name="alert-circle" size={48} color="#EA4335" />
        <Text style={{ color: '#FFF', marginTop: 16, fontSize: 16 }}>Error de conexión</Text>
        <Text style={{ color: '#9AA0A6', marginTop: 8, fontSize: 14 }}>{liveKitError}</Text>
        <TouchableOpacity
          style={{ marginTop: 24, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: '#EA4335', borderRadius: 8 }}
          onPress={() => navigation.goBack()}
        >
          <Text style={{ color: '#FFF' }}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={LIVEKIT_URL}
      token={params.token || ''}
      connect={true}
      audio={true}
      video={params.callType === 'video'}
      options={{ adaptiveStream: { pixelDensity: 'screen' as any } }}
      onError={(err: any) => setLiveKitError(err?.message || 'Error al conectar con LiveKit')}
    >
      <GroupCallContent
        groupId={params.groupId || 0}
        groupName={params.groupName || ''}
        roomName={params.roomName || ''}
        callType={params.callType}
      />
    </LiveKitRoom>
  );
}

export default function CallScreen() {
  const route = useRoute<RouteProp<RouteParams, 'Call'>>();
  const navigation = useNavigation();

  if (route.params.isGroupCall) {
    return <GroupCallView params={route.params} />;
  }

  const caller = route.params.user!;
  const isVideo = route.params.callType === 'video';
  const { localStream, remoteStream, remoteAudioEnabled, remoteVideoEnabled, startCall, answerCall, endCall, switchCamera } = useCall();
  const hadStreamRef = useRef(false);
  const remoteReceivedRef = useRef(false);
  const manualHangupRef = useRef(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const SERVER_BASE = SOCKET_URL;
  const [muted, setMuted] = useState(false);
  const [noAnswer, setNoAnswer] = useState(false);

  useEffect(() => {
    debug.log('[CallScreen] useEffect isIncoming:', route.params.isIncoming, 'caller:', !!caller, 'callerId:', caller?.id, 'hasOffer:', !!route.params.offer);
    let cancelled = false;
    const init = async () => {
      try {
        if (route.params.isIncoming) {
          await answerCall(true, route.params.callType, route.params.offer, route.params.callerId);
        } else if (caller) {
          await startCall(caller.id, route.params.callType);
        }
      } catch (e) {
        console.error('[CallScreen] error starting/answering call:', e);
        if (!cancelled) navigation.goBack();
      }
    };
    init();
    (async () => {
      try {
        await setAudioModeAsync({ shouldRouteThroughEarpiece: false, allowsRecording: true, shouldPlayInBackground: true });
      } catch (e) {
        console.warn('[CallScreen] setAudioModeAsync failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggleSpeaker = () => {
    const next = !speakerOn;
    setSpeakerOn(next);
    setAudioModeAsync({ shouldRouteThroughEarpiece: !next });
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    localStream?.getAudioTracks().forEach(t => { t.enabled = !next; });
  };

  useEffect(() => {
    debug.log('[CallScreen] remoteStream changed:', !!remoteStream, 'isVideo:', isVideo);
    if (remoteStream) {
      debug.log('[CallScreen] remote tracks:', remoteStream.getTracks().length);
    }
  }, [remoteStream, isVideo]);

  useEffect(() => {
    debug.log('[CallScreen] localStream changed:', !!localStream, 'isVideo:', isVideo);
    if (localStream) {
      debug.log('[CallScreen] local tracks:', localStream.getTracks().length);
    }
  }, [localStream, isVideo]);

  useEffect(() => {
    if (remoteStream) remoteReceivedRef.current = true;
  }, [remoteStream]);

  useEffect(() => {
    if (remoteStream || localStream) {
      hadStreamRef.current = true;
    }
    if (hadStreamRef.current && !remoteStream && localStream === null) {
      if (!remoteReceivedRef.current && !manualHangupRef.current) {
        setNoAnswer(true);
        const t = setTimeout(() => navigation.goBack(), 2000);
        return () => clearTimeout(t);
      } else {
        navigation.goBack();
      }
    }
  }, [remoteStream, localStream]);

  const handleEndCall = () => {
    manualHangupRef.current = true;
    endCall();
    navigation.goBack();
  };

  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (!manualHangupRef.current && useStore.getState().isCallActive) {
        e.preventDefault();
        manualHangupRef.current = true;
        endCall();
        navigation.goBack();
      }
    });
    return unsub;
  }, [navigation, endCall]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (useStore.getState().isCallActive) {
        handleEndCall();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{caller.username}</Text>
        <Text style={styles.headerSubtitle}>
          {noAnswer ? 'No contestó' : localStream ? 'En llamada...' : 'Llamando...'}
        </Text>
      </View>

      <View style={styles.contentArea}>
        {remoteStream && (
          <RTCView
            streamURL={remoteStream.toURL()}
            style={isVideo ? styles.remoteVideo : { width: 0, height: 0, overflow: 'hidden' }}
            objectFit="cover"
            zOrder={0}
          />
        )}

        {(!isVideo || !remoteStream) && (
          <View style={styles.avatarContainer}>
            <Avatar
              uri={(caller as any).avatar_url}
              name={caller!.username}
              size={100}
              online
              baseUrl={SERVER_BASE}
            />
          </View>
        )}
      </View>

      {isVideo && localStream && (
        <DraggableView>
          <RTCView
            streamURL={localStream.toURL()}
            style={{ width: 120, height: 180 }}
            objectFit="cover"
            zOrder={1}
            pointerEvents="none"
          />
        </DraggableView>
      )}

      <View style={styles.remoteStatus}>
        {!remoteAudioEnabled && (
          <View style={styles.remoteStatusRow}>
            <Ionicons name="mic-off" size={16} color="#FFD700" />
            <Text style={styles.remoteStatusText}> Audio desactivado</Text>
          </View>
        )}
        {isVideo && !remoteVideoEnabled && (
          <View style={styles.remoteStatusRow}>
            <Ionicons name="videocam-off" size={16} color="#FFD700" />
            <Text style={styles.remoteStatusText}> Video desactivado</Text>
          </View>
        )}
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.controlButton, muted && styles.activeButton]}
          onPress={toggleMute}
        >
          <Ionicons name={muted ? 'mic-off' : 'mic'} size={24} color="#FFFFFF" />
        </TouchableOpacity>
        {isVideo && (
          <TouchableOpacity style={styles.controlButton} onPress={switchCamera}>
            <Ionicons name="camera-reverse-outline" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.controlButton, speakerOn && styles.speakerOn]}
          onPress={toggleSpeaker}
        >
          <Ionicons name={speakerOn ? 'volume-high' : 'volume-medium'} size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.controlButton, styles.endCall]} onPress={handleEndCall}>
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
  remoteVideo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  contentArea: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  avatarContainer: { justifyContent: 'center', alignItems: 'center' },
  remoteStatus: { alignItems: 'center', paddingVertical: 8 },
  remoteStatusRow: { flexDirection: 'row', alignItems: 'center' },
  remoteStatusText: { color: '#FFD700', fontSize: 14, fontWeight: '500' },
  controls: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    paddingVertical: 24, paddingBottom: 48, gap: 24,
  },
  controlButton: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#3A3A5E', justifyContent: 'center', alignItems: 'center' },
  endCall: { backgroundColor: '#EA4335' },
  speakerOn: { backgroundColor: Colors.primary },
  activeButton: { backgroundColor: '#EA4335' },
});

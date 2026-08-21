import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useStore } from '../store/useStore';
import { getSocket } from '../services/socket';
import { SOCKET_URL } from '../constants/config';
import Avatar from './Avatar';
import { debug } from '../utils/debug';
import { useGroupCall } from '../hooks/useGroupCall';

function startRingtone(): () => void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return () => {};
  const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return () => {};
  const ctx = new AudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 440;
  gain.gain.value = 0.15;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  let stopped = false;
  const pulse = () => {
    if (stopped) return;
    gain.gain.value = gain.gain.value > 0.12 ? 0.04 : 0.12;
    setTimeout(pulse, 600);
  };
  pulse();
  return () => {
    stopped = true;
    try { osc.stop(); } catch {}
    try { ctx.close(); } catch {}
  };
}

type RootStackParamList = {
  Call: { user?: { id: number; username: string }; callType: 'voice' | 'video'; isIncoming?: boolean; offer?: any; callerId?: number; isGroupCall?: boolean; groupId?: number; groupName?: string; roomName?: string; token?: string };
  [key: string]: any;
};

export default function IncomingCallModal() {
  const { incomingCall, incomingGroupCall, setIncomingCall, setIncomingGroupCall, isCallActive } = useStore();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { fetchToken, loading: tokenLoading } = useGroupCall();
  const [acceptingGroupCall, setAcceptingGroupCall] = useState(false);

  const ringtoneRef = useRef<() => void>(null);

  useEffect(() => {
    if ((!incomingCall && !incomingGroupCall) || isCallActive) return;
    ringtoneRef.current = startRingtone();
    return () => ringtoneRef.current?.();
  }, [incomingCall, incomingGroupCall, isCallActive]);

  if (incomingGroupCall && !isCallActive) {
    const handleAccept = async () => {
      setAcceptingGroupCall(true);
      const token = await fetchToken(incomingGroupCall.roomName);
      if (!token) {
        setAcceptingGroupCall(false);
        return;
      }
      setIncomingGroupCall(null);
      setAcceptingGroupCall(false);
      navigation.navigate('Call', {
        isGroupCall: true,
        groupId: incomingGroupCall.groupId,
        groupName: incomingGroupCall.groupName,
        roomName: incomingGroupCall.roomName,
        token,
        callType: incomingGroupCall.callType,
      });
    };

    const handleReject = () => {
      getSocket()?.emit('group_call_declined', { groupId: incomingGroupCall.groupId });
      setIncomingGroupCall(null);
    };

    const groupName = incomingGroupCall.groupName;
    const callTypeLabel = incomingGroupCall.callType === 'video' ? 'videollamada' : 'llamada de voz';

    return (
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Avatar name={groupName} size={80} />
          <Text style={styles.name}>{groupName}</Text>
          <Text style={styles.type}>{callTypeLabel} grupal</Text>
          <Text style={styles.startedBy}>Iniciada por {incomingGroupCall.startedByName}</Text>

          <View style={styles.buttons}>
            <TouchableOpacity style={[styles.button, styles.reject]} onPress={handleReject} disabled={acceptingGroupCall}>
              <Text style={styles.buttonText}>Rechazar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.accept]} onPress={handleAccept} disabled={acceptingGroupCall}>
              {acceptingGroupCall ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={styles.buttonText}>Aceptar</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  if (!incomingCall || isCallActive) return null;

  const callerName = incomingCall.callerUsername || `Usuario #${incomingCall.callerId}`;
  const callTypeLabel = incomingCall.callType === 'video' ? 'videollamada' : 'llamada de voz';
  const SERVER_BASE = SOCKET_URL;

  const handleReject = () => {
    getSocket()?.emit('end_call', { targetId: incomingCall.callerId });
    setIncomingCall(null);
  };

  const handleAccept = () => {
    const data = { ...incomingCall };
    debug.log('[Modal] handleAccept callerId:', data.callerId, 'type:', data.callType, 'hasOffer:', !!data.offer);
    setIncomingCall(null);
    navigation.navigate('Call', {
      user: { id: data.callerId, username: callerName },
      callType: data.callType,
      isIncoming: true,
      offer: data.offer,
      callerId: data.callerId,
    });
  };

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <Avatar
          uri={(incomingCall as any).callerAvatarUrl}
          name={callerName}
          size={80}
          baseUrl={SERVER_BASE}
        />
        <Text style={styles.name}>{callerName}</Text>
        <Text style={styles.type}>{callTypeLabel} entrante</Text>

        <View style={styles.buttons}>
          <TouchableOpacity style={[styles.button, styles.reject]} onPress={handleReject}>
            <Text style={styles.buttonText}>Rechazar</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.accept]} onPress={handleAccept}>
            <Text style={styles.buttonText}>Aceptar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center', zIndex: 999,
  },
  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 32, alignItems: 'center', width: '80%', overflow: 'hidden' },
  name: { fontSize: 22, fontWeight: '600', color: '#202124' },
  type: { fontSize: 16, color: '#5F6368', marginTop: 8 },
  startedBy: { fontSize: 13, color: '#9AA0A6', marginTop: 4, marginBottom: 24 },
  buttons: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  button: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 },
  reject: { backgroundColor: '#EA4335' },
  accept: { backgroundColor: '#34A853' },
  buttonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
});

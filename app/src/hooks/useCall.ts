import { useEffect, useCallback, useRef, useState } from 'react';
import { Platform, PermissionsAndroid, Alert, Linking } from 'react-native';
import { getSocket } from '../services/socket';
import { useStore } from '../store/useStore';
import { setCallPeer, flushPendingCandidates } from '../services/callGlobals';
import { debug } from '../utils/debug';
import {
  mediaDevices,
  MediaStream,
  RTCView,
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
} from '../services/webrtc';
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

export function useCall() {
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const endedRef = useRef(false);
  const currentPeerIdRef = useRef<number | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteAudioEnabled, setRemoteAudioEnabled] = useState(true);
  const [remoteVideoEnabled, setRemoteVideoEnabled] = useState(true);
  const { user, incomingCall, setIncomingCall, setCallActive, setCallType, setCallPartner } =
    useStore();

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    socket.on('call_ended', () => {
      debug.log('[useCall] call_ended received');
      endCall(true);
    });

    socket.on('audio_toggled', ({ enabled }: { enabled: boolean }) => {
      setRemoteAudioEnabled(enabled);
    });

    socket.on('video_toggled', ({ enabled }: { enabled: boolean }) => {
      setRemoteVideoEnabled(enabled);
    });

    return () => {
      socket.off('call_ended');
      socket.off('audio_toggled');
      socket.off('video_toggled');
    };
  }, []);

  const requestPermissions = useCallback(async () => {
    if (Platform.OS === 'android') {
      try {
        let grants = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.CAMERA,
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        ]);
        debug.log('[useCall] perm grants:', JSON.stringify(grants));
        if (
          grants['android.permission.RECORD_AUDIO'] === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ||
          grants['android.permission.CAMERA'] === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
        ) {
          Alert.alert(
            'Permiso requerido',
            'El permiso de micrófono está bloqueado. Debes activarlo manualmente en Ajustes.',
            [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Abrir Ajustes', onPress: () => Linking.openSettings() },
            ]
          );
          return false;
        }
        return (
          grants['android.permission.CAMERA'] === PermissionsAndroid.RESULTS.GRANTED &&
          grants['android.permission.RECORD_AUDIO'] === PermissionsAndroid.RESULTS.GRANTED
        );
      } catch (e) {
        console.error('[useCall] perm error:', e);
        return false;
      }
    }
    return true;
  }, []);

  const startLocalStream = useCallback(async (isVideo: boolean): Promise<MediaStream | null> => {
    if (localStreamRef.current) {
      debug.log('[useCall] reusing existing local stream');
      return localStreamRef.current;
    }
    try {
      const stream = await mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: isVideo
          ? {
              facingMode: 'user',
              width: { ideal: 640 },
              height: { ideal: 480 },
            }
          : false,
      });
      const tracks = stream.getTracks();
      tracks.forEach(t => debug.log('[useCall] local track:', t.kind, 'enabled:', t.enabled, 'readyState:', t.readyState));
      debug.log('[useCall] local stream tracks:', tracks.length, 'active:', tracks.some(t => t.readyState === 'live'));
      localStreamRef.current = stream;
      setLocalStream(stream);
      return stream;
    } catch (err) {
      console.error('[useCall] Error accessing media devices:', err);
      return null;
    }
  }, []);

  const remoteStreamRef = useRef<MediaStream | null>(null);

  const createPeerConnection = useCallback(
    (targetId: number) => {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerRef.current = pc;
      setCallPeer(pc);

      (pc as any).onicecandidate = (event: any) => {
        if (event.candidate) {
          debug.log('[useCall] ICE candidate:', event.candidate.candidate);
          getSocket()?.emit('ice_candidate', { targetId, candidate: event.candidate });
        }
      };

      (pc as any).oniceconnectionstatechange = () => {
        debug.log('[useCall] ICE state:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed') {
          debug.log('[useCall] ICE failed, ending call');
          endCall();
        }
      };

      (pc as any).ontrack = (event: any) => {
        const stream = event.streams[0];
        if (!stream) {
          console.warn('[useCall] ontrack with no stream!');
          return;
        }
        if (remoteStreamRef.current === stream) return;
        const existingIds = new Set(
          (remoteStreamRef.current?.getTracks() || []).map(t => (t as any).id)
        );
        const hasNew = stream.getTracks().some(t => !existingIds.has((t as any).id));
        if (!hasNew && remoteStreamRef.current) return;
        stream.getTracks().forEach(t => {
          debug.log('[useCall] remote track:', t.kind, 'enabled:', t.enabled, 'readyState:', t.readyState);
          if (t.kind === 'audio') {
            try { (t as any)._setVolume(10); } catch (_e) {}
          }
        });
        debug.log('[useCall] ontrack total:', stream.getTracks().length);
        remoteStreamRef.current = stream;
        setRemoteStream(stream);
      };

      if (localStreamRef.current) {
        const tracks = localStreamRef.current.getTracks();
        debug.log('[useCall] adding', tracks.length, 'local tracks to PC');
        tracks.forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
          debug.log('[useCall] addTrack:', track.kind, 'id:', (track as any).id);
        });
      }

      return pc;
    },
    []
  );

  const startCall = useCallback(
    async (targetId: number, callType: 'voice' | 'video') => {
      endedRef.current = false;
      const hasPerms = await requestPermissions();
      if (!hasPerms) return;
      const stream = await startLocalStream(callType === 'video');
      if (!stream) return;

      const pc = createPeerConnection(targetId);

      (pc as any).oniceconnectionstatechange = () => {
        debug.log('[useCall] ICE state:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed') {
          debug.log('[useCall] ICE failed, ending call');
          endCall();
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      debug.log('[useCall] offer SDP media:', (offer.sdp || '').match(/m=(\w+)/g));
      debug.log('[useCall] localStream has', (localStreamRef.current?.getTracks().length || 0), 'tracks for call');

      currentPeerIdRef.current = targetId;
      setCallActive(true);
      setCallType(callType);

      getSocket()?.emit('call_user', { targetId, offer, callType });
    },
    [requestPermissions, startLocalStream, createPeerConnection]
  );

  const answerCall = useCallback(
    async (accept: boolean, overrideType?: 'voice' | 'video', overrideOffer?: any, overrideCallerId?: number) => {
      const callType = overrideType || incomingCall?.callType;
      const callOffer = overrideOffer || (incomingCall as any)?.offer;
      const callerId = overrideCallerId || incomingCall?.callerId || 0;
      debug.log('[useCall] answerCall called accept:', accept, 'callerId:', callerId, 'hasOffer:', !!callOffer, 'overrideType:', !!overrideType);
      endedRef.current = false;
      if (!callerId || !callOffer) {
        debug.log('[useCall] answerCall missing data, callerId:', callerId, 'offer:', !!callOffer);
        return;
      }

      if (accept) {
        const hasPerms = await requestPermissions();
        if (!hasPerms) return;
        debug.log('[useCall] answerCall starting local stream...');
        const stream = await startLocalStream(callType === 'video');
        debug.log('[useCall] startLocalStream result:', !!stream);
        if (!stream) return;

        const pc = createPeerConnection(callerId);

        (pc as any).oniceconnectionstatechange = () => {
          debug.log('[useCall] ICE state:', pc.iceConnectionState);
          if (pc.iceConnectionState === 'failed') {
            debug.log('[useCall] ICE failed, ending call');
            endCall(true);
          }
        };

        const offer = callOffer;
        if (!offer) return;
        debug.log('[useCall] remote offer SDP media:', (offer.sdp || '').match(/m=(\w+)/g));
        debug.log('[useCall] localStream has', (localStreamRef.current?.getTracks().length || 0), 'tracks before answer');

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        flushPendingCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        debug.log('[useCall] answer SDP media:', (answer.sdp || '').match(/m=(\w+)/g));

        currentPeerIdRef.current = callerId;
        setCallActive(true);
        setCallType(callType);

        getSocket()?.emit('answer_call', { targetId: callerId, answer });
      } else {
        getSocket()?.emit('end_call', { targetId: callerId });
      }

      if (incomingCall) setIncomingCall(null);
    },
    [incomingCall, requestPermissions, startLocalStream, createPeerConnection]
  );

  const facingModeRef = useRef<'user' | 'environment'>('user');

  const switchCamera = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const oldVideoTrack = stream.getVideoTracks()[0];
    if (!oldVideoTrack) return;
    const nextFacing = facingModeRef.current === 'user' ? 'environment' : 'user';
    try {
      const newVideoStream = await mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: nextFacing,
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });
      const newVideoTrack = newVideoStream.getVideoTracks()[0];
      if (!newVideoTrack) {
        newVideoStream.getTracks().forEach((t) => t.stop());
        return;
      }

      const pc = peerRef.current;
      const sender = pc?.getSenders().find((s: any) => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newVideoTrack);
      }

      stream.removeTrack(oldVideoTrack);
      try { oldVideoTrack.stop(); } catch {}
      stream.addTrack(newVideoTrack);
      facingModeRef.current = nextFacing;
      setLocalStream(stream);
      debug.log('[useCall] camera switched to', nextFacing);
    } catch (err) {
      console.error('[useCall] switchCamera error:', err);
    }
  }, []);

  const endCall = useCallback((fromRemote = false) => {
    if (endedRef.current) return;
    endedRef.current = true;
    debug.log('[useCall] endCall called');

    if (currentPeerIdRef.current) {
      if (!fromRemote) {
        getSocket()?.emit('end_call', { targetId: currentPeerIdRef.current });
      }
      currentPeerIdRef.current = null;
    }

    if (remoteStreamRef.current) {
      const rt = remoteStreamRef.current.getTracks();
      debug.log('[useCall] remote stream at end had', rt.length, 'tracks:', rt.map(t => t.kind + '=' + t.readyState).join(','));
    }
    if (localStreamRef.current) {
      const lt = localStreamRef.current.getTracks();
      debug.log('[useCall] local stream at end had', lt.length, 'tracks:', lt.map(t => t.kind + '=' + t.readyState).join(','));
    }
    peerRef.current?.close();
    peerRef.current = null;
    setCallPeer(null);

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    setLocalStream(null);
    setRemoteStream(null);
    setCallActive(false);
    setCallType(null);
    setCallPartner(null);
    setIncomingCall(null);
  }, []);

  return {
    localStream,
    remoteStream,
    remoteAudioEnabled,
    remoteVideoEnabled,
    startCall,
    answerCall,
    endCall,
    switchCamera,
  };
}


import { useState, useCallback } from 'react';
import api from '../services/api';
import { useStore } from '../store/useStore';
import { LIVEKIT_URL } from '../constants/config';
import { debug } from '../utils/debug';

export function useGroupCall() {
  const [token, setToken] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchToken = useCallback(async (room: string) => {
    setLoading(true);
    try {
      const { data } = await api.post('/livekit/token', { room });
      setToken(data.token);
      setRoomName(data.room);
      debug.log('[useGroupCall] token obtained for room:', data.room);
      return data.token;
    } catch (err) {
      console.error('[useGroupCall] error fetching token:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setToken(null);
    setRoomName(null);
  }, []);

  return {
    token,
    roomName,
    loading,
    livekitUrl: LIVEKIT_URL,
    fetchToken,
    reset,
  };
}

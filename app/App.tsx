import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StyleSheet, ActivityIndicator, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { registerGlobals } from '@livekit/react-native';
import AppNavigator from './src/navigators/AppNavigator';
import { connectSocket } from './src/services/socket';
import { useStore } from './src/store/useStore';
import { API_URL } from './src/constants/config';
import { getToken, deleteToken } from './src/services/persist';
import APP_CONFIG from './src/config/appConfig';

registerGlobals();

const errorUtils = (globalThis as any).ErrorUtils as
  | { getGlobalHandler?: () => (error: any, isFatal?: boolean) => void; setGlobalHandler?: (h: (error: any, isFatal?: boolean) => void) => void }
  | undefined;
if (errorUtils && errorUtils.getGlobalHandler && errorUtils.setGlobalHandler) {
  const originalHandler = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
    const msg = error?.message || String(error);
    if (!isFatal && /NegotiationError|PC manager is closed|RNWebRTC/.test(msg)) {
      return;
    }
    originalHandler(error, isFatal);
  });
}

SplashScreen.preventAutoHideAsync();

export default function App() {
  const { token, setToken, logout } = useStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const storedToken = await getToken();
        if (storedToken) {
          const res = await fetch(API_URL + '/auth/me', { headers: { Authorization: 'Bearer ' + storedToken } });
          if (res.ok) {
            const body = await res.json();
            setToken(storedToken);
            useStore.getState().setUser(body.user);
          } else {
            await deleteToken();
          }
        }
      } catch {}
      setLoading(false);
      SplashScreen.hideAsync();
    })();
  }, []);

  useEffect(() => {
    (globalThis as any).__onUnauthorized = () => {
      logout();
    };
  }, []);

  useEffect(() => {
    if (token) {
      (globalThis as any).__token = token;
      const socket = connectSocket(token);
      (globalThis as any).__socket = socket;
    }
  }, [token]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: APP_CONFIG.appColor }}>
        <ActivityIndicator size="large" color="#FFFFFF" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.container}>
        <StatusBar style="light" />
        <AppNavigator />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});

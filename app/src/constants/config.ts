import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { debug } from '../utils/debug';

const extra = Constants.expoConfig?.extra ?? {};

// Intentar obtener el host real del servidor de desarrollo
// 1. Constants (valor horneado en el build)
// 2. hostUri del manifest de Metro (solo development build)
// 3. scriptURL (dónde está cargando el bundle, ej: 192.168.200.19:8081)
function detectDevHost(): string {
  try {
    const manifestHost = (Constants.expoConfig as any)?.hostUri;
    if (manifestHost) return manifestHost.split(':')[0];

    if (Platform.OS !== 'web' && globalThis?.__DEV__) {
      const sourceCode = (globalThis as any).nativeModuleProxy?.SourceCode;
      const scriptURL = sourceCode?.scriptURL || (globalThis as any).__sourceCode?.scriptURL;
      if (scriptURL) {
        const match = scriptURL.match(/https?:\/\/([^:/]+)/);
        if (match) return match[1];
      }
    }
  } catch {}
  return '';
}

const devHost = detectDevHost();

function pickUrl(embedded: string | undefined, port: string, path: string): string {
  if (embedded && !embedded.includes('localhost') && !embedded.includes('127.0.0.1')) {
    return embedded;
  }
  if (devHost) {
    return `http://${devHost}:${port}${path}`;
  }
  return `http://localhost:${port}${path}`;
}

export const API_URL = pickUrl(extra?.apiUrl, '3000', '/api');
export const SOCKET_URL = pickUrl(extra?.socketUrl, '3000', '');

export const LIVEKIT_URL = extra?.livekitUrl || 'wss://communicator-app-tz0htm2b.livekit.cloud';

debug.log('[Config] API_URL:', API_URL, 'SOCKET_URL:', SOCKET_URL, 'LIVEKIT_URL:', LIVEKIT_URL, 'devHost:', devHost);

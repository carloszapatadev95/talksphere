const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return {};

  const content = fs.readFileSync(envPath, 'utf8');
  const vars = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }

  return vars;
}

const env = loadEnv();

// Branding: update appConfig.ts for colors/name, app.config.js for native manifest
const APP_NAME = env.APP_NAME || 'TalkSphere';
const IS_PRODUCTION = process.env.EAS_BUILD_PROFILE === 'production';

export default {
  expo: {
    name: APP_NAME,
    slug: 'communicator-app',
    version: '1.2.8',
    orientation: 'portrait',
    scheme: 'communicator',
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.chatcallpro.app',
      infoPlist: {
        NSCameraUsageDescription: APP_NAME + ' necesita acceso a la cámara para videollamadas',
        NSMicrophoneUsageDescription: APP_NAME + ' necesita acceso al micrófono para llamadas de voz y video',
        UIBackgroundModes: ['remote-notification'],
      },
    },
    android: {
      package: 'com.chatcallpro.app',
      versionCode: 16,
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON || './android/app/google-services.json',
      permissions: [
        'android.permission.CAMERA',
        'android.permission.RECORD_AUDIO',
        'android.permission.MODIFY_AUDIO_SETTINGS',
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.READ_CONTACTS',
      ],
    },
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#1A73E8',
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      ...(IS_PRODUCTION ? [] : ['expo-dev-client']),
      [
        'expo-camera',
        {
          cameraPermission: APP_NAME + ' necesita acceso a la cámara para videollamadas',
          microphonePermission: APP_NAME + ' necesita acceso al micrófono para llamadas',
        },
      ],
      'expo-audio',
      [
        'expo-contacts',
        {
          permissions: [APP_NAME + ' necesita acceso a tus contactos para invitar personas al workspace'],
        },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/notification-icon.png',
          color: '#1A73E8',
        },
      ],
      [
        'expo-build-properties',
        {
          android: {
            usesCleartextTraffic: true,
          },
        },
      ],
      '@livekit/react-native-expo-plugin',
      '@config-plugins/react-native-webrtc',
    ],
    extra: {
      apiUrl: env.API_URL || process.env.API_URL || 'http://localhost:3000/api',
      socketUrl: env.SOCKET_URL || process.env.SOCKET_URL || 'http://localhost:3000',
      livekitUrl: env.LIVEKIT_URL || process.env.LIVEKIT_URL || 'wss://communicator-app-tz0htm2b.livekit.cloud',
      eas: {
        projectId: env.EXPO_PROJECT_ID || process.env.EXPO_PROJECT_ID || 'YOUR_EXPO_PROJECT_ID',
      },
    },
  },
};

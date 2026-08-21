jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
  AudioMode: {},
}));

jest.mock('expo-camera', () => ({
  Camera: { requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }) },
  CameraType: { front: 'front', back: 'back' },
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: 'StatusBar',
  setStatusBarStyle: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => {
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  return {
    SafeAreaProvider: ({ children }: any) => children,
    SafeAreaView: ({ children }: any) => children,
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: { insets, frame },
  };
});

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: jest.fn(),
  NavigationContainer: ({ children }: any) => children,
}));

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }: any) => children,
    Screen: ({ children }: any) => children,
    Group: ({ children }: any) => children,
  }),
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => ({
    Navigator: ({ children }: any) => children,
    Screen: ({ children }: any) => children,
  }),
}));

jest.mock('socket.io-client', () => {
  const mockSocket = {
    on: jest.fn().mockReturnThis(),
    off: jest.fn().mockReturnThis(),
    emit: jest.fn().mockReturnThis(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    connected: true,
    once: jest.fn(),
  };
  return {
    io: jest.fn(() => mockSocket),
    connect: jest.fn(() => mockSocket),
  };
});

jest.mock('expo-font', () => ({
  loadAsync: jest.fn().mockResolvedValue(undefined),
  isLoaded: jest.fn().mockReturnValue(true),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
  MaterialIcons: () => null,
  MaterialCommunityIcons: () => null,
  FontAwesome: () => null,
  AntDesign: () => null,
}));

jest.mock('@livekit/react-native-webrtc', () => ({
  RTCPeerConnection: jest.fn().mockImplementation(() => ({
    createOffer: jest.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-sdp' }),
    createAnswer: jest.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-sdp' }),
    setLocalDescription: jest.fn().mockResolvedValue(undefined),
    setRemoteDescription: jest.fn().mockResolvedValue(undefined),
    addTrack: jest.fn(),
    close: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    iceConnectionState: 'new',
    connectionState: 'new',
  })),
  RTCView: 'RTCView',
  MediaStream: jest.fn().mockImplementation(() => ({
    getTracks: jest.fn().mockReturnValue([]),
    getAudioTracks: jest.fn().mockReturnValue([]),
    getVideoTracks: jest.fn().mockReturnValue([]),
    toURL: jest.fn().mockReturnValue('stream-url'),
    addTrack: jest.fn(),
    removeTrack: jest.fn(),
  })),
  mediaDevices: {
    getUserMedia: jest.fn().mockResolvedValue({
      getTracks: jest.fn().mockReturnValue([]),
      getAudioTracks: jest.fn().mockReturnValue([]),
      getVideoTracks: jest.fn().mockReturnValue([]),
      toURL: jest.fn().mockReturnValue('stream-url'),
    }),
  },
  RTCSessionDescription: jest.fn(),
  RTCIceCandidate: jest.fn(),
}));

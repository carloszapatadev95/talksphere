import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../store/useStore';
import api from '../services/api';
import { getSocket, connectSocket, disconnectSocket, attachSharedListeners } from '../services/socket';
import { registerForPushNotifications, setupNotificationHandler, setupNotificationCategories } from '../services/notifications';
import { Colors } from '../theme';
import { debug } from '../utils/debug';
import LoginScreen from '../screens/LoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
import ContactsScreen from '../screens/ContactsScreen';
import ChatListScreen from '../screens/ChatListScreen';
import ChatScreen from '../screens/ChatScreen';
import GroupsScreen from '../screens/GroupsScreen';
import GroupChatScreen from '../screens/GroupChatScreen';
import GroupInfoScreen from '../screens/GroupInfoScreen';
import CallScreen from '../screens/CallScreen';
import AdminScreen from '../screens/AdminScreen';
import InviteScreen from '../screens/InviteScreen';
import IncomingCallModal from '../components/IncomingCallModal';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

import { useSafeAreaInsets } from 'react-native-safe-area-context';

function MainTabs() {
  const insets = useSafeAreaInsets();
  const { user, tenantName, setTenantName, workspaceName, setWorkspaceName, activeWorkspaceId } = useStore();

  // Fetch workspace name al cambiar de workspace activo
  const scopeId = activeWorkspaceId ?? user?.active_workspace_id ?? user?.tenant_id;
  useEffect(() => {
    if (!scopeId) {
      return;
    }
    api.get(`/tenants/me`).then(({ data }) => {
      const ws = data?.workspace || data;
      if (ws && ws.name) {
        setWorkspaceName(ws.name);
        setTenantName(ws.name);
      }
    }).catch(() => {
      const label = `Workspace #${scopeId}`;
      setWorkspaceName(label);
      setTenantName(`Tenant #${scopeId}`);
    });
  }, [scopeId, setTenantName, setWorkspaceName]);
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textTertiary,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          paddingBottom: insets.bottom || 4,
          height: (insets.bottom || 0) + 56,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        headerStyle: { backgroundColor: Colors.primary },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          title: 'Inicio',
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Chats"
        component={ChatListScreen}
        options={{
          title: 'Chats',
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Contacts"
        component={ContactsScreen}
        options={{
          title: 'Contactos',
          tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Groups"
        component={GroupsScreen}
        options={{
          title: 'Grupos',
          tabBarIcon: ({ color, size }) => <Ionicons name="folder" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Admin"
        component={AdminScreen}
        options={{
          title: 'Admin',
          tabBarIcon: ({ color, size }) => <Ionicons name="shield-checkmark" size={size} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { token, isCallActive, incomingCall, incomingGroupCall, setIncomingCall, setIncomingGroupCall, setCallActive, setCallType, setCallPartner } = useStore();
  const navigationRef = useRef<any>(null);

  useEffect(() => {
    if (!token) { disconnectSocket(); return; }

    debug.log('[Debug] AppNavigator init');

    (async () => {
      await setupNotificationCategories();
      const pushToken = await registerForPushNotifications();
      if (pushToken) {
        debug.log('[Push] Token:', pushToken.substring(0, 30) + '...');
      }
    })();

    let socket = getSocket();
    if (!socket || !socket.connected) {
      socket = connectSocket(token);
    }
    if (!socket) return;

    attachSharedListeners();

    const navigateToCallWithOffer = (callData: any) => {
      if (callData?.offer) {
        navigationRef.current?.navigate('Call', {
          user: { id: callData.callerId, username: callData.callerUsername },
          callType: callData.callType,
          isIncoming: true,
          callerId: callData.callerId,
          offer: callData.offer,
          callerUsername: callData.callerUsername,
        });
        return;
      }

      // La app arrancó desde el push (2º plano/cerrada): el offer no viaja en el push,
      // se recupera del endpoint de llamada pendiente del servidor.
      debug.log('[AppNavigator] Sin offer en push, recuperando llamada pendiente...');
      api.get('/calls/pending')
        .then(({ data }) => {
          if (data?.hasPending) {
            debug.log('[AppNavigator] Llamada pendiente recuperada:', { callerId: data.callerId, callType: data.callType });
            navigationRef.current?.navigate('Call', {
              user: { id: data.callerId, username: data.callerUsername },
              callType: data.callType,
              isIncoming: true,
              callerId: data.callerId,
              offer: data.offer,
              callerUsername: data.callerUsername,
            });
          } else {
            debug.log('[AppNavigator] Sin llamada pendiente (puede haber expirado)');
            Alert.alert('Llamada terminada', 'La llamada ya no está activa.');
          }
        })
        .catch((err: any) => {
          console.error('[AppNavigator] Error al recuperar llamada pendiente:', err?.message || err);
          Alert.alert('Error', 'No se pudo conectar la llamada.');
        });
    };

    const navigateToGroupCall = async (callData: any) => {
      const roomName = callData.roomName;
      if (!roomName) {
        console.error('[AppNavigator] Llamada grupal sin roomName en push');
        return;
      }
      try {
        const { data } = await api.post('/livekit/token', { room: roomName });
        navigationRef.current?.navigate('Call', {
          isGroupCall: true,
          groupId: callData.groupId,
          groupName: callData.groupName,
          roomName,
          token: data.token,
          callType: callData.callType,
        });
      } catch (err) {
        console.error('[AppNavigator] Error al obtener token LiveKit:', err);
        Alert.alert('Error', 'No se pudo unir a la llamada grupal.');
      }
    };

    const notificationSub = setupNotificationHandler(
      (userId) => navigationRef.current?.navigate('Chat', { user: { id: userId } }),
      (callData) => {
        if (callData?.groupId) {
          navigateToGroupCall(callData);
        } else {
          navigateToCallWithOffer(callData);
        }
      },
      (groupId) => {
        const group = useStore.getState().groups.find((g) => g.id === groupId);
        if (group) {
          navigationRef.current?.navigate('GroupChat', { group: { id: group.id, name: group.name } });
        } else {
          api.get(`/groups/${groupId}`)
            .then(({ data }) => navigationRef.current?.navigate('GroupChat', { group: { id: data.group.id, name: data.group.name } }))
            .catch(() => navigationRef.current?.navigate('GroupChat', { group: { id: groupId, name: 'Grupo' } }));
        }
      },
      (callData) => {
        debug.log('[AppNavigator] Rechazo desde notificación:', callData);
        const socket = getSocket();
        if (socket?.connected && callData?.groupId) {
          socket.emit('group_call_declined', { groupId: callData.groupId });
        } else if (socket?.connected && callData?.callerId) {
          socket.emit('end_call', { targetId: callData.callerId });
        }
      },
    );

    return () => {
      notificationSub?.remove();
    };
  }, [token]);

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: Colors.primary },
          headerTintColor: '#FFFFFF',
        }}
      >
        {token ? (
          <>
            <Stack.Screen name="Home" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="GroupChat" component={GroupChatScreen} />
            <Stack.Screen name="GroupInfo" component={GroupInfoScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Call" component={CallScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Invite" component={InviteScreen} options={{ title: 'Invitar al workspace' }} />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        )}
      </Stack.Navigator>
      {(incomingCall || incomingGroupCall) && <IncomingCallModal />}
    </NavigationContainer>
  );
}

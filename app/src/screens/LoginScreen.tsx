import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, ScrollView, Platform } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import api from '../services/api';
import { connectSocket } from '../services/socket';
import { useStore } from '../store/useStore';
import { AuthResponse } from '../types';
import { Colors } from '../theme';
import APP_CONFIG from '../config/appConfig';
import { saveToken, saveEmail, getEmail, deleteToken } from '../services/persist';
type Props = { navigation: NativeStackNavigationProp<any> };

export default function LoginScreen({ navigation }: Props) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [usernameHint, setUsernameHint] = useState(false);
  const { setToken, setUser } = useStore();

  const handleUsernameChange = (text: string) => {
    if (/[^a-zA-Z0-9_]/.test(text)) {
      setUsernameHint(true);
    }
    setUsername(text.replace(/[^a-zA-Z0-9_]/g, ''));
  };

  useEffect(() => {
    getEmail().then((stored) => {
      if (stored) {
        setEmail(stored);
        setRememberMe(true);
      }
    });
  }, []);

  const handleSubmit = async () => {
    if (!email || !password || (!isLogin && !username)) {
      Alert.alert('Error', 'Completa todos los campos');
      return;
    }
    if (!isLogin && !/^[a-zA-Z0-9_]+$/.test(username)) {
      Alert.alert('Error', 'El usuario solo puede contener letras, números y guión bajo');
      return;
    }
    if (!isLogin && username.length < 3) {
      Alert.alert('Error', 'El usuario debe tener al menos 3 caracteres');
      return;
    }
    if (!isLogin && username.length > 50) {
      Alert.alert('Error', 'El usuario debe tener como máximo 50 caracteres');
      return;
    }
    if (!isLogin && password.length < 6) {
      Alert.alert('Error', 'La contraseña debe tener al menos 6 caracteres');
      return;
    }
    const invited = !isLogin && invitationCode.trim().length > 0;

    setLoading(true);
    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/register';
      const payload = isLogin
        ? { email, password }
        : { username, email, password, ...(invited ? { invitationCode: invitationCode.trim() } : {}) };
      const { data } = await api.post<AuthResponse>(endpoint, payload);

      if (rememberMe) {
        await saveEmail(email);
      }
      await saveToken(data.token);

      (globalThis as any).__token = data.token;
      setToken(data.token);
      setUser(data.user);

      connectSocket(data.token);

      if (!isLogin) {
        // Mostrar mensaje de bienvenida diferenciado (workspace propio vs invitado)
        api.get('/tenants/me').then(({ data: wsData }) => {
          const ws = wsData?.workspace || wsData;
          const wsName = ws?.name || `#${data.user.active_workspace_id ?? data.user.tenant_id}`;
          Alert.alert(
            '¡Bienvenido/a!',
            invited
              ? `Te has unido a "${wsName}".`
              : `Se creó tu workspace "${wsName}". Invita a otros con un código.`
          );
        }).catch(() => {
          Alert.alert(
            '¡Bienvenido/a!',
            invited
              ? 'Te has unido a un workspace.'
              : 'Se creó tu workspace personal.'
          );
        });
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Error de conexión';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding" keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{APP_CONFIG.appName}</Text>
        <Text style={styles.subtitle}>{isLogin ? 'Iniciar sesión' : 'Crear cuenta'}</Text>

        {!isLogin && (
          <TextInput
            style={[styles.input, usernameHint && styles.inputError]}
            placeholder="Nombre de usuario"
            placeholderTextColor="#9AA0A6"
            value={username}
            onChangeText={handleUsernameChange}
            autoCapitalize="none"
            autoCorrect={false}
          />
        )}
        {usernameHint && (
          <Text style={styles.errorText}>
            Solo letras, números y guión bajo (sin espacios ni acentos)
          </Text>
        )}

        {!isLogin && (
          <View style={styles.inviteContainer}>
            <TextInput
              style={[styles.input, styles.inviteInput]}
              placeholder="Código de invitación (opcional)"
              placeholderTextColor="#9AA0A6"
              value={invitationCode}
              onChangeText={setInvitationCode}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <Ionicons
              name="key"
              size={18}
              color={Colors.primary}
              style={styles.inviteIcon}
            />
          </View>
        )}

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#9AA0A6"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <View style={styles.passwordContainer}>
          <TextInput
            style={styles.passwordInput}
            placeholder="Contraseña"
            placeholderTextColor="#9AA0A6"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
          />
          <TouchableOpacity style={styles.eyeButton} onPress={() => setShowPassword(!showPassword)}>
            <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={22} color="#5F6368" />
          </TouchableOpacity>
        </View>

        {isLogin && (
          <TouchableOpacity style={styles.rememberRow} onPress={() => setRememberMe(!rememberMe)}>
            <View style={[styles.checkbox, rememberMe && styles.checked]}>
              {rememberMe && <Ionicons name="checkmark" size={14} color="#FFF" />}
            </View>
            <Text style={styles.rememberText}>Recordar email</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? 'Cargando...' : isLogin ? 'Entrar' : 'Registrarse'}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setIsLogin(!isLogin)}>
          <Text style={styles.link}>
            {isLogin ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 100 },
  title: { fontSize: 32, fontWeight: '700', textAlign: 'center', color: Colors.primary, marginBottom: 8 },
  subtitle: { fontSize: 18, textAlign: 'center', color: '#5F6368', marginBottom: 32 },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DADCE0',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  inputError: {
    borderColor: '#D93025',
  },
  errorText: {
    color: '#D93025',
    fontSize: 12,
    marginTop: -8,
    marginBottom: 12,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DADCE0',
    borderRadius: 8,
    marginBottom: 16,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
  },
  eyeButton: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#DADCE0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checked: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  rememberText: { color: '#5F6368', fontSize: 14 },

  link: { color: Colors.primary, textAlign: 'center', marginTop: 24, fontSize: 14 },
  inviteContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  inviteInput: {
    flex: 1,
    marginBottom: 0,
    paddingRight: 40,
  },
  inviteIcon: {
    position: 'absolute',
    right: 14,
    top: '50%',
    marginTop: -9,
  },
  button: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});

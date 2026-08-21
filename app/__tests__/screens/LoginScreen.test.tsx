import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockSetToken = jest.fn();
const mockSetUser = jest.fn();
const mockConnectSocket = jest.fn();

jest.mock('../../src/services/api');
jest.mock('../../src/services/socket', () => ({
  connectSocket: mockConnectSocket,
}));

jest.mock('../../src/store/useStore', () => ({
  useStore: () => ({
    setToken: mockSetToken,
    setUser: mockSetUser,
  }),
}));

const api = require('../../src/services/api').default;

describe('LoginScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders login form by default', () => {
    const LoginScreen = require('../../src/screens/LoginScreen').default;
    const { getByText, getByPlaceholderText } = render(<LoginScreen />);
    expect(getByText('Iniciar sesión')).toBeTruthy();
    expect(getByPlaceholderText('Email')).toBeTruthy();
    expect(getByPlaceholderText('Contraseña')).toBeTruthy();
    expect(getByText('Entrar')).toBeTruthy();
  });

  it('switches to register form', () => {
    const LoginScreen = require('../../src/screens/LoginScreen').default;
    const { getByText, getByPlaceholderText, queryByPlaceholderText } = render(<LoginScreen />);
    expect(queryByPlaceholderText('Nombre de usuario')).toBeNull();
    fireEvent.press(getByText(/Regístrate/));
    expect(getByPlaceholderText('Nombre de usuario')).toBeTruthy();
    expect(getByText('Registrarse')).toBeTruthy();
  });

  it('shows error when fields are empty on submit', () => {
    const { Alert } = require('react-native');
    jest.spyOn(Alert, 'alert');
    const LoginScreen = require('../../src/screens/LoginScreen').default;
    const { getByText } = render(<LoginScreen />);
    fireEvent.press(getByText('Entrar'));
    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Completa todos los campos');
  });

  it('calls login API on submit', async () => {
    api.post.mockResolvedValue({
      data: { token: 'test-token', user: { id: 1, username: 'test', email: 'test@test.com' } },
    });
    const LoginScreen = require('../../src/screens/LoginScreen').default;
    const { getByText, getByPlaceholderText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('Email'), 'test@test.com');
    fireEvent.changeText(getByPlaceholderText('Contraseña'), 'password');
    fireEvent.press(getByText('Entrar'));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/auth/login', {
        email: 'test@test.com',
        password: 'password',
      });
    });
    expect(mockSetToken).toHaveBeenCalledWith('test-token');
    expect(mockSetUser).toHaveBeenCalledWith({ id: 1, username: 'test', email: 'test@test.com' });
  });

  it('calls register API on submit in register mode', async () => {
    api.post.mockResolvedValue({
      data: { token: 'new-token', user: { id: 2, username: 'newuser', email: 'new@test.com' } },
    });
    const LoginScreen = require('../../src/screens/LoginScreen').default;
    const { getByText, getByPlaceholderText } = render(<LoginScreen />);

    fireEvent.press(getByText(/Regístrate/));
    fireEvent.changeText(getByPlaceholderText('Nombre de usuario'), 'newuser');
    fireEvent.changeText(getByPlaceholderText('Email'), 'new@test.com');
    fireEvent.changeText(getByPlaceholderText('Contraseña'), 'password');
    fireEvent.press(getByText('Registrarse'));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/auth/register', {
        username: 'newuser',
        email: 'new@test.com',
        password: 'password',
      });
    });
  });
});

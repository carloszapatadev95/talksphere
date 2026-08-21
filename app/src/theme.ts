import APP_CONFIG from './config/appConfig';

export const Colors = {
  primary: APP_CONFIG.appColor,
  primaryLight: '#E8F0FE',
  primaryDark: '#1558B0',
  background: '#F5F7FA',
  surface: '#FFFFFF',
  text: '#202124',
  textSecondary: '#5F6368',
  textTertiary: '#9AA0A6',
  border: '#E8EAED',
  borderLight: '#DADCE0',
  success: '#34A853',
  error: '#EA4335',
  warning: '#FBBC04',
  online: '#34A853',
  offline: '#DADCE0',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const BorderRadius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  full: 999,
};

export const Shadows = {
  card: {
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    elevation: 2,
  },
};

import * as SecureStore from 'expo-secure-store';

const KEYS = {
  TOKEN: 'auth_token',
  EMAIL: 'remembered_email',
  BATTERY_WIZARD_SEEN: 'battery_wizard_seen',
};

export async function saveToken(token: string) {
  try {
    await SecureStore.setItemAsync(KEYS.TOKEN, token);
  } catch {}
}

export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEYS.TOKEN);
  } catch {
    return null;
  }
}

export async function deleteToken() {
  try {
    await SecureStore.deleteItemAsync(KEYS.TOKEN);
  } catch {}
}

export async function saveEmail(email: string) {
  try {
    await SecureStore.setItemAsync(KEYS.EMAIL, email);
  } catch {}
}

export async function getEmail(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEYS.EMAIL);
  } catch {
    return null;
  }
}

export async function deleteEmail() {
  try {
    await SecureStore.deleteItemAsync(KEYS.EMAIL);
  } catch {}
}

export async function saveBatteryWizardSeen() {
  try {
    await SecureStore.setItemAsync(KEYS.BATTERY_WIZARD_SEEN, '1');
  } catch {}
}

export async function getBatteryWizardSeen(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(KEYS.BATTERY_WIZARD_SEEN)) === '1';
  } catch {
    return false;
  }
}

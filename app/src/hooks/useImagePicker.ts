import { useState } from 'react';
import { Platform, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import api from '../services/api';

const MAX_RETRIES = 2;
const RETRY_DELAY = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useImagePicker() {
  const [uploading, setUploading] = useState(false);

  const requestMediaPermission = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permiso requerido', 'Se necesita acceso a la galería para enviar imágenes');
        return false;
      }
    }
    return true;
  };

  const requestCameraPermission = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permiso requerido', 'Se necesita acceso a la cámara para tomar fotos');
        return false;
      }
    }
    return true;
  };

  const pickFromGallery = async (): Promise<string | null> => {
    const ok = await requestMediaPermission();
    if (!ok) return null;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      base64: false,
    });

    if (result.canceled) return null;
    return result.assets[0].uri;
  };

  const takePhoto = async (): Promise<string | null> => {
    const ok = await requestCameraPermission();
    if (!ok) return null;

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.6,
      base64: false,
    });

    if (result.canceled) return null;
    return result.assets[0].uri;
  };

  const doUpload = async (uri: string, attempt = 0): Promise<string | null> => {
    const formData = new FormData();
    const filename = uri.split('/').pop() || 'photo.jpg';

    if (Platform.OS === 'web') {
      const response = await fetch(uri);
      const blob = await response.blob();
      formData.append('image', blob, filename);
    } else {
      const ext = filename.split('.').pop() || 'jpg';
      const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      formData.append('image', { uri, name: filename, type: mimeType } as any);
    }

    try {
      const { data } = await api.post('/upload', formData, {
        headers: { 'Content-Type': null },
        maxBodyLength: Infinity,
        timeout: 120000,
      });
      return data.url;
    } catch (err: any) {
      const isRetryable = !err.response || err.code === 'ECONNABORTED' || err.code === 'ERR_NETWORK' || err.message === 'Network Error';
      if (attempt < MAX_RETRIES && isRetryable) {
        console.warn(`Upload attempt ${attempt + 1} failed, retrying...`, err.message);
        await sleep(RETRY_DELAY * (attempt + 1));
        return doUpload(uri, attempt + 1);
      }
      throw err;
    }
  };

  const uploadImage = async (uri: string): Promise<string | null> => {
    if (uploading) return null;
    setUploading(true);
    try {
      return await doUpload(uri);
    } catch (err) {
      console.error('Upload error:', err);
      Alert.alert('Error de subida', 'No se pudo subir la imagen. Revisa tu conexión e inténtalo de nuevo.');
      return null;
    } finally {
      setUploading(false);
    }
  };

  return { pickFromGallery, takePhoto, uploadImage, uploading };
}

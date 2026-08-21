import { useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Colors } from '../theme';

const AVATAR_COLORS = ['#1A73E8', '#34A853', '#FBBC04', '#EA4335', '#8E24AA', '#00ACC1', '#FF6D00', '#43A047'];

function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

interface AvatarProps {
  uri?: string | null;
  name: string;
  size?: number;
  online?: boolean;
  baseUrl?: string;
}

export default function Avatar({ uri, name, size = 48, online, baseUrl }: AvatarProps) {
  const [hasError, setHasError] = useState(false);
  const initial = name?.[0]?.toUpperCase() || '?';
  const bgColor = hashColor(name || '?');
  const dotSize = Math.max(8, Math.round(size * 0.2));

  const imageUrl = uri
    ? (uri.startsWith('/avatars') && baseUrl ? `${baseUrl}${uri}` : uri)
    : null;

  const showImage = imageUrl && !hasError;

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.container,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: showImage ? Colors.surface : bgColor },
        ]}
      >
        {showImage ? (
          <Image
            source={{ uri: imageUrl }}
            style={{ width: size, height: size, borderRadius: size / 2 }}
            resizeMode="cover"
            onError={() => setHasError(true)}
          />
        ) : (
          <Text style={[styles.initial, { fontSize: Math.max(10, Math.round(size * 0.42)) }]}>
            {initial}
          </Text>
        )}
      </View>
      {online !== undefined && (
        <View
          style={[
            styles.dot,
            {
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize / 2,
              backgroundColor: online ? Colors.online : Colors.offline,
              right: 0,
              bottom: 0,
              borderWidth: Math.max(1, Math.round(dotSize * 0.15)),
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
container: {
  justifyContent: 'center',
  alignItems: 'center',
  overflow: 'hidden',
  position: 'relative',
},
  initial: {
    fontWeight: '700',
    color: '#FFFFFF',
  },
  dot: {
    position: 'absolute',
    borderColor: Colors.surface,
  },
});

import { View, Text, StyleSheet } from 'react-native';

interface Props {
  username?: string;
  usernames?: string[];
}

export default function TypingIndicator({ username, usernames }: Props) {
  const label = usernames && usernames.length > 1
    ? 'Varios están escribiendo...'
    : usernames && usernames.length === 1
      ? `${usernames[0]} está escribiendo...`
      : username
        ? `${username} está escribiendo...`
        : 'Alguien está escribiendo...';

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 4 },
  text: { fontSize: 13, color: '#5F6368', fontStyle: 'italic' },
});
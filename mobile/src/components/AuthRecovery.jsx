import { useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';

export default function AuthRecovery({ message, onRetry, onLogout }) {
  const { theme } = useTheme();
  const [busy, setBusy] = useState(false);

  async function retry() {
    if (busy) return;
    setBusy(true);
    try {
      await onRetry?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <Text style={[styles.title, { color: theme.text }]}>Unable to load your account</Text>
        <Text style={[styles.message, { color: theme.muted }]}>{message || 'EqualLearn could not load your profile.'}</Text>
        <Pressable disabled={busy} onPress={retry} style={[styles.button, { backgroundColor: theme.primary, opacity: busy ? 0.7 : 1 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Retry</Text>}
        </Pressable>
        <Pressable disabled={busy} onPress={onLogout} style={[styles.secondary, { borderColor: theme.line }]}>
          <Text style={[styles.secondaryText, { color: theme.text }]}>Back to sign in</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, justifyContent: 'center', padding: 22 },
  card: { borderWidth: 1, borderRadius: 22, padding: 22, gap: 14 },
  title: { fontSize: 20, fontWeight: '900' },
  message: { fontSize: 12, lineHeight: 19 },
  button: { minHeight: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  secondary: { minHeight: 44, borderWidth: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 11, fontWeight: '800' },
});

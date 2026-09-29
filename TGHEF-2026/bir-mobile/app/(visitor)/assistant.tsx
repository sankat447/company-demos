import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { askAssistant, RateLimitedError } from '@/features/aiAssistant/assistant';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

interface Msg {
  role: 'you' | 'bot';
  text: string;
  grounded?: boolean;
}

export default function Assistant() {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const scroller = useRef<ScrollView>(null);

  const send = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'you', text: q }]);
    setBusy(true);
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    try {
      const r = await askAssistant(q);
      setMsgs((m) => [...m, { role: 'bot', text: r.reply, grounded: r.grounded }]);
    } catch (e) {
      const msg = e instanceof RateLimitedError ? t('assistant.rateLimited') : t('assistant.error');
      setMsgs((m) => [...m, { role: 'bot', text: msg }]);
    } finally {
      setBusy(false);
      setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  return (
    <Screen title={t('assistant.title')}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <ScrollView
          ref={scroller}
          contentContainerStyle={styles.thread}
          showsVerticalScrollIndicator={false}
        >
          {msgs.length === 0 ? <Text style={styles.intro}>{t('assistant.intro')}</Text> : null}
          {msgs.map((m, i) => (
            <View key={i} style={[styles.bubble, m.role === 'you' ? styles.you : styles.bot]}>
              <Text style={m.role === 'you' ? styles.youText : styles.botText}>{m.text}</Text>
              {m.role === 'bot' && m.grounded ? (
                <Text style={styles.tag}>{t('assistant.grounded')}</Text>
              ) : null}
            </View>
          ))}
          {busy ? (
            <View style={[styles.bubble, styles.bot]}>
              <ActivityIndicator color={palette.pine} />
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={t('assistant.inputPlaceholder')}
            placeholderTextColor={color.textMuted}
            onSubmitEditing={send}
            returnKeyType="send"
            accessibilityLabel={t('assistant.inputPlaceholder')}
          />
          <Pressable
            style={[styles.sendBtn, (busy || !input.trim()) && { opacity: 0.5 }]}
            onPress={send}
            disabled={busy || !input.trim()}
            accessibilityRole="button"
            accessibilityLabel={t('assistant.send')}
          >
            <Text style={styles.sendText}>{t('assistant.send')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  thread: { paddingVertical: spacing.sm, gap: spacing.sm, flexGrow: 1 },
  intro: {
    ...typeScale.body,
    color: color.textMuted,
    paddingVertical: spacing.lg,
    textAlign: 'center',
  },
  bubble: {
    maxWidth: '86%',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  you: { alignSelf: 'flex-end', backgroundColor: palette.pine },
  bot: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: color.cardBorder,
  },
  youText: { ...typeScale.body, color: '#F6F3EC' },
  botText: { ...typeScale.body, color: color.text },
  tag: { ...typeScale.caption, color: palette.pine, marginTop: 4, fontWeight: '600' },
  inputRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.sm },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    ...typeScale.body,
    color: color.text,
    backgroundColor: '#FFFFFF',
  },
  sendBtn: {
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.primary,
  },
  sendText: { ...typeScale.body, color: color.textInverse, fontWeight: '700' },
});

/**
 * A small cross-platform form modal for Staff-mode management actions (Android
 * has no Alert.prompt). Renders a titled sheet with labelled text fields and a
 * Save/Cancel row. Kept dependency-free and offline-safe.
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

export interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  keyboard?: 'default' | 'number-pad';
  multiline?: boolean;
  kind?: 'text' | 'switch';
  initial?: string | boolean;
}

export function InputModal({
  visible,
  title,
  fields,
  submitLabel,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  title: string;
  fields: FieldDef[];
  submitLabel?: string;
  onSubmit: (values: Record<string, string | boolean>) => Promise<void> | void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [vals, setVals] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const init: Record<string, string | boolean> = {};
    fields.forEach((f) => (init[f.key] = f.initial ?? (f.kind === 'switch' ? false : '')));
    setVals(init);
    setBusy(false);
  }, [visible, fields]);

  const save = async () => {
    setBusy(true);
    try {
      await onSubmit(vals);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 380 }}>
            {fields.map((f) => (
              <View key={f.key} style={styles.field}>
                <Text style={styles.label}>{f.label}</Text>
                {f.kind === 'switch' ? (
                  <Switch
                    value={!!vals[f.key]}
                    onValueChange={(v) => setVals((s) => ({ ...s, [f.key]: v }))}
                    trackColor={{ true: palette.pine }}
                  />
                ) : (
                  <TextInput
                    style={[styles.input, f.multiline && styles.inputMulti]}
                    value={String(vals[f.key] ?? '')}
                    placeholder={f.placeholder}
                    placeholderTextColor={color.textMuted}
                    keyboardType={f.keyboard === 'number-pad' ? 'number-pad' : 'default'}
                    multiline={f.multiline}
                    onChangeText={(v) => setVals((s) => ({ ...s, [f.key]: v }))}
                  />
                )}
              </View>
            ))}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable style={[styles.btn, styles.ghost]} onPress={onClose} disabled={busy}>
              <Text style={styles.ghostText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.primary, busy && { opacity: 0.6 }]}
              onPress={save}
              disabled={busy}
            >
              <Text style={styles.primaryText}>{submitLabel || t('common.save')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(23,35,43,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { ...typeScale.heading, color: color.text, marginBottom: spacing.xs },
  field: { marginBottom: spacing.sm, gap: 4 },
  label: { ...typeScale.caption, color: color.textMuted },
  input: {
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
    padding: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    ...typeScale.body,
    color: color.text,
    backgroundColor: '#FFFFFF',
  },
  inputMulti: { minHeight: 72, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  btn: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghost: { borderWidth: 1, borderColor: color.cardBorder },
  ghostText: { ...typeScale.body, color: color.text },
  primary: { backgroundColor: color.primary },
  primaryText: { ...typeScale.body, color: color.textInverse, fontWeight: '600' },
});

import { Redirect } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { getAdminSession } from '@/auth/adminAuth';
import {
  lookupWristband,
  registerWristband,
  syncWristbands,
  type Wristband,
} from '@/features/staffManage/wristbands';
import { InputModal } from '@/features/staffManage/InputModal';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

export default function WristbandLookup() {
  const { t } = useTranslation();
  const [ready, setReady] = useState<boolean | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<Wristband | null | 'none'>(null);
  const [modal, setModal] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void getAdminSession().then((s) => setReady(!!s));
    void syncWristbands()
      .then((list) => setCount(list.length))
      .catch(() => setCount(null));
  }, []);

  if (ready === false) return <Redirect href="/(staff)/sign-in" />;

  const search = async () => {
    setNotice(null);
    setResult(await lookupWristband(query).then((b) => b ?? 'none'));
  };
  const resync = async () => {
    try {
      const list = await syncWristbands();
      setCount(list.length);
      setNotice(t('wristband.synced', { n: list.length }));
    } catch {
      /* offline — keep the snapshot */
    }
  };

  return (
    <Screen title={t('wristband.title')}>
      <ScrollView contentContainerStyle={styles.stack} keyboardShouldPersistTaps="handled">
        <Text style={styles.sub}>{t('wristband.subtitle')}</Text>

        <View style={styles.searchRow}>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder={t('wristband.searchPlaceholder')}
            placeholderTextColor={color.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            onSubmitEditing={search}
            accessibilityLabel={t('wristband.bandId')}
          />
          <Pressable style={styles.searchBtn} onPress={search} accessibilityRole="button">
            <Text style={styles.searchBtnText}>{t('wristband.search')}</Text>
          </Pressable>
        </View>

        {result === 'none' ? <Text style={styles.notFound}>{t('wristband.notFound')}</Text> : null}

        {result && result !== 'none' ? (
          <View style={styles.card}>
            <Text style={styles.bandId}>{result.bandId}</Text>
            <Row
              label={t('wristband.child')}
              value={`${result.childName}${result.ageBand ? ` · ${result.ageBand}` : ''}`}
            />
            <Row label={t('wristband.guardian')} value={result.guardianName || '—'} />
            <Row label={t('wristband.phone')} value={result.guardianPhone} />
            {result.zone ? <Row label={t('wristband.zone')} value={result.zone} /> : null}
            {result.notes ? <Row label={t('wristband.notes')} value={result.notes} /> : null}
            <Pressable
              style={styles.callBtn}
              onPress={() => Linking.openURL(`tel:${result.guardianPhone}`)}
              accessibilityRole="button"
            >
              <Text style={styles.callBtnText}>📞 {t('wristband.callGuardian')}</Text>
            </Pressable>
          </View>
        ) : null}

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        <View style={styles.actions}>
          <Pressable style={styles.ghost} onPress={() => setModal(true)} accessibilityRole="button">
            <Text style={styles.ghostText}>＋ {t('wristband.register')}</Text>
          </Pressable>
          <Pressable style={styles.ghost} onPress={resync} accessibilityRole="button">
            <Text style={styles.ghostText}>{t('wristband.resync')}</Text>
          </Pressable>
        </View>
        <Text style={styles.foot}>
          {count != null ? `${t('wristband.synced', { n: count })} · ` : ''}
          {t('wristband.offlineNote')}
        </Text>
      </ScrollView>

      {modal ? (
        <InputModal
          visible
          title={t('wristband.register')}
          submitLabel={t('common.save')}
          fields={[
            { key: 'bandId', label: t('wristband.bandId'), placeholder: 'KID-042' },
            { key: 'childName', label: t('wristband.childName') },
            { key: 'ageBand', label: t('wristband.ageBand'), placeholder: 'child' },
            { key: 'guardianName', label: t('wristband.guardianName') },
            { key: 'guardianPhone', label: t('wristband.guardianPhone'), keyboard: 'number-pad' },
            { key: 'zone', label: t('wristband.zone') },
            { key: 'notes', label: t('wristband.notes'), multiline: true },
          ]}
          onClose={() => setModal(false)}
          onSubmit={async (vals) => {
            const bandId = String(vals.bandId || '').trim();
            const childName = String(vals.childName || '').trim();
            const guardianPhone = String(vals.guardianPhone || '').trim();
            if (!bandId || !childName || !guardianPhone) return;
            await registerWristband({
              bandId,
              childName,
              ageBand: String(vals.ageBand || ''),
              guardianName: String(vals.guardianName || ''),
              guardianPhone,
              zone: String(vals.zone || ''),
              notes: String(vals.notes || ''),
            });
            setModal(false);
            setNotice(t('wristband.registered'));
            const list = await syncWristbands().catch(() => []);
            setCount(list.length);
          }}
        />
      ) : null}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowK}>{label}</Text>
      <Text style={styles.rowV}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md, paddingBottom: spacing.xl },
  sub: { ...typeScale.body, color: color.textMuted },
  searchRow: { flexDirection: 'row', gap: spacing.sm },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    ...typeScale.body,
    color: color.text,
    backgroundColor: '#FFFFFF',
    letterSpacing: 1,
  },
  searchBtn: {
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.primary,
  },
  searchBtnText: { ...typeScale.body, color: color.textInverse, fontWeight: '700' },
  notFound: { ...typeScale.body, color: palette.flagRed },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderLeftWidth: 4,
    borderLeftColor: palette.pine,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: 6,
  },
  bandId: { ...typeScale.heading, color: palette.ink, marginBottom: 4, letterSpacing: 1 },
  row: { flexDirection: 'row', gap: spacing.sm },
  rowK: { ...typeScale.caption, color: color.textMuted, width: 84 },
  rowV: { ...typeScale.body, color: color.text, flex: 1, fontWeight: '600' },
  callBtn: {
    marginTop: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.pine,
  },
  callBtnText: { ...typeScale.body, color: '#F6F3EC', fontWeight: '700' },
  notice: { ...typeScale.caption, color: color.info },
  actions: { flexDirection: 'row', gap: spacing.sm },
  ghost: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: { ...typeScale.body, color: color.text, fontWeight: '600' },
  foot: { ...typeScale.caption, color: color.textMuted, textAlign: 'center' },
});

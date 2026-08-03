import React from 'react';
import { StyleSheet, Text, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { color, spacing, typeScale } from './tokens';
import { FlightLineDivider } from './FlightLineDivider';

/** Branded screen shell: title in Fraunces + flight-line divider. */
export function Screen({ title, children, style, ...rest }: ViewProps & { title?: string }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={[styles.body, style]} {...rest}>
        {title ? (
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <FlightLineDivider width={180} />
          </View>
        ) : null}
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.bg },
  body: { flex: 1, paddingHorizontal: spacing.md },
  header: { paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.xs },
  title: { ...typeScale.title, color: color.text },
});

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAuthSession } from 'aws-amplify/auth';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { commitAllocation, loadAllocation, loadPool } from '@/features/lodging/allocation';
import { applyMove, propose, validateMove, type MoveViolation } from '@/features/lodging/engine';
import { kvRoomStore } from '@/features/lodging/rooms';
import type { Assignment, Participant, Unplaced } from '@/features/lodging/types';
import { kvStore } from '@/offline/db';
import { SqliteOutboxStore } from '@/offline/sqliteOutboxStore';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

const roomStore = kvRoomStore(kvStore);
const outbox = new SqliteOutboxStore();

/**
 * P6.12 — the allocation business process: review pool → auto-allocate
 * (suggestion) → adjust (moves blocked inline with §3 reasons, EN+HI) →
 * manual placement (same dignity as the main flow; actorNote logged) →
 * commit (idempotent; server re-validates).
 *
 * Gender appears ONLY here (admin-hospitality screens) — never on badges
 * or hotel rosters (§5).
 */
export default function Allocate() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const pool = useQuery({
    queryKey: ['lodging', 'pool'],
    queryFn: loadPool,
    networkMode: 'always',
  });
  const rooms = useQuery({
    queryKey: ['lodging', 'rooms'],
    queryFn: () => roomStore.list(),
    networkMode: 'always',
  });
  const committed = useQuery({
    queryKey: ['lodging', 'allocation'],
    queryFn: () => loadAllocation(kvStore),
    networkMode: 'always',
  });

  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [unplaced, setUnplaced] = useState<Unplaced[]>([]);
  const [moving, setMoving] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState<MoveViolation | null>(null);
  const [actorNote, setActorNote] = useState('');
  const [committedNow, setCommittedNow] = useState(false);

  const byId = new Map((pool.data ?? []).map((p) => [p.regId, p]));
  const activeRooms = (rooms.data ?? []).filter((r) => r.status === 'active');

  const suggest = () => {
    const proposal = propose(pool.data ?? [], rooms.data ?? []);
    setAssignments(proposal.assignments);
    setUnplaced(proposal.unplaced);
    setCommittedNow(false);
  };

  const tryMove = (participant: Participant, roomId: string) => {
    const violation = validateMove(
      participant,
      roomId,
      assignments ?? [],
      pool.data ?? [],
      rooms.data ?? [],
    );
    if (violation) {
      setBlockReason(violation);
      return;
    }
    setBlockReason(null);
    setAssignments(applyMove(assignments ?? [], participant.regId, roomId));
    setUnplaced(unplaced.filter((u) => u.regId !== participant.regId));
    setMoving(null);
  };

  const commit = async () => {
    if (!assignments) return;
    const session = await fetchAuthSession().catch(() => null);
    const sub = String(session?.tokens?.idToken?.payload?.sub ?? 'demo-admin');
    await commitAllocation(
      { kv: kvStore, outbox },
      { sub, assignments, actorNote: actorNote || undefined },
      Date.now(),
    );
    await queryClient.invalidateQueries({ queryKey: ['lodging', 'allocation'] });
    setCommittedNow(true);
  };

  const renderParticipantRow = (p: Participant, extra?: string) => (
    <View key={p.regId} style={styles.pRow}>
      <View style={styles.pBody}>
        <Text style={styles.pName}>
          {p.name}
          {p.coupleGroupId ? ' ⚭' : ''}
        </Text>
        <Text style={styles.pMeta}>
          {p.competitionId} · {t(`lodging.gender_${p.gender}`)} ·{' '}
          {p.nights.map((n) => n.slice(8)).join(',')} Nov
          {p.notes ? ` · ${p.notes}` : ''}
          {extra ? ` · ${extra}` : ''}
        </Text>
      </View>
      <Pressable
        style={styles.moveBtn}
        onPress={() => {
          setMoving(moving === p.regId ? null : p.regId);
          setBlockReason(null);
        }}
        accessibilityRole="button"
        accessibilityLabel={t('lodging.move')}
      >
        <Text style={styles.moveBtnText}>{moving === p.regId ? '×' : t('lodging.move')}</Text>
      </Pressable>
    </View>
  );

  const renderRoomPicker = (p: Participant) => (
    <View style={styles.picker}>
      {activeRooms.map((room) => {
        const violation = validateMove(
          p,
          room.id,
          assignments ?? [],
          pool.data ?? [],
          rooms.data ?? [],
        );
        return (
          <Pressable
            key={room.id}
            style={[styles.pickRoom, violation && styles.pickRoomBlocked]}
            disabled={!!violation}
            onPress={() => tryMove(p, room.id)}
            accessibilityRole="button"
            accessibilityLabel={`${room.hotelName} ${room.roomLabel}`}
            accessibilityState={{ disabled: !!violation }}
          >
            <Text style={styles.pickRoomText}>
              {room.hotelName} · {room.roomLabel}
            </Text>
            {violation ? (
              <Text style={styles.pickRoomWhy}>{t(`lodging.vio.${violation}`)}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );

  const grouped = new Map<string, Participant[]>();
  for (const a of assignments ?? []) {
    const p = byId.get(a.regId);
    if (p) grouped.set(a.roomId, [...(grouped.get(a.roomId) ?? []), p]);
  }
  const unassignedPool = (pool.data ?? []).filter(
    (p) =>
      p.needsLodging &&
      !(assignments ?? []).some((a) => a.regId === p.regId) &&
      !unplaced.some((u) => u.regId === p.regId),
  );

  return (
    <Screen title={t('lodging.allocate')}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {committed.data && !assignments ? (
          <Text style={styles.committedNote}>
            {t('lodging.committedVersion', { v: committed.data.version })}
          </Text>
        ) : null}

        <Pressable
          style={styles.suggest}
          onPress={suggest}
          accessibilityRole="button"
          accessibilityLabel={t('lodging.suggest')}
        >
          <Text style={styles.suggestText}>{t('lodging.suggest')}</Text>
        </Pressable>

        {!assignments ? (
          <>
            <Text style={styles.sectionTitle}>{t('lodging.pool')}</Text>
            {(pool.data ?? []).filter((p) => p.needsLodging).map((p) => renderParticipantRow(p))}
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>{t('lodging.proposal')}</Text>
            {[...grouped.entries()].map(([roomId, occupants]) => {
              const room = (rooms.data ?? []).find((r) => r.id === roomId);
              return (
                <View key={roomId} style={styles.roomCard}>
                  <Text style={styles.roomTitle}>
                    {room ? `${room.hotelName} · ${room.roomLabel}` : roomId}
                    {room?.doubleOccupancy ? ` (${t('lodging.type_double')})` : ''}
                  </Text>
                  {occupants.map((p) => (
                    <View key={p.regId}>
                      {renderParticipantRow(p)}
                      {moving === p.regId ? renderRoomPicker(p) : null}
                    </View>
                  ))}
                </View>
              );
            })}

            {unplaced.length ? (
              <>
                <Text style={styles.sectionTitle}>{t('lodging.manualQueue')}</Text>
                <Text style={styles.manualNote}>{t('lodging.manualNote')}</Text>
                {unplaced.map((u) => {
                  const p = byId.get(u.regId);
                  if (!p) return null;
                  return (
                    <View key={u.regId} style={styles.manualCard}>
                      {renderParticipantRow(p, t(`lodging.reason_${u.reason}`))}
                      {moving === p.regId ? renderRoomPicker(p) : null}
                    </View>
                  );
                })}
              </>
            ) : null}

            {unassignedPool.map((p) => (
              <View key={p.regId}>
                {renderParticipantRow(p, t('lodging.reassigned'))}
                {moving === p.regId ? renderRoomPicker(p) : null}
              </View>
            ))}

            {blockReason ? (
              <Text style={styles.blocked}>{t(`lodging.vio.${blockReason}`)}</Text>
            ) : null}

            <Text style={styles.label}>{t('lodging.actorNote')}</Text>
            <TextInput
              style={styles.noteInput}
              value={actorNote}
              onChangeText={setActorNote}
              placeholder={t('lodging.actorNoteHint')}
              placeholderTextColor={color.textMuted}
              accessibilityLabel={t('lodging.actorNote')}
            />

            <Pressable
              style={styles.commit}
              onPress={commit}
              accessibilityRole="button"
              accessibilityLabel={t('lodging.commit')}
            >
              <Text style={styles.commitText}>{t('lodging.commit')}</Text>
            </Pressable>
            {committedNow ? <Text style={styles.done}>{t('lodging.committed')}</Text> : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xl },
  committedNote: { ...typeScale.caption, color: color.textMuted, marginBottom: spacing.sm },
  suggest: {
    backgroundColor: palette.ink,
    borderColor: palette.marigold,
    borderWidth: 1,
    borderRadius: radius.md,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  suggestText: { ...typeScale.body, color: palette.marigold, fontWeight: '700' },
  sectionTitle: {
    ...typeScale.heading,
    color: color.text,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  pRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#EFF2EE',
  },
  pBody: { flex: 1 },
  pName: { ...typeScale.body, color: color.text, fontWeight: '600' },
  pMeta: { fontSize: 11, color: color.textMuted, marginTop: 1 },
  moveBtn: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.info,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveBtnText: { fontSize: 12, color: color.info, fontWeight: '600' },
  picker: { paddingVertical: spacing.xs, gap: 4 },
  pickRoom: {
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.sm,
    padding: spacing.sm,
    backgroundColor: '#FFFFFF',
  },
  pickRoomBlocked: { opacity: 0.55, backgroundColor: '#F6F7F5' },
  pickRoomText: { fontSize: 12.5, color: color.text, fontWeight: '600' },
  pickRoomWhy: { fontSize: 10.5, color: color.danger, marginTop: 2 },
  roomCard: {
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: '#FFFFFF',
  },
  roomTitle: { ...typeScale.body, color: palette.pine, fontWeight: '700', marginBottom: 4 },
  manualNote: {
    ...typeScale.caption,
    color: color.textMuted,
    marginBottom: spacing.xs,
    lineHeight: 16,
  },
  manualCard: {
    borderWidth: 1,
    borderColor: '#EBCDC2',
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: '#FDF7F4',
  },
  blocked: {
    ...typeScale.caption,
    color: color.danger,
    backgroundColor: '#FBEFEA',
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  label: {
    ...typeScale.caption,
    color: color.text,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: 6,
  },
  noteInput: {
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    ...typeScale.body,
    color: color.text,
    backgroundColor: '#FFFFFF',
  },
  commit: {
    marginTop: spacing.md,
    backgroundColor: palette.pine,
    borderRadius: radius.md,
    minHeight: MIN_TOUCH_TARGET + 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commitText: { ...typeScale.body, color: color.textInverse, fontWeight: '700' },
  done: { ...typeScale.caption, color: color.success, marginTop: spacing.sm, textAlign: 'center' },
});

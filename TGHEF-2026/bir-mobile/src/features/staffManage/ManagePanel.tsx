/**
 * Staff-mode management panels — the mobile counterpart of the web ops console.
 * Each panel lists item-level records from the admin control-plane endpoints and
 * exposes the write actions the caller's tier is allowed (create/edit/delete +
 * bespoke actions: incident triage, room allocation/check-in, volunteer shifts,
 * announcement posting…). Read-only tiers still see the list.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { adminCan, adminFetch } from '@/auth/adminAuth';
import { color, palette, radius, spacing, typeScale } from '@/ui/tokens';

import { FieldDef, InputModal } from './InputModal';

export type ManageKey = 'incidents' | 'schedule' | 'stalls' | 'lodging' | 'volunteers' | 'announce';

const ENDPOINT: Record<ManageKey, string> = {
  incidents: '/admin/incidents',
  schedule: '/admin/schedule',
  stalls: '/admin/stalls/list',
  lodging: '/admin/rooms',
  volunteers: '/admin/volunteers/list',
  announce: '/admin/announcements',
};
const CAP: Record<ManageKey, string> = {
  incidents: 'incidents.manage',
  schedule: 'schedule.manage',
  stalls: 'stalls.manage',
  lodging: 'lodging.manage',
  volunteers: 'volunteers.manage',
  announce: 'announce.write',
};
const INC_NEXT: Record<string, string> = {
  open: 'acknowledged',
  acknowledged: 'in-progress',
  'in-progress': 'resolved',
  resolved: 'resolved',
};
// Festival times are Asia/Kolkata.
const epochFrom = (day: string, hhmm: string) => {
  const ms = Date.parse(`${day}T${hhmm || '00:00'}:00+05:30`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
};
const hhmm = (s: number) => {
  try {
    const p = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(s * 1000));
    return `${p.find((x) => x.type === 'hour')?.value}:${p.find((x) => x.type === 'minute')?.value}`;
  } catch {
    return '';
  }
};
const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN');

interface Row {
  id: string;
  [k: string]: unknown;
}

export function ManagePanel({ panel, me, tier }: { panel: ManageKey; me: string; tier: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canWrite = adminCan(tier, CAP[panel]);
  const q = useQuery<{ items: Row[] }>({
    queryKey: ['admin', 'manage', panel],
    queryFn: () => adminFetch('GET', ENDPOINT[panel]),
    networkMode: 'always',
  });
  const [modal, setModal] = useState<{
    title: string;
    fields: FieldDef[];
    submit: (v: Record<string, string | boolean>) => Promise<void>;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'manage', panel] });
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await refresh();
    } catch {
      setErr(t('staffManage.actionFailed'));
    }
  };
  const confirmDelete = (noun: string, onYes: () => void) =>
    Alert.alert(t('staffManage.confirmDelete', { noun: t(`staffManage.${noun}`) }), '', [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('staffManage.delete'), style: 'destructive', onPress: onYes },
    ]);

  const items = q.data?.items ?? [];

  /* ------- per-panel create form + card renderer ------- */
  const openCreate = () => {
    if (panel === 'schedule')
      setModal({
        title: t('staffManage.addSession'),
        fields: [
          {
            key: 'day',
            label: t('staffManage.day'),
            placeholder: '2026-11-21',
            initial: '2026-11-21',
          },
          { key: 'venue', label: t('staffManage.venue'), placeholder: 'Chogan Ground' },
          { key: 'titleEn', label: t('staffManage.titleEn') },
          { key: 'titleHi', label: t('staffManage.titleHi') },
          {
            key: 'time',
            label: t('staffManage.startTime'),
            placeholder: '18:00',
            initial: '18:00',
          },
        ],
        submit: async (v) =>
          run(() =>
            adminFetch('POST', '/admin/schedule', {
              day: v.day,
              venue: v.venue,
              titleEn: v.titleEn,
              titleHi: v.titleHi,
              startsAt: epochFrom(String(v.day), String(v.time)),
            }),
          ).then(() => setModal(null)),
      });
    else if (panel === 'stalls')
      setModal({
        title: t('staffManage.addStall'),
        fields: [
          { key: 'stallName', label: t('staffManage.stallName') },
          { key: 'category', label: t('staffManage.category') },
          { key: 'allocationLabel', label: t('staffManage.allocationLabel') },
          { key: 'feeInr', label: t('staffManage.feeInr'), keyboard: 'number-pad' },
          { key: 'paid', label: t('staffManage.paid'), kind: 'switch' },
        ],
        submit: async (v) =>
          run(() =>
            adminFetch('POST', '/admin/stalls', {
              stallName: v.stallName,
              category: v.category,
              stage: 'pending',
              allocationLabel: v.allocationLabel,
              feeInr: Number(v.feeInr) || 0,
              paid: !!v.paid,
            }),
          ).then(() => setModal(null)),
      });
    else if (panel === 'lodging')
      setModal({
        title: t('staffManage.addRoom'),
        fields: [
          { key: 'hotelName', label: t('staffManage.hotel') },
          { key: 'roomLabel', label: t('staffManage.roomLabel') },
          { key: 'type', label: t('staffManage.type'), initial: 'twin' },
          {
            key: 'capacity',
            label: t('staffManage.capacity'),
            keyboard: 'number-pad',
            initial: '2',
          },
        ],
        submit: async (v) =>
          run(() =>
            adminFetch('POST', '/admin/rooms', {
              hotelName: v.hotelName,
              roomLabel: v.roomLabel,
              type: v.type,
              capacity: Number(v.capacity) || 2,
            }),
          ).then(() => setModal(null)),
      });
    else if (panel === 'volunteers')
      setModal({
        title: t('staffManage.addVolunteer'),
        fields: [
          { key: 'name', label: t('staffManage.name') },
          { key: 'team', label: t('staffManage.team') },
          { key: 'idVerified', label: t('staffManage.verified'), kind: 'switch' },
        ],
        submit: async (v) =>
          run(() =>
            adminFetch('POST', '/admin/volunteers', {
              name: v.name,
              team: v.team,
              idVerified: !!v.idVerified,
            }),
          ).then(() => setModal(null)),
      });
    else if (panel === 'announce')
      setModal({
        title: t('staffManage.addAnnouncement'),
        fields: [
          { key: 'titleEn', label: t('staffManage.annTitleEn') },
          { key: 'titleHi', label: t('staffManage.annTitleHi') },
          { key: 'bodyEn', label: t('staffManage.annBodyEn'), multiline: true },
          { key: 'bodyHi', label: t('staffManage.annBodyHi'), multiline: true },
          { key: 'level', label: t('staffManage.level'), initial: 'info' },
          { key: 'active', label: t('staffManage.activate'), kind: 'switch', initial: true },
        ],
        submit: async (v) =>
          run(() =>
            adminFetch('POST', '/admin/announcements', {
              titleEn: v.titleEn,
              titleHi: v.titleHi,
              bodyEn: v.bodyEn,
              bodyHi: v.bodyHi,
              level: v.level === 'alert' ? 'alert' : 'info',
              active: !!v.active,
            }),
          ).then(() => setModal(null)),
      });
  };

  const hasCreate = canWrite && panel !== 'incidents';

  return (
    <View style={styles.wrap}>
      {hasCreate ? (
        <Pressable style={styles.addBtn} onPress={openCreate} accessibilityRole="button">
          <Text style={styles.addText}>＋ {t('staffManage.add')}</Text>
        </Pressable>
      ) : null}
      {err ? <Text style={styles.err}>{err}</Text> : null}
      {q.isLoading ? <Text style={styles.dim}>{t('common.loading')}</Text> : null}
      {!q.isLoading && !items.length ? (
        <Text style={styles.dim}>{t('staffManage.none')}</Text>
      ) : null}

      {items.map((it) => renderCard(panel, it))}

      {modal ? (
        <InputModal
          visible
          title={modal.title}
          fields={modal.fields}
          onSubmit={modal.submit}
          onClose={() => setModal(null)}
        />
      ) : null}
    </View>
  );

  /* --------------------------- card renderers --------------------------- */
  function renderCard(p: ManageKey, it: Row) {
    if (p === 'incidents') {
      const status = String(it.status || 'open');
      return (
        <View key={it.id} style={styles.card}>
          <View style={styles.cardHead}>
            <Pill text={String(it.category || '')} tone="info" />
            <Pill text={status} tone={statusTone(status)} />
          </View>
          <Text style={styles.note}>{String(it.note || '')}</Text>
          {it.zone ? <Text style={styles.meta}>{String(it.zone)}</Text> : null}
          {it.assignee ? <Text style={styles.meta}>→ {String(it.assignee)}</Text> : null}
          {canWrite ? (
            <View style={styles.actions}>
              {status !== 'resolved' ? (
                <Btn
                  label={cap0(INC_NEXT[status])}
                  onPress={() =>
                    run(() =>
                      adminFetch('POST', `/admin/incidents/${enc(it.id)}`, {
                        status: INC_NEXT[status],
                      }),
                    )
                  }
                />
              ) : null}
              <Btn
                label={t('staffManage.assignMe')}
                onPress={() =>
                  run(() => adminFetch('POST', `/admin/incidents/${enc(it.id)}`, { assignee: me }))
                }
              />
              {status !== 'resolved' ? (
                <Btn
                  label={t('staffManage.resolve')}
                  onPress={() =>
                    setModal({
                      title: t('staffManage.resolve'),
                      fields: [
                        { key: 'note', label: t('staffManage.resolutionNote'), multiline: true },
                      ],
                      submit: async (v) =>
                        run(() =>
                          adminFetch('POST', `/admin/incidents/${enc(it.id)}`, {
                            status: 'resolved',
                            resolutionNote: v.note,
                          }),
                        ).then(() => setModal(null)),
                    })
                  }
                />
              ) : null}
            </View>
          ) : null}
        </View>
      );
    }
    if (p === 'schedule') {
      return (
        <View key={it.id} style={styles.card}>
          <Text style={styles.title}>{String(it.titleEn || '')}</Text>
          <Text style={styles.meta}>
            {String(it.day || '')}
            {it.startsAt ? ` · ${hhmm(Number(it.startsAt))}` : ''}
            {it.venue ? ` · ${it.venue}` : ''}
          </Text>
          {canWrite ? (
            <View style={styles.actions}>
              <Btn
                label={t('staffManage.delete')}
                danger
                onPress={() =>
                  confirmDelete('session', () =>
                    run(() => adminFetch('DELETE', `/admin/schedule/${enc(it.id)}`)),
                  )
                }
              />
            </View>
          ) : null}
        </View>
      );
    }
    if (p === 'stalls') {
      const paid = !!it.paid;
      return (
        <View key={it.id} style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.title}>{String(it.stallName || '')}</Text>
            <Pill
              text={String(it.stage || 'pending')}
              tone={it.stage === 'approved' ? 'good' : it.stage === 'rejected' ? 'bad' : 'info'}
            />
          </View>
          <Text style={styles.meta}>
            {String(it.category || '')} · {inr(Number(it.feeInr))} {paid ? '✓' : ''}
          </Text>
          {canWrite ? (
            <View style={styles.actions}>
              <Btn
                label={paid ? t('staffManage.markDue') : t('staffManage.markPaid')}
                onPress={() =>
                  run(() =>
                    adminFetch('POST', '/admin/stalls', {
                      id: it.id,
                      stallName: it.stallName,
                      category: it.category,
                      stage: it.stage,
                      allocationLabel: it.allocationLabel,
                      feeInr: Number(it.feeInr) || 0,
                      paid: !paid,
                    }),
                  )
                }
              />
              <Btn
                label={it.stage === 'approved' ? 'pending' : 'approve'}
                onPress={() =>
                  run(() =>
                    adminFetch('POST', '/admin/stalls', {
                      id: it.id,
                      stallName: it.stallName,
                      category: it.category,
                      stage: it.stage === 'approved' ? 'pending' : 'approved',
                      allocationLabel: it.allocationLabel,
                      feeInr: Number(it.feeInr) || 0,
                      paid,
                    }),
                  )
                }
              />
              <Btn
                label={t('staffManage.delete')}
                danger
                onPress={() =>
                  confirmDelete('stall', () =>
                    run(() => adminFetch('DELETE', `/admin/stalls/${enc(it.id)}`)),
                  )
                }
              />
            </View>
          ) : null}
        </View>
      );
    }
    if (p === 'lodging') {
      const guest = String(it.guestName || '');
      return (
        <View key={it.id} style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.title}>
              {String(it.hotelName || '')} · {String(it.roomLabel || '')}
            </Text>
            <Pill
              text={
                guest
                  ? it.checkedIn
                    ? t('staffManage.checkedIn')
                    : t('staffManage.checkIn')
                  : t('staffManage.free')
              }
              tone={guest ? (it.checkedIn ? 'good' : 'warn') : 'info'}
            />
          </View>
          <Text style={styles.meta}>
            {String(it.type || '')} · {String(it.capacity || 0)} · {guest || t('staffManage.free')}
          </Text>
          {canWrite ? (
            <View style={styles.actions}>
              <Btn
                label={t('staffManage.allocate')}
                onPress={() =>
                  setModal({
                    title: t('staffManage.allocate'),
                    fields: [
                      { key: 'guestName', label: t('staffManage.guestName'), initial: guest },
                    ],
                    submit: async (v) =>
                      run(() =>
                        adminFetch('POST', `/admin/rooms/${enc(it.id)}/allocate`, {
                          guestName: v.guestName,
                          checkedIn: false,
                        }),
                      ).then(() => setModal(null)),
                  })
                }
              />
              {guest ? (
                <Btn
                  label={
                    it.checkedIn ? '✓ ' + t('staffManage.checkedIn') : t('staffManage.checkIn')
                  }
                  onPress={() =>
                    run(() =>
                      adminFetch('POST', `/admin/rooms/${enc(it.id)}/allocate`, {
                        guestName: guest,
                        checkedIn: !it.checkedIn,
                      }),
                    )
                  }
                />
              ) : null}
            </View>
          ) : null}
        </View>
      );
    }
    if (p === 'volunteers') {
      const shifts = (it.shifts as { id: string; zone?: string; role?: string }[]) || [];
      return (
        <View key={it.id} style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.title}>{String(it.name || '')}</Text>
            <Pill
              text={it.idVerified ? t('staffManage.verified') : 'no ID'}
              tone={it.idVerified ? 'good' : 'info'}
            />
          </View>
          <Text style={styles.meta}>
            {String(it.team || '')} ·{' '}
            {shifts.length ? shifts.map((s) => s.zone || s.role).join(', ') : t('staffManage.none')}
          </Text>
          {canWrite ? (
            <View style={styles.actions}>
              <Btn
                label={it.idVerified ? '✓ ' + t('staffManage.verified') : t('staffManage.verify')}
                onPress={() =>
                  run(() =>
                    adminFetch('POST', '/admin/volunteers', {
                      id: it.id,
                      name: it.name,
                      team: it.team,
                      idVerified: !it.idVerified,
                    }),
                  )
                }
              />
              <Btn
                label={t('staffManage.addShift')}
                onPress={() =>
                  setModal({
                    title: t('staffManage.addShift'),
                    fields: [
                      { key: 'date', label: t('staffManage.shiftDate'), initial: '2026-11-21' },
                      { key: 'zone', label: t('staffManage.shiftZone') },
                      { key: 'role', label: t('staffManage.shiftRole'), initial: 'Scanner' },
                    ],
                    submit: async (v) =>
                      run(() =>
                        adminFetch('POST', `/admin/volunteers/${enc(it.id)}/shift`, {
                          date: v.date,
                          zone: v.zone,
                          role: v.role,
                        }),
                      ).then(() => setModal(null)),
                  })
                }
              />
            </View>
          ) : null}
        </View>
      );
    }
    // announcements
    return (
      <View key={it.id} style={styles.card}>
        <View style={styles.cardHead}>
          <Pill text={String(it.level || 'info')} tone={it.level === 'alert' ? 'bad' : 'info'} />
          <Pill
            text={it.active !== false ? 'live' : 'hidden'}
            tone={it.active !== false ? 'good' : 'info'}
          />
        </View>
        <Text style={styles.title}>{String(it.titleEn || '')}</Text>
        <Text style={styles.note}>{String(it.bodyEn || '')}</Text>
        {canWrite ? (
          <View style={styles.actions}>
            <Btn
              label={it.active !== false ? t('staffManage.deactivate') : t('staffManage.activate')}
              onPress={() =>
                run(() =>
                  adminFetch('POST', '/admin/announcements', {
                    id: it.id,
                    titleEn: it.titleEn,
                    titleHi: it.titleHi,
                    bodyEn: it.bodyEn,
                    bodyHi: it.bodyHi,
                    level: it.level,
                    active: it.active === false,
                  }),
                )
              }
            />
            <Btn
              label={t('staffManage.delete')}
              danger
              onPress={() =>
                confirmDelete('announcement', () =>
                  run(() => adminFetch('DELETE', `/admin/announcements/${enc(it.id)}`)),
                )
              }
            />
          </View>
        ) : null}
      </View>
    );
  }
}

const enc = (id: unknown) => encodeURIComponent(String(id));
const cap0 = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const statusTone = (s: string) =>
  s === 'resolved' ? 'good' : s === 'in-progress' ? 'info' : s === 'acknowledged' ? 'warn' : 'bad';

function Pill({ text, tone }: { text: string; tone: 'good' | 'bad' | 'warn' | 'info' }) {
  const c = { good: color.success, bad: palette.flagRed, warn: '#C67F1E', info: palette.slate }[
    tone
  ];
  return <Text style={[styles.pill, { color: c, borderColor: c }]}>{text}</Text>;
}
function Btn({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable
      style={[styles.btn, danger && styles.btnDanger]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text style={[styles.btnText, danger && styles.btnDangerText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  addBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: palette.pine,
  },
  addText: { ...typeScale.caption, color: '#F6F3EC', fontWeight: '700' },
  err: { ...typeScale.caption, color: color.danger },
  dim: {
    ...typeScale.body,
    color: color.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: { ...typeScale.body, color: color.text, fontWeight: '700', flexShrink: 1 },
  note: { ...typeScale.caption, color: color.text },
  meta: { ...typeScale.caption, color: color.textMuted },
  pill: {
    fontSize: 10.5,
    fontWeight: '700',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
    textTransform: 'lowercase',
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  btn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.cardBorder,
    backgroundColor: '#FBFBF8',
  },
  btnText: { ...typeScale.caption, color: color.text, fontWeight: '600' },
  btnDanger: { borderColor: palette.flagRed },
  btnDangerText: { color: palette.flagRed },
});

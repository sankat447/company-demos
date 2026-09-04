import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { adminCan, adminFetch, getAdminSession } from '@/auth/adminAuth';
import { InputModal } from '@/features/staffManage/InputModal';
import { ManagePanel, type ManageKey } from '@/features/staffManage/ManagePanel';
import { ParagliderSpinner } from '@/ui/ParagliderSpinner';
import { Screen } from '@/ui/Screen';
import { color, MIN_TOUCH_TARGET, palette, radius, spacing, typeScale } from '@/ui/tokens';

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN');
type PanelKey =
  | 'visitors'
  | 'incidents'
  | 'schedule'
  | 'stalls'
  | 'lodging'
  | 'volunteers'
  | 'announce'
  | 'refunds';
const PANELS: PanelKey[] = [
  'visitors',
  'incidents',
  'schedule',
  'stalls',
  'lodging',
  'volunteers',
  'announce',
];

/** Native Staff dashboard (Phase 2b): the same festival-wide monitoring as the
 *  web console, tier-gated, from the admin API. Fly-status is set here by
 *  Superadmin/Admin; every tier can monitor. */
export default function StaffDashboard() {
  const { t } = useTranslation();
  const session = useQuery({
    queryKey: ['adminSession'],
    queryFn: getAdminSession,
    networkMode: 'always',
  });
  const summary = useQuery<Summary>({
    queryKey: ['admin', 'summary'],
    queryFn: () => adminFetch('GET', '/admin/summary'),
    networkMode: 'always',
  });
  const [panel, setPanel] = useState<PanelKey>('visitors');
  const [flyBusy, setFlyBusy] = useState(false);

  const s = summary.data;
  const tier = session.data?.tier ?? 4;
  const canFly = adminCan(tier, 'flystatus.set');
  // Money is [1,2] only — surface the refund queue in the field for those tiers.
  const panels: PanelKey[] = adminCan(tier, 'orders.manage') ? [...PANELS, 'refunds'] : PANELS;

  const setFly = async (state: string) => {
    setFlyBusy(true);
    try {
      await adminFetch('POST', '/admin/fly', { state });
      await summary.refetch();
    } finally {
      setFlyBusy(false);
    }
  };

  if (session.isLoading) return <Loading title={t('staffDash.title')} />;
  if (!session.data) return <Redirect href="/(staff)/sign-in" />;

  return (
    <Screen title={t('staffDash.title')}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {summary.isLoading || !s ? (
          <View style={styles.center}>
            <ParagliderSpinner />
          </View>
        ) : (
          <>
            <View style={styles.kpiGrid}>
              <Kpi k={t('staffDash.flyStatus')} v={s.fly ? s.fly.state : '—'} tone={s.fly?.state} />
              <Kpi
                k={t('staffDash.registrations')}
                v={String(s.registrations.total)}
                sub={t('staffDash.needLodging', { n: s.registrations.needLodging })}
              />
              <Kpi
                k={t('staffDash.revenue')}
                v={inr(s.orders.revenueInr)}
                sub={`${s.orders.confirmed} · ${s.orders.pending}`}
              />
              <Kpi
                k={t('staffDash.scans')}
                v={String(s.engagement.scans)}
                sub={t('staffDash.revoked', { n: s.content.revocations })}
              />
              <Kpi
                k={t('staffDash.stalls')}
                v={String(s.stalls.total)}
                sub={`${s.stalls.paid}/${s.stalls.total}`}
              />
              <Kpi
                k={t('staffDash.rooms')}
                v={String(s.lodging.rooms)}
                sub={`${s.lodging.capacity} · ${s.lodging.hotels}`}
              />
              <Kpi
                k={t('staffDash.volunteers')}
                v={String(s.volunteers.total)}
                sub={`${s.volunteers.idVerified} ✓`}
              />
              <Kpi
                k={t('staffDash.incidents')}
                v={String(s.incidents.total)}
                sub={t('staffDash.faqs', { n: s.content.faqs })}
              />
            </View>

            {canFly ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t('staffDash.setFly')}</Text>
                <View style={styles.flyRow}>
                  {(['flying', 'hold', 'closed'] as const).map((st) => (
                    <Pressable
                      key={st}
                      style={[
                        styles.flyBtn,
                        styles[`fly_${st}` as 'fly_flying'],
                        s.fly?.state === st && styles.flyOn,
                      ]}
                      disabled={flyBusy}
                      onPress={() => setFly(st)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.flyText}>{t(`staffDash.${st}`)}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.tabs}>
              {panels.map((p) => (
                <Pressable
                  key={p}
                  style={[styles.tab, panel === p && styles.tabOn]}
                  onPress={() => setPanel(p)}
                >
                  <Text style={[styles.tabText, panel === p && styles.tabTextOn]}>
                    {t(`staffDash.tab_${p}`)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <PanelView panel={panel} me={session.data.username} tier={tier} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function PanelView({ panel, me, tier }: { panel: PanelKey; me: string; tier: number }) {
  // Visitors stays an analytics roll-up; every other panel is a live management
  // list (item-level records + tier-gated write actions).
  if (panel === 'visitors') return <VisitorsPanel />;
  if (panel === 'refunds') return <RefundsPanel />;
  return <ManagePanel panel={panel as ManageKey} me={me} tier={tier} />;
}

interface Refund {
  orderId: string;
  sub: string;
  itemId: string;
  amountInr: number;
  reason: string;
  status: string;
  processedRef: string;
}
function RefundsPanel() {
  const { t } = useTranslation();
  const q = useQuery<{ items: Refund[]; pending: number; pendingInr: number }>({
    queryKey: ['admin', 'refunds'],
    queryFn: () => adminFetch('GET', '/admin/refunds'),
    networkMode: 'always',
  });
  const [ref, setRef] = useState<string | null>(null); // orderId being processed
  if (q.isLoading || !q.data)
    return (
      <View style={styles.center}>
        <ParagliderSpinner />
      </View>
    );
  const items = q.data.items;
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.kpiGrid}>
        <Kpi
          k={t('staffDash.refundsPending')}
          v={String(q.data.pending)}
          sub={inr(q.data.pendingInr)}
        />
        <Kpi k={t('staffDash.refundsTotal')} v={String(items.length)} />
      </View>
      {items.length ? (
        items.map((r) => (
          <View key={r.orderId} style={styles.card}>
            <View style={styles.refundHead}>
              <Text style={styles.refundAmt}>{inr(r.amountInr)}</Text>
              <Text
                style={[
                  styles.refundPill,
                  r.status === 'PROCESSED' ? styles.refundDone : styles.refundOpen,
                ]}
              >
                {r.status}
              </Text>
            </View>
            <Text style={styles.refundMeta}>
              {r.itemId} · {r.reason}
            </Text>
            {r.processedRef ? <Text style={styles.refundMeta}>↳ {r.processedRef}</Text> : null}
            {r.status !== 'PROCESSED' ? (
              <Pressable
                style={styles.refundBtn}
                onPress={() => setRef(r.orderId)}
                accessibilityRole="button"
              >
                <Text style={styles.refundBtnText}>{t('staffDash.markProcessed')}</Text>
              </Pressable>
            ) : null}
          </View>
        ))
      ) : (
        <Text style={styles.empty}>{t('staffDash.noRefunds')}</Text>
      )}
      {ref ? (
        <InputModal
          visible
          title={t('staffDash.markProcessed')}
          fields={[
            { key: 'reference', label: t('staffDash.refundRef') },
            { key: 'note', label: t('staffManage.resolutionNote') },
          ]}
          onClose={() => setRef(null)}
          onSubmit={async (v) => {
            await adminFetch('POST', `/admin/refunds/${encodeURIComponent(ref)}/process`, {
              reference: v.reference,
              note: v.note,
            });
            setRef(null);
            await q.refetch();
          }}
        />
      ) : null}
    </View>
  );
}

function VisitorsPanel() {
  const { t } = useTranslation();
  const q = useQuery<Visitors>({
    queryKey: ['admin', 'visitors'],
    queryFn: () => adminFetch('GET', '/admin/visitors'),
    networkMode: 'always',
  });
  if (q.isLoading || !q.data)
    return (
      <View style={styles.center}>
        <ParagliderSpinner />
      </View>
    );
  return (
    <Table
      rows={q.data.registrations.byItem.map((x) => [x.item, String(x.total)])}
      head={[t('staffDash.activity'), t('staffDash.count')]}
    />
  );
}

function Kpi({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: string }) {
  const c = tone
    ? { flying: color.success, hold: '#C67F1E', closed: palette.flagRed }[tone]
    : undefined;
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiK}>{k}</Text>
      <Text style={[styles.kpiV, c ? { color: c } : null, v.length > 7 ? styles.kpiVsmall : null]}>
        {v}
      </Text>
      {sub ? <Text style={styles.kpiSub}>{sub}</Text> : null}
    </View>
  );
}

function Table({ rows, head, empty }: { rows: string[][]; head: string[]; empty?: string }) {
  if (!rows.length) return <Text style={styles.empty}>{empty || '—'}</Text>;
  return (
    <View style={styles.table}>
      <View style={[styles.tr, styles.trHead]}>
        {head.map((h, i) => (
          <Text key={i} style={[styles.th, i === 0 && styles.tcWide]}>
            {h}
          </Text>
        ))}
      </View>
      {rows.slice(0, 40).map((r, ri) => (
        <View key={ri} style={styles.tr}>
          {r.map((cell, ci) => (
            <Text key={ci} style={[styles.td, ci === 0 && styles.tcWide]} numberOfLines={2}>
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function Loading({ title }: { title: string }) {
  return (
    <Screen title={title}>
      <View style={styles.center}>
        <ParagliderSpinner />
      </View>
    </Screen>
  );
}

/* types */
interface Summary {
  fly: { state: string } | null;
  registrations: { total: number; needLodging: number };
  orders: { revenueInr: number; confirmed: number; pending: number };
  engagement: { scans: number };
  stalls: { total: number; paid: number };
  lodging: { rooms: number; capacity: number; hotels: number };
  volunteers: { total: number; idVerified: number };
  incidents: { total: number };
  content: { revocations: number; faqs: number };
}
interface Visitors {
  registrations: { byItem: { item: string; total: number }[] };
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xl, gap: spacing.md },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kpi: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  kpiK: { fontSize: 10.5, color: color.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  kpiV: { ...typeScale.title, color: palette.pine, marginTop: 2 },
  kpiVsmall: { fontSize: 18 },
  kpiSub: { ...typeScale.caption, color: color.textMuted, marginTop: 2 },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: { ...typeScale.heading, color: color.text },
  flyRow: { flexDirection: 'row', gap: spacing.sm },
  flyBtn: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.cardBorder,
  },
  fly_flying: { backgroundColor: '#EAF1EC' },
  fly_hold: { backgroundColor: '#FAF0DD' },
  fly_closed: { backgroundColor: '#F7E7E0' },
  flyOn: { borderColor: palette.ink, borderWidth: 2 },
  flyText: { ...typeScale.caption, color: palette.ink, fontWeight: '800' },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: color.cardBorder,
    backgroundColor: '#FFFFFF',
  },
  tabOn: { backgroundColor: palette.ink, borderColor: palette.ink },
  tabText: { ...typeScale.caption, color: color.text, fontWeight: '600' },
  tabTextOn: { color: '#F6F3EC' },
  table: {
    borderWidth: 1,
    borderColor: color.cardBorder,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  tr: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: color.cardBorder },
  trHead: { borderTopWidth: 0, backgroundColor: '#FBFBF8' },
  th: {
    flex: 1,
    ...typeScale.caption,
    color: color.textMuted,
    fontWeight: '700',
    padding: spacing.sm,
  },
  td: { flex: 1, ...typeScale.caption, color: color.text, padding: spacing.sm },
  tcWide: { flex: 1.6 },
  empty: {
    ...typeScale.body,
    color: color.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  refundHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  refundAmt: { ...typeScale.heading, color: color.text },
  refundPill: {
    fontSize: 10.5,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  refundOpen: { backgroundColor: '#FAF0DD', color: '#C67F1E' },
  refundDone: { backgroundColor: '#EAF1EC', color: palette.pine },
  refundMeta: { ...typeScale.caption, color: color.textMuted },
  refundBtn: {
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.cardBorder,
    backgroundColor: '#FBFBF8',
  },
  refundBtnText: { ...typeScale.caption, color: color.text, fontWeight: '600' },
});

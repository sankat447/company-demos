/**
 * CO-002 Highlights: ONE generic system for competitions, cultural-night
 * participation, wellness/art sessions, adventure and tours — never eight
 * bespoke screens. The catalog is server-driven (ASK #21): the app renders
 * whatever the backend publishes; nothing is hardcoded except fallback icons.
 */

export type HighlightKind = 'competition' | 'agenda' | 'session' | 'adventure' | 'tour';

export type RegMode = 'register' | 'register-participation' | 'view-only';

export interface HighlightCategory {
  id: string;
  title: string;
  titleHi: string;
  /** Emoji fallback icon — the only hardcodable visual. */
  icon: string;
  order: number;
  kind: HighlightKind;
}

export interface Slot {
  id: string;
  /** AWSTimestamp — seconds. */
  startsAtSec: number;
  endsAtSec?: number;
  /** e.g. pilot name / departure label. */
  label?: string;
  labelHi?: string;
  capacity?: number;
  remaining?: number;
}

export interface FormField {
  key: string;
  label: string;
  labelHi: string;
  type: 'text' | 'phone' | 'number' | 'select';
  required?: boolean;
  options?: { value: string; label: string; labelHi: string }[];
}

export interface AgendaEntry {
  timeSec: number;
  title: string;
  titleHi: string;
}

export interface HighlightItem {
  id: string;
  categoryId: string;
  title: string;
  titleHi: string;
  summary: string;
  summaryHi: string;
  venue?: string;
  /** ISO dates the item runs on. */
  dates: string[];
  media: string[];
  rules?: string;
  rulesHi?: string;
  eligibility?: string;
  eligibilityHi?: string;
  fee?: { amount: number; currency: 'INR' };
  capacity?: number;
  remaining?: number;
  waitlist?: boolean;
  regMode: RegMode;
  slots?: Slot[];
  /** Server-driven registration form (name/phone prefilled from profile). */
  formSchema?: FormField[];
  /** Backend flags — the only allowed specialisation hooks (CO-002 §3). */
  gateChecked?: boolean;
  guardianRequired?: boolean;
  weatherSensitive?: boolean;
  /** Competitions: "Rounds & judging" copy. */
  roundsJudging?: string;
  roundsJudgingHi?: string;
  /** Cultural nights: full agenda timeline. */
  agenda?: AgendaEntry[];
}

export interface HighlightsCatalog {
  version: number;
  categories: HighlightCategory[];
  items: HighlightItem[];
}

export type RegistrationStatus =
  'draft' | 'pending-payment' | 'pending-sync' | 'confirmed' | 'waitlisted' | 'cancelled';

export interface Registration {
  id: string;
  itemId: string;
  slotId?: string;
  status: RegistrationStatus;
  qrPassJti?: string;
  answers: Record<string, string>;
  createdAtMs: number;
}

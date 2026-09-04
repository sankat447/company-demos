/**
 * Feature flags come from the stack contract so the backend can dark-launch
 * features without an app release (ARCHITECTURE.md §7).
 */
import { getStack } from './stack';

export type FlagName = 'festivalMode' | 'experiencesMarketplace' | (string & {});

export function isEnabled(flag: FlagName): boolean {
  return getStack().flags[flag] === true;
}

/**
 * After close-out the backend flips `flags.festivalMode` to false and the app
 * goes archival: new bookings and payments are disabled, while passes,
 * certificates, and the public report stay viewable (CLAUDE.md close-out mode).
 */
export function festivalConcluded(): boolean {
  return !isEnabled('festivalMode');
}

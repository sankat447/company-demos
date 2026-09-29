/**
 * Feature flags come from the stack contract so the backend can dark-launch
 * features without an app release (ARCHITECTURE.md §7).
 */
import Constants from 'expo-constants';

import { getStack } from './stack';

/**
 * Whether native Google Maps is usable — true only when a maps API key was baked
 * into the build (app.config.ts reads GOOGLE_MAPS_API_KEY at build time). Without
 * a key, react-native-maps' MapView crashes on native init ("API key not found"),
 * so screens must render a non-map fallback. Auto-detected from the embedded
 * config, so it flips on automatically once a key is provided at build.
 */
export function mapsEnabled(): boolean {
  const cfg = Constants.expoConfig as
    | { android?: { config?: { googleMaps?: { apiKey?: string } } }; ios?: { config?: { googleMapsApiKey?: string } } }
    | undefined;
  const key = cfg?.android?.config?.googleMaps?.apiKey || cfg?.ios?.config?.googleMapsApiKey || '';
  return typeof key === 'string' && key.length > 0;
}

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

/**
 * Design tokens from docs/BRAND.md. Components consume these — never raw hex in JSX.
 */
export const palette = {
  ink: '#17232B',
  pine: '#2E5E4E',
  slate: '#3E6B8C',
  marigold: '#E8A13D',
  flagRed: '#B4482B',
  paper: '#F7F8F5',
} as const;

export const color = {
  bg: palette.paper,
  bgDark: palette.ink,
  text: palette.ink,
  textInverse: palette.paper,
  textMuted: '#5B6B75',
  primary: palette.pine,
  accent: palette.marigold,
  info: palette.slate,
  danger: palette.flagRed,
  success: palette.pine,
  cardBorder: '#DDE2DC',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const typeScale = {
  display: { fontFamily: 'Fraunces_600SemiBold', fontSize: 32, lineHeight: 38 },
  title: { fontFamily: 'Fraunces_600SemiBold', fontSize: 24, lineHeight: 30 },
  heading: { fontFamily: 'Fraunces_600SemiBold', fontSize: 18, lineHeight: 24 },
  body: { fontSize: 16, lineHeight: 22 },
  caption: { fontSize: 13, lineHeight: 18 },
} as const;

export const radius = { sm: 6, md: 12, lg: 20 } as const;

/** Accessibility floor (CLAUDE.md rule 6). */
export const MIN_TOUCH_TARGET = 44;

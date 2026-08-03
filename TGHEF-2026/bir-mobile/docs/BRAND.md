# BRAND.md — Bir Design Tokens

Source of truth for `src/ui/tokens.ts`. Change here first, then mirror in code.

## Palette

| Token    | Hex       | Use                                            |
| -------- | --------- | ---------------------------------------------- |
| ink      | `#17232B` | primary text, dark surfaces, splash background |
| pine     | `#2E5E4E` | primary actions, success                       |
| slate    | `#3E6B8C` | links, informational accents                   |
| marigold | `#E8A13D` | brand accent, flight line, highlights          |
| flag-red | `#B4482B` | errors, destructive, SOS                       |
| paper    | `#F7F8F5` | light background                               |

## Motif

**The Billing→Bir flight line**: a dashed, descending arc (launch at Billing,
landing at Bir) rendered by `src/ui/FlightLineDivider.tsx`. Used under screen
titles and in empty states. The paraglider mark (`ParagliderSpinner`) is the
app-icon base and the loading indicator.

## Type

- Display/headings: **Fraunces SemiBold** (`@expo-google-fonts/fraunces`).
- Body/UI: system sans (SF Pro / Roboto), dynamic type respected.
- Scale: display 32, title 24, heading 18, body 16, caption 13 (see tokens).

## Spacing & shape

4-pt base grid: 4 / 8 / 16 / 24 / 32 / 48. Radii: 6 / 12 / 20.
Touch targets ≥ 44 pt (CLAUDE.md rule 6).

## Modes

Dark mode default during festival week (OLED savings — ARCHITECTURE.md §7
sustainability); the QR pass card is always ink-dark with a white QR well for
scanner contrast.

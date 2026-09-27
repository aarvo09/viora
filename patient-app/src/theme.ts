/* Theme tokens — Stitch "Serene Well-Being" Palette.
 *
 * Source of truth: Stitch Project 10820896350954981900 ("Serene Well-Being")
 *
 * Indigo-Violet Sanctuary (#5F3ADD / #7C5CFC), Serene Lavender Canvas (#FAF8FF),
 * Emerald Growth / Calm (#10B981), Ocean Sky (#0060AC), and high-contrast
 * warm typography (#1D1B20).
 *
 * No raw hex outside this file.
 */

export const colors = {
  bg: '#FAF8FF',
  bgGlowA: '#F3EFFF', // Soft violet radiance
  bgGlowB: '#EBF3FE', // Gentle sky radiance
  surface: '#FFFFFF',
  surfaceAlt: '#F4F3FA', // Surface container low
  surfaceHigh: '#EAE7F2',
  ink: '#1D1B20',
  inkSoft: '#47464F',
  muted: '#777587',
  line: '#E8E5EE',
  lineStrong: '#CDC8D8',
  primary: '#5F3ADD', // VIORA Signature Indigo-Violet Sanctuary
  primaryHover: '#4D2CBF',
  primaryTint: '#EADDFF', // Primary container / fixed
  primaryDeep: '#381E72', // High-contrast text on primaryTint
  secondary: '#0060AC', // Sky / Ocean calm
  secondaryTint: '#D2E4FF',
  secondaryDeep: '#004785',
  tertiary: '#10B981', // Emerald steady / improving
  tertiaryTint: '#D1FAE5',
  tertiaryDeep: '#047857',
  accent: '#7C5CFC', // Luminous violet
  accentTint: '#F3EFFF',
  accentDeep: '#5331C4',
  // Crisis / emergency red only — never exposed to patients as a clinical score
  riskCritical: '#BA1A1A',
  riskCriticalTint: '#FFDAD6',
}

/* How a patient-facing trend is coloured.
 *
 * Deliberately NOT the clinical risk palette. A person reading their own screen
 * sees supportive, non-stigmatising shades: Emerald for improving/steady,
 * Ocean for reflection, and soft warm violet for attention.
 */
export const trendTone = {
  good: { fg: '#047857', bg: '#D1FAE5' },
  neutral: { fg: '#47464F', bg: '#F4F3FA' },
  watch: { fg: '#004785', bg: '#D2E4FF' },
} as const

export const type = {
  // Patient surfaces are READ, not scanned: larger base, generous leading.
  base: 17,
  md: 19,
  lg: 24,
  xl: 30,
  display: 34,
  sm: 15,
  xs: 13,
}

export const space = {
  xs: 8,
  sm: 16,
  md: 24,
  lg: 32,
  xl: 48,
  hair: 4,
  tiny: 12,
}

export const radius = {
  card: 24,
  button: 999,
  pill: 999,
  sm: 14,
  lg: 28,
}

/* Ambient + breathing. Slower and softer so the app feels alive without
   ever demanding attention. */
export const motion = {
  ms: 260,
  slowMs: 900,
  breatheMs: 4200,
  driftMs: 22000,
  screenMs: 240,
  enterMs: 420,
  staggerMs: 70,
}

export const shadow = {
  card: {
    shadowColor: '#5F3ADD',
    shadowOpacity: 0.08,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  button: {
    shadowColor: '#5F3ADD',
    shadowOpacity: 0.28,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  subtle: {
    shadowColor: '#1D1B20',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
}

/* Minimum tappable size for mobile accessibility. */
export const HIT = 48

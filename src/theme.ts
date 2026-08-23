import type { TextStyle, ViewStyle } from 'react-native';

export type AppearanceMode = 'system' | 'light' | 'dark';
export type ColorSchemeName = 'light' | 'dark';

export type ColorPalette = {
  canvas: string;
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentDim: string;
  accentText: string;
  danger: string;
  warning: string;
  overlay: string;
  warningSurface: string;
  dangerSurface: string;
  dangerHold: string;
  dangerHoldText: string;
  qrBg: string;
  qrFg: string;
  bannerSurface: string;
  bannerText: string;
};

export const darkColors: ColorPalette = {
  canvas: '#07090C',
  bg: '#0B0F14',
  surface: '#141A22',
  surfaceAlt: '#1C2430',
  border: '#2A3443',
  text: '#F4F7FA',
  muted: '#8B97A8',
  accent: '#2EE59D',
  accentDim: '#1A6B4E',
  accentText: '#04140E',
  danger: '#FF5C7A',
  warning: '#F5C14C',
  overlay: 'rgba(0, 0, 0, 0.65)',
  warningSurface: '#2A2108',
  dangerSurface: '#2A0610',
  dangerHold: '#4A0B18',
  dangerHoldText: '#2A0610',
  qrBg: '#FFFFFF',
  qrFg: '#0B0F14',
  bannerSurface: '#3B2A08',
  bannerText: '#F8E3B0',
};

export const lightColors: ColorPalette = {
  canvas: '#E6EBF1',
  bg: '#F4F7FA',
  surface: '#FFFFFF',
  surfaceAlt: '#E8EEF4',
  border: '#CDD6E0',
  text: '#0B0F14',
  muted: '#5C6B7A',
  accent: '#2EE59D',
  accentDim: '#C8F5E3',
  accentText: '#04140E',
  danger: '#E23B5C',
  warning: '#B8860B',
  overlay: 'rgba(11, 15, 20, 0.45)',
  warningSurface: '#FFF6DE',
  dangerSurface: '#FDE8EC',
  dangerHold: '#F4C4CD',
  dangerHoldText: '#2A0610',
  qrBg: '#FFFFFF',
  qrFg: '#0B0F14',
  bannerSurface: '#FFF4D6',
  bannerText: '#7A5A10',
};

/** Letterbox / splash behind the brand cover. Do not recolor the ape art. */
export const COVER_BACKGROUND = '#507A8E';
export const COVER_FOOTER_TEXT = '#F4F7FA';

export const DEFAULT_APPEARANCE: AppearanceMode = 'system';

export const APPEARANCE_OPTIONS: { mode: AppearanceMode; label: string }[] = [
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
  { mode: 'system', label: 'System' },
];

export function normalizeAppearance(value: unknown): AppearanceMode {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }
  return DEFAULT_APPEARANCE;
}

export function resolveColorScheme(
  appearance: AppearanceMode,
  systemScheme: string | null | undefined,
): ColorSchemeName {
  if (appearance === 'light' || appearance === 'dark') {
    return appearance;
  }
  return systemScheme === 'light' ? 'light' : 'dark';
}

export function paletteForScheme(scheme: ColorSchemeName): ColorPalette {
  return scheme === 'light' ? lightColors : darkColors;
}

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 10,
  md: 16,
  lg: 24,
  pill: 999,
};

export type TypeStyles = {
  title: TextStyle;
  subtitle: TextStyle;
  label: TextStyle;
  body: TextStyle;
  meta: TextStyle;
};

export function createType(colors: ColorPalette): TypeStyles {
  return {
    title: {
      color: colors.text,
      fontSize: 28,
      fontWeight: '800',
      letterSpacing: -0.4,
    },
    subtitle: {
      color: colors.muted,
      fontSize: 14,
      lineHeight: 20,
    },
    label: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    body: {
      color: colors.text,
      fontSize: 15,
      lineHeight: 22,
    },
    meta: {
      color: colors.muted,
      fontSize: 13,
      lineHeight: 18,
    },
  };
}

export function createCard(colors: ColorPalette): ViewStyle {
  return {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  };
}

export function createField(colors: ColorPalette): TextStyle {
  return {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: spacing.md,
  };
}

export function createChip(colors: ColorPalette): ViewStyle {
  return {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  };
}

export const phoneWidth = 430;

/** Dark palette snapshot for tests or one-off fallbacks. Screens should use useTheme(). */
export const colors = darkColors;
export const type = createType(darkColors);
export const card = createCard(darkColors);
export const field = createField(darkColors);
export const chip = createChip(darkColors);

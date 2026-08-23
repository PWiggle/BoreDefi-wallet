export const colors = {
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
};

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

export const type = {
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800' as const,
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
    fontWeight: '700' as const,
    letterSpacing: 0.6,
    textTransform: 'uppercase' as const,
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

export const card = {
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: radius.md,
  borderWidth: 1,
  padding: spacing.md,
};

export const field = {
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: radius.md,
  borderWidth: 1,
  color: colors.text,
  fontSize: 16,
  minHeight: 52,
  paddingHorizontal: spacing.md,
};

export const chip = {
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: radius.pill,
  borderWidth: 1,
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
};

export const phoneWidth = 430;

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance, StyleSheet } from 'react-native';

import {
  APPEARANCE_OPTIONS,
  createCard,
  createChip,
  createField,
  createType,
  paletteForScheme,
  radius,
  resolveColorScheme,
  spacing,
  type AppearanceMode,
  type ColorPalette,
  type ColorSchemeName,
  type TypeStyles,
} from '../theme';
import { useWallet } from './WalletContext';

export type Theme = {
  appearance: AppearanceMode;
  scheme: ColorSchemeName;
  colors: ColorPalette;
  type: TypeStyles;
  card: ReturnType<typeof createCard>;
  field: ReturnType<typeof createField>;
  chip: ReturnType<typeof createChip>;
  spacing: typeof spacing;
  radius: typeof radius;
  setAppearance: (mode: AppearanceMode) => void;
};

const ThemeContext = createContext<Theme | null>(null);

function readSystemScheme(): ColorSchemeName {
  return Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings, setAppearance } = useWallet();
  const [systemScheme, setSystemScheme] = useState<ColorSchemeName>(readSystemScheme);

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme === 'light' ? 'light' : 'dark');
    });
    return () => sub.remove();
  }, []);

  const scheme = resolveColorScheme(settings.appearance, systemScheme);
  const persistAppearance = useCallback(
    (mode: AppearanceMode) => {
      void setAppearance(mode);
    },
    [setAppearance],
  );

  const value = useMemo<Theme>(() => {
    const colors = paletteForScheme(scheme);
    return {
      appearance: settings.appearance,
      scheme,
      colors,
      type: createType(colors),
      card: createCard(colors),
      field: createField(colors),
      chip: createChip(colors),
      spacing,
      radius,
      setAppearance: persistAppearance,
    };
  }, [persistAppearance, scheme, settings.appearance]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return value;
}

export function useThemedStyles<T extends Record<string, object>>(factory: (theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(
    () => StyleSheet.create(factory(theme) as StyleSheet.NamedStyles<T>) as T,
    [factory, theme],
  );
}

export { APPEARANCE_OPTIONS };

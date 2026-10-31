import { useEffect, useState } from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';

import { coverImage } from '../brand';
import { COVER_BACKGROUND } from '../theme';

/** How long the full logo stays up after the native splash hands off. */
const HOLD_MS = 1400;

type Props = {
  onDismiss: () => void;
};

/**
 * Full official lockup on #255470. The Android 12 splash icon is only the
 * padded ape head (the system mask is a circle). This overlay is what the
 * user actually sees once React paints.
 */
export function LaunchSplash({ onDismiss }: Props) {
  const { width, height } = useWindowDimensions();
  const [revealed, setRevealed] = useState(false);

  const reveal = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void SplashScreen.hideAsync().catch(() => undefined);
        setRevealed(true);
      });
    });
  };

  useEffect(() => {
    if (!revealed) {
      return;
    }
    const timer = setTimeout(onDismiss, HOLD_MS);
    return () => clearTimeout(timer);
  }, [onDismiss, revealed]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void SplashScreen.hideAsync().catch(() => undefined);
      setRevealed(true);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View pointerEvents="auto" style={styles.root} testID="boredefi-launch-splash">
      <StatusBar style="light" />
      <Image
        accessibilityLabel="BoreDefi"
        fadeDuration={0}
        onError={reveal}
        onLoadEnd={reveal}
        resizeMode="contain"
        source={coverImage}
        style={{ height, width }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COVER_BACKGROUND,
    zIndex: 20,
  },
});

import { useState } from 'react';
import { Image, Text, View, type ImageStyle, type StyleProp } from 'react-native';

import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { safeNftImageUrl } from '../wallet/nft-media';

function imageStyles({ colors, radius }: Theme) {
  return {
    image: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.sm,
    },
    placeholder: {
      alignItems: 'center' as const,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.sm,
      justifyContent: 'center' as const,
    },
    mark: {
      color: colors.muted,
      fontSize: 11,
      fontWeight: '800' as const,
    },
  };
}

export function SafeNftImage({
  url,
  style,
}: {
  url?: string;
  style?: StyleProp<ImageStyle>;
}) {
  const styles = useThemedStyles(imageStyles);
  const safe = safeNftImageUrl(url);
  const [failed, setFailed] = useState(false);

  if (!safe || failed) {
    return (
      <View style={[styles.placeholder, style]}>
        <Text style={styles.mark}>NFT</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: safe }}
      style={[styles.image, style]}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

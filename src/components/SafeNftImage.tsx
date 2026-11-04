import { useEffect, useMemo, useState } from 'react';
import { Image, Text, View, type ImageStyle, type StyleProp } from 'react-native';

import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { nftImageCandidates } from '../wallet/nft-media';

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
  const candidates = useMemo(() => nftImageCandidates(url), [url]);
  // Index into candidates: on a load error, try the next IPFS gateway before showing the placeholder.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setAttempt(0);
  }, [url]);
  const safe = candidates[attempt];

  if (!safe) {
    return (
      <View style={[styles.placeholder, style]}>
        <Text style={styles.mark}>NFT</Text>
      </View>
    );
  }

  return (
    <Image
      key={safe}
      source={{ uri: safe }}
      style={[styles.image, style]}
      resizeMode="cover"
      onError={() => setAttempt((current) => current + 1)}
    />
  );
}

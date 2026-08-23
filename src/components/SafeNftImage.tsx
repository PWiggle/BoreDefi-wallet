import { useState } from 'react';
import { StyleSheet, Text, View, Image, type ImageStyle, type StyleProp } from 'react-native';

import { colors, radius } from '../theme';
import { safeNftImageUrl } from '../wallet/nft-media';

export function SafeNftImage({
  url,
  style,
}: {
  url?: string;
  style?: StyleProp<ImageStyle>;
}) {
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

const styles = StyleSheet.create({
  image: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
  },
  placeholder: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    justifyContent: 'center',
  },
  mark: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
  },
});

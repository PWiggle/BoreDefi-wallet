import { useState } from 'react';
import { Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { WarningBanner } from '../components/WarningBanner';
import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { checksumAddress } from '../wallet/address-safety';
import { buildReceiveUri } from '../wallet/qr';

function nftReceiveStyles({ colors, type, card, radius, spacing }: Theme) {
  return {
    qrWrap: {
      alignSelf: 'center' as const,
      backgroundColor: colors.qrBg,
      padding: spacing.md,
      borderRadius: radius.md,
    },
    addrBox: {
      ...card,
      gap: spacing.sm,
    },
    network: {
      color: colors.accent,
      fontWeight: '800' as const,
    },
    addr: {
      ...type.body,
      fontFamily: 'monospace',
      fontSize: 13,
    },
  };
}

export function NftReceiveScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(nftReceiveStyles);
  const { session, selectedChain } = useWallet();
  const [copied, setCopied] = useState(false);

  if (!session) {
    return null;
  }

  const checksum = checksumAddress(session.address) ?? session.address;
  const uri = buildReceiveUri(checksum, selectedChain.id);

  const copy = async () => {
    await Clipboard.setStringAsync(checksum);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Screen title="Receive NFT" subtitle={selectedChain.name}>
      <View style={styles.qrWrap}>
        <QRCode value={uri} size={220} backgroundColor={colors.qrBg} color={colors.qrFg} />
      </View>
      <View style={styles.addrBox}>
        <Text style={styles.network}>{selectedChain.name}</Text>
        <Text selectable style={styles.addr}>
          {checksum}
        </Text>
      </View>
      <WarningBanner
        title={`Only receive NFTs on ${selectedChain.name}`}
        lines={[
          `Only receive NFTs on ${selectedChain.name}. Sending an NFT from another network can lose it. Never share your seed. This address can receive tokens and NFTs; scammers also airdrop junk — hidden spam stays hidden.`,
          'After someone sends you an NFT on this network, open NFTs and pull to refresh (or tap Refresh). It will show up here. Hidden spam stays in Hidden / possible spam.',
        ]}
      />
      <Button label={copied ? 'Copied' : 'Copy address'} onPress={() => void copy()} />
    </Screen>
  );
}

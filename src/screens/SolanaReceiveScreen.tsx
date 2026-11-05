import { Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { SOLANA_CLUSTER } from '../wallet/solana/config';
import { buildSolanaReceiveUri } from '../wallet/solana/qr';

function receiveStyles({ colors, type, card, radius, spacing }: Theme) {
  return {
    qrWrap: {
      alignSelf: 'center' as const,
      backgroundColor: colors.qrBg,
      padding: spacing.md,
      borderRadius: radius.md,
    },
    addrBox: card,
    addr: type.body,
    hint: type.subtitle,
  };
}

export function SolanaReceiveScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(receiveStyles);
  const { solanaAddress } = useWallet();
  const devnet = SOLANA_CLUSTER === 'devnet';

  if (!solanaAddress) {
    return (
      <Screen title="Receive" subtitle="Solana">
        <Text style={styles.hint}>Preparing your Solana address…</Text>
      </Screen>
    );
  }

  return (
    <Screen title="Receive" subtitle={devnet ? 'Solana devnet · SOL and tokens' : 'Solana · SOL and tokens'}>
      <View style={styles.qrWrap}>
        <QRCode value={buildSolanaReceiveUri(solanaAddress)} size={220} backgroundColor={colors.qrBg} color={colors.qrFg} />
      </View>
      <View style={styles.addrBox}>
        <Text style={styles.addr} selectable>
          {solanaAddress}
        </Text>
      </View>
      <Text style={styles.hint}>
        Only send SOL or Solana (SPL) tokens on the Solana network to this address. It is different from your
        0x address, and sending from Ethereum or another network can lose funds. It is the same address Phantom
        shows for your recovery phrase.
      </Text>
      <Button label="Copy Solana address" onPress={() => Clipboard.setStringAsync(solanaAddress)} />
    </Screen>
  );
}

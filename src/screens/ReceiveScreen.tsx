import { Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { buildReceiveUri } from '../wallet/qr';

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

export function ReceiveScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(receiveStyles);
  const { session, selectedChain } = useWallet();
  if (!session) {
    return null;
  }
  const uri = buildReceiveUri(session.address, selectedChain.id);

  return (
    <Screen title="Receive" subtitle={`${selectedChain.name} · ${selectedChain.symbol}`}>
      <View style={styles.qrWrap}>
        <QRCode value={uri} size={220} backgroundColor={colors.qrBg} color={colors.qrFg} />
      </View>
      <View style={styles.addrBox}>
        <Text style={styles.addr}>{session.address}</Text>
      </View>
      <Text style={styles.hint}>
        Only send {selectedChain.symbol} on {selectedChain.name} to this address. Sending from another
        network can lose funds.
      </Text>
      <Button label="Copy address" onPress={() => Clipboard.setStringAsync(session.address)} />
    </Screen>
  );
}

import { StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { useWallet } from '../context/WalletContext';
import { card, colors, radius, spacing, type } from '../theme';
import { buildReceiveUri } from '../wallet/qr';

export function ReceiveScreen() {
  const { session, selectedChain } = useWallet();
  if (!session) {
    return null;
  }
  const uri = buildReceiveUri(session.address, selectedChain.id);

  return (
    <Screen title="Receive" subtitle={`${selectedChain.name} · ${selectedChain.symbol}`}>
      <View style={styles.qrWrap}>
        <QRCode value={uri} size={220} backgroundColor="white" color="#0B0F14" />
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

const styles = StyleSheet.create({
  qrWrap: {
    alignSelf: 'center',
    backgroundColor: '#fff',
    padding: spacing.md,
    borderRadius: radius.md,
  },
  addrBox: card,
  addr: type.body,
  hint: type.subtitle,
});

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { isAddress } from 'ethers';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useWallet } from '../context/WalletContext';
import type { MainStackParamList } from '../navigation';
import { colors, radius, spacing } from '../theme';
import { type NftItem, type NftStandard, sendNft } from '../wallet/nfts';

const STANDARDS: NftStandard[] = ['ERC-721', 'ERC-1155'];

export function NftSendScreen() {
  const route = useRoute<RouteProp<MainStackParamList, 'NftSend'>>();
  const { session, selectedChain } = useWallet();
  const preset = route.params?.nft;
  const [to, setTo] = useState('');
  const [contract, setContract] = useState(preset?.contract ?? '');
  const [tokenId, setTokenId] = useState(preset?.tokenId ?? '');
  const [standard, setStandard] = useState<NftStandard>(preset?.standard ?? 'ERC-721');
  const [amount, setAmount] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  useEffect(() => {
    if (preset) {
      setContract(preset.contract);
      setTokenId(preset.tokenId);
      setStandard(preset.standard);
    }
  }, [preset]);

  if (!session) {
    return null;
  }

  const confirm = async () => {
    setError(null);
    if (!isAddress(to) || !isAddress(contract) || !tokenId.trim()) {
      setError('Enter a valid recipient, contract, and token id.');
      return;
    }
    const item: NftItem = {
      chainId: preset?.chainId ?? selectedChain.id,
      contract,
      tokenId: tokenId.trim(),
      standard,
      name: preset?.name ?? `#${tokenId.trim()}`,
      collection: preset?.collection ?? 'NFT',
    };
    let quantity: bigint | undefined;
    try {
      quantity = standard === 'ERC-1155' ? BigInt(amount || '1') : undefined;
    } catch {
      setError('Enter a valid ERC-1155 amount.');
      return;
    }
    setBusy(true);
    try {
      const tx = await sendNft({
        mnemonic: session.mnemonic,
        owner: session.address,
        to,
        item,
        amount: quantity,
      });
      setTxHash(tx.hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'NFT send failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Send NFT" subtitle={selectedChain.name}>
      {error ? <ErrorBanner message={error} /> : null}
      <TextInput
        value={to}
        onChangeText={setTo}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Recipient address"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <TextInput
        value={contract}
        onChangeText={setContract}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="NFT contract"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <TextInput
        value={tokenId}
        onChangeText={setTokenId}
        placeholder="Token id"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <View style={styles.row}>
        {STANDARDS.map((item) => (
          <Pressable
            key={item}
            onPress={() => setStandard(item)}
            style={[styles.chip, standard === item && styles.chipOn]}
          >
            <Text style={styles.chipText}>{item}</Text>
          </Pressable>
        ))}
      </View>
      {standard === 'ERC-1155' ? (
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="number-pad"
          placeholder="Amount"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
      ) : null}
      <Button label="Send NFT" onPress={confirm} loading={busy} />
      {txHash ? <Text style={styles.hash}>Submitted {txHash}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    padding: spacing.md,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipOn: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  chipText: { color: colors.text, fontWeight: '700' },
  hash: { color: colors.accent },
});

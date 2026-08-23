import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { getAddress, isAddress } from 'ethers';

import { Button } from '../components/Button';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useWallet } from '../context/WalletContext';
import type { MainStackParamList } from '../navigation';
import { chip, colors, field, spacing, type } from '../theme';
import { addressWarnings, checksumAddress } from '../wallet/address-safety';
import { type NftItem, type NftStandard, sendNft, verifyNftOwnership } from '../wallet/nfts';

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
  const [review, setReview] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

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

  const buildItem = (): NftItem => ({
    chainId: preset?.chainId ?? selectedChain.id,
    contract: getAddress(contract),
    tokenId: tokenId.trim(),
    standard,
    name: preset?.name ?? `#${tokenId.trim()}`,
    collection: preset?.collection ?? 'NFT',
  });

  const prepare = async () => {
    setError(null);
    if (!isAddress(to) || !isAddress(contract) || !tokenId.trim()) {
      setError('Enter a valid recipient, contract, and token id.');
      return;
    }
    let quantity = 1n;
    if (standard === 'ERC-1155') {
      try {
        quantity = BigInt(amount || '1');
        if (quantity <= 0n) {
          throw new Error('Amount must be greater than zero.');
        }
      } catch {
        setError('Enter a valid ERC-1155 amount.');
        return;
      }
    }
    try {
      await verifyNftOwnership(session.address, buildItem(), quantity);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Owner check failed.');
      return;
    }
    const clipboard = await Clipboard.getStringAsync().catch(() => '');
    setWarnings([
      ...addressWarnings(to, clipboard),
      'This cannot be undone. The NFT leaves this wallet when the transaction confirms.',
    ]);
    setReview(true);
  };

  const confirm = async () => {
    setError(null);
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
        to: getAddress(to),
        item: buildItem(),
        amount: quantity,
      });
      setReview(false);
      setTxHash(tx.hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'NFT send failed.');
      setReview(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Send NFT" subtitle={selectedChain.name}>
      <Text style={styles.copy}>
        Owner is checked on-chain before broadcast. No claim or marketplace flow.
      </Text>
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
        editable={!preset}
      />
      <TextInput
        value={tokenId}
        onChangeText={setTokenId}
        placeholder="Token id"
        placeholderTextColor={colors.muted}
        style={styles.input}
        editable={!preset}
      />
      <View style={styles.row}>
        {STANDARDS.map((item) => (
          <Pressable
            key={item}
            onPress={() => {
              if (!preset) {
                setStandard(item);
              }
            }}
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
      <Button label="Review NFT send" onPress={prepare} loading={busy} />
      {txHash ? <Text style={styles.hash}>Submitted {txHash}</Text> : null}
      <ConfirmSheet
        visible={review}
        title="Confirm NFT send"
        network={selectedChain.name}
        from={session.address}
        to={checksumAddress(to) ?? to}
        amount={standard === 'ERC-1155' ? `${amount || '1'} × #${tokenId}` : `#${tokenId}`}
        fee="Network gas (quoted at broadcast)"
        extra={[
          { label: 'Collection', value: preset?.collection ?? 'Unknown collection' },
          { label: 'Standard', value: standard },
          { label: 'Contract', value: checksumAddress(contract) ?? contract },
          { label: 'Token id', value: tokenId },
          { label: 'Recipient', value: checksumAddress(to) ?? to },
          { label: 'Chain', value: selectedChain.name },
        ]}
        warnings={warnings}
        loading={busy}
        onConfirm={confirm}
        onCancel={() => setReview(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  copy: type.subtitle,
  input: field,
  row: { flexDirection: 'row', gap: spacing.sm },
  chip,
  chipOn: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  chipText: { color: colors.text, fontWeight: '700' },
  hash: { color: colors.accent },
});

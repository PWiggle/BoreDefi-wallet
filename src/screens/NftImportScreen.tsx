import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getAddress, isAddress } from 'ethers';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { WarningBanner } from '../components/WarningBanner';
import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { nftItemKey, type NftItem, type NftStandard, verifyNftOwnership } from '../wallet/nfts';
import { loadImportedNfts, saveImportedNfts } from '../wallet/storage';

const STANDARDS: NftStandard[] = ['ERC-721', 'ERC-1155'];

function nftImportStyles({ colors, chip, field, spacing, type }: Theme) {
  return {
    label: type.label,
    input: field,
    row: { flexDirection: 'row' as const, gap: spacing.sm },
    chip,
    chipOn: { backgroundColor: colors.accentDim, borderColor: colors.accent },
    chipText: { color: colors.text, fontWeight: '700' as const },
  };
}

export function NftImportScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(nftImportStyles);
  const navigation = useNavigation();
  const { session, selectedChain } = useWallet();
  const [contract, setContract] = useState('');
  const [tokenId, setTokenId] = useState('');
  const [standard, setStandard] = useState<NftStandard>('ERC-721');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!session) {
    return null;
  }

  const save = async () => {
    setError(null);
    if (!isAddress(contract) || !tokenId.trim()) {
      setError('Enter the collectible contract and token id.');
      return;
    }
    if (getAddress(contract) === getAddress(session.address)) {
      setError('That looks like a wallet address. Paste the collectible contract, not this wallet.');
      return;
    }
    const item: NftItem = {
      chainId: selectedChain.id,
      contract: getAddress(contract),
      tokenId: tokenId.trim(),
      standard,
      name: `#${tokenId.trim()}`,
      collection: 'Imported',
    };
    setBusy(true);
    try {
      await verifyNftOwnership(session.address, item);
      const existing = await loadImportedNfts();
      const next = existing.filter((row) => nftItemKey(row) !== nftItemKey(item));
      next.push(item);
      await saveImportedNfts(next);
      navigation.goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import that collectible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Import NFT" subtitle={selectedChain.name}>
      <WarningBanner
        title="Paste the collectible contract"
        lines={[
          'Paste the collectible contract address, not a wallet address.',
          'Import only adds a view on this device. It is not a claim, mint, or airdrop.',
        ]}
      />
      <ErrorBanner message={error} />
      <Text style={styles.label}>Collectible contract</Text>
      <TextInput
        value={contract}
        onChangeText={setContract}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="0x…"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <Text style={styles.label}>Token id</Text>
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
      <Button label="Import" loading={busy} onPress={save} />
    </Screen>
  );
}

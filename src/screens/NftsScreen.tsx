import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Button } from '../components/Button';
import { ChainPicker } from '../components/ChainPicker';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useWallet } from '../context/WalletContext';
import type { MainNavigation } from '../navigation';
import { card, colors, spacing, type } from '../theme';
import { CHAINS } from '../wallet/chains';
import { fetchNfts, type NftItem } from '../wallet/nfts';

export function NftsScreen() {
  const { session, selectedChain, setSelectedChain } = useWallet();
  const navigation = useNavigation<MainNavigation>();
  const [items, setItems] = useState<NftItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session) {
      return;
    }
    setBusy(true);
    setError(null);
    fetchNfts(session.address, selectedChain.id)
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : 'NFT load failed.'))
      .finally(() => setBusy(false));
  }, [selectedChain.id, session]);

  if (!session) {
    return null;
  }

  return (
    <Screen inset="tab" title="NFTs" subtitle={selectedChain.name}>
      <Text style={styles.copy}>
        ERC-721 and ERC-1155 from Blockscout. Avalanche has no public NFT index here — send by
        contract and token id.
      </Text>
      {error ? <ErrorBanner message={error} /> : null}
      <ChainPicker selected={selectedChain.id} onSelect={setSelectedChain} />
      {!CHAINS[selectedChain.id].nftApi ? (
        <Text style={styles.meta}>This chain has no NFT catalog. Use manual send.</Text>
      ) : null}
      <Button label="Send NFT manually" variant="secondary" onPress={() => navigation.navigate('NftSend', {})} />
      {busy ? <Text style={styles.meta}>Loading…</Text> : null}
      {items.length === 0 && !busy ? <Text style={styles.meta}>No NFTs found on this chain.</Text> : null}
      {items.map((item) => (
        <Pressable
          key={`${item.contract}-${item.tokenId}`}
          onPress={() => navigation.navigate('NftSend', { nft: item })}
          style={styles.card}
        >
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.meta}>
            {item.collection} · {item.standard} · #{item.tokenId}
          </Text>
          <Text style={styles.contract}>{item.contract}</Text>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  copy: type.subtitle,
  meta: type.meta,
  card: {
    ...card,
    gap: spacing.xs,
  },
  name: { color: colors.text, fontWeight: '700' },
  contract: { color: colors.muted, fontFamily: 'monospace', fontSize: 12 },
});

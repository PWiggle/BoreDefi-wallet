import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';

import { Button } from '../components/Button';
import { ChainPicker } from '../components/ChainPicker';
import { ErrorBanner } from '../components/ErrorBanner';
import { SafeNftImage } from '../components/SafeNftImage';
import { Screen } from '../components/Screen';
import { WarningBanner } from '../components/WarningBanner';
import { useWallet } from '../context/WalletContext';
import type { MainNavigation } from '../navigation';
import { card, colors, radius, spacing, type } from '../theme';
import { checksumAddress } from '../wallet/address-safety';
import { CHAINS } from '../wallet/chains';
import { shortenAddress } from '../wallet/format';
import { safeNftImageUrl } from '../wallet/nft-media';
import { classifyNftSpam, nftStorageKey, type NftSpamAssessment } from '../wallet/nft-spam';
import { fetchNfts, groupNftsByCollection, mergeNftLists, type NftItem } from '../wallet/nfts';
import {
  loadHiddenNfts,
  loadImportedNfts,
  loadRevealedNfts,
  saveHiddenNfts,
  saveRevealedNfts,
} from '../wallet/storage';

type GalleryItem = {
  item: NftItem;
  risk: NftSpamAssessment;
};

export function NftsScreen() {
  const { session, selectedChain, setSelectedChain } = useWallet();
  const navigation = useNavigation<MainNavigation>();
  const [items, setItems] = useState<NftItem[]>([]);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [userHidden, setUserHidden] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<GalleryItem | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!session) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const [catalog, imported, shown, hidden] = await Promise.all([
        fetchNfts(session.address, selectedChain.id),
        loadImportedNfts(),
        loadRevealedNfts(),
        loadHiddenNfts(),
      ]);
      setItems(mergeNftLists(catalog, imported.filter((item) => item.chainId === selectedChain.id)));
      setRevealed(new Set(shown));
      setUserHidden(new Set(hidden));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'NFT load failed.');
    } finally {
      setBusy(false);
    }
  }, [selectedChain.id, session]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const gallery = useMemo<GalleryItem[]>(
    () =>
      items.map((item) => {
        const risk = classifyNftSpam(item, revealed);
        const key = nftStorageKey(item);
        return {
          item,
          risk: {
            ...risk,
            hidden: userHidden.has(key) || risk.hidden,
          },
        };
      }),
    [items, revealed, userHidden],
  );
  const visible = gallery.filter((entry) => !entry.risk.hidden);
  const hidden = gallery.filter((entry) => entry.risk.hidden);
  const groups = groupNftsByCollection(visible);
  const hiddenGroups = groupNftsByCollection(hidden);

  if (!session) {
    return null;
  }

  const copyContract = async (contract: string) => {
    await Clipboard.setStringAsync(checksumAddress(contract) ?? contract);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const persistSets = async (nextRevealed: Set<string>, nextHidden: Set<string>) => {
    setRevealed(nextRevealed);
    setUserHidden(nextHidden);
    await Promise.all([saveRevealedNfts([...nextRevealed]), saveHiddenNfts([...nextHidden])]);
  };

  const showAnyway = async (item: NftItem) => {
    const key = nftStorageKey(item);
    const nextRevealed = new Set(revealed);
    const nextHidden = new Set(userHidden);
    nextRevealed.add(key);
    nextHidden.delete(key);
    await persistSets(nextRevealed, nextHidden);
    setSelected((current) =>
      current && nftStorageKey(current.item) === key
        ? { ...current, risk: { ...current.risk, hidden: false } }
        : current,
    );
  };

  const hideNft = async (item: NftItem) => {
    const key = nftStorageKey(item);
    const nextRevealed = new Set(revealed);
    const nextHidden = new Set(userHidden);
    nextHidden.add(key);
    nextRevealed.delete(key);
    await persistSets(nextRevealed, nextHidden);
    setSelected(null);
  };

  return (
    <Screen inset="tab" title="NFTs" subtitle={selectedChain.name}>
      <ChainPicker selected={selectedChain.id} onSelect={setSelectedChain} />
      <View style={styles.toolbar}>
        <Text style={styles.autodetect}>
          {CHAINS[selectedChain.id].nftApi
            ? 'Autodetect is on · public Blockscout catalog'
            : 'No catalog on Avalanche · import a collectible you own'}
        </Text>
        <Pressable onPress={() => navigation.navigate('NftImport')}>
          <Text style={styles.importLink}>Import</Text>
        </Pressable>
      </View>
      {error ? <ErrorBanner message={error} /> : null}
      {busy ? <Text style={styles.meta}>Loading…</Text> : null}
      {visible.length === 0 && !busy ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No NFTs yet</Text>
          <Text style={styles.meta}>
            {hidden.length > 0
              ? 'Unsolicited airdrops are in Hidden / possible spam below. Import a collectible you own, or show one after you read the warnings.'
              : 'Nothing from autodetect on this network. Import a collectible you already own.'}
          </Text>
          <Button label="Import" variant="secondary" onPress={() => navigation.navigate('NftImport')} />
        </View>
      ) : null}
      {groups.map((group) => (
        <View key={`${group.contract}`} style={styles.group}>
          <Text style={styles.groupTitle}>{group.collection}</Text>
          <View style={styles.grid}>
            {group.entries.map((entry) => (
              <NftTile key={nftStorageKey(entry.item)} entry={entry} onPress={() => setSelected(entry)} />
            ))}
          </View>
        </View>
      ))}
      <View style={styles.hiddenBox}>
        <Pressable onPress={() => setShowHidden((value) => !value)}>
          <Text style={styles.hiddenTitle}>
            Hidden / possible spam ({hidden.length}) {showHidden ? '▾' : '▸'}
          </Text>
        </Pressable>
        <Text style={styles.meta}>
          Airdrops and lookalike collections are hidden by default. Famous names on the wrong
          contract, missing https media, and first-seen drops stay here. Never auto-trust a name.
        </Text>
        {showHidden && hidden.length === 0 ? (
          <Text style={styles.meta}>Nothing hidden on this network right now.</Text>
        ) : null}
        {showHidden
          ? hiddenGroups.map((group) => (
              <View key={`hidden-${group.contract}`} style={styles.group}>
                <Text style={styles.groupTitle}>{group.collection}</Text>
                <View style={styles.grid}>
                  {group.entries.map((entry) => (
                    <NftTile
                      key={nftStorageKey(entry.item)}
                      entry={entry}
                      dim
                      onPress={() => setSelected(entry)}
                    />
                  ))}
                </View>
              </View>
            ))
          : null}
      </View>
      <Modal transparent animationType="fade" visible={Boolean(selected)} onRequestClose={() => setSelected(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            {selected ? (
              <ScrollView contentContainerStyle={styles.sheetBody}>
                <SafeNftImage url={selected.item.imageUrl} style={styles.hero} />
                {!safeNftImageUrl(selected.item.imageUrl) ? (
                  <Text style={styles.warn}>
                    Image hidden. Only https / IPFS-gateway images are shown. No HTML or SVG documents.
                  </Text>
                ) : null}
                <Text style={styles.name}>{selected.item.name}</Text>
                <Text style={styles.collection}>{selected.item.collection}</Text>
                <Text style={styles.meta}>Token id #{selected.item.tokenId} · {selected.item.standard}</Text>
                <Pressable onPress={() => copyContract(selected.item.contract)}>
                  <Text style={styles.contract}>
                    {copied ? 'Copied' : checksumAddress(selected.item.contract) ?? selected.item.contract}
                  </Text>
                  <Text style={styles.meta}>
                    {shortenAddress(checksumAddress(selected.item.contract) ?? selected.item.contract)} · tap to copy
                  </Text>
                </Pressable>
                <Text style={styles.meta}>{CHAINS[selected.item.chainId].name}</Text>
                <WarningBanner
                  title="Do not tap claim links"
                  lines={[
                    'BoreDefi will not open metadata websites, claim pages, or marketplaces from this NFT.',
                    ...selected.risk.reasons,
                  ]}
                />
                <Button label="View" onPress={() => setSelected(null)} />
                <Button
                  label="Send"
                  variant="secondary"
                  onPress={() => {
                    const nft = selected.item;
                    setSelected(null);
                    navigation.navigate('NftSend', { nft });
                  }}
                />
                {selected.risk.hidden ? (
                  <Button label="Show anyway" variant="ghost" onPress={() => void showAnyway(selected.item)} />
                ) : (
                  <Button label="Hide NFT" variant="ghost" onPress={() => void hideNft(selected.item)} />
                )}
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function NftTile({
  entry,
  onPress,
  dim,
}: {
  entry: GalleryItem;
  onPress: () => void;
  dim?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.tile, dim && styles.tileDim]}>
      <SafeNftImage url={entry.item.imageUrl} style={styles.thumb} />
      <Text numberOfLines={1} style={styles.tileName}>
        {entry.item.name}
      </Text>
      <Text numberOfLines={1} style={styles.tileMeta}>
        #{entry.item.tokenId}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  autodetect: {
    ...type.meta,
    flex: 1,
  },
  importLink: {
    color: colors.accent,
    fontWeight: '800',
  },
  meta: type.meta,
  empty: {
    ...card,
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
  },
  group: {
    gap: spacing.sm,
  },
  groupTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tile: {
    width: '48%',
    gap: 4,
  },
  tileDim: {
    opacity: 0.7,
  },
  thumb: {
    aspectRatio: 1,
    borderRadius: radius.md,
    width: '100%',
  },
  tileName: {
    color: colors.text,
    fontWeight: '700',
  },
  tileMeta: type.meta,
  hiddenBox: {
    ...card,
    gap: spacing.sm,
  },
  hiddenTitle: {
    color: colors.warning,
    fontWeight: '800',
  },
  backdrop: {
    backgroundColor: colors.overlay,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    maxHeight: '92%',
    overflow: 'hidden',
  },
  sheetBody: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  hero: {
    aspectRatio: 1,
    borderRadius: radius.md,
    width: '100%',
  },
  name: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
  },
  collection: {
    color: colors.accent,
    fontWeight: '700',
  },
  contract: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 12,
  },
  warn: {
    color: colors.warning,
    fontSize: 13,
    lineHeight: 18,
  },
});

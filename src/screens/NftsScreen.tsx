import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';

import { Button } from '../components/Button';
import { ChainPicker } from '../components/ChainPicker';
import { CircleAction } from '../components/CircleAction';
import { ErrorBanner } from '../components/ErrorBanner';
import { SafeNftImage } from '../components/SafeNftImage';
import { Screen } from '../components/Screen';
import { WarningBanner } from '../components/WarningBanner';
import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import type { MainNavigation } from '../navigation';
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

function nftStyles({ colors, type, card, radius, spacing }: Theme) {
  return {
    rail: {
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
    },
    toolbar: {
      alignItems: 'center' as const,
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      gap: spacing.sm,
    },
    advanced: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '700' as const,
    },
    autodetect: {
      ...type.meta,
      flex: 1,
    },
    importLink: {
      color: colors.accent,
      fontWeight: '800' as const,
    },
    meta: type.meta,
    empty: {
      ...card,
      alignItems: 'flex-start' as const,
      gap: spacing.sm,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '800' as const,
    },
    group: {
      gap: spacing.sm,
    },
    groupTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '800' as const,
    },
    grid: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: spacing.sm,
    },
    tile: {
      width: '48%' as const,
      gap: 4,
    },
    tileDim: {
      opacity: 0.7,
    },
    thumb: {
      aspectRatio: 1,
      borderRadius: radius.md,
      width: '100%' as const,
    },
    tileName: {
      color: colors.text,
      fontWeight: '700' as const,
    },
    tileMeta: type.meta,
    pickerRow: {
      alignItems: 'center' as const,
      flexDirection: 'row' as const,
      gap: spacing.sm,
    },
    pickerThumb: {
      borderRadius: radius.sm,
      height: 56,
      width: 56,
    },
    pickerCopy: {
      flex: 1,
      gap: 2,
    },
    hiddenBox: {
      ...card,
      gap: spacing.sm,
    },
    hiddenTitle: {
      color: colors.warning,
      fontWeight: '800' as const,
    },
    backdrop: {
      backgroundColor: colors.overlay,
      flex: 1,
      justifyContent: 'center' as const,
      padding: spacing.md,
    },
    sheet: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.lg,
      borderWidth: 1,
      maxHeight: '92%' as const,
      overflow: 'hidden' as const,
    },
    sheetBody: {
      gap: spacing.sm,
      padding: spacing.md,
    },
    hero: {
      aspectRatio: 1,
      borderRadius: radius.md,
      width: '100%' as const,
    },
    name: {
      color: colors.text,
      fontSize: 24,
      fontWeight: '800' as const,
    },
    collection: {
      color: colors.accent,
      fontWeight: '700' as const,
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
  };
}

export function NftsScreen() {
  const styles = useThemedStyles(nftStyles);
  const { session, selectedChain, setSelectedChain } = useWallet();
  const navigation = useNavigation<MainNavigation>();
  const [items, setItems] = useState<NftItem[]>([]);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [userHidden, setUserHidden] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<GalleryItem | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
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

  const openSend = (item: NftItem) => {
    setSelected(null);
    setPickerOpen(false);
    navigation.navigate('NftSend', { nft: item });
  };

  const startSend = () => {
    const selectedVisible = selected && !selected.risk.hidden ? selected : null;
    if (selectedVisible) {
      openSend(selectedVisible.item);
      return;
    }
    const onlyVisible = visible[0];
    if (visible.length === 1 && onlyVisible) {
      openSend(onlyVisible.item);
      return;
    }
    if (visible.length === 0) {
      setError(
        'No visible NFTs to send. Receive or import one you own. Hidden / possible spam cannot be sent until you Show anyway.',
      );
      return;
    }
    setError(null);
    setPickerOpen(true);
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
    <Screen
      inset="tab"
      title="NFTs"
      subtitle={selectedChain.name}
      refreshing={busy}
      onRefresh={() => void load()}
    >
      <ChainPicker selected={selectedChain.id} onSelect={setSelectedChain} />
      <View style={styles.rail}>
        <CircleAction label="Receive" name="receive" onPress={() => navigation.navigate('NftReceive')} />
        <CircleAction label="Send" name="send" onPress={startSend} />
      </View>
      <View style={styles.toolbar}>
        <Text style={styles.autodetect}>
          {CHAINS[selectedChain.id].nftApi
            ? 'Autodetect is on · public Blockscout catalog. Pull down or tap Refresh after you receive.'
            : 'No catalog on Avalanche · import a collectible you own'}
        </Text>
        <Pressable onPress={() => void load()}>
          <Text style={styles.importLink}>Refresh</Text>
        </Pressable>
      </View>
      <Pressable onPress={() => navigation.navigate('NftImport')}>
        <Text style={styles.advanced}>Import is advanced · paste a collectible contract you already own</Text>
      </Pressable>
      {error ? <ErrorBanner message={error} /> : null}
      {busy ? <Text style={styles.meta}>Loading…</Text> : null}
      {visible.length === 0 && !busy ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No NFTs yet</Text>
          <Text style={styles.meta}>
            {hidden.length > 0
              ? 'Unsolicited airdrops are in Hidden / possible spam below. Receive an NFT you expect, then pull to refresh. Or Show anyway after you read the warnings.'
              : 'Nothing from autodetect on this network. Receive an NFT on this chain, then pull to refresh. Import only a collectible you already own.'}
          </Text>
          <Button label="Receive" onPress={() => navigation.navigate('NftReceive')} />
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
      <Modal transparent animationType="fade" visible={pickerOpen} onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <ScrollView contentContainerStyle={styles.sheetBody}>
              <Text style={styles.name}>Send which NFT?</Text>
              <Text style={styles.meta}>
                Only visible collectibles. Hidden / possible spam is not listed until you Show anyway.
              </Text>
              {visible.map((entry) => (
                <Pressable
                  key={nftStorageKey(entry.item)}
                  onPress={() => openSend(entry.item)}
                  style={styles.pickerRow}
                >
                  <SafeNftImage url={entry.item.imageUrl} style={styles.pickerThumb} />
                  <View style={styles.pickerCopy}>
                    <Text numberOfLines={1} style={styles.tileName}>
                      {entry.item.name}
                    </Text>
                    <Text numberOfLines={1} style={styles.meta}>
                      {entry.item.collection} · #{entry.item.tokenId}
                    </Text>
                  </View>
                </Pressable>
              ))}
              <Button label="Cancel" variant="ghost" onPress={() => setPickerOpen(false)} />
            </ScrollView>
          </View>
        </View>
      </Modal>
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
                {selected.risk.hidden ? (
                  <>
                    <WarningBanner
                      title="Show anyway before send"
                      lines={[
                        'This is in Hidden / possible spam. Show anyway first. Do not send a hidden airdrop until you confirm you own it.',
                      ]}
                    />
                    <Button label="Show anyway" variant="ghost" onPress={() => void showAnyway(selected.item)} />
                  </>
                ) : (
                  <>
                    <Button label="Send" variant="secondary" onPress={() => openSend(selected.item)} />
                    <Button label="Hide NFT" variant="ghost" onPress={() => void hideNft(selected.item)} />
                  </>
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
  const styles = useThemedStyles(nftStyles);
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

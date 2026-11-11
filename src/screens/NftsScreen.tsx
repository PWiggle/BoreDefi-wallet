import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { Button } from '../components/Button';
import { ChainPicker } from '../components/ChainPicker';
import { CircleAction } from '../components/CircleAction';
import { ErrorBanner } from '../components/ErrorBanner';
import { SafeNftImage } from '../components/SafeNftImage';
import { useNftImage } from '../components/useNftImage';
import { Screen } from '../components/Screen';
import { WarningBanner } from '../components/WarningBanner';
import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import type { MainNavigation } from '../navigation';
import { PROOF_NFT_OWNER } from '../proof-mode';
import { checksumAddress } from '../wallet/address-safety';
import { CHAINS } from '../wallet/chains';
import { shortenAddress } from '../wallet/format';
import { safeNftImageUrl } from '../wallet/nft-media';
import {
  classifyNftSpam,
  displayCollectionName,
  displayNftName,
  nftStorageKey,
  type NftSpamAssessment,
} from '../wallet/nft-spam';
import { buildNftGallery, reconcileNftFetch } from '../wallet/nft-gallery';
import { fetchNfts, groupNftsByCollection, mergeNftLists, nftAutodetectLabel, type NftItem } from '../wallet/nfts';
import {
  loadHiddenNfts,
  loadLastGoodNfts,
  saveLastGoodNfts,
  loadImportedNfts,
  loadRevealedNfts,
  saveHiddenNfts,
  saveRevealedNfts,
} from '../wallet/storage';
import { copyWithAutoClear } from '../wallet/clipboard';

/** Protected collections only show content-addressed IPFS images (resolved from tokenURI when needed); see useNftImage. */
function NftImage({ item, style }: { item: NftItem; style?: Parameters<typeof SafeNftImage>[0]['style'] }) {
  const { url } = useNftImage(item);
  return <SafeNftImage url={url} style={style} />;
}

type GalleryItem = {
  item: NftItem;
  risk: NftSpamAssessment & { hiddenByYou?: boolean };
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
    badgeVerified: {
      color: colors.accent,
      fontSize: 11,
      fontWeight: '900' as const,
    },
    badgeFake: {
      color: colors.danger,
      fontSize: 11,
      fontWeight: '900' as const,
    },
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
  const [autodetectDown, setAutodetectDown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<GalleryItem | null>(null);
  const selectedImage = useNftImage(selected?.item);
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
      const owner = PROOF_NFT_OWNER ?? session.address;
      const [fetched, lastGood, imported, shown, hidden] = await Promise.all([
        fetchNfts(owner, selectedChain.id),
        loadLastGoodNfts(owner, selectedChain.id),
        loadImportedNfts().catch(() => [] as NftItem[]),
        loadRevealedNfts().catch(() => [] as string[]),
        loadHiddenNfts().catch(() => [] as string[]),
      ]);
      const { items: catalog, autodetect } = reconcileNftFetch(fetched, lastGood);
      if (fetched.autodetect === 'ok') {
        void saveLastGoodNfts(owner, selectedChain.id, fetched.items);
      }
      setItems(mergeNftLists(catalog, imported.filter((item) => item.chainId === selectedChain.id)));
      setAutodetectDown(autodetect === 'unavailable');
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

  const gallery = useMemo<GalleryItem[]>(() => buildNftGallery(items, revealed, userHidden), [items, revealed, userHidden]);
  const visible = gallery.filter((entry) => !entry.risk.hidden);
  const hidden = gallery.filter((entry) => entry.risk.hidden);
  const groups = groupNftsByCollection(visible);
  const hiddenGroups = groupNftsByCollection(hidden);

  if (!session) {
    return null;
  }

  const copyContract = async (contract: string) => {
    await copyWithAutoClear(checksumAddress(contract) ?? contract);
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
          {nftAutodetectLabel(selectedChain.id, selectedChain.name)}
        </Text>
        <Pressable onPress={() => void load()}>
          <Text style={styles.importLink}>Refresh</Text>
        </Pressable>
      </View>
      <Pressable onPress={() => navigation.navigate('NftImport')}>
        <Text style={styles.advanced}>Import is advanced · paste a collectible contract you already own</Text>
      </Pressable>
      {error ? <ErrorBanner message={error} /> : null}
      {autodetectDown && !busy ? (
        <Text style={styles.meta}>
          {`Autodetect is unavailable on ${selectedChain.name} right now. NFTs you import still show here.`}
        </Text>
      ) : null}
      {busy ? <Text style={styles.meta}>Loading…</Text> : null}
      {visible.length === 0 && !busy ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No NFTs yet</Text>
          <Text style={styles.meta}>
            {hidden.length > 0
              ? 'Unsolicited airdrops are in Hidden / possible spam below. Receive an NFT you expect, then pull to refresh. Or Show anyway after you read the warnings.'
              : autodetectDown
                ? 'Receive an NFT on this chain, or import a collectible you already own.'
                : 'Nothing from autodetect on this network. Receive an NFT on this chain, then pull to refresh. Import only a collectible you already own.'}
          </Text>
          <Button label="Receive" onPress={() => navigation.navigate('NftReceive')} />
          <Button label="Import" variant="secondary" onPress={() => navigation.navigate('NftImport')} />
        </View>
      ) : null}
      {groups.map((group) => (
        <View key={`${group.contract}`} style={styles.group}>
          <Text style={styles.groupTitle}>
            {group.entries[0] ? displayCollectionName(group.entries[0].item) : group.collection}
            {group.entries[0]?.risk.verified ? `  ✓ ${group.entries[0].risk.label ?? 'Verified'}` : ''}
          </Text>
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
                <Text style={styles.groupTitle}>
                  {group.collection}
                  {group.entries[0]?.risk.fake ? `  ⚠ ${group.entries[0].risk.label}` : ''}
                </Text>
                <View style={styles.grid}>
                  {group.entries.map((entry) => (
                    <NftTile
                      key={nftStorageKey(entry.item)}
                      entry={entry}
                      dim
                      onPress={() => setSelected(entry)}
                    />
                  ))}
                  {group.entries.filter((entry) => entry.risk.verified && entry.risk.hiddenByYou).map((entry) => (
                    <Button
                      key={`show-${nftStorageKey(entry.item)}`}
                      label={`Show ${displayNftName(entry.item)} (verified, hidden by you)`}
                      variant="ghost"
                      onPress={() => void showAnyway(entry.item)}
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
                  <NftImage item={entry.item} style={styles.pickerThumb} />
                  <View style={styles.pickerCopy}>
                    <Text numberOfLines={1} style={styles.tileName}>
                      {displayNftName(entry.item)}
                    </Text>
                    <Text numberOfLines={1} style={styles.meta}>
                      {displayCollectionName(entry.item)} · #{entry.item.tokenId}
                      {entry.risk.verified ? ` · ✓ ${entry.risk.label ?? 'Verified'}` : ''}
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
                <SafeNftImage url={selectedImage.url} style={styles.hero} />
                {!selectedImage.resolving && !safeNftImageUrl(selectedImage.url) ? (
                  <Text style={styles.warn}>
                    {selected.risk.verified
                      ? 'Image hidden. Protected collections only show images stored on IPFS by content hash, so a metadata server cannot swap in fake text.'
                      : 'Image hidden. Only https / IPFS-gateway images are shown. No HTML or SVG documents.'}
                  </Text>
                ) : null}
                {selected.risk.verified ? (
                  <Text style={styles.badgeVerified}>{`✓ ${selected.risk.label ?? 'Verified'} · official contract · protected collection`}</Text>
                ) : null}
                {selected.risk.fake ? <Text style={styles.badgeFake}>⚠ {selected.risk.label}</Text> : null}
                <Text style={styles.name}>{displayNftName(selected.item)}</Text>
                <Text style={styles.collection}>{displayCollectionName(selected.item)}</Text>
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
                    {selected.risk.fake ? (
                      <WarningBanner
                        danger
                        title={selected.risk.label ?? 'Fake'}
                        lines={['This copies a protected collection name (Yuga Labs / Bored Ape / Yaper) on a contract that is not official. It stays hidden. Do not interact with it.']}
                      />
                    ) : (
                      <Button label="Show anyway" variant="ghost" onPress={() => void showAnyway(selected.item)} />
                    )}
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
      <NftImage item={entry.item} style={styles.thumb} />
      {entry.risk.verified ? <Text style={styles.badgeVerified}>{`✓ ${entry.risk.label ?? 'Verified'}`}</Text> : null}
      {entry.risk.fake ? <Text style={styles.badgeFake}>⚠ Fake</Text> : null}
      <Text numberOfLines={1} style={styles.tileName}>
        {displayNftName(entry.item)}
      </Text>
      <Text numberOfLines={1} style={styles.tileMeta}>
        #{entry.item.tokenId}
      </Text>
    </Pressable>
  );
}

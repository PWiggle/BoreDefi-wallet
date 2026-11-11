import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { getAddress, Interface, isAddress } from 'ethers';

import { Button } from '../components/Button';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { TxPreviewCard } from '../components/TxPreviewCard';
import { previewInAppCalls } from '../wallet/tx-preview-runtime';
import type { TxPreview } from '../wallet/tx-simulate';
import { unexpectedProtectedMoves } from '../wallet/swap-preview';

import { ErrorBanner } from '../components/ErrorBanner';
import { ProtectedReauth } from '../components/ProtectedReauth';
import { Screen } from '../components/Screen';
import { WarningBanner } from '../components/WarningBanner';
import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import type { MainStackParamList } from '../navigation';
import { addressWarnings, checksumAddress } from '../wallet/address-safety';
import { type NftItem, type NftStandard, sendNft, verifyNftOwnership } from '../wallet/nfts';
import { friendlyTxError } from '../wallet/tx-errors';
import { checkProtectedRecipient, recipientTailMatches, rememberRecipient } from '../wallet/protected-policy';
import { getProvider } from '../wallet/rpc';
import { loadProtectedPolicy, saveProtectedPolicy } from '../wallet/storage';
import { protectedAssetFor, protectedBadgeLabel } from '../wallet/yuga-allowlist';
import { addressPoisoningCheck } from '../wallet/security/address-poisoning';
import { loadKnownAddresses, rememberKnownAddresses } from '../wallet/storage';
import { useNoScreenCapture } from '../components/useNoScreenCapture';

const STANDARDS: NftStandard[] = ['ERC-721', 'ERC-1155'];

function nftSendStyles({ colors, chip, field, spacing, type }: Theme) {
  return {
    label: type.label,
    input: field,
    row: { flexDirection: 'row' as const, gap: spacing.sm },
    chip,
    chipOn: { backgroundColor: colors.accentDim, borderColor: colors.accent },
    chipText: { color: colors.text, fontWeight: '700' as const },
    hash: { color: colors.accent },
    sheet: { backgroundColor: colors.dangerSurface, flex: 1 },
    sheetBody: { gap: spacing.md, padding: spacing.lg },
    sheetTitle: { color: colors.danger, fontSize: 24, fontWeight: '900' as const },
    big: { color: colors.text, fontFamily: 'monospace', fontSize: 18, fontWeight: '800' as const },
    line: { color: colors.text, fontSize: 15, lineHeight: 21 },
    redLabel: { ...type.label, color: colors.danger },
    verified: { color: colors.accent, fontWeight: '900' as const },
  };
}

const NFT_SEND_IFACE = new Interface([
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
]);

export function NftSendScreen() {
  useNoScreenCapture('nft-send');
  const { colors } = useTheme();
  const styles = useThemedStyles(nftSendStyles);
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, 'NftSend'>>();
  const { session, selectedChain } = useWallet();
  const preset = route.params?.nft;
  const [to, setTo] = useState(route.params?.to ?? '');
  const [contract, setContract] = useState(preset?.contract ?? '');
  const [tokenId, setTokenId] = useState(preset?.tokenId ?? '');
  const [standard, setStandard] = useState<NftStandard>(preset?.standard ?? 'ERC-721');
  const [amount, setAmount] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [tail, setTail] = useState('');
  const [nftPreview, setNftPreview] = useState<TxPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const chainForAsset = preset?.chainId ?? selectedChain.id;
  const protectedAsset = isAddress(contract) ? protectedAssetFor(chainForAsset, contract) : null;

  useEffect(() => {
    if (preset) {
      setContract(preset.contract);
      setTokenId(preset.tokenId);
      setStandard(preset.standard);
    }
  }, [preset]);

  useEffect(() => {
    if (route.params?.to) {
      setTo(route.params.to);
    }
  }, [route.params?.to]);

  if (!session) {
    return null;
  }

  const buildItem = (): NftItem => ({
    chainId: preset?.chainId ?? selectedChain.id,
    contract: getAddress(contract),
    tokenId: tokenId.trim(),
    standard,
    name: protectedAsset ? `${protectedAsset.name} #${tokenId.trim()}` : preset?.name ?? `#${tokenId.trim()}`,
    collection: protectedAsset?.name ?? preset?.collection ?? 'NFT',
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
      setError(friendlyTxError(err, { fallback: 'Owner check failed.' }));
      return;
    }
    const clipboard = await Clipboard.getStringAsync().catch(() => '');
    const protectedLines: string[] = [];
    if (protectedAsset) {
      const policy = await loadProtectedPolicy();
      const recipient = checkProtectedRecipient(policy, to);
      if (!recipient.allowed) {
        setError(recipient.reason ?? 'Recipient not allowed.');
        return;
      }
      if (recipient.isNew) {
        protectedLines.push(`New recipient: you have never sent a ${protectedAsset.name} NFT to this address. Check every character.`);
      } else if (recipient.label) {
        protectedLines.push(`Address book: ${recipient.label}.`);
      }
      try {
        const code = await getProvider(chainForAsset).getCode(getAddress(to));
        if (code && code !== '0x') {
          protectedLines.push('The recipient is a smart contract, not a normal wallet. If it cannot handle NFTs, your NFT can be stuck forever. Scammers also use contracts to sweep apes.');
        }
      } catch {
        protectedLines.push('Could not check whether the recipient is a contract. Be extra careful.');
      }
    }
    setTail('');
    const poison = addressPoisoningCheck(to, [...(await loadKnownAddresses('evm')), session?.address], 'evm');
    setWarnings([
      ...(poison ? [poison.warning] : []),
      ...protectedLines,
      ...addressWarnings(to, clipboard),
      'On-chain ownerOf / balanceOf matches this wallet. Send is blocked if it does not.',
      'This cannot be undone. The NFT leaves this wallet when the transaction confirms.',
    ]);
    setNftPreview(null);
    setPreviewLoading(true);
    setReview(true);
    try {
      const data =
        standard === 'ERC-721'
          ? NFT_SEND_IFACE.encodeFunctionData('safeTransferFrom(address,address,uint256)', [session.address, getAddress(to), BigInt(tokenId)])
          : NFT_SEND_IFACE.encodeFunctionData('safeTransferFrom(address,address,uint256,uint256,bytes)', [session.address, getAddress(to), BigInt(tokenId), quantity, '0x']);
      const { preview, simulation } = await previewInAppCalls(chainForAsset, session.address, [
        { from: session.address, to: getAddress(contract), value: 0n, data },
      ]);
      const expected = new Set(protectedAsset ? [protectedAsset.key] : []);
      const unexpected = unexpectedProtectedMoves(chainForAsset, simulation, session.address, expected);
      if (unexpected.length) {
        setReview(false);
        setError(`Blocked: the preview shows this would also move your ${unexpected.map((item) => item.name).join(', ')}. Nothing was sent.`);
        return;
      }
      setNftPreview(preview);
    } finally {
      setPreviewLoading(false);
    }
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
      void rememberKnownAddresses('evm', [to]);
      if (protectedAsset) {
        const policy = await loadProtectedPolicy();
        await saveProtectedPolicy(rememberRecipient(policy, to));
      }
    } catch (err) {
      setError(friendlyTxError(err, { fallback: 'NFT send failed.' }));
      setReview(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Send NFT" subtitle={selectedChain.name}>
      <WarningBanner
        title="Send safety"
        lines={[
          'Do not tap claim links. BoreDefi will not open metadata websites from this send.',
          'Recipient is checked for checksum, lookalike, and clipboard mismatch.',
          'On-chain ownerOf / balanceOf must match this wallet or send is blocked.',
          'This cannot be undone after you hold to confirm.',
        ]}
      />
      {error ? <ErrorBanner message={error} /> : null}
      <Text style={styles.label}>To</Text>
      <TextInput
        value={to}
        onChangeText={setTo}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Recipient address"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <Button
        label="Scan QR"
        variant="secondary"
        onPress={() => navigation.navigate('ScanQr', { purpose: 'nft', nft: preset })}
      />
      <WarningBanner lines={addressWarnings(to)} />
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
      {txHash ? (
        <>
          <Text style={styles.hash}>Submitted {txHash}</Text>
          <Button
            label="Done"
            variant="secondary"
            onPress={() => navigation.navigate('Tabs', { screen: 'NFTs' })}
          />
        </>
      ) : null}
      {protectedAsset ? (
        <Text style={styles.verified}>{`${protectedBadgeLabel(protectedAsset)} · ${protectedAsset.name} (protected collection)`}</Text>
      ) : null}
      <Modal
        visible={review && Boolean(protectedAsset)}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setReview(false)}
      >
        <SafeAreaView style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.sheetTitle}>{`Send ${protectedAsset?.name ?? 'NFT'} #${tokenId}`}</Text>
            <Text style={styles.redLabel}>Recipient · full address</Text>
            <Text selectable style={styles.big}>
              {checksumAddress(to) ?? to}
            </Text>
            <Text style={styles.redLabel}>Network</Text>
            <Text style={styles.line}>{selectedChain.name}</Text>
            {warnings.map((line) => (
              <Text key={line} style={styles.line}>
                • {line}
              </Text>
            ))}
            <TxPreviewCard preview={nftPreview} loading={previewLoading} />
            <Text style={styles.redLabel}>Check twice: type the last 4 characters of the recipient</Text>
            <TextInput
              value={tail}
              onChangeText={setTail}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={4}
              placeholder="last 4"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <ProtectedReauth
              reason={`Send ${protectedAsset?.name ?? 'NFT'}`}
              disabled={!recipientTailMatches(to, tail) || busy || previewLoading}
              busy={busy}
              confirmLabel="Send"
              onVerified={() => void confirm()}
            />
            <Button label="Cancel" variant="secondary" onPress={() => setReview(false)} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <ConfirmSheet
        visible={review && !protectedAsset}
        title="Confirm NFT send"
        network={selectedChain.name}
        from={session.address}
        to={checksumAddress(to) ?? to}
        amount={standard === 'ERC-1155' ? `${amount || '1'} × #${tokenId}` : `#${tokenId}`}
        fee="Network gas (quoted at broadcast)"
        preview={nftPreview}
        previewLoading={previewLoading}
        extra={[
          { label: 'Collection', value: protectedAsset?.name ?? preset?.collection ?? 'Unknown collection' },
          { label: 'Standard', value: standard },
          { label: 'Contract', value: checksumAddress(contract) ?? contract },
          { label: 'Token id', value: tokenId },
          { label: 'Recipient', value: checksumAddress(to) ?? to },
          { label: 'Chain', value: selectedChain.name },
        ]}
        warnings={[
          ...warnings,
          'Do not tap claim links. BoreDefi will not open metadata websites from this send.',
        ]}
        loading={busy || previewLoading}
        onConfirm={confirm}
        onCancel={() => setReview(false)}
      />
    </Screen>
  );
}

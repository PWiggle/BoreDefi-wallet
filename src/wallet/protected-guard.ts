import { getAddress, id, Interface, isAddress, ZeroAddress } from 'ethers';

import {
  PROTECTED_ADDRESSES_LOWER,
  protectedAssetFor,
  protectedNativeFor,
  type ProtectedAsset,
} from './yuga-allowlist';

/**
 * Guard for every dApp request (WalletConnect + in-app browser) that could move, approve or list a
 * protected Yuga Labs / BAYC asset or ApeCoin. Pure and synchronous: callers pass the approval policy and
 * floor prices in, so it is fully unit tested. The same verdict is recomputed in wc-sign right before
 * signing, so a request cannot reach the key without passing this check.
 */

export type ProtectedAction =
  | 'approval-all'
  | 'approve'
  | 'permit'
  | 'permit2'
  | 'transfer'
  | 'listing'
  | 'unknown-call'
  | 'unknown-signature'
  | 'revoke';

export type ProtectedFinding = {
  asset: ProtectedAsset;
  action: ProtectedAction;
  /** Operator / spender / recipient that gains the asset or the right to take it. */
  counterparty: string | null;
  tokenIds: string[];
  detail: string;
};

export type ProtectedVerdict = {
  /** True when the request touches a protected asset or is a blind signature. */
  protected: boolean;
  blind: boolean;
  findings: ProtectedFinding[];
  /** Hard-block: no confirm button is offered and wc-sign refuses to sign. */
  blocked: boolean;
  blockReasons: string[];
  /** Typed phrase required before the re-auth step. */
  confirmPhrase: string;
  headline: string;
  lines: string[];
  /** Stable id of the exact request. The UI passes it back as the clearance after re-auth. */
  fingerprint: string;
};

export type GuardInput = {
  method: string;
  params: unknown[];
  chainId: number;
  owner: string;
  /** True when the user turned on "allow approvals" for this collection in the last 10 minutes. */
  approvalsAllowed: (assetKey: string) => boolean;
  /** Collection floor in wei (ETH), or null when unknown. */
  floorWei: (assetKey: string) => bigint | null;
};

export const BLIND_CONFIRM_PHRASE = 'I UNDERSTAND';

// Payment tokens counted as ETH-equivalent when pricing a listing.
const ETH_EQUIVALENT: ReadonlySet<string> = new Set([
  ZeroAddress.toLowerCase(),
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH (Ethereum)
  '0x0000000000a39bb272e79075ade125fd351887ac', // Blur Pool
]);

/**
 * ETH-equivalent payment only counts on Ethereum. On ApeChain the zero address means native APE, which is worth a
 * tiny fraction of ETH, so a "10 native" listing there must never pass the ETH floor check: it is treated as a
 * currency the wallet cannot price (blocked).
 */
function ethEquivalent(ctx: { chainId: number }, token: string): boolean {
  return ctx.chainId === 1 && ETH_EQUIVALENT.has(token.toLowerCase());
}

const CALL_IFACE = new Interface([
  'function setApprovalForAll(address operator, bool approved)',
  'function approve(address spender, uint256 amountOrId)',
  'function increaseAllowance(address spender, uint256 addedValue)',
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  'function transfer(address to, uint256 amount)',
  'function transferFrom(address from, address to, uint256 idOrAmount)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)',
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
  'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)',
  // CryptoPunks market
  'function transferPunk(address to, uint256 punkIndex)',
  'function offerPunkForSale(uint256 punkIndex, uint256 minSalePriceInWei)',
  'function offerPunkForSaleToAddress(uint256 punkIndex, uint256 minSalePriceInWei, address toAddress)',
  'function acceptBidForPunk(uint256 punkIndex, uint256 minPrice)',
]);

const PERMIT2_IFACE = new Interface([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
  'function transferFrom(address from, address to, uint160 amount, address token)',
]);

const MULTI_IFACE = new Interface([
  'function multicall(bytes[] data)',
  'function multicall(uint256 deadline, bytes[] data)',
  'function aggregate((address target, bytes callData)[] calls)',
  'function tryAggregate(bool requireSuccess, (address target, bytes callData)[] calls)',
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls)',
  'function aggregate3Value((address target, bool allowFailure, uint256 value, bytes callData)[] calls)',
]);

const SEAPORT_ORDER =
  '(address offerer, address zone, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount)[] offer, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount, address recipient)[] consideration, uint8 orderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 conduitKey, uint256 totalOriginalConsiderationItems)';
const SEAPORT_IFACE = new Interface([`function validate((${SEAPORT_ORDER} parameters, bytes signature)[] orders)`]);

export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

function checksum(value: unknown): string | null {
  return typeof value === 'string' && isAddress(value) ? getAddress(value) : null;
}

function toBig(value: unknown): bigint | null {
  try {
    if (typeof value === 'bigint') {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }
    if (typeof value === 'string' && value.trim()) {
      return BigInt(value.trim());
    }
  } catch {
    return null;
  }
  return null;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));
}

export function requestFingerprint(method: string, params: unknown[]): string {
  return id(`${method}|${stableJson(params)}`);
}

// ---------------------------------------------------------------------------------------------
// Calldata
// ---------------------------------------------------------------------------------------------

type Ctx = GuardInput & {
  findings: ProtectedFinding[];
  blockReasons: string[];
  ownerChecksum: string | null;
  blindNotes: string[];
};

function push(ctx: Ctx, finding: ProtectedFinding): void {
  ctx.findings.push(finding);
}

function isOwner(ctx: Ctx, address: string | null): boolean {
  return Boolean(address && ctx.ownerChecksum && address === ctx.ownerChecksum);
}

function formatNative(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, '0').slice(0, 4).replace(/0+$/, '');
  return `${whole}${frac ? `.${frac}` : ''}`;
}

function eth(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, '0').slice(0, 4).replace(/0+$/, '');
  return `${whole}${frac ? `.${frac}` : ''} ETH`;
}

/** Hard-block a sale of protected NFTs that pays 0, an unknown currency, or under half of the floor. */
function checkSalePrice(
  ctx: Ctx,
  assets: { asset: ProtectedAsset; count: bigint }[],
  proceedsWei: bigint | null,
  venue: string,
): void {
  const names = [...new Set(assets.map((entry) => entry.asset.name))].join(', ');
  if (proceedsWei === null) {
    ctx.blockReasons.push(
      `${venue} would sell your ${names} for a currency the wallet cannot price (or the price is hidden). Blocked. List it for ETH or WETH instead.`,
    );
    return;
  }
  if (proceedsWei === 0n) {
    ctx.blockReasons.push(`${venue} would give away your ${names} for 0. This is how ape thefts happen. Blocked.`);
    return;
  }
  let floorTotal = 0n;
  for (const entry of assets) {
    const floor = ctx.floorWei(entry.asset.key);
    if (floor === null || floor <= 0n) {
      ctx.blockReasons.push(
        `${venue} would sell your ${entry.asset.name}, but the floor price could not be checked right now. Blocked to be safe. Try again in a minute.`,
      );
      return;
    }
    floorTotal += floor * (entry.count > 0n ? entry.count : 1n);
  }
  if (proceedsWei * 2n < floorTotal) {
    ctx.blockReasons.push(
      `${venue} would sell your ${names} for ${eth(proceedsWei)}, under half of the floor (${eth(floorTotal)}). Blocked.`,
    );
  }
}

function decodeCall(ctx: Ctx, to: string | null, data: string, depth: number): void {
  if (depth > 3 || !data || data.length < 10) {
    return;
  }
  // Multicall wrappers: recurse into every inner call.
  try {
    const multi = MULTI_IFACE.parseTransaction({ data });
    if (multi) {
      if (multi.name === 'multicall') {
        const inner = (multi.args.length === 2 ? multi.args[1] : multi.args[0]) as string[];
        for (const call of inner) {
          decodeCall(ctx, to, call, depth + 1);
        }
      } else {
        const calls = (multi.name === 'tryAggregate' ? multi.args[1] : multi.args[0]) as unknown as {
          target: string;
          callData: string;
        }[];
        for (const call of calls) {
          decodeCall(ctx, checksum(call.target), call.callData, depth + 1);
        }
      }
      return;
    }
  } catch {
    // Not a multicall.
  }

  // Permit2 contract calls name the token in their arguments.
  if (to && to === getAddress(PERMIT2_ADDRESS)) {
    try {
      const parsed = PERMIT2_IFACE.parseTransaction({ data });
      if (parsed?.name === 'approve') {
        const asset = protectedAssetFor(ctx.chainId, parsed.args[0] as string);
        const amount = BigInt(parsed.args[2]);
        if (asset && amount > 0n) {
          push(ctx, {
            asset,
            action: 'permit2',
            counterparty: checksum(parsed.args[1]),
            tokenIds: [],
            detail: `Permit2 approval for ${asset.name}.`,
          });
        }
        return;
      }
      if (parsed?.name === 'transferFrom') {
        const asset = protectedAssetFor(ctx.chainId, parsed.args[3] as string);
        if (asset) {
          push(ctx, { asset, action: 'transfer', counterparty: checksum(parsed.args[1]), tokenIds: [], detail: `Permit2 moves your ${asset.name}.` });
        }
        return;
      }
    } catch {
      // Fall through.
    }
  }

  // Seaport validate(): lists orders on-chain.
  try {
    const seaport = SEAPORT_IFACE.parseTransaction({ data });
    if (seaport) {
      const orders = seaport.args[0] as unknown as { parameters: Record<string, unknown> }[];
      for (const order of orders) {
        analyzeSeaportOrder(ctx, order.parameters, 'Seaport listing');
      }
      return;
    }
  } catch {
    // Not Seaport.
  }

  const asset = protectedAssetFor(ctx.chainId, to);
  if (!asset) {
    return;
  }
  let parsed;
  try {
    parsed = CALL_IFACE.parseTransaction({ data });
  } catch {
    parsed = null;
  }
  if (!parsed) {
    push(ctx, {
      asset,
      action: 'unknown-call',
      counterparty: null,
      tokenIds: [],
      detail: `Unknown call to the ${asset.name} contract. The wallet cannot read what it does.`,
    });
    return;
  }
  const args = parsed.args;
  switch (parsed.name) {
    case 'setApprovalForAll': {
      const operator = checksum(args[0]);
      if (args[1]) {
        push(ctx, { asset, action: 'approval-all', counterparty: operator, tokenIds: [], detail: `Lets ${operator ?? 'an unknown address'} take ALL your ${asset.name}.` });
      } else {
        push(ctx, { asset, action: 'revoke', counterparty: operator, tokenIds: [], detail: 'Revokes an operator.' });
      }
      return;
    }
    case 'approve': {
      const spender = checksum(args[0]);
      const value = BigInt(args[1]);
      const revoke = asset.standard === 'ERC-20' ? value === 0n : spender === ZeroAddress;
      if (revoke) {
        push(ctx, { asset, action: 'revoke', counterparty: spender, tokenIds: [], detail: 'Revokes an approval.' });
        return;
      }
      push(ctx, {
        asset,
        action: 'approve',
        counterparty: spender,
        tokenIds: asset.standard === 'ERC-20' ? [] : [value.toString()],
        detail:
          asset.standard === 'ERC-20'
            ? `Lets ${spender ?? 'an unknown address'} spend your ${asset.name}.`
            : `Lets ${spender ?? 'an unknown address'} take ${asset.name} #${value.toString()}.`,
      });
      return;
    }
    case 'increaseAllowance':
    case 'permit': {
      const spender = checksum(parsed.name === 'permit' ? args[1] : args[0]);
      push(ctx, { asset, action: parsed.name === 'permit' ? 'permit' : 'approve', counterparty: spender, tokenIds: [], detail: `Lets ${spender ?? 'an unknown address'} spend your ${asset.name}.` });
      return;
    }
    case 'transfer':
    case 'transferPunk': {
      const recipient = checksum(args[0]);
      push(ctx, { asset, action: 'transfer', counterparty: recipient, tokenIds: parsed.name === 'transferPunk' ? [args[1].toString()] : [], detail: `Sends your ${asset.name} to ${recipient ?? 'an unknown address'}.` });
      return;
    }
    case 'transferFrom':
    case 'safeTransferFrom': {
      const recipient = checksum(args[1]);
      push(ctx, { asset, action: 'transfer', counterparty: recipient, tokenIds: asset.standard === 'ERC-20' ? [] : [args[2].toString()], detail: `Moves ${asset.name} to ${recipient ?? 'an unknown address'}.` });
      return;
    }
    case 'safeBatchTransferFrom': {
      const recipient = checksum(args[1]);
      const ids = (args[2] as bigint[]).map((item) => item.toString());
      push(ctx, { asset, action: 'transfer', counterparty: recipient, tokenIds: ids, detail: `Moves ${ids.length} ${asset.name} item(s) to ${recipient ?? 'an unknown address'}.` });
      return;
    }
    case 'offerPunkForSale':
    case 'offerPunkForSaleToAddress':
    case 'acceptBidForPunk': {
      const tokenId = args[0].toString();
      const price = BigInt(args[1]);
      const buyer = parsed.name === 'offerPunkForSaleToAddress' ? checksum(args[2]) : null;
      push(ctx, { asset, action: 'listing', counterparty: buyer, tokenIds: [tokenId], detail: `Sells ${asset.name} #${tokenId} for ${eth(price)}.` });
      checkSalePrice(ctx, [{ asset, count: 1n }], price, 'CryptoPunks market');
      return;
    }
    default:
      return;
  }
}

// ---------------------------------------------------------------------------------------------
// Typed data (Seaport, Blur, LooksRare, Permit, Permit2)
// ---------------------------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function asRec(value: unknown): Rec {
  return value && typeof value === 'object' ? (value as Rec) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function analyzeSeaportOrder(ctx: Ctx, raw: unknown, venue: string): void {
  const order = asRec(raw);
  const offerer = checksum(order.offerer);
  if (ctx.ownerChecksum && offerer && offerer !== ctx.ownerChecksum) {
    return; // Not your order: signing it cannot move your assets.
  }
  const sold: { asset: ProtectedAsset; count: bigint }[] = [];
  const ids: string[] = [];
  for (const itemRaw of asArray(order.offer)) {
    const item = asRec(itemRaw);
    const asset = protectedAssetFor(ctx.chainId, item.token as string);
    if (!asset) {
      continue;
    }
    const itemType = Number(item.itemType);
    if (asset.standard === 'ERC-20') {
      push(ctx, { asset, action: 'transfer', counterparty: null, tokenIds: [], detail: `${venue} offer spends your ${asset.name}.` });
      continue;
    }
    const amount = toBig(item.startAmount) ?? 1n;
    const criteria = itemType === 4 || itemType === 5;
    sold.push({ asset, count: itemType === 3 || itemType === 5 ? amount : 1n });
    ids.push(criteria ? 'any' : String(item.identifierOrCriteria ?? '?'));
  }
  if (!sold.length) {
    return;
  }
  let proceeds: bigint | null = 0n;
  for (const itemRaw of asArray(order.consideration)) {
    const item = asRec(itemRaw);
    const recipient = checksum(item.recipient);
    if (!recipient || (offerer ? recipient !== offerer : !isOwner(ctx, recipient))) {
      continue;
    }
    const itemType = Number(item.itemType);
    const token = String(item.token ?? ZeroAddress).toLowerCase();
    const start = toBig(item.startAmount) ?? 0n;
    const end = toBig(item.endAmount) ?? start;
    const amount = start < end ? start : end;
    if ((itemType === 0 || itemType === 1) && ethEquivalent(ctx, token)) {
      proceeds = proceeds === null ? null : proceeds + amount;
    } else if (amount > 0n) {
      proceeds = null; // Paid in something the wallet cannot price.
    }
  }
  for (const entry of sold) {
    push(ctx, { asset: entry.asset, action: 'listing', counterparty: null, tokenIds: ids, detail: `${venue}: sells your ${entry.asset.name}.` });
  }
  checkSalePrice(ctx, sold, proceeds, venue);
}

function flattenBulkTree(value: unknown, out: unknown[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      flattenBulkTree(item, out);
    }
    return;
  }
  if (value && typeof value === 'object' && 'offer' in (value as Rec)) {
    out.push(value);
  }
}

function analyzeTypedData(ctx: Ctx, payload: unknown, rawText: string): boolean {
  const data = asRec(payload);
  const domain = asRec(data.domain);
  const message = asRec(data.message);
  const primary = String(data.primaryType ?? '');
  const domainName = String(domain.name ?? '').toLowerCase();
  const verifying = checksum(domain.verifyingContract);
  const before = ctx.findings.length + ctx.blockReasons.length;

  if (domainName === 'seaport' || primary === 'OrderComponents' || primary === 'BulkOrder') {
    if (primary === 'BulkOrder') {
      const orders: unknown[] = [];
      flattenBulkTree(message.tree, orders);
      for (const order of orders) {
        analyzeSeaportOrder(ctx, order, 'Seaport bulk listing');
      }
    } else {
      analyzeSeaportOrder(ctx, message, 'Seaport listing');
    }
    return true;
  }

  if (domainName.includes('blur')) {
    const collection = protectedAssetFor(ctx.chainId, message.collection as string);
    const trader = checksum(message.trader);
    const isOwnOrder = !trader || !ctx.ownerChecksum || trader === ctx.ownerChecksum;
    if (primary === 'Root') {
      // Bulk listing: only a merkle root is signed, so the NFTs and prices are invisible.
      ctx.blindNotes.push('Blur bulk listing signs a hidden list of NFTs and prices. The wallet cannot see what is listed.');
      return true;
    }
    if (collection && isOwnOrder && collection.standard !== 'ERC-20') {
      const side = Number(message.side ?? message.orderType ?? 1);
      const hiddenPrice = 'listingsRoot' in message || message.price === undefined;
      if (side === 1 || hiddenPrice) {
        push(ctx, { asset: collection, action: 'listing', counterparty: null, tokenIds: [String(message.tokenId ?? 'any')], detail: `Blur: sells your ${collection.name}.` });
        if (hiddenPrice) {
          checkSalePrice(ctx, [{ asset: collection, count: 1n }], null, 'Blur listing');
        } else {
          const price = toBig(message.price) ?? 0n;
          const feeRate = asArray(message.fees).reduce<bigint>((sum, fee) => sum + (toBig(asRec(fee).rate) ?? 0n), 0n);
          const token = String(message.paymentToken ?? ZeroAddress).toLowerCase();
          const net = ethEquivalent(ctx, token) ? (price * (10000n - (feeRate > 10000n ? 10000n : feeRate))) / 10000n : null;
          checkSalePrice(ctx, [{ asset: collection, count: toBig(message.amount) ?? 1n }], net, 'Blur listing');
        }
      }
    }
    return ctx.findings.length + ctx.blockReasons.length > before || collection !== null;
  }

  if (domainName.includes('looksrare') && primary === 'Maker') {
    const collection = protectedAssetFor(ctx.chainId, message.collection as string);
    if (collection && collection.standard !== 'ERC-20' && Number(message.quoteType) === 1) {
      const ids = asArray(message.itemIds).map(String);
      const count = asArray(message.amounts).reduce<bigint>((sum, item) => sum + (toBig(item) ?? 1n), 0n) || 1n;
      push(ctx, { asset: collection, action: 'listing', counterparty: null, tokenIds: ids, detail: `LooksRare: sells your ${collection.name}.` });
      const token = String(message.currency ?? ZeroAddress).toLowerCase();
      checkSalePrice(ctx, [{ asset: collection, count }], ethEquivalent(ctx, token) ? toBig(message.price) ?? 0n : null, 'LooksRare listing');
    }
    return true;
  }

  if (domainName === 'permit2') {
    const tokens: { token: unknown; amount: unknown }[] = [];
    const details = message.details;
    if (Array.isArray(details)) {
      for (const item of details) {
        tokens.push({ token: asRec(item).token, amount: asRec(item).amount });
      }
    } else if (details) {
      tokens.push({ token: asRec(details).token, amount: asRec(details).amount });
    }
    const permitted = message.permitted;
    for (const item of Array.isArray(permitted) ? permitted : permitted ? [permitted] : []) {
      tokens.push({ token: asRec(item).token, amount: asRec(item).amount });
    }
    const spender = checksum(message.spender);
    for (const entry of tokens) {
      const asset = protectedAssetFor(ctx.chainId, entry.token as string);
      if (asset) {
        push(ctx, { asset, action: 'permit2', counterparty: spender, tokenIds: [], detail: `Permit2 signature lets ${spender ?? 'a spender'} take your ${asset.name}.` });
      }
    }
    return true;
  }

  // ERC-2612 / ERC-4494 permit: the token is the verifying contract.
  const asset = protectedAssetFor(ctx.chainId, verifying);
  if (asset && (primary.toLowerCase().includes('permit') || 'spender' in message || 'operator' in message)) {
    const spender = checksum(message.spender ?? message.operator);
    const value = toBig(message.value ?? message.amount);
    if (value === 0n && asset.standard === 'ERC-20') {
      push(ctx, { asset, action: 'revoke', counterparty: spender, tokenIds: [], detail: 'Revokes an allowance.' });
    } else {
      push(ctx, { asset, action: 'permit', counterparty: spender, tokenIds: message.tokenId !== undefined ? [String(message.tokenId)] : [], detail: `Signature lets ${spender ?? 'a spender'} take your ${asset.name}.` });
    }
    return true;
  }

  // Anything else that names a protected contract is treated as an unreadable signature over it.
  const lower = rawText.toLowerCase();
  for (const address of PROTECTED_ADDRESSES_LOWER) {
    if (lower.includes(address)) {
      const hit = protectedAssetFor(ctx.chainId, address) ?? protectedAssetFor(1, address) ?? protectedAssetFor(42161, address) ?? protectedAssetFor(56, address);
      if (hit) {
        push(ctx, { asset: hit, action: 'unknown-signature', counterparty: verifying, tokenIds: [], detail: `Unreadable signature that mentions ${hit.name}.` });
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

function isBlindPersonalMessage(params: unknown[]): boolean {
  const candidate = params.find((item) => typeof item === 'string' && !isAddress(item)) as string | undefined;
  if (!candidate || !/^0x[0-9a-fA-F]*$/.test(candidate)) {
    return false;
  }
  const hex = candidate.slice(2);
  if (hex.length === 64) {
    return true; // A raw 32-byte hash: could be a transaction or an order.
  }
  for (let index = 0; index + 2 <= hex.length; index += 2) {
    const byte = parseInt(hex.slice(index, index + 2), 16);
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20) || byte === 0x7f) {
      return true;
    }
  }
  return false;
}

const APPROVAL_ACTIONS: ReadonlySet<ProtectedAction> = new Set(['approval-all', 'approve', 'permit', 'permit2']);

export function analyzeProtectedRequest(input: GuardInput): ProtectedVerdict {
  const ctx: Ctx = {
    ...input,
    findings: [],
    blockReasons: [],
    ownerChecksum: checksum(input.owner),
    blindNotes: [],
  };
  const { method, params } = input;
  let blind = false;

  if (method === 'eth_sendTransaction' || method === 'eth_signTransaction') {
    const tx = asRec(params[0]);
    decodeCall(ctx, checksum(tx.to), typeof tx.data === 'string' ? tx.data : typeof tx.input === 'string' ? tx.input : '', 0);
    // Native APE on ApeChain: any transaction that carries APE value is a protected move (send, swap, bridge, dApp).
    const nativeAsset = protectedNativeFor(input.chainId);
    const value = toBig(tx.value);
    if (nativeAsset && value !== null && value > 0n) {
      const recipient = checksum(tx.to);
      push(ctx, {
        asset: nativeAsset,
        action: 'transfer',
        counterparty: recipient,
        tokenIds: [],
        detail: `Sends ${formatNative(value)} APE to ${recipient ?? 'a new contract'}.`,
      });
    }
  } else if (method === 'eth_sign') {
    blind = true;
  } else if (method === 'personal_sign') {
    blind = isBlindPersonalMessage(params);
  } else if (method.startsWith('eth_signTypedData')) {
    const raw = params.find((item) => typeof item === 'string' && item.trim().startsWith('{')) ?? params.find((item) => item && typeof item === 'object' && !Array.isArray(item));
    const text = typeof raw === 'string' ? raw : stableJson(raw ?? null);
    let payload: unknown = null;
    try {
      payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      payload = null;
    }
    if (payload) {
      analyzeTypedData(ctx, payload, text);
    } else {
      blind = true;
    }
  }

  const active = ctx.findings.filter((item) => item.action !== 'revoke');
  if (active.some((item) => item.action === 'unknown-signature') || ctx.blindNotes.length > 0) {
    blind = true;
  }

  // Approvals are blocked by default. The user must open Protected collections and allow them for 10 minutes.
  for (const finding of active) {
    if (APPROVAL_ACTIONS.has(finding.action) && !input.approvalsAllowed(finding.asset.key)) {
      ctx.blockReasons.push(
        `Approvals for ${finding.asset.name} are turned off. To approve ${finding.counterparty ?? 'this spender'}, go to Settings → Protected collections and allow approvals for ${finding.asset.name} (it turns itself off after 10 minutes). Only do this if you started this action yourself.`,
      );
    }
  }

  const isProtected = active.length > 0 || blind;
  const first = active[0];
  const confirmPhrase = first ? first.asset.name : BLIND_CONFIRM_PHRASE;
  const spender = first?.counterparty ?? null;
  const approvalAll = active.find((item) => item.action === 'approval-all');
  const headline = !isProtected
    ? ''
    : approvalAll
      ? `${approvalAll.asset.name}: this lets ${approvalAll.counterparty ?? 'them'} take ALL your apes`
      : first?.action === 'listing'
        ? `${first.asset.name}: this lists your NFT for sale`
        : first && APPROVAL_ACTIONS.has(first.action)
          ? `${first.asset.name}: this lets ${spender ?? 'them'} take your ${first.asset.standard === 'ERC-20' ? 'ApeCoin' : 'apes'}`
          : first?.action === 'transfer'
            ? `${first.asset.name}: this moves your asset out of the wallet`
            : 'Blind signature: the wallet cannot read what you are signing';
  const lines: string[] = [];
  if (isProtected) {
    if (approvalAll) {
      lines.push(`This lets ${approvalAll.counterparty ?? 'an unknown address'} take ALL your ${approvalAll.asset.name} at any time, now or later, without asking again.`);
    }
    for (const finding of active) {
      lines.push(finding.detail);
    }
    lines.push(...ctx.blindNotes);
    if (blind) {
      lines.push('A blind signature can approve or sell every ape in this wallet. Scammers use this. Reject unless you are certain.');
    }
    lines.push('Scam sites copy real marketplaces. If you did not start this yourself, tap Reject.');
  }

  return {
    protected: isProtected,
    blind,
    findings: ctx.findings,
    blocked: ctx.blockReasons.length > 0,
    blockReasons: ctx.blockReasons,
    confirmPhrase,
    headline,
    lines,
    fingerprint: requestFingerprint(method, params),
  };
}

/** Case-, spacing- and punctuation-insensitive check of the typed confirm phrase. */
export function confirmPhraseMatches(typed: string, phrase: string): boolean {
  const fold = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return fold(typed).length > 0 && fold(typed) === fold(phrase);
}

/** Final gate used right before signing. Throws when the request must not be signed. */
export function assertProtectedClearance(verdict: ProtectedVerdict, clearance: string | null | undefined): void {
  if (verdict.blocked) {
    throw new Error(verdict.blockReasons[0] ?? 'Blocked to protect your Yuga Labs assets.');
  }
  if (verdict.protected && clearance !== verdict.fingerprint) {
    throw new Error('This touches a protected asset (Yuga Labs / BAYC / ApeCoin / Yaper). Confirm it in the red warning and re-enter your PIN or biometrics first.');
  }
}

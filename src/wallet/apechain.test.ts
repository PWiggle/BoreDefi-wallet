import assert from 'node:assert/strict';
import test from 'node:test';

import { Interface, parseEther, ZeroAddress } from 'ethers';

import { CHAINS, CHAIN_LIST, isChainId, parseChainId } from './chains';
import { classifyBrowserMethod } from './dapps';
import { geckoIdForNative, geckoIdForToken } from './markets';
import { analyzeProtectedRequest, assertProtectedClearance, type GuardInput } from './protected-guard';
import { protectedApproveRequest, protectedTokenAsset, protectedTransferRequest } from './protected-spend';
import { buildApprovalProbes } from './protected-approvals';
import { isWrapPair, WRAPPED_NATIVE } from './swap-guard';
import { tokensForChain } from './tokens';
import { parseSwitchChainId, WALLETCONNECT_METHODS } from './wc';
import { protectedAssetFor, protectedNativeFor } from './yuga-allowlist';

// ApeChain facts, checked on Nov 3, 2026: eth_chainId 0x8173 on every RPC below, WAPE in docs.apechain.com,
// Shadow collections read on-chain (name/symbol, ERC-721, shared owner(), same deployers as Ethereum).
const APECHAIN = 33139;
const WAPE = '0x48b62137EdfA95a428D35C09E44256a739F6B557';
const BAYC = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';
const OTHERDEED_EXP_SHADOW = '0x000DeeD0005b8b7d8d87BAcA43AAD032A292155E';
const OWNER = '0x1111111111111111111111111111111111111111';
const FRIEND = '0x2222222222222222222222222222222222222222';
const LIFI_APECHAIN = '0x2dea447e7dc6cd2f10b31bF10dCB30F87E838417';

const IFACE = new Interface([
  'function setApprovalForAll(address operator, bool approved)',
  'function approve(address spender, uint256 amount)',
  'function transfer(address to, uint256 amount)',
]);

function guard(chainId: number, method: string, params: unknown[]): GuardInput {
  return { method, params, chainId, owner: OWNER, approvalsAllowed: () => false, floorWei: () => parseEther('10') };
}

test('ApeChain is a supported chain: id 33139 (0x8173), APE 18 decimals, ApeScan, RPC fallback list', () => {
  assert.equal(isChainId(APECHAIN), true);
  assert.equal(parseChainId('33139'), APECHAIN);
  const chain = CHAINS[APECHAIN];
  assert.equal(chain.name, 'ApeChain');
  assert.equal(chain.symbol, 'APE');
  assert.equal(chain.decimals, 18);
  assert.equal(chain.rpcUrls[0], 'https://rpc.apechain.com');
  assert.ok(chain.rpcUrls.length >= 3, 'has fallbacks');
  assert.equal(chain.explorerTx, 'https://apescan.io/tx/');
  assert.equal(chain.nftApi, 'https://apechain.calderaexplorer.xyz/api/v2');
  assert.ok(CHAIN_LIST.some((item) => item.id === APECHAIN));
});

test('ApeChain tokens: native APE + WAPE/ApeUSD/WETH/USDT, every one priced; APE↔WAPE is a wrap pair', () => {
  const tokens = tokensForChain(APECHAIN);
  assert.equal(tokens[0]?.native, true);
  assert.equal(tokens[0]?.symbol, 'APE');
  assert.equal(geckoIdForNative(APECHAIN), 'apecoin');
  const wape = tokens.find((item) => item.symbol === 'WAPE');
  assert.equal(wape?.address, WAPE);
  assert.equal(geckoIdForToken(wape!), 'wrapped-apecoin');
  assert.equal(geckoIdForToken(tokens.find((item) => item.symbol === 'ApeUSD')!), 'apeusd');
  assert.equal(WRAPPED_NATIVE[APECHAIN], WAPE);
  assert.equal(isWrapPair(APECHAIN, tokens[0]!, wape!), true);
});

test('dApp browser: wallet_addEthereumChain / wallet_switchEthereumChain for 0x8173 switch to ApeChain', () => {
  assert.equal(classifyBrowserMethod('wallet_addEthereumChain'), 'switch');
  const addParams = [{ chainId: '0x8173', chainName: 'ApeChain', nativeCurrency: { name: 'ApeCoin', symbol: 'APE', decimals: 18 }, rpcUrls: ['https://evil.example'] }];
  assert.equal(parseSwitchChainId(addParams), APECHAIN);
  assert.equal(parseSwitchChainId([{ chainId: '0x8173' }]), APECHAIN);
  // Unknown chains are still refused.
  assert.equal(parseSwitchChainId([{ chainId: '0x1234567' }]), null);
  assert.ok((WALLETCONNECT_METHODS as readonly string[]).includes('wallet_addEthereumChain'));
});

test('Yuga Shadow collections are protected on ApeChain only; Ethereum entries are unchanged', () => {
  assert.equal(protectedAssetFor(1, BAYC)?.key, 'bayc');
  assert.equal(protectedAssetFor(APECHAIN, BAYC)?.key, 'bayc-apechain');
  assert.equal(protectedAssetFor(APECHAIN, OTHERDEED_EXP_SHADOW)?.key, 'otherdeed-expanded-apechain');
  assert.equal(protectedAssetFor(1, OTHERDEED_EXP_SHADOW), null);
  assert.equal(protectedAssetFor(APECHAIN, WAPE)?.key, 'wape-apechain');
  // Unverified Yuga collections (e.g. Sewer Pass, BACC) are NOT assumed to exist on ApeChain.
  assert.equal(protectedAssetFor(APECHAIN, '0x764AeebcF425d56800eF2c84F2578689415a2DAa'), null);
});

test('setApprovalForAll on a Shadow BAYC (ApeChain) is blocked by default, like on Ethereum', () => {
  const data = IFACE.encodeFunctionData('setApprovalForAll', [FRIEND, true]);
  const verdict = analyzeProtectedRequest(guard(APECHAIN, 'eth_sendTransaction', [{ from: OWNER, to: BAYC, data }]));
  assert.equal(verdict.protected, true);
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.findings[0]?.asset.key, 'bayc-apechain');
});

test('WAPE approve on ApeChain is blocked until approvals are allowed; transfer needs typed name + PIN', () => {
  const approve = analyzeProtectedRequest(guard(APECHAIN, 'eth_sendTransaction', [{ from: OWNER, to: WAPE, data: IFACE.encodeFunctionData('approve', [FRIEND, 1n]) }]));
  assert.equal(approve.blocked, true);
  const send = analyzeProtectedRequest(guard(APECHAIN, 'eth_sendTransaction', [{ from: OWNER, to: WAPE, data: IFACE.encodeFunctionData('transfer', [FRIEND, 1n]) }]));
  assert.equal(send.protected, true);
  assert.equal(send.blocked, false);
  assert.equal(send.confirmPhrase, 'Wrapped ApeCoin (ApeChain)');
  assert.throws(() => assertProtectedClearance(send, null));
  assert.doesNotThrow(() => assertProtectedClearance(send, send.fingerprint));
});

test('native APE on ApeChain is top-tier protected: any APE-carrying transaction needs the typed name + PIN', () => {
  const nativeApe = tokensForChain(APECHAIN)[0]!;
  const asset = protectedTokenAsset(nativeApe);
  assert.equal(asset?.key, 'ape-apechain-native');
  assert.equal(protectedNativeFor(APECHAIN)?.key, 'ape-apechain-native');

  // In-app Send of native APE.
  const sendReq = protectedTransferRequest(nativeApe, OWNER, FRIEND, parseEther('5'));
  assert.equal((sendReq.params[0] as { data: string }).data, '0x');
  const send = analyzeProtectedRequest({ ...guard(APECHAIN, sendReq.method, sendReq.params) });
  assert.equal(send.protected, true);
  assert.equal(send.blocked, false);
  assert.equal(send.confirmPhrase, 'ApeCoin (ApeChain)');
  assert.match(send.lines.join(' '), /Sends 5 APE/);

  // In-app Swap/Bridge from native APE: the value goes to the LI.FI router.
  const swapReq = protectedApproveRequest(nativeApe, OWNER, LIFI_APECHAIN, parseEther('2'));
  const swap = analyzeProtectedRequest(guard(APECHAIN, swapReq.method, swapReq.params));
  assert.equal(swap.protected, true);
  assert.equal(swap.findings[0]?.counterparty, LIFI_APECHAIN);

  // dApp transaction carrying APE value.
  const dapp = analyzeProtectedRequest(guard(APECHAIN, 'eth_sendTransaction', [{ from: OWNER, to: FRIEND, value: '0x1', data: '0x' }]));
  assert.equal(dapp.protected, true);

  // Zero-value calls and native coins on other chains are not affected.
  assert.equal(analyzeProtectedRequest(guard(APECHAIN, 'eth_sendTransaction', [{ from: OWNER, to: FRIEND, value: '0x0', data: '0x' }])).protected, false);
  assert.equal(analyzeProtectedRequest(guard(1, 'eth_sendTransaction', [{ from: OWNER, to: FRIEND, value: '0x1', data: '0x' }])).protected, false);
  assert.equal(protectedTokenAsset(tokensForChain(1)[0]!), null);
});

test('a Shadow BAYC Seaport listing on ApeChain paid in native APE is NOT priced as ETH (blocked)', () => {
  const order = JSON.stringify({
    domain: { name: 'Seaport', version: '1.6', chainId: APECHAIN, verifyingContract: '0x0000000000000068F116a894984e2DB1123eB395' },
    primaryType: 'OrderComponents',
    types: {},
    message: {
      offerer: OWNER,
      offer: [{ itemType: 2, token: BAYC, identifierOrCriteria: '5', startAmount: '1', endAmount: '1' }],
      consideration: [{ itemType: 0, token: ZeroAddress, identifierOrCriteria: '0', startAmount: parseEther('20').toString(), endAmount: parseEther('20').toString(), recipient: OWNER }],
    },
  });
  // 20 native = 20 APE (a few dollars). On Ethereum this amount would clear a 10 ETH floor; on ApeChain it must not.
  const verdict = analyzeProtectedRequest(guard(APECHAIN, 'eth_signTypedData_v4', [OWNER, order]));
  assert.equal(verdict.protected, true);
  assert.equal(verdict.blocked, true);
});

test('protected approval scan probes ApeChain Shadow collections and WAPE with known operators incl. LI.FI', () => {
  const probes = buildApprovalProbes(OWNER, APECHAIN, new Map());
  const keys = new Set(probes.map((item) => item.asset.key));
  for (const key of ['bayc-apechain', 'mayc-apechain', 'bakc-apechain', 'koda-apechain', 'otherdeed-expanded-apechain', 'punks-apechain', 'wape-apechain']) {
    assert.ok(keys.has(key), key);
  }
  assert.ok(probes.some((item) => item.spender === LIFI_APECHAIN));
  assert.equal(probes.some((item) => item.asset.key === 'ape-apechain-native'), false);
});

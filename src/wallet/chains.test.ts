import assert from 'node:assert/strict';
import test from 'node:test';

import { CHAIN_LIST } from './chains';

const DEAD_HOSTS = [
  'eth.llamarpc.com',
  'polygon-rpc.com',
  'polygon.llamarpc.com',
  'base.llamarpc.com',
];

test('each chain has multiple live public RPC fallbacks', () => {
  for (const chain of CHAIN_LIST) {
    assert.ok(chain.rpcUrls.length >= 2, `${chain.name} needs fallbacks`);
    assert.equal(chain.rpcUrl, chain.rpcUrls[0]);
    for (const url of chain.rpcUrls) {
      const host = new URL(url).host;
      assert.equal(
        DEAD_HOSTS.includes(host),
        false,
        `${chain.name} still points at dead host ${host}`,
      );
    }
  }
});

test('known-good defaults stay first', () => {
  const byName = Object.fromEntries(CHAIN_LIST.map((chain) => [chain.name, chain.rpcUrl]));
  assert.equal(byName.Ethereum, 'https://ethereum-rpc.publicnode.com');
  assert.equal(byName.Polygon, 'https://polygon-bor-rpc.publicnode.com');
  assert.equal(byName.Base, 'https://mainnet.base.org');
  assert.equal(byName['BNB Chain'], 'https://bsc-rpc.publicnode.com');
  assert.ok(byName.Avalanche?.includes('avalanche-c-chain-rpc.publicnode.com'));
  assert.equal(
    CHAIN_LIST.find((chain) => chain.id === 10)?.nftApi,
    'https://explorer.optimism.io/api/v2',
  );
});

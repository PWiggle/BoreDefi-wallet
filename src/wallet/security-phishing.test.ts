import assert from 'node:assert/strict';
import test from 'node:test';

import { checkPhishing, refreshPhishingList } from './security/phishing';

test('official and common dApp sites are never blocked', () => {
  for (const u of ['https://app.uniswap.org', 'opensea.io', 'pro.opensea.io', 'jup.ag', 'https://mevvy.app', 'www.boredefi.com',
    'magiceden.io', 'aave.com', 'lido.fi', 'blur.io', 'etherscan.io', 'phantom.app', 'li.fi', 'jumper.exchange',
    'apecoin.com', 'yuga.com', 'metamask.io', 'portfolio.metamask.io', 'raydium.io', 'solscan.io',
    'uniswap.org', 'uniswapfoundation.org', 'blog.uniswap.org', 'apechain.com', 'docs.apechain.com', 'apescan.io', 'apestake.io',
    'phantom.com', 'help.phantom.app', 'station.jup.ag', 'support.metamask.io', 'yugalabs.io', 'otherside.xyz', 'boredapeyachtclub.com',
    'lilmutantapeclub.com', 'mevvy.app/swap', 'magiceden.us']) {
    assert.equal(checkPhishing(u).blocked, false, u);
  }
});

test('lookalikes, punycode and code links for protected brands are blocked', () => {
  for (const u of ['opensea-claim.xyz', '0pensea.io', 'uniswap-airdrop.com', 'xn--opnsea-9ya.io', 'metamaskk.io', 'phant0m.app',
    'mevvy-rewards.app', 'boredefi-wallet.support', 'jup-ag.claims', 'bayc-mint.net', 'javascript:alert(1)', 'data:text/html,x']) {
    assert.equal(checkPhishing(u).blocked, true, u);
  }
});

test('bundled MetaMask blocklist entries are blocked (subdomains too)', async () => {
  const seed = (await import('./security/phishing-seed.json')).default as { blocklist: string[] };
  const sample = seed.blocklist[0];
  assert.equal(checkPhishing(`https://${sample}/x`).blocked, true);
  assert.equal(checkPhishing(`https://a.b.${sample}`).blocked, true);
});

test('runtime refresh adds domains and never throws', async () => {
  const ok = await refreshPhishingList((async () => ({ ok: true, json: async () => ({ blacklist: ['evil-drainer.example'] }) })) as never);
  assert.equal(ok, true);
  assert.equal(checkPhishing('evil-drainer.example').blocked, true);
  assert.equal(await refreshPhishingList((async () => { throw new Error('offline'); }) as never), false);
});

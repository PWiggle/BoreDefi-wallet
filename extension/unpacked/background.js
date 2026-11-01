import { ethers } from './vendor/ethers.min.js';

const PATH = "m/44'/60'/0'/0/0";
const CHAINS = {
  1: { name: 'Ethereum', rpc: 'https://ethereum-rpc.publicnode.com', symbol: 'ETH' },
  8453: { name: 'Base', rpc: 'https://mainnet.base.org', symbol: 'ETH' },
  42161: { name: 'Arbitrum', rpc: 'https://arbitrum-one-rpc.publicnode.com', symbol: 'ETH' },
  10: { name: 'Optimism', rpc: 'https://optimism-rpc.publicnode.com', symbol: 'ETH' },
  137: { name: 'Polygon', rpc: 'https://polygon-bor-rpc.publicnode.com', symbol: 'POL' },
  56: { name: 'BNB Chain', rpc: 'https://bsc-rpc.publicnode.com', symbol: 'BNB' },
  43114: { name: 'Avalanche', rpc: 'https://avalanche-c-chain-rpc.publicnode.com', symbol: 'AVAX' },
};

let unlockedMnemonic = null;
let unlockedAddress = null;

function wallet() {
  if (!unlockedMnemonic) {
    throw new Error('Unlock the wallet in the BoreDefi popup.');
  }
  return ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(unlockedMnemonic), PATH);
}

function provider(chainId) {
  const chain = CHAINS[chainId] ?? CHAINS[1];
  return new ethers.JsonRpcProvider(chain.rpc, chainId, { staticNetwork: true });
}

function normalizeMnemonic(phrase) {
  return phrase.trim().toLowerCase().split(/[\s,]+/).filter(Boolean).join(' ');
}

function isValidMnemonic(phrase) {
  try {
    ethers.Mnemonic.fromPhrase(normalizeMnemonic(phrase));
    return true;
  } catch {
    return false;
  }
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function deriveKey(pin, saltBytes) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 210000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function bytesToB64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function b64ToBytes(value) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

async function encryptMnemonic(mnemonic, pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(mnemonic));
  return {
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    ciphertext: bytesToB64(new Uint8Array(cipher)),
  };
}

async function decryptMnemonic(vault, pin) {
  const key = await deriveKey(pin, b64ToBytes(vault.salt));
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(vault.iv) },
    key,
    b64ToBytes(vault.ciphertext),
  );
  return new TextDecoder().decode(plain);
}

async function getStore() {
  return chrome.storage.local.get(['vault', 'pin', 'settings']);
}

async function publicState() {
  const store = await getStore();
  const settings = store.settings ?? { chainId: 1 };
  return {
    hasWallet: Boolean(store.vault && store.pin),
    unlocked: Boolean(unlockedMnemonic),
    address: unlockedAddress,
    chainId: settings.chainId,
    chain: CHAINS[settings.chainId] ?? CHAINS[1],
    chains: Object.entries(CHAINS).map(([id, value]) => ({ id: Number(id), ...value })),
  };
}

async function setChain(chainId) {
  if (!CHAINS[chainId]) {
    throw new Error('Unsupported chain.');
  }
  await chrome.storage.local.set({ settings: { chainId } });
}

async function createWallet() {
  const mnemonic = ethers.Mnemonic.fromEntropy(ethers.randomBytes(16)).phrase;
  const address = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(mnemonic), PATH).address;
  return { mnemonic, address };
}

async function persistWallet(mnemonic, pin) {
  if (!/^\d{6}$/.test(pin)) {
    throw new Error('PIN must be 6 digits.');
  }
  const normalized = normalizeMnemonic(mnemonic);
  if (!isValidMnemonic(normalized)) {
    throw new Error('That recovery phrase is not valid BIP39.');
  }
  const address = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(normalized), PATH).address;
  const salt = crypto.randomUUID();
  const vault = await encryptMnemonic(normalized, pin);
  await chrome.storage.local.set({
    vault: { version: 1, address, ...vault },
    pin: { salt, hash: await sha256(`${salt}:${pin}`) },
    settings: { chainId: 1 },
  });
  unlockedMnemonic = normalized;
  unlockedAddress = address;
  return publicState();
}

async function unlock(pin) {
  const store = await getStore();
  if (!store.vault || !store.pin) {
    throw new Error('No wallet on this profile.');
  }
  const hash = await sha256(`${store.pin.salt}:${pin}`);
  if (hash !== store.pin.hash) {
    return { ok: false };
  }
  unlockedMnemonic = await decryptMnemonic(store.vault, pin);
  unlockedAddress = store.vault.address;
  return { ok: true, state: await publicState() };
}

function lock() {
  unlockedMnemonic = null;
  unlockedAddress = null;
}

async function wipe() {
  lock();
  await chrome.storage.local.clear();
}

async function sendNative(to, amountEther) {
  const state = await publicState();
  const signer = wallet().connect(provider(state.chainId));
  const tx = await signer.sendTransaction({
    to,
    value: ethers.parseEther(amountEther),
  });
  return { hash: tx.hash };
}

async function handleProvider(payload) {
  const method = payload?.method;
  const params = payload?.params ?? [];
  const state = await publicState();
  const chainId = state.chainId;
  const hexChain = `0x${chainId.toString(16)}`;

  if (method === 'eth_chainId' || method === 'net_version') {
    return method === 'eth_chainId' ? hexChain : String(chainId);
  }
  if (method === 'eth_accounts') {
    return state.unlocked ? [state.address] : [];
  }
  if (method === 'eth_requestAccounts' || method === 'wallet_requestPermissions') {
    if (!state.unlocked) {
      throw new Error('Unlock BoreDefi Wallet in the extension popup.');
    }
    return method === 'wallet_requestPermissions' ? [{ parentCapability: 'eth_accounts' }] : [state.address];
  }
  if (method === 'wallet_revokePermissions') {
    return null;
  }
  if (method === 'wallet_switchEthereumChain') {
    const raw = params[0]?.chainId;
    const next = raw?.startsWith('0x') ? Number.parseInt(raw, 16) : Number(raw);
    await setChain(next);
    return null;
  }
  if (method === 'personal_sign' || method === 'eth_sign') {
    const message = params.find((item) => typeof item === 'string' && item !== state.address) ?? params[0];
    const text = ethers.isHexString(message) ? ethers.toUtf8String(message) : String(message);
    return wallet().signMessage(text);
  }
  if (method === 'eth_signTypedData' || method === 'eth_signTypedData_v3' || method === 'eth_signTypedData_v4') {
    const raw = params.find((item) => typeof item === 'string' && item.trim().startsWith('{')) ?? params[1];
    const typed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const types = { ...typed.types };
    delete types.EIP712Domain;
    return wallet().signTypedData(typed.domain, types, typed.message);
  }
  if (method === 'eth_sendTransaction') {
    const tx = params[0] ?? {};
    const signer = wallet().connect(provider(chainId));
    const response = await signer.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: tx.value ? BigInt(tx.value) : 0n,
      gasLimit: tx.gas ? BigInt(tx.gas) : undefined,
    });
    return response.hash;
  }
  if (method === 'wallet_getCapabilities') {
    return {};
  }
  return provider(chainId).send(method, params);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'STATE') {
        sendResponse({ result: await publicState() });
        return;
      }
      if (message.type === 'CREATE') {
        sendResponse({ result: await createWallet() });
        return;
      }
      if (message.type === 'IMPORT_PREVIEW') {
        const mnemonic = normalizeMnemonic(message.mnemonic);
        if (!isValidMnemonic(mnemonic)) {
          throw new Error('That recovery phrase is not valid BIP39.');
        }
        sendResponse({
          result: {
            mnemonic,
            address: ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(mnemonic), PATH).address,
          },
        });
        return;
      }
      if (message.type === 'SAVE') {
        sendResponse({ result: await persistWallet(message.mnemonic, message.pin) });
        return;
      }
      if (message.type === 'UNLOCK') {
        sendResponse({ result: await unlock(message.pin) });
        return;
      }
      if (message.type === 'LOCK') {
        lock();
        sendResponse({ result: await publicState() });
        return;
      }
      if (message.type === 'WIPE') {
        await wipe();
        sendResponse({ result: await publicState() });
        return;
      }
      if (message.type === 'SET_CHAIN') {
        await setChain(message.chainId);
        sendResponse({ result: await publicState() });
        return;
      }
      if (message.type === 'BALANCE') {
        const state = await publicState();
        if (!state.address) {
          throw new Error('Unlock first.');
        }
        const value = await provider(state.chainId).getBalance(state.address);
        sendResponse({ result: { balance: ethers.formatEther(value), symbol: state.chain.symbol } });
        return;
      }
      if (message.type === 'SEND') {
        sendResponse({ result: await sendNative(message.to, message.amount) });
        return;
      }
      if (message.type === 'PROVIDER') {
        sendResponse({ result: await handleProvider(message.payload) });
        return;
      }
      throw new Error(`Unknown message ${message.type}`);
    } catch (error) {
      sendResponse({ error: error instanceof Error ? error.message : 'Request failed.' });
    }
  })();
  return true;
});

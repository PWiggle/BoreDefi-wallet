const TEST_MESSAGE = 'Hello from BoreDefi';
const PROJECT_ID = 'b56e18d47c72ab683b10814fe9495694';
const CHAINS = {
  1: { name: 'Ethereum', symbol: 'ETH' },
  10: { name: 'Optimism', symbol: 'ETH' },
  56: { name: 'BNB Chain', symbol: 'BNB' },
  137: { name: 'Polygon', symbol: 'POL' },
  8453: { name: 'Base', symbol: 'ETH' },
  42161: { name: 'Arbitrum', symbol: 'ETH' },
  43114: { name: 'Avalanche', symbol: 'AVAX' },
};

const els = {
  status: document.getElementById('status-label'),
  wallet: document.getElementById('wallet-name'),
  address: document.getElementById('address'),
  network: document.getElementById('network'),
  balance: document.getElementById('balance'),
  message: document.getElementById('message'),
  error: document.getElementById('error'),
  qrBox: document.getElementById('qr-box'),
  qr: document.getElementById('qr'),
  wcUri: document.getElementById('wc-uri'),
  wcOpen: document.getElementById('wc-open'),
  connect: document.getElementById('connect'),
  connectWc: document.getElementById('connect-wc'),
  sign: document.getElementById('sign'),
  disconnect: document.getElementById('disconnect'),
};

let provider = null;
let via = null;
let accounts = [];
let chainId = null;

function setError(text) {
  els.error.hidden = !text;
  els.error.textContent = text || '';
}

function shortAddress(value) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—';
}

function hexToNumber(value) {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.startsWith('0x')) {
    return Number.parseInt(value, 16);
  }
  return Number(value);
}

function formatEther(weiHex) {
  const wei = BigInt(weiHex);
  const whole = wei / 1000000000000000000n;
  const frac = (wei % 1000000000000000000n).toString().padStart(18, '0').slice(0, 4);
  return `${whole}.${frac}`;
}

function utf8ToHex(value) {
  return `0x${[...new TextEncoder().encode(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function announceRequest() {
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

function findBoreDefi() {
  const found = [];
  const onAnnounce = (event) => {
    const detail = event.detail;
    if (detail?.info?.rdns === 'com.boredefi.wallet' || detail?.provider?.isBoreDefi) {
      found.push({ provider: detail.provider, name: detail.info?.name || 'BoreDefi' });
    }
  };
  window.addEventListener('eip6963:announceProvider', onAnnounce);
  announceRequest();
  window.removeEventListener('eip6963:announceProvider', onAnnounce);
  if (found[0]) {
    return found[0];
  }
  if (window.ethereum?.isBoreDefi) {
    return { provider: window.ethereum, name: 'BoreDefi' };
  }
  return null;
}

function otherInjected() {
  if (window.ethereum && !window.ethereum.isBoreDefi) {
    return window.ethereum;
  }
  return null;
}

async function refreshAccount() {
  if (!provider) {
    return;
  }
  const nextAccounts = await provider.request({ method: 'eth_accounts' });
  accounts = Array.isArray(nextAccounts) ? nextAccounts : [];
  const rawChain = await provider.request({ method: 'eth_chainId' });
  chainId = hexToNumber(rawChain);
  const chain = CHAINS[chainId] ?? { name: `Chain ${chainId}`, symbol: 'ETH' };
  els.address.textContent = shortAddress(accounts[0]);
  els.address.title = accounts[0] || '';
  els.network.textContent = chain.name;
  els.wallet.textContent = via === 'walletconnect' ? 'BoreDefi · WalletConnect' : via === 'injected-other' ? 'Injected wallet' : 'BoreDefi';
  if (accounts[0]) {
    const balance = await provider.request({
      method: 'eth_getBalance',
      params: [accounts[0], 'latest'],
    });
    els.balance.textContent = `${formatEther(balance)} ${chain.symbol}`;
    els.status.textContent = 'Connected';
    els.message.textContent = 'Connected. Sign is optional and does not move funds.';
    els.sign.disabled = false;
    els.disconnect.disabled = false;
  } else {
    resetUi('Disconnected.');
  }
}

function resetUi(note) {
  provider = null;
  via = null;
  accounts = [];
  chainId = null;
  els.status.textContent = 'Not connected';
  els.wallet.textContent = 'BoreDefi';
  els.address.textContent = '—';
  els.address.title = '';
  els.network.textContent = '—';
  els.balance.textContent = '—';
  els.message.textContent = note;
  els.sign.disabled = true;
  els.disconnect.disabled = true;
  els.qrBox.classList.remove('visible');
  els.wcOpen.hidden = true;
}

function bindProviderEvents() {
  if (!provider?.on) {
    return;
  }
  provider.on('accountsChanged', () => {
    refreshAccount().catch((err) => setError(err.message));
  });
  provider.on('chainChanged', () => {
    refreshAccount().catch((err) => setError(err.message));
  });
  provider.on('disconnect', () => resetUi('Disconnected.'));
}

async function connectInjected(target, label) {
  setError('');
  provider = target.provider ?? target;
  via = label;
  bindProviderEvents();
  await provider.request({ method: 'eth_requestAccounts' });
  await refreshAccount();
}

async function connectBoreDefi() {
  const boredefi = findBoreDefi();
  if (boredefi) {
    await connectInjected(boredefi, 'injected');
    return;
  }
  els.message.textContent = 'BoreDefi is not injected here. Open this page in the wallet Browser tab, unlock the extension, or use WalletConnect QR.';
  await connectWalletConnect();
}

async function renderQr(uri) {
  els.qrBox.classList.add('visible');
  els.wcUri.textContent = uri;
  els.wcOpen.href = `boredefi://wc?uri=${encodeURIComponent(uri)}`;
  els.wcOpen.hidden = false;
  const { default: QRCode } = await import('https://esm.sh/qrcode@1.5.4');
  await QRCode.toCanvas(els.qr, uri, { width: 240, margin: 1, color: { dark: '#0b0f14', light: '#ffffff' } });
}

async function connectWalletConnect() {
  setError('');
  els.message.textContent = 'Starting WalletConnect… scan the QR in BoreDefi (Settings → WalletConnect).';
  const { EthereumProvider } = await import('https://esm.sh/@walletconnect/ethereum-provider@2.21.1');
  const wc = await EthereumProvider.init({
    projectId: PROJECT_ID,
    showQrModal: false,
    optionalChains: [1, 8453, 42161, 10, 137, 56, 43114],
    methods: ['eth_accounts', 'eth_requestAccounts', 'eth_sendTransaction', 'personal_sign', 'wallet_switchEthereumChain'],
    events: ['chainChanged', 'accountsChanged'],
    metadata: {
      name: 'BoreDefi Connect',
      description: 'TEST-ONLY Connect page for BoreDefi Wallet',
      url: 'https://pwiggle.github.io/BoreDefi-wallet/connect/',
      icons: ['https://pwiggle.github.io/BoreDefi-wallet/connect/mark.png'],
    },
    rpcMap: {
      1: 'https://ethereum-rpc.publicnode.com',
      10: 'https://optimism-rpc.publicnode.com',
      56: 'https://bsc-rpc.publicnode.com',
      137: 'https://polygon-bor-rpc.publicnode.com',
      8453: 'https://mainnet.base.org',
      42161: 'https://arbitrum-one-rpc.publicnode.com',
      43114: 'https://avalanche-c-chain-rpc.publicnode.com',
    },
  });
  wc.on('display_uri', (uri) => {
    renderQr(uri).catch((err) => setError(err.message));
  });
  provider = wc;
  via = 'walletconnect';
  bindProviderEvents();
  await wc.connect();
  els.qrBox.classList.remove('visible');
  await refreshAccount();
}

async function signTest() {
  setError('');
  if (!provider || !accounts[0]) {
    throw new Error('Connect first.');
  }
  const signature = await provider.request({
    method: 'personal_sign',
    params: [utf8ToHex(TEST_MESSAGE), accounts[0]],
  });
  els.message.textContent = `Signed “${TEST_MESSAGE}”. ${signature.slice(0, 18)}…`;
}

async function disconnect() {
  setError('');
  try {
    if (via === 'walletconnect' && provider?.disconnect) {
      await provider.disconnect();
    } else if (provider?.request) {
      await provider.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      }).catch(() => undefined);
    }
  } finally {
    resetUi('Disconnected.');
  }
}

els.connect.addEventListener('click', () => {
  els.connect.disabled = true;
  connectBoreDefi()
    .catch((err) => {
      setError(err instanceof Error ? err.message : 'Connect failed.');
      if (!accounts[0]) {
        resetUi('Connect failed. Try WalletConnect QR or open this page inside BoreDefi.');
      }
    })
    .finally(() => {
      els.connect.disabled = false;
    });
});

els.connectWc.addEventListener('click', () => {
  els.connectWc.disabled = true;
  connectWalletConnect()
    .catch((err) => setError(err instanceof Error ? err.message : 'WalletConnect failed.'))
    .finally(() => {
      els.connectWc.disabled = false;
    });
});

els.sign.addEventListener('click', () => {
  signTest().catch((err) => setError(err instanceof Error ? err.message : 'Sign failed.'));
});

els.disconnect.addEventListener('click', () => {
  disconnect().catch((err) => setError(err instanceof Error ? err.message : 'Disconnect failed.'));
});

const detected = findBoreDefi();
if (detected) {
  els.message.textContent = 'BoreDefi is available on this page. Tap Connect BoreDefi.';
} else if (otherInjected()) {
  els.message.textContent = 'Another injected wallet is present. BoreDefi is the intended target — open this page in the BoreDefi Browser, unlock the extension, or use WalletConnect QR.';
}

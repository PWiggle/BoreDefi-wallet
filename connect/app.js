const SIGN_MESSAGE = 'Hello from BoreDefi';
const PROJECT_ID = 'bbd12489086c59bfdb9e0a49fc05c22f';
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
  try {
    window.dispatchEvent(new Event('eip6963:requestProvider'));
  } catch {
    // Very old browsers: fall back to window.ethereum below.
  }
}

function findBoreDefi() {
  const found = [];
  const onAnnounce = (event) => {
    const detail = event.detail;
    if (detail?.provider && (detail?.info?.rdns === 'com.boredefi.wallet' || detail?.provider?.isBoreDefi)) {
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

// The wallet's in-app browser injects its provider before the page runs, but some WebViews
// (and browser extensions) add it a moment later. Wait briefly for it instead of failing.
function waitForBoreDefi(timeoutMs = 1500) {
  const now = findBoreDefi();
  if (now) {
    return Promise.resolve(now);
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      const hit = findBoreDefi();
      if (hit || Date.now() >= deadline) {
        done = true;
        clearInterval(poll);
        window.removeEventListener('ethereum#initialized', finish);
        window.removeEventListener('eip6963:announceProvider', finish);
        resolve(hit);
      }
    };
    const deadline = Date.now() + timeoutMs;
    const poll = setInterval(finish, 100);
    window.addEventListener('ethereum#initialized', finish);
    window.addEventListener('eip6963:announceProvider', finish);
  });
}

function otherInjected() {
  if (window.ethereum && !window.ethereum.isBoreDefi) {
    return window.ethereum;
  }
  return null;
}

// Every refresh is tied to the provider it started with. If the user disconnects (or another
// refresh resets the page) while a request is in flight, the stale refresh stops quietly
// instead of calling .request on null.
let refreshSeq = 0;

async function refreshAccount(knownAccounts) {
  const active = provider;
  if (!active?.request) {
    return;
  }
  const seq = ++refreshSeq;
  const stale = () => provider !== active || seq !== refreshSeq;
  const nextAccounts = Array.isArray(knownAccounts)
    ? knownAccounts
    : await active.request({ method: 'eth_accounts' });
  if (stale()) {
    return;
  }
  accounts = Array.isArray(nextAccounts) ? nextAccounts : [];
  const rawChain = await active.request({ method: 'eth_chainId' });
  if (stale()) {
    return;
  }
  chainId = hexToNumber(rawChain);
  const chain = CHAINS[chainId] ?? { name: `Chain ${chainId}`, symbol: 'ETH' };
  els.address.textContent = shortAddress(accounts[0]);
  els.address.title = accounts[0] || '';
  els.network.textContent = chain.name;
  els.wallet.textContent = via === 'walletconnect' ? 'BoreDefi · WalletConnect' : via === 'injected-other' ? 'Injected wallet' : 'BoreDefi';
  if (accounts[0]) {
    els.status.textContent = 'Connected';
    els.message.textContent = 'Connected. Signing a message is optional and never moves funds.';
    els.sign.disabled = false;
    els.disconnect.disabled = false;
    const balance = await active.request({
      method: 'eth_getBalance',
      params: [accounts[0], 'latest'],
    }).catch(() => null);
    if (stale()) {
      return;
    }
    els.balance.textContent = balance ? `${formatEther(balance)} ${chain.symbol}` : '—';
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

const boundProviders = new WeakSet();

function bindProviderEvents() {
  const target = provider;
  if (!target?.on || boundProviders.has(target)) {
    return;
  }
  boundProviders.add(target);
  target.on('accountsChanged', (next) => {
    if (provider !== target) {
      return;
    }
    refreshAccount(Array.isArray(next) ? next : undefined).catch((err) => setError(friendlyError(err)));
  });
  target.on('chainChanged', () => {
    if (provider !== target) {
      return;
    }
    refreshAccount().catch((err) => setError(friendlyError(err)));
  });
  target.on('disconnect', () => {
    if (provider === target) {
      resetUi('Disconnected.');
    }
  });
}

function friendlyError(err) {
  const text = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (/user rejected/i.test(text)) {
    return 'Request cancelled in the wallet.';
  }
  if (!text || /null is not an object|cannot read prop|undefined is not an object|is not a function/i.test(text)) {
    return 'Could not reach the wallet. Reload this page in the BoreDefi Browser, or use WalletConnect QR.';
  }
  return text;
}

async function connectInjected(target, label) {
  setError('');
  const active = target.provider ?? target;
  if (!active?.request) {
    throw new Error('BoreDefi wallet not found on this page.');
  }
  provider = active;
  via = label;
  bindProviderEvents();
  const granted = await active.request({ method: 'eth_requestAccounts' });
  if (provider !== active) {
    return;
  }
  await refreshAccount(Array.isArray(granted) && granted.length ? granted : undefined);
}

async function connectBoreDefi() {
  els.message.textContent = 'Looking for BoreDefi…';
  const boredefi = await waitForBoreDefi();
  if (boredefi) {
    await connectInjected(boredefi, 'injected');
    return;
  }
  els.message.textContent = 'BoreDefi wallet not found in this browser. Open this page in the BoreDefi app (Browser tab), or use WalletConnect QR below.';
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
      description: 'Connect your BoreDefi Wallet',
      url: 'https://www.boredefi.com/connect',
      icons: ['https://www.boredefi.com/connect/mark.png'],
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

async function signMessage() {
  setError('');
  const active = provider;
  if (!active?.request || !accounts[0]) {
    throw new Error('Connect first.');
  }
  const signature = await active.request({
    method: 'personal_sign',
    params: [utf8ToHex(SIGN_MESSAGE), accounts[0]],
  });
  els.message.textContent = `Signed “${SIGN_MESSAGE}”. ${String(signature).slice(0, 18)}…`;
}

async function disconnect() {
  setError('');
  const active = provider;
  try {
    if (via === 'walletconnect' && active?.disconnect) {
      await active.disconnect();
    } else if (active?.request) {
      await active.request({
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
      if (!accounts[0]) {
        resetUi('Not connected. Try again, or use WalletConnect QR.');
      }
      setError(friendlyError(err));
    })
    .finally(() => {
      els.connect.disabled = false;
    });
});

els.connectWc.addEventListener('click', () => {
  els.connectWc.disabled = true;
  connectWalletConnect()
    .catch((err) => setError(friendlyError(err)))
    .finally(() => {
      els.connectWc.disabled = false;
    });
});

els.sign.addEventListener('click', () => {
  signMessage().catch((err) => setError(friendlyError(err)));
});

els.disconnect.addEventListener('click', () => {
  disconnect().catch((err) => setError(friendlyError(err)));
});

waitForBoreDefi().then((detected) => {
  if (provider) {
    return;
  }
  if (detected) {
    els.message.textContent = 'BoreDefi wallet detected. Tap Connect BoreDefi.';
  } else if (otherInjected()) {
    els.message.textContent = 'Another wallet is installed in this browser. To use BoreDefi, open this page in the BoreDefi app or use WalletConnect QR.';
  }
});

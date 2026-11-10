const app = document.getElementById('app');

const call = (type, extra = {}) =>
  new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...extra }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response.result);
    });
  });

let pending = null;
let challenges = [];
let ledgerAddress = null;

function pickChallenges(mnemonic) {
  const words = mnemonic.split(' ');
  const indices = words.map((_, index) => index).sort(() => Math.random() - 0.5).slice(0, 3).sort((a, b) => a - b);
  return indices.map((index) => ({ index, word: words[index] }));
}

function el(html) {
  app.innerHTML = html;
}

function on(id, event, handler) {
  document.getElementById(id)?.addEventListener(event, handler);
}

async function render() {
  const state = await call('STATE');
  if (!state.hasWallet && !pending) {
    return welcome();
  }
  if (pending?.step === 'backup') {
    return backup();
  }
  if (pending?.step === 'verify') {
    return verify();
  }
  if (pending?.step === 'pin') {
    return setPin();
  }
  if (!state.unlocked) {
    return unlock();
  }
  return home(state);
}

function welcome() {
  el(`
    <h1>BoreDefi Wallet</h1>
    <p>Chrome companion. The recovery phrase is encrypted in this profile and never sent to a server.</p>
    <div class="card">
      <strong>Phase 1 / 2</strong>
      <p>Create or import BIP39, backup + verify, PIN unlock, portfolio, send/receive, injected provider.</p>
    </div>
    <button id="create">Create new wallet</button>
    <button class="secondary" id="import">Import recovery phrase</button>
  `);
  on('create', 'click', async () => {
    const created = await call('CREATE');
    pending = { ...created, step: 'backup', imported: false };
    backup();
  });
  on('import', 'click', () => importForm());
}

function importForm() {
  el(`
    <h1>Import</h1>
    <textarea id="phrase" rows="4" placeholder="12 or 24 words"></textarea>
    <p class="error" id="err"></p>
    <button id="next">Continue</button>
    <button class="secondary" id="back">Back</button>
  `);
  on('back', 'click', () => {
    pending = null;
    welcome();
  });
  on('next', 'click', async () => {
    try {
      const preview = await call('IMPORT_PREVIEW', { mnemonic: document.getElementById('phrase').value });
      pending = { ...preview, step: 'pin', imported: true };
      setPin();
    } catch (error) {
      document.getElementById('err').textContent = error.message;
    }
  });
}

function backup() {
  const words = pending.mnemonic.split(' ');
  el(`
    <h1>Write these words down</h1>
    <p>There is no skip. You will verify three words next. This phrase is not logged.</p>
    <div class="grid">${words.map((word, i) => `<div class="word">${i + 1}. ${word}</div>`).join('')}</div>
    <label><input type="checkbox" id="ack" /> I wrote the phrase on paper and stored it offline.</label>
    <button id="next" disabled>Continue</button>
  `);
  on('ack', 'change', (event) => {
    document.getElementById('next').disabled = !event.target.checked;
  });
  on('next', 'click', () => {
    challenges = pickChallenges(pending.mnemonic);
    pending.step = 'verify';
    verify();
  });
}

function verify() {
  el(`
    <h1>Verify backup</h1>
    ${challenges.map((item, i) => `<label>Word ${item.index + 1}<input id="w${i}" /></label>`).join('')}
    <p class="error" id="err"></p>
    <button id="next">Verify</button>
  `);
  on('next', 'click', () => {
    const ok = challenges.every((item, i) => document.getElementById(`w${i}`).value.trim().toLowerCase() === item.word);
    if (!ok) {
      document.getElementById('err').textContent = 'Those words do not match. Try again.';
      return;
    }
    pending.step = 'pin';
    setPin();
  });
}

function setPin() {
  el(`
    <h1>Create PIN</h1>
    <input id="pin" inputmode="numeric" maxlength="6" placeholder="6-digit PIN" />
    <input id="pin2" inputmode="numeric" maxlength="6" placeholder="Repeat PIN" />
    <p class="error" id="err"></p>
    <button id="save">Save wallet on this profile</button>
  `);
  on('save', 'click', async () => {
    const pin = document.getElementById('pin').value;
    if (pin !== document.getElementById('pin2').value) {
      document.getElementById('err').textContent = 'PINs do not match.';
      return;
    }
    try {
      await call('SAVE', { mnemonic: pending.mnemonic, pin });
      pending = null;
      await render();
    } catch (error) {
      document.getElementById('err').textContent = error.message;
    }
  });
}

function unlock() {
  el(`
    <h1>Unlock</h1>
    <input id="pin" inputmode="numeric" maxlength="6" placeholder="PIN" />
    <p class="error" id="err"></p>
    <button id="go">Unlock</button>
  `);
  on('go', 'click', async () => {
    const result = await call('UNLOCK', { pin: document.getElementById('pin').value });
    if (!result.ok) {
      document.getElementById('err').textContent = 'Wrong PIN.';
      return;
    }
    await home(result.state);
  });
}

async function home(state) {
  let balance = '—';
  let symbol = state.chain.symbol;
  try {
    const loaded = await call('BALANCE');
    balance = Number.parseFloat(loaded.balance).toPrecision(6);
    symbol = loaded.symbol;
  } catch {
    balance = 'unavailable';
  }
  el(`
    <h1>Wallet</h1>
    <p class="mono">${state.address}</p>
    <div class="card">
      <strong>${balance} ${symbol}</strong>
      <p>${state.chain.name}${ledgerAddress ? ` · Ledger ${ledgerAddress}` : ''}</p>
    </div>
    <label>Network
      <select id="chain">${state.chains.map((chain) => `<option value="${chain.id}" ${chain.id === state.chainId ? 'selected' : ''}>${chain.name}</option>`).join('')}</select>
    </label>
    <div class="row">
      <button id="send">Send</button>
      <button class="secondary" id="recv">Receive</button>
    </div>
    <button class="secondary" id="ledger">${ledgerAddress ? 'Disconnect Ledger' : 'Connect Ledger (USB)'}</button>
    <p class="muted">Sites use the injected BoreDefi / MetaMask-compatible provider. Unlock this popup first. No fiat on-ramp.</p>
    <p class="error" id="err"></p>
    <div class="row">
      <button class="secondary" id="lock">Lock</button>
      <button class="danger" id="wipe">Delete</button>
    </div>
  `);
  on('chain', 'change', async (event) => {
    await call('SET_CHAIN', { chainId: Number(event.target.value) });
    await render();
  });
  on('send', 'click', () => sendForm(state));
  on('recv', 'click', () => {
    el(`<h1>Receive</h1><p class="mono">${state.address}</p><p>Share this address on ${state.chain.name}.</p><button id="back">Back</button>`);
    on('back', 'click', () => home(state));
  });
  on('ledger', 'click', async () => {
    try {
      if (ledgerAddress) {
        const mod = await import('./ledger.js');
        await mod.disconnect();
        ledgerAddress = null;
        await home(state);
        return;
      }
      const mod = await import('./ledger.js');
      const connected = await mod.connect();
      ledgerAddress = connected.address;
      await home(state);
    } catch (error) {
      document.getElementById('err').textContent = error.message;
    }
  });
  on('lock', 'click', async () => {
    await call('LOCK');
    unlock();
  });
  on('wipe', 'click', async () => {
    if (confirm('Delete the encrypted wallet from this Chrome profile?')) {
      await call('WIPE');
      pending = null;
      welcome();
    }
  });
}

function sendForm(state) {
  el(`
    <h1>Send ${state.chain.symbol}</h1>
    <input id="to" placeholder="0x…" />
    <input id="amount" placeholder="0.0" />
    <p class="error" id="err"></p>
    <button id="go">Send</button>
    <button class="secondary" id="back">Back</button>
  `);
  on('back', 'click', () => home(state));
  on('go', 'click', async () => {
    try {
      const result = await call('SEND', {
        to: document.getElementById('to').value,
        amount: document.getElementById('amount').value,
      });
      el(`<h1>Sent</h1><p class="mono">${result.hash}</p><button id="back">Done</button>`);
      on('back', 'click', () => home(state));
    } catch (error) {
      document.getElementById('err').textContent = error.message;
    }
  });
}

render().catch((error) => {
  el(`<p class="error">${error.message}</p>`);
});

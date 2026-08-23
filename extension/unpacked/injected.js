(() => {
  if (window.ethereum?.isBoreDefi) {
    return;
  }
  let nextId = 1;
  const pending = {};
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.target !== 'boredefi-inpage') {
      return;
    }
    const job = pending[event.data.id];
    if (!job) {
      return;
    }
    delete pending[event.data.id];
    if (event.data.error) {
      job.reject(new Error(event.data.error));
    } else {
      job.resolve(event.data.result);
    }
  });
  function send(payload) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending[id] = { resolve, reject };
      window.postMessage({ target: 'boredefi-contentscript', id, payload }, '*');
    });
  }
  const provider = {
    isBoreDefi: true,
    isMetaMask: true,
    selectedAddress: null,
    chainId: '0x1',
    networkVersion: '1',
    _listeners: {},
    request(args) {
      return send({ method: args?.method, params: args?.params || [] });
    },
    send(methodOrPayload, params) {
      if (typeof methodOrPayload === 'string') {
        return this.request({ method: methodOrPayload, params: params || [] });
      }
      return this.request(methodOrPayload);
    },
    sendAsync(payload, callback) {
      this.request(payload).then(
        (result) => callback(null, { id: payload.id, jsonrpc: '2.0', result }),
        (error) => callback(error, null),
      );
    },
    enable() {
      return this.request({ method: 'eth_requestAccounts' });
    },
    on(event, handler) {
      this._listeners[event] = this._listeners[event] || [];
      this._listeners[event].push(handler);
      return this;
    },
    removeListener(event, handler) {
      this._listeners[event] = (this._listeners[event] || []).filter((item) => item !== handler);
    },
    emit(event, data) {
      (this._listeners[event] || []).forEach((handler) => handler(data));
    },
  };
  const info = Object.freeze({
    uuid: '7d3f8c2a-1e4b-4a9c-9f21-6b8e0d5c4a11',
    name: 'BoreDefi',
    icon: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#000000"/><circle cx="32" cy="32" r="22" fill="#2EE59D"/></svg>'),
    rdns: 'com.boredefi.wallet',
  });
  function announce() {
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: Object.freeze({ info, provider }),
    }));
  }
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
  window.ethereum = provider;
  window.dispatchEvent(new Event('ethereum#initialized'));
})();

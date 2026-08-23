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
  window.ethereum = provider;
  window.dispatchEvent(new Event('ethereum#initialized'));
})();

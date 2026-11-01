export const INJECTED_PROVIDER_SOURCE = `
(function () {
  if (window.ethereum && window.ethereum.isBoreDefi) {
    return;
  }
  var nextId = 1;
  var pending = {};
  function send(payload) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, payload: payload }));
      } else {
        reject(new Error('BoreDefi provider is unavailable'));
      }
    });
  }
  var provider = {
    isBoreDefi: true,
    isMetaMask: true,
    selectedAddress: null,
    chainId: '0x1',
    networkVersion: '1',
    _listeners: {},
    request: function (args) {
      var method = args && args.method;
      var params = (args && args.params) || [];
      return send({ method: method, params: params, jsonrpc: '2.0' });
    },
    send: function (methodOrPayload, params) {
      if (typeof methodOrPayload === 'string') {
        return this.request({ method: methodOrPayload, params: params || [] });
      }
      return this.request(methodOrPayload);
    },
    sendAsync: function (payload, callback) {
      this.request(payload).then(function (result) {
        callback(null, { id: payload.id, jsonrpc: '2.0', result: result });
      }).catch(function (error) {
        callback(error, null);
      });
    },
    enable: function () {
      return this.request({ method: 'eth_requestAccounts' });
    },
    on: function (event, handler) {
      this._listeners[event] = this._listeners[event] || [];
      this._listeners[event].push(handler);
      return this;
    },
    removeListener: function (event, handler) {
      this._listeners[event] = (this._listeners[event] || []).filter(function (item) { return item !== handler; });
    },
    emit: function (event, data) {
      (this._listeners[event] || []).forEach(function (handler) { handler(data); });
    }
  };
  window.__boredefiResolve = function (id, result, error) {
    var job = pending[id];
    if (!job) { return; }
    delete pending[id];
    if (error) { job.reject(new Error(error)); } else { job.resolve(result); }
  };
  window.__boredefiEmit = function (event, data) {
    provider.emit(event, data);
    if (event === 'connect' || event === 'chainChanged') {
      provider.chainId = typeof data === 'string' ? data : (data && data.chainId) || provider.chainId;
    }
    if (event === 'accountsChanged') {
      provider.selectedAddress = data && data[0] ? data[0] : null;
    }
  };
  var info = {
    uuid: '7d3f8c2a-1e4b-4a9c-9f21-6b8e0d5c4a11',
    name: 'BoreDefi',
    icon: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#000000"/><circle cx="32" cy="32" r="22" fill="#2EE59D"/></svg>'),
    rdns: 'com.boredefi.wallet'
  };
  function announce() {
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: Object.freeze({ info: Object.freeze(info), provider: provider })
    }));
  }
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
  window.ethereum = provider;
  window.dispatchEvent(new Event('ethereum#initialized'));
})();
true;
`;

export function providerResolveScript(id: number, result: unknown, error?: string): string {
  return `window.__boredefiResolve(${id}, ${error ? 'null' : JSON.stringify(result)}, ${
    error ? JSON.stringify(error) : 'null'
  }); true;`;
}

export function providerEmitScript(event: string, data: unknown): string {
  return `window.__boredefiEmit(${JSON.stringify(event)}, ${JSON.stringify(data)}); true;`;
}

export function chainIdHex(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

export function providerSyncScript(address: string, chainId: number): string {
  const hex = chainIdHex(chainId);
  return `
    if (window.ethereum) {
      window.ethereum.selectedAddress = ${JSON.stringify(address)};
      window.ethereum.chainId = ${JSON.stringify(hex)};
      window.ethereum.networkVersion = ${JSON.stringify(String(chainId))};
    }
    true;
  `;
}

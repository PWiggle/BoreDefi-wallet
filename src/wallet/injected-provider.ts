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
    once: function (event, handler) {
      var self = this;
      function wrapped(data) { self.removeListener(event, wrapped); handler(data); }
      return this.on(event, wrapped);
    },
    removeListener: function (event, handler) {
      this._listeners[event] = (this._listeners[event] || []).filter(function (item) { return item !== handler; });
      return this;
    },
    off: function (event, handler) {
      return this.removeListener(event, handler);
    },
    removeAllListeners: function (event) {
      if (event) { delete this._listeners[event]; } else { this._listeners = {}; }
      return this;
    },
    isConnected: function () {
      return true;
    },
    emit: function (event, data) {
      (this._listeners[event] || []).slice().forEach(function (handler) {
        try { handler(data); } catch (e) {}
      });
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
    try {
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: Object.freeze({ info: Object.freeze(info), provider: provider })
      }));
    } catch (e) {}
  }
  // Set window.ethereum first so nothing below (a listener that throws, an old WebKit
  // without CustomEvent) can leave the page without a provider.
  try {
    window.ethereum = provider;
  } catch (e) {
    try { Object.defineProperty(window, 'ethereum', { value: provider, configurable: true, writable: true }); } catch (e2) {}
  }
  // App links (wc:, metamask://wc?uri=..., intent://...) never reach the WebView loader: Android
  // shows "net::ERR_UNKNOWN_URL_SCHEME" for them, and its native navigation hook falls back to
  // "load" if the app is busy for 250 ms. Hand them to the wallet, which decides (pair, block,
  // or load a safe fallback). Plain http(s) behaves exactly as before.
  var WEB_SCHEMES = /^(https?|about|blob|data|javascript):/i;
  function isAppLink(url) {
    return typeof url === 'string' && /^[a-z][a-z0-9+.-]*:/i.test(url.trim()) && !WEB_SCHEMES.test(url.trim());
  }
  function handOff(url) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'boredefi:open', url: String(url).trim() }));
    }
  }
  try {
    var nativeOpen = window.open;
    window.open = function (url) {
      var href = url == null ? '' : String(url);
      if (isAppLink(href)) {
        handOff(href);
        return null;
      }
      return nativeOpen.apply(window, arguments);
    };
  } catch (e) {}
  try {
    document.addEventListener('click', function (event) {
      var node = event.target;
      while (node && node.nodeType === 1 && String(node.tagName).toUpperCase() !== 'A') {
        node = node.parentNode;
      }
      if (!node || node.nodeType !== 1) { return; }
      var href = node.getAttribute && node.getAttribute('href');
      if (href && isAppLink(href)) {
        event.preventDefault();
        handOff(href);
      }
    }, true);
  } catch (e) {}
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
  try { window.dispatchEvent(new Event('ethereum#initialized')); } catch (e) {}
})();
true;
`;

/** A navigation hand-off posted by the injected script (window.open / link click to an app scheme). */
export function parseOpenMessage(data: string): string | null {
  try {
    const parsed = JSON.parse(data) as { type?: unknown; url?: unknown };
    return parsed && parsed.type === 'boredefi:open' && typeof parsed.url === 'string' ? parsed.url : null;
  } catch {
    return null;
  }
}

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

/** True only when the request's frame origin is the origin the user approved. */
export function isOriginConnected(connectedOrigin: string | null, origin: string | null | undefined): boolean {
  return Boolean(connectedOrigin && origin && connectedOrigin === origin);
}

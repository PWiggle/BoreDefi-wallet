(() => {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.target !== 'boredefi-contentscript') {
      return;
    }
    chrome.runtime.sendMessage({ type: 'PROVIDER', id: event.data.id, payload: event.data.payload }, (response) => {
      window.postMessage(
        {
          target: 'boredefi-inpage',
          id: event.data.id,
          result: response?.result,
          error: response?.error,
        },
        '*',
      );
    });
  });
})();

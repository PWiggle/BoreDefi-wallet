import { relayWebSocketOptions, WALLETCONNECT_RELAY_ORIGIN } from './wc';

type SocketOptions = { headers?: Record<string, string> };
type SocketCtor = {
  new (url: string, protocols?: string | string[], options?: SocketOptions): WebSocket;
  __boredefiRelayOrigin?: boolean;
  prototype: WebSocket;
};

/**
 * React Native's WebSocket sends `https://<relay-host>` unless headers.Origin
 * is set. The live project accepts `https://www.boredefi.com`. WalletConnect
 * captures `global.WebSocket` when its module loads, so this runs first.
 */
export function installRelayOriginWebSocket(): void {
  const current = global.WebSocket as unknown as SocketCtor;
  if (!current || current.__boredefiRelayOrigin) {
    return;
  }

  class RelayOriginWebSocket extends current {
    constructor(url: string, protocols?: string | string[], options?: SocketOptions) {
      const next = relayWebSocketOptions(url, options);
      super(url, protocols, next);
      if (typeof url === 'string' && url.includes('relay.walletconnect')) {
        console.info(`WalletConnect relay websocket Origin ${WALLETCONNECT_RELAY_ORIGIN}`);
      }
    }
  }

  RelayOriginWebSocket.__boredefiRelayOrigin = true;
  global.WebSocket = RelayOriginWebSocket as unknown as typeof WebSocket;
}

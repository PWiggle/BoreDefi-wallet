import { installRelayOriginWebSocket } from './wc-origin';

/**
 * Loads the WalletConnect SDK synchronously from the main bundle, after the relay Origin WebSocket patch.
 * `await import()` made Metro fetch a split bundle in dev builds, which failed with "Requiring unknown module"
 * and left WalletConnect dead. A plain require keeps one bundle and still defers evaluation until first use.
 */
type CoreModule = typeof import('@walletconnect/core');
type WalletKitModule = typeof import('@reown/walletkit');
type UtilsModule = typeof import('@walletconnect/utils');

declare const require: (id: string) => unknown;

export function loadWalletKitSdk(): { Core: CoreModule['Core']; WalletKit: WalletKitModule['WalletKit'] } {
  installRelayOriginWebSocket();
  const { Core } = require('@walletconnect/core') as CoreModule;
  const { WalletKit } = require('@reown/walletkit') as WalletKitModule;
  return { Core, WalletKit };
}

export function loadWalletConnectUtils(): Pick<UtilsModule, 'buildApprovedNamespaces' | 'getSdkError'> {
  return require('@walletconnect/utils') as UtilsModule;
}

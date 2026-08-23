import type { NftItem } from './wallet/nfts';

export type MainStackParamList = {
  Home: undefined;
  Receive: undefined;
  Send: { to?: string; amount?: string };
  ScanQr: { purpose?: 'payment' | 'walletconnect' };
  Activity: undefined;
  Settings: undefined;
  RevealSeed: undefined;
  ResetWallet: undefined;
  Swap: { fromSymbol?: string };
  Stake: { marketId?: string };
  Bridge: undefined;
  Discover: undefined;
  Ledger: undefined;
  Nfts: undefined;
  NftSend: { nft?: NftItem };
  Browser: undefined;
  WalletConnect: { uri?: string };
};

import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { CompositeNavigationProp, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { NftItem } from './wallet/nfts';

export type MainTabParamList = {
  Wallet: undefined;
  Markets: undefined;
  Browser: { url?: string };
  NFTs: undefined;
  Settings: undefined;
};

export type MainStackParamList = {
  Tabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Receive: undefined;
  Send: { to?: string; amount?: string; tokenSymbol?: string };
  ScanQr: { purpose?: 'payment' | 'walletconnect' | 'nft' | 'solana'; nft?: NftItem };
  Activity: undefined;
  RevealSeed: undefined;
  ChangePin: undefined;
  ResetWallet: undefined;
  Swap: { fromSymbol?: string };
  Stake: { marketId?: string };
  Bridge: undefined;
  Gas: undefined;
  /** Screenshot-proof builds only (EXPO_PUBLIC_PROOF_MODE=1). */
  Proof: undefined;
  Ledger: undefined;
  NftSend: { nft?: NftItem; to?: string };
  NftReceive: undefined;
  NftImport: undefined;
  WalletConnect: { uri?: string };
  ProtectedCollections: undefined;
  /** Solana (EXPO_PUBLIC_SOLANA builds only). */
  SolanaReceive: undefined;
  SolanaSend: { to?: string; amount?: string; mint?: string };
};

export type MainNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList>,
  NativeStackNavigationProp<MainStackParamList>
>;

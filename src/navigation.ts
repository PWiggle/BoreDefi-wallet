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
  Send: { to?: string; amount?: string };
  ScanQr: { purpose?: 'payment' | 'walletconnect' };
  Activity: undefined;
  RevealSeed: undefined;
  ResetWallet: undefined;
  Swap: { fromSymbol?: string };
  Stake: { marketId?: string };
  Bridge: undefined;
  Ledger: undefined;
  NftSend: { nft?: NftItem };
  WalletConnect: { uri?: string };
};

export type MainNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList>,
  NativeStackNavigationProp<MainStackParamList>
>;

export type MainStackParamList = {
  Home: undefined;
  Receive: undefined;
  Send: { to?: string; amount?: string };
  ScanQr: { purpose?: 'payment' | 'walletconnect' };
  Activity: undefined;
  Settings: undefined;
  RevealSeed: undefined;
  ResetWallet: undefined;
  Swap: undefined;
  WalletConnect: { uri?: string };
};

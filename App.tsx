import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { WalletConnectOverlay } from './src/components/WalletConnectOverlay';
import { WebTestBanner } from './src/components/WebTestBanner';
import { LedgerProvider } from './src/context/LedgerContext';
import { WalletConnectProvider } from './src/context/WalletConnectContext';
import { WalletProvider, useWallet } from './src/context/WalletContext';
import type { MainStackParamList } from './src/navigation';
import { MainTabs } from './src/navigation/MainTabs';
import { ActivityScreen } from './src/screens/ActivityScreen';
import { BackupSeedScreen } from './src/screens/BackupSeedScreen';
import { BridgeScreen } from './src/screens/BridgeScreen';
import { ChangePinScreen } from './src/screens/ChangePinScreen';
import { ImportWalletScreen } from './src/screens/ImportWalletScreen';
import { LedgerScreen } from './src/screens/LedgerScreen';
import { NftImportScreen } from './src/screens/NftImportScreen';
import { NftReceiveScreen } from './src/screens/NftReceiveScreen';
import { NftSendScreen } from './src/screens/NftSendScreen';
import { ReceiveScreen } from './src/screens/ReceiveScreen';
import { ResetWalletScreen } from './src/screens/ResetWalletScreen';
import { RevealSeedScreen } from './src/screens/RevealSeedScreen';
import { ScanQrScreen } from './src/screens/ScanQrScreen';
import { SendScreen } from './src/screens/SendScreen';
import { SetPinScreen } from './src/screens/SetPinScreen';
import { StakeScreen } from './src/screens/StakeScreen';
import { SwapScreen } from './src/screens/SwapScreen';
import { UnlockScreen } from './src/screens/UnlockScreen';
import { VerifySeedScreen } from './src/screens/VerifySeedScreen';
import { WalletConnectScreen } from './src/screens/WalletConnectScreen';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { colors, phoneWidth } from './src/theme';

const OnboardingStack = createNativeStackNavigator();
const MainStack = createNativeStackNavigator<MainStackParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    border: colors.border,
    primary: colors.accent,
  },
};

function BootScreen() {
  return (
    <View style={styles.boot}>
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}

const stackScreenOptions = {
  headerStyle: { backgroundColor: colors.bg },
  headerTintColor: colors.text,
  headerTitleStyle: { fontWeight: '700' as const },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.bg },
};

function RootNavigator() {
  const { phase } = useWallet();

  if (phase === 'booting') {
    return <BootScreen />;
  }

  if (phase === 'locked') {
    return <UnlockScreen />;
  }

  if (phase === 'unlocked') {
    return (
      <MainStack.Navigator screenOptions={stackScreenOptions}>
        <MainStack.Screen name="Tabs" component={MainTabs} options={{ headerShown: false }} />
        <MainStack.Screen name="Receive" component={ReceiveScreen} />
        <MainStack.Screen name="Send" component={SendScreen} initialParams={{}} />
        <MainStack.Screen name="ScanQr" component={ScanQrScreen} options={{ title: 'Scan QR' }} />
        <MainStack.Screen name="Swap" component={SwapScreen} initialParams={{}} />
        <MainStack.Screen name="Stake" component={StakeScreen} initialParams={{}} />
        <MainStack.Screen name="Bridge" component={BridgeScreen} />
        <MainStack.Screen name="Ledger" component={LedgerScreen} />
        <MainStack.Screen name="NftSend" component={NftSendScreen} options={{ title: 'Send NFT' }} initialParams={{}} />
        <MainStack.Screen name="NftReceive" component={NftReceiveScreen} options={{ title: 'Receive NFT' }} />
        <MainStack.Screen name="NftImport" component={NftImportScreen} options={{ title: 'Import NFT' }} />
        <MainStack.Screen name="WalletConnect" component={WalletConnectScreen} options={{ title: 'WalletConnect' }} />
        <MainStack.Screen name="Activity" component={ActivityScreen} />
        <MainStack.Screen
          name="RevealSeed"
          component={RevealSeedScreen}
          options={{ title: 'Recovery phrase' }}
        />
        <MainStack.Screen
          name="ChangePin"
          component={ChangePinScreen}
          options={{ title: 'Change PIN' }}
        />
        <MainStack.Screen
          name="ResetWallet"
          component={ResetWalletScreen}
          options={{ title: 'Delete wallet' }}
        />
      </MainStack.Navigator>
    );
  }

  return (
    <OnboardingStack.Navigator
      screenOptions={{
        ...stackScreenOptions,
        headerShown: false,
        headerBackVisible: false,
        gestureEnabled: false,
      }}
    >
      {phase === 'welcome' ? (
        <OnboardingStack.Screen name="Welcome" component={WelcomeScreen} />
      ) : null}
      {phase === 'backup' ? (
        <OnboardingStack.Screen name="Backup" component={BackupSeedScreen} />
      ) : null}
      {phase === 'verify' ? (
        <OnboardingStack.Screen name="Verify" component={VerifySeedScreen} />
      ) : null}
      {phase === 'import' ? (
        <OnboardingStack.Screen name="Import" component={ImportWalletScreen} />
      ) : null}
      {phase === 'set-pin' ? (
        <OnboardingStack.Screen name="SetPin" component={SetPinScreen} />
      ) : null}
    </OnboardingStack.Navigator>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.frame}>
        <View style={styles.phone}>
          <SafeAreaProvider>
            <WebTestBanner />
            <WalletProvider>
              <LedgerProvider>
                <WalletConnectProvider>
                  <NavigationContainer theme={navTheme}>
                    <StatusBar style="light" />
                    <RootNavigator />
                    <WalletConnectOverlay />
                  </NavigationContainer>
                </WalletConnectProvider>
              </LedgerProvider>
            </WalletProvider>
          </SafeAreaProvider>
        </View>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.canvas,
    flex: 1,
  },
  frame: {
    alignItems: 'center',
    backgroundColor: colors.canvas,
    flex: 1,
  },
  phone: {
    backgroundColor: colors.bg,
    flex: 1,
    maxWidth: phoneWidth,
    overflow: 'hidden',
    width: '100%',
    ...(Platform.OS === 'web'
      ? {
          borderColor: colors.border,
          borderLeftWidth: 1,
          borderRightWidth: 1,
        }
      : null),
  },
  boot: {
    alignItems: 'center',
    backgroundColor: colors.bg,
    flex: 1,
    justifyContent: 'center',
  },
});

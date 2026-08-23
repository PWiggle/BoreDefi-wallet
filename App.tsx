import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { WalletProvider, useWallet } from './src/context/WalletContext';
import type { MainStackParamList } from './src/navigation';
import { ActivityScreen } from './src/screens/ActivityScreen';
import { BackupSeedScreen } from './src/screens/BackupSeedScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { ImportWalletScreen } from './src/screens/ImportWalletScreen';
import { ReceiveScreen } from './src/screens/ReceiveScreen';
import { ResetWalletScreen } from './src/screens/ResetWalletScreen';
import { RevealSeedScreen } from './src/screens/RevealSeedScreen';
import { ScanQrScreen } from './src/screens/ScanQrScreen';
import { SendScreen } from './src/screens/SendScreen';
import { SetPinScreen } from './src/screens/SetPinScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { UnlockScreen } from './src/screens/UnlockScreen';
import { VerifySeedScreen } from './src/screens/VerifySeedScreen';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { colors } from './src/theme';

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
      <MainStack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <MainStack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
        <MainStack.Screen name="Receive" component={ReceiveScreen} />
        <MainStack.Screen name="Send" component={SendScreen} initialParams={{}} />
        <MainStack.Screen name="ScanQr" component={ScanQrScreen} options={{ title: 'Scan QR' }} />
        <MainStack.Screen name="Activity" component={ActivityScreen} />
        <MainStack.Screen name="Settings" component={SettingsScreen} />
        <MainStack.Screen
          name="RevealSeed"
          component={RevealSeedScreen}
          options={{ title: 'Recovery phrase' }}
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
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
        headerBackVisible: false,
        gestureEnabled: false,
      }}
    >
      {phase === 'welcome' ? (
        <OnboardingStack.Screen
          name="Welcome"
          component={WelcomeScreen}
          options={{ headerShown: false }}
        />
      ) : null}
      {phase === 'backup' ? (
        <OnboardingStack.Screen
          name="Backup"
          component={BackupSeedScreen}
          options={{ title: 'Backup', headerBackVisible: false }}
        />
      ) : null}
      {phase === 'verify' ? (
        <OnboardingStack.Screen
          name="Verify"
          component={VerifySeedScreen}
          options={{ title: 'Verify backup' }}
        />
      ) : null}
      {phase === 'import' ? (
        <OnboardingStack.Screen
          name="Import"
          component={ImportWalletScreen}
          options={{ title: 'Import' }}
        />
      ) : null}
      {phase === 'set-pin' ? (
        <OnboardingStack.Screen
          name="SetPin"
          component={SetPinScreen}
          options={{ title: 'Create PIN' }}
        />
      ) : null}
    </OnboardingStack.Navigator>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <WalletProvider>
          <NavigationContainer theme={navTheme}>
            <StatusBar style="light" />
            <RootNavigator />
          </NavigationContainer>
        </WalletProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  boot: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

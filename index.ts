import '@walletconnect/react-native-compat';
import 'react-native-gesture-handler';
import 'react-native-get-random-values';
import '@ethersproject/shims';

import { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';

import App from './App';

// Keep the native splash (padded ape head on #255470) up until the full-logo
// overlay has painted. Android 12 masks the native icon to a circle.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

registerRootComponent(App);

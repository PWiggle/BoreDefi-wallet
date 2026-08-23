import '@walletconnect/react-native-compat';
import 'react-native-gesture-handler';
import 'react-native-get-random-values';
import '@ethersproject/shims';

import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);

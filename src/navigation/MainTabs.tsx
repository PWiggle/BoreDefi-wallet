import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useMemo } from 'react';

import { BrowserTabIcon, MarketsTabIcon, NftsTabIcon, SettingsTabIcon, WalletTabIcon } from '../components/TabIcons';
import { useTheme } from '../context/ThemeContext';
import type { MainTabParamList } from '../navigation';
import { BrowserScreen } from '../screens/BrowserScreen';
import { DiscoverScreen } from '../screens/DiscoverScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { NftsScreen } from '../screens/NftsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs() {
  const { colors } = useTheme();
  const screenOptions = useMemo(
    () => ({
      headerShown: false,
      tabBarHideOnKeyboard: true,
      tabBarActiveTintColor: colors.accent,
      tabBarInactiveTintColor: colors.muted,
      tabBarLabelStyle: { fontSize: 11, fontWeight: '700' as const },
      tabBarStyle: {
        backgroundColor: colors.surface,
        borderTopColor: colors.border,
        borderTopWidth: 1,
        height: 64,
        paddingBottom: 8,
        paddingTop: 6,
      },
    }),
    [colors],
  );

  return (
    <Tab.Navigator screenOptions={screenOptions}>
      <Tab.Screen
        name="Wallet"
        component={HomeScreen}
        options={{ tabBarIcon: ({ color }) => <WalletTabIcon color={color} /> }}
      />
      <Tab.Screen
        name="Markets"
        component={DiscoverScreen}
        options={{ tabBarIcon: ({ color }) => <MarketsTabIcon color={color} /> }}
      />
      <Tab.Screen
        name="Browser"
        component={BrowserScreen}
        options={{ tabBarIcon: ({ color }) => <BrowserTabIcon color={color} /> }}
      />
      <Tab.Screen
        name="NFTs"
        component={NftsScreen}
        options={{ tabBarIcon: ({ color }) => <NftsTabIcon color={color} /> }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ tabBarIcon: ({ color }) => <SettingsTabIcon color={color} /> }}
      />
    </Tab.Navigator>
  );
}

import { forwardRef } from 'react';
import { Platform, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';

import { useTheme } from '../context/ThemeContext';

type Props = {
  uri: string;
  style?: StyleProp<ViewStyle>;
  injectedJavaScriptBeforeContentLoaded?: string;
  onLoadEnd?: () => void;
  onMessage?: (event: WebViewMessageEvent) => void;
  onShouldStartLoadWithRequest?: (request: WebViewNavigation) => boolean;
  onNavigationStateChange?: (navState: WebViewNavigation) => void;
  /** url is the URL that failed (Android: the failing URL; iOS: the page URL). */
  onError?: (error: { description: string; code?: number; url?: string }) => void;
};

export const InAppBrowserView = forwardRef<WebView, Props>(function InAppBrowserView(
  {
    uri,
    style,
    injectedJavaScriptBeforeContentLoaded,
    onLoadEnd,
    onMessage,
    onShouldStartLoadWithRequest,
    onNavigationStateChange,
    onError,
  },
  ref,
) {
  const { colors } = useTheme();
  if (Platform.OS === 'web') {
    return (
      <View style={[{ backgroundColor: colors.surface, overflow: 'hidden' }, style]}>
        <iframe
          src={uri}
          title="BoreDefi in-app browser"
          style={{
            backgroundColor: colors.surface,
            border: 'none',
            height: '100%',
            width: '100%',
          }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
        />
      </View>
    );
  }

  return (
    <WebView
      ref={ref}
      source={{ uri }}
      style={style}
      javaScriptEnabled
      originWhitelist={['*']}
      setSupportMultipleWindows={false}
      injectedJavaScriptBeforeContentLoaded={injectedJavaScriptBeforeContentLoaded}
      // Same script again after load as a safety net (it is idempotent: it returns early when
      // window.ethereum.isBoreDefi is already there). Main frame only, like the early injection.
      injectedJavaScript={injectedJavaScriptBeforeContentLoaded}
      injectedJavaScriptForMainFrameOnly
      injectedJavaScriptBeforeContentLoadedForMainFrameOnly
      onLoadEnd={onLoadEnd}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
      onNavigationStateChange={onNavigationStateChange}
      onError={(event) =>
        onError?.({
          description: event.nativeEvent.description || 'Page failed to load.',
          code: event.nativeEvent.code,
          url: event.nativeEvent.url,
        })
      }
      // Replaces the library's "Error loading page / Domain: undefined / Error Code" screen.
      // The Browser screen shows the reason in its own banner and recovers the page.
      renderError={() => (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, padding: 16 }}>
          <Text style={{ color: colors.muted, textAlign: 'center' }}>This page couldn't load. Tap Go to try again.</Text>
        </View>
      )}
    />
  );
});

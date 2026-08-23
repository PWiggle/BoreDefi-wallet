import { forwardRef } from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
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
  onError?: (description: string) => void;
};

export const InAppBrowserView = forwardRef<WebView, Props>(function InAppBrowserView(
  {
    uri,
    style,
    injectedJavaScriptBeforeContentLoaded,
    onLoadEnd,
    onMessage,
    onShouldStartLoadWithRequest,
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
      onLoadEnd={onLoadEnd}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
      onError={(event) => onError?.(event.nativeEvent.description || 'Page failed to load.')}
    />
  );
});

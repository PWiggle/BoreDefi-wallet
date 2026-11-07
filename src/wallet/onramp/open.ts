import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

import { isStripeHostedOnrampUrl } from './url';

/**
 * Opens Stripe's hosted onramp (crypto.link.com) the way Stripe expects on a phone:
 * SFSafariViewController on iOS and a Chrome Custom Tab on Android (`expo-web-browser`).
 * If that container is unavailable, the system browser is used instead.
 *
 * The in-app dApp browser is intentionally not used. It injects a wallet provider and
 * is the wrong place for a card payment and identity check.
 */
export async function openStripeHostedOnramp(url: string): Promise<void> {
  if (!isStripeHostedOnrampUrl(url)) {
    throw new Error('Refusing to open a link that is not the Stripe-hosted onramp.');
  }
  try {
    await WebBrowser.openBrowserAsync(url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
      toolbarColor: '#0B0F14',
      controlsColor: '#2EE59D',
      showTitle: true,
      enableBarCollapsing: false,
    });
    return;
  } catch {
    // Fall through to the system browser.
  }
  try {
    await Linking.openURL(url);
  } catch {
    throw new Error('Could not open the browser.');
  }
}

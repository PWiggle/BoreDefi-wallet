import type { EmbeddedOnrampProps } from './embedded-onramp-props';

/** Web and any bundle without the native onramp module keep the hosted browser checkout. */
export function EmbeddedOnramp(_props: EmbeddedOnrampProps) {
  return null;
}

import Svg, { Circle, Path, Rect } from 'react-native-svg';

export function WalletTabIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="6" width="18" height="13" rx="3" stroke={color} strokeWidth={1.8} />
      <Path d="M3 10h18" stroke={color} strokeWidth={1.8} />
      <Circle cx="16.5" cy="14.5" r="1.2" fill={color} />
    </Svg>
  );
}

export function MarketsTabIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M4 18V9M10 18V5M16 18v-7M22 18H2" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function BrowserTabIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="8.2" stroke={color} strokeWidth={1.8} />
      <Path d="M4.5 12h15M12 3.8c2.4 2.6 3.6 5.4 3.6 8.2S14.4 17.6 12 20.2C9.6 17.6 8.4 14.8 8.4 12S9.6 6.4 12 3.8Z" stroke={color} strokeWidth={1.6} />
    </Svg>
  );
}

export function NftsTabIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Rect x="4" y="5" width="16" height="14" rx="3" stroke={color} strokeWidth={1.8} />
      <Path d="M8 14.5 10.2 12l2.3 2.4 2.2-2.7L16.8 14.5" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
      <Circle cx="9" cy="9.2" r="1.1" fill={color} />
    </Svg>
  );
}

export function SettingsTabIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="3.1" stroke={color} strokeWidth={1.8} />
      <Path
        d="M12 4.5v1.6M12 17.9v1.6M4.5 12h1.6M17.9 12h1.6M6.6 6.6l1.1 1.1M16.3 16.3l1.1 1.1M17.4 6.6l-1.1 1.1M7.7 16.3l-1.1 1.1"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

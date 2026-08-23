import type { ImageSourcePropType } from 'react-native';

export { COVER_BACKGROUND, COVER_FOOTER_TEXT } from './theme';

/** Brand cover art. Keep contain + slate-blue letterboxing; do not recolor. */
export const coverImage = require('../assets/boredefi-cover.png') as ImageSourcePropType;

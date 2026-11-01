import { Platform } from 'react-native';

import { WEB_TEST_BANNER } from './web-test-copy';

export { WEB_TEST_BANNER };

export function isWebTestBuild(): boolean {
  return Platform.OS === 'web';
}

import assert from 'node:assert/strict';
import test from 'node:test';

import { WEB_TEST_BANNER } from './web-test-copy';

test('web test banner forbids real seeds and funds', () => {
  assert.match(WEB_TEST_BANNER, /TEST-ONLY/);
  assert.match(WEB_TEST_BANNER, /real recovery phrase/i);
  assert.match(WEB_TEST_BANNER, /real funds/i);
});

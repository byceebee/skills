import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  extensionIdFromDirectory,
  extensionIdFromNativeManifest,
  isAllowedAuditOrigin,
} from '../scripts/pairing.mjs';

const allowed = new Set(['http://127.0.0.1:4319']);

test('audit origin is compared exactly, never by prefix', () => {
  assert.equal(isAllowedAuditOrigin('http://127.0.0.1:4319/agent-settings/', allowed), true);
  assert.equal(isAllowedAuditOrigin('http://127.0.0.1:43190/', allowed), false);
  assert.equal(isAllowedAuditOrigin('https://127.0.0.1:4319/', allowed), false);
  assert.equal(isAllowedAuditOrigin('http://127.0.0.1.evil.test:4319/', allowed), false);
  assert.equal(isAllowedAuditOrigin('not a url', allowed), false);
});

test('extension ID follows Chrome unpacked path derivation', async () => {
  assert.equal(await extensionIdFromDirectory('/opt/skills/layout-cue'), 'gipllmibjmliciboegedfejkknhgccil');
  assert.equal(await extensionIdFromDirectory('/tmp/other'), 'gchcfiojnbonecennpbfcfeadkaeofkn');
  assert.match(await extensionIdFromDirectory('/tmp/other'), /^[a-p]{32}$/);
});

test('native host manifest supplies the extension ID', () => {
  const manifest = JSON.stringify({
    name: 'com.byceebee.layout_witness',
    allowed_origins: ['chrome-extension://abcdefghijklmnopabcdefghijklmnop/'],
  });
  assert.equal(extensionIdFromNativeManifest(manifest), 'abcdefghijklmnopabcdefghijklmnop');
  assert.equal(extensionIdFromNativeManifest('{}'), null);
  assert.equal(extensionIdFromNativeManifest('not json'), null);
});

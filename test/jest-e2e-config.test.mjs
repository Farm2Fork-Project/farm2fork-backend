import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('E2E setup allows a cold MongoDB replica set to start', async () => {
  const config = JSON.parse(
    await readFile(new URL('./jest-e2e.json', import.meta.url), 'utf8'),
  );

  assert.equal(config.testTimeout, 30_000);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Dockerfile provides a Debian-based E2E test target', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');

  assert.match(
    dockerfile,
    /FROM node:24\.16\.0-bookworm-slim AS test/,
  );
  assert.match(dockerfile, /CMD \["pnpm", "test:e2e", "--", "--runInBand"\]/);
});

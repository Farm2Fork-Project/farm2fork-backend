import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSuccessfulCommit } from '../lib/fabric-commit-status.mjs';

test('rejects an unsuccessful Fabric commit status', () => {
  assert.throws(() => assertSuccessfulCommit({ successful: false, transactionId: 'tx-1' }), /tx-1/);
});

test('returns a successful Fabric commit status', () => {
  assert.equal(assertSuccessfulCommit({ successful: true, transactionId: 'tx-2' }).transactionId, 'tx-2');
});

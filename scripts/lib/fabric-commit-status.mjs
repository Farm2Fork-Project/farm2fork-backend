export function assertSuccessfulCommit(status) {
  if (!status?.successful) {
    throw new Error(`Fabric commit failed: ${status?.transactionId ?? 'unknown transaction'}`);
  }
  return status;
}

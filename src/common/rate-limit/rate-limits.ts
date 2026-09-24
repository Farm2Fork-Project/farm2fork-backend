import { Throttle } from '@nestjs/throttler';

/**
 * Per-IP request budgets. The global default (RATE_LIMIT_PER_MINUTE, 300 by
 * default) covers every route; these tighter budgets are applied with
 * decorators where an unauthenticated caller can make the server do
 * disproportionate work or guess credentials.
 */
const MINUTE_MS = 60_000;

/** Public, unauthenticated reads that fan out to several collections. */
export const PublicTraceRateLimit = () =>
  Throttle({ default: { limit: 60, ttl: MINUTE_MS } });

/** Public QR image rendering (CPU-bound PNG generation). */
export const QrRenderRateLimit = () =>
  Throttle({ default: { limit: 30, ttl: MINUTE_MS } });

/** Public sign-in / onboarding exchanges: slows credential stuffing. */
export const AuthRateLimit = () =>
  Throttle({ default: { limit: 20, ttl: MINUTE_MS } });

/** Farmer AI requests: each one runs a model or pricing computation. */
export const AiRateLimit = () =>
  Throttle({ default: { limit: 20, ttl: MINUTE_MS } });

import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { ISafepayConfig } from '../../../config/safepay.config';

export interface SafepayTracker {
  token: string;
  state: string;
}

export interface SafepayCheckoutUrlParams {
  trackerToken: string;
  authToken: string;
  redirectUrl: string;
  cancelUrl: string;
}

/**
 * Thin wrapper around Safepay's Order/Passport/Reporter REST APIs and its
 * webhook HMAC scheme. Built directly from Safepay's published API reference
 * (order/payments/v3, client/passport/v1) and the HMAC-SHA512 verification
 * shown in @sfpy/node-sdk's Verify.webhook() - not their npm SDK itself,
 * which still targets an older v1 order endpoint.
 */
@Injectable()
export class SafepayClient {
  private readonly logger = new Logger(SafepayClient.name);
  private readonly config: ISafepayConfig;

  constructor(configService: ConfigService) {
    this.config = configService.getOrThrow<ISafepayConfig>('safepay');
  }

  async createTracker(params: {
    amount: number;
    currency: string;
    orderId: string;
  }): Promise<SafepayTracker> {
    const publicKey = this.requireConfig('publicKey', 'SAFEPAY_PUBLIC_KEY');
    // Cybersource (Safepay's underlying processor) takes amounts in the
    // currency's minor unit - PKR has 2 decimal places, hence x100.
    const amountInSubunits = Math.round(params.amount * 100);

    const response = await this.request<{
      data?: { tracker?: { token?: string; state?: string } };
    }>('/order/payments/v3/', {
      method: 'POST',
      body: {
        merchant_api_key: publicKey,
        intent: 'CYBERSOURCE',
        mode: 'payment',
        currency: params.currency,
        amount: amountInSubunits,
        entry_mode: 'raw',
        metadata: { order_id: params.orderId },
      },
    });

    const tracker = response.data?.tracker;
    if (!tracker?.token || !tracker.state) {
      this.logger.error(
        `Safepay tracker setup returned an unexpected shape: ${JSON.stringify(response)}`,
      );
      throw new ServiceUnavailableException(
        'Safepay did not return a payment tracker',
      );
    }
    return { token: tracker.token, state: tracker.state };
  }

  async getAuthToken(): Promise<string> {
    const secretKey = this.requireConfig('secretKey', 'SAFEPAY_SECRET_KEY');
    const response = await this.request<{ data?: string }>(
      '/client/passport/v1/token',
      {
        method: 'POST',
        headers: { 'X-SFPY-MERCHANT-SECRET': secretKey },
        body: {},
      },
    );

    if (typeof response.data !== 'string' || response.data.length === 0) {
      this.logger.error(
        `Safepay passport token returned an unexpected shape: ${JSON.stringify(response)}`,
      );
      throw new ServiceUnavailableException(
        'Safepay did not return an auth token',
      );
    }
    return response.data;
  }

  /**
   * Builds the hosted Checkout URL for a v3 tracker, the way Safepay's
   * current SDK (@sfpy/node-core `checkout.createCheckoutUrl`) does:
   * `<host>/embedded/?environment=&tracker=&tbt=&source=hosted&redirect_url=&cancel_url=`.
   * The legacy `/checkout/pay?beacon=` page only understands v1 trackers and
   * rejects a v3 tracker with "Tracker is in an invalid state".
   */
  buildCheckoutUrl(params: SafepayCheckoutUrlParams): string {
    const query = new URLSearchParams({
      environment: this.config.environment,
      tracker: params.trackerToken,
      tbt: params.authToken,
      source: 'hosted',
      redirect_url: params.redirectUrl,
      cancel_url: params.cancelUrl,
    });
    return `${this.config.checkoutBaseUrl.replace(/\/+$/, '')}/?${query.toString()}`;
  }

  /** Fallback reconciliation: fetch a tracker's current state directly. */
  async fetchPayment(trackerToken: string): Promise<unknown> {
    const secretKey = this.requireConfig('secretKey', 'SAFEPAY_SECRET_KEY');
    return this.request(`/reporter/api/v1/payments/${trackerToken}`, {
      method: 'GET',
      headers: { 'X-SFPY-MERCHANT-SECRET': secretKey },
    });
  }

  /**
   * HMAC-SHA512 (hex) with the endpoint's shared secret, header
   * `x-sfpy-signature`. Safepay's docs are ambiguous about what is hashed
   * (the raw request body in the library example, `JSON.stringify` of the
   * payload in the own-solution guide) and the older SDK hashed only
   * `data`, so every variant is accepted; each requires the secret. Which one
   * matched is logged so the scheme can be pinned down from a real delivery.
   */
  verifyWebhookSignature(
    data: unknown,
    signatureHeader: string | undefined,
    context: { body?: unknown; rawBody?: Buffer } = {},
  ): boolean {
    if (!signatureHeader) return false;
    const webhookSecret = this.requireConfig(
      'webhookSecret',
      'SAFEPAY_WEBHOOK_SECRET',
    );

    let received: Buffer;
    try {
      received = Buffer.from(signatureHeader.trim(), 'hex');
    } catch {
      return false;
    }

    const candidates: Array<[string, Buffer]> = [];
    if (context.rawBody?.length) candidates.push(['raw-body', context.rawBody]);
    if (context.body !== undefined) {
      candidates.push(['body', Buffer.from(JSON.stringify(context.body))]);
    }
    candidates.push(['data', Buffer.from(JSON.stringify(data ?? null))]);

    for (const [scheme, payload] of candidates) {
      const expected = createHmac('sha512', webhookSecret)
        .update(payload)
        .digest();
      if (
        expected.length === received.length &&
        timingSafeEqual(expected, received)
      ) {
        this.logger.log(`Safepay webhook signature verified (${scheme})`);
        return true;
      }
    }
    this.logger.warn(
      `Safepay webhook signature mismatch (tried ${candidates
        .map(([scheme]) => scheme)
        .join(', ')}; signature ${received.length} bytes)`,
    );
    return false;
  }

  // --- internals -------------------------------------------------------------

  private async request<T = unknown>(
    path: string,
    init: { method: string; headers?: Record<string, string>; body?: unknown },
  ): Promise<T> {
    const url = `${this.config.apiBaseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method,
        headers: { 'Content-Type': 'application/json', ...init.headers },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    } catch (error) {
      this.logger.error(
        `Safepay request to ${path} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException('Could not reach Safepay');
    }

    const json: unknown = await res.json().catch(() => undefined);
    if (!res.ok) {
      this.logger.error(
        `Safepay ${path} returned ${res.status}: ${JSON.stringify(json)}`,
      );
      throw new ServiceUnavailableException('Safepay rejected the request');
    }
    return json as T;
  }

  private requireConfig(
    key: 'publicKey' | 'secretKey' | 'webhookSecret',
    envVar: string,
  ): string {
    const value = this.config[key];
    if (!value) {
      throw new ServiceUnavailableException(
        `${envVar} is not configured - Safepay is unavailable`,
      );
    }
    return value;
  }
}

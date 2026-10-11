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
  orderId: string;
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
   * Builds the hosted Checkout URL. Safepay's current Express Checkout guide
   * names its params `tracker`/`tbt`; the only published, runnable reference
   * (@sfpy/node-sdk, an older v1-era build) instead emits `beacon` with no
   * `tbt` at all. Both are included below - extra query params are ignored
   * by web servers, so this is a safe hedge until confirmed against a real
   * sandbox checkout load (see the follow-up we flagged for this).
   */
  buildCheckoutUrl(params: SafepayCheckoutUrlParams): string {
    const query = new URLSearchParams({
      beacon: params.trackerToken,
      tracker: params.trackerToken,
      tbt: params.authToken,
      order_id: params.orderId,
      redirect_url: params.redirectUrl,
      cancel_url: params.cancelUrl,
      env: this.config.environment,
      source: 'hosted',
      webhooks: 'true',
    });
    return `${this.config.checkoutBaseUrl}/pay?${query.toString()}`;
  }

  /** Fallback reconciliation: fetch a tracker's current state directly. */
  async fetchPayment(trackerToken: string): Promise<unknown> {
    const secretKey = this.requireConfig('secretKey', 'SAFEPAY_SECRET_KEY');
    return this.request(`/reporter/api/v2/payments/${trackerToken}`, {
      method: 'GET',
      headers: { 'X-SFPY-MERCHANT-SECRET': secretKey },
    });
  }

  /**
   * Mirrors @sfpy/node-sdk's Verify.webhook(): HMAC-SHA512 over
   * JSON.stringify(body.data), header `x-sfpy-signature`. Compares with
   * timingSafeEqual rather than the SDK's plain `===`.
   */
  verifyWebhookSignature(
    data: unknown,
    signatureHeader: string | undefined,
  ): boolean {
    if (!signatureHeader) return false;
    const webhookSecret = this.requireConfig(
      'webhookSecret',
      'SAFEPAY_WEBHOOK_SECRET',
    );

    const serializedData = Buffer.from(JSON.stringify(data ?? null));
    const expectedHex = createHmac('sha512', webhookSecret)
      .update(serializedData)
      .digest('hex');

    let expected: Buffer;
    let received: Buffer;
    try {
      expected = Buffer.from(expectedHex, 'hex');
      received = Buffer.from(signatureHeader, 'hex');
    } catch {
      return false;
    }
    if (expected.length !== received.length) return false;
    return timingSafeEqual(expected, received);
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

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { SafepayClient } from './safepay.client';

const baseConfig = {
  enabled: true,
  environment: 'sandbox' as const,
  apiBaseUrl: 'https://sandbox.api.getsafepay.com',
  checkoutBaseUrl: 'https://sandbox.api.getsafepay.com/embedded',
  publicKey: 'sec_public',
  secretKey: 'secret_key',
  webhookSecret: 'webhook_secret',
  redirectUrl: 'http://localhost/order/complete',
  cancelUrl: 'http://localhost/order/cancel',
};

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('SafepayClient', () => {
  let client: SafepayClient;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    const configService = {
      getOrThrow: jest.fn().mockReturnValue(baseConfig),
    } as unknown as ConfigService;
    client = new SafepayClient(configService);
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it('creates a tracker with amount converted to minor units', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: { tracker: { token: 'track_1', state: 'TRACKER_STARTED' } },
      }),
    );

    const tracker = await client.createTracker({
      amount: 870,
      currency: 'PKR',
      orderId: 'order-1',
    });

    expect(tracker).toEqual({ token: 'track_1', state: 'TRACKER_STARTED' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sandbox.api.getsafepay.com/order/payments/v3/');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.amount).toBe(87000);
    expect(body.merchant_api_key).toBe('sec_public');
    expect(init.headers).not.toHaveProperty('X-SFPY-MERCHANT-SECRET');
  });

  it('throws when Safepay does not return a tracker token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: {} }));

    await expect(
      client.createTracker({
        amount: 100,
        currency: 'PKR',
        orderId: 'order-1',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('requests an auth token with the merchant secret header', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: 'tbt_token' }));

    const token = await client.getAuthToken();

    expect(token).toBe('tbt_token');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://sandbox.api.getsafepay.com/client/passport/v1/token',
    );
    expect(
      (init.headers as Record<string, string>)['X-SFPY-MERCHANT-SECRET'],
    ).toBe('secret_key');
  });

  it('wraps a non-2xx Safepay response in ServiceUnavailableException', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'bad request' }, false, 400),
    );

    await expect(client.getAuthToken()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('builds the v3 embedded checkout URL used by the official SDK', () => {
    const url = client.buildCheckoutUrl({
      trackerToken: 'track_1',
      authToken: 'tbt_1',
      redirectUrl: 'http://localhost/complete',
      cancelUrl: 'http://localhost/cancel',
    });

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      'https://sandbox.api.getsafepay.com/embedded/',
    );
    expect(parsed.searchParams.get('tracker')).toBe('track_1');
    expect(parsed.searchParams.get('tbt')).toBe('tbt_1');
    expect(parsed.searchParams.get('environment')).toBe('sandbox');
    expect(parsed.searchParams.get('source')).toBe('hosted');
    expect(parsed.searchParams.get('redirect_url')).toBe(
      'http://localhost/complete',
    );
    expect(parsed.searchParams.get('cancel_url')).toBe(
      'http://localhost/cancel',
    );
    // The legacy v1 page's parameters must not be sent with a v3 tracker.
    expect(parsed.searchParams.has('beacon')).toBe(false);
  });

  it('verifies a webhook signature computed the same way as the payload data', () => {
    const data = { token: 'track_1', status: 'success' };
    const signature = createHmac('sha512', baseConfig.webhookSecret)
      .update(Buffer.from(JSON.stringify(data)))
      .digest('hex');

    expect(client.verifyWebhookSignature(data, signature)).toBe(true);
    expect(client.verifyWebhookSignature(data, 'wrong')).toBe(false);
    expect(client.verifyWebhookSignature(data, undefined)).toBe(false);
  });

  it('rejects a tampered webhook payload', () => {
    const original = { token: 'track_1', status: 'success' };
    const signature = createHmac('sha512', baseConfig.webhookSecret)
      .update(Buffer.from(JSON.stringify(original)))
      .digest('hex');

    const tampered = { token: 'track_1', status: 'failed' };
    expect(client.verifyWebhookSignature(tampered, signature)).toBe(false);
  });

  describe('webhook signature schemes', () => {
    const body = {
      type: 'payment.failed',
      version: '2.0.0',
      data: { tracker: 'track_1', code: 403, metadata: { order_id: 'o1' } },
    };
    const hmac = (payload: Buffer) =>
      createHmac('sha512', baseConfig.webhookSecret)
        .update(payload)
        .digest('hex');

    it('accepts a signature over the exact raw request body', () => {
      const rawBody = Buffer.from(JSON.stringify(body, null, 2));
      expect(
        client.verifyWebhookSignature(body.data, hmac(rawBody), {
          body,
          rawBody,
        }),
      ).toBe(true);
    });

    it('accepts a signature over the whole parsed payload', () => {
      const signature = hmac(Buffer.from(JSON.stringify(body)));
      expect(
        client.verifyWebhookSignature(body.data, signature, { body }),
      ).toBe(true);
    });

    it('rejects a signature made with another secret or over other content', () => {
      const forged = createHmac('sha512', 'not-the-secret')
        .update(Buffer.from(JSON.stringify(body)))
        .digest('hex');
      const rawBody = Buffer.from(JSON.stringify(body));
      expect(
        client.verifyWebhookSignature(body.data, forged, { body, rawBody }),
      ).toBe(false);
      // A data-only signature must not let the event type be swapped when the
      // sender signed the whole body, and vice versa: content decides.
      expect(
        client.verifyWebhookSignature(body.data, hmac(Buffer.from('other')), {
          body,
          rawBody,
        }),
      ).toBe(false);
    });
  });
});

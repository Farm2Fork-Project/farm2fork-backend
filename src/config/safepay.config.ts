import { registerAs } from '@nestjs/config';

export type SafepayEnvironment = 'sandbox' | 'production';

export interface ISafepayConfig {
  enabled: boolean;
  environment: SafepayEnvironment;
  apiBaseUrl: string;
  checkoutBaseUrl: string;
  publicKey?: string;
  secretKey?: string;
  webhookSecret?: string;
  redirectUrl?: string;
  cancelUrl?: string;
}

export const safepayConfig = registerAs('safepay', (): ISafepayConfig => {
  const environment = (process.env.SAFEPAY_ENVIRONMENT ??
    'sandbox') as SafepayEnvironment;
  const isProduction = environment === 'production';

  return {
    enabled: process.env.SAFEPAY_ENABLED === 'true',
    environment,
    apiBaseUrl:
      process.env.SAFEPAY_API_BASE_URL ??
      (isProduction
        ? 'https://api.getsafepay.com'
        : 'https://sandbox.api.getsafepay.com'),
    checkoutBaseUrl:
      process.env.SAFEPAY_CHECKOUT_BASE_URL ??
      (isProduction
        ? 'https://getsafepay.com/embedded'
        : 'https://sandbox.api.getsafepay.com/embedded'),
    publicKey: process.env.SAFEPAY_PUBLIC_KEY,
    secretKey: process.env.SAFEPAY_SECRET_KEY,
    webhookSecret: process.env.SAFEPAY_WEBHOOK_SECRET,
    redirectUrl: process.env.SAFEPAY_REDIRECT_URL,
    cancelUrl: process.env.SAFEPAY_CANCEL_URL,
  };
});

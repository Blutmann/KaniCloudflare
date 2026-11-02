import { describe, expect, it } from 'vitest';
import { isPaywayProductionBase, isPaywaySandboxBase } from './kani-payway';
import { readPaywayConfig } from './kani-payway.server';

describe('Payway Production Transition & Environment Gates', () => {
  it('correctly classifies production endpoints vs sandbox endpoints', () => {
    // Production endpoints
    expect(isPaywayProductionBase('https://ventasonline.payway.com.ar/api/v2')).toBe(true);
    expect(isPaywayProductionBase('https://live.decidir.com/api/v2')).toBe(true);
    expect(isPaywayProductionBase('https://ventasonline.payway.com.ar')).toBe(true);
    expect(isPaywayProductionBase('https://live.decidir.com')).toBe(true);

    // Sandbox endpoints should NOT match production
    expect(isPaywayProductionBase('https://developers-ventasonline.payway.com.ar/api/v2')).toBe(false);
    expect(isPaywayProductionBase('https://developers.decidir.com/api/v2')).toBe(false);

    // Arbitrary endpoints should NOT match production
    expect(isPaywayProductionBase('https://evil.payway.fake.com')).toBe(false);
    expect(isPaywayProductionBase('')).toBe(false);

    // Sandbox classification
    expect(isPaywaySandboxBase('https://developers-ventasonline.payway.com.ar/api/v2')).toBe(true);
    expect(isPaywaySandboxBase('https://developers.decidir.com/api/v2')).toBe(true);
    expect(isPaywaySandboxBase('https://ventasonline.payway.com.ar/api/v2')).toBe(false);
  });

  it('rejects production mode if sandbox is also enabled (conflicting configuration)', () => {
    const env: Record<string, string> = {
      PAYWAY_ENVIRONMENT: 'production',
      PAYWAY_PRODUCTION_ENABLED: 'true',
      PAYWAY_SANDBOX_ENABLED: 'true', // Conflict!
      PAYWAY_API_BASE_URL: 'https://ventasonline.payway.com.ar/api/v2',
      PAYWAY_PUBLIC_API_KEY: 'live_public_key',
      PAYWAY_PRIVATE_API_KEY: 'live_private_key',
      PAYWAY_SITE_ID: '93146639',
      PAYWAY_CHECKOUT_SECRET: 's'.repeat(32),
      SUPABASE_URL: 'https://iockpxtkflyjfagkvgnr.supabase.co',
      PAYWAY_PAYMENT_METHODS: JSON.stringify([{ id: 1, label: 'Visa' }]),
    };
    expect(readPaywayConfig(k => env[k])).toBeNull();
  });

  it('rejects production mode if credentials or site ID are missing', () => {
    const baseEnv: Record<string, string> = {
      PAYWAY_ENVIRONMENT: 'production',
      PAYWAY_PRODUCTION_ENABLED: 'true',
      PAYWAY_SANDBOX_ENABLED: 'false',
      PAYWAY_API_BASE_URL: 'https://ventasonline.payway.com.ar/api/v2',
      PAYWAY_CHECKOUT_SECRET: 's'.repeat(32),
      SUPABASE_URL: 'https://iockpxtkflyjfagkvgnr.supabase.co',
      PAYWAY_PAYMENT_METHODS: JSON.stringify([{ id: 1, label: 'Visa' }]),
    };
    // Missing all credentials
    expect(readPaywayConfig(k => baseEnv[k])).toBeNull();
    // Missing private key
    expect(readPaywayConfig(k => ({ ...baseEnv, PAYWAY_PUBLIC_API_KEY: 'pub', PAYWAY_SITE_ID: '12345' }[k]))).toBeNull();
    // Missing site id
    expect(readPaywayConfig(k => ({ ...baseEnv, PAYWAY_PUBLIC_API_KEY: 'pub', PAYWAY_PRIVATE_API_KEY: 'priv' }[k]))).toBeNull();
  });

  it('successfully initializes production configuration with dedicated production keys', () => {
    const env: Record<string, string> = {
      PAYWAY_ENVIRONMENT: 'production',
      PAYWAY_PRODUCTION_ENABLED: 'true',
      PAYWAY_SANDBOX_ENABLED: 'false',
      PAYWAY_API_BASE_URL: 'https://live.decidir.com/api/v2',
      PAYWAY_PRODUCTION_PUBLIC_KEY: 'live_public_key_abc',
      PAYWAY_PRODUCTION_PRIVATE_KEY: 'live_private_key_xyz',
      PAYWAY_PRODUCTION_SITE_ID: '93146639',
      PAYWAY_CHECKOUT_SECRET: 's'.repeat(32),
      SUPABASE_URL: 'https://iockpxtkflyjfagkvgnr.supabase.co',
      PAYWAY_PAYMENT_METHODS: JSON.stringify([
        { id: 1, label: 'Visa' },
        { id: 104, label: 'Mastercard' },
      ]),
    };
    const config = readPaywayConfig(k => env[k]);
    expect(config).not.toBeNull();
    expect(config?.apiBaseUrl).toBe('https://live.decidir.com/api/v2');
    expect(config?.publicKey).toBe('live_public_key_abc');
    expect(config?.privateKey).toBe('live_private_key_xyz');
    expect(config?.siteId).toBe('93146639');
    expect(config?.methods).toHaveLength(2);
  });
});

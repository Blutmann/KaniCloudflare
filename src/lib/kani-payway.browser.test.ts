import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenizePaywayForm } from './kani-payway.browser';
const checkout = { appointmentId: 'fixture', attemptId: 'fixture', accessToken: 'fixture', depositArs: 5000,
  publicKey: 'public-fixture', apiBaseUrl: 'https://developers-ventasonline.payway.com.ar/api/v2', methods: [{ id: 1, label: 'Visa' }] };
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });
describe('Payway tokenization directly from browser (mocked fetch)', () => {
  it('sends card data exclusively to the allowlisted Payway sandbox and returns only token/BIN', async () => {
    const form = document.createElement('form');
    for (const [name, value] of Object.entries({ card_number: '4507990000004905', security_code: '123', card_expiration_month: '12',
      card_expiration_year: '29', card_holder_name: 'Titular ficticio', card_holder_doc_number: '12345678' })) {
      const input = document.createElement('input'); input.name = name; input.value = value; form.append(input);
    }
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'fixture-token', bin: '450799', last_four_digits: '4905', status: 'active' }), { status: 201 }));
    vi.stubGlobal('fetch', fetcher);
    expect(await tokenizePaywayForm(form, checkout)).toEqual({ token: 'fixture-token', bin: '450799' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toBe(`${checkout.apiBaseUrl}/tokens`);
    expect(fetcher.mock.calls[0]![1].headers.apikey).toBe(checkout.publicKey);
    expect(fetcher.mock.calls[0]![1].credentials).toBe('omit');
  });
  it('refuses production and arbitrary hosts before reading the form', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    for (const apiBaseUrl of ['https://ventasonline.payway.com.ar/api/v2', 'https://example.test']) {
      await expect(tokenizePaywayForm(document.createElement('form'), { ...checkout, apiBaseUrl })).rejects.toThrow('PAYWAY_TOKENIZATION_UNAVAILABLE');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('never includes the provider error body in a thrown error', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('fixture-provider-sensitive-error', { status: 400 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(tokenizePaywayForm(document.createElement('form'), checkout)).rejects.toThrow('PAYWAY_TOKENIZATION_FAILED');
  });
});

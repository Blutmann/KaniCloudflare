import { describe, it, expect } from 'vitest';
import {
  computeCancellationSignature,
  verifyCancellationSignature,
  buildCancellationUrl,
} from './kani-cancellation-token';

describe('Kani Cancellation Token & URL', () => {
  const sampleAppointmentId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

  it('generates a 64-character HMAC-SHA256 hex string', () => {
    const token = computeCancellationSignature(sampleAppointmentId);
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
  });

  it('is deterministic for the same appointment ID', () => {
    const token1 = computeCancellationSignature(sampleAppointmentId);
    const token2 = computeCancellationSignature(sampleAppointmentId);
    expect(token1).toBe(token2);
  });

  it('produces different tokens for different appointment IDs', () => {
    const token1 = computeCancellationSignature(sampleAppointmentId);
    const token2 = computeCancellationSignature('00000000-0000-0000-0000-000000000001');
    expect(token1).not.toBe(token2);
  });

  it('verifies a valid token successfully', () => {
    const token = computeCancellationSignature(sampleAppointmentId);
    expect(verifyCancellationSignature(sampleAppointmentId, token)).toBe(true);
  });

  it('rejects verification if the appointment ID is altered', () => {
    const token = computeCancellationSignature(sampleAppointmentId);
    const alteredId = 'f47ac10b-58cc-4372-a567-0e02b2c3d480';
    expect(verifyCancellationSignature(alteredId, token)).toBe(false);
  });

  it('rejects verification if the token is forged or corrupted', () => {
    const token = computeCancellationSignature(sampleAppointmentId);
    const corruptedToken = token.slice(0, -4) + 'abcd';
    expect(verifyCancellationSignature(sampleAppointmentId, corruptedToken)).toBe(false);
    expect(verifyCancellationSignature(sampleAppointmentId, 'invalid-token')).toBe(false);
    expect(verifyCancellationSignature(sampleAppointmentId, '')).toBe(false);
  });

  it('builds a secure cancellation URL without personal data in search params', () => {
    const url = buildCancellationUrl(sampleAppointmentId, 'https://www.kanibarber.com');
    expect(url).toContain('https://www.kanibarber.com/cancelar-turno?');
    expect(url).toContain(`id=${sampleAppointmentId}`);
    expect(url).toContain('token=');
    // Ensure no client personal info (name, email, phone) is present in URL
    expect(url).not.toContain('email=');
    expect(url).not.toContain('phone=');
    expect(url).not.toContain('name=');
  });
});

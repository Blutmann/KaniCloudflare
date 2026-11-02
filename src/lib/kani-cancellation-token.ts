import { createHmac, timingSafeEqual } from 'node:crypto';
import { getRuntimeEnv } from './kani-notifications.server';

/**
 * Secret key used to sign appointment cancellation tokens.
 * Falls back to PAYWAY_CHECKOUT_SECRET, SUPABASE_SERVICE_ROLE_KEY or JWT_SECRET.
 */
export function getCancellationSecret(): string {
  return (
    getRuntimeEnv('KANI_CANCELLATION_SECRET') ||
    getRuntimeEnv('PAYWAY_CHECKOUT_SECRET') ||
    getRuntimeEnv('SUPABASE_SERVICE_ROLE_KEY') ||
    getRuntimeEnv('JWT_SECRET') ||
    'kani-secure-appointment-cancellation-secret-2026'
  );
}

/**
 * Computes a non-predictable HMAC-SHA256 signature scoped exclusively
 * to the given appointment ID and cancellation action.
 */
export function computeCancellationSignature(appointmentId: string): string {
  const secret = getCancellationSecret();
  const cleanId = (appointmentId || '').trim().toLowerCase();
  const raw = `kani:cancel-appointment:${cleanId}`;
  return createHmac('sha256', secret).update(raw).digest('hex');
}

/**
 * Constant-time verification of the cancellation token.
 * Prevents timing attacks and ensures the token matches the exact appointment ID.
 */
export function verifyCancellationSignature(appointmentId: string, token: string): boolean {
  if (!appointmentId || typeof appointmentId !== 'string') return false;
  if (!token || typeof token !== 'string') return false;

  const expected = computeCancellationSignature(appointmentId);
  const cleanToken = token.trim().toLowerCase();

  if (cleanToken.length !== expected.length) return false;

  try {
    return timingSafeEqual(Buffer.from(cleanToken), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Builds the canonical unique cancellation URL for an appointment.
 * Example: https://www.kanibarber.com/cancelar-turno?id={uuid}&token={hmac}
 */
export function buildCancellationUrl(appointmentId: string, appUrl?: string): string {
  const base = (
    appUrl ||
    getRuntimeEnv('KANI_APP_URL') ||
    getRuntimeEnv('APP_URL') ||
    'https://www.kanibarber.com'
  ).replace(/\/$/, '');

  const token = computeCancellationSignature(appointmentId);
  return `${base}/cancelar-turno?id=${encodeURIComponent(appointmentId.trim())}&token=${encodeURIComponent(token)}`;
}

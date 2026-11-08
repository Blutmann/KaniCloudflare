import { createHmac, timingSafeEqual } from "node:crypto";

export type ResendWebhookVerificationResult = {
  valid: boolean;
  reason?: string;
};

/**
 * Valida la firma oficial de webhooks de Resend (estándar Svix).
 *
 * Headers obligatorios:
 * - svix-id: identificador único del mensaje
 * - svix-timestamp: timestamp en segundos unix
 * - svix-signature: lista de firmas separadas por espacio, cada una en formato "v1,<base64>"
 *
 * Fórmula:
 *   to_sign = `${svix_id}.${svix_timestamp}.${rawBody}`
 *   signature = base64(hmac_sha256(secret_bytes, to_sign))
 *
 * Donde secret_bytes es el webhook secret (si comienza con "whsec_", se remueve el prefijo
 * y el resto se decodifica desde base64; si no tiene prefijo, se usa directamente como UTF-8).
 */
export function verifyResendWebhookSignature({
  rawBody,
  svixId,
  svixTimestamp,
  svixSignature,
  secret,
  toleranceSeconds = 300,
}: {
  rawBody: string;
  svixId: string | null | undefined;
  svixTimestamp: string | null | undefined;
  svixSignature: string | null | undefined;
  secret: string | null | undefined;
  toleranceSeconds?: number;
}): ResendWebhookVerificationResult {
  if (!secret || !secret.trim()) {
    return { valid: false, reason: "SECRET_MISSING" };
  }

  if (!svixId || !svixId.trim()) {
    return { valid: false, reason: "SVIX_ID_MISSING" };
  }

  if (!svixTimestamp || !svixTimestamp.trim()) {
    return { valid: false, reason: "SVIX_TIMESTAMP_MISSING" };
  }

  if (!svixSignature || !svixSignature.trim()) {
    return { valid: false, reason: "SVIX_SIGNATURE_MISSING" };
  }

  // Validación de tolerancia temporal (protección contra replay attacks)
  const timestampNum = parseInt(svixTimestamp.trim(), 10);
  if (Number.isNaN(timestampNum)) {
    return { valid: false, reason: "SVIX_TIMESTAMP_INVALID" };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampNum) > toleranceSeconds) {
    return {
      valid: false,
      reason: `TIMESTAMP_OUT_OF_TOLERANCE: diff=${Math.abs(nowSeconds - timestampNum)}s > ${toleranceSeconds}s`,
    };
  }

  try {
    let keyBytes: Buffer;
    const cleanSecret = secret.trim();
    if (cleanSecret.startsWith("whsec_")) {
      keyBytes = Buffer.from(cleanSecret.slice(6), "base64");
    } else {
      keyBytes = Buffer.from(cleanSecret, "utf-8");
    }

    const toSign = `${svixId.trim()}.${svixTimestamp.trim()}.${rawBody}`;
    const expectedSignatureBase64 = createHmac("sha256", keyBytes)
      .update(toSign)
      .digest("base64");

    const expectedBuffer = Buffer.from(expectedSignatureBase64, "utf-8");

    // svix-signature puede contener múltiples firmas separadas por espacio: "v1,sig1 v1,sig2"
    const signatures = svixSignature.trim().split(" ");
    for (const sigPart of signatures) {
      const [version, sigBase64] = sigPart.split(",");
      if (version === "v1" && sigBase64) {
        const candidateBuffer = Buffer.from(sigBase64.trim(), "utf-8");
        if (
          candidateBuffer.length === expectedBuffer.length &&
          timingSafeEqual(candidateBuffer, expectedBuffer)
        ) {
          return { valid: true };
        }
      }
    }

    return { valid: false, reason: "SIGNATURE_MISMATCH" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, reason: `VERIFICATION_ERROR: ${message}` };
  }
}

/**
 * Cache en memoria para deduplicación idempotente de eventos recibidos por webhook de Resend.
 */
const processedResendEventIds = new Set<string>();
const MAX_PROCESSED_EVENTS = 1000;

export function isResendEventDuplicate(eventId: string): boolean {
  if (processedResendEventIds.has(eventId)) {
    return true;
  }
  if (processedResendEventIds.size >= MAX_PROCESSED_EVENTS) {
    const firstKey = processedResendEventIds.values().next().value;
    if (firstKey) processedResendEventIds.delete(firstKey);
  }
  processedResendEventIds.add(eventId);
  return false;
}

/** Release a failed attempt so a provider retry can persist the signed receipt. */
export function forgetFailedResendEvent(eventId: string): void {
  processedResendEventIds.delete(eventId);
}

export function clearProcessedResendEventsForTest(): void {
  processedResendEventIds.clear();
}

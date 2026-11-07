import { describe, it, expect, beforeEach } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import {
  verifyResendWebhookSignature,
  isResendEventDuplicate,
  clearProcessedResendEventsForTest,
  forgetFailedResendEvent,
} from "@/lib/kani-resend-webhook";

describe("Resend Webhook Official Svix Signature Verification & Idempotency", () => {
  let secretWithPrefix: string;
  const rawBody = JSON.stringify({
    type: "email.delivered",
    data: {
      email_id: "resend-msg-12345",
      to: ["cliente@gmail.com"],
    },
  });

  beforeEach(() => {
    clearProcessedResendEventsForTest();
    // Credencial efímera sintética generada en memoria en tiempo de ejecución:
    // preserva la cobertura de Svix (prefijo whsec_ + base64) sin cadenas estáticas fijas.
    secretWithPrefix = `whsec_${randomBytes(32).toString('base64')}`;
  });

  function generateValidSignature(
    secret: string,
    id: string,
    timestamp: number,
    body: string
  ): string {
    const cleanSecret = secret.startsWith("whsec_")
      ? Buffer.from(secret.slice(6), "base64")
      : Buffer.from(secret, "utf-8");
    const toSign = `${id}.${timestamp}.${body}`;
    const sig = createHmac("sha256", cleanSecret).update(toSign).digest("base64");
    return `v1,${sig}`;
  }

  it("acepta una firma Svix válida dentro del período de tolerancia", () => {
    const id = "msg_12345";
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = generateValidSignature(secretWithPrefix, id, timestamp, rawBody);

    const result = verifyResendWebhookSignature({
      rawBody,
      svixId: id,
      svixTimestamp: String(timestamp),
      svixSignature: signature,
      secret: secretWithPrefix,
    });

    expect(result.valid).toBe(true);
  });

  it("rechaza si falta el secreto del webhook", () => {
    const result = verifyResendWebhookSignature({
      rawBody,
      svixId: "msg_123",
      svixTimestamp: String(Math.floor(Date.now() / 1000)),
      svixSignature: "v1,abc",
      secret: "",
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("SECRET_MISSING");
  });

  it("rechaza si la firma está alterada", () => {
    const id = "msg_12345";
    const timestamp = Math.floor(Date.now() / 1000);

    const result = verifyResendWebhookSignature({
      rawBody,
      svixId: id,
      svixTimestamp: String(timestamp),
      svixSignature: "v1,invalidBase64Signature==",
      secret: secretWithPrefix,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("SIGNATURE_MISMATCH");
  });

  it("rechaza si el timestamp es más antiguo que la tolerancia (300s)", () => {
    const id = "msg_12345";
    const oldTimestamp = Math.floor(Date.now() / 1000) - 400; // 400s atrás
    const signature = generateValidSignature(secretWithPrefix, id, oldTimestamp, rawBody);

    const result = verifyResendWebhookSignature({
      rawBody,
      svixId: id,
      svixTimestamp: String(oldTimestamp),
      svixSignature: signature,
      secret: secretWithPrefix,
      toleranceSeconds: 300,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("TIMESTAMP_OUT_OF_TOLERANCE");
  });

  it("detecta eventos duplicados mediante idempotencia en memoria", () => {
    const eventId = "svix_event_9999";
    expect(isResendEventDuplicate(eventId)).toBe(false);
    expect(isResendEventDuplicate(eventId)).toBe(true);
    expect(isResendEventDuplicate("svix_event_otro")).toBe(false);
  });
  it('permite reintentar la persistencia cuando falló el primer procesamiento',()=>{
    expect(isResendEventDuplicate('retry-persist')).toBe(false);
    forgetFailedResendEvent('retry-persist');
    expect(isResendEventDuplicate('retry-persist')).toBe(false);
    expect(isResendEventDuplicate('retry-persist')).toBe(true);
  });
});

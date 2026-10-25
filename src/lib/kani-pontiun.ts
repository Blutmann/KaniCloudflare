import { createHmac, timingSafeEqual } from "node:crypto";

export type PontiunAppointmentPayload = {
  appointmentId: string;
  clientName: string;
  clientPhone?: string | null;
  barberName?: string | null;
  serviceName?: string | null;
  bookingDate?: string | null;
  startTime?: string | null;
};

export type PontiunSendResult = {
  success: boolean;
  messageId?: string;
  error?: string;
  skipped?: boolean;
  idempotentReplay?: boolean;
};

export type PontiunWebhookVerificationResult = {
  valid: boolean;
  reason?: string;
};

/**
 * Consulta de forma segura las variables de entorno disponibles en Cloudflare Workers,
 * globalThis.__KANI_RUNTIME_ENV o process.env.
 */
export function getPontiunRuntimeEnv(name: string): string | undefined {
  const globalObj = globalThis as typeof globalThis & {
    __env__?: Record<string, unknown>;
    __KANI_RUNTIME_ENV?: Record<string, string>;
  };
  const runtimeValue =
    globalObj.__env__?.[name] ??
    globalObj.__KANI_RUNTIME_ENV?.[name] ??
    (typeof process !== "undefined" ? process.env[name] : undefined);
  return typeof runtimeValue === "string" && runtimeValue.trim()
    ? runtimeValue.trim()
    : undefined;
}

/**
 * Normaliza un número telefónico al formato internacional numérico (sin '+', espacios ni guiones)
 * requerido por Pontiun y Meta Cloud API para WhatsApp.
 *
 * En Argentina (+54):
 * - Los números móviles de WhatsApp requieren el prefijo internacional '549' seguido del código de área sin el 0
 *   y del número de abonado sin el 15 (ej: +54 9 11 5561-6438 -> "5491155616438").
 * - Previene duplicaciones accidentales de '54', '9' o códigos de área.
 *
 * Para otros países:
 * - Conserva el código de país internacional y los dígitos restantes.
 *
 * Retorna null si el número no cuenta con la longitud o estructura mínima requerida (8 a 15 dígitos).
 */
export function normalizePhoneForPontiun(phone?: string | null): string | null {
  if (!phone || typeof phone !== "string") return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;

  const rawDigits = trimmed.replace(/\D/g, "");
  if (!rawDigits || rawDigits.length < 8) return null;

  // Caso 1: Ya comienza con '549'
  if (rawDigits.startsWith("549")) {
    let rest = rawDigits.slice(3);
    // Eliminar ceros iniciales o '15' residual o un 9 redundante accidental (ej: 549911...)
    if (rest.startsWith("9") && rest.length > 10) {
      rest = rest.slice(1);
    }
    if (rest.startsWith("0")) {
      rest = rest.replace(/^0+/, "");
    }
    if (rest.length === 10) {
      return `549${rest}`;
    }
    // Si tiene entre 10 y 11 dígitos, verificar si contiene '15' después del código de área
    if (rest.length === 12 && rest.slice(2, 4) === "15") {
      return `549${rest.slice(0, 2)}${rest.slice(4)}`;
    }
    return `549${rest}`;
  }

  // Caso 2: Comienza con '54' pero sin el '9'
  if (rawDigits.startsWith("54")) {
    let rest = rawDigits.slice(2).replace(/^0+/, "");
    // Si viene con un '15' móvil tradicional (ej: 54 11 15 55616438)
    if (rest.length === 12 && rest.slice(2, 4) === "15") {
      rest = `${rest.slice(0, 2)}${rest.slice(4)}`;
    }
    return `549${rest}`;
  }

  // Caso 3: Número local argentino que comienza con '0' (ej: 011 5561-6438 o 011 15 5561-6438)
  if (rawDigits.startsWith("0")) {
    let rest = rawDigits.replace(/^0+/, "");
    if (rest.length === 12 && rest.slice(2, 4) === "15") {
      rest = `${rest.slice(0, 2)}${rest.slice(4)}`;
    } else if (rest.length === 10 && rest.startsWith("15")) {
      // Falta código de área, se asume Buenos Aires AMBA (11)
      rest = `11${rest.slice(2)}`;
    }
    return `549${rest}`;
  }

  // Caso 4: Número móvil de 10 dígitos nacional sin código de país (ej: 1155616438)
  if (rawDigits.length === 10 && /^[1-9]/.test(rawDigits)) {
    return `549${rawDigits}`;
  }

  // Caso 5: Número con '+' inicial que pertenece a otro país (ej: +1, +598, +56, etc.)
  if (trimmed.startsWith("+")) {
    return rawDigits.length >= 8 && rawDigits.length <= 15 ? rawDigits : null;
  }

  // Caso 6: Dígitos internacionales estándar (8 a 15 dígitos)
  if (rawDigits.length >= 8 && rawDigits.length <= 15) {
    return rawDigits;
  }

  return null;
}

/**
 * Valida la firma criptográfica HMAC-SHA256 incluida en los webhooks de Pontiun.
 *
 * Especificación oficial de Pontiun (docs.pontiun.com):
 * - Cabecera resender-event-id: Identificador determinístico del evento (^evt_[0-9a-f]{32}$)
 * - Cabecera resender-timestamp: Timestamp Unix en segundos de la firma (^[0-9]+$)
 * - Cabecera resender-signature: Firma calculada con prefijo 'v1=' en hexadecimal
 *
 * Fórmula oficial:
 *   v1 = HMAC-SHA256(secret, "{eventId}.{timestamp}.{rawBody}")
 *
 * Mitigación de seguridad:
 * - Comparación segura en tiempo constante (timingSafeEqual).
 * - Protección contra ataques de repetición (timestamp dentro de la tolerancia de 300 segundos).
 */
export function verifyPontiunWebhookSignature({
  rawBody,
  eventId,
  timestamp,
  signature,
  secret,
  toleranceSeconds = 300,
}: {
  rawBody: string;
  eventId: string | null | undefined;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  secret: string | null | undefined;
  toleranceSeconds?: number;
}): PontiunWebhookVerificationResult {
  if (!secret || !secret.trim()) {
    return { valid: false, reason: "SECRET_MISSING" };
  }
  if (!eventId || !eventId.trim()) {
    return { valid: false, reason: "EVENT_ID_MISSING" };
  }
  if (!timestamp || !timestamp.trim()) {
    return { valid: false, reason: "TIMESTAMP_MISSING" };
  }
  if (!signature || !signature.trim()) {
    return { valid: false, reason: "SIGNATURE_MISSING" };
  }

  // Validar timestamp para mitigar replay attacks
  const tsNumber = parseInt(timestamp.trim(), 10);
  if (isNaN(tsNumber) || tsNumber <= 0) {
    return { valid: false, reason: "INVALID_TIMESTAMP_FORMAT" };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - tsNumber) > toleranceSeconds) {
    return { valid: false, reason: "TIMESTAMP_EXPIRED" };
  }

  // Extraer el hash hexadecimal (soporta formato con 'v1=' y formato directo)
  const trimmedSig = signature.trim();
  const hexSignature = trimmedSig.startsWith("v1=")
    ? trimmedSig.slice(3).trim()
    : trimmedSig;

  if (!/^[0-9a-fA-F]{64}$/.test(hexSignature)) {
    return { valid: false, reason: "INVALID_SIGNATURE_HEX" };
  }

  try {
    const manifest = `${eventId.trim()}.${timestamp.trim()}.${rawBody}`;
    const computedHmac = createHmac("sha256", secret.trim())
      .update(manifest)
      .digest("hex");

    const computedBuffer = Buffer.from(computedHmac, "hex");
    const receivedBuffer = Buffer.from(hexSignature, "hex");

    if (computedBuffer.length !== receivedBuffer.length) {
      return { valid: false, reason: "SIGNATURE_LENGTH_MISMATCH" };
    }

    const matches = timingSafeEqual(computedBuffer, receivedBuffer);
    if (!matches) {
      return { valid: false, reason: "SIGNATURE_MISMATCH" };
    }

    return { valid: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Pontiun Webhook] Error al verificar firma:", message);
    return { valid: false, reason: `VERIFICATION_ERROR: ${message}` };
  }
}

/**
 * Cache en memoria para deduplicación idempotente de eventos recibidos por webhook.
 * Limita el tamaño a 1000 eventos para mantener bajo el uso de memoria en Worker.
 */
const processedWebhookEventIds = new Set<string>();
const MAX_PROCESSED_EVENTS = 1000;

export function clearProcessedWebhookEventsForTest(): void {
  processedWebhookEventIds.clear();
}

/**
 * Maneja solicitudes dirigidas a /api/webhook/pontiun.
 * Cumple con el contrato oficial de Pontiun:
 * - Valida firma si PONTIUN_WEBHOOK_SECRET está configurado.
 * - Registra eventos entrantes (mensajes de clientes) de forma segura y sin bucles.
 * - Responde rápidamente con 200 OK (< 5 segundos).
 */
export async function handlePontiunWebhookRequest(request: Request): Promise<Response> {
  const method = request.method.toUpperCase();

  // GET / HEAD: Comprobación de estado para pruebas y herramientas de verificación
  if (method === "GET" || method === "HEAD") {
    return new Response(
      JSON.stringify({
        service: "pontiun-webhook",
        endpoint: "/api/webhook/pontiun",
        status: "active",
        methodExpected: "POST",
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method Not Allowed", expected: "POST" }),
      {
        status: 405,
        headers: { "Content-Type": "application/json", Allow: "POST, GET, HEAD" },
      },
    );
  }

  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    return new Response(JSON.stringify({ error: "BAD_REQUEST_BODY" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const eventId = request.headers.get("resender-event-id");
  const timestamp = request.headers.get("resender-timestamp");
  const signature = request.headers.get("resender-signature");

  const webhookSecret = getPontiunRuntimeEnv("PONTIUN_WEBHOOK_SECRET");

  // Si está configurado el secreto de firma en Pontiun, validar estrictamente
  if (webhookSecret && webhookSecret.trim()) {
    const verification = verifyPontiunWebhookSignature({
      rawBody,
      eventId,
      timestamp,
      signature,
      secret: webhookSecret,
    });

    if (!verification.valid) {
      console.warn("[Pontiun Webhook] Firma rechazada:", verification.reason);
      return new Response(
        JSON.stringify({
          error: "Invalid webhook signature",
          reason: verification.reason,
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  } else {
    console.info(
      "[Pontiun Webhook] PONTIUN_WEBHOOK_SECRET no configurado en entorno; aceptando evento en modo permisivo.",
    );
  }

  // Idempotencia: si ya procesamos este eventId, devolver 200 inmediatamente
  if (eventId) {
    if (processedWebhookEventIds.has(eventId)) {
      console.log(`[Pontiun Webhook] Evento duplicado ignorado (idempotente): ${eventId}`);
      return new Response(
        JSON.stringify({ received: true, eventId, idempotentReplay: true }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (processedWebhookEventIds.size >= MAX_PROCESSED_EVENTS) {
      const firstKey = processedWebhookEventIds.values().next().value;
      if (firstKey) processedWebhookEventIds.delete(firstKey);
    }
    processedWebhookEventIds.add(eventId);
  }

  // Parsear payload de evento de forma segura
  try {
    if (rawBody && rawBody.trim()) {
      const payload = JSON.parse(rawBody) as {
        type?: string;
        page?: { channel?: string; name?: string; id?: string };
        conversation?: { id?: string; contactId?: string };
        message?: { id?: string; direction?: string; text?: string };
      };

      // Si es un mensaje entrante de un cliente, registrar diagnóstico mínimo sin exponer PII
      if (payload.type === "message" && payload.message?.direction === "inbound") {
        console.log("[Pontiun Webhook] Mensaje entrante recibido de cliente:", {
          eventId: eventId ?? "none",
          channel: payload.page?.channel ?? "whatsapp",
          conversationId: payload.conversation?.id ?? "none",
        });
      }
    }
  } catch {
    // Si no es JSON estándar (ej: ping de prueba), ignorar error de parseo
  }

  return new Response(
    JSON.stringify({
      received: true,
      eventId: eventId ?? null,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

/**
 * Envia el WhatsApp de confirmación de turno a través de la API oficial de Pontiun:
 * POST https://pontiun.com/api/meta/whatsapp/templates/send
 *
 * Requisitos oficiales respetados:
 * - Utiliza plantilla aprobada de WhatsApp (bypassa la ventana de 24 horas para nuevos contactos).
 * - Cabecera Idempotency-Key obligatoria: `kani-appointment-${appointmentId}-confirmed`.
 * - Autenticación con API Key opaca del tenant (Bearer pk_live_...).
 * - Si Pontiun o las credenciales no están configuradas, se omite de forma segura sin romper la confirmación.
 * - Si Pontiun falla (5xx, timeout, template_not_approved), nunca compromete el estado CONFIRMED del turno.
 */
export async function sendPontiunAppointmentConfirmation(
  params: PontiunAppointmentPayload,
): Promise<PontiunSendResult> {
  const apiKey = getPontiunRuntimeEnv("PONTIUN_API_KEY");
  const phoneNumberId =
    getPontiunRuntimeEnv("PONTIUN_WHATSAPP_PHONE_NUMBER_ID") ??
    getPontiunRuntimeEnv("PONTIUN_PHONE_NUMBER_ID") ??
    getPontiunRuntimeEnv("PONTIUN_PAGE_ID");
  const templateName =
    getPontiunRuntimeEnv("PONTIUN_WHATSAPP_CONFIRMATION_TEMPLATE") ??
    "confirmacion_turno_kani";
  const templateLanguage =
    getPontiunRuntimeEnv("PONTIUN_WHATSAPP_TEMPLATE_LANGUAGE") ?? "es_AR";
  const apiBaseUrl =
    getPontiunRuntimeEnv("PONTIUN_API_BASE_URL") ?? "https://pontiun.com";

  if (!apiKey || !apiKey.trim()) {
    console.info(
      "[Pontiun WhatsApp] PONTIUN_API_KEY no configurado en Cloudflare Workers; omitiendo envío seguro hasta configurar el secret.",
    );
    return {
      success: false,
      skipped: true,
      error: "PONTIUN_API_KEY_NOT_CONFIGURED",
    };
  }

  if (!phoneNumberId || !phoneNumberId.trim()) {
    console.info(
      "[Pontiun WhatsApp] PONTIUN_WHATSAPP_PHONE_NUMBER_ID no configurado; omitiendo envío seguro.",
    );
    return {
      success: false,
      skipped: true,
      error: "PONTIUN_PHONE_NUMBER_ID_NOT_CONFIGURED",
    };
  }

  const recipientPhone = normalizePhoneForPontiun(params.clientPhone);
  if (!recipientPhone) {
    console.warn(
      `[Pontiun WhatsApp] Teléfono inválido o ausente para turno ${params.appointmentId}; no se pudo normalizar.`,
    );
    return {
      success: false,
      error: "INVALID_PHONE_NUMBER",
    };
  }

  // Formatear fecha y hora
  let formattedDate = params.bookingDate ?? "";
  if (formattedDate && /^\d{4}-\d{2}-\d{2}$/.test(formattedDate)) {
    try {
      formattedDate = new Date(`${formattedDate}T12:00:00Z`).toLocaleDateString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      // conservar original
    }
  }

  let formattedTime = params.startTime ?? "";
  if (formattedTime) {
    formattedTime = `${formattedTime.slice(0, 5)} hs`;
  }

  const clientName = params.clientName?.trim() || "Cliente";
  const serviceName = params.serviceName?.trim() || "Servicio Kani";
  const barberName = params.barberName?.trim() || "Staff Kani";

  // Clave de idempotencia única por turno confirmado según ADR Pontiun
  const idempotencyKey = `kani-appointment-${params.appointmentId}-confirmed`;

  const requestBody = {
    pageId: phoneNumberId.trim(),
    recipientId: recipientPhone,
    template: {
      name: templateName.trim(),
      language: {
        code: templateLanguage.trim(),
      },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: clientName },
            { type: "text", text: formattedDate },
            { type: "text", text: formattedTime },
            { type: "text", text: serviceName },
            { type: "text", text: barberName },
          ],
        },
      ],
    },
  };

  const endpoint = `${apiBaseUrl.replace(/\/$/, "")}/api/meta/whatsapp/templates/send`;

  try {
    const maskedPhone = `***${recipientPhone.slice(-4)}`;
    console.log(
      `[Pontiun WhatsApp] Enviando confirmación para turno ${params.appointmentId} al destinatario ${maskedPhone} con idempotencyKey ${idempotencyKey}`,
    );

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(requestBody),
    });

    const responseJson = (await response.json().catch(() => null)) as {
      message?: { id?: string };
      id?: string;
      resender?: { idempotentReplay?: boolean };
      error?: string;
      code?: string;
    } | null;

    if (response.ok) {
      const isReplay = Boolean(responseJson?.resender?.idempotentReplay);
      const messageId = responseJson?.message?.id ?? responseJson?.id ?? "sent";
      if (isReplay) {
        console.log(`[Pontiun WhatsApp] Reenvío idempotente detectado para turno ${params.appointmentId}`);
      } else {
        console.log(`[Pontiun WhatsApp] Confirmación aceptada por Pontiun para turno ${params.appointmentId}`);
      }
      return {
        success: true,
        messageId,
        idempotentReplay: isReplay,
      };
    }

    if (response.status === 409 && (responseJson?.error === "template_not_approved" || responseJson?.code === "template_not_approved")) {
      console.warn(
        `[Pontiun WhatsApp] Plantilla '${templateName}' no aprobada en el catálogo de Pontiun / Meta (HTTP 409).`,
      );
      return {
        success: false,
        error: "TEMPLATE_NOT_APPROVED",
      };
    }

    const errorDetails = responseJson?.error ?? responseJson?.code ?? `HTTP_${response.status}`;
    console.warn(
      `[Pontiun WhatsApp] Error al enviar confirmación (HTTP ${response.status}): ${errorDetails}`,
    );
    return {
      success: false,
      error: `PONTIUN_${response.status}: ${errorDetails}`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[Pontiun WhatsApp Exception]:", errorMsg);
    return {
      success: false,
      error: errorMsg,
    };
  }
}

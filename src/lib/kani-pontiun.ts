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
  retryable?: boolean;
  attempts?: number;
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
      const payload = JSON.parse(rawBody) as any;

      // Extraer todas las actualizaciones de estado de mensajes
      const statusUpdates: Array<{
        providerMessageId?: string;
        metaMessageId?: string;
        status: string;
        errorCode?: string;
        errorDescription?: string;
      }> = [];

      // Formato 1: Pontiun resender callback { type: "message.status", message: { id, status, error: { code, message } }, meta: { id } }
      if (
        payload.type === "message.status" ||
        payload.type === "message_status" ||
        (payload.message && payload.message.status)
      ) {
        const msg = payload.message || payload;
        const err = msg.error || payload.error;
        statusUpdates.push({
          providerMessageId: msg.id || payload.id,
          metaMessageId: payload.meta?.id || payload.meta?.messages?.[0]?.id,
          status: msg.status || payload.status,
          errorCode: err
            ? typeof err === "object"
              ? String(err.code || err.error_code || "")
              : String(err)
            : undefined,
          errorDescription: err
            ? typeof err === "object"
              ? String(err.message || err.description || JSON.stringify(err))
              : String(err)
            : undefined,
        });
      }

      // Formato 2: Meta Cloud API webhook estándar { entry: [ { changes: [ { value: { statuses: [...] } } ] } ] }
      if (Array.isArray(payload.entry)) {
        for (const ent of payload.entry) {
          for (const ch of ent.changes || []) {
            if (Array.isArray(ch.value?.statuses)) {
              for (const st of ch.value.statuses) {
                const firstErr =
                  Array.isArray(st.errors) && st.errors[0] ? st.errors[0] : undefined;
                statusUpdates.push({
                  providerMessageId: st.id,
                  metaMessageId: st.id,
                  status: st.status,
                  errorCode: firstErr ? String(firstErr.code) : undefined,
                  errorDescription: firstErr
                    ? String(firstErr.title || firstErr.message || "")
                    : undefined,
                });
              }
            }
          }
        }
      }

      // Formato 3: Direct array { statuses: [...] }
      if (Array.isArray(payload.statuses)) {
        for (const st of payload.statuses) {
          const firstErr =
            Array.isArray(st.errors) && st.errors[0] ? st.errors[0] : undefined;
          statusUpdates.push({
            providerMessageId: st.id,
            metaMessageId: st.id,
            status: st.status,
            errorCode: firstErr ? String(firstErr.code) : undefined,
            errorDescription: firstErr
              ? String(firstErr.title || firstErr.message || "")
              : undefined,
          });
        }
      }

      // Procesar actualizaciones de entrega en base de datos si existen
      if (statusUpdates.length > 0) {
        try {
          const { createClient } = await import("@supabase/supabase-js");
          const supabaseUrl =
            getPontiunRuntimeEnv("SUPABASE_URL") ?? getPontiunRuntimeEnv("VITE_SUPABASE_URL");
          const supabaseKey =
            getPontiunRuntimeEnv("SUPABASE_SERVICE_ROLE_KEY") ??
            getPontiunRuntimeEnv("SUPABASE_ANON_KEY") ??
            getPontiunRuntimeEnv("SUPABASE_PUBLISHABLE_KEY") ??
            getPontiunRuntimeEnv("VITE_SUPABASE_ANON_KEY") ??
            getPontiunRuntimeEnv("VITE_SUPABASE_PUBLISHABLE_KEY");

          if (supabaseUrl && supabaseKey) {
            const supabase = createClient(supabaseUrl, supabaseKey, {
              auth: { persistSession: false, autoRefreshToken: false },
            });

            for (const update of statusUpdates) {
              if (update.providerMessageId || update.metaMessageId) {
                console.log("[Pontiun Webhook] Actualizando estado de entrega:", {
                  msgId: update.providerMessageId,
                  metaId: update.metaMessageId,
                  status: update.status,
                  errorCode: update.errorCode,
                });

                const { error: rpcErr } = await supabase.rpc(
                  "update_pontiun_webhook_message_status",
                  {
                    p_provider_message_id: update.providerMessageId ?? null,
                    p_meta_message_id: update.metaMessageId ?? null,
                    p_status: update.status,
                    p_error_code: update.errorCode ?? null,
                    p_error_description: update.errorDescription ?? null,
                  },
                );

                if (rpcErr) {
                  console.warn(
                    "[Pontiun Webhook] RPC update_pontiun_webhook_message_status error:",
                    rpcErr.message,
                  );
                }
              }
            }
          }
        } catch (dbErr) {
          console.warn(
            "[Pontiun Webhook] Error al conectar con Supabase para actualizar estado:",
            dbErr,
          );
        }
      }

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
 * - template.language es un STRING ("es_AR"), acorde a la especificación OpenAPI 3.1 de Pontiun.
 * - 5 variables en orden estricto: [1: Cliente, 2: Fecha DD/MM/YYYY, 3: Horario HH:MM, 4: Servicio, 5: Barbero].
 * - Barbero obligatorio: si falta en la reserva, no inventa nombres y retorna BARBER_MISSING sin reintentar.
 * - Si Pontiun o las credenciales no están configuradas, se omite de forma segura sin romper la confirmación.
 * - Si Pontiun falla (5xx, timeout, template_not_approved), NUNCA compromete el estado CONFIRMED del turno.
 * - Reintento controlado con retroceso exponencial solo ante errores transitorios (red, 408, 429, 5xx).
 */
export async function sendPontiunAppointmentConfirmation(
  params: PontiunAppointmentPayload,
): Promise<PontiunSendResult> {
  const apiKey = getPontiunRuntimeEnv("PONTIUN_API_KEY");
  const phoneNumberId =
    getPontiunRuntimeEnv("PONTIUN_PHONE_NUMBER_ID") ??
    getPontiunRuntimeEnv("PONTIUN_WHATSAPP_PHONE_NUMBER_ID") ??
    getPontiunRuntimeEnv("PONTIUN_PAGE_ID");
  const templateName =
    getPontiunRuntimeEnv("PONTIUN_TEMPLATE_NAME") ??
    getPontiunRuntimeEnv("PONTIUN_WHATSAPP_CONFIRMATION_TEMPLATE") ??
    "confirmacion_turno_kani";
  const templateLanguage =
    getPontiunRuntimeEnv("PONTIUN_TEMPLATE_LANGUAGE") ??
    getPontiunRuntimeEnv("PONTIUN_WHATSAPP_TEMPLATE_LANGUAGE") ??
    "es_AR";
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
      retryable: false,
      attempts: 0,
    };
  }

  if (!phoneNumberId || !phoneNumberId.trim()) {
    console.info(
      "[Pontiun WhatsApp] PONTIUN_PHONE_NUMBER_ID no configurado; omitiendo envío seguro.",
    );
    return {
      success: false,
      skipped: true,
      error: "PONTIUN_PHONE_NUMBER_ID_NOT_CONFIGURED",
      retryable: false,
      attempts: 0,
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
      retryable: false,
      attempts: 0,
    };
  }

  // Barbero es obligatorio en el contrato oficial de Kani Studio. No inventar nombres si no está asignado.
  const barberName = params.barberName?.trim();
  if (!barberName) {
    console.warn(
      `[Pontiun WhatsApp] Turno ${params.appointmentId} no tiene barbero asignado; no se inventa nombre y se cancela el envío.`,
    );
    return {
      success: false,
      error: "BARBER_MISSING",
      retryable: false,
      attempts: 0,
    };
  }

  // 1. Nombre del cliente
  const clientName = params.clientName?.trim() || "Cliente";

  // 2. Fecha (DD/MM/YYYY)
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

  // 3. Horario (HH:MM estricto según tabla oficial)
  let formattedTime = params.startTime ?? "";
  if (formattedTime) {
    formattedTime = formattedTime.slice(0, 5);
  }

  // 4. Servicio (normalizar 'Corte + barba' a 'Corte y barba')
  let serviceName = params.serviceName?.trim() || "Servicio Kani";
  if (serviceName.toLowerCase() === "corte + barba" || serviceName.toLowerCase() === "corte +barba") {
    serviceName = "Corte y barba";
  }

  // Clave de idempotencia única por turno confirmado según ADR Pontiun
  const idempotencyKey = `kani-appointment-${params.appointmentId}-confirmed`;

  const requestBody = {
    pageId: phoneNumberId.trim(),
    recipientId: recipientPhone,
    template: {
      name: templateName.trim(),
      language: templateLanguage.trim(), // string per Pontiun OpenAPI schema!
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
  const maskedPhone = `***${recipientPhone.slice(-4)}`;
  const maxAttempts = 3;
  let lastError = "UNKNOWN_ERROR";
  let lastRetryable = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(
        `[Pontiun WhatsApp] Enviando confirmación (intento ${attempt}/${maxAttempts}) para turno ${params.appointmentId} al destinatario ${maskedPhone} con idempotencyKey ${idempotencyKey}`,
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
        message?: string | { id?: string; message?: string };
        id?: string;
        resender?: { messageId?: string; status?: string; idempotentReplay?: boolean };
        meta?: { messages?: Array<{ id: string; message_status?: string }> };
        error?: string | { message?: string; type?: string; code?: number };
        code?: string;
      } | null;

      if (response.ok) {
        if (responseJson?.resender?.status === "failed" || Boolean(responseJson?.error)) {
          const rawErr = responseJson?.error ?? "RESENDER_FAILED";
          lastError = typeof rawErr === "object" && rawErr !== null ? (rawErr.message ?? JSON.stringify(rawErr)) : String(rawErr);
          lastRetryable = false;
          console.warn(
            `[Pontiun WhatsApp] Pontiun devolvió respuesta 200 pero estado de envío fallido: ${lastError}`,
          );
          return {
            success: false,
            error: lastError,
            retryable: false,
            attempts: attempt,
          };
        }

        const isReplay = Boolean(responseJson?.resender?.idempotentReplay);
        const messageId =
          responseJson?.resender?.messageId ??
          responseJson?.meta?.messages?.[0]?.id ??
          (typeof responseJson?.message === "object" ? responseJson?.message?.id : undefined) ??
          responseJson?.id ??
          "sent";

        if (isReplay) {
          console.log(
            `[Pontiun WhatsApp] Reenvío idempotente detectado para turno ${params.appointmentId} (messageId: ${messageId})`,
          );
        } else {
          console.log(
            `[Pontiun WhatsApp] Confirmación aceptada por Pontiun para turno ${params.appointmentId} (messageId: ${messageId})`,
          );
        }

        return {
          success: true,
          messageId,
          idempotentReplay: isReplay,
          attempts: attempt,
        };
      }

      const rawDetails = responseJson?.error ?? responseJson?.message ?? responseJson?.code;
      const errorDetails =
        typeof rawDetails === "object" && rawDetails !== null
          ? ((rawDetails as any).message ?? JSON.stringify(rawDetails))
          : String(rawDetails ?? `HTTP_${response.status}`);

      // Errores permanentes Meta / Pontiun
      if (
        response.status === 409 &&
        (errorDetails === "template_not_approved" || responseJson?.code === "template_not_approved")
      ) {
        console.warn(
          `[Pontiun WhatsApp] Plantilla '${templateName}' no aprobada en el catálogo de Pontiun / Meta (HTTP 409).`,
        );
        return {
          success: false,
          error: "TEMPLATE_NOT_APPROVED",
          retryable: false,
          attempts: attempt,
        };
      }

      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
        console.warn(
          `[Pontiun WhatsApp] Error permanente de cliente (HTTP ${response.status}): ${errorDetails}`,
        );
        return {
          success: false,
          error: `PONTIUN_${response.status}: ${errorDetails}`,
          retryable: false,
          attempts: attempt,
        };
      }

      // Error transitorio (HTTP 408, 429, 5xx)
      lastError = `PONTIUN_${response.status}: ${errorDetails}`;
      lastRetryable = true;
      console.warn(
        `[Pontiun WhatsApp] Error transitorio en intento ${attempt}/${maxAttempts} (HTTP ${response.status}): ${errorDetails}`,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      lastError = errorMsg;
      lastRetryable = true;
      console.warn(
        `[Pontiun WhatsApp Exception en intento ${attempt}/${maxAttempts}]: ${errorMsg}`,
      );
    }

    // Si aún quedan intentos y es transitorio, esperar backoff
    if (attempt < maxAttempts && lastRetryable) {
      const backoffMs = attempt === 1 ? 500 : 1500;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  return {
    success: false,
    error: lastError,
    retryable: lastRetryable,
    attempts: maxAttempts,
  };
}

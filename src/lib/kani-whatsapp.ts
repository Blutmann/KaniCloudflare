export type WhatsAppMessagePayload = {
  toPhone: string;
  clientName: string;
  serviceName: string;
  barberName: string;
  bookingDate: string;
  startTime: string;
};

export type WhatsAppSendResult = {
  success: boolean;
  messageId?: string;
  error?: string;
};

/**
 * Normaliza un número telefónico al formato numérico requerido por WhatsApp Cloud API.
 * WhatsApp espera el número de teléfono con código de país sin '+', espacios ni guiones (ej: "54911xxxxxxxx").
 */
export function formatPhoneForWhatsApp(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits;
}

/**
 * Valida la llamada GET de verificación de Webhook de Meta/Facebook Developers.
 * Retorna un Response con el challenge en texto plano si es válido, o null si no corresponde.
 */
export function handleWhatsAppWebhookVerification(
  url: URL,
  verifyToken: string | undefined,
): Response | null {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && verifyToken && token.trim() === verifyToken.trim()) {
    console.log("[WhatsApp Webhook] Verificación exitosa de Meta/Facebook");
    return new Response(challenge ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (mode || token || challenge) {
    console.warn("[WhatsApp Webhook] Intento de verificación fallido o token inválido");
    return new Response("Forbidden: Invalid verification token", { status: 403 });
  }

  return null;
}

/**
 * Envía una notificación de turno a través de la API oficial de WhatsApp Cloud (Meta Graph API).
 * Utiliza una plantilla (template) aprobada por WhatsApp.
 */
export async function sendWhatsAppNotification({
  payload,
  phoneNumberId,
  accessToken,
  templateName = "confirmacion_turno_kani",
  templateLanguage = "es_AR",
}: {
  payload: WhatsAppMessagePayload;
  phoneNumberId: string;
  accessToken: string;
  templateName?: string;
  templateLanguage?: string;
}): Promise<WhatsAppSendResult> {
  const to = formatPhoneForWhatsApp(payload.toPhone);
  if (!to || to.length < 8) {
    return { success: false, error: "INVALID_PHONE_NUMBER" };
  }

  const endpoint = `https://graph.facebook.com/v21.0/${phoneNumberId.trim()}/messages`;

  const requestBody = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: templateName.trim(),
      language: {
        code: templateLanguage.trim(),
      },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: payload.clientName },
            { type: "text", text: payload.serviceName },
            { type: "text", text: payload.barberName },
            { type: "text", text: payload.bookingDate },
            { type: "text", text: payload.startTime },
          ],
        },
      ],
    },
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const data = (await response.json().catch(() => null)) as {
      messages?: Array<{ id: string }>;
      error?: { message: string; code: number; error_subcode?: number };
    } | null;

    if (!response.ok) {
      const errorMsg = data?.error?.message ?? `HTTP_${response.status}`;
      console.error(`[WhatsApp API Error] (${response.status}): ${errorMsg}`);
      return { success: false, error: errorMsg };
    }

    const messageId = data?.messages?.[0]?.id;
    console.log(`[WhatsApp API] Mensaje enviado con éxito: ${messageId}`);
    return { success: true, messageId };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[WhatsApp API Exception]: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

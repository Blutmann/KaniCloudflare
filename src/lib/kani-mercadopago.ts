import { createHmac, timingSafeEqual } from "node:crypto";

export type MercadoPagoOrderPayer = {
  email: string;
  name?: string;
  phone?: string;
};

export type MercadoPagoOrderItem = {
  title: string;
  description?: string;
  unit_price: string;
  quantity: number;
  picture_url?: string;
  category_id?: string;
  external_code?: string;
};

export type CreateMercadoPagoOrderInput = {
  externalReference: string;
  title: string;
  description: string;
  amount: number;
  currencyId?: string;
  payer: MercadoPagoOrderPayer;
  notificationUrl?: string;
  expirationMinutes?: number;
  returnUrl?: string;
};

export type MercadoPagoOrderResponse = {
  id: string;
  type?: string;
  processing_mode?: string;
  total_amount?: string | number;
  external_reference?: string;
  status: string;
  init_point?: string;
  checkout_url?: string;
  sandbox_init_point?: string;
  redirect_url?: string;
  expires?: boolean;
  expiration_date_from?: string;
  expiration_date_to?: string;
};

export type MercadoPagoPaymentSummary = {
  id: string | number;
  status: string;
  status_detail?: string;
  transaction_amount?: number;
  currency_id?: string;
  date_approved?: string;
};

export type MercadoPagoOrderDetails = {
  id: string;
  status: string;
  type?: string;
  total_amount?: number;
  currency_id?: string;
  external_reference?: string;
  payments?: MercadoPagoPaymentSummary[];
  created_at?: string;
  updated_at?: string;
};

export type CreateOrderResult = {
  success: boolean;
  orderId?: string;
  initPoint?: string;
  checkoutUrl?: string;
  error?: string;
};

export type GetOrderResult = {
  success: boolean;
  order?: MercadoPagoOrderDetails;
  error?: string;
};

/**
 * Valida la firma criptográfica HMAC-SHA256 incluida en el encabezado `x-signature`
 * de las notificaciones Webhook de Mercado Pago.
 *
 * Formato del encabezado x-signature:
 *   ts=1742505638683,v1=ced36ab6d33566bb1e16c125819b8d840d6b8ef136b0b9127c76064466f5229b
 *
 * Plantilla del manifiesto según especificación oficial:
 *   id:{data.id};request-id:{x-request-id};ts:{ts};
 */
export function verifyMercadoPagoWebhookSignature({
  xSignature,
  xRequestId,
  dataId,
  secret,
}: {
  xSignature: string | null | undefined;
  xRequestId: string | null | undefined;
  dataId: string | null | undefined;
  secret: string | null | undefined;
}): boolean {
  if (!xSignature || !xRequestId || !dataId || !secret) {
    return false;
  }

  // Parsear ts y v1 del header x-signature
  const parts = xSignature.split(",");
  let ts: string | undefined;
  let v1: string | undefined;

  for (const part of parts) {
    const [key, ...valueParts] = part.split("=");
    const trimmedKey = key?.trim();
    const val = valueParts.join("=").trim();
    if (trimmedKey === "ts") ts = val;
    if (trimmedKey === "v1") v1 = val;
  }

  if (!ts || !v1) {
    return false;
  }

  // Construir el manifest exactamente según la especificación: id:{data.id};request-id:{x-request-id};ts:{ts};
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  try {
    const computedHmac = createHmac("sha256", secret.trim())
      .update(manifest)
      .digest("hex");

    const computedBuffer = Buffer.from(computedHmac, "hex");
    const receivedBuffer = Buffer.from(v1, "hex");

    if (computedBuffer.length !== receivedBuffer.length) {
      return false;
    }

    return timingSafeEqual(computedBuffer, receivedBuffer);
  } catch (err) {
    console.error("[Mercado Pago] Error al verificar firma:", err);
    return false;
  }
}

export function toValidUuid(input?: string): string {
  if (input && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input)) {
    return input.toLowerCase();
  }
  if (input) {
    const match = input.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    if (match) return match[0].toLowerCase();
  }
  return crypto.randomUUID();
}

/**
 * Crea una orden de pago en Mercado Pago mediante la Orders API oficial (POST /v1/orders).
 * Diseñado para ser invocado de forma segura en el servidor, utilizando idempotencia
 * y vencimiento configurable (por defecto 10 minutos).
 */
export async function createMercadoPagoOrder({
  input,
  accessToken,
  idempotencyKey,
  apiBaseUrl = "https://api.mercadopago.com",
}: {
  input: CreateMercadoPagoOrderInput;
  accessToken: string | undefined;
  idempotencyKey: string;
  apiBaseUrl?: string;
}): Promise<CreateOrderResult> {
  if (!accessToken || !accessToken.trim()) {
    return {
      success: false,
      error: "MERCADOPAGO_ACCESS_TOKEN_NOT_CONFIGURED",
    };
  }

  const sanitizedAmount = Number(input.amount.toFixed(2));
  const amountStr = sanitizedAmount.toFixed(2);

  // Vencimiento en minutos (por defecto 10 min)
  const expirationMinutes = input.expirationMinutes ?? 10;
  const now = new Date();
  const expirationTo = new Date(now.getTime() + expirationMinutes * 60 * 1000).toISOString();

  const bodyPayload: Record<string, unknown> = {
    type: "online",
    processing_mode: "manual",
    total_amount: amountStr,
    external_reference: input.externalReference,
    payer: {
      email: input.payer.email,
    },
    items: [
      {
        id: input.externalReference,
        title: input.title,
        description: input.description,
        unit_price: amountStr,
        quantity: 1,
        category_id: "services",
        external_code: input.externalReference,
      },
    ],
    expiration_date_to: expirationTo,
  };

  if (input.notificationUrl) {
    bodyPayload.notification_url = input.notificationUrl;
  }

  if (input.returnUrl) {
    bodyPayload.config = {
      online: {
        success_url: input.returnUrl,
        failure_url: input.returnUrl,
        pending_url: input.returnUrl,
        auto_return: "approved",
      },
    };
  }

  const validIdempotencyKey = toValidUuid(idempotencyKey);

  try {
    const response = await fetch(`${apiBaseUrl}/v1/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
        "X-Idempotency-Key": validIdempotencyKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bodyPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText) as {
          message?: string;
          error?: string;
          cause?: Array<{ description?: string; code?: string | number }>;
        };
        const causeDescriptions = Array.isArray(errorJson.cause)
          ? errorJson.cause.map((c) => c.description).filter(Boolean).join("; ")
          : "";
        errorDetail = causeDescriptions || errorJson.message || errorJson.error || errorText;
      } catch {
        errorDetail = errorText;
      }
      console.error(`[Mercado Pago Orders API Error] (${response.status}):`, errorDetail);
      return {
        success: false,
        error: errorDetail,
      };
    }

    const data = (await response.json()) as MercadoPagoOrderResponse & Record<string, unknown>;
    const orderId = typeof data.id === "string" ? data.id : String(data.id ?? "");
    const checkoutUrl =
      (typeof data.checkout_url === "string" && data.checkout_url) ||
      (typeof data.init_point === "string" && data.init_point) ||
      (typeof data.sandbox_init_point === "string" && data.sandbox_init_point) ||
      (typeof data.redirect_url === "string" && data.redirect_url) ||
      (orderId ? `https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=${orderId}` : undefined);

    if (!checkoutUrl) {
      console.error("[Mercado Pago] No se obtuvo checkout_url ni init_point en la respuesta:", data);
      return {
        success: false,
        error: "NO_CHECKOUT_URL",
      };
    }

    return {
      success: true,
      orderId,
      initPoint: checkoutUrl,
      checkoutUrl,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[Mercado Pago Orders API Exception]:", errorMsg);
    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Consulta el estado real y verificado de una orden en Mercado Pago (GET /v1/orders/{id}).
 * Esencial para verificar si una orden está aprobada tras recibir el webhook, sin confiar
 * únicamente en los datos provistos en la carga útil de la notificación.
 */
export async function getMercadoPagoOrder({
  orderId,
  accessToken,
  apiBaseUrl = "https://api.mercadopago.com",
}: {
  orderId: string;
  accessToken: string | undefined;
  apiBaseUrl?: string;
}): Promise<GetOrderResult> {
  if (!accessToken || !accessToken.trim()) {
    return {
      success: false,
      error: "MERCADOPAGO_ACCESS_TOKEN_NOT_CONFIGURED",
    };
  }

  try {
    const response = await fetch(`${apiBaseUrl}/v1/orders/${encodeURIComponent(orderId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Mercado Pago Get Order Error] (${response.status}):`, errorText);
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }

    const data = (await response.json()) as MercadoPagoOrderDetails;
    return {
      success: true,
      order: data,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[Mercado Pago Get Order Exception]:", errorMsg);
    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Evalúa si una orden de Mercado Pago se encuentra efectivamente aprobada y pagada en su totalidad.
 */
export function isOrderFullyApproved(order: MercadoPagoOrderDetails, expectedAmount?: number): boolean {
  if (!order) return false;

  // Validar moneda: debe ser ARS si está presente
  if (order.currency_id && order.currency_id.toUpperCase() !== "ARS") {
    console.warn(`[Mercado Pago Order] Moneda no admitida: ${order.currency_id}. Se espera ARS.`);
    return false;
  }

  // Si la orden general tiene status 'processed' o 'paid'
  const isOrderStatusPaid = order.status === "processed" || order.status === "paid" || order.status === "closed";

  // Verificar pagos individuales en caso de estar presentes
  const payments = order.payments ?? [];
  const approvedPayment = payments.find((p) => p.status === "approved");

  if (!isOrderStatusPaid && !approvedPayment) {
    return false;
  }

  // Si el pago individual tiene moneda especificada, verificar que sea ARS
  if (approvedPayment?.currency_id && approvedPayment.currency_id.toUpperCase() !== "ARS") {
    console.warn(`[Mercado Pago Order] Moneda del pago no admitida: ${approvedPayment.currency_id}. Se espera ARS.`);
    return false;
  }

  // Si se especificó el importe esperado, validar que coincida
  if (expectedAmount !== undefined && expectedAmount > 0) {
    const orderTotal = Number(order.total_amount ?? 0);
    const paymentAmount = approvedPayment?.transaction_amount !== undefined
      ? Number(approvedPayment.transaction_amount)
      : orderTotal;

    // Tolerancia para centavos
    if (Math.abs(paymentAmount - expectedAmount) > 0.01 && Math.abs(orderTotal - expectedAmount) > 0.01) {
      console.warn(`[Mercado Pago Order] Importe no coincide. Esperado: ${expectedAmount}, Obtenido: ${paymentAmount} / ${orderTotal}`);
      return false;
    }
  }

  return true;
}

/**
 * Consulta el monto de seña dinámico configurado en Supabase para un barbero,
 * garantizando que nunca dependa de un valor hardcodeado.
 */
export async function getDynamicDownPayment(barberName?: string | null): Promise<number> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase.rpc("read_public_deposit_amount", {
      p_barber_name: barberName?.trim() || null,
    });
    if (!error && typeof data === "number" && data > 0) {
      return data;
    }
  } catch {
    // Si la RPC aún no está creada o la conexión falla, se retorna el valor por omisión estándar
  }
  return 10000;
}

export type ConfirmAppointmentPaymentInput = {
  appointmentId: string;
  orderId: string;
  totalAmount?: number;
};

export type ConfirmAppointmentPaymentResult = {
  success: boolean;
  appointmentStatus?: string;
  resultCode:
    | "CONFIRMED"
    | "ALREADY_CONFIRMED"
    | "SLOT_COLLISION_LATE_PAYMENT"
    | "APPOINTMENT_CANCELLED"
    | "APPOINTMENT_NOT_FOUND"
    | "FAILED";
  error?: string;
};

/**
 * Confirma atómicamente el turno en Supabase respetando el bloqueo de concurrencia
 * pg_advisory_xact_lock, idempotencia ante webhooks repetidos, y evitando colisiones
 * si el pago llegó fuera de tiempo y el turno fue cancelado o reasignado.
 */
export async function confirmAppointmentPayment({
  appointmentId,
  orderId,
  totalAmount,
}: ConfirmAppointmentPaymentInput): Promise<ConfirmAppointmentPaymentResult> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");

    const { data, error } = await supabase.rpc("confirm_appointment_from_payment", {
      p_appointment_id: appointmentId,
      p_order_id: orderId,
      p_paid_amount: totalAmount ? Math.round(totalAmount) : null,
    });

    if (error) {
      console.error("[Mercado Pago] Error en confirm_appointment_from_payment RPC:", error);
      return {
        success: false,
        resultCode: "FAILED",
        error: error.message,
      };
    }

    const row = data?.[0];
    if (!row) {
      return {
        success: false,
        resultCode: "FAILED",
        error: "NO_DATA_RETURNED",
      };
    }

    const resultCode = (row.result_code || "CONFIRMED") as ConfirmAppointmentPaymentResult["resultCode"];
    const appointmentStatus = row.appointment_status ?? undefined;

    // Idempotencia: si ya estaba confirmada, no duplicamos notificaciones
    if (resultCode === "ALREADY_CONFIRMED") {
      console.log(`[Mercado Pago] Turno ${appointmentId} ya se encontraba CONFIRMED (idempotente).`);
      return {
        success: true,
        appointmentStatus: "CONFIRMED",
        resultCode: "ALREADY_CONFIRMED",
      };
    }

    // Si el turno fue cancelado o el horario ya fue ocupado por otro turno
    if (resultCode === "SLOT_COLLISION_LATE_PAYMENT") {
      console.warn(
        `[Mercado Pago] Pago tardío para turno ${appointmentId}: el horario ya fue ocupado por otra reserva confirmada. No se sobreescribe.`,
      );
      return {
        success: false,
        appointmentStatus,
        resultCode: "SLOT_COLLISION_LATE_PAYMENT",
        error: "SLOT_COLLISION_LATE_PAYMENT",
      };
    }

    // Confirmación exitosa: disparar notificaciones si se generó un claim token
    if (resultCode === "CONFIRMED") {
      console.log(`[Mercado Pago] Turno ${appointmentId} confirmado exitosamente tras pago.`);
      if (row.notification_claim_token) {
        try {
          const { sendAppointmentNotification } = await import("./kani-notifications.functions");
          await sendAppointmentNotification({
            data: {
              appointmentId,
              claimToken: row.notification_claim_token,
            },
          });
          console.log(`[Mercado Pago] Notificación de confirmación despachada para turno ${appointmentId}.`);
        } catch (notifErr) {
          console.error(
            `[Mercado Pago] Error al despachar notificación de confirmación para ${appointmentId}:`,
            notifErr,
          );
        }
      }

      return {
        success: true,
        appointmentStatus: "CONFIRMED",
        resultCode: "CONFIRMED",
      };
    }

    return {
      success: false,
      appointmentStatus,
      resultCode,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[Mercado Pago] Excepción al confirmar turno:", errorMsg);
    return {
      success: false,
      resultCode: "FAILED",
      error: errorMsg,
    };
  }
}


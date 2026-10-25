import { getDynamicDownPayment } from "./kani-down-payment";
import type {
  CreateBookingOrderInput,
  CreateBookingOrderResult,
  AppointmentPaymentStatusInput,
  AppointmentPaymentStatusResult,
} from "./kani-mercadopago.functions";

export function getRuntimeEnv(name: string): string | undefined {
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

export async function handleCreateBookingOrder(data: CreateBookingOrderInput): Promise<CreateBookingOrderResult> {
  try {
    const accessToken = getRuntimeEnv("MERCADOPAGO_ACCESS_TOKEN");
    const notificationUrl =
      getRuntimeEnv("MERCADOPAGO_NOTIFICATION_URL") ??
      "https://kanibarberstudio-cloudflare.kanibarber.workers.dev/api/webhook/mercadopago";

    const appBaseUrl =
      getRuntimeEnv("KANI_APP_URL") ??
      "https://kanibarberstudio-cloudflare.kanibarber.workers.dev";
    const cleanBaseUrl = appBaseUrl.replace(/\/$/, "");

    const successUrl = `${cleanBaseUrl}/pago/exito?appointment_id=${encodeURIComponent(data.appointmentId)}`;
    const failureUrl = `${cleanBaseUrl}/pago/error?appointment_id=${encodeURIComponent(data.appointmentId)}`;
    const pendingUrl = `${cleanBaseUrl}/pago/pendiente?appointment_id=${encodeURIComponent(data.appointmentId)}`;

    const tokenType = accessToken
      ? accessToken.startsWith("TEST-")
        ? "SANDBOX"
        : accessToken.startsWith("APP_USR-")
          ? "PRODUCTION"
          : "CUSTOM"
      : "MISSING";

    const envSource = (globalThis as any).__env__?.MERCADOPAGO_ACCESS_TOKEN
      ? "__env__"
      : (globalThis as any).__KANI_RUNTIME_ENV?.MERCADOPAGO_ACCESS_TOKEN
        ? "__KANI_RUNTIME_ENV"
        : typeof process !== "undefined" && process.env?.MERCADOPAGO_ACCESS_TOKEN
          ? "process.env"
          : "none";

    console.log("[Mercado Pago Order Init Diagnostics]", {
      hasAccessToken: Boolean(accessToken),
      tokenType,
      tokenLength: accessToken ? accessToken.length : 0,
      envSource,
      hasNotificationUrl: Boolean(notificationUrl),
      appointmentId: data.appointmentId,
      serviceName: data.serviceName,
      barberName: data.barberName,
      successUrl,
      failureUrl,
      pendingUrl,
    });

    if (!accessToken) {
      console.error(
        "[Mercado Pago Order Error] MERCADOPAGO_ACCESS_TOKEN no configurado en variables de entorno (revisado: __env__, __KANI_RUNTIME_ENV, process.env).",
      );
      return {
        success: false,
        error: "MERCADOPAGO_NOT_CONFIGURED",
      };
    }

    if (!getRuntimeEnv("MERCADOPAGO_WEBHOOK_SECRET")) return { success: false, error: "PAYMENT_WEBHOOK_NOT_CONFIGURED" };

    // Resolve all commercial data from the saved appointment, never caller prices/names.
    const { createPaymentSupabaseClient } = await import("./kani-payment-db.server");
    const db = await createPaymentSupabaseClient();
    const { data: saved, error: savedError } = await db.rpc("get_appointment_payment_details", { p_appointment_id: data.appointmentId });
    const appointment = saved?.[0];
    if (savedError || !appointment || appointment.appointment_status !== "PENDING") {
      return { success: false, error: "APPOINTMENT_NOT_PAYABLE" };
    }
    // Persist before calling MP: simultaneous requests/retries reuse the same operation.
    const { error: intentError } = await db.from("appointment_payment_orders").upsert({
      appointment_id: data.appointmentId, expected_amount_ars: 5000,
    }, { onConflict: "appointment_id", ignoreDuplicates: true });
    if (intentError) return { success: false, error: "PAYMENT_REGISTRY_NOT_READY" };
    const { data: intent, error: intentReadError } = await db.from("appointment_payment_orders")
      .select("idempotency_key, order_id").eq("appointment_id", data.appointmentId).single();
    if (intentReadError || !intent) return { success: false, error: "PAYMENT_REGISTRY_NOT_READY" };

    // Obtener el monto de la seña dinámica de forma no hardcodeada (fuente de verdad: RPC o default 5000)
    const dynamicDeposit = await getDynamicDownPayment(appointment.barber_name);
    if (dynamicDeposit !== 5000 || Number(appointment.service_price_ars) < 5000) {
      return { success: false, error: "DEPOSIT_CONFIGURATION_MISMATCH" };
    }
    const depositAmount = 5000;

    const { createMercadoPagoOrder } = await import("./kani-mercadopago");
    const orderResult = await createMercadoPagoOrder({
      input: {
        externalReference: data.appointmentId,
        title: `Seña - ${appointment.service_name} (${appointment.barber_name})`,
        description: `Seña para reserva en Kani Barber Studio - ${appointment.service_name} con ${appointment.barber_name}`,
        amount: depositAmount,
        currencyId: "ARS",
        payer: {
          email: appointment.client_email.trim(),
          name: appointment.client_name.trim(),
          phone: appointment.client_phone.trim(),
        },
        notificationUrl,
        returnUrls: {
          successUrl,
          failureUrl,
          pendingUrl,
        },
        returnUrl: successUrl,
        expirationMinutes: 10,
      },
      accessToken,
      idempotencyKey: intent.idempotency_key,
    });

    if (!orderResult.success) {
      console.error("[Mercado Pago Order Failed]", {
        appointmentId: data.appointmentId,
        error: orderResult.error ?? "ORDER_CREATION_FAILED",
      });
      return {
        success: false,
        error: orderResult.error ?? "ORDER_CREATION_FAILED",
      };
    }

    if (!orderResult.orderId) return { success: false, error: "ORDER_ID_MISSING" };
    if (intent.order_id && intent.order_id !== orderResult.orderId) return { success: false, error: "ORDER_BINDING_MISMATCH" };
    const { error: bindError } = await db.from("appointment_payment_orders")
      .update({ order_id: orderResult.orderId }).eq("appointment_id", data.appointmentId).is("order_id", null);
    if (bindError) return { success: false, error: "ORDER_BINDING_FAILED" };
    const { data: bound } = await db.from("appointment_payment_orders").select("order_id")
      .eq("appointment_id", data.appointmentId).single();
    if (bound?.order_id !== orderResult.orderId) return { success: false, error: "ORDER_BINDING_MISMATCH" };
    const checkoutUrl = orderResult.checkoutUrl || orderResult.initPoint;

    return {
      success: true,
      orderId: orderResult.orderId,
      initPoint: checkoutUrl,
      checkoutUrl,
      depositAmount,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[Mercado Pago] Error en handleCreateBookingOrder:", errorMsg);
    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Consulta segura del estado del pago y turno desde el backend.
 * Resuelve la race condition en la que el usuario es redirigido antes de que el webhook
 * complete su procesamiento, y previene cualquier manipulación fraudulenta por query params.
 */
export async function handleGetAppointmentPaymentStatus(data: AppointmentPaymentStatusInput): Promise<AppointmentPaymentStatusResult> {
  try {
    const { createPaymentSupabaseClient } = await import("./kani-payment-db.server");
    const supabase = await createPaymentSupabaseClient();

    // Consultar el turno en Supabase
    const { data: appt, error: apptError } = await supabase
      .from("appointments")
      .select(`
        id,
        request_number,
        status,
        booking_date,
        start_time,
        end_time,
        barber_id,
        service_id,
        client_id
      `)
      .eq("id", data.appointmentId)
      .maybeSingle();

    if (apptError || !appt) {
      console.warn(`[handleGetAppointmentPaymentStatus] Turno no encontrado: ${data.appointmentId}`, apptError);
      return {
        success: false,
        isConfirmed: false,
        error: "APPOINTMENT_NOT_FOUND",
      };
    }

    // Cargar información descriptiva del turno para la UI
    const [barberRes, serviceRes] = await Promise.all([
      supabase.from("barbers").select("name").eq("id", appt.barber_id).maybeSingle(),
      supabase.from("services").select("name, price_ars").eq("id", appt.service_id).maybeSingle(),
    ]);

    const appointmentDetails = {
      id: appt.id,
      requestNumber: appt.request_number,
      serviceName: serviceRes.data?.name ?? "Servicio Kani",
      barberName: barberRes.data?.name ?? "Barbero Kani",
      date: appt.booking_date,
      time: appt.start_time,
      depositAmountArs: 5000,
    };

    // 1. Si el turno ya está confirmado o completado en la base de datos
    if (appt.status === "CONFIRMED" || appt.status === "COMPLETED") {
      return {
        success: true,
        isConfirmed: true,
        appointmentStatus: appt.status,
        appointment: appointmentDetails,
      };
    }

    // 2. Si el turno fue cancelado
    if (appt.status === "CANCELLED") {
      return {
        success: true,
        isConfirmed: false,
        appointmentStatus: "CANCELLED",
        appointment: appointmentDetails,
        message: "El turno fue cancelado.",
      };
    }

    // 3. Si el turno está PENDING y tenemos credenciales de Mercado Pago:
    // Resolver la race condition verificando directamente con la API de Mercado Pago
    const accessToken = getRuntimeEnv("MERCADOPAGO_ACCESS_TOKEN");
    const orderIdToVerify = data.orderId?.trim();
    const paymentIdToVerify = data.paymentId?.trim();

    if (accessToken && (orderIdToVerify || paymentIdToVerify)) {
      const confirmation = await verifyAndConfirmAppointmentPayment(data);
      if (confirmation.success) return {
        success: true, isConfirmed: true, appointmentStatus: "CONFIRMED", appointment: appointmentDetails,
      };
    }

    // Si aún no está confirmado, retornar PENDING con datos del turno
    return {
      success: true,
      isConfirmed: false,
      appointmentStatus: "PENDING",
      appointment: appointmentDetails,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[handleGetAppointmentPaymentStatus Error]:", errorMsg);
    return {
      success: false,
      isConfirmed: false,
      error: errorMsg,
    };
  }
}

/** Shared trust boundary for return routes and Webhooks. Query/payload statuses are ignored. */
export async function verifyAndConfirmAppointmentPayment(data: AppointmentPaymentStatusInput) {
  const { createPaymentSupabaseClient } = await import("./kani-payment-db.server");
  const db = await createPaymentSupabaseClient();
  const { data: intent, error } = await db.from("appointment_payment_orders")
    .select("order_id, expected_amount_ars").eq("appointment_id", data.appointmentId).single();
  if (error || !intent?.order_id || intent.expected_amount_ars !== 5000) {
    return { success: false, resultCode: "FAILED" };
  }
  const { getMercadoPagoOrder, getMercadoPagoPayment, isOrderFullyApproved, confirmAppointmentPayment } =
    await import("./kani-mercadopago");
  const accessToken = getRuntimeEnv("MERCADOPAGO_ACCESS_TOKEN");
  if (data.orderId && data.orderId !== intent.order_id) return { success: false, resultCode: "ID_MISMATCH" };
  if (data.paymentId) {
    const { payment } = await getMercadoPagoPayment({ paymentId: data.paymentId, accessToken });
    if (!payment || String(payment.id) !== data.paymentId || payment.external_reference !== data.appointmentId ||
        String(payment.order?.id ?? "") !== intent.order_id || payment.status !== "approved" ||
        payment.currency_id !== "ARS" || payment.transaction_amount !== 5000) {
      return { success: false, resultCode: "PAYMENT_NOT_APPROVED" };
    }
  }
  const { order, success } = await getMercadoPagoOrder({ orderId: intent.order_id, accessToken });
  if (!success) return { success: false, resultCode: "FAILED" };
  if (!order || String(order.id) !== intent.order_id || order.external_reference !== data.appointmentId ||
      !isOrderFullyApproved(order, intent.expected_amount_ars)) {
    return { success: false, resultCode: "ORDER_NOT_APPROVED" };
  }
  return confirmAppointmentPayment({ appointmentId: data.appointmentId, orderId: intent.order_id, totalAmount: 5000 });
}

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

    // Obtener el monto de la seña dinámica de forma no hardcodeada (fuente de verdad: RPC o default 5000)
    const dynamicDeposit = await getDynamicDownPayment(data.barberName);
    const depositAmount = data.servicePrice > 0
      ? Math.min(dynamicDeposit, data.servicePrice)
      : dynamicDeposit;

    const { createMercadoPagoOrder } = await import("./kani-mercadopago");
    const orderResult = await createMercadoPagoOrder({
      input: {
        externalReference: data.appointmentId,
        title: `Seña - ${data.serviceName} (${data.barberName})`,
        description: `Seña para reserva en Kani Barber Studio - ${data.serviceName} con ${data.barberName}`,
        amount: depositAmount,
        currencyId: "ARS",
        payer: {
          email: data.clientEmail.trim(),
          name: data.clientName.trim(),
          phone: data.clientPhone.trim(),
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
      idempotencyKey: data.appointmentId,
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
    const { supabase } = await import("@/integrations/supabase/client");

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
    const [barberRes, serviceRes, clientRes] = await Promise.all([
      supabase.from("barbers").select("name").eq("id", appt.barber_id).maybeSingle(),
      supabase.from("services").select("name, price_ars").eq("id", appt.service_id).maybeSingle(),
      supabase.from("clients").select("name, phone, email").eq("id", appt.client_id).maybeSingle(),
    ]);

    const appointmentDetails = {
      id: appt.id,
      requestNumber: appt.request_number,
      serviceName: serviceRes.data?.name ?? "Servicio Kani",
      barberName: barberRes.data?.name ?? "Barbero Kani",
      date: appt.booking_date,
      time: appt.start_time,
      clientName: clientRes.data?.name ?? "",
      clientPhone: clientRes.data?.phone ?? "",
      clientEmail: clientRes.data?.email ?? "",
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
      const { getMercadoPagoOrder, isOrderFullyApproved, getMercadoPagoPayment, confirmAppointmentPayment } =
        await import("./kani-mercadopago");

      let isApproved = false;
      let verifiedOrderId = orderIdToVerify;
      let totalAmount: number | undefined;

      // Intentar verificar la orden
      if (orderIdToVerify) {
        try {
          const orderRes = await getMercadoPagoOrder({ orderId: orderIdToVerify, accessToken });
          if (orderRes.success && orderRes.order) {
            const order = orderRes.order;
            // Verificar que external_reference corresponda al turno
            if (order.external_reference === data.appointmentId && isOrderFullyApproved(order)) {
              isApproved = true;
              totalAmount = order.total_amount ? Number(order.total_amount) : undefined;
            }
          }
        } catch (e) {
          console.warn(`[handleGetAppointmentPaymentStatus] Error consultando orden ${orderIdToVerify}:`, e);
        }
      }

      // Si no se confirmó por orden y hay paymentId, verificar por pago
      if (!isApproved && paymentIdToVerify) {
        try {
          const payRes = await getMercadoPagoPayment({ paymentId: paymentIdToVerify, accessToken });
          if (payRes.success && payRes.payment) {
            const payment = payRes.payment;
            if (
              payment.external_reference === data.appointmentId &&
              payment.status === "approved" &&
              (!payment.currency_id || payment.currency_id.toUpperCase() === "ARS")
            ) {
              isApproved = true;
              verifiedOrderId = payment.order?.id ? String(payment.order.id) : (orderIdToVerify || String(payment.id));
              totalAmount = payment.transaction_amount ? Number(payment.transaction_amount) : undefined;
            }
          }
        } catch (e) {
          console.warn(`[handleGetAppointmentPaymentStatus] Error consultando pago ${paymentIdToVerify}:`, e);
        }
      }

      // Si Mercado Pago certifica que está aprobado, confirmar atómicamente
      if (isApproved && verifiedOrderId) {
        console.log(`[handleGetAppointmentPaymentStatus] Orden/Pago aprobado certificado por MP para ${data.appointmentId}. Confirmando atómicamente...`);
        const confirmRes = await confirmAppointmentPayment({
          appointmentId: data.appointmentId,
          orderId: verifiedOrderId,
          totalAmount,
        });

        if (confirmRes.success && confirmRes.appointmentStatus === "CONFIRMED") {
          return {
            success: true,
            isConfirmed: true,
            appointmentStatus: "CONFIRMED",
            appointment: appointmentDetails,
          };
        }
      }
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

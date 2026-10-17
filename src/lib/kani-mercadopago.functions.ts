import { createServerFn } from "@tanstack/react-start";
import { createMercadoPagoOrder, getDynamicDownPayment } from "./kani-mercadopago";

export type CreateBookingOrderInput = {
  appointmentId: string;
  serviceName: string;
  barberName: string;
  servicePrice: number;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
};

export type CreateBookingOrderResult = {
  success: boolean;
  orderId?: string;
  initPoint?: string;
  checkoutUrl?: string;
  depositAmount?: number;
  error?: string;
};

function getRuntimeEnv(name: string): string | undefined {
  const runtimeValues = (globalThis as typeof globalThis & {
    __KANI_RUNTIME_ENV?: Record<string, string>;
  }).__KANI_RUNTIME_ENV;
  const runtimeValue =
    runtimeValues?.[name] ??
    (typeof process !== "undefined" ? process.env[name] : undefined);
  return typeof runtimeValue === "string" && runtimeValue.trim()
    ? runtimeValue.trim()
    : undefined;
}

export const createBookingOrderFn = createServerFn({ method: "POST" })
  .validator((data: CreateBookingOrderInput) => {
    if (!data?.appointmentId || !data?.clientEmail || !data?.serviceName) {
      throw new Error("BOOKING_ORDER_INPUT_INVALID");
    }
    return data;
  })
  .handler(async ({ data }): Promise<CreateBookingOrderResult> => {
    try {
      const accessToken = getRuntimeEnv("MERCADOPAGO_ACCESS_TOKEN");
      if (!accessToken) {
        console.warn(
          "[Mercado Pago] MERCADOPAGO_ACCESS_TOKEN no configurado en variables de entorno.",
        );
        return {
          success: false,
          error: "MERCADOPAGO_NOT_CONFIGURED",
        };
      }

      // Obtener el monto de la seña dinámica de forma no hardcodeada
      const dynamicDeposit = await getDynamicDownPayment(data.barberName);
      const depositAmount = data.servicePrice > 0
        ? Math.min(dynamicDeposit, data.servicePrice)
        : dynamicDeposit;

      // URL del webhook registrada en Mercado Pago Developers
      const notificationUrl =
        getRuntimeEnv("MERCADOPAGO_NOTIFICATION_URL") ??
        "https://kanibarberstudio-cloudflare.tomasblutmannliriumprive.workers.dev/api/webhook/mercadopago";

      const appBaseUrl =
        getRuntimeEnv("KANI_APP_URL") ??
        "https://kanibarberstudio-cloudflare.tomasblutmannliriumprive.workers.dev";
      const returnUrl = `${appBaseUrl.replace(/\/$/, "")}/reservar?status=return&appointment_id=${encodeURIComponent(data.appointmentId)}`;

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
          returnUrl,
          expirationMinutes: 10,
        },
        accessToken,
        idempotencyKey: data.appointmentId,
      });

      if (!orderResult.success) {
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
      console.error("[Mercado Pago] Error en createBookingOrderFn:", errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  });

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
      const notificationUrl =
        getRuntimeEnv("MERCADOPAGO_NOTIFICATION_URL") ??
        "https://kanibarberstudio-cloudflare.kanibarber.workers.dev/api/webhook/mercadopago";

      const appBaseUrl =
        getRuntimeEnv("KANI_APP_URL") ??
        "https://kanibarberstudio-cloudflare.kanibarber.workers.dev";
      const returnUrl = `${appBaseUrl.replace(/\/$/, "")}/reservar?status=return&appointment_id=${encodeURIComponent(data.appointmentId)}`;

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

      // Obtener el monto de la seña dinámica de forma no hardcodeada
      const dynamicDeposit = await getDynamicDownPayment(data.barberName);
      const depositAmount = data.servicePrice > 0
        ? Math.min(dynamicDeposit, data.servicePrice)
        : dynamicDeposit;

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
      console.error("[Mercado Pago] Error en createBookingOrderFn:", errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  });

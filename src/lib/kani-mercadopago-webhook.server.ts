import { getRuntimeEnv, verifyAndConfirmAppointmentPayment } from "./kani-mercadopago.server";
import { verifyMercadoPagoWebhookSignature, getMercadoPagoOrder, getMercadoPagoPayment } from "./kani-mercadopago";

// Processing is awaited BEFORE acknowledgement. Failures return 503 so MP can retry.
// No untracked work after Response and no isolate-local deduplication guarantee.
export async function handleMercadoPagoWebhook(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const secret = getRuntimeEnv("MERCADOPAGO_WEBHOOK_SECRET");
  const accessToken = getRuntimeEnv("MERCADOPAGO_ACCESS_TOKEN");
  if (!secret || !accessToken) return new Response("Webhook not configured", { status: 503 });
  const url = new URL(request.url);
  const dataId = url.searchParams.get("data.id");
  if (!dataId || url.searchParams.getAll("data.id").length !== 1) return new Response("Missing resource ID", { status: 400 });
  if (!verifyMercadoPagoWebhookSignature({
    dataId, secret,
    xSignature: request.headers.get("x-signature"),
    xRequestId: request.headers.get("x-request-id"),
    toleranceSeconds: 300,
  })) return new Response("Invalid signature", { status: 401 });
  try {
    const body = await request.json() as { type?: string; data?: { id?: string | number } };
    if (String(body.data?.id ?? "") !== dataId) return new Response("Resource mismatch", { status: 400 });
    if (body.type !== "order" && body.type !== "payment") return new Response("Ignored event", { status: 200 });
    let appointmentId: string | undefined;
    if (body.type === "order") {
      const result = await getMercadoPagoOrder({ orderId: dataId, accessToken });
      if (!result.success || !result.order) return new Response("Resource unavailable", { status: 503 });
      if (String(result.order.id) !== dataId) return new Response("Resource mismatch", { status: 400 });
      appointmentId = result.order.external_reference;
    } else {
      const result = await getMercadoPagoPayment({ paymentId: dataId, accessToken });
      if (!result.success || !result.payment) return new Response("Resource unavailable", { status: 503 });
      if (String(result.payment.id) !== dataId) return new Response("Resource mismatch", { status: 400 });
      appointmentId = result.payment.external_reference;
    }
    if (!appointmentId) return new Response("No booking reference", { status: 200 });
    const result = await verifyAndConfirmAppointmentPayment({
      appointmentId,
      ...(body.type === "order" ? { orderId: dataId } : { paymentId: dataId }),
    });
    if (result.resultCode === "FAILED") return new Response("Processing unavailable", { status: 503 });
    return new Response("OK", { status: 200 });
  } catch {
    return new Response("Processing unavailable", { status: 503 });
  }
}

import { createServerFn } from "@tanstack/react-start";

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

export type AppointmentPaymentStatusInput = {
  appointmentId: string;
  orderId?: string;
  paymentId?: string;
};

export type AppointmentPaymentStatusResult = {
  success: boolean;
  appointmentStatus?: string;
  isConfirmed: boolean;
  appointment?: {
    id: string;
    requestNumber?: number;
    serviceName?: string;
    barberName?: string;
    date?: string;
    time?: string;
    clientName?: string;
    clientPhone?: string;
    clientEmail?: string;
    depositAmountArs?: number;
  };
  error?: string;
  message?: string;
};

export const createBookingOrderFn = createServerFn({ method: "POST" })
  .validator((data: CreateBookingOrderInput) => {
    if (!data?.appointmentId || !data?.clientEmail || !data?.serviceName) {
      throw new Error("BOOKING_ORDER_INPUT_INVALID");
    }
    return data;
  })
  .handler(async ({ data }): Promise<CreateBookingOrderResult> => {
    const { handleCreateBookingOrder } = await import("./kani-mercadopago.server");
    return handleCreateBookingOrder(data);
  });

export const getAppointmentPaymentStatusFn = createServerFn({ method: "POST" })
  .validator((data: AppointmentPaymentStatusInput) => {
    if (!data?.appointmentId || typeof data.appointmentId !== "string") {
      throw new Error("APPOINTMENT_ID_REQUIRED");
    }
    return data;
  })
  .handler(async ({ data }): Promise<AppointmentPaymentStatusResult> => {
    const { handleGetAppointmentPaymentStatus } = await import("./kani-mercadopago.server");
    return handleGetAppointmentPaymentStatus(data);
  });

export type ConfirmedPaymentOrderInfo = {
  appointmentId: string;
  orderId: string;
  expectedAmountArs: number;
  paidAmountArs: number;
  reconciliationStatus: string;
  createdAt: string;
};

export const getConfirmedPaymentOrdersFn = createServerFn({ method: "GET" })
  .handler(async (): Promise<ConfirmedPaymentOrderInfo[]> => {
    const { handleGetConfirmedPaymentOrders } = await import("./kani-mercadopago.server");
    return handleGetConfirmedPaymentOrders();
  });

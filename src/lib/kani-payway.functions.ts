import { createServerFn } from '@tanstack/react-start';
import { validatePaywayDraft, validatePaywayPayment, validatePaywayStatusQuery } from './kani-payway';

export const preparePaywayCheckoutFn = createServerFn({ method: 'POST' })
  .validator(validatePaywayDraft)
  .handler(async ({ data }) => {
    const { runtimePaywayService } = await import('./kani-payway.server');
    return (await runtimePaywayService()).prepare(data);
  });

export const payPaywayDepositFn = createServerFn({ method: 'POST' })
  .validator(validatePaywayPayment)
  .handler(async ({ data }) => {
    const { runtimePaywayService } = await import('./kani-payway.server');
    return (await runtimePaywayService()).pay(data);
  });

export const checkPaywayPaymentStatusFn = createServerFn({ method: 'POST' })
  .validator(validatePaywayStatusQuery)
  .handler(async ({ data }) => {
    const { runtimePaywayService } = await import('./kani-payway.server');
    return (await runtimePaywayService()).checkPaymentStatus(data);
  });

export const releaseUnpaidBookingHoldFn = createServerFn({ method: 'POST' })
  .validator((input: unknown): { appointmentId: string } => {
    const raw = (input && typeof input === 'object' ? (input as Record<string, unknown>).appointmentId : '') ?? '';
    const appointmentId = String(raw).trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appointmentId)) {
      throw new Error('INVALID_APPOINTMENT_ID');
    }
    return { appointmentId };
  })
  .handler(async ({ data }) => {
    const { releaseAbandonedUnpaidHoldServer } = await import('./kani-unpaid-hold.server');
    return releaseAbandonedUnpaidHoldServer({ appointmentId: data.appointmentId });
  });

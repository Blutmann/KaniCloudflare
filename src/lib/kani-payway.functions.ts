import { createServerFn } from '@tanstack/react-start';
import { validatePaywayDraft, validatePaywayPayment } from './kani-payway';

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

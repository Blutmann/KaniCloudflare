import { createServerFn } from '@tanstack/react-start';
import type { BenefitCodeType } from './kani-benefit-codes';

export const adminListBenefitCodesFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    if (d && typeof d === 'object' && typeof (d as any).token === 'string') {
      return { token: (d as any).token as string };
    }
    return { token: undefined };
  })
  .handler(async ({ data }) => {
    const { adminListBenefitCodes } = await import('./kani-benefit-codes.server');
    return adminListBenefitCodes(data?.token);
  });

export const adminCreateBenefitCodeFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    if (!d || typeof d !== 'object') throw new Error('INVALID_INPUT');
    const input = d as { type: BenefitCodeType; internalNote?: string; code?: string; token?: string };
    if (!['NO_DEPOSIT', 'FREE_SERVICE', 'PERCENT_10', 'PERCENT_50'].includes(input.type)) {
      throw new Error('INVALID_BENEFIT_TYPE');
    }
    return input;
  })
  .handler(async ({ data }) => {
    const { adminCreateBenefitCode } = await import('./kani-benefit-codes.server');
    return adminCreateBenefitCode(data);
  });

export const adminDisableBenefitCodeFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    if (!d || typeof d !== 'object' || typeof (d as any).codeId !== 'string') {
      throw new Error('INVALID_CODE_ID');
    }
    return d as { codeId: string; token?: string };
  })
  .handler(async ({ data }) => {
    const { adminDisableBenefitCode } = await import('./kani-benefit-codes.server');
    return adminDisableBenefitCode(data.codeId, data.token);
  });

export const validateBenefitCodeQuoteFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    if (!d || typeof d !== 'object') throw new Error('INVALID_QUOTE_INPUT');
    const input = d as { code: string; serviceName: string; barberName?: string; barber?: string };
    if (typeof input.code !== 'string' || !input.code.trim()) throw new Error('CODE_REQUIRED');
    return {
      code: input.code,
      serviceName: input.serviceName,
      barberName: input.barberName ?? input.barber ?? '',
    };
  })
  .handler(async ({ data }) => {
    const { validateBenefitCodeQuote } = await import('./kani-benefit-codes.server');
    return validateBenefitCodeQuote(data);
  });

export const confirmZeroDepositBookingFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    if (!d || typeof d !== 'object') throw new Error('INVALID_BOOKING_INPUT');
    const input = d as any;
    const barberName = String(input.barberName ?? input.barber ?? '').trim();
    const serviceName = String(input.serviceName ?? '').trim();
    const bookingDate = String(input.bookingDate ?? input.date ?? '').trim();
    const startTime = String(input.startTime ?? input.time ?? '').trim();
    const clientName = String(input.clientName ?? input.name ?? '').trim();
    const clientPhone = String(input.clientPhone ?? input.phone ?? '').trim();
    const clientEmail = String(input.clientEmail ?? input.email ?? '').trim();
    const benefitCode = String(input.benefitCode ?? input.code ?? '').trim();
    const notes = input.notes ? String(input.notes) : undefined;

    if (!benefitCode || !barberName || !serviceName || !bookingDate || !startTime) {
      throw new Error('REQUIRED_FIELDS_MISSING');
    }
    return {
      barberName,
      serviceName,
      bookingDate,
      startTime,
      clientName,
      clientPhone,
      clientEmail,
      benefitCode,
      notes,
    };
  })
  .handler(async ({ data }) => {
    const { confirmZeroDepositBooking } = await import('./kani-benefit-codes.server');
    return confirmZeroDepositBooking(data);
  });

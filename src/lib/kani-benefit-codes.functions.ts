import { createServerFn } from '@tanstack/react-start';
import type {
  BenefitCodeType,
  BenefitDurationUnit,
  BenefitUsageMode,
  BenefitValidityType,
} from './kani-benefit-codes';

export const adminListBenefitCodesFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    if (d && typeof d === 'object') {
      const obj = d as any;
      return {
        token: typeof obj.token === 'string' ? obj.token : undefined,
        includeDeleted: obj.includeDeleted !== false,
      };
    }
    return { token: undefined, includeDeleted: true };
  })
  .handler(async ({ data }) => {
    const { adminListBenefitCodes } = await import('./kani-benefit-codes.server');
    return adminListBenefitCodes(data?.token, data?.includeDeleted);
  });

export const adminCreateBenefitCodeFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    if (!d || typeof d !== 'object') throw new Error('INVALID_INPUT');
    const input = d as {
      type: BenefitCodeType;
      internalNote?: string;
      code?: string;
      usageMode?: BenefitUsageMode;
      validityType?: BenefitValidityType;
      startDate?: string;
      endDate?: string;
      durationValue?: number;
      durationUnit?: BenefitDurationUnit;
      token?: string;
    };
    if (!['NO_DEPOSIT', 'FREE_SERVICE', 'PERCENT_10', 'PERCENT_50'].includes(input.type)) {
      throw new Error('INVALID_BENEFIT_TYPE');
    }
    if (input.usageMode !== 'SINGLE_USE' && input.usageMode !== 'REUSABLE') {
      throw new Error('INVALID_USAGE_MODE: Debe seleccionarse explícitamente la modalidad de uso (Un solo uso o Reutilizable).');
    }
    return input;
  })
  .handler(async ({ data }) => {
    const { adminCreateBenefitCode } = await import('./kani-benefit-codes.server');
    return adminCreateBenefitCode(data);
  });

export const adminUpdateBenefitCodeValidityFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    if (!d || typeof d !== 'object') throw new Error('INVALID_INPUT');
    const input = d as {
      codeId: string;
      validityType: BenefitValidityType;
      startDate?: string;
      endDate?: string;
      durationValue?: number;
      durationUnit?: BenefitDurationUnit;
      token?: string;
    };
    if (!input.codeId) throw new Error('CODE_ID_REQUIRED');
    return input;
  })
  .handler(async ({ data }) => {
    const { adminUpdateBenefitCodeValidity } = await import('./kani-benefit-codes.server');
    return adminUpdateBenefitCodeValidity(data);
  });

export const adminToggleBenefitCodeStatusFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    if (!d || typeof d !== 'object') throw new Error('INVALID_INPUT');
    const input = d as { codeId: string; active: boolean; token?: string };
    if (!input.codeId || typeof input.active !== 'boolean') throw new Error('INVALID_TOGGLE_PARAMS');
    return input;
  })
  .handler(async ({ data }) => {
    const { adminToggleBenefitCodeStatus } = await import('./kani-benefit-codes.server');
    return adminToggleBenefitCodeStatus(data);
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

export const adminDeleteBenefitCodeFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    if (!d || typeof d !== 'object' || typeof (d as any).codeId !== 'string') {
      throw new Error('INVALID_CODE_ID');
    }
    return d as { codeId: string; token?: string };
  })
  .handler(async ({ data }) => {
    const { adminDeleteBenefitCode } = await import('./kani-benefit-codes.server');
    return adminDeleteBenefitCode(data.codeId, data.token);
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

// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  computeBenefitCodeStatus,
  generateBatchBenefitCodeString,
  generateContextualBenefitCodeSuggestions,
  isValidBenefitCodeFormat,
  type BenefitCodeItem,
} from '@/lib/kani-benefit-codes';
import { BenefitCodesAdminSection } from '@/components/kani/admin-benefit-codes-section';

const existingCodesFixture: BenefitCodeItem[] = [
  {
    id: 'lim-1',
    code: 'KANI-OFF-10USOS',
    type: 'PERCENT_10',
    usageMode: 'LIMITED_USE',
    validityType: 'NO_EXPIRATION',
    validFrom: '2026-11-01T10:00:00Z',
    timesUsed: 3,
    maxUses: 10,
    status: 'ACTIVE',
    createdByDisplayName: 'Admin Lautaro',
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-01T10:00:00Z',
  },
  {
    id: 'lim-2',
    code: 'KANI-AGOTADO-10',
    type: 'PERCENT_50',
    usageMode: 'LIMITED_USE',
    validityType: 'NO_EXPIRATION',
    validFrom: '2026-11-01T10:00:00Z',
    timesUsed: 10,
    maxUses: 10,
    status: 'ACTIVE',
    createdByDisplayName: 'Admin Lautaro',
    createdAt: '2026-11-02T10:00:00Z',
    updatedAt: '2026-11-02T10:00:00Z',
  },
];

const mockListFn = vi.fn().mockImplementation(() => Promise.resolve(existingCodesFixture));
const mockCreateFn = vi.fn().mockImplementation(({ data }) =>
  Promise.resolve({
    id: 'created-single-1',
    code: data.code || 'KANI-NEWW-1111',
    type: data.type,
    usageMode: data.usageMode,
    maxUses: data.usageMode === 'LIMITED_USE' ? 10 : data.usageMode === 'SINGLE_USE' ? 1 : null,
    validityType: data.validityType || 'NO_EXPIRATION',
    validFrom: new Date().toISOString(),
    timesUsed: 0,
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
);
const mockCreateBatchFn = vi.fn().mockImplementation(({ data }) =>
  Promise.resolve(
    Array.from({ length: data.batchCount }, (_, idx) => ({
      id: `batch-${idx + 1}`,
      code: `${data.prefix || 'KANI'}-B00${idx + 1}`,
      type: data.type,
      usageMode: data.usageMode,
      maxUses: data.usageMode === 'LIMITED_USE' ? 10 : data.usageMode === 'SINGLE_USE' ? 1 : null,
      validityType: data.validityType || 'NO_EXPIRATION',
      validFrom: new Date().toISOString(),
      timesUsed: 0,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }))
  )
);

vi.mock('@/lib/kani-benefit-codes.functions', () => ({
  adminListBenefitCodesFn: (...args: unknown[]) => mockListFn(...args),
  adminCreateBenefitCodeFn: (...args: unknown[]) => mockCreateFn(...args),
  adminCreateBenefitCodesBatchFn: (...args: unknown[]) => mockCreateBatchFn(...args),
  adminDisableBenefitCodeFn: vi.fn().mockResolvedValue(true),
  adminToggleBenefitCodeStatusFn: vi.fn().mockResolvedValue(true),
  adminUpdateBenefitCodeValidityFn: vi.fn().mockResolvedValue({}),
  adminDeleteBenefitCodeFn: vi.fn().mockResolvedValue(true),
  staffListBenefitCodesReadOnlyFn: (...args: unknown[]) => mockListFn(...args),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'mock-admin-token' } },
        error: null,
      }),
    },
  },
}));

describe('Benefit Codes — LIMITED_USE (10 usos), Batch 1X→5X→10X y Sugerencias Contextuales', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListFn.mockImplementation(() => Promise.resolve(existingCodesFixture));
  });

  it('computeBenefitCodeStatus marca LIMITED_USE como ACTIVE con < 10 usos y CONSUMED al llegar a 10/10', () => {
    expect(
      computeBenefitCodeStatus({
        status: 'ACTIVE',
        usageMode: 'LIMITED_USE',
        timesUsed: 0,
        maxUses: 10,
      })
    ).toBe('ACTIVE');

    expect(
      computeBenefitCodeStatus({
        status: 'ACTIVE',
        usageMode: 'LIMITED_USE',
        timesUsed: 9,
        maxUses: 10,
      })
    ).toBe('ACTIVE');

    expect(
      computeBenefitCodeStatus({
        status: 'ACTIVE',
        usageMode: 'LIMITED_USE',
        timesUsed: 10,
        maxUses: 10,
      })
    ).toBe('CONSUMED');
  });

  it('genera 2 sugerencias contextuales según fecha AR (Navidad / Año Nuevo), modalidad 10 usos y excluye códigos existentes', () => {
    const christmas = generateContextualBenefitCodeSuggestions({
      type: 'PERCENT_10',
      usageMode: 'LIMITED_USE',
      baseDate: new Date('2026-12-20T15:00:00Z'),
      existingCodes: ['KANI-OFF-10USOS'],
      count: 2,
    });
    expect(christmas).toHaveLength(2);
    expect(christmas[0]).toMatch(/^KANI-2026-NAVIDAD-[A-Z0-9]{4}$/);
    expect(christmas[1]).toMatch(/^KANI-OFF-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(christmas[0]).not.toBe(christmas[1]);
    christmas.forEach((c) => expect(isValidBenefitCodeFormat(c)).toBe(true));

    const newYear = generateContextualBenefitCodeSuggestions({
      type: 'PERCENT_50',
      usageMode: 'SINGLE_USE',
      baseDate: new Date('2026-12-29T15:00:00Z'),
      count: 2,
    });
    expect(newYear[0]).toMatch(/^KANI-2027-ANO-[A-Z0-9]{4}$/);

    // Batch helper with prefix
    const withPrefix = generateBatchBenefitCodeString('kani vip');
    expect(withPrefix).toMatch(/^KANI-VIP-[A-Z0-9]{4}$/);
    expect(isValidBenefitCodeFormat(withPrefix)).toBe(true);
  });

  it('muestra 3/10 usos y barra de progreso en el listado para códigos LIMITED_USE', async () => {
    render(<BenefitCodesAdminSection />);

    await waitFor(() => {
      expect(screen.getByText('KANI-OFF-10USOS')).toBeInTheDocument();
    });

    expect(screen.getByText('10% de descuento · 3/10 usos')).toBeInTheDocument();
    expect(screen.getByText('50% de descuento · 10/10 usos')).toBeInTheDocument();
    const barActive = screen.getByRole('progressbar', { name: 'Cupo utilizado: 3 de 10 usos' });
    const barExhausted = screen.getByRole('progressbar', { name: 'Cupo utilizado: 10 de 10 usos' });
    expect(barActive).toHaveAttribute('aria-valuenow', '3');
    expect(barActive).toHaveAttribute('aria-valuemax', '10');
    expect(barExhausted).toHaveAttribute('aria-valuenow', '10');
    expect(barExhausted).toHaveAttribute('aria-valuemax', '10');
  });

  it('en el modal Generar código permite elegir 10 usos, conmutar 1X → 5X → 10X, usar sugerencias y crear lote con Copiar todos', async () => {
    render(<BenefitCodesAdminSection />);

    await waitFor(() => {
      expect(screen.getByText('KANI-OFF-10USOS')).toBeInTheDocument();
    });

    // Abrir modal
    fireEvent.click(screen.getAllByRole('button', { name: /Generar código/i })[0]);

    // 3 pills en Cantidad de usos
    expect(screen.getByText('Cantidad de usos:')).toBeInTheDocument();
    expect(screen.getByText('Único uso')).toBeInTheDocument();
    expect(screen.getByText('10 usos')).toBeInTheDocument();
    expect(screen.getByText('Reutilizable')).toBeInTheDocument();

    // Seleccionar "10 usos"
    fireEvent.click(screen.getByText('10 usos'));

    // 2 chips de sugerencia al 50%
    const suggestionsGrid = screen.getByTestId('code-suggestions-grid');
    const chips = suggestionsGrid.querySelectorAll('button');
    expect(chips).toHaveLength(2);
    const firstSuggestion = chips[0].textContent || '';
    expect(firstSuggestion).not.toBe('KANI-OFF-10USOS');
    fireEvent.click(chips[0]);
    const codeInput = screen.getByLabelText(/Código personalizado/i) as HTMLInputElement;
    expect(codeInput.value).toBe(firstSuggestion);

    // Botón cíclico 1X → 5X → 10X → 1X
    const cycleBtn = screen.getByTestId('batch-count-cycle-btn');
    expect(cycleBtn.textContent).toBe('1X');

    fireEvent.click(cycleBtn);
    expect(cycleBtn.textContent).toBe('5X');
    expect(screen.getByLabelText(/Prefijo del lote ×5 \(opcional\)/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Crear 5 códigos/i })).toBeInTheDocument();

    fireEvent.click(cycleBtn);
    expect(cycleBtn.textContent).toBe('10X');
    expect(screen.getByLabelText(/Prefijo del lote ×10 \(opcional\)/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Crear 10 códigos/i })).toBeInTheDocument();

    // Volver a 5X y crear lote con prefijo
    fireEvent.click(cycleBtn); // -> 1X
    fireEvent.click(cycleBtn); // -> 5X
    const prefixInput = screen.getByLabelText(/Prefijo del lote ×5 \(opcional\)/i) as HTMLInputElement;
    fireEvent.change(prefixInput, { target: { value: 'KANI-VIP' } });

    fireEvent.click(screen.getByRole('button', { name: /Crear 5 códigos/i }));

    await waitFor(() => {
      expect(mockCreateBatchFn).toHaveBeenCalledTimes(1);
    });
    expect(mockCreateBatchFn.mock.calls[0][0].data).toMatchObject({
      usageMode: 'LIMITED_USE',
      batchCount: 5,
      maxUses: 10,
      prefix: 'KANI-VIP',
    });

    // Muestra los 5 códigos generados y el botón Copiar todos
    await waitFor(() => {
      expect(screen.getByText(/¡5 códigos generados con éxito!/i)).toBeInTheDocument();
    });
    expect(screen.getByText('KANI-VIP-B001')).toBeInTheDocument();
    expect(screen.getByText('KANI-VIP-B005')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copiar todos/i })).toBeInTheDocument();
  });
});

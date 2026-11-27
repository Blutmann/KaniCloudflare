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
import {
  buildBenefitCodesExportFilename,
  mapBenefitCodesToExportRows,
} from '@/lib/kani-benefit-codes-xlsx';
import { BenefitCodesAdminSection } from '@/components/kani/admin-benefit-codes-section';

let mockStaffRole: 'ADMIN' | 'MANAGER' | 'BARBER' = 'ADMIN';

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
const mockDownloadXlsx = vi.fn().mockResolvedValue('kani-codigos-descuento-2026-11-27.xlsx');
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

vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => ({
    profile: {
      user_id: 'staff-1',
      role: mockStaffRole,
      display_name: 'Staff Test',
      active: true,
      barber_id: mockStaffRole === 'BARBER' ? 'barber-1' : null,
    },
  }),
}));

vi.mock('@/lib/kani-benefit-codes-xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kani-benefit-codes-xlsx')>();
  return {
    ...actual,
    downloadBenefitCodesXlsx: (...args: unknown[]) => mockDownloadXlsx(...args),
  };
});

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
    mockStaffRole = 'ADMIN';
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

  it('acepta Ñ en isValidBenefitCodeFormat y genera sugerencias contextuales (Navidad, Año Nuevo con Ñ, Sin seña con Ñ) excluyendo códigos existentes', () => {
    expect(isValidBenefitCodeFormat('KANI-SIN-SEÑA-X910')).toBe(true);
    expect(isValidBenefitCodeFormat('KANI-2027-AÑO-7J9Q')).toBe(true);

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
      type: 'NO_DEPOSIT',
      usageMode: 'SINGLE_USE',
      baseDate: new Date('2026-12-29T15:00:00Z'),
      count: 2,
    });
    expect(newYear[0]).toMatch(/^KANI-2027-AÑO-[A-Z0-9]{4}$/);
    expect(newYear[1]).toMatch(/^KANI-SIN-SEÑA-[A-Z0-9]{4}$/);
    newYear.forEach((c) => expect(isValidBenefitCodeFormat(c)).toBe(true));

    // Batch helper with prefix preserving Ñ
    const withPrefix = generateBatchBenefitCodeString('kani seña');
    expect(withPrefix).toMatch(/^KANI-SEÑA-[A-Z0-9]{4}$/);
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

  it('en el modal Generar código muestra sugerencia en placeholder (sin Ej: ni chips inferiores), botón solo-ícono ↻ adentro del input y lote 1X → 5X → 10X', async () => {
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

    // Sin chips debajo del input y sin botón de texto "Nuevas"
    expect(screen.queryByTestId('code-suggestions-grid')).toBeNull();
    expect(screen.queryByText('Nuevas')).toBeNull();

    // Sugerencia contextual directo en el placeholder sin "Ej:" + botón solo-ícono ↻ dentro del input
    const codeInput = screen.getByLabelText(/Código personalizado/i) as HTMLInputElement;
    const initialPlaceholder = codeInput.placeholder;
    expect(initialPlaceholder).toMatch(/^KANI-/);
    expect(initialPlaceholder).not.toMatch(/^Ej:/i);
    expect(initialPlaceholder).not.toBe('KANI-OFF-10USOS');

    const rotateBtn = screen.getByTestId('rotate-suggestion-btn');
    expect(rotateBtn.textContent?.trim()).toBe('');
    expect(rotateBtn.parentElement?.contains(codeInput)).toBe(true);

    fireEvent.click(rotateBtn);
    const rotatedPlaceholder = codeInput.placeholder;
    expect(rotatedPlaceholder).toMatch(/^KANI-/);
    expect(rotatedPlaceholder).not.toBe(initialPlaceholder);
    expect(rotatedPlaceholder).not.toBe('KANI-OFF-10USOS');

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

  it('el botón solo-ícono de exportar a Excel está disponible para ADMIN, MANAGER y BARBER y se deshabilita con 0 resultados', async () => {
    for (const role of ['ADMIN', 'MANAGER', 'BARBER'] as const) {
      mockStaffRole = role;
      mockDownloadXlsx.mockClear();

      const { unmount } = render(<BenefitCodesAdminSection hideHeading />);

      await waitFor(() => {
        expect(screen.getByText('2 descuentos encontrados')).toBeInTheDocument();
      });

      const exportBtn = screen.getByRole('button', { name: 'Exportar códigos a Excel' });
      expect(exportBtn).toBeInTheDocument();
      expect(exportBtn.textContent?.trim()).toBe('');
      expect(exportBtn).not.toBeDisabled();

      fireEvent.click(exportBtn);
      await waitFor(() => {
        expect(mockDownloadXlsx).toHaveBeenCalledTimes(1);
      });
      expect(mockDownloadXlsx.mock.calls[0][0]).toHaveLength(2);

      unmount();
    }

    // Con 0 resultados, el botón debe estar deshabilitado
    mockStaffRole = 'ADMIN';
    mockListFn.mockResolvedValueOnce([]);
    render(<BenefitCodesAdminSection hideHeading />);

    await waitFor(() => {
      expect(screen.getByText('0 descuentos encontrados')).toBeInTheDocument();
    });

    const disabledBtn = screen.getByRole('button', { name: 'Exportar códigos a Excel' });
    expect(disabledBtn).toBeDisabled();
  });

  it('mapea correctamente las columnas en español y el nombre de archivo kani-codigos-descuento-YYYY-MM-DD.xlsx', () => {
    expect(buildBenefitCodesExportFilename('2026-11-27')).toBe('kani-codigos-descuento-2026-11-27.xlsx');
    const rows = mapBenefitCodesToExportRows(existingCodesFixture);
    expect(rows[0]).toMatchObject({
      codigo: 'KANI-OFF-10USOS',
      estado: 'Habilitado',
      cantidadDeUsos: '10 usos',
      usos: '3/10',
      beneficio: '10% de descuento',
      vigencia: 'Sin vencimiento',
    });
  });
});

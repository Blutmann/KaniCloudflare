import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BenefitCodesAdminSection } from '@/components/kani/admin-benefit-codes-section';
import type { BenefitCodeItem } from '@/lib/kani-benefit-codes';

const mockCodes: BenefitCodeItem[] = [
  {
    id: 'code-1',
    code: 'KANI-BETA-1234',
    type: 'NO_DEPOSIT',
    internalNote: 'Cortesía cliente VIP',
    status: 'ACTIVE',
    createdByDisplayName: 'Admin Lautaro',
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-01T10:00:00Z',
  },
  {
    id: 'code-2',
    code: 'KANI-ALFA-9999',
    type: 'FREE_SERVICE',
    internalNote: 'Influencer sorteo',
    status: 'CONSUMED',
    createdByDisplayName: 'Admin Fran',
    createdAt: '2026-11-02T12:00:00Z',
    updatedAt: '2026-11-02T12:00:00Z',
    consumedAt: '2026-11-02T14:00:00Z',
    consumedAppointmentId: 'appt-1',
    consumedClientId: 'client-1',
    clientName: 'Juan Pérez',
    clientPhone: '+5491128436014',
    appointmentRequestNumber: 1042,
    appointmentDate: '2026-11-05',
    appointmentTime: '15:00',
    originalPriceArs: 25000,
    discountAmountArs: 25000,
    finalPriceArs: 0,
    onlineDepositArs: 0,
    inPersonBalanceArs: 0,
  },
  {
    id: 'code-3',
    code: 'KANI-ZETA-5555',
    type: 'PERCENT_50',
    internalNote: 'Descuento apertura',
    status: 'DISABLED',
    createdByDisplayName: 'Admin Lautaro',
    createdAt: '2026-10-28T09:00:00Z',
    updatedAt: '2026-10-28T09:00:00Z',
  },
];

const mockListFn = vi.fn().mockImplementation(() => Promise.resolve(mockCodes));
const mockCreateFn = vi.fn().mockImplementation(({ data }) =>
  Promise.resolve({
    id: 'code-new',
    code: data.code || 'KANI-NEWW-8888',
    type: data.type,
    internalNote: data.internalNote,
    status: 'ACTIVE',
    createdByDisplayName: 'Admin Test',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
);
const mockDisableFn = vi.fn().mockResolvedValue(true);

vi.mock('@/lib/kani-benefit-codes.functions', () => ({
  adminListBenefitCodesFn: (...args: any[]) => mockListFn(...args),
  adminCreateBenefitCodeFn: (...args: any[]) => mockCreateFn(...args),
  adminDisableBenefitCodeFn: (...args: any[]) => mockDisableFn(...args),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'mock-session-token-123' } },
        error: null,
      }),
    },
  },
}));

describe('BenefitCodesAdminSection Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListFn.mockImplementation(() => Promise.resolve(mockCodes));
  });

  it('renders section heading, codes list and all filter and sort options', async () => {
    render(<BenefitCodesAdminSection />);

    expect(screen.getByText(/Descuentos y Beneficios/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('KANI-BETA-1234')).toBeInTheDocument();
      expect(screen.getByText('KANI-ALFA-9999')).toBeInTheDocument();
      expect(screen.getByText('KANI-ZETA-5555')).toBeInTheDocument();
    });

    // Check badges
    expect(screen.getByText('Sin seña')).toBeInTheDocument();
    expect(screen.getByText('100% bonificado')).toBeInTheDocument();
    expect(screen.getByText('50% OFF')).toBeInTheDocument();

    // Check consumed details
    expect(screen.getByText(/Juan Pérez/i)).toBeInTheDocument();
    expect(screen.getByText(/Turno #1042/i)).toBeInTheDocument();

    // Check dropdown selectors exist
    const statusSelect = screen.getByLabelText('Estado') as HTMLSelectElement;
    expect(statusSelect).toBeInTheDocument();
    expect(statusSelect.value).toBe('ALL');

    // Check status options have counts
    expect(screen.getByRole('option', { name: 'Todos (3)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Disponibles (1)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'En checkout (0)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Consumidos (1)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Desactivados (1)' })).toBeInTheDocument();

    // Check sort selector
    const sortSelect = screen.getByLabelText('Ordenar por') as HTMLSelectElement;
    expect(sortSelect).toBeInTheDocument();
    expect(sortSelect.value).toBe('RECENT');
    expect(screen.getByRole('option', { name: 'Más recientes' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Más antiguos' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Nombre A-Z' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Nombre Z-A' })).toBeInTheDocument();
  });

  it('filters by status when changing the Estado select', async () => {
    render(<BenefitCodesAdminSection />);

    await waitFor(() => {
      expect(screen.getByText('KANI-BETA-1234')).toBeInTheDocument();
    });

    const statusSelect = screen.getByLabelText('Estado');
    // Filter by ACTIVE (Disponibles)
    fireEvent.change(statusSelect, { target: { value: 'ACTIVE' } });

    expect(screen.getByText('KANI-BETA-1234')).toBeInTheDocument();
    expect(screen.queryByText('KANI-ALFA-9999')).not.toBeInTheDocument();
    expect(screen.queryByText('KANI-ZETA-5555')).not.toBeInTheDocument();

    // Filter by CONSUMED (Consumidos)
    fireEvent.change(statusSelect, { target: { value: 'CONSUMED' } });
    expect(screen.queryByText('KANI-BETA-1234')).not.toBeInTheDocument();
    expect(screen.getByText('KANI-ALFA-9999')).toBeInTheDocument();
    expect(screen.queryByText('KANI-ZETA-5555')).not.toBeInTheDocument();
  });

  it('sorts alphabetically by code text when selecting Nombre A-Z and Nombre Z-A', async () => {
    render(<BenefitCodesAdminSection />);

    await waitFor(() => {
      expect(screen.getByText('KANI-BETA-1234')).toBeInTheDocument();
    });

    const sortSelect = screen.getByLabelText('Ordenar por');

    // 1. Sort Nombre A-Z: ALFA -> BETA -> ZETA
    fireEvent.change(sortSelect, { target: { value: 'CODE_ASC' } });
    const codeElementsAsc = screen.getAllByText(/KANI-(ALFA|BETA|ZETA)/).map((el) => el.textContent);
    expect(codeElementsAsc).toEqual(['KANI-ALFA-9999', 'KANI-BETA-1234', 'KANI-ZETA-5555']);

    // 2. Sort Nombre Z-A: ZETA -> BETA -> ALFA
    fireEvent.change(sortSelect, { target: { value: 'CODE_DESC' } });
    const codeElementsDesc = screen.getAllByText(/KANI-(ALFA|BETA|ZETA)/).map((el) => el.textContent);
    expect(codeElementsDesc).toEqual(['KANI-ZETA-5555', 'KANI-BETA-1234', 'KANI-ALFA-9999']);

    // 3. Sort Más antiguos (createdAt asc): ZETA (Oct 28) -> BETA (Nov 1) -> ALFA (Nov 2)
    fireEvent.change(sortSelect, { target: { value: 'OLDEST' } });
    const codeElementsOldest = screen.getAllByText(/KANI-(ALFA|BETA|ZETA)/).map((el) => el.textContent);
    expect(codeElementsOldest).toEqual(['KANI-ZETA-5555', 'KANI-BETA-1234', 'KANI-ALFA-9999']);

    // 4. Sort Más recientes (createdAt desc): ALFA (Nov 2) -> BETA (Nov 1) -> ZETA (Oct 28)
    fireEvent.change(sortSelect, { target: { value: 'RECENT' } });
    const codeElementsRecent = screen.getAllByText(/KANI-(ALFA|BETA|ZETA)/).map((el) => el.textContent);
    expect(codeElementsRecent).toEqual(['KANI-ALFA-9999', 'KANI-BETA-1234', 'KANI-ZETA-5555']);
  });

  it('coexists search by text, status filter, and order', async () => {
    render(<BenefitCodesAdminSection />);

    await waitFor(() => {
      expect(screen.getByText('KANI-BETA-1234')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Buscar por código, cliente o nota…/i);
    fireEvent.change(searchInput, { target: { value: 'Juan Pérez' } });

    // Only Juan Pérez (KANI-ALFA-9999) should appear
    expect(screen.getByText('KANI-ALFA-9999')).toBeInTheDocument();
    expect(screen.queryByText('KANI-BETA-1234')).not.toBeInTheDocument();
    expect(screen.queryByText('KANI-ZETA-5555')).not.toBeInTheDocument();
  });

  it('handles error state properly: shows error alert and retry button, WITHOUT "No se encontraron códigos" or 0 counters', async () => {
    mockListFn.mockRejectedValueOnce(new Error('UNAUTHORIZED_ADMIN_ONLY: Acceso denegado.'));

    render(<BenefitCodesAdminSection />);

    await waitFor(() => {
      expect(screen.getByText(/Error al consultar los códigos de beneficio/i)).toBeInTheDocument();
    });

    // Must show clear error explanation
    expect(screen.getByText(/No se pudieron consultar los códigos porque la sesión no cuenta con permisos de administrador/i)).toBeInTheDocument();

    // Must have Reintentar button
    const retryBtn = screen.getByRole('button', { name: /Reintentar/i });
    expect(retryBtn).toBeInTheDocument();

    // MUST NOT show "No se encontraron códigos"
    expect(screen.queryByText('No se encontraron códigos')).not.toBeInTheDocument();

    // MUST NOT render filter select with 0 counters in error state
    expect(screen.queryByLabelText('Estado')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Ordenar por')).not.toBeInTheDocument();

    // Clicking Reintentar triggers a new request
    mockListFn.mockResolvedValueOnce(mockCodes);
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('KANI-BETA-1234')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Error al consultar los códigos de beneficio/i)).not.toBeInTheDocument();
  });

  it('passes session token when creating or disabling codes', async () => {
    render(<BenefitCodesAdminSection />);

    await waitFor(() => {
      expect(screen.getByText('KANI-BETA-1234')).toBeInTheDocument();
    });

    // 1. Create code
    const generateBtn = screen.getByRole('button', { name: /Generar código/i });
    fireEvent.click(generateBtn);

    const submitBtn = screen.getByRole('button', { name: /Crear código/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            token: 'mock-session-token-123',
          }),
        })
      );
    });

    // 2. Disable code
    const disableBtn = screen.getByTitle('Desactivar este código');
    fireEvent.click(disableBtn);

    const confirmDisableBtn = screen.getByRole('button', { name: /Confirmar desactivación/i });
    fireEvent.click(confirmDisableBtn);

    await waitFor(() => {
      expect(mockDisableFn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            codeId: 'code-1',
            token: 'mock-session-token-123',
          }),
        })
      );
    });
  });

  it('copies code to clipboard when clicking Copiar button', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    render(<BenefitCodesAdminSection />);

    await waitFor(() => {
      expect(screen.getByText('KANI-BETA-1234')).toBeInTheDocument();
    });

    const copyButtons = screen.getAllByRole('button', { name: /Copiar/i });
    fireEvent.click(copyButtons[0]);

    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });
});

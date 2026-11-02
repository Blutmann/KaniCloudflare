import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BenefitCodesAdminSection } from '@/components/kani/admin-benefit-codes-section';
import type { BenefitCodeItem } from '@/lib/kani-benefit-codes';

const mockCodes: BenefitCodeItem[] = [
  {
    id: 'code-1',
    code: 'KANI-ABCD-1234',
    type: 'NO_DEPOSIT',
    internalNote: 'Cortesía cliente VIP',
    status: 'ACTIVE',
    createdByDisplayName: 'Admin Lautaro',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'code-2',
    code: 'KANI-FREE-9999',
    type: 'FREE_SERVICE',
    internalNote: 'Influencer sorteo',
    status: 'CONSUMED',
    createdByDisplayName: 'Admin Fran',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    consumedAt: new Date().toISOString(),
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
];

vi.mock('@/lib/kani-benefit-codes.functions', () => ({
  adminListBenefitCodesFn: vi.fn().mockImplementation(() => Promise.resolve(mockCodes)),
  adminCreateBenefitCodeFn: vi.fn().mockImplementation(({ data }) =>
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
  ),
  adminDisableBenefitCodeFn: vi.fn().mockResolvedValue(true),
}));

describe('BenefitCodesAdminSection Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders section heading, codes list and all 4 filter options', async () => {
    render(<BenefitCodesAdminSection />);

    expect(screen.getByText(/Descuentos y Beneficios/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('KANI-ABCD-1234')).toBeInTheDocument();
      expect(screen.getByText('KANI-FREE-9999')).toBeInTheDocument();
    });

    // Check badges
    expect(screen.getByText('Sin seña')).toBeInTheDocument();
    expect(screen.getByText('100% bonificado')).toBeInTheDocument();

    // Check consumed details
    expect(screen.getByText(/Juan Pérez/i)).toBeInTheDocument();
    expect(screen.getByText(/Turno #1042/i)).toBeInTheDocument();
  });

  it('allows opening creation dialog with all 4 benefit types', async () => {
    render(<BenefitCodesAdminSection />);

    const generateBtn = screen.getByRole('button', { name: /Generar código/i });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(screen.getByText('Reserva sin seña')).toBeInTheDocument();
      expect(screen.getByText('Servicio gratuito')).toBeInTheDocument();
      expect(screen.getByText('Descuento del 10 %')).toBeInTheDocument();
      expect(screen.getByText('Descuento del 50 %')).toBeInTheDocument();
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
      expect(screen.getByText('KANI-ABCD-1234')).toBeInTheDocument();
    });

    const copyButtons = screen.getAllByRole('button', { name: /Copiar/i });
    fireEvent.click(copyButtons[0]);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('KANI-ABCD-1234');
  });
});

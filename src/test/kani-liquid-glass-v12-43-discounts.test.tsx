import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BenefitCodesAdminSection } from '@/components/kani/admin-benefit-codes-section';
import { V2MembershipsAndDiscounts } from '@/components/kani/v2/memberships-discounts';
import type { BenefitCodeItem } from '@/lib/kani-benefit-codes';

const {
  mockListFn,
  mockUseV2,
  mockUseAdminStaff,
} = vi.hoisted(() => ({
  mockListFn: vi.fn(),
  mockUseV2: vi.fn(),
  mockUseAdminStaff: vi.fn(),
}));

vi.mock('@/lib/kani-benefit-codes.functions', () => ({
  adminListBenefitCodesFn: mockListFn,
  adminCreateBenefitCodeFn: vi.fn(),
  adminToggleBenefitCodeStatusFn: vi.fn(),
  adminUpdateBenefitCodeValidityFn: vi.fn(),
  adminDeleteBenefitCodeFn: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok-v12-43' } } }),
    },
  },
}));

vi.mock('@/components/kani/v2/data', () => ({
  useV2: () => mockUseV2(),
}));

vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => mockUseAdminStaff(),
}));

const sampleCodes: BenefitCodeItem[] = [
  {
    id: 'disc-active',
    code: 'KANI-10-ACTIVE',
    type: 'PERCENT_10',
    usageMode: 'REUSABLE',
    status: 'ACTIVE',
    validityType: 'DATE_RANGE',
    validFrom: '2026-04-01T00:00:00-03:00',
    validUntil: '2099-12-31T23:59:59-03:00',
    validityDurationValue: null,
    validityDurationUnit: null,
    internalNote: 'Campaña clientes VIP',
    createdAt: '2026-04-01T10:00:00-03:00',
    createdBy: 'staff-1',
    createdByDisplayName: 'Kani Admin',
    lastEditedAt: '2026-04-02T12:00:00-03:00',
    lastEditedBy: 'staff-2',
    lastEditedByDisplayName: 'Tomás',
    timesUsed: 1,
    usages: [
      {
        id: 'use-1',
        benefitCodeId: 'disc-active',
        appointmentId: 'app-1',
        requestNumber: '1201',
        usedAt: '2026-04-05T14:00:00-03:00',
        serviceName: 'Corte',
        clientName: 'Marcos Gómez',
        clientEmail: 'marcos@example.com',
        clientPhone: '+5491155551111',
        originalPriceArs: 20000,
        discountAmountArs: 2000,
        finalPriceArs: 18000,
      },
    ],
  },
  {
    id: 'disc-disabled',
    code: 'KANI-FREE-PAUSED',
    type: 'FREE_SERVICE',
    usageMode: 'SINGLE_USE',
    status: 'DISABLED',
    validityType: 'NO_EXPIRATION',
    validFrom: '2026-03-20T10:00:00-03:00',
    validUntil: null,
    validityDurationValue: null,
    validityDurationUnit: null,
    lastEditedAt: '2026-03-25T16:30:00-03:00',
    lastEditedByDisplayName: 'Lucas',
    createdAt: '2026-03-20T10:00:00-03:00',
    createdByDisplayName: 'Lucas',
    timesUsed: 0,
    usages: [],
  },
  {
    id: 'disc-expired',
    code: 'KANI-50-OLD',
    type: 'PERCENT_50',
    usageMode: 'REUSABLE',
    status: 'EXPIRED',
    validityType: 'DATE_RANGE',
    validFrom: '2025-01-01T00:00:00-03:00',
    validUntil: '2025-01-15T23:59:59-03:00',
    validityDurationValue: null,
    validityDurationUnit: null,
    createdAt: '2025-01-01T09:00:00-03:00',
    timesUsed: 2,
    usages: [],
  },
  {
    id: 'disc-deleted',
    code: 'KANI-DEL-99',
    type: 'NO_DEPOSIT',
    usageMode: 'SINGLE_USE',
    status: 'DELETED',
    validityType: 'NO_EXPIRATION',
    validFrom: '2026-02-01T09:00:00-03:00',
    validUntil: null,
    validityDurationValue: null,
    validityDurationUnit: null,
    deletedAt: '2026-02-10T18:00:00-03:00',
    deletedByDisplayName: 'Admin Root',
    createdAt: '2026-02-01T09:00:00-03:00',
    timesUsed: 0,
    usages: [],
  },
];

describe('V12.43 — Rediseño de Descuentos Liquid Glass y navegación compacta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListFn.mockResolvedValue(sampleCodes);
    mockUseV2.mockReturnValue({
      loading: false,
      error: '',
      refresh: vi.fn().mockResolvedValue(undefined),
      refreshMemberships: vi.fn().mockResolvedValue(undefined),
      appointments: [],
      payments: [],
      starts: [],
      services: [
        { id: 'srv-corte', name: 'Corte', durationMin: 40, priceArs: 25000 },
        { id: 'srv-barba', name: 'Barba', durationMin: 30, priceArs: 19000 },
      ],
      clients: [
        { id: 'client-1', name: 'Sofía Tester', phone: '1155550000', email: 'sofia@example.com' },
      ],
      membershipsError: '',
      depositSupported: true,
      memberships: [
        {
          id: 'mem-1',
          clientId: 'client-1',
          clientName: 'Sofía Tester',
          clientPhone: '1155550000',
          clientEmail: 'sofia@example.com',
          barberId: 'lautaro',
          barberName: 'Lautaro',
          packageSize: 4,
          planName: 'Membresía 4 servicios',
          status: 'ACTIVE',
          subtotalArs: 100000,
          discountPercent: 20,
          discountAmountArs: 20000,
          totalPriceArs: 80000,
          totalSessions: 4,
          consumedSessions: 1,
          remainingSessions: 3,
          expiresAt: '2026-12-31',
          expiresUpdatedBy: null,
          expiresUpdatedAt: null,
          notes: '',
          paidAt: '2026-04-01T10:00:00Z',
          paymentMethod: 'Transferencia',
          paymentId: 'pay-1',
          createdByUserId: 'staff-1',
          createdByDisplayName: 'Tomás',
          createdAt: '2026-04-01T10:00:00Z',
          updatedAt: '2026-04-01T10:00:00Z',
          publicToken: 'tok-mem-1',
          publicTokenCreatedAt: '2026-04-01T10:00:00Z',
          publicTokenRevokedAt: null,
          items: [
            {
              id: 'item-corte',
              membershipId: 'mem-1',
              serviceId: 'srv-corte',
              serviceName: 'Corte',
              unitPriceSnapshotArs: 25000,
              totalQuantity: 4,
              consumedQuantity: 1,
              remainingQuantity: 3,
            },
          ],
          consumptions: [],
          events: [],
        },
      ],
    });
    mockUseAdminStaff.mockReturnValue({
      user: {
        id: 'staff-1',
        email: 'admin@kanibarber.com',
      },
      profile: {
        id: 'staff-1',
        name: 'Admin Test',
        display_name: 'Admin Test',
        email: 'admin@kanibarber.com',
        role: 'ADMIN',
        barber_id: null,
        active: true,
      },
      barbers: [
        { id: 'lautaro', name: 'Lautaro', active: true },
        { id: 'franco', name: 'Franco', active: true },
      ],
      staff: {
        user: { id: 'staff-1', email: 'admin@kanibarber.com' },
        profile: {
          id: 'staff-1',
          name: 'Admin Test',
          display_name: 'Admin Test',
          email: 'admin@kanibarber.com',
          role: 'ADMIN',
          barber_id: null,
          active: true,
        },
      },
      refreshCount: 0,
      triggerRefresh: vi.fn(),
      isRefreshing: false,
      setIsRefreshing: vi.fn(),
    });
  });

  it('1. /admin-liquid/descuentos (standalone DESCUENTOS) elimina por completo los encabezados y descripciones redundantes', async () => {
    render(<V2MembershipsAndDiscounts initialTab="DESCUENTOS" standaloneTab="DESCUENTOS" />);

    await waitFor(() => {
      expect(screen.getByText('KANI-10-ACTIVE')).toBeInTheDocument();
    });

    expect(screen.queryByRole('heading', { name: /^Descuentos$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Administración de códigos promocionales y beneficios\./i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Descuentos y Beneficios/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        /Gestión integral de códigos de beneficio para reservas: un solo uso y reutilizables, vigencias configurables y auditoría\./i,
      ),
    ).not.toBeInTheDocument();

    // Conserva filtros, acciones principales y listado
    expect(screen.getByLabelText('Estado')).toBeInTheDocument();
    expect(screen.getByLabelText('Ordenar por')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generar código/i })).toBeInTheDocument();
  });

  it('2. La ruta tradicional/Mantenimiento (hideHeading=false por defecto) conserva su encabezado habitual', async () => {
    render(<BenefitCodesAdminSection />);

    await waitFor(() => {
      expect(screen.getByText('KANI-10-ACTIVE')).toBeInTheDocument();
    });

    expect(screen.getByText('Descuentos y Beneficios')).toBeInTheDocument();
    expect(
      screen.getByText(
        /Gestión integral de códigos de beneficio para reservas: un solo uso y reutilizables, vigencias configurables y auditoría\./i,
      ),
    ).toBeInTheDocument();
  });

  it('3. Cada tarjeta muestra jerarquía simplificada, un solo badge de estado, botón Copiar compacto y Detalles expandible sin datos inventados', async () => {
    render(<V2MembershipsAndDiscounts initialTab="DESCUENTOS" standaloneTab="DESCUENTOS" />);

    await waitFor(() => {
      expect(screen.getByTestId('discount-card-disc-active')).toBeInTheDocument();
    });

    const activeCard = screen.getByTestId('discount-card-disc-active');
    expect(activeCard).toHaveAttribute('data-status', 'ACTIVE');
    expect(within(activeCard).getByText('KANI-10-ACTIVE')).toBeInTheDocument();
    expect(within(activeCard).getByText('10% de descuento')).toBeInTheDocument();
    expect(within(activeCard).getByText('Activo')).toBeInTheDocument();
    expect(within(activeCard).getByText('1 uso')).toBeInTheDocument();
    expect(within(activeCard).getByRole('button', { name: 'Copiar código KANI-10-ACTIVE' })).toBeEnabled();
    expect(within(activeCard).getByRole('button', { name: /Editar/i })).toBeInTheDocument();
    expect(within(activeCard).getByRole('button', { name: /Desactivar/i })).toBeInTheDocument();
    expect(within(activeCard).getByRole('button', { name: /Eliminar código KANI-10-ACTIVE/i })).toBeInTheDocument();

    // Sin repetición de etiquetas corta/larga del mismo beneficio
    expect(within(activeCard).queryByText('10% OFF')).not.toBeInTheDocument();
    // Los datos internos no se muestran antes de abrir Detalles
    expect(within(activeCard).queryByText('Campaña clientes VIP')).not.toBeInTheDocument();
    expect(within(activeCard).queryByText('Marcos Gómez')).not.toBeInTheDocument();

    // Abrir Detalles en tarjeta activa
    fireEvent.click(within(activeCard).getByRole('button', { name: /Detalles/i }));
    expect(within(activeCard).getByText('Activo y disponible para reservas')).toBeInTheDocument();
    expect(within(activeCard).getByText(/Reutilizable · Bonificación del 10%/i)).toBeInTheDocument();
    expect(within(activeCard).getByText('Kani Admin')).toBeInTheDocument();
    expect(within(activeCard).getByText('Tomás')).toBeInTheDocument();
    expect(within(activeCard).getByText('Campaña clientes VIP')).toBeInTheDocument();
    expect(within(activeCard).getByText(/Marcos Gómez/i)).toBeInTheDocument();
    expect(within(activeCard).getByText(/Turno #1201/i)).toBeInTheDocument();
    // No inventa motivo de modificación cuando no existe
    expect(within(activeCard).queryByText(/Motivo de modificación/i)).not.toBeInTheDocument();

    // Tarjeta Inactiva
    const disabledCard = screen.getByTestId('discount-card-disc-disabled');
    expect(disabledCard).toHaveAttribute('data-status', 'DISABLED');
    expect(within(disabledCard).getByText('Servicio gratuito')).toBeInTheDocument();
    expect(within(disabledCard).getByText('Inactivo')).toBeInTheDocument();
    expect(within(disabledCard).getByRole('button', { name: /Activar/i })).toBeInTheDocument();
    fireEvent.click(within(disabledCard).getByRole('button', { name: /Detalles/i }));
    expect(within(disabledCard).getByText(/Desactivado manualmente por Lucas el/i)).toBeInTheDocument();

    // Tarjeta Vencida
    const expiredCard = screen.getByTestId('discount-card-disc-expired');
    expect(expiredCard).toHaveAttribute('data-status', 'EXPIRED');
    expect(within(expiredCard).getByText('50% de descuento')).toBeInTheDocument();
    expect(within(expiredCard).getByText('Vencido')).toBeInTheDocument();
    expect(within(expiredCard).getByRole('button', { name: /Editar/i })).toBeInTheDocument();
    expect(within(expiredCard).queryByRole('button', { name: /Desactivar/i })).not.toBeInTheDocument();

    // Tarjeta Eliminada: conservada para auditoría, copia deshabilitada y sin editar/activar/eliminar
    const deletedCard = screen.getByTestId('discount-card-disc-deleted');
    expect(deletedCard).toHaveAttribute('data-status', 'DELETED');
    expect(within(deletedCard).getByText('Reserva sin seña')).toBeInTheDocument();
    expect(within(deletedCard).getByText('Eliminado')).toBeInTheDocument();
    expect(within(deletedCard).getByRole('button', { name: 'Copiar código KANI-DEL-99' })).toBeDisabled();
    expect(within(deletedCard).queryByRole('button', { name: /Editar/i })).not.toBeInTheDocument();
    expect(within(deletedCard).queryByRole('button', { name: /Activar/i })).not.toBeInTheDocument();
    expect(within(deletedCard).queryByRole('button', { name: /Eliminar/i })).not.toBeInTheDocument();
    fireEvent.click(within(deletedCard).getByRole('button', { name: /Detalles/i }));
    expect(within(deletedCard).getByText(/Eliminado por Admin Root el/i)).toBeInTheDocument();
  });

  it('4. Membresías sigue intacta en standaloneTab=MEMBRESIAS', () => {
    render(<V2MembershipsAndDiscounts initialTab="MEMBRESIAS" standaloneTab="MEMBRESIAS" />);
    expect(screen.getByRole('heading', { name: /^Membresías$/i })).toBeInTheDocument();
    expect(screen.getByText('Membresía 4 servicios')).toBeInTheDocument();
    expect(screen.getByText('Sofía Tester')).toBeInTheDocument();
  });

  it('5. CSS de Liquid Glass Admin protege navegación mobile en una sola línea y aplica cristal a .kani-dcard sin usar :first-child roto', () => {
    const cssPath = path.resolve(process.cwd(), 'src/components/kani/experimental/liquid-glass-admin.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toContain('.lg-memberships-nav .lg-admin-nav-label--mobile');
    expect(css).toContain('.lg-admin-nav-label--desktop');
    expect(css).toContain('.v2-memberships-page > .v2-panel > .v2-discounts-stage');
    expect(css).toContain('.v2-memberships-page .kani-dcard');
    expect(css).toContain('--dc-bg: var(--lga-glass-interactive)');
    expect(css).toContain('.v2-memberships-page .kani-dcard[data-status="DELETED"]');
  });
});

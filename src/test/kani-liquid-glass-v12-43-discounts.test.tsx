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
    expect(within(activeCard).getByRole('switch', { name: 'Desactivar código' })).toHaveAttribute('aria-checked', 'true');
    expect(within(activeCard).getByRole('button', { name: /Eliminar código KANI-10-ACTIVE/i })).toBeInTheDocument();

    // Feedback accesible al copiar código
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    fireEvent.click(within(activeCard).getByRole('button', { name: 'Copiar código KANI-10-ACTIVE' }));
    await waitFor(() => {
      expect(screen.getByText('Código copiado correctamente')).toBeInTheDocument();
    });

    // Sin repetición de etiquetas corta/larga del mismo beneficio
    expect(within(activeCard).queryByText('10% OFF')).not.toBeInTheDocument();
    // Los datos internos no se muestran antes de abrir Detalles
    expect(within(activeCard).queryByText('Campaña clientes VIP')).not.toBeInTheDocument();
    expect(within(activeCard).queryByText('Marcos Gómez')).not.toBeInTheDocument();

    // Abrir Secciones en tarjeta activa: las 3 categorías comienzan contraídas y son mutuamente excluyentes
    fireEvent.click(within(activeCard).getByRole('button', { name: /^Info$/i }));
    const condBtn = within(activeCard).getByRole('button', { name: /^Condiciones$/i });
    const adminBtn = within(activeCard).getByRole('button', { name: /^Información administrativa$/i });
    const historyBtn = within(activeCard).getByRole('button', { name: /^Historial de usos \(1\)$/i });

    expect(condBtn).toHaveAttribute('aria-expanded', 'false');
    expect(adminBtn).toHaveAttribute('aria-expanded', 'false');
    expect(historyBtn).toHaveAttribute('aria-expanded', 'false');
    expect(within(activeCard).queryByText('Campaña clientes VIP')).not.toBeInTheDocument();

    fireEvent.click(condBtn);
    expect(condBtn).toHaveAttribute('aria-expanded', 'true');
    expect(within(activeCard).getAllByText('Activo').length).toBeGreaterThanOrEqual(2);
    expect(within(activeCard).getByText(/Reutilizable · Bonificación del 10%/i)).toBeInTheDocument();
    expect(within(activeCard).getByText('Campaña clientes VIP')).toBeInTheDocument();

    fireEvent.click(adminBtn);
    expect(condBtn).toHaveAttribute('aria-expanded', 'false');
    expect(adminBtn).toHaveAttribute('aria-expanded', 'true');
    expect(within(activeCard).getByText('Kani Admin')).toBeInTheDocument();
    expect(within(activeCard).getByText('Tomás')).toBeInTheDocument();

    fireEvent.click(historyBtn);
    expect(adminBtn).toHaveAttribute('aria-expanded', 'false');
    expect(historyBtn).toHaveAttribute('aria-expanded', 'true');
    expect(within(activeCard).getByText(/Marcos Gómez/i)).toBeInTheDocument();
    expect(within(activeCard).getByText(/Turno #1201/i)).toBeInTheDocument();
    // No inventa motivo de modificación cuando no existe
    expect(within(activeCard).queryByText(/Motivo de modificación/i)).not.toBeInTheDocument();

    // Tarjeta Inactiva
    const disabledCard = screen.getByTestId('discount-card-disc-disabled');
    expect(disabledCard).toHaveAttribute('data-status', 'DISABLED');
    expect(within(disabledCard).getByText('Servicio gratuito')).toBeInTheDocument();
    expect(within(disabledCard).getByText('Inactivo')).toBeInTheDocument();
    expect(within(disabledCard).getByRole('switch', { name: 'Activar código' })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(within(disabledCard).getByRole('button', { name: /^Info$/i }));
    fireEvent.click(within(disabledCard).getByRole('button', { name: /^Información administrativa$/i }));
    expect(within(disabledCard).getByText(/Desactivado manualmente por Lucas el/i)).toBeInTheDocument();

    // Tarjeta Vencida
    const expiredCard = screen.getByTestId('discount-card-disc-expired');
    expect(expiredCard).toHaveAttribute('data-status', 'EXPIRED');
    expect(within(expiredCard).getByText('50% de descuento')).toBeInTheDocument();
    expect(within(expiredCard).getByText('Vencido')).toBeInTheDocument();
    expect(within(expiredCard).getByRole('button', { name: /Editar/i })).toBeInTheDocument();
    expect(within(expiredCard).queryByRole('switch')).not.toBeInTheDocument();

    // Tarjeta Eliminada: conservada para auditoría, copia deshabilitada y sin editar/activar/eliminar
    const deletedCard = screen.getByTestId('discount-card-disc-deleted');
    expect(deletedCard).toHaveAttribute('data-status', 'DELETED');
    expect(within(deletedCard).getByText('Reserva sin seña')).toBeInTheDocument();
    expect(within(deletedCard).getByText('Eliminado')).toBeInTheDocument();
    expect(within(deletedCard).getByRole('button', { name: 'Copiar código KANI-DEL-99' })).toBeDisabled();
    expect(within(deletedCard).queryByRole('button', { name: /Editar/i })).not.toBeInTheDocument();
    expect(within(deletedCard).queryByRole('switch')).not.toBeInTheDocument();
    expect(within(deletedCard).queryByRole('button', { name: /Eliminar/i })).not.toBeInTheDocument();
    fireEvent.click(within(deletedCard).getByRole('button', { name: /^Info$/i }));
    fireEvent.click(within(deletedCard).getByRole('button', { name: /^Información administrativa$/i }));
    expect(within(deletedCard).getByText(/Eliminado por Admin Root el/i)).toBeInTheDocument();
  });

  it('4. Membresías en standaloneTab=MEMBRESIAS elimina encabezado/descripción redundantes y conserva KPIs y tarjetas', () => {
    const { container } = render(
      <V2MembershipsAndDiscounts initialTab="MEMBRESIAS" standaloneTab="MEMBRESIAS" />,
    );
    expect(screen.queryByRole('heading', { name: /^Membresías$/i })).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Gestión integral de paquetes prepagados de 4 y 10 servicios, sesiones y tarjetas\./i),
    ).not.toBeInTheDocument();
    expect(container.querySelector('.v2-memberships-header')).toBeNull();
    const stage = container.querySelector<HTMLElement>('.v2-memberships-stage');
    expect(stage).not.toBeNull();
    expect(stage?.style.marginTop).toBe('0px');
    expect(screen.getByText('Membresías activas')).toBeInTheDocument();
    expect(screen.getByText('Membresía 4 servicios · Lautaro')).toBeInTheDocument();
    expect(screen.getByText('Sofía Tester')).toBeInTheDocument();

    // Modal "Nueva membresía" elimina descripción informativa conservando controles y precios congelados
    fireEvent.click(screen.getByRole('button', { name: /Nueva membresía/i }));
    const createDialog = screen.getByRole('dialog');
    expect(createDialog).toBeInTheDocument();
    expect(within(createDialog).getByRole('heading', { name: 'Nueva membresía' })).toBeInTheDocument();
    expect(
      within(createDialog).queryByText(
        /Configurá la combinación de servicios\. Los precios actuales quedan congelados en la membresía al crearse\./i,
      ),
    ).toBeNull();
    expect(within(createDialog).getByText('Tipo de membresía')).toBeInTheDocument();
  });

  it('5. CSS de Liquid Glass Admin protege navegación mobile en una sola línea y aplica cristal a .kani-dcard sin usar :first-child roto', () => {
    const cssPath = path.resolve(process.cwd(), 'src/components/kani/experimental/liquid-glass-admin.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toContain('.lg-memberships-nav .lg-admin-nav-label--mobile');
    expect(css).toContain('.lg-admin-nav-label--desktop');
    expect(css).toContain('.v2-memberships-page > .v2-panel > .v2-discounts-stage');
    expect(css).toContain('.v2-memberships-page > .v2-panel > .v2-memberships-stage');
    expect(css).toContain('.v2-memberships-page .kani-dcard');
    expect(css).toContain('--dc-bg: var(--lga-glass-interactive)');
    expect(css).toContain('.v2-memberships-page .kani-dcard[data-status="DELETED"]');
  });

  it('6. V12.43.1 / V12.43.2 — Reorganiza tarjetas mobile de Descuentos en 4 filas estrictas (Código | Copiar y Eliminar dentro de Detalles) sin tocar desktop', () => {
    const cssPath = path.resolve(process.cwd(), 'src/components/kani/experimental/liquid-glass-admin.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    const baseCss = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/kani/v2/discount-card.css'),
      'utf8',
    );

    // En desktop / ruta tradicional, el bloque destructivo dentro de Detalles permanece oculto
    expect(baseCss).toMatch(/\.kani-dcard-details-danger\s*\{\s*display:\s*none;\s*\}/);

    const layer14Idx = css.indexOf('LAYER 14 · V12.43.1');
    expect(layer14Idx).toBeGreaterThan(-1);
    const layer14 = css.slice(layer14Idx);

    // Fix del footer en /admin-liquid (sin padding-bottom residual ni altura artificial)
    expect(layer14).toContain('body[data-lg-admin="true"] .site-shell:has(.v2-shell)');
    expect(layer14).toContain('padding-bottom: 0 !important;');
    expect(layer14).toContain('data-lg-section="admin"');
    expect(layer14).toContain('min-height: 0 !important;');
    expect(layer14).toContain('position: static !important;');
    expect(layer14).toContain('margin-top: auto !important;');

    // Toda la reorganización de tarjetas debe vivir estrictamente dentro de @media (max-width: 767px)
    const mobileIdx = layer14.indexOf('@media (max-width: 767px)');
    expect(mobileIdx).toBeGreaterThan(-1);
    const mobileBlock = layer14.slice(mobileIdx);

    // Orden v2.8 de las filas mobile:
    // Fila 1: código + copiar 44x44 (order: 1)
    // Fila 2: Tipo de código | Vencimiento (order: 2)
    // Fila 3: Estado | Usos (order: 3)
    // Fila 4: Info (6) | Editar | Switch (7)
    expect(mobileBlock).toContain('.kani-dcard-code-group');
    expect(mobileBlock).toContain('order: 1 !important;');
    expect(mobileBlock).toContain('.kani-dcard-secondary-grid');
    expect(mobileBlock).toContain('order: 2 !important;');
    expect(mobileBlock).toContain('.kani-dcard-meta');
    expect(mobileBlock).toContain('order: 3 !important;');
    expect(mobileBlock).toContain('flex: 0 0 100% !important;');
    expect(mobileBlock).toContain('.kani-dcard-actions > .kani-dcard-btn-delete');
    expect(mobileBlock).toContain('display: none !important;');
    expect(mobileBlock).toContain('.kani-dcard-btn-details');
    expect(mobileBlock).toContain('order: 6 !important;');
    expect(mobileBlock).toContain('.kani-dcard-btn-action');
    expect(mobileBlock).toContain('order: 7 !important;');

    // Eliminar reubicado al final de Detalles en mobile
    expect(mobileBlock).toContain('.kani-dcard-details-danger');
    expect(mobileBlock).toContain('.kani-dcard-details-delete-btn.is-destructive');

    // Tres botones inferiores alineados con altura consistente (44px)
    expect(mobileBlock).toContain('flex: 1 1 calc((100% - 14px) / 3) !important;');
    expect(mobileBlock).toContain('height: 44px !important;');
  });

  it('7. V12.43.2 — Detalles muestra la acción destructiva "Eliminar código" al final salvo en DELETED y abre el modal de confirmación existente', async () => {
    render(<V2MembershipsAndDiscounts initialTab="DESCUENTOS" standaloneTab="DESCUENTOS" />);

    await waitFor(() => {
      expect(screen.getByTestId('discount-card-disc-active')).toBeInTheDocument();
    });

    const activeCard = screen.getByTestId('discount-card-disc-active');
    fireEvent.click(within(activeCard).getByRole('button', { name: /^Info$/i }));
    const activeDetails = screen.getByTestId('discount-details-disc-active');
    const dangerBtn = within(activeDetails).getByRole('button', { name: /Eliminar código/i });
    expect(dangerBtn).toBeInTheDocument();
    expect(dangerBtn.className).toContain('is-destructive');

    // El último hijo de Detalles es el contenedor separador de acción destructiva
    expect(activeDetails.lastElementChild?.className).toContain('kani-dcard-details-danger');

    // Códigos ya eliminados no muestran botón Eliminar dentro de Detalles
    const deletedCard = screen.getByTestId('discount-card-disc-deleted');
    fireEvent.click(within(deletedCard).getByRole('button', { name: /^Info$/i }));
    const deletedDetails = screen.getByTestId('discount-details-disc-deleted');
    expect(within(deletedDetails).queryByRole('button', { name: /Eliminar/i })).not.toBeInTheDocument();

    // Al hacer clic en "Eliminar código" de una tarjeta activa, abre el modal de confirmación existente
    fireEvent.click(dangerBtn);
    expect(await screen.findByText('¿Eliminar código KANI-10-ACTIVE?')).toBeInTheDocument();
  });

  it('8. v2.1 — Modal "Editar vigencia" sigue el mockup aprobado (título limpio, código solo lectura, select sin autofocus, Cancelar | Guardar)', async () => {
    render(<V2MembershipsAndDiscounts initialTab="DESCUENTOS" standaloneTab="DESCUENTOS" />);

    await waitFor(() => {
      expect(screen.getByTestId('discount-card-disc-active')).toBeInTheDocument();
    });

    const activeCard = screen.getByTestId('discount-card-disc-active');
    fireEvent.click(within(activeCard).getByRole('button', { name: /Editar/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Editar vigencia' })).toBeInTheDocument();
    expect(within(dialog).getByText('Código de descuento')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Código de descuento')).toHaveTextContent('KANI-10-ACTIVE');
    const validitySelect = within(dialog).getByLabelText('Vigencia') as HTMLSelectElement;
    expect(document.activeElement).not.toBe(validitySelect);
    expect(within(dialog).getByText('Los cambios no afectan las reservas confirmadas.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
  });
});

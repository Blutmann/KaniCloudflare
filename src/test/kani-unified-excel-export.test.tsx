// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ExcelJS from 'exceljs';
import { formatExcelGeneratedTimestamp } from '@/lib/kani-excel';
import { generateBenefitCodesWorkbookBuffer } from '@/lib/kani-benefit-codes-xlsx';
import {
  buildMembershipsExportFilename,
  generateMembershipsWorkbookBuffer,
  mapMembershipsToExportRows,
} from '@/lib/kani-memberships-xlsx';
import {
  buildPaymentsExportFilename,
  generatePaymentsWorkbookBuffer,
} from '@/lib/kani-payments-xlsx';
import { ExcelExportButton } from '@/components/kani/v2/excel-export-button';
import type { BenefitCodeItem } from '@/lib/kani-benefit-codes';
import type { ClientMembershipRecord } from '@/lib/kani-recurrences-memberships';

const { mockStaffState, mockV2State, mockDownloadMemberships, mockDownloadPayments } = vi.hoisted(() => ({
  mockStaffState: {
    role: 'ADMIN' as 'ADMIN' | 'MANAGER' | 'BARBER',
    barber_id: 'lautaro' as string | null,
  },
  mockV2State: {
    memberships: [] as ClientMembershipRecord[],
    payments: [] as any[],
  },
  mockDownloadMemberships: vi.fn().mockResolvedValue('kani-membresias-2026-11-27.xlsx'),
  mockDownloadPayments: vi.fn().mockResolvedValue('kani-cobros-registrados-2026-11-27.xlsx'),
}));

vi.mock('@tanstack/react-router', () => ({
  useLocation: (opts?: { select?: (loc: { pathname: string }) => unknown }) => {
    const loc = { pathname: '/panel-administracion/pagos' };
    return opts?.select ? opts.select(loc) : loc;
  },
  useSearch: () => ({}),
}));

vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => ({
    profile: {
      user_id: 'u-1',
      role: mockStaffState.role,
      barber_id: mockStaffState.barber_id,
      display_name: 'Lautaro',
      active: true,
    },
    barbers: [
      { id: 'lautaro', name: 'Lautaro' },
      { id: 'gonzalo', name: 'Gonzalo' },
    ],
  }),
}));

vi.mock('@/components/kani/v2/data', () => ({
  useV2: () => ({
    loading: false,
    error: '',
    refresh: vi.fn(),
    refreshMemberships: vi.fn(),
    barber: 'ALL',
    setBarber: vi.fn(),
    appointments: [],
    services: [{ id: 's-1', name: 'Corte', price_ars: 25000 }],
    clients: [{ id: 'c-1', name: 'Juan Pérez', phone: '+5491112345678', email: 'juan@kani.ar' }],
    memberships: mockV2State.memberships,
    membershipsError: '',
    payments: mockV2State.payments,
  }),
}));

vi.mock('@/lib/kani-memberships-xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kani-memberships-xlsx')>();
  return {
    ...actual,
    downloadMembershipsXlsx: (...args: unknown[]) => mockDownloadMemberships(...args),
  };
});

vi.mock('@/lib/kani-payments-xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kani-payments-xlsx')>();
  return {
    ...actual,
    downloadPaymentsXlsx: (...args: unknown[]) => mockDownloadPayments(...args),
  };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
  },
}));

import { V2MembershipsAndDiscounts } from '@/components/kani/v2/memberships-discounts';
import { V2Payments } from '@/components/kani/v2/payments';
import { businessDateToday } from '@/lib/kani-mobile-appointments';

describe('Kani — Exportación a Excel Unificada y Leyenda de Fecha/Horario AR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStaffState.role = 'ADMIN';
    mockStaffState.barber_id = 'lautaro';
    mockV2State.memberships = [];
    mockV2State.payments = [];
  });

  afterEach(() => {
    cleanup();
  });

  it('formatea exactamente "Generado el DD/MM/YYYY a las HH:mm hs" en zona horaria America/Argentina/Buenos_Aires', () => {
    // 2026-11-27 19:08 UTC = 2026-11-27 16:08 ART (UTC-3)
    expect(formatExcelGeneratedTimestamp(new Date('2026-11-27T19:08:00Z'))).toBe(
      'Generado el 27/11/2026 a las 16:08 hs',
    );
    // 2026-11-28 03:05 UTC = 2026-11-28 00:05 ART (medianoche sin "24:05")
    expect(formatExcelGeneratedTimestamp(new Date('2026-11-28T03:05:00Z'))).toBe(
      'Generado el 28/11/2026 a las 00:05 hs',
    );
  });

  it('incluye Fila 1 título, Fila 2 leyenda AR, Fila 3 filtros, Fila 4 vacía y Fila 5 encabezados en Códigos, Miembros y Cobros', async () => {
    const fixedDate = new Date('2026-11-27T19:08:00Z');

    // 1. Códigos de descuento
    const codes: BenefitCodeItem[] = [
      {
        id: 'b-1',
        code: 'KANI-10USOS',
        type: 'PERCENT_10',
        usageMode: 'LIMITED_USE',
        validityType: 'NO_EXPIRATION',
        validFrom: '2026-11-01T10:00:00Z',
        timesUsed: 3,
        maxUses: 10,
        status: 'ACTIVE',
        createdAt: '2026-11-01T10:00:00Z',
        updatedAt: '2026-11-01T10:00:00Z',
      },
    ];
    const codesBuf = await generateBenefitCodesWorkbookBuffer(codes, {
      filterSummary: 'Estado: Todos · 1 registro',
      generatedAt: fixedDate,
    });
    const wbCodes = new ExcelJS.Workbook();
    await wbCodes.xlsx.load(codesBuf.buffer as ArrayBuffer);
    const shCodes = wbCodes.getWorksheet('Códigos de descuento')!;
    expect(shCodes.getRow(1).getCell(1).value).toBe('Kani Barber Studio — Códigos de descuento');
    expect(shCodes.getRow(2).getCell(1).value).toBe('Generado el 27/11/2026 a las 16:08 hs');
    expect(shCodes.getRow(3).getCell(1).value).toBe('Estado: Todos · 1 registro');
    expect(shCodes.getRow(5).getCell(1).value).toBe('Código');
    expect(shCodes.getRow(6).getCell(1).value).toBe('KANI-10USOS');
    expect(shCodes.getRow(6).getCell(4).value).toBe('3/10');

    // 2. Miembros
    const membershipRows = mapMembershipsToExportRows(
      [
        {
          id: 'm-1',
          clientId: 'c-1',
          clientName: 'Juan Pérez',
          barberId: 'lautaro',
          planName: 'Black Card 4 Cortes',
          status: 'ACTIVE',
          totalSessions: 4,
          usedSessions: 1,
          remainingSessions: 3,
          expiresAt: '2026-12-31',
          createdAt: '2026-11-10T15:00:00Z',
        } as ClientMembershipRecord,
      ],
      (m) => m.clientName || 'Sin cliente',
      () => 'Lautaro',
    );
    expect(buildMembershipsExportFilename('2026-11-27')).toBe('kani-membresias-2026-11-27.xlsx');
    const memBuf = await generateMembershipsWorkbookBuffer(membershipRows, {
      filterSummary: 'Estado: Activas · Barbero: Todo Kani · 1 registro',
      generatedAt: fixedDate,
    });
    const wbMem = new ExcelJS.Workbook();
    await wbMem.xlsx.load(memBuf.buffer as ArrayBuffer);
    const shMem = wbMem.getWorksheet('Membresías')!;
    expect(shMem.getRow(1).getCell(1).value).toBe('Kani Barber Studio — Membresías');
    expect(shMem.getRow(2).getCell(1).value).toBe('Generado el 27/11/2026 a las 16:08 hs');
    expect(shMem.getRow(5).getCell(1).value).toBe('Cliente');
    expect(shMem.getRow(6).getCell(1).value).toBe('Juan Pérez');
    expect(shMem.getRow(6).getCell(5).value).toBe('1/4');

    // 3. Cobros registrados
    expect(buildPaymentsExportFilename('2026-11-27')).toBe('kani-cobros-registrados-2026-11-27.xlsx');
    const payBuf = await generatePaymentsWorkbookBuffer(
      [
        {
          fecha: '2026-11-27',
          hora: '15:30 hs',
          servicio: 'Corte',
          barbero: 'Lautaro',
          cliente: 'Juan Pérez',
          metodo: 'Efectivo',
          importeArs: 25000,
          tipo: 'Cobro en estudio',
        },
      ],
      {
        filterSummary: 'Período: Hoy · Barbero: Todo Kani · 1 registro',
        generatedAt: fixedDate,
      },
    );
    const wbPay = new ExcelJS.Workbook();
    await wbPay.xlsx.load(payBuf.buffer as ArrayBuffer);
    const shPay = wbPay.getWorksheet('Cobros registrados')!;
    expect(shPay.getRow(1).getCell(1).value).toBe('Kani Barber Studio — Cobros registrados');
    expect(shPay.getRow(2).getCell(1).value).toBe('Generado el 27/11/2026 a las 16:08 hs');
    expect(shPay.getRow(3).getCell(1).value).toBe('Período: Hoy · Barbero: Todo Kani · 1 registro');
    expect(shPay.getRow(5).getCell(1).value).toBe('Fecha');
    expect(shPay.getRow(6).getCell(7).value).toBe(25000);
  });

  it('ExcelExportButton es solo-ícono, respeta disabled y muestra spinner con aria-busy al exportar', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <ExcelExportButton onClick={onClick} exporting={false} disabled={true} label="Exportar a Excel" />,
    );
    const btn = screen.getByRole('button', { name: 'Exportar a Excel' });
    expect(btn.textContent?.trim()).toBe('');
    expect(btn).toBeDisabled();

    rerender(<ExcelExportButton onClick={onClick} exporting={true} disabled={false} label="Exportar a Excel" />);
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toBeDisabled();
  });

  it('Miembros muestra el botón Excel verde para ADMIN, MANAGER y BARBER y lo deshabilita con 0 membresías', () => {
    // 0 membresías -> deshabilitado
    render(<V2MembershipsAndDiscounts standaloneTab="MEMBRESIAS" />);
    const emptyBtn = screen.getByTestId('export-memberships-excel-btn');
    expect(emptyBtn).toBeDisabled();
    expect(emptyBtn.textContent?.trim()).toBe('');
    cleanup();

    // Con membresía -> habilitado para los 3 roles
    mockV2State.memberships = [
      {
        id: 'm-1',
        clientId: 'c-1',
        clientName: 'Juan Pérez',
        barberId: 'lautaro',
        planName: 'Black Card 4 Cortes',
        status: 'ACTIVE',
        totalSessions: 4,
        usedSessions: 1,
        remainingSessions: 3,
        items: [],
        expiresAt: '2026-12-31',
        createdAt: '2026-11-10T15:00:00Z',
      } as ClientMembershipRecord,
    ];

    for (const role of ['ADMIN', 'MANAGER', 'BARBER'] as const) {
      mockStaffState.role = role;
      mockDownloadMemberships.mockClear();
      const { unmount } = render(<V2MembershipsAndDiscounts standaloneTab="MEMBRESIAS" />);
      const btn = screen.getByTestId('export-memberships-excel-btn');
      expect(btn).not.toBeDisabled();
      fireEvent.click(btn);
      expect(mockDownloadMemberships).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it('Pagos → Cobros registrados muestra el botón Excel verde para ADMIN, MANAGER y BARBER y lo deshabilita con 0 servicios', () => {
    // 0 cobros -> deshabilitado
    render(<V2Payments />);
    const emptyBtn = screen.getByTestId('export-payments-excel-btn');
    expect(emptyBtn).toBeDisabled();
    expect(emptyBtn.textContent?.trim()).toBe('');
    cleanup();

    // Con cobro de hoy -> habilitado para los 3 roles (BARBER ve solo los suyos)
    const today = businessDateToday();
    mockV2State.payments = [
      {
        id: 'p-1',
        barberId: 'lautaro',
        barberName: 'Lautaro',
        serviceName: 'Corte',
        paymentMethod: 'Efectivo',
        collectedAmountArs: 25000,
        paymentDate: today,
        paymentTime: '14:00',
        clientName: 'Juan Pérez',
        isDepositMovement: false,
      },
    ];

    for (const role of ['ADMIN', 'MANAGER', 'BARBER'] as const) {
      mockStaffState.role = role;
      mockDownloadPayments.mockClear();
      const { unmount } = render(<V2Payments />);
      const btn = screen.getByTestId('export-payments-excel-btn');
      expect(btn).not.toBeDisabled();
      fireEvent.click(btn);
      expect(mockDownloadPayments).toHaveBeenCalledTimes(1);
      unmount();
    }
  });
});

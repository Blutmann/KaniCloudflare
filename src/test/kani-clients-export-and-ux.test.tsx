import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import ExcelJS from 'exceljs';

const {
  mockStaffRole,
  mockExportClientsFn,
  mockGetSession,
  mockRefresh,
} = vi.hoisted(() => ({
  mockStaffRole: { role: 'BARBER', barber_id: 'lautaro' as string | null },
  mockExportClientsFn: vi.fn(),
  mockGetSession: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => ({
    profile: {
      user_id: 'u-1',
      role: mockStaffRole.role,
      barber_id: mockStaffRole.barber_id,
      display_name: 'Lautaro',
      active: true,
    },
    barbers: [
      { id: 'lautaro', name: 'Lautaro' },
      { id: 'gonzalo', name: 'Gonzalo' },
    ],
  }),
}));

vi.mock('@/lib/kani-clients-export.functions', () => ({
  staffExportClientsFn: mockExportClientsFn,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
    },
    rpc: vi.fn().mockResolvedValue({ error: null }),
  },
}));

vi.mock('@/components/kani/v2/data', () => ({
  useV2: () => ({
    loading: false,
    error: '',
    refresh: mockRefresh,
    appointments: [],
    payments: [],
    clients: [
      {
        id: 'cli-1',
        name: 'Carlos Gardel',
        phone: '+5491122334455',
        email: 'carlos@kani.ar',
        created_at: '2026-01-15T10:00:00Z',
        updated_at: '2026-01-15T10:00:00Z',
      },
      {
        id: 'cli-2',
        name: 'Ana Pérez',
        phone: '01144556677',
        email: '',
        created_at: '2026-02-20T10:00:00Z',
        updated_at: '2026-02-20T10:00:00Z',
      },
    ],
  }),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-testid="mock-dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  KaniModalClose: ({ label = 'Cerrar' }: { label?: string }) => <button type="button" aria-label={label}>X</button>,
}));

import { V2Clients } from '@/components/kani/v2/clients';
import { buildClientExportRows } from '@/lib/kani-clients-export.server';
import {
  buildClientExportFilename,
  generateClientsWorkbookBuffer,
} from '@/lib/kani-clients-xlsx';

describe('KANI — Optimización de Clientes y Exportación Excel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStaffRole.role = 'BARBER';
    mockStaffRole.barber_id = 'lautaro';
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok-barber' } } });
    if (!URL.createObjectURL) {
      (URL as any).createObjectURL = vi.fn(() => 'blob:mock');
    } else {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    }
    if (!URL.revokeObjectURL) {
      (URL as any).revokeObjectURL = vi.fn();
    } else {
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    }
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Desktop 2-row top toolbar (Buscar + Nuevo cliente, Ordenar + Excel) and Mobile sticky button without outer capsule', () => {
    const { container } = render(<V2Clients />);

    const toolbar = container.querySelector('.v2-client-toolbar-container')!;
    expect(toolbar).toBeTruthy();

    const searchRow = toolbar.querySelector('.v2-client-search-row')!;
    const controlsRow = toolbar.querySelector('.v2-client-controls-row')!;
    expect(searchRow).toBeTruthy();
    expect(controlsRow).toBeTruthy();

    expect(screen.getByLabelText('Buscar cliente')).toBeTruthy();
    expect(screen.getByPlaceholderText('Nombre, celular o email')).toBeTruthy();
    const desktopAddBtn = searchRow.querySelector('.v2-client-add-btn--desktop');
    expect(desktopAddBtn).toBeTruthy();
    expect(desktopAddBtn?.textContent).toContain('Nuevo cliente');

    expect(screen.getByLabelText('Ordenar por')).toBeTruthy();
    const exportBtn = screen.getByRole('button', { name: 'Exportar clientes a Excel' });
    expect(controlsRow.contains(exportBtn)).toBe(true);
    expect(exportBtn.getAttribute('title')).toBe('Exportar clientes a Excel');

    const stickyBar = container.querySelector('.v2-client-sticky-bar');
    expect(stickyBar).toBeTruthy();
    const mobileAddBtn = stickyBar?.querySelector('.v2-client-add-btn--mobile');
    expect(mobileAddBtn).toBeTruthy();
    expect(mobileAddBtn?.textContent).toContain('Nuevo cliente');

    const addButtons = screen.getAllByRole('button', { name: /Nuevo cliente/i });
    expect(addButtons).toHaveLength(2);

    // Search filters list without affecting toolbar/sticky bar
    fireEvent.change(screen.getByPlaceholderText('Nombre, celular o email'), {
      target: { value: 'Carlos' },
    });
    expect(screen.getAllByText('Carlos Gardel').length).toBeGreaterThan(0);
    expect(screen.queryByText('Ana Pérez')).toBeNull();

    // Clicking Nuevo cliente opens creation dialog
    fireEvent.click(desktopAddBtn!);
    expect(screen.getByTestId('mock-dialog')).toBeTruthy();
  });

  it('enforces responsive Desktop/Mobile CSS (no sticky bar on Desktop, no outer capsule on Mobile, green Excel button in Dark & Light)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const lgAdminCss = fs.readFileSync(
      path.resolve(__dirname, '../components/kani/experimental/liquid-glass-admin.css'),
      'utf-8',
    );
    const v2Css = fs.readFileSync(
      path.resolve(__dirname, '../components/kani/v2/v2.css'),
      'utf-8',
    );

    // Desktop: 2 rows in toolbar + hidden bottom bar
    expect(lgAdminCss).toMatch(/\.v2-client-search-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+max-content/);
    expect(lgAdminCss).toMatch(/\.v2-client-controls-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+max-content/);
    expect(lgAdminCss).toMatch(/@media\s*\(min-width:\s*768px\)\s*\{[\s\S]*?\.v2-client-sticky-bar\s*\{\s*display:\s*none\s*!important/);
    expect(v2Css).toMatch(/@media\s*\(min-width:\s*768px\)\s*\{[\s\S]*?\.v2-client-sticky-bar\s*\{\s*display:\s*none\s*!important/);

    // Mobile: hide desktop button, remove outer glass capsule on sticky bar, full-width button
    expect(lgAdminCss).toMatch(/@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*?\.v2-client-add-btn--desktop\s*\{\s*display:\s*none\s*!important/);
    expect(lgAdminCss).toMatch(/@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*?\.v2-client-sticky-bar\s*\{[^}]*background:\s*transparent\s*!important[^}]*backdrop-filter:\s*none\s*!important[^}]*border:\s*none\s*!important[^}]*box-shadow:\s*none\s*!important/);
    expect(lgAdminCss).toMatch(/@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*?\.v2-client-add-btn--mobile\s*\{[^}]*width:\s*100%\s*!important/);

    // Excel green styling in Dark & Light modes
    expect(lgAdminCss).toMatch(/html\[data-theme="dark"\][^}]*\.v2-client-export-btn\s*\{[^}]*rgba\(16,\s*185,\s*129,/);
    expect(lgAdminCss).toMatch(/html\[data-theme="light"\][^}]*\.v2-client-export-btn\s*\{[^}]*rgba\(16,\s*185,\s*129,/);
    expect(lgAdminCss).toMatch(/\.v2-client-export-btn:disabled\s*\{/);
  });

  it('triggers XLSX download, prevents concurrent exports, and reports success/errors', async () => {
    let resolveExport!: (rows: any[]) => void;
    mockExportClientsFn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveExport = resolve;
        }),
    );

    render(<V2Clients />);
    const exportBtn = screen.getByRole('button', { name: 'Exportar clientes a Excel' });
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect((exportBtn as HTMLButtonElement).disabled).toBe(true);
      expect(exportBtn.getAttribute('aria-busy')).toBe('true');
    });

    fireEvent.click(exportBtn);
    expect(mockExportClientsFn).toHaveBeenCalledTimes(1);

    resolveExport([
      {
        clienteDesde: '15/01/2026',
        nombre: 'Carlos Gardel',
        mail: 'carlos@kani.ar',
        celular: '+5491122334455',
        barbero: 'Lautaro',
        ultimaAtencion: '10/11/2026',
        serviciosRealizados: 1,
        proximaReserva: '',
        observaciones: '',
        idInterno: 'cli-1',
      },
    ]);

    await waitFor(() => {
      const status = screen.getByRole('status');
      expect(status.textContent).toContain('Exportación completada: KANI_Clientes_');
      expect(status.textContent).toContain('1 cliente');
    });

    // Error state
    mockExportClientsFn.mockRejectedValueOnce(new Error('Fallo de red'));
    fireEvent.click(screen.getByRole('button', { name: 'Exportar clientes a Excel' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Fallo de red');
    });
  });

  it('builds shared export rows with exact barber rules (chronological, Franco included, no future/cancelled/pending) and valid XLSX', async () => {
    const rows = buildClientExportRows({
      today: '2026-11-17',
      barbers: [
        { id: 'lautaro', name: 'Lautaro' },
        { id: 'gonzalo', name: 'Gonzalo' },
        { id: 'valentin', name: 'Valentín' },
        { id: 'franco', name: 'Franco' },
      ],
      clients: [
        {
          id: 'cli-1',
          name: 'Marcos Díaz',
          email: 'marcos@kani.ar',
          phone: '+5491122334455',
          created_at: '2025-05-03T12:00:00Z',
          notes: '=SUM(A1:A2)',
        },
        // Duplicate ID should be ignored
        {
          id: 'cli-1',
          name: 'Marcos Díaz',
          email: 'marcos@kani.ar',
          phone: '+5491122334455',
          created_at: '2025-05-03T12:00:00Z',
        },
        {
          id: 'cli-2',
          name: 'Cliente Nuevo',
          email: '',
          phone: '01144556677',
          created_at: '2026-11-16T09:00:00Z',
        },
      ],
      servicePayments: [
        { id: 'p-1', appointment_id: 'a-gonzalo', service_name: 'Corte' },
        { id: 'p-void', appointment_id: 'a-pending-only', service_name: 'Anulado' },
      ],
      appointments: [
        // Attended by Franco first (2026-01-10)
        {
          id: 'a-franco',
          client_id: 'cli-1',
          barber_id: 'franco',
          booking_date: '2026-01-10',
          start_time: '10:00',
          status: 'COMPLETED',
        },
        // Attended by Gonzalo via payment (2026-03-15)
        {
          id: 'a-gonzalo',
          client_id: 'cli-1',
          barber_id: 'gonzalo',
          booking_date: '2026-03-15',
          start_time: '11:00',
          status: 'CONFIRMED',
        },
        // Attended by Franco again (must not duplicate Franco)
        {
          id: 'a-franco-2',
          client_id: 'cli-1',
          barber_id: 'franco',
          booking_date: '2026-04-01',
          start_time: '12:00',
          status: 'COMPLETED',
        },
        // Cancelled by Valentín (must NOT appear)
        {
          id: 'a-cancel',
          client_id: 'cli-1',
          barber_id: 'valentin',
          booking_date: '2026-05-01',
          start_time: '12:00',
          status: 'CANCELLED',
        },
        // Future confirmed booking with Lautaro (must NOT count as attended, appears as Próxima reserva)
        {
          id: 'a-future',
          client_id: 'cli-1',
          barber_id: 'lautaro',
          booking_date: '2026-11-25',
          start_time: '15:00',
          status: 'CONFIRMED',
        },
        // Pending-only booking for cli-2 (must NOT assign barber)
        {
          id: 'a-pending-only',
          client_id: 'cli-2',
          barber_id: 'lautaro',
          booking_date: '2026-11-18',
          start_time: '16:00',
          status: 'PENDING',
        },
      ],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      clienteDesde: '03/05/2025',
      nombre: 'Marcos Díaz',
      mail: 'marcos@kani.ar',
      celular: '+5491122334455',
      barbero: 'Franco | Gonzalo',
      ultimaAtencion: '01/04/2026',
      serviciosRealizados: 3,
      proximaReserva: '25/11/2026',
    });
    expect(rows[1]).toMatchObject({
      clienteDesde: '16/11/2026',
      nombre: 'Cliente Nuevo',
      celular: '01144556677',
      barbero: 'Sin atenciones',
      serviciosRealizados: 0,
      proximaReserva: '18/11/2026',
    });

    expect(buildClientExportFilename('2026-11-17')).toBe('KANI_Clientes_2026-11-17.xlsx');

    const bytes = await generateClientsWorkbookBuffer(rows);
    const parsed = new ExcelJS.Workbook();
    await parsed.xlsx.load(bytes.buffer as ArrayBuffer);

    const sheet = parsed.getWorksheet('Clientes');
    expect(sheet).toBeTruthy();
    expect(sheet?.views?.[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet?.autoFilter).toBe('A1:J1');

    const headers = [1, 2, 3, 4, 5].map((c) => sheet?.getRow(1).getCell(c).value);
    expect(headers).toEqual(['Cliente desde', 'Nombre', 'Mail', 'Celular', 'Barbero']);

    expect(sheet?.getRow(2).getCell(1).value).toBe('03/05/2025');
    expect(sheet?.getRow(2).getCell(4).value).toBe('+5491122334455');
    expect(sheet?.getRow(2).getCell(5).value).toBe('Franco | Gonzalo');
    expect(sheet?.getRow(2).getCell(9).value).toBe("'=SUM(A1:A2)");
    expect(sheet?.getRow(3).getCell(4).value).toBe('01144556677');
    expect(sheet?.getRow(3).getCell(5).value).toBe('Sin atenciones');
  });
});

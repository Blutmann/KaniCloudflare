import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { GoogleCalendarAdminSection } from '@/components/kani/google-calendar-admin-section';

// Mock de useAdminStaff
let mockStaffRole: 'ADMIN' | 'BARBER' = 'ADMIN';
vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => ({
    profile: { role: mockStaffRole, barber_id: null, display_name: 'Admin Test' },
    barbers: [],
    triggerRefresh: vi.fn(),
    isRefreshing: false,
  }),
}));

// Mock de Supabase client
let mockSessionToken: string | null = 'mock-admin-access-token-xyz';
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockImplementation(() =>
        Promise.resolve({
          data: {
            session: mockSessionToken ? { access_token: mockSessionToken } : null,
          },
          error: null,
        }),
      ),
    },
  },
}));

describe('KANI BARBER STUDIO — Google Calendar Admin Section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStaffRole = 'ADMIN';
    mockSessionToken = 'mock-admin-access-token-xyz';
  });

  it('1. Renderiza el panel de Google Calendar con estado Desconectado inicialmente', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/integrations/google-calendar/status')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              configured: true,
              authorized: false,
              strategy: 'OAUTH2',
              syncEnabled: false,
              scope: 'https://www.googleapis.com/auth/calendar.events.owned',
              lastAuthorizedAt: null,
            }),
        });
      }
      return Promise.resolve({ ok: false });
    }) as any;

    render(<GoogleCalendarAdminSection />);

    expect(screen.getByText('Google Calendar')).toBeInTheDocument();
    expect(screen.getByText(/Sincronización centralizada/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Desconectado')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Conectar Google Calendar/i })).toBeInTheDocument();
    });
  });

  it('2. Muestra estado Conectado y confirmación visual cuando la integración está autorizada', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/integrations/google-calendar/status')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              configured: true,
              authorized: true,
              strategy: 'OAUTH2',
              syncEnabled: false,
              scope: 'https://www.googleapis.com/auth/calendar.events.owned',
              lastAuthorizedAt: '2026-11-01T15:00:00Z',
            }),
        });
      }
      return Promise.resolve({ ok: false });
    }) as any;

    render(<GoogleCalendarAdminSection />);

    await waitFor(() => {
      expect(screen.getByText('Conectado')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Reconectar cuenta/i })).toBeInTheDocument();
    });
  });

  it('3. El botón inicia el flujo OAuth transmitiendo el Bearer token de la sesión ADMIN existente', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, options?: any) => {
      if (url.includes('/api/integrations/google-calendar/status')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              configured: true,
              authorized: false,
              strategy: 'OAUTH2',
              syncEnabled: false,
              scope: 'https://www.googleapis.com/auth/calendar.events.owned',
              lastAuthorizedAt: null,
            }),
        });
      }
      if (url.includes('/api/integrations/google-calendar/authorize')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test',
            }),
        });
      }
      return Promise.resolve({ ok: false });
    });
    global.fetch = fetchMock as any;

    // Mock window.location.href setter
    const originalLocation = window.location;
    delete (window as any).location;
    window.location = { ...originalLocation, href: 'https://kanibarber.test/panel-administracion/mantenimiento' } as any;

    try {
      render(<GoogleCalendarAdminSection />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Conectar Google Calendar/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Conectar Google Calendar/i }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/integrations/google-calendar/authorize',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              Authorization: 'Bearer mock-admin-access-token-xyz',
            }),
          }),
        );
        expect(window.location.href).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      });
    } finally {
      window.location = originalLocation;
    }
  });

  it('4. Cuentas con rol no ADMIN (ej. BARBER) no renderizan la sección de integración', () => {
    mockStaffRole = 'BARBER';
    const { container } = render(<GoogleCalendarAdminSection />);
    expect(container.firstChild).toBeNull();
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

const {
  mockSignInWithPassword,
  mockRequestPasswordReset,
  mockSignOut,
  mockVerifyOtp,
  mockExchangeCodeForSession,
  mockSetSession,
  mockGetUser,
  mockUpdateUser,
} = vi.hoisted(() => ({
  mockSignInWithPassword: vi.fn(),
  mockRequestPasswordReset: vi.fn(),
  mockSignOut: vi.fn(),
  mockVerifyOtp: vi.fn(),
  mockExchangeCodeForSession: vi.fn(),
  mockSetSession: vi.fn(),
  mockGetUser: vi.fn(),
  mockUpdateUser: vi.fn(),
}));

vi.mock('@/lib/kani-auth', () => ({
  signInWithPassword: mockSignInWithPassword,
  requestPasswordReset: mockRequestPasswordReset,
  signOut: mockSignOut,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      verifyOtp: mockVerifyOtp,
      exchangeCodeForSession: mockExchangeCodeForSession,
      setSession: mockSetSession,
      getUser: mockGetUser,
      updateUser: mockUpdateUser,
    },
  },
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => opts,
}));

import { AdminAccess } from '@/components/kani/admin-access';
import { ResetPasswordScreen } from '@/routes/restablecer-contrasena';

describe('Kani — Admin Login, Liquid Glass & Password Recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/panel-administracion');
  });

  afterEach(() => {
    cleanup();
  });

  describe('1. AdminAccess — ¿Olvidaste tu contraseña? & Verificando...', () => {
    it('renders "¿Olvidaste tu contraseña?" below "Contraseña" and before "Iniciar sesión"', () => {
      render(<AdminAccess onAuthenticated={vi.fn()} />);

      const passwordInput = screen.getByLabelText('Contraseña');
      const forgotButton = screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' });
      const submitButton = screen.getByRole('button', { name: /Iniciar sesión/i });

      expect(passwordInput).toBeTruthy();
      expect(forgotButton).toBeTruthy();
      expect(submitButton).toBeTruthy();

      expect(
        passwordInput.compareDocumentPosition(forgotButton) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        forgotButton.compareDocumentPosition(submitButton) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('shows exact "Verificando..." text (never "VERIFICANDO…") and prevents duplicate submits', async () => {
      let resolveLogin!: (value: { error: null }) => void;
      mockSignInWithPassword.mockImplementation(
        () =>
          new Promise<{ error: null }>((resolve) => {
            resolveLogin = resolve;
          }),
      );

      const onAuth = vi.fn();
      render(<AdminAccess onAuthenticated={onAuth} />);

      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'barber@kani.ar' } });
      fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'super-secret-12' } });

      const submitBtn = screen.getByRole('button', { name: /Iniciar sesión/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(submitBtn.textContent).toContain('Verificando...');
        expect(submitBtn.textContent).not.toContain('VERIFICANDO');
        expect(submitBtn.getAttribute('aria-busy')).toBe('true');
        expect(submitBtn.getAttribute('data-busy')).toBe('true');
        expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
      });

      fireEvent.click(submitBtn);
      expect(mockSignInWithPassword).toHaveBeenCalledTimes(1);

      resolveLogin({ error: null });
      await waitFor(() => {
        expect(onAuth).toHaveBeenCalledTimes(1);
      });
    });

    it('switches to forgot mode preserving email, requests reset, and shows neutral confirmation', async () => {
      mockRequestPasswordReset.mockResolvedValue({ error: null });
      render(<AdminAccess onAuthenticated={vi.fn()} />);

      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jefe@kani.ar' } });
      fireEvent.click(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' }));

      const recoveryEmail = screen.getByLabelText('Email') as HTMLInputElement;
      expect(recoveryEmail.value).toBe('jefe@kani.ar');

      fireEvent.click(screen.getByRole('button', { name: /Enviar enlace/i }));

      await waitFor(() => {
        expect(mockRequestPasswordReset).toHaveBeenCalledWith('jefe@kani.ar');
        const status = screen.getByRole('status');
        expect(status.textContent).toContain('Si el correo corresponde a una cuenta interna');
      });
    });

    it('does not reveal unregistered emails even if Supabase returns an auth error', async () => {
      mockRequestPasswordReset.mockResolvedValue({
        error: { message: 'User not found', status: 400 },
      });
      render(<AdminAccess onAuthenticated={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' }));
      fireEvent.change(screen.getByLabelText('Email'), {
        target: { value: 'noexiste@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Enviar enlace/i }));

      await waitFor(() => {
        const status = screen.getByRole('status');
        expect(status.textContent).toContain('Si el correo corresponde a una cuenta interna');
      });
    });
  });

  describe('2. ResetPasswordScreen — /restablecer-contrasena', () => {
    it('verifies recovery token_hash, updates password, signs out, and redirects to login', async () => {
      window.history.replaceState(
        {},
        '',
        '/restablecer-contrasena?token_hash=abc123&type=recovery',
      );
      mockVerifyOtp.mockResolvedValue({ error: null });
      mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
      mockUpdateUser.mockResolvedValue({ error: null });
      mockSignOut.mockResolvedValue({ error: null });

      render(<ResetPasswordScreen />);

      await waitFor(() => {
        expect(mockVerifyOtp).toHaveBeenCalledWith({
          token_hash: 'abc123',
          type: 'recovery',
        });
        expect(screen.getByLabelText('Nueva contraseña')).toBeTruthy();
      });

      expect(window.location.pathname).toBe('/restablecer-contrasena');
      expect(window.location.search).toBe('');

      fireEvent.change(screen.getByLabelText('Nueva contraseña'), {
        target: { value: 'nueva-clave-segura-12' },
      });
      fireEvent.change(screen.getByLabelText('Confirmar contraseña'), {
        target: { value: 'nueva-clave-segura-12' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Guardar contraseña/i }));

      await waitFor(() => {
        expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'nueva-clave-segura-12' });
        expect(mockSignOut).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('status').textContent).toContain(
          'Contraseña actualizada correctamente',
        );
      });
    });

    it('handles expired or invalid links and allows requesting a new link', async () => {
      window.history.replaceState({}, '', '/restablecer-contrasena?error=access_denied');
      mockRequestPasswordReset.mockResolvedValue({ error: null });

      render(<ResetPasswordScreen />);

      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toContain('venció');
      });

      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@kani.ar' } });
      fireEvent.click(screen.getByRole('button', { name: /Solicitar nuevo enlace/i }));

      await waitFor(() => {
        expect(mockRequestPasswordReset).toHaveBeenCalledWith('admin@kani.ar');
        expect(screen.getByRole('status').textContent).toContain(
          'Si el correo corresponde a una cuenta interna',
        );
      });
    });

    it('verifies exact production template hash link (#token_hash=...&type=recovery), clears hash, and sets new password', async () => {
      window.history.replaceState(
        {},
        '',
        '/restablecer-contrasena#token_hash=prod-hash-xyz&type=recovery',
      );
      mockVerifyOtp.mockResolvedValue({ error: null });
      mockGetUser.mockResolvedValue({ data: { user: { id: 'barber-no-pass' } }, error: null });
      mockUpdateUser.mockResolvedValue({ error: null });
      mockSignOut.mockResolvedValue({ error: null });

      render(<ResetPasswordScreen />);

      await waitFor(() => {
        expect(mockVerifyOtp).toHaveBeenCalledWith({
          token_hash: 'prod-hash-xyz',
          type: 'recovery',
        });
        expect(screen.getByLabelText('Nueva contraseña')).toBeTruthy();
      });

      expect(window.location.pathname).toBe('/restablecer-contrasena');
      expect(window.location.hash).toBe('');

      fireEvent.change(screen.getByLabelText('Nueva contraseña'), {
        target: { value: 'primera-clave-segura-12' },
      });
      fireEvent.change(screen.getByLabelText('Confirmar contraseña'), {
        target: { value: 'primera-clave-segura-12' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Guardar contraseña/i }));

      await waitFor(() => {
        expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'primera-clave-segura-12' });
        expect(mockSignOut).toHaveBeenCalledTimes(1);
      });
    });

    it('rejects expired, invalid, or reused token_hash in window.location.hash', async () => {
      window.history.replaceState(
        {},
        '',
        '/restablecer-contrasena#token_hash=expired-or-used&type=recovery',
      );
      mockVerifyOtp.mockResolvedValue({
        error: { message: 'Token has expired or is invalid', status: 403 },
      });

      render(<ResetPasswordScreen />);

      await waitFor(() => {
        expect(mockVerifyOtp).toHaveBeenCalledWith({
          token_hash: 'expired-or-used',
          type: 'recovery',
        });
        expect(screen.getByRole('alert').textContent).toContain('venció');
      });
      expect(mockUpdateUser).not.toHaveBeenCalled();
      expect(window.location.hash).toBe('');
    });

    it('rejects /restablecer-contrasena without recovery token so an existing user session cannot be hijacked', async () => {
      window.history.replaceState({}, '', '/restablecer-contrasena');
      mockGetUser.mockResolvedValue({ data: { user: { id: 'other-logged-in-user' } }, error: null });

      render(<ResetPasswordScreen />);

      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toContain('venció');
      });
      expect(mockVerifyOtp).not.toHaveBeenCalled();
      expect(mockGetUser).not.toHaveBeenCalled();
      expect(mockUpdateUser).not.toHaveBeenCalled();
    });
  });

  describe('3. Liquid Glass CSS & Dark Mode Arrow Fix', () => {
    const lgAdminCss = fs.readFileSync(
      path.resolve(__dirname, '../components/kani/experimental/liquid-glass-admin.css'),
      'utf-8',
    );

    it('applies multi-layered Liquid Glass styles to .admin-login-shell in Light & Dark Mode', () => {
      expect(lgAdminCss).toContain('html[data-theme="light"] body[data-lg-admin="true"] .admin-login-shell');
      expect(lgAdminCss).toContain('html[data-theme="dark"] body[data-lg-admin="true"] .admin-login-shell');
      expect(lgAdminCss).toContain('backdrop-filter: blur(22px)');
    });

    it('sets text-transform: none and forces .admin-login-submit svg to inherit var(--lga-text) with stroke: currentColor', () => {
      expect(lgAdminCss).toContain('text-transform: none !important;');
      expect(lgAdminCss).toMatch(
        /\.admin-login-page\s+\.admin-login-submit:is\([\s\S]+?\)\s+svg\s*\{[^}]*color:\s*var\(--lga-text\)\s*!important;[^}]*stroke:\s*currentColor\s*!important;/,
      );
    });
  });
});

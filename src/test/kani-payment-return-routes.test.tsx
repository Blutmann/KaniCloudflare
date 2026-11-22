import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    options: config,
    useSearch: () => ({}),
  }),
  Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string }) => (
    <a href={to ?? '#'} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/kani-mercadopago.functions', () => ({
  getAppointmentPaymentStatusFn: vi.fn(async () => ({
    isConfirmed: false,
    appointmentStatus: 'PENDING',
    appointment: null,
  })),
}));

import { isLiquidGlassPath } from '@/components/kani/experimental/liquid-glass-shell';
import { Route as PagoErrorRoute } from '@/routes/pago.error';
import { Route as PagoPendienteRoute } from '@/routes/pago.pendiente';
import { Route as PagoExitoRoute } from '@/routes/pago.exito';

describe('Rutas de retorno de Mercado Pago (/pago/exito, /pago/error, /pago/pendiente)', () => {
  const rootDir = process.cwd();
  const rootCode = readFileSync(path.resolve(rootDir, 'src/routes/__root.tsx'), 'utf8');
  const exitoCode = readFileSync(path.resolve(rootDir, 'src/routes/pago.exito.tsx'), 'utf8');
  const errorCode = readFileSync(path.resolve(rootDir, 'src/routes/pago.error.tsx'), 'utf8');
  const pendienteCode = readFileSync(path.resolve(rootDir, 'src/routes/pago.pendiente.tsx'), 'utf8');

  beforeEach(() => {
    document.body.classList.remove('liquid-glass-active');
  });

  afterEach(() => {
    cleanup();
    document.body.classList.remove('liquid-glass-active');
  });

  it('1. isLiquidGlassPath y __root.tsx incluyen /pago para activar Liquid Glass antes del primer paint', () => {
    expect(isLiquidGlassPath('/pago/exito')).toBe(true);
    expect(isLiquidGlassPath('/pago/error')).toBe(true);
    expect(isLiquidGlassPath('/pago/pendiente')).toBe(true);
    expect(rootCode).toContain("'/pago'");
  });

  it('2. Ninguna ruta de retorno enlaza a /reservar-turno-mercadopago y todas usan /reservar y LiquidGlassShell', () => {
    for (const code of [exitoCode, errorCode, pendienteCode]) {
      expect(code).not.toContain('/reservar-turno-mercadopago');
      expect(code).toContain('<LiquidGlassShell section="booking">');
      expect(code).toContain('to="/reservar"');
    }
    expect(exitoCode).toContain('homeUrl="/reservar"');
  });

  it('3. /pago/error activa liquid-glass-active y enlaza limpiamente a /reservar', () => {
    const Component = (PagoErrorRoute as unknown as { options: { component: React.ComponentType } }).options.component;
    const { container } = render(<Component />);

    expect(document.body.classList.contains('liquid-glass-active')).toBe(true);
    expect(container.querySelector('.liquid-glass-page[data-lg-section="booking"]')).toBeInTheDocument();

    const retryLink = screen.getByRole('link', { name: /Reintentar reserva/i });
    const homeLink = screen.getByRole('link', { name: /Volver al inicio/i });
    expect(retryLink).toHaveAttribute('href', '/reservar');
    expect(homeLink).toHaveAttribute('href', '/reservar');
  });

  it('4. /pago/pendiente activa liquid-glass-active y enlaza a /reservar', () => {
    const Component = (PagoPendienteRoute as unknown as { options: { component: React.ComponentType } }).options.component;
    const { container } = render(<Component />);

    expect(document.body.classList.contains('liquid-glass-active')).toBe(true);
    expect(container.querySelector('.liquid-glass-page[data-lg-section="booking"]')).toBeInTheDocument();

    const homeLink = screen.getByRole('link', { name: /Volver al inicio/i });
    expect(homeLink).toHaveAttribute('href', '/reservar');
  });

  it('5. /pago/exito sin appointment_id activa liquid-glass-active y enlaza a /reservar', () => {
    const Component = (PagoExitoRoute as unknown as { options: { component: React.ComponentType } }).options.component;
    const { container } = render(<Component />);

    expect(document.body.classList.contains('liquid-glass-active')).toBe(true);
    expect(container.querySelector('.liquid-glass-page[data-lg-section="booking"]')).toBeInTheDocument();

    const homeLink = screen.getByRole('link', { name: /Volver al inicio/i });
    expect(homeLink).toHaveAttribute('href', '/reservar');
  });
});

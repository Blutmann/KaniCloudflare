import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { render, screen, act, cleanup } from '@testing-library/react';
import React from 'react';
import { LiquidGlassBooking } from '@/components/kani/experimental/liquid-glass-booking';

vi.mock('@/components/kani/store', () => ({
  useKani: () => ({
    mobileMenuOpen: false,
    setMobileMenuOpen: vi.fn(),
    theme: 'dark',
    toggleTheme: vi.fn(),
  }),
}));

vi.mock('@/lib/kani-availability', async original => ({
  ...await original<typeof import('@/lib/kani-availability')>(),
  readConfiguredServices: async () => [],
  readPublicBookingBarbers: async () => ['Lautaro', 'Gonzalo', 'Valentín'].map(name => ({ id: name, name })),
  readPublicAvailabilityStarts: async () => [],
}));

vi.mock('@/lib/kani-appointments', () => ({
  createRealAppointment: vi.fn(),
  appointmentErrorMessage: String,
}));

vi.mock('@/lib/kani-down-payment', () => ({
  getDynamicDownPayment: async () => 5000,
}));

describe('KANI Barber Studio — Liquid Glass Experience (/reservar-turno-liquid)', () => {
  const liquidCssPath = path.resolve(__dirname, '../components/kani/experimental/liquid-glass.css');
  const liquidCss = fs.readFileSync(liquidCssPath, 'utf-8');
  const routePath = path.resolve(__dirname, '../routes/reservar-turno-liquid.tsx');
  const routeCode = fs.readFileSync(routePath, 'utf-8');
  const siteHeaderPath = path.resolve(__dirname, '../components/kani/site-header.tsx');
  const siteHeaderCode = fs.readFileSync(siteHeaderPath, 'utf-8');

  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollTo = vi.fn();
    document.body.classList.remove('liquid-glass-active');
  });

  afterEach(() => {
    cleanup();
    document.body.classList.remove('liquid-glass-active');
  });

  it('1. La ruta /reservar-turno-liquid existe, monta LiquidGlassBooking e importa liquid-glass.css de forma aislada', () => {
    expect(routeCode).toContain("createFileRoute('/reservar-turno-liquid')");
    expect(routeCode).toContain('LiquidGlassBooking');
    expect(routeCode).toContain("@/components/kani/experimental/liquid-glass.css");
  });

  it('2. LiquidGlassBooking renderiza la atmósfera orgánica, activa body.liquid-glass-active y reutiliza el flujo real', async () => {
    const { container, unmount } = render(<LiquidGlassBooking />);

    expect(container.querySelector('.liquid-glass-reservation')).toBeInTheDocument();
    expect(container.querySelector('.liquid-glass-atmosphere')).toBeInTheDocument();
    expect(container.querySelectorAll('.liquid-orb').length).toBeGreaterThanOrEqual(3);
    expect(document.body.classList.contains('liquid-glass-active')).toBe(true);

    // Verifica que las opciones reales de servicio están presentes
    expect(screen.getByRole('button', { name: /Corte, 45 minutos/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Corte y barba, 60 minutos/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Barba, 30 minutos/i })).toBeInTheDocument();

    unmount();
    expect(document.body.classList.contains('liquid-glass-active')).toBe(false);
  });

  it('3. SiteHeader excluye ThemeToggle y campana de notificaciones en /reservar-turno-liquid', () => {
    expect(siteHeaderCode).toContain("path === '/reservar-turno-liquid'");
    expect(siteHeaderCode).toContain('{!isLiquidRoute && <ThemeToggle />}');
    expect(siteHeaderCode).toContain('{staff && !isLiquidRoute &&');
  });

  it('4. Define una única identidad visual Liquid Glass V6 blanco perla (#F9FAFB) monocromática inmune al tema global', () => {
    expect(liquidCss).toMatch(/body\.liquid-glass-active[\s\S]*?--background:\s*#f9fafb/);
    expect(liquidCss).toMatch(/body\.liquid-glass-active[\s\S]*?--foreground:\s*#18181b/);
    expect(liquidCss).toMatch(/body\.liquid-glass-active[\s\S]*?color-scheme:\s*light\s*!important/);
    expect(liquidCss).toMatch(/body\.liquid-glass-active::before,\s*\r?\nbody\.liquid-glass-active::after\s*\{[^}]*display:\s*none\s*!important/);
    expect(liquidCss).not.toContain('#702b3a');
    expect(liquidCss).not.toContain('#b5945b');
  });

  it('5. Sistema de materiales Liquid Glass: oculta checkmarks/círculos e incluye fallbacks de accesibilidad y rendimiento', () => {
    expect(liquidCss).toMatch(/\.liquid-glass-reservation\s+\.service-option\s+\.selection-circle[\s\S]*?display:\s*none\s*!important/);
    expect(liquidCss).toContain('@supports not (backdrop-filter: blur(1px))');
    expect(liquidCss).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(liquidCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(liquidCss).toContain('env(safe-area-inset-bottom)');
    expect(liquidCss).toContain('flex: 0 0 30% !important');
    expect(liquidCss).toContain('flex: 1 1 70% !important');
  });

  it('6. Stepper segmentado Liquid Glass V6: cápsula única con lente deslizante, sin círculos ni checks', () => {
    expect(liquidCss).toMatch(/\.booking-progress\s*\{[\s\S]*?border-radius:\s*9999px\s*!important/);
    expect(liquidCss).toMatch(/\.booking-progress\s*>\s*button\s*>\s*span\s*\{[\s\S]*?display:\s*none\s*!important/);
    expect(liquidCss).toMatch(/\.booking-progress::before\s*\{[\s\S]*?transform:\s*translate3d\(calc\(var\(--liquid-step-index, 0\) \* 100%\), 0, 0\)\s*!important/);
    expect(liquidCss).toMatch(/\.booking-progress::after\s*\{[\s\S]*?display:\s*none\s*!important/);
    expect(liquidCss).toContain('--liquid-step-index: 0;');
    expect(liquidCss).toContain('--liquid-step-index: 4;');
  });

  it('7. Tarjetas sin divisor vertical de ícono, botones pill Crystal Glass y menú optimizado sin backdrop-filter fullscreen', () => {
    expect(liquidCss).toContain('border-right: none !important;');
    expect(liquidCss).toMatch(/\.booking-next-button:not\(:disabled\)[\s\S]*?border-radius:\s*9999px\s*!important/);
    expect(liquidCss).not.toMatch(/\.liquid-orb\s*\{[^}]*filter:\s*blur\(/);
    expect(liquidCss).toMatch(/body\.liquid-glass-active \.mobile-menu[\s\S]*?backdrop-filter:\s*none\s*!important/);
    expect(liquidCss).toContain('contain: layout style paint;');
    expect(liquidCss).toContain('@keyframes liquidMenuEnter');
  });

  it('8. El stepper cápsula comparte exactamente los mismos márgenes laterales que las tarjetas de servicio', () => {
    expect(liquidCss).toContain('width: calc(100% - 40px) !important;');
    expect(liquidCss).toContain('margin-inline: 20px !important;');
    expect(liquidCss).toContain('width: calc(100% - 32px) !important;');
    expect(liquidCss).toContain('margin-inline: 16px !important;');
  });

  it('9. V6 Bottom & Layout: elimina padding-bottom heredado en mobile, ancla CTA al pie, alinea Horarios y unifica Datos', () => {
    expect(liquidCss).toContain('--lg-bg-pearl: #f9fafb;');
    expect(liquidCss).toContain('--lg-bg-mist: #f3f4f6;');
    expect(liquidCss).toContain('padding-bottom: 0 !important;');
    expect(liquidCss).toContain('height: calc(100svh - 64px) !important;');
    expect(liquidCss).toMatch(/\.booking-scroll-content\s*\{[\s\S]*?flex:\s*1 1 auto\s*!important/);
    expect(liquidCss).toContain('padding: 8px 20px max(8px, env(safe-area-inset-bottom)) !important;');
    expect(liquidCss).toMatch(/\.booking-time-period-header\s*\{[\s\S]*?align-items:\s*center\s*!important/);
    expect(liquidCss).toMatch(/\.booking-time-period-title\s*\{[\s\S]*?margin:\s*0\s*!important/);
    expect(liquidCss).toMatch(/\.booking-v2-unified-summary \.summary-appointment-card,\s*\.liquid-glass-reservation \.booking-v2-unified-summary \.summary-pricing-card\s*\{[\s\S]*?background:\s*transparent\s*!important/);
  });
});

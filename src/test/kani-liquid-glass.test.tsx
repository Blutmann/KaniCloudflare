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

  it('4. Define una única identidad visual Crystal Glass monocromática (perla/niebla/plata/grafito/negro suave) inmune al tema global', () => {
    expect(liquidCss).toMatch(/body\.liquid-glass-active[\s\S]*?--background:\s*#f5f7fa/);
    expect(liquidCss).toMatch(/body\.liquid-glass-active[\s\S]*?--foreground:\s*#141619/);
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

  it('6. Stepper de 5 pasos en única superficie Crystal Glass sin tarjetas opacas y con barra continua monocromática', () => {
    expect(liquidCss).toMatch(/\.booking-progress\s*>\s*button\[aria-current="step"\][\s\S]*?background:\s*transparent\s*!important/);
    expect(liquidCss).toMatch(/\.booking-progress\s*>\s*button\[aria-current="step"\]\s*>\s*span[\s\S]*?border:\s*1\.5px solid rgba\(20, 22, 25, 0\.74\)\s*!important/);
    expect(liquidCss).toMatch(/\.booking-progress\s*>\s*button\.complete\s*>\s*span[\s\S]*?background:\s*var\(--cg-crystal-smoked\)\s*!important/);
    expect(liquidCss).toContain('--liquid-progress-ratio: 0.2;');
    expect(liquidCss).toContain('--liquid-progress-ratio: 0.4;');
    expect(liquidCss).toContain('--liquid-progress-ratio: 0.6;');
    expect(liquidCss).toContain('--liquid-progress-ratio: 0.8;');
    expect(liquidCss).toContain('--liquid-progress-ratio: 1;');
  });

  it('7. Header+Stepper abiertos integrados, divisor de icono, botones pill Crystal Glass y menú optimizado sin backdrop-filter fullscreen', () => {
    expect(liquidCss).toMatch(/\.booking-progress\s*\{[\s\S]*?background:\s*transparent\s*!important/);
    expect(liquidCss).toContain('border-right: 1px solid rgba(20, 22, 25, 0.1) !important;');
    expect(liquidCss).toMatch(/\.booking-next-button:not\(:disabled\)[\s\S]*?border-radius:\s*9999px\s*!important/);
    expect(liquidCss).not.toMatch(/\.liquid-orb\s*\{[^}]*filter:\s*blur\(/);
    expect(liquidCss).toMatch(/body\.liquid-glass-active \.mobile-menu[\s\S]*?backdrop-filter:\s*none\s*!important/);
    expect(liquidCss).toContain('contain: layout style paint;');
    expect(liquidCss).toContain('@keyframes liquidMenuEnter');
  });

  it('8. El stepper comparte exactamente los mismos márgenes laterales que las tarjetas de servicio', () => {
    expect(liquidCss).toContain('padding: 8px 0 15px !important;');
    expect(liquidCss).toContain('padding: 6px 20px 13px !important;');
    expect(liquidCss).toContain('padding: 5px 16px 12px !important;');
    expect(liquidCss).toContain('width: calc((100% - 40px) * var(--liquid-progress-ratio, 0.2)) !important;');
    expect(liquidCss).toContain('width: calc((100% - 32px) * var(--liquid-progress-ratio, 0.2)) !important;');
  });

  it('9. V5 Crystal Glass: sistema de superficies (claro/seleccionado/flotante/ahumado), CTA anclado al pie, headers de Horarios alineados y Datos unificado', () => {
    expect(liquidCss).toContain('--lg-bg-pearl: #f5f7fa;');
    expect(liquidCss).toContain('--lg-bg-mist: #e3e7ee;');
    expect(liquidCss).toContain('--lg-glass-surface:');
    expect(liquidCss).toContain('--cg-crystal-floating:');
    expect(liquidCss).toContain('--cg-crystal-smoked:');
    expect(liquidCss).toMatch(/\.booking-scroll-content\s*\{[\s\S]*?flex:\s*1 1 auto\s*!important/);
    expect(liquidCss).toContain('padding: 8px 20px max(8px, env(safe-area-inset-bottom)) !important;');
    expect(liquidCss).toMatch(/\.booking-time-period-header\s*\{[\s\S]*?align-items:\s*center\s*!important/);
    expect(liquidCss).toMatch(/\.booking-time-period-title\s*\{[\s\S]*?margin:\s*0\s*!important/);
    expect(liquidCss).toMatch(/\.booking-v2-unified-summary \.summary-appointment-card,\s*\.liquid-glass-reservation \.booking-v2-unified-summary \.summary-pricing-card\s*\{[\s\S]*?background:\s*transparent\s*!important/);
  });
});

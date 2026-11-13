import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { render, screen, act, cleanup } from '@testing-library/react';
import React from 'react';
import { LiquidGlassBooking } from '@/components/kani/experimental/liquid-glass-booking';
import { LIQUID_GLASS_MOTION } from '@/components/kani/experimental/liquid-glass-motion';

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

  it('4. Define una única identidad visual Liquid Glass V9 blanco perla (#FCFCFD) monocromática grafito suave (#34383E) inmune al tema global', () => {
    expect(liquidCss).toMatch(/body\.liquid-glass-active[\s\S]*?--background:\s*#fcfcfd/);
    expect(liquidCss).toMatch(/body\.liquid-glass-active[\s\S]*?--foreground:\s*#34383e/);
    expect(liquidCss).toMatch(/body\.liquid-glass-active[\s\S]*?--lg-ink-secondary:\s*#626a74/);
    expect(liquidCss).toMatch(/body\.liquid-glass-active[\s\S]*?--lg-ink-muted:\s*#707781/);
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
    expect(liquidCss).toMatch(/\.booking-progress\s*>\s*button\s*>\s*span:not\(\.liquid-glass-stepper-lens\)\s*\{[\s\S]*?display:\s*none\s*!important/);
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

  it('8. El stepper cápsula comparte el ancho útil del viewport mobile con márgenes compactos (8-10px)', () => {
    expect(liquidCss).toContain('width: calc(100% - 20px) !important;');
    expect(liquidCss).toContain('margin: 8px 10px 0 !important;');
    expect(liquidCss).toContain('width: calc(100% - 16px) !important;');
    expect(liquidCss).toContain('margin: 8px 8px 0 !important;');
  });

  it('9. V8 Crystal Glass: sistema unificado sin fondos negros ni bordes oscuros fuertes, CTA ancho completo, Horarios y Datos unificados', () => {
    expect(liquidCss).toContain('--lg-bg-pearl: #fcfcfd;');
    expect(liquidCss).toContain('--lg-bg-mist: #f5f6f8;');
    expect(liquidCss).toContain('--cg-crystal-rest:');
    expect(liquidCss).toContain('--cg-crystal-selected:');
    expect(liquidCss).toContain('--cg-crystal-active:');
    expect(liquidCss).not.toContain('--cg-crystal-smoked');
    expect(liquidCss).not.toContain('--button-primary-bg: #18181b');
    expect(liquidCss).toContain('html[data-theme] .site-shell .liquid-glass-reservation .booking-next-button:not(:disabled)');
    expect(liquidCss).toContain('html[data-theme] .site-shell .liquid-glass-reservation .booking-option.selected');
    expect(liquidCss).toContain('padding: 0 !important;');
    expect(liquidCss).toContain('height: calc(100svh - 64px) !important;');
    expect(liquidCss).toMatch(/\.booking-scroll-content\s*\{[\s\S]*?flex:\s*1 1 auto\s*!important/);
    expect(liquidCss).toContain('padding: 6px 10px max(8px, env(safe-area-inset-bottom)) !important;');
    expect(liquidCss).toContain('aspect-ratio: 11 / 15 !important;');
    expect(liquidCss).toMatch(/\.booking-time-period-header\s*\{[\s\S]*?align-items:\s*center\s*!important/);
    expect(liquidCss).toMatch(/\.booking-time-period-title\s*\{[\s\S]*?margin:\s*0\s*!important/);
    expect(liquidCss).toMatch(/\.booking-v2-unified-summary \.summary-appointment-card,[\s\S]*?\.booking-v2-unified-summary \.summary-pricing-card\s*\{[\s\S]*?background:\s*transparent\s*!important/);
  });

  it('10. Motion V1: parámetros centralizados, lente deslizante y transición de pasos aislados en LiquidGlassBooking', () => {
    expect(LIQUID_GLASS_MOTION.scales.cardTap).toBeGreaterThanOrEqual(0.985);
    expect(LIQUID_GLASS_MOTION.scales.cardTap).toBeLessThanOrEqual(0.99);
    expect(LIQUID_GLASS_MOTION.durations.tap).toBeGreaterThanOrEqual(0.12);
    expect(LIQUID_GLASS_MOTION.durations.tap).toBeLessThanOrEqual(0.22);
    expect(LIQUID_GLASS_MOTION.durations.step).toBeGreaterThanOrEqual(0.2);
    expect(LIQUID_GLASS_MOTION.durations.step).toBeLessThanOrEqual(0.3);
    expect(LIQUID_GLASS_MOTION.springs.stepperLens.type).toBe('spring');

    const { container, unmount } = render(<LiquidGlassBooking />);
    expect(container.querySelectorAll('.liquid-glass-stepper-lens')).toHaveLength(1);
    expect(container.querySelectorAll('.liquid-glass-step-stage')).toHaveLength(1);
    expect(liquidCss).toContain('.liquid-glass-stepper-lens');
    expect(liquidCss).toContain('.liquid-glass-step-stage');
    unmount();
  });

  it('11. Tipografía híbrida V1: Zen Antique editorial + Geist Sans funcional aislados en /reservar-turno-liquid', () => {
    expect(routeCode).toContain("@fontsource/geist-sans/400.css");
    expect(routeCode).toContain("@fontsource/geist-sans/500.css");
    expect(routeCode).toContain("@fontsource/geist-sans/600.css");
    expect(liquidCss).toContain("--lg-font-editorial: 'Zen Antique', serif;");
    expect(liquidCss).toContain("--lg-font-ui: 'Geist Sans'");
    expect(liquidCss).not.toMatch(/^body\s*\{[^}]*Geist/m);
    expect(liquidCss).not.toMatch(/^html\s*\{[^}]*Geist/m);
  });
});

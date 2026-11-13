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

  it('3. SiteHeader habilita ThemeToggle para modos Claro/Oscuro y excluye campana de notificaciones en /reservar-turno-liquid', () => {
    expect(siteHeaderCode).toContain("path === '/reservar-turno-liquid'");
    expect(siteHeaderCode).toContain('<ThemeToggle />');
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

  it('12. Fondos KANI Signature Glass (Claro/Oscuro, Mobile/Desktop) con fallbacks y contraste Dark Mode', () => {
    expect(liquidCss).toContain('/kani-signature-light-mobile.webp');
    expect(liquidCss).toContain('/kani-signature-light-desktop.webp');
    expect(liquidCss).toContain('/kani-signature-dark-mobile.webp');
    expect(liquidCss).toContain('/kani-signature-dark-desktop.webp');
    expect(liquidCss).toContain('image-set(');
    expect(liquidCss).toContain('background-color: #f3f2f0;');
    expect(liquidCss).toContain('background-color: #121213;');
    expect(liquidCss).toContain('html[data-theme="dark"] .liquid-glass-atmosphere');
  });

  it('13. Motion V2.1: tokens y transiciones para botones CTA, calendario y horarios sin afectar el flujo tradicional', () => {
    expect(LIQUID_GLASS_MOTION.durations.cardState).toBeGreaterThanOrEqual(0.18);
    expect(LIQUID_GLASS_MOTION.durations.cardState).toBeLessThanOrEqual(0.26);
    expect(LIQUID_GLASS_MOTION.scales.actionTap).toBeGreaterThanOrEqual(0.98);
    expect(LIQUID_GLASS_MOTION.scales.slotTap).toBeGreaterThanOrEqual(0.97);
    expect(LIQUID_GLASS_MOTION.scales.dayTap).toBeGreaterThanOrEqual(0.95);
    expect(liquidCss).toContain('.booking-back-button:not(:disabled)');
    expect(liquidCss).toContain('.booking-next-button:not(:disabled)');
    expect(liquidCss).toContain('.calendar-day:not(:disabled)');
    expect(liquidCss).toContain('.booking-time-slot:not(:disabled)');
    expect(liquidCss).toContain('.booking-time-slot.time-unavailable');
  });

  it('14. Liquid Glass V3: atenuación de atmósfera (Claro/Oscuro), cristal ahumado en Dark Mode y legibilidad de CTAs', () => {
    expect(liquidCss).toContain('.liquid-glass-atmosphere::after');
    expect(liquidCss).toContain('html[data-theme="dark"] .liquid-glass-atmosphere::after');
    expect(liquidCss).toContain('rgba(255, 255, 255, 0.11)');
    expect(liquidCss).toContain('rgba(255, 255, 255, 0.28)');
    expect(liquidCss).toContain('html[data-theme="dark"] .site-shell .liquid-glass-reservation .booking-back-button:disabled');
  });

  it('15. Optical Glass & Motion V3: reflejo especular localizado, bordes direccionales asimétricos y jerarquía tipográfica 500/400', () => {
    expect(LIQUID_GLASS_MOTION.durations.step).toBe(0.3);
    expect(LIQUID_GLASS_MOTION.distances.stepShiftPx).toBe(18);
    expect(liquidCss).toContain('.lg-optical-sheen');
    expect(liquidCss).toContain('border-top-color:');
    expect(liquidCss).toContain('border-bottom-color:');
    expect(liquidCss).toMatch(/\.service-option\s+\.booking-option-price\s*\{[\s\S]*?font-weight:\s*500\s*!important/);
    expect(liquidCss).toContain('@keyframes liquidErrorEnter');
  });

  it('16. Living Glass V4: fondos neutros (#fafafb / #0b0b0d), blur diferenciado mobile/desktop, bordes discontinuos y destello breve', () => {
    expect(liquidCss).toContain('#fafafb');
    expect(liquidCss).toContain('#0b0b0d');
    expect(liquidCss).toContain('blur(18px) saturate(145%)');
    expect(liquidCss).toContain('blur(24px) saturate(155%)');
    expect(liquidCss).toContain('mask-composite: exclude');
    expect(liquidCss).toContain('@keyframes livingGlassGlint');
  });

  it('17. Liquid Glass V5: servicios editoriales sin íconos, Geist 500/400/500 y Crystal Selection accesible', () => {
    expect(liquidCss).toContain('.booking-service-options .service-option .option-icon');
    expect(liquidCss).toContain('LIQUID GLASS V5: Editorial Service Cards & Crystal Selection');
    expect(liquidCss).toContain('.selected .selection-circle');
    expect(liquidCss).toContain('rgba(246, 240, 229, 0.94)');
    expect(liquidCss).toContain('rgba(224, 200, 156, 0.46)');
    expect(liquidCss).toContain(':focus-visible');
  });

  it('18. Liquid Glass V6: cards de servicios compactas, cristal unificado, nitidez en calendario e identidad KANI Dark', () => {
    expect(liquidCss).toContain('LIQUID GLASS V6: Service Cards Redesign, Unified Crystal Selection, Calendar Crispness & KANI Dark Identity');
    expect(liquidCss).toContain('min-height: 100px !important;');
    expect(liquidCss).toContain('.calendar-panel > *');
    expect(liquidCss).toContain('color: #1c1f24 !important;');
    expect(liquidCss).toContain('rgba(168, 52, 72, 0.28)');
    expect(liquidCss).toContain('rgba(154, 130, 88, 0.54)');
  });

  it('19. Liquid Glass V7: Optical Density sin checkmarks, variantes A/B de Servicios, Stepper alineado, KANI Identity y Motion V4', () => {
    expect(liquidCss).toContain('LIQUID GLASS V7: Optical Density · Living Glass · KANI Identity · Motion V4');
    expect(liquidCss).toContain('[data-services-variant="a"]');
    expect(liquidCss).toContain('[data-services-variant="b"]');
    expect(liquidCss).toContain('rgba(200, 169, 107, 0.38)');
    expect(liquidCss).toContain('rgba(112, 43, 58, 0.32)');
    expect(liquidCss).toContain('@keyframes livingGlassOpticalSweep');
  });

  it('20. Liquid Glass V8: Servicios Variante A definitiva, Optical Density V2, Living Surface física y KANI Ambient Identity', () => {
    const bookingWrapperTsx = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/kani/experimental/liquid-glass-booking.tsx'),
      'utf8',
    );
    const motionTsx = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/kani/experimental/liquid-glass-motion.tsx'),
      'utf8',
    );

    expect(bookingWrapperTsx).not.toContain('lg-services-variant-bar');
    expect(bookingWrapperTsx).not.toContain('ServicesLayoutVariant');
    expect(motionTsx).toContain('lg-living-surface');
    expect(motionTsx).toContain('lg-living-wave');
    expect(motionTsx).toContain('lg-living-edge');
    expect(motionTsx).toContain('--lg-touch-x');
    expect(motionTsx).toContain('--lg-touch-y');
    expect(motionTsx).toContain('data-lg-ripple');
    expect(liquidCss).toContain('LIQUID GLASS V8: KANI Living Surface · Fluid Interaction · Optical Density V2 · Brand Identity');
    expect(liquidCss).toContain('@keyframes kaniLivingWave');
    expect(liquidCss).toContain('@keyframes kaniLivingEdgePulse');
    expect(liquidCss).toContain('rgba(200, 169, 107, 0.56)');
    expect(liquidCss).toContain('rgba(112, 43, 58, 0.14)');
  });

  it('21. Liquid Glass V9: Calendario 5 estados, Optical Density V3 en Horarios y Living Surface V2', () => {
    const motionTsx = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/kani/experimental/liquid-glass-motion.tsx'),
      'utf8',
    );

    expect(motionTsx).toContain('lg-living-core');
    expect(liquidCss).toContain('LIQUID GLASS V9: Crystal Selection · Calendar Accessibility · Enhanced Living Surface · KANI Identity');
    expect(liquidCss).toContain('.calendar-day[data-past="true"]:disabled');
    expect(liquidCss).toContain('.calendar-day:disabled:not([data-past="true"])');
    expect(liquidCss).toContain('.calendar-day.today::before');
    expect(liquidCss).toContain('@keyframes kaniLivingCoreV2');
    expect(liquidCss).toContain('@keyframes kaniLivingWaveV2');
    expect(liquidCss).toContain('@keyframes kaniLivingEdgePulseV2');
  });

  it('22. Liquid Glass V10: Selección unificada en Servicios/Barberos, Identidad KANI y Living Surface V3', () => {
    const motionTsx = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/kani/experimental/liquid-glass-motion.tsx'),
      'utf8',
    );

    expect(motionTsx).toContain('lg-living-refraction');
    expect(liquidCss).toContain('LIQUID GLASS V10: Unified Crystal Selection · KANI Identity · Living Surface V3');
    expect(liquidCss).toContain('rgba(200, 169, 107, 0.78)');
    expect(liquidCss).toContain('@keyframes kaniLivingRefractionV3');
    expect(liquidCss).toContain('@keyframes kaniLivingWaveV3');
    expect(liquidCss).toContain('@keyframes kaniLivingEdgePulseV3');
  });

  it('23. Liquid Glass V11: Paleta cálida sin tonos azulados, botones inferiores unificados, calendario en 3 superficies y POC de refracción aislado', () => {
    const bookingWrapperTsx = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/kani/experimental/liquid-glass-booking.tsx'),
      'utf8',
    );
    const pocTsx = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/kani/experimental/refraction-poc.tsx'),
      'utf8',
    );

    expect(bookingWrapperTsx).toContain('refraction-poc');
    expect(pocTsx).toContain('feDisplacementMap');
    expect(pocTsx).toContain('useReducedMotion');
    expect(liquidCss).toContain('LIQUID GLASS V11: Modern Japanese Atelier · Warm Optical Glass · Calendar 3-Surface · Bottom CTAs · Refraction POC');
    expect(liquidCss).toContain('rgba(226, 221, 214, 0.94)');
    expect(liquidCss).toContain('.calendar-footer-info .calendar-note');
    expect(liquidCss).toContain('.lg-refraction-poc-card');
  });

  it('24. Liquid Glass V12: Contraste cálido Light Mode, Dark Mode más profundo (#080809/#111113), alturas 78px/50px y CTAs neutros', () => {
    expect(liquidCss).toContain('LIQUID GLASS V12: Warm Crystal Contrast · Deeper Dark Mode · Spacing Refinement');
    expect(liquidCss).toContain('rgba(204, 198, 190, 0.92)');
    expect(liquidCss).toContain('#080809');
    expect(liquidCss).toContain('rgba(17, 17, 19, 0.64)');
    expect(liquidCss).toContain('min-height: 78px !important;');
    expect(liquidCss).toContain('height: 50px !important;');
    expect(liquidCss).toContain('min-width: 44px !important;');
  });

  it('25. Liquid Glass V12.1 + V12.2: Servicios consolidados a 96px, Barberos con mayor altura e Instagram visible, separación del Calendario e Interacción Táctil Unificada', () => {
    const motionTsx = fs.readFileSync(
      path.join(process.cwd(), 'src/components/kani/experimental/liquid-glass-motion.tsx'),
      'utf8',
    );
    expect(liquidCss).toContain('LIQUID GLASS V12.1 + V12.2: Servicios 96px, Barberos +12-16px e Interacción Táctil Unificada');
    expect(liquidCss).toContain('[data-services-variant="a"] .booking-page .booking-service-options > .service-option:nth-child(n)');
    expect(liquidCss).toContain('height: 92px !important;');
    expect(liquidCss).toContain('aspect-ratio: 11 / 16.3 !important;');
    expect(liquidCss).toContain('.calendar-panel::before');
    expect(liquidCss).toContain('content: none !important;');
    expect(motionTsx).toContain('serviceCardTap');
    expect(motionTsx).toContain('barberCardTap');
    expect(motionTsx).toContain('isLargeCard');
  });

  it('26. Liquid Glass V12.3: .lg-living-surface mantiene position: absolute a tamaño completo en Servicios y Barberos (sin colapso por > *)', () => {
    expect(liquidCss).toContain('LIQUID GLASS V12.1 + V12.2');
    expect(liquidCss).toContain('Interacción Táctil Unificada V12.3');
    expect(liquidCss).toContain('.service-option > :not(.lg-living-surface):not(.lg-optical-sheen)');
    expect(liquidCss).toContain('.booking-option > :not(.lg-living-surface):not(.lg-optical-sheen)');
    expect(liquidCss).toContain('width: 100% !important;');
    expect(liquidCss).toContain('height: 100% !important;');
  });

  it('27. Liquid Glass V12.4 + V12.5 + V12.6: Ondas WAAPI (320/440ms), Barberos gap igualado (10/12px), CTA Continuar y Encabezado Calendario 14px/500', () => {
    const motionTsx = fs.readFileSync(
      path.join(process.cwd(), 'src/components/kani/experimental/liquid-glass-motion.tsx'),
      'utf8',
    );
    expect(liquidCss).toContain('LIQUID GLASS V12.6: Microajustes CTA «Continuar» y Encabezado del Calendario');
    expect(liquidCss).toContain('touch-action: manipulation;');
    expect(liquidCss).toContain('-webkit-tap-highlight-color: transparent;');
    expect(liquidCss).toContain('column-gap: 12px !important;');
    expect(liquidCss).toContain('column-gap: 10px !important;');
    expect(liquidCss).toContain('font-size: 14px !important;');
    expect(liquidCss).toContain('box-shadow: none !important;');
    expect(liquidCss).not.toMatch(/\.lg-living-refraction[\s\S]{0,400}backdrop-filter:/);
    expect(motionTsx).toContain('livingSettleMs: 440');
    expect(motionTsx).toContain('duration: 320');
    expect(motionTsx).toContain('getAnimations');
  });

  it('28. Liquid Glass V12.7: Menú desplegable translúcido (Light/Dark + .mobile-menu-cta) y Header de escritorio Optical Glass', () => {
    expect(liquidCss).toContain('LIQUID GLASS V12.7 — OPTICAL GLASS NAVIGATION MENU & DESKTOP HEADER');
    expect(liquidCss).toContain('html[data-theme="light"] body.liquid-glass-active .mobile-menu');
    expect(liquidCss).toContain('html[data-theme="dark"] body.liquid-glass-active .mobile-menu');
    expect(liquidCss).toContain('backdrop-filter: blur(26px) saturate(145%) brightness(1.03) !important;');
    expect(liquidCss).toContain('backdrop-filter: blur(26px) saturate(135%) !important;');
    expect(liquidCss).toContain('html[data-theme="light"] body.liquid-glass-active .mobile-menu-cta .booking-menu-return:not(:disabled)');
    expect(liquidCss).toContain('html[data-theme="dark"] body.liquid-glass-active .mobile-menu-cta .booking-menu-return:not(:disabled)');
    expect(liquidCss).toContain('html[data-theme="light"] body.liquid-glass-active .site-header.liquid-glass-header:not(.menu-open)');
    expect(liquidCss).toContain('html[data-theme="dark"] body.liquid-glass-active .site-header.liquid-glass-header:not(.menu-open)');
    expect(liquidCss).toContain('backdrop-filter: blur(20px) saturate(145%) brightness(1.02) !important;');
    expect(liquidCss).toContain('backdrop-filter: blur(20px) saturate(135%) !important;');
  });

  it('29. Liquid Glass V12.8: Dark Mode negro profundo en cards, Light Mode menú/header translúcidos, geometría unificada Volver/Continuar (48px) y acentos KANI', () => {
    expect(liquidCss).toContain('LIQUID GLASS V12.8 — MATERIAL IDENTITY REFINEMENT · DARK GLASS & LIGHT TRANSPARENCY');
    expect(liquidCss).toContain('rgba(14, 14, 16, 0.68) 0%');
    expect(liquidCss).toContain('rgba(24, 22, 21, 0.84) 0%');
    expect(liquidCss).toContain('rgba(242, 237, 229, 0.40) 0%');
    expect(liquidCss).toContain('rgba(243, 238, 230, 0.38) 0%');
    expect(liquidCss).toContain('height: 48px !important;');
    expect(liquidCss).toContain('min-height: 48px !important;');
    expect(liquidCss).toContain('color: #a98440 !important;');
    expect(liquidCss).toContain('color: #d8ba7c !important;');
  });

  it('30. Liquid Glass V12.9: Avatares oscuros cálidos, selección persistente del calendario (focus/blur) y contraste cálido Light Mode', () => {
    expect(liquidCss).toContain('LIQUID GLASS V12.9 — WARM CRYSTAL CONSISTENCY · CALENDAR SELECTION · LIGHT MODE REFINEMENT');
    expect(liquidCss).toContain('.barber-avatar');
    expect(liquidCss).toContain('.barber-defer-mark');
    expect(liquidCss).toContain('rgba(248, 242, 231, 0.92)');
    expect(liquidCss).toContain('.calendar-day.selected:focus');
    expect(liquidCss).toContain('.calendar-day.selected:focus-visible');
    expect(liquidCss).toContain('rgba(242, 237, 229, 0.54)');
    expect(liquidCss).toContain('rgba(226, 217, 203, 0.92)');
  });
});

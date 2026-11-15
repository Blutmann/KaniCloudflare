// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { BookingConfirmedScreen } from '@/components/kani/booking-confirmed-screen';
import * as feedback from '@/components/kani/experimental/liquid-glass-feedback';

describe('KANI Liquid Glass V12.47.3 — Modales, Cargas y Confirmación', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.classList.add('liquid-glass-active');
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    document.body.classList.remove('liquid-glass-active');
    vi.clearAllMocks();
  });

  it('1. BookingConfirmedScreen monta con escenario óptico perla, pulso champagne y ejecuta playConfirmationChime exactamente una vez', async () => {
    const playSpy = vi.spyOn(feedback, 'playConfirmationChime');

    const confirmedData = {
      appointmentId: 'apt-v12-47-3-test-1234',
      serviceName: 'Corte y barba',
      barber: 'Lautaro',
      date: '2026-11-20',
      time: '15:30',
      clientName: 'Santiago Rossi',
      depositArs: 10000,
      servicePriceArs: 32000,
    };

    const { container, rerender } = render(
      <BookingConfirmedScreen confirmed={confirmedData} />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    // 1. Escenario y elementos de confirmación presentes
    const stage = container.querySelector('.liquid-glass-confirmed-stage') as HTMLElement;
    expect(stage).toBeTruthy();
    expect(stage.getAttribute('data-lg-confirmed')).toBe('true');

    const mark = container.querySelector('.liquid-glass-confirmation-mark') as HTMLElement;
    expect(mark).toBeTruthy();

    const aura = mark.querySelector('.lg-mark-aura') as HTMLElement;
    expect(aura).toBeTruthy();
    expect(aura.getAttribute('aria-hidden')).toBe('true');

    // 2. Chime ejecutado exactamente una vez al confirmar
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(playSpy).toHaveBeenCalledWith('apt-v12-47-3-test-1234', { enabled: true });

    // 3. Re-renderizado no duplica el sonido
    rerender(<BookingConfirmedScreen confirmed={confirmedData} />);
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('2. El CSS V12.47.3 garantiza nitidez absoluta en Payway (filter: none, isolation: isolate, z-index: 200) y desenfoque progresivo en overlay', () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), 'src/components/kani/experimental/liquid-glass.css'),
      'utf8',
    );

    expect(css).toContain('LIQUID GLASS V12.47.3 — MOTION SYSTEM II (MODALS, LOADING STATES & CONFIRMATION)');

    // Overlay con backdrop blur y z-index 190
    expect(css).toContain('html[data-theme] body.liquid-glass-active [data-slot="dialog-overlay"]');
    expect(css).toContain('z-index: 190 !important;');
    expect(css).toContain('backdrop-filter: blur(14px)');

    // Modal nítido: z-index 200, filter none, isolation isolate
    expect(css).toContain('html[data-theme] body.liquid-glass-active :is([data-slot="dialog-content"], .payway-checkout)');
    expect(css).toContain('z-index: 200 !important;');
    expect(css).toContain('filter: none !important;');
    expect(css).toContain('-webkit-filter: none !important;');
    expect(css).toContain('isolation: isolate !important;');

    // Animación de entrada con escala muy contenida (0.982 -> 1.0)
    expect(css).toContain('@keyframes lgModalOpticalEnter');
    expect(css).toContain('scale(0.982)');
    expect(css).toContain('@keyframes lgModalOpticalExit');

    // Responsive Mobile teclado virtual
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toMatch(/max-height:\s*min\((?:88dvh|92dvh)/);
    expect(css).toContain('overflow-y: auto !important;');
  });

  it('3. Refina estados de carga y mensajes informativos/error sin saltos de layout', () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), 'src/components/kani/experimental/liquid-glass.css'),
      'utf8',
    );

    // Indicador orgánico de carga de calendario
    expect(css).toContain('.calendar-loading-indicator');
    expect(css).toContain('animation: lgPulsingGlass 1400ms ease-in-out infinite;');

    // Mensajes de feedback (descuento aplicado y error)
    expect(css).toContain('.discount-applied-card');
    expect(css).toContain('animation: lgFeedbackEmerge 240ms cubic-bezier(0.22, 1, 0.36, 1) backwards;');
    expect(css).toContain('.discount-error-feedback');
    expect(css).toContain('animation: lgErrorFeedbackFade 200ms cubic-bezier(0.22, 1, 0.36, 1) backwards;');

    // Confirmación final con pulso champagne y aura única (sin confeti)
    expect(css).toContain('.liquid-glass-confirmation-mark');
    expect(css).toContain('animation: lgConfirmedMarkPulse 680ms cubic-bezier(0.22, 1, 0.36, 1) backwards;');
    expect(css).toContain('.lg-mark-aura');
    expect(css).toContain('animation: lgConfirmedAuraPulse 880ms cubic-bezier(0.22, 1, 0.36, 1) backwards;');
    expect(css).toContain('.liquid-glass-confirmed-stage .confirmation-details');
    expect(css).not.toContain('confetti');
  });

  it('4. Cumple rigurosamente prefers-reduced-motion en modales y confirmación final', () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), 'src/components/kani/experimental/liquid-glass.css'),
      'utf8',
    );

    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.liquid-glass-confirmed-stage[\s\S]*animation: none !important;/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.payway-checkout[\s\S]*animation: none !important;/,
    );
  });
});

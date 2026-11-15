// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { useState } from 'react';

const motionMock = vi.hoisted(() => ({
  reduced: false,
}));

vi.mock('motion/react', async () => {
  const actual = await vi.importActual<typeof import('motion/react')>('motion/react');
  return {
    ...actual,
    useReducedMotion: () => motionMock.reduced,
  };
});

import {
  LIQUID_GLASS_MOTION,
  LiquidGlassMotionProvider,
  liquidGlassMotionAdapter,
} from '@/components/kani/experimental/liquid-glass-motion';

function ServiceAndBarberHarness() {
  const [selectedService, setSelectedService] = useState<string>('corte');
  const [selectedBarber, setSelectedBarber] = useState<string | null>(null);
  const Card = liquidGlassMotionAdapter.InteractiveCard;

  return (
    <LiquidGlassMotionProvider>
      <div className="liquid-glass-reservation" data-services-variant="a">
        <div className="booking-page">
          <div className="booking-service-options">
            {['corte', 'barba'].map((id) => (
              <Card
                key={id}
                className={`booking-option service-option ${selectedService === id ? 'selected' : ''}`}
                onClick={() => setSelectedService(id)}
              >
                <span className="booking-option-name">{id}</span>
              </Card>
            ))}
          </div>
          <div className={`booking-barber-options ${selectedBarber ? 'has-selected-barber' : ''}`}>
            {['Lautaro', 'Gonzalo'].map((name) => (
              <Card
                key={name}
                className={`booking-option ${selectedBarber === name ? 'selected' : ''}`}
                onClick={() => setSelectedBarber(name)}
              >
                <span className="barber-avatar">{name.charAt(0)}</span>
                <span className="booking-barber-name">{name}</span>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </LiquidGlassMotionProvider>
  );
}

describe('Liquid Glass V12.46 — Liquid Glass Motion System (Servicio & Barbero)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    motionMock.reduced = false;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('aplica coreografías distintas para Servicio (compresión + recuperación elástica + reflejo/borde) y Barbero (iluminación + halo + jerarquía)', () => {
    const animateMock = vi.fn(() => ({
      cancel: vi.fn(),
      finished: Promise.resolve(),
    }));
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: animateMock,
    });

    render(<ServiceAndBarberHarness />);

    const barbaBtn = screen.getByRole('button', { name: 'barba' });
    fireEvent.pointerDown(barbaBtn, { clientX: 40, clientY: 20 });

    // Servicio comprime suavemente al presionar (0.986) sin onda circular genérica
    expect(animateMock).toHaveBeenCalledWith(
      [{ transform: 'scale(1)' }, { transform: `scale(${LIQUID_GLASS_MOTION.scales.serviceCardTap})` }],
      expect.objectContaining({
        duration: LIQUID_GLASS_MOTION.v46.servicePressMs,
        fill: 'forwards',
      }),
    );

    animateMock.mockClear();
    fireEvent.pointerUp(barbaBtn);
    fireEvent.click(barbaBtn);

    // Recuperación elástica controlada sin transform persistente (fill: 'none')
    expect(animateMock).toHaveBeenCalledWith(
      [
        { transform: `scale(${LIQUID_GLASS_MOTION.scales.serviceCardTap})` },
        { transform: `scale(${LIQUID_GLASS_MOTION.v46.serviceOvershootScale})`, offset: 0.56 },
        { transform: 'scale(1)' },
      ],
      expect.objectContaining({
        duration: LIQUID_GLASS_MOTION.v46.serviceRecoverMs,
        fill: 'none',
      }),
    );
    expect(barbaBtn.getAttribute('data-lg-motion')).toBe('service-select');
    expect(barbaBtn.hasAttribute('data-lg-ripple')).toBe(false);

    act(() => {
      vi.advanceTimersByTime(LIQUID_GLASS_MOTION.v46.serviceMotionMs + 20);
    });
    expect(barbaBtn.getAttribute('data-lg-motion')).toBeNull();

    // Barbero: no ejecuta compresión elástica en la tarjeta; activa barber-select + has-selected-barber
    animateMock.mockClear();
    const lautaroBtn = screen.getByRole('button', { name: 'L Lautaro' });
    const gonzaloBtn = screen.getByRole('button', { name: 'G Gonzalo' });
    fireEvent.pointerDown(lautaroBtn, { clientX: 50, clientY: 50 });

    // Solo core bloom sutil (no wave expansivo ni scale sobre botón de barbero)
    const buttonCalls = animateMock.mock.calls.filter(
      (call) => Array.isArray(call[0]) && call[0].some((frame: any) => 'transform' in frame && String(frame.transform).startsWith('scale(')),
    );
    expect(buttonCalls).toHaveLength(0);

    fireEvent.click(lautaroBtn);
    expect(lautaroBtn.getAttribute('data-lg-motion')).toBe('barber-select');
    expect(lautaroBtn.className).toContain('selected');
    expect(gonzaloBtn.className).not.toContain('selected');
    expect(lautaroBtn.parentElement?.className).toContain('has-selected-barber');

    act(() => {
      vi.advanceTimersByTime(LIQUID_GLASS_MOTION.v46.barberMotionMs + 20);
    });
    expect(lautaroBtn.getAttribute('data-lg-motion')).toBeNull();
  });

  it('respeta prefers-reduced-motion desactivando animaciones JS y CSS sin bloquear la selección', () => {
    motionMock.reduced = true;
    const animateMock = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: animateMock,
    });

    render(<ServiceAndBarberHarness />);
    const barbaBtn = screen.getByRole('button', { name: 'barba' });
    fireEvent.pointerDown(barbaBtn);
    fireEvent.click(barbaBtn);

    expect(barbaBtn.className).toContain('selected');
    expect(barbaBtn.getAttribute('data-lg-motion')).toBeNull();
    expect(animateMock).not.toHaveBeenCalled();

    const css = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/kani/experimental/liquid-glass.css'),
      'utf8',
    );
    const v46Css = css.slice(css.indexOf('LIQUID GLASS V12.46'));
    expect(v46Css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(v46Css).toContain('@keyframes kaniServiceSheenV46');
    expect(v46Css).toContain('@keyframes kaniServiceBorderGlowV46');
    expect(v46Css).toContain('@keyframes kaniBarberLuminescenceV46');
    expect(v46Css).toContain('@keyframes kaniBarberAvatarHaloV46');
    expect(v46Css).not.toContain('infinite');
    expect(v46Css).not.toMatch(/\.service-option:not\(:disabled\)\s*\{[^}]*transform:\s*none\s*!important/);
    expect(css).not.toContain('translate3d(0, -1px, 0) !important');
  });

  it('mantiene aislada la ruta tradicional sin reglas V12.46 ni has-selected-barber fuera de experimentalMotion', () => {
    const stylesCss = fs.readFileSync(path.resolve(process.cwd(), 'src/styles.css'), 'utf8');
    const bookingTsx = fs.readFileSync(path.resolve(process.cwd(), 'src/components/kani/booking.tsx'), 'utf8');

    expect(stylesCss).not.toContain('LIQUID GLASS V12.46');
    expect(stylesCss).not.toContain('has-selected-barber');
    expect(bookingTsx).toContain("experimentalMotion && barber && !barberDeferred ? ' has-selected-barber' : ''");
  });
});

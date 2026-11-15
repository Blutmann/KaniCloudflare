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
import {
  __resetLiquidGlassFeedbackForTests,
  hasPlayedConfirmationSound,
  playConfirmationChime,
  readConfirmationSoundEnabled,
  triggerSelectionHaptic,
  writeConfirmationSoundEnabled,
} from '@/components/kani/experimental/liquid-glass-feedback';

function BookingMotionHarness() {
  const [selectedService, setSelectedService] = useState<string>('corte');
  const [selectedBarber, setSelectedBarber] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
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
          <div className="calendar-glass-card">
            <div className="calendar-grid">
              {['2026-11-16', '2026-11-17'].map((iso) => (
                <Card
                  key={iso}
                  tapScale={0.94}
                  className={`calendar-day ${selectedDate === iso ? 'selected' : ''}`}
                  onClick={() => setSelectedDate(iso)}
                >
                  {iso.slice(-2)}
                </Card>
              ))}
            </div>
          </div>
          <div className="booking-time-grid">
            {['10:00', '10:45'].map((slot) => (
              <Card
                key={slot}
                tapScale={0.98}
                className={`booking-time-slot h-12 ${selectedTime === slot ? 'selected' : ''}`}
                onClick={() => setSelectedTime(slot)}
              >
                <span className="booking-time-slot-value">{slot}</span>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </LiquidGlassMotionProvider>
  );
}

describe('Liquid Glass V12.46.1 — Liquid Glass Motion System (Servicio, Barbero, Fecha y Horario)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    motionMock.reduced = false;
    window.localStorage.clear();
    window.sessionStorage.clear();
    __resetLiquidGlassFeedbackForTests();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('aplica coreografías ópticas diferenciadas para Servicio, Barbero (conservado), Fecha y Horario sin transforms persistentes', () => {
    const animateMock = vi.fn(() => ({
      cancel: vi.fn(),
      finished: Promise.resolve(),
    }));
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: animateMock,
    });

    render(<BookingMotionHarness />);

    // 1. Servicio: compresión táctil perceptible (0.966) + recuperación elástica sin transform persistente
    const corteBtn = screen.getByRole('button', { name: 'corte' });
    const barbaBtn = screen.getByRole('button', { name: 'barba' });
    fireEvent.pointerDown(barbaBtn, { clientX: 40, clientY: 20 });

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

    expect(animateMock).toHaveBeenCalledWith(
      [
        { transform: 'scale(0.992)' },
        { transform: `scale(${LIQUID_GLASS_MOTION.scales.serviceCardTap})`, offset: 0.2 },
        { transform: `scale(${LIQUID_GLASS_MOTION.v46.serviceOvershootScale})`, offset: 0.6 },
        { transform: 'scale(1)' },
      ],
      expect.objectContaining({
        duration: LIQUID_GLASS_MOTION.v46.serviceRecoverMs,
        fill: 'none',
      }),
    );
    expect(barbaBtn.getAttribute('data-lg-motion')).toBe('service-select');
    expect(barbaBtn.hasAttribute('data-lg-ripple')).toBe(false);

    // Interacción rápida: cambiar a otro servicio limpia de inmediato data-lg-motion de la tarjeta anterior
    fireEvent.click(corteBtn);
    expect(barbaBtn.getAttribute('data-lg-motion')).toBeNull();
    expect(corteBtn.getAttribute('data-lg-motion')).toBe('service-select');

    act(() => {
      vi.advanceTimersByTime(LIQUID_GLASS_MOTION.v46.serviceMotionMs + 20);
    });
    expect(corteBtn.getAttribute('data-lg-motion')).toBeNull();

    // 2. Barbero (conservado intacto): sin rebote de escala en tarjeta + barber-select + has-selected-barber
    animateMock.mockClear();
    const lautaroBtn = screen.getByRole('button', { name: 'L Lautaro' });
    const gonzaloBtn = screen.getByRole('button', { name: 'G Gonzalo' });
    fireEvent.pointerDown(lautaroBtn, { clientX: 50, clientY: 50 });

    const buttonScaleCalls = animateMock.mock.calls.filter(
      (call) => Array.isArray(call[0]) && call[0].some((frame: any) => 'transform' in frame && String(frame.transform).startsWith('scale(')),
    );
    expect(buttonScaleCalls).toHaveLength(0);

    fireEvent.click(lautaroBtn);
    expect(lautaroBtn.getAttribute('data-lg-motion')).toBe('barber-select');
    expect(lautaroBtn.className).toContain('selected');
    expect(gonzaloBtn.className).not.toContain('selected');
    expect(lautaroBtn.parentElement?.className).toContain('has-selected-barber');

    act(() => {
      vi.advanceTimersByTime(LIQUID_GLASS_MOTION.v46.barberMotionMs + 20);
    });
    expect(lautaroBtn.getAttribute('data-lg-motion')).toBeNull();

    // 3. Fecha: pulso breve preciso de celda + day-select + transición limpia al cambiar fecha
    animateMock.mockClear();
    const day16Btn = screen.getByRole('button', { name: '16' });
    const day17Btn = screen.getByRole('button', { name: '17' });
    fireEvent.pointerDown(day16Btn, { clientX: 20, clientY: 20 });
    expect(animateMock).toHaveBeenCalledWith(
      [{ transform: 'scale(1)' }, { transform: `scale(${LIQUID_GLASS_MOTION.v46.dayTapScale})` }],
      expect.objectContaining({
        duration: LIQUID_GLASS_MOTION.v46.dayPressMs,
        fill: 'forwards',
      }),
    );

    fireEvent.pointerUp(day16Btn);
    fireEvent.click(day16Btn);
    expect(day16Btn.getAttribute('data-lg-motion')).toBe('day-select');
    fireEvent.click(day17Btn);
    expect(day16Btn.getAttribute('data-lg-motion')).toBeNull();
    expect(day17Btn.getAttribute('data-lg-motion')).toBe('day-select');

    act(() => {
      vi.advanceTimersByTime(LIQUID_GLASS_MOTION.v46.dayMotionMs + 20);
    });
    expect(day17Btn.getAttribute('data-lg-motion')).toBeNull();

    // 4. Horario: más rápido y enérgico que Servicio + slot-select + fill: 'none'
    expect(LIQUID_GLASS_MOTION.v46.slotRecoverMs).toBeLessThan(LIQUID_GLASS_MOTION.v46.serviceRecoverMs);
    expect(LIQUID_GLASS_MOTION.v46.slotOvershootScale).toBeGreaterThan(LIQUID_GLASS_MOTION.v46.serviceOvershootScale);

    animateMock.mockClear();
    const slot1000Btn = screen.getByRole('button', { name: '10:00' });
    const slot1045Btn = screen.getByRole('button', { name: '10:45' });
    fireEvent.pointerDown(slot1000Btn, { clientX: 30, clientY: 16 });
    expect(animateMock).toHaveBeenCalledWith(
      [{ transform: 'scale(1)' }, { transform: `scale(${LIQUID_GLASS_MOTION.v46.slotTapScale})` }],
      expect.objectContaining({
        duration: LIQUID_GLASS_MOTION.v46.slotPressMs,
        fill: 'forwards',
      }),
    );

    animateMock.mockClear();
    fireEvent.pointerUp(slot1000Btn);
    fireEvent.click(slot1000Btn);
    expect(animateMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        { transform: `scale(${LIQUID_GLASS_MOTION.v46.slotTapScale})`, offset: 0.2 },
        { transform: `scale(${LIQUID_GLASS_MOTION.v46.slotOvershootScale})`, offset: 0.6 },
        { transform: 'scale(1)' },
      ]),
      expect.objectContaining({
        duration: LIQUID_GLASS_MOTION.v46.slotRecoverMs,
        fill: 'none',
      }),
    );
    expect(slot1000Btn.getAttribute('data-lg-motion')).toBe('slot-select');

    fireEvent.click(slot1045Btn);
    expect(slot1000Btn.getAttribute('data-lg-motion')).toBeNull();
    expect(slot1045Btn.getAttribute('data-lg-motion')).toBe('slot-select');

    act(() => {
      vi.advanceTimersByTime(LIQUID_GLASS_MOTION.v46.slotMotionMs + 20);
    });
    expect(slot1045Btn.getAttribute('data-lg-motion')).toBeNull();
  });

  it('respeta prefers-reduced-motion y define keyframes ópticos finitos para Servicio, Barbero, Fecha y Horario', () => {
    motionMock.reduced = true;
    const animateMock = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: animateMock,
    });

    render(<BookingMotionHarness />);
    const barbaBtn = screen.getByRole('button', { name: 'barba' });
    const day16Btn = screen.getByRole('button', { name: '16' });
    const slot1000Btn = screen.getByRole('button', { name: '10:00' });

    fireEvent.pointerDown(barbaBtn);
    fireEvent.click(barbaBtn);
    fireEvent.click(day16Btn);
    fireEvent.click(slot1000Btn);

    expect(barbaBtn.className).toContain('selected');
    expect(day16Btn.className).toContain('selected');
    expect(slot1000Btn.className).toContain('selected');
    expect(barbaBtn.getAttribute('data-lg-motion')).toBeNull();
    expect(day16Btn.getAttribute('data-lg-motion')).toBeNull();
    expect(slot1000Btn.getAttribute('data-lg-motion')).toBeNull();
    expect(animateMock).not.toHaveBeenCalled();

    const css = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/kani/experimental/liquid-glass.css'),
      'utf8',
    );
    const v46Css = css.slice(css.indexOf('LIQUID GLASS V12.46.1'));
    expect(v46Css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(v46Css).toContain('@keyframes kaniServiceRefractionV461');
    expect(v46Css).toContain('@keyframes kaniServiceEdgeRevealV461');
    expect(v46Css).toContain('@keyframes kaniBarberLuminescenceV46');
    expect(v46Css).toContain('@keyframes kaniBarberAvatarHaloV46');
    expect(v46Css).toContain('@keyframes kaniDayContourPulseV461');
    expect(v46Css).toContain('@keyframes kaniSlotCenterExpandV461');
    expect(v46Css).toContain('@keyframes kaniSlotEdgeSpreadV461');
    expect(v46Css).not.toContain('infinite');
    expect(css).not.toContain('translate3d(0, -1px, 0) !important');
  });

  it('mantiene aislada la ruta tradicional sin reglas V12.46 ni has-selected-barber fuera de experimentalMotion', () => {
    const stylesCss = fs.readFileSync(path.resolve(process.cwd(), 'src/styles.css'), 'utf8');
    const bookingTsx = fs.readFileSync(path.resolve(process.cwd(), 'src/components/kani/booking.tsx'), 'utf8');
    const paywayTsx = fs.readFileSync(path.resolve(process.cwd(), 'src/components/kani/experimental/payway-booking.tsx'), 'utf8');

    expect(stylesCss).not.toContain('LIQUID GLASS V12.46');
    expect(stylesCss).not.toContain('has-selected-barber');
    expect(bookingTsx).toContain("experimentalMotion && barber && !barberDeferred ? ' has-selected-barber' : ''");
    expect(bookingTsx).toContain('if (!isSelected) chooseBarber(b)');
    expect(bookingTsx).toContain('if (selectedSlot === time) return');
    expect(paywayTsx).toContain('if (!isLiquid || !soundEnabledRef.current) return');
  });

  it('V12.46.2: ejecuta microinteracción de confirmación al repulsar opciones ya seleccionadas en Servicio, Barbero, Fecha y Horario sin acumular animaciones', () => {
    const cancelSpy = vi.fn();
    const animateMock = vi.fn(() => ({
      cancel: cancelSpy,
      finished: Promise.resolve(),
    }));
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: animateMock,
    });

    const vibrateMock = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      writable: true,
      value: vibrateMock,
    });

    render(<BookingMotionHarness />);

    const corteBtn = screen.getByRole('button', { name: 'corte' });
    const lautaroBtn = screen.getByRole('button', { name: 'L Lautaro' });
    const day16Btn = screen.getByRole('button', { name: '16' });
    const slot1000Btn = screen.getByRole('button', { name: '10:00' });

    // Seleccionar Barbero, Fecha y Horario primero (corte ya arranca seleccionado)
    fireEvent.click(lautaroBtn);
    fireEvent.click(day16Btn);
    fireEvent.click(slot1000Btn);
    act(() => {
      vi.advanceTimersByTime(800);
    });

    const targets = [
      { btn: corteBtn, tag: 'service-reconfirm', scale: LIQUID_GLASS_MOTION.v46.serviceReconfirmScale, ms: LIQUID_GLASS_MOTION.v46.serviceReconfirmMs },
      { btn: lautaroBtn, tag: 'barber-reconfirm', scale: LIQUID_GLASS_MOTION.v46.barberReconfirmScale, ms: LIQUID_GLASS_MOTION.v46.barberReconfirmMs },
      { btn: day16Btn, tag: 'day-reconfirm', scale: LIQUID_GLASS_MOTION.v46.dayReconfirmScale, ms: LIQUID_GLASS_MOTION.v46.dayReconfirmMs },
      { btn: slot1000Btn, tag: 'slot-reconfirm', scale: LIQUID_GLASS_MOTION.v46.slotReconfirmScale, ms: LIQUID_GLASS_MOTION.v46.slotReconfirmMs },
    ] as const;

    for (const target of targets) {
      animateMock.mockClear();
      vibrateMock.mockClear();
      fireEvent.pointerDown(target.btn, { clientX: 24, clientY: 18 });
      expect(animateMock).toHaveBeenCalledWith(
        [{ transform: 'scale(1)' }, { transform: `scale(${target.scale})` }],
        expect.objectContaining({ fill: 'forwards' }),
      );
      fireEvent.pointerUp(target.btn);
      fireEvent.click(target.btn);
      expect(target.btn.getAttribute('data-lg-motion')).toBe(target.tag);
      expect(vibrateMock).toHaveBeenCalledWith(6);

      // Repetición rápida cancela animación previa sin acumular
      fireEvent.pointerDown(target.btn, { clientX: 24, clientY: 18 });
      expect(cancelSpy).toHaveBeenCalled();
      fireEvent.pointerUp(target.btn);
      fireEvent.click(target.btn);
      expect(target.btn.getAttribute('data-lg-motion')).toBe(target.tag);

      act(() => {
        vi.advanceTimersByTime(target.ms + 20);
      });
      expect(target.btn.getAttribute('data-lg-motion')).toBeNull();
    }
  });

  it('V12.46.2: limpia artefactos de arranque en Horario Dark Mode y aplica háptica y sonido opt-in solo en confirmación verificada', () => {
    const css = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/kani/experimental/liquid-glass.css'),
      'utf8',
    );
    const v46Css = css.slice(css.indexOf('LIQUID GLASS V12.46.1'));
    expect(v46Css).toContain('--lg-v46-slot-core');
    expect(v46Css).toContain('@keyframes kaniReconfirmEdgeV462');
    expect(v46Css).toContain('@keyframes kaniDayReconfirmContourV462');
    expect(v46Css).not.toContain('inset(0 46% 0 46% round 12px)');
    const slotCoreMatch = v46Css.match(/@keyframes kaniSlotCenterCoreV461\s*\{\s*0%\s*\{\s*opacity:\s*0;/);
    expect(slotCoreMatch).not.toBeNull();

    // Háptica respeta reduced motion
    const vibrateMock = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      writable: true,
      value: vibrateMock,
    });
    expect(triggerSelectionHaptic('select', true)).toBe(false);
    expect(vibrateMock).not.toHaveBeenCalled();
    expect(triggerSelectionHaptic('select', false)).toBe(true);
    expect(vibrateMock).toHaveBeenCalledWith(10);

    // Sonido desactivado por defecto y sintetizado cálido/extendido (~515ms) solo al activarse + 1 vez por reserva
    const createdOscillators: Array<{ duration: number }> = [];
    const lowpassFreqCalls: Array<{ fn: string; value: number }> = [];
    class FakeAudioContext {
      state = 'running';
      currentTime = 1.0;
      destination = {};
      resume = vi.fn().mockResolvedValue(undefined);
      createBiquadFilter() {
        return {
          type: 'lowpass',
          frequency: {
            setValueAtTime: (value: number) => lowpassFreqCalls.push({ fn: 'set', value }),
            exponentialRampToValueAtTime: (value: number) => lowpassFreqCalls.push({ fn: 'ramp', value }),
          },
          Q: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
        };
      }
      createGain() {
        return {
          gain: {
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
        };
      }
      createOscillator() {
        let started = 0;
        return {
          type: 'sine',
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: (when = 0) => {
            started = when;
          },
          stop: (when = 0) => {
            createdOscillators.push({ duration: when - started });
          },
        };
      }
    }
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      writable: true,
      value: FakeAudioContext,
    });

    expect(readConfirmationSoundEnabled()).toBe(false);
    expect(playConfirmationChime('apt-1')).toBe(false);
    expect(createdOscillators).toHaveLength(0);

    writeConfirmationSoundEnabled(true);
    expect(readConfirmationSoundEnabled()).toBe(true);
    expect(playConfirmationChime('apt-1')).toBe(true);
    expect(createdOscillators).toHaveLength(3);
    for (const osc of createdOscillators) {
      expect(osc.duration).toBeGreaterThanOrEqual(0.34);
      expect(osc.duration).toBeLessThanOrEqual(0.52);
    }
    expect(lowpassFreqCalls).toEqual([
      { fn: 'set', value: 2600 },
      { fn: 'ramp', value: 1400 },
    ]);

    // Nunca se repite para una reserva ya confirmada
    expect(hasPlayedConfirmationSound('apt-1')).toBe(true);
    const countBeforeRepeat = createdOscillators.length;
    expect(playConfirmationChime('apt-1')).toBe(false);
    expect(createdOscillators).toHaveLength(countBeforeRepeat);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import type { ComponentProps } from 'react';

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

const mocks = vi.hoisted(() => ({
  readPublicBookingBarbers: vi.fn(),
  readPublicAvailabilityStarts: vi.fn(),
  readConfiguredServices: vi.fn(),
}));

vi.mock('@/lib/kani-availability', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/kani-availability')>();
  return {
    ...actual,
    readPublicBookingBarbers: (...args: unknown[]) => mocks.readPublicBookingBarbers(...args),
    readPublicAvailabilityStarts: (...args: unknown[]) => mocks.readPublicAvailabilityStarts(...args),
    readConfiguredServices: (...args: unknown[]) => mocks.readConfiguredServices(...args),
  };
});

import { Booking } from '@/components/kani/booking';
import { KaniProvider } from '@/components/kani/store';
import {
  LIQUID_GLASS_MOTION,
  LiquidGlassMotionProvider,
  liquidGlassMotionAdapter,
  resolveStepTransitionPair,
  resolveStepTransitionSpec,
} from '@/components/kani/experimental/liquid-glass-motion';

function futureIsoDate(daysAhead: number): string {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead);
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const TEST_DATE = futureIsoDate(2);
const TEST_DATE_2 = futureIsoDate(3);

function renderLiquidFlow(props: Partial<ComponentProps<typeof Booking>> = {}) {
  return render(
    <KaniProvider>
      <LiquidGlassMotionProvider>
        <div className="liquid-glass-reservation" data-services-variant="a">
          <Booking
            variant="v5"
            experimentalMotion={liquidGlassMotionAdapter}
            {...props}
          />
        </div>
      </LiquidGlassMotionProvider>
    </KaniProvider>,
  );
}

describe('KANI Liquid Glass V12.47.2 — Motion System II (Refined Transitions & Overlap)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    motionMock.reduced = false;
    document.body.classList.add('liquid-glass-active');
    Element.prototype.scrollTo = vi.fn();
    window.scrollTo = vi.fn();

    mocks.readPublicBookingBarbers.mockResolvedValue(
      ['Lautaro', 'Gonzalo'].map(name => ({ id: name, name })),
    );
    mocks.readConfiguredServices.mockResolvedValue([
      { id: 'corte', name: 'Corte', duration: 30, price: 22000 },
      { id: 'corte-barba', name: 'Corte y barba', duration: 45, price: 32000 },
      { id: 'barba', name: 'Barba', duration: 25, price: 18000 },
    ]);
    mocks.readPublicAvailabilityStarts.mockResolvedValue([
      {
        barber_id: 'Lautaro',
        slot_date: TEST_DATE,
        barber_name: 'Lautaro',
        start_time: '14:30',
        is_exception: false,
        compatible_services: ['Corte', 'Corte y barba', 'Barba'],
      },
      {
        barber_id: 'Lautaro',
        slot_date: TEST_DATE,
        barber_name: 'Lautaro',
        start_time: '15:15',
        is_exception: false,
        compatible_services: ['Corte', 'Corte y barba', 'Barba'],
      },
      {
        barber_id: 'Lautaro',
        slot_date: TEST_DATE_2,
        barber_name: 'Lautaro',
        start_time: '16:00',
        is_exception: false,
        compatible_services: ['Corte', 'Corte y barba', 'Barba'],
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    document.body.classList.remove('liquid-glass-active');
    vi.clearAllMocks();
  });

  it('1. Especifica coreografías diferenciadas por transición (0↔1, 1↔2, 2↔3, 3↔4) en rangos 220–300ms', () => {
    const p01 = resolveStepTransitionSpec(0, 1, 1);
    const p12 = resolveStepTransitionSpec(1, 2, 1);
    const p23 = resolveStepTransitionSpec(2, 3, 1);
    const p34 = resolveStepTransitionSpec(3, 4, 1);

    expect(p01.pair).toBe('service-barber');
    expect(p12.pair).toBe('barber-date');
    expect(p23.pair).toBe('date-time');
    expect(p34.pair).toBe('time-contact');

    // Cada transición tiene personalidad kinética distinta y dentro del presupuesto calibrado
    expect(p01.enterX).toBeGreaterThan(p12.enterX);
    expect(p12.enterY).toBeGreaterThan(p34.enterY);
    expect(p34.enterDuration).toBeLessThan(p01.enterDuration);

    for (const spec of [p01, p12, p23, p34]) {
      expect(spec.enterDuration).toBeGreaterThanOrEqual(0.22);
      expect(spec.enterDuration).toBeLessThanOrEqual(0.35);
      expect(spec.exitDuration).toBeGreaterThanOrEqual(0.15);
      expect(spec.exitDuration).toBeLessThanOrEqual(0.25);
    }

    // Regreso con dirección inversa coherente y levemente más ágil
    const b10 = resolveStepTransitionSpec(1, 0, -1);
    const b21 = resolveStepTransitionSpec(2, 1, -1);
    const b32 = resolveStepTransitionSpec(3, 2, -1);
    const b43 = resolveStepTransitionSpec(4, 3, -1);

    expect(b10.pair).toBe('service-barber');
    expect(b10.enterX).toBeLessThan(0);
    expect(b21.pair).toBe('barber-date');
    expect(b21.enterY).toBeLessThan(0);
    expect(b32.pair).toBe('date-time');
    expect(b43.pair).toBe('time-contact');
    expect(b10.enterDuration).toBeLessThan(p01.enterDuration);

    // El adaptador sincroniza exactamente en milisegundos con resolveStepTransitionSpec
    expect(liquidGlassMotionAdapter.getStepTransitionDurationMs?.(0, 1, 1)).toBe(300);
    expect(liquidGlassMotionAdapter.getStepTransitionDurationMs?.(1, 2, 1)).toBe(280);
    expect(liquidGlassMotionAdapter.getStepTransitionDurationMs?.(2, 3, 1)).toBe(260);
    expect(liquidGlassMotionAdapter.getStepTransitionDurationMs?.(3, 4, 1)).toBe(240);

    // No modifica las constantes V12.46 aprobadas
    expect(LIQUID_GLASS_MOTION.v46.barberMotionMs).toBe(640);
    expect(LIQUID_GLASS_MOTION.v46.serviceMotionMs).toBe(680);
  });

  it('2. Coordina StepperLens y --lg-step-sync-ms en cada transición hacia adelante y atrás, y se asienta sin transforms residuales', async () => {
    const { container } = renderLiquidFlow({
      initialStep: 0,
      initialService: 'corte',
    });

    await act(async () => {
      await Promise.resolve();
    });

    // Carga inicial: sin animación bloqueante, ya asentado
    const initialStage = container.querySelector('.liquid-glass-step-stage[data-lg-step="0"]') as HTMLElement;
    expect(initialStage).toBeTruthy();
    expect(initialStage.getAttribute('data-lg-step-state')).toBe('settled');
    expect(container.querySelector('.lg-step-optical-veil')).toBeNull();

    // Paso 0 -> 1 (Servicio -> Barbero)
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

    const progress = container.querySelector('.booking-progress') as HTMLElement;
    expect(progress.style.getPropertyValue('--lg-step-sync-ms')).toBe('300ms');

    const lens = container.querySelector('.liquid-glass-stepper-lens') as HTMLElement;
    expect(lens).toBeTruthy();
    expect(lens.getAttribute('data-lg-step-pair')).toBe('service-barber');

    const stage1 = container.querySelector('.liquid-glass-step-stage[data-lg-step="1"]') as HTMLElement;
    expect(stage1).toBeTruthy();
    expect(stage1.getAttribute('data-lg-step-pair')).toBe('service-barber');
    expect(stage1.getAttribute('data-lg-step-dir')).toBe('forward');
    expect(stage1.getAttribute('data-lg-step-state')).toBe('entering');
    expect(stage1.querySelector('.lg-step-optical-veil')).toBeTruthy();

    // Asentamiento limpia veil y cualquier transform inline residual
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(stage1.getAttribute('data-lg-step-state')).toBe('settled');
    expect(stage1.style.transform).toBe('');
    expect(stage1.querySelector('.lg-step-optical-veil')).toBeNull();

    // Regreso Paso 1 -> 0 («Volver») manteniendo el servicio seleccionado sin re-disparar V12.46
    fireEvent.click(screen.getByRole('button', { name: /Volver/i }));
    expect(progress.style.getPropertyValue('--lg-step-sync-ms')).toBe('280ms');

    const stage0Back = container.querySelector('.liquid-glass-step-stage[data-lg-step="0"]') as HTMLElement;
    expect(stage0Back.getAttribute('data-lg-step-pair')).toBe('service-barber');
    expect(stage0Back.getAttribute('data-lg-step-dir')).toBe('backward');

    const selectedServiceCard = screen.getByRole('button', { name: /Corte, 30 minutos/i });
    expect(selectedServiceCard.className).toContain('selected');
    expect(selectedServiceCard.getAttribute('data-lg-motion')).toBeNull();
  });

  it('3. Conserva selecciones, no re-dispara halo del barbero al volver de Fecha, y respeta scroll estable', async () => {
    const { container } = renderLiquidFlow({
      initialStep: 1,
      initialService: 'corte',
      initialBarber: 'Lautaro',
      initialDate: TEST_DATE,
      initialTime: '14:30',
      initialContact: { name: 'Tomas', email: 'tomas@example.com', phone: '+5491133445566', notes: 'Cabello corto' },
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Avanzar 1 -> 2 (Barbero -> Fecha)
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));
    const progress = container.querySelector('.booking-progress') as HTMLElement;
    expect(progress.style.getPropertyValue('--lg-step-sync-ms')).toBe('280ms');

    const stage2 = container.querySelector('.liquid-glass-step-stage[data-lg-step="2"]') as HTMLElement;
    expect(stage2.getAttribute('data-lg-step-pair')).toBe('barber-date');

    act(() => {
      vi.advanceTimersByTime(360);
    });

    // Avanzar 2 -> 3 (Fecha -> Horario)
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));
    expect(progress.style.getPropertyValue('--lg-step-sync-ms')).toBe('260ms');
    const stage3 = container.querySelector('.liquid-glass-step-stage[data-lg-step="3"]') as HTMLElement;
    expect(stage3.getAttribute('data-lg-step-pair')).toBe('date-time');
    expect(stage3.querySelector('.booking-time-heading-date')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(340);
    });

    // Avanzar 3 -> 4 (Horario -> Datos)
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));
    expect(progress.style.getPropertyValue('--lg-step-sync-ms')).toBe('240ms');
    const stage4 = container.querySelector('.liquid-glass-step-stage[data-lg-step="4"]') as HTMLElement;
    expect(stage4.getAttribute('data-lg-step-pair')).toBe('time-contact');

    const nameInput = screen.getByDisplayValue('Tomas') as HTMLInputElement;
    const emailInput = screen.getByDisplayValue('tomas@example.com') as HTMLInputElement;
    expect(nameInput.value).toBe('Tomas');
    expect(emailInput.value).toBe('tomas@example.com');

    // Volver hasta Barbero (4 -> 3 -> 2 -> 1) preservando datos y sin data-lg-motion en barbero seleccionado
    fireEvent.click(screen.getByRole('button', { name: /Volver/i }));
    expect(progress.style.getPropertyValue('--lg-step-sync-ms')).toBe('230ms');
    fireEvent.click(screen.getByRole('button', { name: /Volver/i }));
    expect(progress.style.getPropertyValue('--lg-step-sync-ms')).toBe('250ms');
    fireEvent.click(screen.getByRole('button', { name: /Volver/i }));
    expect(progress.style.getPropertyValue('--lg-step-sync-ms')).toBe('260ms');

    const lautaroCard = screen.getByRole('button', { name: /Barbero Lautaro, seleccionado/i });
    expect(lautaroCard.getAttribute('data-lg-motion')).toBeNull();
    // Si window estaba en y = 0, no fuerza saltos innecesarios de window.scrollTo
    expect(window.scrollTo).not.toHaveBeenCalled();

    act(() => {
      vi.runOnlyPendingTimers();
    });
  });

  it('4. Soporta saltos directos del stepper, taps rápidos sin bloqueo y prefers-reduced-motion', async () => {
    motionMock.reduced = true;
    const { container, unmount } = renderLiquidFlow({
      initialStep: 2,
      initialService: 'corte',
      initialBarber: 'Lautaro',
      initialDate: TEST_DATE,
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Con prefers-reduced-motion: reduce, no monta veil óptico y el estado es 'reduced'
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));
    const reducedStage = container.querySelector('.liquid-glass-step-stage[data-lg-step="3"]') as HTMLElement;
    expect(reducedStage).toBeTruthy();
    expect(reducedStage.getAttribute('data-lg-step-state')).toBe('reduced');
    expect(container.querySelector('.lg-step-optical-veil')).toBeNull();
    unmount();

    // Tap rápido inverso por stepper al paso 0 ("jump") no rompe el escenario
    motionMock.reduced = false;
    const secondRender = renderLiquidFlow({
      initialStep: 3,
      initialService: 'corte',
      initialBarber: 'Lautaro',
      initialDate: TEST_DATE,
      initialTime: '14:30',
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(resolveStepTransitionPair(3, 0, -1)).toBe('jump');

    const step0Btn = screen.getByRole('button', { name: /01.*Servicio|Servicio/i });
    fireEvent.click(step0Btn);
    const activeStage = secondRender.container.querySelector('.liquid-glass-step-stage[data-lg-step="0"]:not([data-lg-step-exiting="true"])') as HTMLElement;
    expect(activeStage).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Elegí un servicio/i })).toBeTruthy();
  });

  it('5. El CSS V12.47.1 protege backdrop-filter al asentar, desactiva puntero al salir, soporta reduced-motion y respeta V12.46 / rutas -old', async () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), 'src/components/kani/experimental/liquid-glass.css'),
      'utf8',
    );
    const bookingTsx = fs.readFileSync(
      path.join(process.cwd(), 'src/components/kani/booking.tsx'),
      'utf8',
    );

    expect(css).toContain('LIQUID GLASS V12.47.2 — MOTION SYSTEM II (REFINED STEP TRANSITIONS & OPTICAL CHOREOGRAPHY)');
    expect(css).toContain('.liquid-glass-step-stage[data-lg-step-state="settled"]');
    expect(css).toContain('.liquid-glass-step-stage[data-lg-step-exiting="true"]');
    expect(css).toContain('var(--lg-step-sync-ms, 280ms)');
    expect(css).toContain('data-lg-step-pair="service-barber"');
    expect(css).toContain('data-lg-step-pair="barber-date"');
    expect(css).toContain('data-lg-step-pair="date-time"');
    expect(css).toContain('data-lg-step-pair="time-contact"');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.lg-step-optical-veil/);

    // Rutas clásicas sin experimentalMotion siguen funcionando sin wrappers de Liquid Glass
    const { container } = render(
      <KaniProvider>
        <Booking variant="v5" />
      </KaniProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('.liquid-glass-step-stage')).toBeNull();
    expect(container.querySelector('.liquid-glass-stepper-lens')).toBeNull();
    expect(bookingTsx).toContain('scrollContainerRef.current.scrollTop = 0;');
  });
});

import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  AnimatePresence,
  LayoutGroup,
  MotionConfig,
  motion,
  useIsPresent,
  useReducedMotion,
  type MotionStyle,
} from 'motion/react';
import { triggerSelectionHaptic } from './liquid-glass-feedback';
import type {
  LiquidGlassInteractiveCardProps,
  LiquidGlassMotionAdapter,
  LiquidGlassStepPair,
  LiquidGlassStepTransitionProps,
  LiquidGlassStepperLensProps,
  StepDirection,
} from './liquid-glass-motion.types';

/**
 * Sistema centralizado de parámetros Motion V4 / Living Surface V8 / Motion System V12.46.1 para /reservar-turno-liquid.
 * Prioriza materialidad óptica, coreografías diferenciadas (Servicio, Barbero, Fecha, Horario),
 * física sin transforms persistentes y prefers-reduced-motion.
 */
export const LIQUID_GLASS_MOTION = {
  durations: {
    tap: 0.14,
    cardState: 0.24,
    step: 0.3,
    stepExit: 0.14,
    reduced: 0.08,
    livingSettleMs: 440,
  },
  easings: {
    crystal: [0.22, 1, 0.36, 1] as const,
  },
  springs: {
    stepperLens: {
      duration: 0.28,
      ease: [0.22, 1, 0.36, 1] as const,
    },
  },
  distances: {
    stepShiftPx: 18,
  },
  scales: {
    cardTap: 0.985,
    serviceCardTap: 0.966,
    barberCardTap: 0.994,
    actionTap: 0.982,
    slotTap: 0.972,
    dayTap: 0.952,
    avatarSelected: 1.045,
  },
  v46: {
    servicePressMs: 85,
    serviceRecoverMs: 420,
    serviceMotionMs: 680,
    serviceOvershootScale: 1.008,
    serviceReconfirmScale: 0.986,
    serviceReconfirmMs: 280,
    barberMotionMs: 640,
    barberReconfirmScale: 0.988,
    barberReconfirmMs: 280,
    dayTapScale: 0.94,
    dayPressMs: 65,
    dayPulseMs: 320,
    dayMotionMs: 520,
    dayOvershootScale: 1.032,
    dayReconfirmScale: 0.964,
    dayReconfirmMs: 260,
    slotTapScale: 0.952,
    slotPressMs: 65,
    slotRecoverMs: 280,
    slotMotionMs: 500,
    slotOvershootScale: 1.022,
    slotReconfirmScale: 0.974,
    slotReconfirmMs: 250,
  },
  stepTransitions: {
    'service-barber': {
      forward: {
        enterDuration: 0.3,
        exitDuration: 0.22,
        ease: [0.22, 1, 0.36, 1] as const,
        enterX: 12,
        enterY: 0,
        enterScale: 0.992,
        exitX: -10,
        exitY: 0,
        exitScale: 0.992,
      },
      backward: {
        enterDuration: 0.28,
        exitDuration: 0.2,
        ease: [0.22, 1, 0.36, 1] as const,
        enterX: -10,
        enterY: 0,
        enterScale: 0.992,
        exitX: 10,
        exitY: 0,
        exitScale: 0.992,
      },
    },
    'barber-date': {
      forward: {
        enterDuration: 0.28,
        exitDuration: 0.2,
        ease: [0.22, 1, 0.36, 1] as const,
        enterX: 0,
        enterY: 8,
        enterScale: 0.994,
        exitX: 0,
        exitY: -6,
        exitScale: 0.994,
      },
      backward: {
        enterDuration: 0.26,
        exitDuration: 0.19,
        ease: [0.22, 1, 0.36, 1] as const,
        enterX: 0,
        enterY: -6,
        enterScale: 0.994,
        exitX: 0,
        exitY: 6,
        exitScale: 0.994,
      },
    },
    'date-time': {
      forward: {
        enterDuration: 0.26,
        exitDuration: 0.19,
        ease: [0.22, 1, 0.36, 1] as const,
        enterX: 4,
        enterY: 5,
        enterScale: 0.996,
        exitX: -4,
        exitY: -4,
        exitScale: 0.996,
      },
      backward: {
        enterDuration: 0.25,
        exitDuration: 0.18,
        ease: [0.22, 1, 0.36, 1] as const,
        enterX: -4,
        enterY: -5,
        enterScale: 0.996,
        exitX: 4,
        exitY: 5,
        exitScale: 0.996,
      },
    },
    'time-contact': {
      forward: {
        enterDuration: 0.24,
        exitDuration: 0.18,
        ease: [0.25, 0.96, 0.36, 1] as const,
        enterX: 0,
        enterY: 3,
        enterScale: 0.998,
        exitX: 0,
        exitY: -2,
        exitScale: 0.998,
      },
      backward: {
        enterDuration: 0.23,
        exitDuration: 0.17,
        ease: [0.25, 0.96, 0.36, 1] as const,
        enterX: 0,
        enterY: -3,
        enterScale: 0.998,
        exitX: 0,
        exitY: 2,
        exitScale: 0.998,
      },
    },
    jump: {
      forward: {
        enterDuration: 0.27,
        exitDuration: 0.19,
        ease: [0.22, 1, 0.36, 1] as const,
        enterX: 8,
        enterY: 3,
        enterScale: 0.994,
        exitX: -8,
        exitY: -3,
        exitScale: 0.994,
      },
      backward: {
        enterDuration: 0.26,
        exitDuration: 0.18,
        ease: [0.22, 1, 0.36, 1] as const,
        enterX: -8,
        enterY: -3,
        enterScale: 0.994,
        exitX: 8,
        exitY: 3,
        exitScale: 0.994,
      },
    },
  },
} as const;

export interface ResolvedStepTransitionSpec {
  pair: LiquidGlassStepPair;
  enterDuration: number;
  exitDuration: number;
  ease: readonly [number, number, number, number];
  enterX: number;
  enterY: number;
  enterScale: number;
  exitX: number;
  exitY: number;
  exitScale: number;
}

export function resolveStepTransitionPair(
  previousStep: number | undefined,
  stepKey: number,
  direction: StepDirection,
): LiquidGlassStepPair {
  const inferredPrev =
    typeof previousStep === 'number' && previousStep !== stepKey
      ? previousStep
      : direction === 1
      ? Math.max(0, stepKey - 1)
      : Math.min(4, stepKey + 1);
  const low = Math.min(inferredPrev, stepKey);
  const high = Math.max(inferredPrev, stepKey);

  if (low === 0 && high === 1) return 'service-barber';
  if (low === 1 && high === 2) return 'barber-date';
  if (low === 2 && high === 3) return 'date-time';
  if (high === 4 && low >= 2) return 'time-contact';
  return 'jump';
}

export function resolveStepTransitionSpec(
  previousStep: number | undefined,
  stepKey: number,
  direction: StepDirection,
): ResolvedStepTransitionSpec {
  const pair = resolveStepTransitionPair(previousStep, stepKey, direction);
  const dirKey = direction === 1 ? 'forward' : 'backward';
  const entry = LIQUID_GLASS_MOTION.stepTransitions[pair][dirKey];
  return {
    pair,
    ...entry,
  };
}

interface StepStageMotionCustom {
  direction: StepDirection;
  spec: ResolvedStepTransitionSpec;
}

const stepVariants = {
  enter: (custom: StepStageMotionCustom) => ({
    opacity: 0,
    x: custom.spec.enterX,
    y: custom.spec.enterY,
    scale: custom.spec.enterScale,
  }),
  center: (custom: StepStageMotionCustom) => ({
    opacity: 1,
    x: 0,
    y: 0,
    scale: 1,
    transition: {
      duration: custom.spec.enterDuration,
      ease: custom.spec.ease,
    },
  }),
  exit: (custom: StepStageMotionCustom) => ({
    opacity: 0,
    x: custom.spec.exitX,
    y: custom.spec.exitY,
    scale: custom.spec.exitScale,
    transition: {
      duration: custom.spec.exitDuration,
      ease: custom.spec.ease,
    },
  }),
};

const reducedStepVariants = {
  enter: { opacity: 0, x: 0, y: 0, scale: 1 },
  center: {
    opacity: 1,
    x: 0,
    y: 0,
    scale: 1,
    transition: { duration: LIQUID_GLASS_MOTION.durations.reduced },
  },
  exit: {
    opacity: 0,
    x: 0,
    y: 0,
    scale: 1,
    transition: { duration: LIQUID_GLASS_MOTION.durations.reduced },
  },
};

export function LiquidGlassMotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup id="kani-liquid-stepper">{children}</LayoutGroup>
    </MotionConfig>
  );
}

function StepperLens({ stepKey, previousStep, direction = 1 }: LiquidGlassStepperLensProps = {}) {
  const shouldReduceMotion = useReducedMotion();
  const hasExplicitStep = typeof stepKey === 'number' && typeof previousStep === 'number' && previousStep !== stepKey;
  const spec = hasExplicitStep
    ? resolveStepTransitionSpec(previousStep, stepKey, direction)
    : null;
  const lensTransition = spec
    ? { duration: spec.enterDuration, ease: spec.ease }
    : LIQUID_GLASS_MOTION.springs.stepperLens;

  return (
    <motion.span
      layoutId="liquid-glass-stepper-lens"
      className="liquid-glass-stepper-lens"
      data-lg-step-pair={spec?.pair}
      aria-hidden="true"
      style={{ borderRadius: 9999 }}
      transition={
        shouldReduceMotion
          ? { duration: 0.01 }
          : { layout: lensTransition }
      }
    />
  );
}

type TactileMotionSpec = {
  motionTag: 'service-select' | 'day-select' | 'slot-select';
  tapScale: number;
  pressMs: number;
  overshootScale: number;
  recoverMs: number;
  motionMs: number;
};

type ReconfirmMotionSpec = {
  motionTag: 'service-reconfirm' | 'barber-reconfirm' | 'day-reconfirm' | 'slot-reconfirm';
  tapScale: number;
  pressMs: number;
  recoverMs: number;
  motionMs: number;
};

function InteractiveCard({
  children,
  className = '',
  disabled,
  type = 'button',
  tapScale = LIQUID_GLASS_MOTION.scales.cardTap,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  ...rest
}: LiquidGlassInteractiveCardProps) {
  const shouldReduceMotion = useReducedMotion();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const coreRef = useRef<HTMLSpanElement | null>(null);
  const waveRef = useRef<HTMLSpanElement | null>(null);
  const rippleTimerRef = useRef<number | null>(null);
  const motionTimerRef = useRef<number | null>(null);
  const pressAnimRef = useRef<Animation | null>(null);
  const recoverAnimRef = useRef<Animation | null>(null);
  const isPressingRef = useRef(false);
  const pressedWhileSelectedRef = useRef<boolean | null>(null);
  const pressStartedAtRef = useRef(0);
  const lastRecoverAtRef = useRef(0);

  const isSelected = className.includes('selected');
  const prevSelectedRef = useRef(isSelected);
  const isCalendarDay = className.includes('calendar-day');
  const isTimeSlot = className.includes('booking-time-slot');
  const isServiceOption = className.includes('service-option');
  const isBarberOption =
    className.includes('booking-option') &&
    !isServiceOption &&
    !className.includes('booking-defer-option');
  const isLargeCard = isServiceOption || isBarberOption;
  const isMotionControlledTarget = isLargeCard || isCalendarDay || isTimeSlot;

  const tactileSpec: TactileMotionSpec | null = isServiceOption
    ? {
        motionTag: 'service-select',
        tapScale: LIQUID_GLASS_MOTION.scales.serviceCardTap,
        pressMs: LIQUID_GLASS_MOTION.v46.servicePressMs,
        overshootScale: LIQUID_GLASS_MOTION.v46.serviceOvershootScale,
        recoverMs: LIQUID_GLASS_MOTION.v46.serviceRecoverMs,
        motionMs: LIQUID_GLASS_MOTION.v46.serviceMotionMs,
      }
    : isCalendarDay
      ? {
          motionTag: 'day-select',
          tapScale: LIQUID_GLASS_MOTION.v46.dayTapScale,
          pressMs: LIQUID_GLASS_MOTION.v46.dayPressMs,
          overshootScale: LIQUID_GLASS_MOTION.v46.dayOvershootScale,
          recoverMs: LIQUID_GLASS_MOTION.v46.dayPulseMs,
          motionMs: LIQUID_GLASS_MOTION.v46.dayMotionMs,
        }
      : isTimeSlot
        ? {
            motionTag: 'slot-select',
            tapScale: LIQUID_GLASS_MOTION.v46.slotTapScale,
            pressMs: LIQUID_GLASS_MOTION.v46.slotPressMs,
            overshootScale: LIQUID_GLASS_MOTION.v46.slotOvershootScale,
            recoverMs: LIQUID_GLASS_MOTION.v46.slotRecoverMs,
            motionMs: LIQUID_GLASS_MOTION.v46.slotMotionMs,
          }
        : null;

  const reconfirmSpec: ReconfirmMotionSpec | null = isServiceOption
    ? {
        motionTag: 'service-reconfirm',
        tapScale: LIQUID_GLASS_MOTION.v46.serviceReconfirmScale,
        pressMs: 65,
        recoverMs: 210,
        motionMs: LIQUID_GLASS_MOTION.v46.serviceReconfirmMs,
      }
    : isBarberOption
      ? {
          motionTag: 'barber-reconfirm',
          tapScale: LIQUID_GLASS_MOTION.v46.barberReconfirmScale,
          pressMs: 65,
          recoverMs: 210,
          motionMs: LIQUID_GLASS_MOTION.v46.barberReconfirmMs,
        }
      : isCalendarDay
        ? {
            motionTag: 'day-reconfirm',
            tapScale: LIQUID_GLASS_MOTION.v46.dayReconfirmScale,
            pressMs: 55,
            recoverMs: 190,
            motionMs: LIQUID_GLASS_MOTION.v46.dayReconfirmMs,
          }
        : isTimeSlot
          ? {
              motionTag: 'slot-reconfirm',
              tapScale: LIQUID_GLASS_MOTION.v46.slotReconfirmScale,
              pressMs: 55,
              recoverMs: 185,
              motionMs: LIQUID_GLASS_MOTION.v46.slotReconfirmMs,
            }
          : null;

  const effectiveTapScale = tactileSpec
    ? tactileSpec.tapScale
    : tapScale !== LIQUID_GLASS_MOTION.scales.cardTap
      ? tapScale
      : isBarberOption
        ? LIQUID_GLASS_MOTION.scales.barberCardTap
        : tapScale;

  const cancelTactileAnims = () => {
    pressAnimRef.current?.cancel();
    pressAnimRef.current = null;
    recoverAnimRef.current?.cancel();
    recoverAnimRef.current = null;
  };

  const clearMotionState = () => {
    if (motionTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(motionTimerRef.current);
      motionTimerRef.current = null;
    }
    buttonRef.current?.removeAttribute('data-lg-motion');
    buttonRef.current?.removeAttribute('data-lg-pressing');
  };

  const triggerMotionAttribute = (motionTag: string, durationMs: number) => {
    const el = buttonRef.current;
    if (!el || typeof window === 'undefined') return;
    if (el.getAttribute('data-lg-motion') === motionTag) {
      el.removeAttribute('data-lg-motion');
      void el.offsetWidth;
    }
    el.setAttribute('data-lg-motion', motionTag);
    if (motionTimerRef.current !== null) {
      window.clearTimeout(motionTimerRef.current);
    }
    motionTimerRef.current = window.setTimeout(() => {
      el.removeAttribute('data-lg-motion');
      motionTimerRef.current = null;
    }, durationMs);
  };

  const triggerTactileRecover = (spec: TactileMotionSpec, ensureTapVisible: boolean) => {
    const el = buttonRef.current;
    if (!el || shouldReduceMotion || typeof el.animate !== 'function') return;

    cancelTactileAnims();
    const now = Date.now();
    const elapsedMs = pressStartedAtRef.current > 0 ? now - pressStartedAtRef.current : 999;
    lastRecoverAtRef.current = now;

    // En taps rápidos (< 75ms) o teclado, completa un micro-hundimiento breve antes del retorno elástico para que sea perceptible en mobile y desktop.
    const keyframes =
      ensureTapVisible && elapsedMs < 75
        ? [
            { transform: 'scale(0.992)' },
            { transform: `scale(${spec.tapScale})`, offset: 0.2 },
            { transform: `scale(${spec.overshootScale})`, offset: 0.6 },
            { transform: 'scale(1)' },
          ]
        : [
            { transform: `scale(${spec.tapScale})` },
            { transform: `scale(${spec.overshootScale})`, offset: 0.54 },
            { transform: 'scale(1)' },
          ];

    const duration =
      ensureTapVisible && elapsedMs < 75 ? spec.recoverMs : Math.round(spec.recoverMs * 0.86);

    recoverAnimRef.current = el.animate(keyframes, {
      duration,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'none',
    });
  };

  const triggerReconfirmRecover = (spec: ReconfirmMotionSpec, includePressKeyframe: boolean) => {
    const el = buttonRef.current;
    if (!el || shouldReduceMotion || typeof el.animate !== 'function') return;

    cancelTactileAnims();
    lastRecoverAtRef.current = Date.now();
    const keyframes = includePressKeyframe
      ? [
          { transform: 'scale(1)' },
          { transform: `scale(${spec.tapScale})`, offset: 0.32 },
          { transform: 'scale(1)' },
        ]
      : [
          { transform: `scale(${spec.tapScale})` },
          { transform: 'scale(1)' },
        ];

    recoverAnimRef.current = el.animate(keyframes, {
      duration: spec.recoverMs,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'none',
    });
  };

  useEffect(() => {
    const el = buttonRef.current;
    const wasSelected = prevSelectedRef.current;
    const becameSelected = !wasSelected && isSelected;
    prevSelectedRef.current = isSelected;

    if (!el || typeof window === 'undefined') return;

    if (!isSelected) {
      if (wasSelected) {
        clearMotionState();
        cancelTactileAnims();
      }
      return;
    }

    if (!becameSelected || disabled || shouldReduceMotion) {
      return;
    }

    if (tactileSpec) {
      triggerMotionAttribute(tactileSpec.motionTag, tactileSpec.motionMs);
      if (Date.now() - lastRecoverAtRef.current > 180) {
        triggerTactileRecover(tactileSpec, true);
      }
      return;
    }

    // Barbero V12.46: conservado intacto como referencia visual aprobada.
    if (isBarberOption) {
      triggerMotionAttribute('barber-select', LIQUID_GLASS_MOTION.v46.barberMotionMs);
    }
  }, [
    isSelected,
    disabled,
    shouldReduceMotion,
    isBarberOption,
    tactileSpec?.motionTag,
    tactileSpec?.motionMs,
    tactileSpec?.tapScale,
    tactileSpec?.overshootScale,
    tactileSpec?.recoverMs,
  ]);

  useEffect(() => {
    return () => {
      if (rippleTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(rippleTimerRef.current);
        rippleTimerRef.current = null;
      }
      clearMotionState();
      cancelTactileAnims();
    };
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(event);
    if (disabled || shouldReduceMotion) return;

    const el = buttonRef.current;
    if (!el || typeof window === 'undefined') return;

    pressedWhileSelectedRef.current = isSelected;

    const rect = el.getBoundingClientRect();
    const hasCoords = rect.width > 0 && rect.height > 0 && (event.clientX !== 0 || event.clientY !== 0);
    const localX = hasCoords ? Math.min(Math.max(event.clientX - rect.left, 0), rect.width) : rect.width / 2;
    const localY = hasCoords ? Math.min(Math.max(event.clientY - rect.top, 0), rect.height) : rect.height / 2;
    const maxRadius = Math.hypot(
      Math.max(localX, rect.width - localX),
      Math.max(localY, rect.height - localY),
    );
    const waveSize = isServiceOption
      ? Math.min(Math.max(Math.ceil(maxRadius * 2.1), 280), 540)
      : isBarberOption
        ? Math.min(Math.max(Math.ceil(maxRadius * 1.35), 180), 260)
        : Math.max(Math.ceil(maxRadius * 2), 96);

    el.style.setProperty('--lg-touch-x', `${localX.toFixed(1)}px`);
    el.style.setProperty('--lg-touch-y', `${localY.toFixed(1)}px`);
    el.style.setProperty('--lg-touch-x-pct', `${((localX / Math.max(rect.width, 1)) * 100).toFixed(1)}%`);
    el.style.setProperty('--lg-touch-y-pct', `${((localY / Math.max(rect.height, 1)) * 100).toFixed(1)}%`);
    el.style.setProperty('--lg-wave-size', `${waveSize}px`);

    // V12.46.2: Re-pulsación sobre opción ya seleccionada -> compresión sutil de confirmación sin expandir núcleo óptico.
    if (isSelected && reconfirmSpec) {
      isPressingRef.current = true;
      pressStartedAtRef.current = Date.now();
      el.setAttribute('data-lg-pressing', 'true');
      cancelTactileAnims();
      if (typeof el.animate === 'function') {
        pressAnimRef.current = el.animate(
          [
            { transform: 'scale(1)' },
            { transform: `scale(${reconfirmSpec.tapScale})` },
          ],
          {
            duration: reconfirmSpec.pressMs,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'forwards',
          },
        );
      }
      return;
    }

    // V12.46.1 (Servicio, Fecha, Horario): compresión táctil inmediata via WAAPI sin ripple genérico; la expansión óptica inicia al seleccionar.
    if (tactileSpec) {
      isPressingRef.current = true;
      pressStartedAtRef.current = Date.now();
      el.setAttribute('data-lg-pressing', 'true');
      cancelTactileAnims();
      if (typeof el.animate === 'function') {
        pressAnimRef.current = el.animate(
          [
            { transform: 'scale(1)' },
            { transform: `scale(${tactileSpec.tapScale})` },
          ],
          {
            duration: tactileSpec.pressMs,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'forwards',
          },
        );
      }
      return;
    }

    // Barbero V12.46: luminiscencia cálida sutil sin rebote elástico ni onda expansiva mecánica.
    if (isBarberOption) {
      const coreEl = coreRef.current;
      if (typeof coreEl?.animate === 'function') {
        coreEl.getAnimations?.().forEach((anim) => anim.cancel());
        coreEl.animate(
          [
            { opacity: 0, transform: 'translate3d(-50%, -50%, 0) scale(0.58)' },
            { opacity: 0.38, transform: 'translate3d(-50%, -50%, 0) scale(0.95)', offset: 0.42 },
            { opacity: 0, transform: 'translate3d(-50%, -50%, 0) scale(1.16)' },
          ],
          {
            duration: 380,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'none',
          },
        );
      }
      return;
    }

    const coreEl = coreRef.current;
    const waveEl = waveRef.current;
    if (typeof waveEl?.animate === 'function') {
      coreEl?.getAnimations?.().forEach((anim) => anim.cancel());
      waveEl.getAnimations?.().forEach((anim) => anim.cancel());

      coreEl?.animate?.(
        [
          { opacity: 0.82, transform: 'translate3d(-50%, -50%, 0) scale(0.42)' },
          { opacity: 0.42, transform: 'translate3d(-50%, -50%, 0) scale(0.92)', offset: 0.48 },
          { opacity: 0, transform: 'translate3d(-50%, -50%, 0) scale(1.20)' },
        ],
        {
          duration: 320,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'none',
        },
      );

      waveEl.animate(
        [
          { opacity: 0.88, transform: 'translate3d(-50%, -50%, 0) scale(0.24)' },
          { opacity: 0.44, transform: 'translate3d(-50%, -50%, 0) scale(0.74)', offset: 0.5 },
          { opacity: 0, transform: 'translate3d(-50%, -50%, 0) scale(1.12)' },
        ],
        {
          duration: LIQUID_GLASS_MOTION.durations.livingSettleMs,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'none',
        },
      );
    }

    el.setAttribute('data-lg-ripple', 'active');

    if (rippleTimerRef.current !== null) {
      window.clearTimeout(rippleTimerRef.current);
    }
    rippleTimerRef.current = window.setTimeout(() => {
      el.removeAttribute('data-lg-ripple');
      rippleTimerRef.current = null;
    }, LIQUID_GLASS_MOTION.durations.livingSettleMs);
  };

  const releaseTactilePress = (cancelled: boolean) => {
    const el = buttonRef.current;
    if (!isPressingRef.current) return;
    isPressingRef.current = false;
    el?.removeAttribute('data-lg-pressing');

    if (pressedWhileSelectedRef.current && reconfirmSpec) {
      triggerReconfirmRecover(reconfirmSpec, false);
      return;
    }

    if (tactileSpec) {
      triggerTactileRecover(tactileSpec, !cancelled);
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerUp?.(event);
    if (tactileSpec || isBarberOption) releaseTactilePress(false);
  };

  const handlePointerCancel = (event: PointerEvent<HTMLButtonElement>) => {
    pressedWhileSelectedRef.current = null;
    onPointerCancel?.(event);
    if (tactileSpec || isBarberOption) releaseTactilePress(true);
  };

  const handlePointerLeave = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerLeave?.(event);
    if ((tactileSpec || isBarberOption) && isPressingRef.current) {
      releaseTactilePress(true);
    }
  };

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    const wasSelectedAtTap = pressedWhileSelectedRef.current ?? isSelected;
    pressedWhileSelectedRef.current = null;
    onClick?.(event);

    if (disabled || shouldReduceMotion || !reconfirmSpec) return;

    if (wasSelectedAtTap) {
      triggerMotionAttribute(reconfirmSpec.motionTag, reconfirmSpec.motionMs);
      if (Date.now() - lastRecoverAtRef.current > 180) {
        triggerReconfirmRecover(reconfirmSpec, true);
      }
      triggerSelectionHaptic('reconfirm', Boolean(shouldReduceMotion));
    } else {
      triggerSelectionHaptic('select', Boolean(shouldReduceMotion));
    }
  };

  const isActionButton =
    className.includes('booking-back-button') || className.includes('booking-next-button');

  // No dejar transform persistente en reposo/selección para no aislar backdrop-filter en Safari iOS/WebKit.
  const animateState = undefined;

  return (
    <motion.button
      ref={buttonRef}
      type={type}
      disabled={disabled}
      className={className}
      animate={animateState}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerLeave}
      whileHover={
        disabled || shouldReduceMotion || isActionButton || isMotionControlledTarget
          ? undefined
          : { y: isSelected ? -2 : -1 }
      }
      whileTap={
        disabled || shouldReduceMotion || isMotionControlledTarget
          ? undefined
          : { scale: effectiveTapScale }
      }
      transition={
        shouldReduceMotion
          ? { duration: LIQUID_GLASS_MOTION.durations.reduced }
          : {
              duration: LIQUID_GLASS_MOTION.durations.cardState,
              ease: LIQUID_GLASS_MOTION.easings.crystal,
            }
      }
      {...rest}
    >
      {!disabled && (
        <span className="lg-living-surface" aria-hidden="true">
          <span ref={coreRef} className="lg-living-core" />
          <span className="lg-living-refraction" />
          <span ref={waveRef} className="lg-living-wave" />
          <span className="lg-living-edge" />
        </span>
      )}
      {!disabled && !isCalendarDay && (
        <span className="lg-optical-sheen" aria-hidden="true" />
      )}
      {children}
    </motion.button>
  );
}

interface StepStageFrameProps {
  stepKey: number;
  direction: StepDirection;
  spec: ResolvedStepTransitionSpec;
  shouldReduceMotion: boolean;
  animateOnEnter: boolean;
  children: ReactNode;
}

const StepStageFrame = forwardRef<HTMLDivElement, StepStageFrameProps>(
  function StepStageFrame(
    { stepKey, direction, spec, shouldReduceMotion, animateOnEnter, children },
    forwardedRef,
  ) {
    const isPresent = useIsPresent();
    const localRef = useRef<HTMLDivElement | null>(null);
    const [settled, setSettled] = useState(!animateOnEnter || shouldReduceMotion);
    const motionCustom: StepStageMotionCustom = { direction, spec };

    const clearResidualTransform = () => {
      const el = localRef.current;
      if (!el) return;
      el.style.removeProperty('transform');
      el.style.removeProperty('will-change');
    };

    useEffect(() => {
      if (!isPresent) {
        return;
      }
      if (shouldReduceMotion || !animateOnEnter) {
        setSettled(true);
        clearResidualTransform();
        return;
      }
      setSettled(false);
      const settleMs = Math.round(spec.enterDuration * 1000) + 40;
      const timer = window.setTimeout(() => {
        setSettled(true);
        clearResidualTransform();
      }, settleMs);
      return () => window.clearTimeout(timer);
    }, [animateOnEnter, isPresent, shouldReduceMotion, spec.enterDuration, stepKey]);

    const setRefs = (node: HTMLDivElement | null) => {
      localRef.current = node;
      if (typeof forwardedRef === 'function') {
        forwardedRef(node);
      } else if (forwardedRef) {
        forwardedRef.current = node;
      }
    };

    const enterMs = Math.round((shouldReduceMotion ? LIQUID_GLASS_MOTION.durations.reduced : spec.enterDuration) * 1000);
    const stageState = shouldReduceMotion
      ? 'reduced'
      : !isPresent
      ? 'exiting'
      : settled
      ? 'settled'
      : 'entering';

    return (
      <motion.div
        ref={setRefs}
        custom={motionCustom}
        variants={shouldReduceMotion ? reducedStepVariants : stepVariants}
        initial="enter"
        animate="center"
        exit="exit"
        onAnimationComplete={(definition) => {
          if (definition === 'center' && isPresent) {
            setSettled(true);
            clearResidualTransform();
          }
        }}
        data-lg-step={stepKey}
        data-lg-step-pair={spec.pair}
        data-lg-step-dir={direction === 1 ? 'forward' : 'backward'}
        data-lg-step-state={stageState}
        data-lg-step-exiting={!isPresent ? 'true' : undefined}
        aria-hidden={!isPresent || undefined}
        style={
          {
            '--lg-step-enter-ms': `${enterMs}ms`,
            ...(isPresent ? {} : { pointerEvents: 'none' }),
          } as MotionStyle
        }
        className="liquid-glass-step-stage"
      >
        {!shouldReduceMotion && animateOnEnter && !settled && isPresent && (
          <span className="lg-step-optical-veil" aria-hidden="true" />
        )}
        {children}
      </motion.div>
    );
  },
);

function StepTransition({
  stepKey,
  previousStep,
  direction,
  children,
}: LiquidGlassStepTransitionProps) {
  const shouldReduceMotion = Boolean(useReducedMotion());
  const prevStepTrackingRef = useRef<number>(previousStep ?? stepKey);
  const stableFromRef = useRef<number>(previousStep ?? stepKey);
  const hasNavigatedRef = useRef(false);

  if (prevStepTrackingRef.current !== stepKey) {
    stableFromRef.current =
      typeof previousStep === 'number' && previousStep !== stepKey
        ? previousStep
        : prevStepTrackingRef.current;
    hasNavigatedRef.current = true;
    prevStepTrackingRef.current = stepKey;
  } else if (typeof previousStep === 'number' && previousStep !== stepKey) {
    stableFromRef.current = previousStep;
  }

  const animateOnEnter =
    hasNavigatedRef.current ||
    (typeof previousStep === 'number' && previousStep !== stepKey);

  const spec = resolveStepTransitionSpec(stableFromRef.current, stepKey, direction);
  const motionCustom: StepStageMotionCustom = { direction, spec };

  return (
    <AnimatePresence mode="popLayout" initial={false} custom={motionCustom}>
      <StepStageFrame
        key={stepKey}
        stepKey={stepKey}
        direction={direction}
        spec={spec}
        shouldReduceMotion={shouldReduceMotion}
        animateOnEnter={animateOnEnter}
      >
        {children}
      </StepStageFrame>
    </AnimatePresence>
  );
}

export const liquidGlassMotionAdapter: LiquidGlassMotionAdapter = {
  StepperLens,
  InteractiveCard,
  StepTransition,
  getStepTransitionDurationMs: (previousStep, stepKey, direction) =>
    Math.round(resolveStepTransitionSpec(previousStep, stepKey, direction).enterDuration * 1000),
};

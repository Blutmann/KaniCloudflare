import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import type {
  LiquidGlassInteractiveCardProps,
  LiquidGlassMotionAdapter,
  LiquidGlassStepTransitionProps,
  StepDirection,
} from './liquid-glass-motion.types';

/**
 * Sistema centralizado de parámetros Motion V4 / Living Surface V8 para /reservar-turno-liquid.
 * Prioriza transform/opacity, física de contacto en coordenadas reales y prefers-reduced-motion.
 */
export const LIQUID_GLASS_MOTION = {
  durations: {
    tap: 0.14,
    cardState: 0.25,
    step: 0.3,
    stepExit: 0.12,
    reduced: 0.08,
    livingSettleMs: 650,
  },
  easings: {
    crystal: [0.22, 1, 0.36, 1] as const,
  },
  springs: {
    stepperLens: {
      type: 'spring' as const,
      stiffness: 340,
      damping: 32,
      mass: 0.95,
    },
  },
  distances: {
    stepShiftPx: 18,
  },
  scales: {
    cardTap: 0.985,
    actionTap: 0.985,
    slotTap: 0.978,
    dayTap: 0.955,
    avatarSelected: 1.045,
  },
} as const;

const stepVariants = {
  enter: (direction: StepDirection) => ({
    opacity: 0,
    x: direction * LIQUID_GLASS_MOTION.distances.stepShiftPx,
  }),
  center: {
    opacity: 1,
    x: 0,
  },
  exit: (direction: StepDirection) => ({
    opacity: 0,
    x: -direction * LIQUID_GLASS_MOTION.distances.stepShiftPx,
  }),
};

const reducedStepVariants = {
  enter: { opacity: 0, x: 0 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 0 },
};

export function LiquidGlassMotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

function StepperLens() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.span
      layoutId="liquid-glass-stepper-lens"
      className="liquid-glass-stepper-lens"
      aria-hidden="true"
      transition={
        shouldReduceMotion
          ? { duration: 0.01 }
          : LIQUID_GLASS_MOTION.springs.stepperLens
      }
    />
  );
}

function InteractiveCard({
  children,
  className = '',
  disabled,
  type = 'button',
  tapScale = LIQUID_GLASS_MOTION.scales.cardTap,
  onPointerDown,
  ...rest
}: LiquidGlassInteractiveCardProps) {
  const shouldReduceMotion = useReducedMotion();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const waveRef = useRef<HTMLSpanElement | null>(null);
  const rippleTimerRef = useRef<number | null>(null);

  const isSelected = className.includes('selected');
  const isCalendarDay = className.includes('calendar-day');
  const isActionButton =
    className.includes('booking-back-button') || className.includes('booking-next-button');

  useEffect(() => {
    return () => {
      if (rippleTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(rippleTimerRef.current);
        rippleTimerRef.current = null;
      }
    };
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(event);
    if (disabled || shouldReduceMotion) return;

    const el = buttonRef.current;
    if (!el || typeof window === 'undefined') return;

    const rect = el.getBoundingClientRect();
    const hasCoords = rect.width > 0 && rect.height > 0 && (event.clientX !== 0 || event.clientY !== 0);
    const localX = hasCoords ? Math.min(Math.max(event.clientX - rect.left, 0), rect.width) : rect.width / 2;
    const localY = hasCoords ? Math.min(Math.max(event.clientY - rect.top, 0), rect.height) : rect.height / 2;
    const maxRadius = Math.hypot(
      Math.max(localX, rect.width - localX),
      Math.max(localY, rect.height - localY),
    );
    const waveSize = Math.max(Math.ceil(maxRadius * 2), 96);

    el.style.setProperty('--lg-touch-x', `${localX.toFixed(1)}px`);
    el.style.setProperty('--lg-touch-y', `${localY.toFixed(1)}px`);
    el.style.setProperty('--lg-touch-x-pct', `${((localX / Math.max(rect.width, 1)) * 100).toFixed(1)}%`);
    el.style.setProperty('--lg-touch-y-pct', `${((localY / Math.max(rect.height, 1)) * 100).toFixed(1)}%`);
    el.style.setProperty('--lg-wave-size', `${waveSize}px`);

    el.removeAttribute('data-lg-ripple');
    void waveRef.current?.offsetWidth;
    el.setAttribute('data-lg-ripple', 'active');

    if (rippleTimerRef.current !== null) {
      window.clearTimeout(rippleTimerRef.current);
    }
    rippleTimerRef.current = window.setTimeout(() => {
      el.removeAttribute('data-lg-ripple');
      rippleTimerRef.current = null;
    }, LIQUID_GLASS_MOTION.durations.livingSettleMs);
  };

  const animateState = shouldReduceMotion
    ? undefined
    : isCalendarDay
      ? { scale: isSelected ? 1.03 : 1 }
      : isActionButton
        ? undefined
        : { y: isSelected ? -1.5 : 0 };

  return (
    <motion.button
      ref={buttonRef}
      type={type}
      disabled={disabled}
      className={className}
      animate={animateState}
      onPointerDown={handlePointerDown}
      whileHover={
        disabled || shouldReduceMotion || isActionButton
          ? undefined
          : { y: isSelected ? -2 : -1 }
      }
      whileTap={
        disabled || shouldReduceMotion
          ? undefined
          : { scale: tapScale }
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

function StepTransition({ stepKey, direction, children }: LiquidGlassStepTransitionProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <AnimatePresence mode="popLayout" initial={false} custom={direction}>
      <motion.div
        key={stepKey}
        custom={direction}
        variants={shouldReduceMotion ? reducedStepVariants : stepVariants}
        initial="enter"
        animate="center"
        exit="exit"
        transition={
          shouldReduceMotion
            ? { duration: LIQUID_GLASS_MOTION.durations.reduced }
            : {
                duration: LIQUID_GLASS_MOTION.durations.step,
                ease: LIQUID_GLASS_MOTION.easings.crystal,
              }
        }
        className="liquid-glass-step-stage"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

export const liquidGlassMotionAdapter: LiquidGlassMotionAdapter = {
  StepperLens,
  InteractiveCard,
  StepTransition,
};

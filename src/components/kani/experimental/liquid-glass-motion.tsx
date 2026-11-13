import type { ReactNode } from 'react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import type {
  LiquidGlassInteractiveCardProps,
  LiquidGlassMotionAdapter,
  LiquidGlassStepTransitionProps,
  StepDirection,
} from './liquid-glass-motion.types';

/**
 * Sistema centralizado de parámetros Motion V1 para /reservar-turno-liquid.
 * Prioriza transform/opacity, respuesta táctil breve y compatibilidad con prefers-reduced-motion.
 */
export const LIQUID_GLASS_MOTION = {
  durations: {
    tap: 0.14,
    cardState: 0.25,
    step: 0.3,
    stepExit: 0.12,
    reduced: 0.08,
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
  ...rest
}: LiquidGlassInteractiveCardProps) {
  const shouldReduceMotion = useReducedMotion();
  const isSelected = className.includes('selected');
  const isCalendarDay = className.includes('calendar-day');
  const isActionButton =
    className.includes('booking-back-button') || className.includes('booking-next-button');

  const animateState = shouldReduceMotion
    ? undefined
    : isCalendarDay
      ? { scale: isSelected ? 1.03 : 1 }
      : isActionButton
        ? undefined
        : { y: isSelected ? -1.5 : 0 };

  return (
    <motion.button
      type={type}
      disabled={disabled}
      className={className}
      animate={animateState}
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

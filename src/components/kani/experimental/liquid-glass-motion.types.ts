import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type StepDirection = 1 | -1;

export type LiquidGlassStepPair =
  | 'service-barber'
  | 'barber-date'
  | 'date-time'
  | 'time-contact'
  | 'jump';

export interface LiquidGlassInteractiveCardProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd'> {
  children: ReactNode;
  tapScale?: number;
}

export interface LiquidGlassStepperLensProps {
  stepKey?: number;
  previousStep?: number;
  direction?: StepDirection;
}

export interface LiquidGlassStepTransitionProps {
  stepKey: number;
  previousStep?: number;
  direction: StepDirection;
  children: ReactNode;
}

export interface LiquidGlassMotionAdapter {
  StepperLens: (props?: LiquidGlassStepperLensProps) => ReactNode;
  InteractiveCard: (props: LiquidGlassInteractiveCardProps) => ReactNode;
  StepTransition: (props: LiquidGlassStepTransitionProps) => ReactNode;
  getStepTransitionDurationMs?: (
    previousStep: number,
    stepKey: number,
    direction: StepDirection,
  ) => number;
}

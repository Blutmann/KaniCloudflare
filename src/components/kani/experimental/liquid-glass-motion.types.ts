import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type StepDirection = 1 | -1;

export interface LiquidGlassInteractiveCardProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd'> {
  children: ReactNode;
  tapScale?: number;
}

export interface LiquidGlassStepTransitionProps {
  stepKey: number;
  direction: StepDirection;
  children: ReactNode;
}

export interface LiquidGlassMotionAdapter {
  StepperLens: () => ReactNode;
  InteractiveCard: (props: LiquidGlassInteractiveCardProps) => ReactNode;
  StepTransition: (props: LiquidGlassStepTransitionProps) => ReactNode;
}

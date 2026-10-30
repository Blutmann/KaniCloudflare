import type { ReactNode } from 'react';

export interface BookingStepHeadingProps {
  /** Text content of the step title */
  title: string;
  /** Optional secondary complementary element (e.g. date indicator in time step) */
  secondary?: ReactNode;
  /** Optional container class name additions */
  className?: string;
  /** 0-based step index for semantic/testing attributes */
  stepIndex?: number;
}

/**
 * BookingStepHeading — Unified step heading component for Kani Barber Studio.
 * Centralizes semantic <h1> element, typography, size, weight, line-height, letter-spacing,
 * margins, padding, alignment and responsive geometry across all reservation steps.
 */
export function BookingStepHeading({
  title,
  secondary,
  className = '',
  stepIndex,
}: BookingStepHeadingProps) {
  return (
    <div
      className={`booking-step-heading booking-title-row ${className}`.trim()}
      data-step-heading={stepIndex !== undefined ? stepIndex : undefined}
      data-testid={stepIndex !== undefined ? `booking-step-heading-${stepIndex}` : 'booking-step-heading'}
    >
      <div className="booking-step-heading-inner">
        <h1 className="booking-step-heading-title section-title">{title}</h1>
        {secondary && (
          <aside className="booking-step-heading-secondary" aria-label="Información complementaria del paso">
            {secondary}
          </aside>
        )}
      </div>
    </div>
  );
}

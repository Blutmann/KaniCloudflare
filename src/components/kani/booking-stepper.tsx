import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

const steps = ["Servicio", "Barbero", "Fecha", "Horario", "Datos", "Resumen"];

export function BookingStepper({
  currentStep,
  onStepChange,
}: {
  currentStep: number;
  onStepChange: (step: number) => void;
}) {
  return (
    <nav className="booking-stepper" aria-label="Progreso de la reserva">
      <p className="booking-stepper-summary" aria-live="polite" aria-atomic="true">
        <span>
          Paso <strong>{String(currentStep + 1).padStart(2, "0")}</strong>
          <span className="booking-stepper-total"> de {steps.length}</span>
        </span>
        <span className="booking-stepper-current-name">{steps[currentStep]}</span>
      </p>
      <ol className="booking-stepper-list">
        {steps.map((name, i) => (
          <li key={name}>
            <Button
              type="button"
              variant="ghost"
              disabled={i > currentStep}
              aria-current={i === currentStep ? "step" : undefined}
              aria-label={`${name}, paso ${i + 1} de ${steps.length}: ${i < currentStep ? "completado, volver a este paso" : i === currentStep ? "actual" : "pendiente"}`}
              onClick={() => onStepChange(i)}
              className={`booking-stepper-step ${i === currentStep ? "is-current" : i < currentStep ? "is-complete" : "is-pending"}`}
            >
              <span className="booking-stepper-identity" aria-hidden="true">
                <span className="booking-stepper-status">
                  {i < currentStep ? <Check size={14} /> : String(i + 1).padStart(2, "0")}
                </span>
                <span>{name}</span>
              </span>
              <span className="booking-stepper-segment" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

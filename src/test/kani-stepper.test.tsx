import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookingStepper } from "@/components/kani/booking-stepper";

afterEach(cleanup);

describe("Reservation stepper navigation and accessible progress", () => {
  it("exposes one current step and keeps future steps disabled", () => {
    const onStepChange = vi.fn();
    render(<BookingStepper currentStep={2} onStepChange={onStepChange} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(6);
    expect(buttons[2]).toHaveAttribute("aria-current", "step");
    expect(
      screen.getAllByRole("button").filter((button) => button.hasAttribute("aria-current")),
    ).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(
      "Servicio, paso 1 de 6: completado, volver a este paso",
    );
    expect(buttons[2]).toHaveAccessibleName("Fecha, paso 3 de 6: actual");
    for (const button of buttons.slice(3)) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(onStepChange).not.toHaveBeenCalled();
    fireEvent.click(buttons[0]);
    expect(onStepChange).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("updates the announced step and visitable steps after advancing or returning", () => {
    const onStepChange = vi.fn();
    const { container, rerender } = render(
      <BookingStepper currentStep={0} onStepChange={onStepChange} />,
    );
    const summary = container.querySelector('[aria-live="polite"]');
    expect(summary).toHaveTextContent("Paso 01 de 6Servicio");
    rerender(<BookingStepper currentStep={5} onStepChange={onStepChange} />);
    expect(summary).toHaveTextContent("Paso 06 de 6Resumen");
    expect(screen.getAllByRole("button").every((button) => !button.hasAttribute("disabled"))).toBe(
      true,
    );
    rerender(<BookingStepper currentStep={1} onStepChange={onStepChange} />);
    expect(summary).toHaveTextContent("Paso 02 de 6Barbero");
    expect(screen.getByRole("button", { name: "Fecha, paso 3 de 6: pendiente" })).toBeDisabled();
    expect(screen.getByRole("navigation", { name: "Progreso de la reserva" })).toBeInTheDocument();
  });
});

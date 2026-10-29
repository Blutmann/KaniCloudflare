import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { PaywayBooking } from '@/components/kani/experimental/payway-booking';
import { KaniProvider } from '@/components/kani/store';

describe('Reserva V4 — Pantalla final "Turno confirmado"', () => {
  const confirmedFixture = {
    appointmentId: 'apt-test-confirmed-123',
    attemptId: 'att-test-456',
    serviceName: 'Corte',
    barber: 'Lautaro',
    date: '2026-10-30',
    time: '15:30',
    clientName: 'Tomás',
    depositArs: 5000,
    servicePriceArs: 25000,
  };

  beforeEach(() => {
    sessionStorage.setItem('kani:payway:confirmed-booking', JSON.stringify(confirmedFixture));
  });

  afterEach(() => {
    sessionStorage.clear();
    cleanup();
  });

  it('1. Elimina texto redundante "Tu turno está confirmado." y muestra exactamente "Te enviamos la confirmación por mail."', () => {
    render(
      <KaniProvider>
        <PaywayBooking />
      </KaniProvider>
    );

    expect(screen.getByRole('heading', { name: 'Turno confirmado' })).toBeInTheDocument();
    // Debe haber sido eliminado completamente
    expect(screen.queryByText('Tu turno está confirmado.')).not.toBeInTheDocument();
    // Copy exacto requerido
    expect(screen.getByText('Te enviamos la confirmación por mail.')).toBeInTheDocument();
  });

  it('2. Conserva todos los datos del resumen del turno con valores y seña/saldo calculados', () => {
    render(
      <KaniProvider>
        <PaywayBooking />
      </KaniProvider>
    );

    expect(screen.getByText('Servicio')).toBeInTheDocument();
    expect(screen.getByText('Corte')).toBeInTheDocument();

    expect(screen.getByText('Barbero')).toBeInTheDocument();
    expect(screen.getByText('Lautaro')).toBeInTheDocument();

    expect(screen.getByText('Fecha')).toBeInTheDocument();
    expect(screen.getByText(/30 de octubre/i)).toBeInTheDocument();

    expect(screen.getByText('Horario')).toBeInTheDocument();
    expect(screen.getByText('15:30')).toBeInTheDocument();

    expect(screen.getByText('Seña abonada')).toBeInTheDocument();
    expect(screen.getByText('$5.000')).toBeInTheDocument();

    expect(screen.getByText('Saldo restante del servicio')).toBeInTheDocument();
    expect(screen.getByText('$20.000')).toBeInTheDocument();
  });

  it('3. Muestra la información del estudio y el mapa compacto con iframe oficial', () => {
    render(
      <KaniProvider>
        <PaywayBooking />
      </KaniProvider>
    );

    expect(screen.getByRole('heading', { name: 'Kani Barber Studio' })).toBeInTheDocument();
    expect(screen.getByText('San Isidro Labrador 7 · Martínez, Provincia de Buenos Aires')).toBeInTheDocument();

    const mapIframe = screen.getByTitle('Ubicación de Kani Barber Studio en Google Maps');
    expect(mapIframe).toBeInTheDocument();
    expect(mapIframe).toHaveAttribute('src', expect.stringContaining('cid=5241343871369591392'));
    expect(mapIframe).toHaveAttribute('loading', 'lazy');
  });

  it('4. Verifica el orden estricto de acciones: "Ver ubicación" e "Instagram" primero, y "Volver al inicio" al final', () => {
    const { container } = render(
      <KaniProvider>
        <PaywayBooking />
      </KaniProvider>
    );

    const actionsContainer = container.querySelector('.confirmation-actions');
    expect(actionsContainer).toBeInTheDocument();

    const links = actionsContainer?.querySelectorAll('a');
    expect(links).toHaveLength(2);
    expect(links?.[0]?.textContent).toContain('Ver ubicación');
    expect(links?.[1]?.textContent).toContain('Instagram');

    // Volver al inicio debe ser el botón final
    const homeBtn = screen.getByRole('button', { name: 'Volver al inicio' });
    expect(homeBtn).toBeInTheDocument();

    // Comprobar orden en el DOM
    const allInteractive = actionsContainer?.querySelectorAll('a, button');
    expect(allInteractive?.[0]?.textContent).toContain('Ver ubicación');
    expect(allInteractive?.[1]?.textContent).toContain('Instagram');
    expect(allInteractive?.[2]?.textContent).toContain('Volver al inicio');

    // Click en Volver al inicio reinicia la reserva
    fireEvent.click(homeBtn);
    expect(sessionStorage.getItem('kani:payway:confirmed-booking')).toBeNull();
  });
});

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

  it('3. Muestra "¿Dónde estamos?", dirección abreviada sin provincia y ausencia del encabezado redundante "Kani Barber Studio"', () => {
    const { container } = render(
      <KaniProvider>
        <PaywayBooking />
      </KaniProvider>
    );

    const placeSection = container.querySelector('.confirmation-place');
    expect(placeSection).toBeInTheDocument();

    // Debe mostrar exactamente '¿Dónde estamos?'
    expect(screen.getByRole('heading', { name: '¿Dónde estamos?' })).toBeInTheDocument();

    // No debe figurar 'Kani Barber Studio' como heading dentro del bloque de confirmación
    const confirmationH2s = container.querySelectorAll('.confirmation h2');
    const h2Texts = Array.from(confirmationH2s).map((h) => h.textContent?.trim());
    expect(h2Texts).not.toContain('Kani Barber Studio');

    // Dirección abreviada sin 'Provincia de Buenos Aires' en la sección de confirmación
    expect(placeSection?.textContent).toContain('San Isidro Labrador 7 · Martínez');
    expect(placeSection?.textContent).not.toContain('Provincia de Buenos Aires');

    // Mapa embebido oficial
    const mapIframe = screen.getByTitle('Ubicación de Kani Barber Studio en Google Maps');
    expect(mapIframe).toBeInTheDocument();
    expect(mapIframe).toHaveAttribute('src', expect.stringContaining('cid=5241343871369591392'));
    expect(mapIframe).toHaveAttribute('loading', 'lazy');
  });

  it('4. Verifica el orden estricto de acciones: "Cómo llegar" e "Instagram" primero, y "Volver al inicio" al final compartiendo la misma retícula', () => {
    const { container } = render(
      <KaniProvider>
        <PaywayBooking />
      </KaniProvider>
    );

    const gridContainer = container.querySelector('.confirmation-grid');
    expect(gridContainer).toBeInTheDocument();

    const actionsContainer = container.querySelector('.confirmation-actions');
    expect(actionsContainer).toBeInTheDocument();
    expect(gridContainer?.contains(actionsContainer!)).toBe(true);

    const links = actionsContainer?.querySelectorAll('a');
    expect(links).toHaveLength(2);
    expect(links?.[0]?.textContent).toContain('Cómo llegar');
    expect(links?.[0]?.getAttribute('href')).toContain('maps');
    expect(links?.[1]?.textContent).toContain('Instagram');
    expect(links?.[1]?.getAttribute('href')).toContain('instagram.com/kanibarberstudio');

    // No debe existir el texto 'Ver ubicación'
    expect(actionsContainer?.textContent).not.toContain('Ver ubicación');

    // Volver al inicio debe ser el botón final
    const homeBtn = screen.getByRole('button', { name: 'Volver al inicio' });
    expect(homeBtn).toBeInTheDocument();

    // Comprobar orden en el DOM
    const allInteractive = actionsContainer?.querySelectorAll('a, button');
    expect(allInteractive?.[0]?.textContent).toContain('Cómo llegar');
    expect(allInteractive?.[1]?.textContent).toContain('Instagram');
    expect(allInteractive?.[2]?.textContent).toContain('Volver al inicio');

    // Click en Volver al inicio reinicia la reserva
    fireEvent.click(homeBtn);
    expect(sessionStorage.getItem('kani:payway:confirmed-booking')).toBeNull();
  });
});

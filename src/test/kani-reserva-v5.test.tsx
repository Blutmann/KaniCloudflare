import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { PaywayBookingV5 } from '@/components/kani/experimental/payway-booking-v5';
import { PaywayBooking } from '@/components/kani/experimental/payway-booking';
import { Booking } from '@/components/kani/booking';
import { KaniProvider } from '@/components/kani/store';

describe('Reserva V5 — Clonación funcional, aislamiento y claridad visual', () => {
  const confirmedFixtureV5 = {
    appointmentId: 'apt-v5-test-123',
    attemptId: 'att-v5-456',
    serviceName: 'Corte',
    barber: 'Lautaro',
    date: '2026-10-30',
    time: '16:00',
    clientName: 'Martín',
    depositArs: 5000,
    servicePriceArs: 25000,
  };

  afterEach(() => {
    sessionStorage.clear();
    cleanup();
  });

  it('1. Renderiza los 5 pasos en el stepper de Booking variant="v5" con clases aisladas booking-v5', () => {
    const { container } = render(
      <KaniProvider>
        <Booking variant="v5" />
      </KaniProvider>
    );

    const bookingPage = container.querySelector('.booking-page');
    expect(bookingPage).toHaveClass('booking-v5');

    const progress = container.querySelector('.booking-progress');
    expect(progress).toBeInTheDocument();
    expect(progress).toHaveAttribute('aria-label', expect.stringContaining('Paso 1 de 5: Servicio'));

    const stepButtons = progress?.querySelectorAll('button');
    expect(stepButtons).toHaveLength(5);
    const stepNames = Array.from(stepButtons ?? []).map(b => b.querySelector('small')?.textContent);
    expect(stepNames).toEqual(['Servicio', 'Barbero', 'Fecha', 'Horario', 'Datos']);

    // Verifica que se muestren los servicios disponibles
    expect(screen.getByText('Corte')).toBeInTheDocument();
    expect(screen.getByText('Barba')).toBeInTheDocument();
    expect(screen.getByText('Corte y barba')).toBeInTheDocument();
  });

  it('2. PaywayBookingV5 renderiza la pantalla final "Turno confirmado" cuando kani:payway:confirmed-booking:v5 está presente', () => {
    sessionStorage.setItem('kani:payway:confirmed-booking:v5', JSON.stringify(confirmedFixtureV5));

    const { container } = render(
      <KaniProvider>
        <PaywayBookingV5 />
      </KaniProvider>
    );

    const wrapper = container.querySelector('.payway-reservation-v5.reserva-v5');
    expect(wrapper).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Turno confirmado' })).toBeInTheDocument();
    expect(screen.queryByText('Tu turno está confirmado.')).not.toBeInTheDocument();
    expect(screen.getByText('Te enviamos la confirmación por mail.')).toBeInTheDocument();

    // Verificación de detalles del turno
    expect(screen.getByText('Corte')).toBeInTheDocument();
    expect(screen.getByText('Lautaro')).toBeInTheDocument();
    expect(screen.getByText('16:00')).toBeInTheDocument();
    expect(screen.getByText('$5.000')).toBeInTheDocument();
    expect(screen.getByText('$20.000')).toBeInTheDocument();

    // Verificación de ubicación
    expect(screen.getByRole('heading', { name: '¿Dónde estamos?' })).toBeInTheDocument();
    expect(screen.getByText(/San Isidro Labrador 7 · Martínez/)).toBeInTheDocument();

    // Acciones: Cómo llegar, Instagram, Volver al inicio
    const actions = container.querySelector('.confirmation-actions');
    expect(actions).toBeInTheDocument();
    const allInteractive = actions?.querySelectorAll('a, button');
    expect(allInteractive?.[0]?.textContent).toContain('Cómo llegar');
    expect(allInteractive?.[1]?.textContent).toContain('Instagram');
    expect(allInteractive?.[2]?.textContent).toContain('Volver al inicio');

    // Click en Volver al inicio limpia la clave de V5
    const homeBtn = screen.getByRole('button', { name: 'Volver al inicio' });
    fireEvent.click(homeBtn);
    expect(sessionStorage.getItem('kani:payway:confirmed-booking:v5')).toBeNull();
  });

  it('3. Garantiza aislamiento estricto de sessionStorage entre V4 y V5', () => {
    // Almacenamos turno confirmado en la clave de V4 únicamente
    sessionStorage.setItem('kani:payway:confirmed-booking', JSON.stringify(confirmedFixtureV5));

    // Renderizamos V5: debe ignorar la clave de V4 y comenzar en el paso 1 (Servicio)
    const { unmount: unmountV5 } = render(
      <KaniProvider>
        <PaywayBookingV5 />
      </KaniProvider>
    );

    expect(screen.queryByText('Turno confirmado')).not.toBeInTheDocument();
    expect(screen.getByText('Elegí un servicio')).toBeInTheDocument();
    unmountV5();
    sessionStorage.clear();

    // Almacenamos turno en la clave de V5 únicamente
    sessionStorage.setItem('kani:payway:confirmed-booking:v5', JSON.stringify(confirmedFixtureV5));

    // Renderizamos V4: debe ignorar la clave de V5 y comenzar en el paso 1
    render(
      <KaniProvider>
        <PaywayBooking />
      </KaniProvider>
    );

    expect(screen.queryByText('Turno confirmado')).not.toBeInTheDocument();
    expect(screen.getByText('Elegí un servicio')).toBeInTheDocument();
  });

  it('4. Paso 1 y Paso 2: Selección de servicio, barbero y opción clara de barbero diferido', () => {
    render(
      <KaniProvider>
        <Booking variant="v5" />
      </KaniProvider>
    );

    // Selección de Servicio "Corte"
    const corteBtn = screen.getByRole('button', { name: /Corte, 45 minutos/i });
    expect(corteBtn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(corteBtn);
    expect(corteBtn).toHaveAttribute('aria-pressed', 'true');

    // Avanzar a Paso 2 (Barbero)
    const continuarBtn = screen.getByRole('button', { name: 'Continuar' });
    fireEvent.click(continuarBtn);

    // Verificar que estamos en Paso 2
    expect(screen.getByText('Elegí un barbero')).toBeInTheDocument();
    expect(screen.getByText('Lautaro')).toBeInTheDocument();
    expect(screen.getByText('Gonzalo')).toBeInTheDocument();
    expect(screen.getByText('Valentín')).toBeInTheDocument();

    // Opción no personificada de barbero diferido
    const deferBtn = screen.getByRole('button', { name: /Cualquier barbero disponible/i });
    expect(deferBtn).toBeInTheDocument();
    expect(screen.getByText('El sistema asignará según fecha y horario')).toBeInTheDocument();
    fireEvent.click(deferBtn);
    expect(deferBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('5. Paso 5 y Resumen: Validación contextual, campos requeridos con asterisco y aviso de confirmación', () => {
    const { container } = render(
      <KaniProvider>
        <Booking variant="v5" />
      </KaniProvider>
    );

    // Seleccionar servicio
    fireEvent.click(screen.getByRole('button', { name: /Corte, 45 minutos/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    // Seleccionar barbero
    fireEvent.click(screen.getByRole('button', { name: /Barbero Lautaro/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    // En paso de fecha, los elementos obligatorios se van acumulando
    expect(screen.getByText('Elegí una fecha')).toBeInTheDocument();
    expect(container.querySelector('.calendar-panel')).toBeInTheDocument();
  });

  it('6. Pantalla final de V5: Estructura 50/50 y acciones unificadas', () => {
    const testAppointment = {
      appointmentId: 'test-v5-confirmed',
      serviceName: 'Corte',
      barber: 'Lautaro',
      date: '2026-11-05',
      time: '14:00',
      depositArs: 5000,
      servicePriceArs: 25000,
      clientName: 'Cliente V5',
    };
    sessionStorage.setItem('kani:payway:confirmed-booking:v5', JSON.stringify(testAppointment));

    const { container } = render(
      <KaniProvider>
        <PaywayBookingV5 />
      </KaniProvider>
    );

    // Encabezados
    expect(screen.getByRole('heading', { level: 1, name: 'Turno confirmado' })).toBeInTheDocument();
    expect(screen.getByText('Te enviamos la confirmación por mail.')).toBeInTheDocument();

    // Ubicación y mapa
    expect(screen.getByText('¿Dónde estamos?')).toBeInTheDocument();
    expect(screen.getByText('San Isidro Labrador 7 · Martínez')).toBeInTheDocument();
    const iframe = container.querySelector('iframe.confirmation-map-iframe');
    expect(iframe).toBeInTheDocument();

    // Botonera de acciones
    const directionsLink = screen.getByRole('link', { name: /Cómo llegar/i });
    const instagramLink = screen.getByRole('link', { name: /Instagram/i });
    const homeBtn = screen.getByRole('button', { name: 'Volver al inicio' });
    expect(directionsLink).toBeInTheDocument();
    expect(instagramLink).toBeInTheDocument();
    expect(homeBtn).toBeInTheDocument();

    // Verificación de orden DOM
    const actions = container.querySelector('.confirmation-actions');
    expect(actions).toBeInTheDocument();
    const actionChildren = actions ? Array.from(actions.children) : [];
    expect(actionChildren[0]).toContainElement(directionsLink);
    expect(actionChildren[1]).toContainElement(instagramLink);
    expect(actionChildren[2]).toBe(homeBtn);
  });

  it('7. CSS de Reserva V5: Contiene reglas responsive para mobile 360x800 y desktop 50/50', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const cssContent = fs.readFileSync(path.resolve(__dirname, '../components/kani/experimental/reserva-v5.css'), 'utf-8');

    // Desktop grid areas
    expect(cssContent).toContain('grid-template-areas');
    expect(cssContent).toContain('".       place"');
    expect(cssContent).toContain('"summary map"');
    expect(cssContent).toContain('"actions actions"');

    // Mobile 360x800 compact geometry
    expect(cssContent).toContain('max-width: 859px');
    expect(cssContent).toContain('max-width: 767px');
    expect(cssContent).toContain('min-height: 44px');

    // Light and Dark theme custom properties
    expect(cssContent).toContain("html[data-theme='light'] .booking-page.booking-v5");
    expect(cssContent).toContain("html[data-theme='dark'] .booking-page.booking-v5");
    expect(cssContent).toContain('--v5-surface');
    expect(cssContent).toContain('--v5-text-gold');
  });

  it('8. Accesibilidad visual y sistema monocromático en modo claro (Blanco, Negro Carbón #181818 y Grises Neutros)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const cssContent = fs.readFileSync(path.resolve(__dirname, '../components/kani/experimental/reserva-v5.css'), 'utf-8');

    // 1. Modo claro: variables de paleta monocromática de referencia
    expect(cssContent).toContain("--v5-text-primary: #181818;");
    expect(cssContent).toContain("--v5-text-muted: #595959;");
    expect(cssContent).toContain("--v5-border: #B8B8B8;");
    expect(cssContent).toContain("--v5-selected-card-bg: #F2F2F2;");
    expect(cssContent).toContain("--v5-selected-card-border: #181818;");

    // 2. Modo claro: duración y textos secundarios deben ser grises neutros legibles (#595959), NO blancos
    expect(cssContent).toContain("html[data-theme='light'] .booking-page.booking-v5 .booking-option.selected .text-muted-foreground");
    expect(cssContent).toContain("color: #595959 !important;");

    // 3. Modo claro: precio en tarjeta seleccionada debe ser negro carbón (#181818) font-weight 700
    expect(cssContent).toContain("html[data-theme='light'] .booking-page.booking-v5 .booking-option.selected .booking-option-price");
    expect(cssContent).toContain("color: #181818 !important;");

    // 4. Modo claro: círculo de selección debe ser negro carbón #181818 con check blanco #FFFFFF
    expect(cssContent).toContain("html[data-theme='light'] .booking-page.booking-v5 .booking-option.selected .selection-circle");
    expect(cssContent).toContain("background-color: #181818 !important;");
    expect(cssContent).toContain("color: #FFFFFF !important;");

    // 5. Modo claro: CTA principal (Continuar, Volver al inicio) con fondo #181818 y texto blanco
    expect(cssContent).toContain("html[data-theme='light'] .booking-page.booking-v5 .booking-next-button:not(:disabled)");
    expect(cssContent).toContain("html[data-theme='light'] .reserva-v5 .confirmation-home");

    // 6. Modo claro: pantalla final badge de check en negro carbón #181818 con check blanco #FFFFFF
    expect(cssContent).toContain("html[data-theme='light'] .reserva-v5 .confirmation-mark");

    // 7. Modo oscuro: preserva dorado #D4AF37 y textos claros sobre fondo oscuro
    expect(cssContent).toContain("html[data-theme='dark'] .booking-page.booking-v5 .booking-option.selected .booking-option-duration");
    expect(cssContent).toContain("color: #BDB7AB !important;");
    expect(cssContent).toContain("html[data-theme='dark'] .booking-page.booking-v5 .booking-option.selected .selection-circle");
    expect(cssContent).toContain("background-color: #D4AF37 !important;");
    expect(cssContent).toContain("color: #191919 !important;");
  });
});

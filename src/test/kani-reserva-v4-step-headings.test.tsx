import { describe, expect, it } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { BookingStepHeading } from '@/components/kani/booking-step-heading';

describe('BookingStepHeading — Unificación estructural de encabezados de Reserva V4', () => {
  const reservaV4CssPath = path.resolve(__dirname, '../components/kani/experimental/reserva-v4.css');
  const reservaV5CssPath = path.resolve(__dirname, '../components/kani/experimental/reserva-v5.css');
  const cssV4 = fs.readFileSync(reservaV4CssPath, 'utf-8');
  const cssV5 = fs.readFileSync(reservaV5CssPath, 'utf-8');

  it('1. Todos los pasos utilizan el componente compartido BookingStepHeading con elemento semántico h1', () => {
    const steps = [
      { index: 0, title: 'Elegí un servicio' },
      { index: 1, title: 'Elegí un barbero' },
      { index: 2, title: 'Elegí una fecha' },
      { index: 3, title: 'Elegí un horario', secondary: <span data-testid="date-badge">Viernes 30 Oct.</span> },
      { index: 4, title: 'Completá tus datos' },
    ];

    steps.forEach(({ index, title, secondary }) => {
      cleanup();
      const { container } = render(
        <BookingStepHeading title={title} stepIndex={index} secondary={secondary} />
      );

      const headingElement = within(container).getByRole('heading', { level: 1 });
      expect(headingElement).toBeInTheDocument();
      expect(headingElement.tagName).toBe('H1');
      expect(headingElement).toHaveTextContent(title);
      expect(headingElement).toHaveClass('booking-step-heading-title');
      expect(headingElement).toHaveClass('section-title');

      const rowElement = container.querySelector('.booking-step-heading');
      expect(rowElement).toBeInTheDocument();
      expect(rowElement).toHaveClass('booking-title-row');

      const innerElement = container.querySelector('.booking-step-heading-inner');
      expect(innerElement).toBeInTheDocument();
      expect(innerElement?.firstElementChild).toBe(headingElement);
    });
  });

  it('2. El texto del título cambia según el paso y no contiene elementos anidados', () => {
    const { rerender } = render(<BookingStepHeading title="Elegí un servicio" stepIndex={0} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Elegí un servicio');

    rerender(<BookingStepHeading title="Elegí un barbero" stepIndex={1} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Elegí un barbero');

    rerender(<BookingStepHeading title="Elegí una fecha" stepIndex={2} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Elegí una fecha');

    rerender(
      <BookingStepHeading
        title="Elegí un horario"
        stepIndex={3}
        secondary={<span className="booking-time-heading-date">Viernes 30 Oct.</span>}
      />
    );
    // El H1 contiene exclusivamente el texto del título sin mezclar la fecha secundaria
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Elegí un horario');
    expect(h1).not.toHaveTextContent('Viernes 30 Oct.');

    rerender(<BookingStepHeading title="Completá tus datos" stepIndex={4} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Completá tus datos');
  });

  it('3. La fecha secundaria en Horarios se ubica en un elemento independiente fuera del h1', () => {
    const { container } = render(
      <BookingStepHeading
        title="Elegí un horario"
        stepIndex={3}
        secondary={<span className="booking-time-heading-date">Viernes 30 Oct.</span>}
      />
    );

    const h1 = screen.getByRole('heading', { level: 1 });
    const secondaryAside = container.querySelector('.booking-step-heading-secondary');
    expect(secondaryAside).toBeInTheDocument();
    expect(secondaryAside).toHaveTextContent('Viernes 30 Oct.');

    // El aside es hermano del H1, no hijo
    expect(h1.contains(secondaryAside)).toBe(false);
  });

  it('4. CSS centraliza reglas idénticas para todos los encabezados (BookingStepHeading)', () => {
    // Mobile: 22px, font-display, 500 weight, 1.2 line-height, 0.01em letter-spacing para TODOS los encabezados
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-page\s+\.booking-step-heading-title\.section-title[^}]*font-family:\s*var\(--font-display\)\s*!important;/
    );
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-page\s+\.booking-step-heading-title\.section-title[^}]*font-size:\s*22px\s*!important;/
    );
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-page\s+\.booking-step-heading-title\.section-title[^}]*font-weight:\s*500\s*!important;/
    );
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-page\s+\.booking-step-heading-title\.section-title[^}]*line-height:\s*1\.2\s*!important;/
    );
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-page\s+\.booking-step-heading-title\.section-title[^}]*letter-spacing:\s*0\.01em\s*!important;/
    );

    // Desktop: 28px para todos los encabezados unificados
    expect(cssV4).toMatch(
      /@media\s*\(min-width:\s*768px\)[\s\S]*?\.payway-reservation\s+\.booking-page\s+\.booking-step-heading-title\.section-title[^}]*font-size:\s*28px\s*!important;/
    );
  });

  it('5. Alineación y espaciado consistentes: todos los títulos parten del mismo origen y márgenes', () => {
    // Contenedor compartido tiene margin-top: 0, margin-bottom: 16px, padding-top: 4px
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-page\s+\.booking-step-heading[^}]*margin-top:\s*0\s*!important;/
    );
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-page\s+\.booking-step-heading[^}]*margin-bottom:\s*16px\s*!important;/
    );
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-page\s+\.booking-step-heading[^}]*padding-top:\s*4px\s*!important;/
    );

    // Inner container usa baseline alignment y flex-wrap: wrap para soportar 360px sin modificar el H1
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-page\s+\.booking-step-heading-inner\s*\{[\s\S]*?align-items:\s*baseline\s*!important;/
    );
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-page\s+\.booking-step-heading-inner\s*\{[\s\S]*?flex-wrap:\s*wrap\s*!important;/
    );
  });

  it('6. Aislamiento: /reserva-v5 permanece intacta', () => {
    expect(cssV5).not.toContain('booking-step-heading');
  });
});

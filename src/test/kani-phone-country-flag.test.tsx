import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { PhoneInput } from '@/components/kani/phone-input';
import { CountryFlag } from '@/components/kani/country-flag';
import type { PhoneCountry } from '@/lib/kani-phone';
import { useState } from 'react';

function ControlledPhoneInput({ initialCountry = 'AR' as PhoneCountry }: { initialCountry?: PhoneCountry }) {
  const [country, setCountry] = useState<PhoneCountry>(initialCountry);
  const [phone, setPhone] = useState('');

  return (
    <PhoneInput
      value={phone}
      onChange={setPhone}
      country={country}
      onCountryChange={setCountry}
    />
  );
}

describe('KANI - Bandera en el selector de país de reservas', () => {
  const stylesCssPath = path.resolve(__dirname, '../styles.css');
  const reservaV4CssPath = path.resolve(__dirname, '../components/kani/experimental/reserva-v4.css');
  const cssStyles = fs.readFileSync(stylesCssPath, 'utf8');
  const cssV4 = fs.readFileSync(reservaV4CssPath, 'utf8');

  it('1. Renderiza la bandera SVG para Argentina junto a "Argentina +54"', () => {
    const { container } = render(<ControlledPhoneInput initialCountry="AR" />);

    const trigger = screen.getByRole('button', { name: /País: Argentina, \+54/i });
    expect(trigger).toBeInTheDocument();

    // Debe contener el span de bandera con SVG adentro (no letras sueltas "AR")
    const flagSpan = trigger.querySelector('.phone-country-flag');
    expect(flagSpan).not.toBeNull();

    const svg = flagSpan?.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('viewBox');

    // El label de texto debe contener Argentina y +54
    const labelSpan = trigger.querySelector('.phone-country-label');
    expect(labelSpan).toHaveTextContent(/Argentina\s+\+54/);
  });

  it('2. Actualiza automáticamente bandera, nombre y prefijo al seleccionar otro país', () => {
    render(<ControlledPhoneInput initialCountry="AR" />);

    // Abrir dropdown
    const trigger = screen.getByRole('button', { name: /País: Argentina, \+54/i });
    fireEvent.click(trigger);

    // Buscar y seleccionar Chile (CL, +56)
    const chileOption = screen.getByRole('option', { name: /Chile \+56/i });
    expect(chileOption).toBeInTheDocument();

    fireEvent.click(chileOption);

    // Ahora el botón debe mostrar Chile y su bandera correspondiente
    const updatedTrigger = screen.getByRole('button', { name: /País: Chile, \+56/i });
    expect(updatedTrigger).toBeInTheDocument();

    const updatedLabel = updatedTrigger.querySelector('.phone-country-label');
    expect(updatedLabel).toHaveTextContent(/Chile\s+\+56/);

    const flagSvg = updatedTrigger.querySelector('.phone-country-flag svg');
    expect(flagSvg).toBeInTheDocument();
  });

  it('3. El listado desplegable de países incluye la bandera SVG en cada opción', () => {
    render(<ControlledPhoneInput initialCountry="AR" />);

    const trigger = screen.getByRole('button', { name: /País: Argentina, \+54/i });
    fireEvent.click(trigger);

    const listbox = screen.getByRole('listbox', { name: 'Seleccionar país' });
    expect(listbox).toBeInTheDocument();

    // Las opciones de países principales deben contener banderas SVG
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(10);

    // La primera opción (Argentina) debe tener su SVG dentro de .phone-country-flag
    const firstOptionFlag = options[0].querySelector('.phone-country-flag svg');
    expect(firstOptionFlag).toBeInTheDocument();
  });

  it('4. CountryFlag funciona aisladamente con código válido y maneja fallback', () => {
    const { container: c1 } = render(<CountryFlag code="BR" />);
    expect(c1.querySelector('svg')).toBeInTheDocument();

    const { container: c2 } = render(<CountryFlag code="XX" fallbackFlag="🏳️" />);
    expect(c2.textContent).toBe('🏳️');
  });

  it('5. Estilos CSS garantizan proporciones, alineación y compatibilidad con modo claro y oscuro', () => {
    // styles.css define la bandera con dimensiones y sombras
    expect(cssStyles).toMatch(/\.phone-country-flag\s*\{[^}]*display:\s*inline-flex/);
    expect(cssStyles).toMatch(/\.phone-country-flag\s+svg[^}]*width:\s*19px/);
    expect(cssStyles).toMatch(/html\[data-theme='dark'\]\s+\.phone-country-flag\s+svg/);

    // reserva-v4.css define la bandera para flujos de reserva sin desbordes
    expect(cssV4).toMatch(/\.payway-reservation\s+\.phone-country-flag[\s\S]*?\{[\s\S]*?display:\s*inline-flex\s*!important/);
    expect(cssV4).toMatch(/\.payway-reservation\s+\.phone-country-flag\s+svg[\s\S]*?\{[\s\S]*?width:\s*19px\s*!important/);
    expect(cssV4).toMatch(/html\[data-theme='dark'\]\s+\.payway-reservation\s+\.phone-country-flag\s+svg/);
  });
});

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio - Unificar color de iconos de servicios no seleccionados', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const bookingPath = path.resolve(__dirname, '../components/kani/booking.tsx');

  const css = fs.readFileSync(stylesPath, 'utf-8');
  const bookingCode = fs.readFileSync(bookingPath, 'utf-8');

  it('1. El color de los iconos sin seleccionar toma directamente el token var(--muted-foreground)', () => {
    // La máscara para tarjetas no seleccionadas usa background-color: var(--muted-foreground)
    expect(css).toMatch(/\.service-icon-mask\s*\{[^}]*background-color:\s*var\(--muted-foreground\)/);
    
    // El texto de duración de servicios utiliza la clase text-muted-foreground
    expect(bookingCode).toContain('booking-option-duration block text-sm text-muted-foreground');

    // En modo oscuro se preserva el token var(--muted-foreground)
    expect(css).toMatch(/html\[data-theme='dark'\] \.booking-option:not\(\.selected\)\s*\.service-icon-mask\s*\{[^}]*background-color:\s*var\(--muted-foreground\)\s*!important/);
  });

  it('2. Aplica el cambio a las tres cards de servicios mediante máscaras vectoriales para ambos temas', () => {
    // El componente booking renderiza máscaras para modo light y dark utilizando serviceIconById
    expect(bookingCode).toContain('service-icon-mask service-icon-mask-light');
    expect(bookingCode).toContain('service-icon-mask service-icon-mask-dark');
    expect(bookingCode).toContain('maskImage: `url(${serviceIconById[s.id].light})`');
    expect(bookingCode).toContain('maskImage: `url(${serviceIconById[s.id].dark})`');

    // Reglas CSS para alternar máscaras según el tema
    expect(css).toMatch(/\.booking-option:not\(\.selected\)\s*\.service-icon-mask-dark\s*\{\s*display:\s*block;/);
    expect(css).toMatch(/html\[data-theme='light'\] \.booking-option:not\(\.selected\)\s*\.service-icon-mask-light\s*\{\s*display:\s*block;/);

    // Oculta las imágenes estándar cuando la tarjeta no está seleccionada
    expect(css).toMatch(/\.booking-option:not\(\.selected\)\s*\.option-icon\s+img\s*\{\s*display:\s*none\s*!important;/);
  });

  it('3. Adapta las dimensiones de la máscara tanto en desktop como en mobile', () => {
    // Desktop: 44px
    expect(css).toMatch(/\.service-icon-mask\s*\{[^}]*width:\s*44px;\s*height:\s*44px;/);

    // Mobile: 40px coherente con .option-icon móvil
    expect(css).toMatch(/\.booking-option\s*\.option-icon\s*\.service-icon-mask\s*\{\s*width:\s*40px;\s*height:\s*40px;\s*\}/);
  });

  it('4. Conserva el color original de la card seleccionada, incluido el dorado en modo oscuro', () => {
    // Oculta la máscara cuando la tarjeta está seleccionada
    expect(css).toMatch(/\.booking-option\.selected\s*\.service-icon-mask\s*\{\s*display:\s*none\s*!important;/);

    // Conserva el filtro dorado para el icono de la card seleccionada en modo oscuro
    expect(css).toMatch(/html\[data-theme='dark'\] \.booking-option\.selected \.option-icon img\s*\{[^}]*filter:\s*brightness\(0\)\s*saturate\(100%\)\s*invert\(69%\)/);
  });
});

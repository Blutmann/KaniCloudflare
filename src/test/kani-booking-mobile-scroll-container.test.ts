import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio - Arquitectura de Scroll Mobile y Resumen Compacto', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const bookingPath = path.resolve(__dirname, '../components/kani/booking.tsx');

  const css = fs.readFileSync(stylesPath, 'utf-8');
  const bookingCode = fs.readFileSync(bookingPath, 'utf-8');

  it('1. El scroll container central .booking-scroll-content está presente y resetea scrollTop = 0 en cambios de paso', () => {
    // booking.tsx contiene la referencia al contenedor de scroll y su reseteo en cambios de step
    expect(bookingCode).toContain('const scrollContainerRef = useRef<HTMLDivElement>(null);');
    expect(bookingCode).toContain('const prevStepRef = useRef(step);');
    expect(bookingCode).toContain('if (prevStepRef.current !== step)');
    expect(bookingCode).toContain('scrollContainerRef.current.scrollTop = 0;');
    expect(bookingCode).toContain('ref={scrollContainerRef}');
    expect(bookingCode).toContain('className="booking-scroll-content"');

    // No debe contener timers artificiales que compitan con el scroll
    expect(bookingCode).not.toContain("window.visualViewport.addEventListener('resize'");
    expect(bookingCode).not.toContain('window.scrollY > maxScroll');
  });

  it('2. Header y Stepper no forman parte del contenido scrolleable en Mobile', () => {
    // Stepper y Header tienen flex: 0 0 auto en mobile
    expect(css).toMatch(/booking-flow-active\s*\.site-header[^{]*\{[^}]*flex:\s*0 0 72px !important/);
    expect(css).toMatch(/booking-flow-active\s*\.booking-progress[^{]*\{[^}]*flex:\s*0 0 auto !important/);
  });

  it('3. .booking-scroll-content es el único scroll container vertical con overflow-y: auto y momentum touch', () => {
    expect(css).toMatch(/booking-flow-active\s*\.booking-scroll-content[^{]*\{[^}]*flex:\s*1 1 auto !important/);
    expect(css).toMatch(/booking-flow-active\s*\.booking-scroll-content[^{]*\{[^}]*min-height:\s*0 !important/);
    expect(css).toMatch(/booking-flow-active\s*\.booking-scroll-content[^{]*\{[^}]*overflow-y:\s*auto !important/);
    expect(css).toMatch(/booking-flow-active\s*\.booking-scroll-content[^{]*\{[^}]*-webkit-overflow-scrolling:\s*touch !important/);
    expect(css).toMatch(/booking-flow-active\s*\.booking-scroll-content[^{]*\{[^}]*overscroll-behavior-y:\s*contain !important/);
  });

  it('4. La navegación inferior CTA es estable y queda fuera del scroll container', () => {
    expect(css).toMatch(/booking-flow-active\s*\.booking-cta[^{]*\{[^}]*flex:\s*0 0 auto !important/);
    expect(css).toMatch(/booking-flow-active\s*\.booking-cta[^{]*\{[^}]*position:\s*relative !important/);
  });

  it('5. Previene doble scroll en mobile bloqueando el scroll de window', () => {
    expect(css).toMatch(/html\.booking-flow-active[^{]*\{[^}]*overflow:\s*hidden !important/);
    expect(css).toMatch(/html\.booking-flow-active[^{]*\{[^}]*overscroll-behavior:\s*none !important/);
    expect(css).toMatch(/booking-flow-active\s*\.site-shell[^{]*\{[^}]*height:\s*100dvh !important/);
  });

  it('6. Cards de Resumen compactadas respetan la densidad de los pasos anteriores', () => {
    // Padding compacto de 10px 14px en mobile
    expect(css).toMatch(/\.booking-summary-card\s*\{[^}]*padding:\s*10px 14px/);
    // Gap compacto de 8px entre cards en mobile
    expect(css).toMatch(/\.booking-summary-cards\s*\{[^}]*gap:\s*8px/);
    // Separación de listas en 5px
    expect(css).toMatch(/\.summary-details-list,\s*\.summary-pricing-list\s*\{[^}]*gap:\s*5px/);
  });
});

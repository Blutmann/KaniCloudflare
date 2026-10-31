import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  KANI_PUBLIC_WHATSAPP_NUMBER,
  KANI_PUBLIC_WHATSAPP_URL,
} from '@/lib/kani-constants';
import { buildConfirmedEmail } from '@/lib/kani-notifications.functions';

describe('Kani Barber Studio — Refinamiento de Pagos y unificación de WhatsApp público', () => {
  const root = path.resolve(__dirname, '..');
  const v2Css = fs.readFileSync(path.join(root, 'components/kani/v2/v2.css'), 'utf-8');
  const paymentsTsx = fs.readFileSync(path.join(root, 'components/kani/v2/payments.tsx'), 'utf-8');
  const siteHeaderTsx = fs.readFileSync(path.join(root, 'components/kani/site-header.tsx'), 'utf-8');
  const estudioTsx = fs.readFileSync(path.join(root, 'routes/estudio.tsx'), 'utf-8');

  describe('1. WhatsApp público oficial unificado', () => {
    it('define la constante oficial KANI_PUBLIC_WHATSAPP_NUMBER como 5491155616438', () => {
      expect(KANI_PUBLIC_WHATSAPP_NUMBER).toBe('5491155616438');
      expect(KANI_PUBLIC_WHATSAPP_URL).toBe('https://wa.me/5491155616438');
    });

    it('utiliza KANI_PUBLIC_WHATSAPP_URL en el Header para consultas públicas', () => {
      expect(siteHeaderTsx).toContain('KANI_PUBLIC_WHATSAPP_URL');
      expect(siteHeaderTsx).toContain('href={`${KANI_PUBLIC_WHATSAPP_URL}?text=Hola%2C%20quer%C3%ADa%20hacer%20una%20consulta%20sobre%20una%20reserva.`}');
    });

    it('utiliza KANI_PUBLIC_WHATSAPP_URL en la página de Contacto / Estudio', () => {
      expect(estudioTsx).toContain('KANI_PUBLIC_WHATSAPP_URL');
      expect(estudioTsx).toContain('const whatsAppUrl = KANI_PUBLIC_WHATSAPP_URL;');
    });

    it('utiliza KANI_PUBLIC_WHATSAPP_URL en el email transaccional de confirmación', () => {
      const email = buildConfirmedEmail({
        barberName: 'Lautaro',
        clientName: 'Juan Pérez',
        serviceName: 'Corte Tradicional',
        bookingDate: '2026-11-05',
        startTime: '16:00:00',
        endTime: '16:45:00',
        servicePriceArs: 15000,
        downPaymentArs: 5000,
      } as any);

      expect(email.html).toContain('https://wa.me/5491155616438');
      expect(email.text).toContain('https://wa.me/5491155616438');
      expect(email.html).not.toContain('https://wa.me/5491128436014');
    });
  });

  describe('2. Selector segmentado en Pagos (Modo Claro y Modo Oscuro)', () => {
    it('aplica fondo bordó (#702B3A) y texto blanco (#ffffff) al botón activo en Modo Claro', () => {
      expect(v2Css).toMatch(/\.v2-segmented button\[aria-pressed="true"\]\s*\{[^}]*background:\s*#702B3A/);
      expect(v2Css).toMatch(/\.v2-segmented button\[aria-pressed="true"\]\s*\{[^}]*color:\s*#ffffff/);
    });

    it('aplica fondo neutro de superficie o inset a la cápsula del segmentado en Modo Claro', () => {
      expect(v2Css).toMatch(/\.v2-segmented\s*\{[^}]*background:\s*var\(--v2-inset,\s*#f4f3f0\)/);
    });

    it('aplica superficie oscura y sin grises lavados a la cápsula en Modo Oscuro', () => {
      expect(v2Css).toMatch(/html\[data-theme="dark"\]\s+\.v2-segmented\s*\{[^}]*background:\s*var\(--v2-inset,\s*#121212\)\s*!important/);
      expect(v2Css).toMatch(/html\[data-theme="dark"\]\s+\.v2-segmented\s*\{[^}]*border-color:\s*var\(--v2-line,\s*#262626\)\s*!important/);
    });

    it('mantiene la opción inactiva con texto muted y fondo transparente en Modo Oscuro', () => {
      expect(v2Css).toMatch(/html\[data-theme="dark"\]\s+\.v2-segmented button\s*\{[^}]*color:\s*var\(--muted-foreground\)\s*!important/);
      expect(v2Css).toMatch(/html\[data-theme="dark"\]\s+\.v2-segmented button\s*\{[^}]*background:\s*transparent\s*!important/);
    });

    it('mantiene el estado activo en dorado (#121212 / var(--gold)) en Modo Oscuro', () => {
      expect(v2Css).toMatch(/html\[data-theme="dark"\]\s+\.v2-segmented button\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--gold\)\s*!important/);
      expect(v2Css).toMatch(/html\[data-theme="dark"\]\s+\.v2-segmented button\[aria-pressed="true"\]\s*\{[^}]*color:\s*#121212\s*!important/);
      expect(v2Css).toMatch(/html\[data-theme="dark"\]\s+\.v2-segmented button\[aria-pressed="true"\]\s*\{[^}]*font-weight:\s*400\s*!important/);
    });
  });

  describe('3. Botón de cobro en Pagos: Cobrar en mobile, Registrar cobro en desktop', () => {
    it('renderiza ambos textos con clases responsivas y mantiene el ícono CheckCircle2', () => {
      expect(paymentsTsx).toContain('<span className="v2-submit-btn-text-desktop">Registrar cobro</span>');
      expect(paymentsTsx).toContain('<span className="v2-submit-btn-text-mobile">Cobrar</span>');
      expect(paymentsTsx).toContain('<CheckCircle2 size={18} />');
    });

    it('en mobile muestra "Cobrar" y oculta "Registrar cobro"', () => {
      expect(v2Css).toMatch(/\.v2-submit-btn-text-mobile\s*\{[^}]*display:\s*inline/);
      expect(v2Css).toMatch(/\.v2-submit-btn-text-desktop\s*\{[^}]*display:\s*none/);
    });

    it('en desktop (>= 768px) muestra "Registrar cobro" y oculta "Cobrar"', () => {
      expect(v2Css).toMatch(/@media \(min-width: 768px\)[\s\S]*?\.v2-submit-btn-text-desktop\s*\{[^}]*display:\s*inline/);
      expect(v2Css).toMatch(/@media \(min-width: 768px\)[\s\S]*?\.v2-submit-btn-text-mobile\s*\{[^}]*display:\s*none/);
    });

    it('asegura altura de 44px, no-wrap y radio de control para el botón', () => {
      expect(v2Css).toMatch(/\.v2-payment-submit-btn\s*\{[^}]*height:\s*44px/);
      expect(v2Css).toMatch(/\.v2-payment-submit-btn\s*\{[^}]*white-space:\s*nowrap/);
      expect(v2Css).toMatch(/\.v2-payment-submit-btn\s*\{[^}]*border-radius:\s*var\(--radius-control\)/);
    });
  });

  describe('4. Reducción tipográfica de caja de importe a cobrar', () => {
    it('reduce la tipografía del label a 12px y del monto a 13.5px', () => {
      expect(v2Css).toMatch(/\.v2-total-box-label\s*\{[^}]*font-size:\s*12px/);
      expect(v2Css).toMatch(/\.v2-total-box-amount\s*\{[^}]*font-size:\s*13\.5px/);
      expect(v2Css).toMatch(/\.v2-total-box-breakdown\s*\{[^}]*font-size:\s*10px/);
    });

    it('mantiene la alineación en una sola línea con cifras tabulares', () => {
      expect(v2Css).toMatch(/\.v2-payment-total-box\s*\{[^}]*flex-direction:\s*row/);
      expect(v2Css).toMatch(/\.v2-payment-total-box\s*\{[^}]*justify-content:\s*space-between/);
      expect(v2Css).toMatch(/\.v2-total-box-amount\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
    });
  });
});

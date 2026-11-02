import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { PoliticaDePrivacidadPage, Route as PoliticaRoute } from '@/routes/politica-de-privacidad';
import { TerminosYCondicionesPage, Route as TerminosRoute } from '@/routes/terminos-y-condiciones';
import { SiteFooter } from '@/components/kani/site-header';

// Mock TanStack Router components and hooks
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (path: string) => (options: any) => ({
    path,
    ...options,
  }),
  Link: ({ to, children, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouterState: vi.fn(() => '/'),
  useNavigate: vi.fn(() => vi.fn()),
}));

// Mock Supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
  },
}));

describe('Kani Barber Studio — Páginas Legales', () => {
  describe('1. Política de Privacidad (/politica-de-privacidad)', () => {
    it('renderiza el título principal, fecha de actualización y lead descriptivo', () => {
      render(<PoliticaDePrivacidadPage />);

      expect(screen.getByRole('heading', { level: 1, name: 'Política de Privacidad' })).toBeInTheDocument();
      expect(screen.getByText(/1 de noviembre de 2026/i)).toBeInTheDocument();
      expect(screen.getByText(/Kani Barber Studio respetamos tu privacidad/i)).toBeInTheDocument();
    });

    it('incluye las 12 secciones requeridas con sus encabezados y contenido clave', () => {
      const { container } = render(<PoliticaDePrivacidadPage />);

      const expectedSections = [
        { id: 'informacion-recopilada', title: 'Información recopilada' },
        { id: 'finalidad', title: 'Finalidad' },
        { id: 'pagos-electronicos', title: 'Pagos electrónicos' },
        { id: 'proteccion-de-datos', title: 'Protección de datos' },
        { id: 'comunicaciones', title: 'Comunicaciones' },
        { id: 'comparticion-de-informacion', title: 'Compartición de información' },
        { id: 'conservacion', title: 'Conservación' },
        { id: 'derechos-del-usuario', title: 'Derechos del usuario' },
        { id: 'cookies', title: 'Cookies' },
        { id: 'servicios-de-terceros', title: 'Servicios de terceros' },
        { id: 'modificaciones', title: 'Modificaciones' },
        { id: 'contacto', title: 'Contacto' },
      ];

      for (const sec of expectedSections) {
        const el = container.querySelector(`#${sec.id}`);
        expect(el, `Sección #${sec.id} debe existir`).toBeInTheDocument();
        expect(el?.querySelector('h2')?.textContent).toContain(sec.title);
      }

      // Verificaciones puntuales de contenido sustantivo
      expect(screen.getByText(/Kani Barber Studio no vende, alquila ni comercializa bases de datos/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Ley N° 25.326/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Agencia de Acceso a la Información Pública/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Payway/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/San Isidro Labrador 7, Martínez/i).length).toBeGreaterThan(0);
      expect(screen.getAllByRole('link', { name: /kanibarberstudio@gmail\.com/i }).length).toBeGreaterThan(0);
    });

    it('genera los metadatos SEO adecuados para Política de Privacidad', () => {
      const headResult = (PoliticaRoute as any).head();
      expect(headResult).toBeDefined();
      expect(headResult.meta).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Política de Privacidad · Kani Barber Studio' }),
          expect.objectContaining({ name: 'description' }),
        ])
      );
    });
  });

  describe('2. Términos y Condiciones (/terminos-y-condiciones)', () => {
    it('renderiza el título principal, fecha de actualización y lead descriptivo', () => {
      render(<TerminosYCondicionesPage />);

      expect(screen.getByRole('heading', { level: 1, name: 'Términos y Condiciones' })).toBeInTheDocument();
      expect(screen.getByText(/1 de noviembre de 2026/i)).toBeInTheDocument();
      expect(screen.getByText(/Los presentes Términos y Condiciones regulan la contratación de servicios/i)).toBeInTheDocument();
    });

    it('incluye las 15 secciones comerciales requeridas con sus encabezados y contenido clave', () => {
      const { container } = render(<TerminosYCondicionesPage />);

      const expectedSections = [
        { id: 'servicios', title: 'Servicios' },
        { id: 'reservas', title: 'Reservas' },
        { id: 'senas', title: 'Señas' },
        { id: 'cancelaciones', title: 'Cancelaciones' },
        { id: 'devoluciones', title: 'Devoluciones' },
        { id: 'reprogramaciones', title: 'Reprogramaciones' },
        { id: 'inasistencias', title: 'Inasistencias' },
        { id: 'puntualidad', title: 'Puntualidad' },
        { id: 'derecho-de-arrepentimiento', title: 'Derecho de arrepentimiento' },
        { id: 'responsabilidad-y-disponibilidad', title: 'Responsabilidad y disponibilidad' },
        { id: 'informacion-del-cliente', title: 'Información del cliente' },
        { id: 'proteccion-de-datos', title: 'Protección de datos' },
        { id: 'modificaciones-precios', title: 'Modificaciones de precios' },
        { id: 'legislacion-aplicable', title: 'Legislación aplicable' },
        { id: 'contacto', title: 'Contacto' },
      ];

      for (const sec of expectedSections) {
        const el = container.querySelector(`#${sec.id}`);
        expect(el, `Sección #${sec.id} debe existir`).toBeInTheDocument();
        expect(el?.querySelector('h2')?.textContent).toContain(sec.title);
      }

      // Verificaciones puntuales de contenido comercial clave
      expect(screen.getByText(/monto requerido de seña es de/i)).toBeInTheDocument();
      expect(screen.getByText(/\$5\.000 ARS/i)).toBeInTheDocument();
      expect(screen.getByText(/Cancelación con 24 horas o más de anticipación/i)).toBeInTheDocument();
      expect(screen.getByText(/10 días hábiles/i)).toBeInTheDocument();
      expect(screen.getByText(/En ningún supuesto se cobrará automáticamente al cliente el saldo pendiente/i)).toBeInTheDocument();
      expect(screen.getByText(/Ley N° 24\.240 de Defensa del Consumidor/i)).toBeInTheDocument();
      expect(screen.getByText(/Código Civil y Comercial de la Nación/i)).toBeInTheDocument();
      expect(screen.getAllByText(/República Argentina/i).length).toBeGreaterThan(0);

      // Enlace cruzado con Política de Privacidad
      const privacyLink = container.querySelector('#proteccion-de-datos a[href="/politica-de-privacidad"]');
      expect(privacyLink).toBeInTheDocument();
    });

    it('genera los metadatos SEO adecuados para Términos y Condiciones', () => {
      const headResult = (TerminosRoute as any).head();
      expect(headResult).toBeDefined();
      expect(headResult.meta).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Términos y Condiciones · Kani Barber Studio' }),
          expect.objectContaining({ name: 'description' }),
        ])
      );
    });
  });

  describe('3. Integración en el Footer del sitio', () => {
    it('el footer general contiene enlaces directos a Términos y Condiciones y Política de Privacidad', () => {
      const { container } = render(<SiteFooter />);

      const termsLink = container.querySelector('footer a[href="/terminos-y-condiciones"]');
      const privacyLink = container.querySelector('footer a[href="/politica-de-privacidad"]');

      expect(termsLink).toBeInTheDocument();
      expect(termsLink?.textContent).toContain('Términos y Condiciones');

      expect(privacyLink).toBeInTheDocument();
      expect(privacyLink?.textContent).toContain('Política de Privacidad');
    });
  });

  describe('4. Cláusula informativa en el flujo de reservas', () => {
    it('verifica que los archivos de reservas incluyan la leyenda legal con enlaces independientes sin checkbox obligatorio', () => {
      const fs = require('fs');
      const bookingContent = fs.readFileSync('src/components/kani/booking.tsx', 'utf8');
      const paywayContent = fs.readFileSync('src/components/kani/experimental/payway-booking.tsx', 'utf8');

      // Ambas deben contener la leyenda exacta
      const expectedText = 'Al confirmar tu reserva, aceptás nuestros';
      expect(bookingContent).toContain(expectedText);
      expect(bookingContent).toContain('/terminos-y-condiciones');
      expect(bookingContent).toContain('/politica-de-privacidad');

      expect(paywayContent).toContain(expectedText);
      expect(paywayContent).toContain('/terminos-y-condiciones');
      expect(paywayContent).toContain('/politica-de-privacidad');

      // Comprobar que no se haya agregado un checkbox obligatorio para la leyenda
      expect(bookingContent).not.toMatch(/<input[^>]+type="checkbox"[^>]*required/i);
    });
  });

  describe('5. Ancho de contenedor alineado con header y footer en escritorio', () => {
    it('ambas páginas legales utilizan site-container y legal-container en su contenedor principal', () => {
      const { container: privContainer } = render(<PoliticaDePrivacidadPage />);
      const privMain = privContainer.querySelector('main.legal-page');
      const privContentWrapper = privMain?.querySelector('.legal-container');
      expect(privContentWrapper).toBeInTheDocument();
      expect(privContentWrapper?.classList.contains('site-container')).toBe(true);

      const { container: termContainer } = render(<TerminosYCondicionesPage />);
      const termMain = termContainer.querySelector('main.legal-page');
      const termContentWrapper = termMain?.querySelector('.legal-container');
      expect(termContentWrapper).toBeInTheDocument();
      expect(termContentWrapper?.classList.contains('site-container')).toBe(true);
    });

    it('legal-pages.css define el ancho de .legal-container con min(1184px, calc(100% - 80px)) y sin restricciones de 860px', () => {
      const fs = require('fs');
      const cssContent = fs.readFileSync('src/legal-pages.css', 'utf8');

      expect(cssContent).not.toContain('max-width: 860px');
      expect(cssContent).toMatch(/\.legal-container\s*\{[^}]*width:\s*min\(1184px,\s*calc\(100%\s*-\s*80px\)\)/);
      expect(cssContent).toMatch(/\.legal-container\s*\{[^}]*margin-inline:\s*auto/);
      expect(cssContent).toMatch(/\.legal-container\s*\{[^}]*padding-inline:\s*0/);
    });
  });
});

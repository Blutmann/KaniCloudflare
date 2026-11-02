import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani — Contacto, Botones del Header y Menú por Rol', () => {
  const rootDir = path.resolve(__dirname, '..');
  const stylesCss = fs.readFileSync(path.join(rootDir, 'styles.css'), 'utf-8');
  const serverCode = fs.readFileSync(path.join(rootDir, 'server.ts'), 'utf-8');
  const headerCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'site-header.tsx'), 'utf-8');
  const contactoCode = fs.readFileSync(path.join(rootDir, 'routes', 'contacto.tsx'), 'utf-8');
  const estudioCode = fs.readFileSync(path.join(rootDir, 'routes', 'estudio.tsx'), 'utf-8');

  describe('1. Contacto: URL, Redirección, Metadatos y Ancho', () => {
    it('ruta oficial /contacto definida con URL canónica oficial y metadatos', () => {
      expect(contactoCode).toContain('createFileRoute("/contacto")');
      expect(contactoCode).toContain('https://www.kanibarber.com/contacto');
      expect(contactoCode).toContain('pageHead');
      expect(contactoCode).toContain('Kani Barber Studio - Contacto');
    });

    it('ruta previa /estudio implementa redirección 301 permanente en el cliente', () => {
      expect(estudioCode).toContain('createFileRoute("/estudio")');
      expect(estudioCode).toContain('to: "/contacto"');
      expect(estudioCode).toContain('statusCode: 301');
    });

    it('servidor Cloudflare Worker implementa redirección HTTP 301 permanente para /estudio', () => {
      expect(serverCode).toContain('url.pathname === "/estudio" || url.pathname === "/estudio/"');
      expect(serverCode).toContain('url.pathname = "/contacto"');
      expect(serverCode).toContain('Response.redirect(url.toString(), 301)');
    });

    it('enlaces internos de menú y footer actualizados hacia /contacto', () => {
      expect(headerCode).toMatch(/<Link to="\/contacto" onClick=\{closeMenu\}>\s*<Building2 \/>\s*Contacto\s*<\/Link>/);
      expect(headerCode).toContain('<Link to="/contacto" className="inline-flex items-center gap-2 hover:text-foreground"><Building2 size={14} /> Contacto</Link>');
      expect(headerCode).not.toContain('to="/estudio"');
    });

    it('ancho de Contacto unificado con las secciones principales del sitio (sin cap de 1020px)', () => {
      expect(stylesCss).not.toContain('.studio-page { max-width: 1020px;');
      expect(stylesCss).toMatch(/\.studio-page,\s*\.contacto-page\s*\{[^}]*width:\s*min\(1184px,\s*calc\(100%\s*-\s*80px\)\)/);
      expect(stylesCss).toMatch(/\.studio-page,\s*\.contacto-page\s*\{[^}]*margin-inline:\s*auto/);
    });
  });

  describe('2. Header: Botones 52x52px con iconos 22-24px solo en escritorio', () => {
    it('en escritorio (≥768px), los botones del header tienen 52x52px y sus iconos 22-24px', () => {
      const desktopQuery = stylesCss.substring(stylesCss.indexOf('/* Header buttons: 52x52px'));
      expect(desktopQuery).toContain('@media (min-width: 768px)');
      expect(desktopQuery).toMatch(/\.header-control-button\s*\{[^}]*width:\s*52px\s*!important/);
      expect(desktopQuery).toMatch(/\.header-control-button\s*\{[^}]*height:\s*52px\s*!important/);
      expect(desktopQuery).toMatch(/\.header-control-button\s+svg\s*\{[^}]*width:\s*23px\s*!important/);
      expect(desktopQuery).toMatch(/\.header-control-button\s+svg\s*\{[^}]*height:\s*23px\s*!important/);
      expect(desktopQuery).toMatch(/\.header-whatsapp-button\s+svg\s*\{[^}]*width:\s*23px\s*!important/);
      expect(desktopQuery).toMatch(/\.header-whatsapp-button\s+svg\s*\{[^}]*height:\s*23px\s*!important/);
    });

    it('contador de notificaciones ajustado para botón de 52px sin desborde ni corte', () => {
      const desktopQuery = stylesCss.substring(stylesCss.indexOf('/* Header buttons: 52x52px'));
      expect(desktopQuery).toContain('.notification-count');
      expect(desktopQuery).toMatch(/\.notification-count\s*\{[^}]*top:\s*-5px/);
      expect(desktopQuery).toMatch(/\.notification-count\s*\{[^}]*right:\s*-5px/);
    });

    it('en móvil se preservan los tamaños estándar de 44px con iconos de 17px', () => {
      expect(stylesCss).toMatch(/\.header-control-button\s*\{[^}]*width:\s*44px/);
      expect(stylesCss).toMatch(/\.header-control-button\s*\{[^}]*height:\s*44px/);
      expect(stylesCss).toMatch(/\.header-control-button svg\s*\{[^}]*width:\s*17px/);
    });
  });

  describe('3. Menú desplegable por rol y división visual', () => {
    const menuSection = headerCode.substring(
      headerCode.indexOf('const mobileMenu = menuOpen'),
      headerCode.indexOf('return <>')
    );

    it('oculta Instagram y Ubicación del menú desplegable para todos los roles', () => {
      expect(menuSection).not.toContain('<MapPin />Ubicación');
      expect(menuSection).not.toContain('<Instagram />Instagram');
    });

    it('incluye divisores y grupos para separación visual limpia sin títulos textuales', () => {
      expect(menuSection).toContain('className="mobile-menu-group"');
      expect(menuSection).toContain('className="mobile-menu-divider"');
      expect(stylesCss).toContain('.mobile-menu-divider');
    });

    it('orden exacto Grupo 1: Reservar turno y Contacto', () => {
      const idxReserva = menuSection.indexOf('Reservar turno');
      const idxContacto = menuSection.indexOf('Contacto');
      expect(idxReserva).toBeGreaterThan(-1);
      expect(idxContacto).toBeGreaterThan(idxReserva);
    });

    it('orden exacto Grupo 2: Panel de administración universal, Mantenimiento para ADMIN, y Operativos para BARBER', () => {
      const idxContacto = menuSection.indexOf('Contacto');
      const idxAdminPanel = menuSection.indexOf('Panel de administración');
      const idxMantenimiento = menuSection.indexOf('Panel de mantenimiento');
      const idxTurnos = menuSection.indexOf('Turnos');
      const idxHorarios = menuSection.indexOf('Horarios');
      const idxPagos = menuSection.indexOf('Pagos');
      const idxClientes = menuSection.indexOf('Clientes');
      const idxDatos = menuSection.indexOf('Datos');

      expect(idxAdminPanel).toBeGreaterThan(idxContacto);
      expect(idxMantenimiento).toBeGreaterThan(idxAdminPanel);
      expect(idxTurnos).toBeGreaterThan(idxAdminPanel);
      expect(idxHorarios).toBeGreaterThan(idxTurnos);
      expect(idxPagos).toBeGreaterThan(idxHorarios);
      expect(idxClientes).toBeGreaterThan(idxPagos);
      expect(idxDatos).toBeGreaterThan(idxClientes);
    });

    it('orden exacto Grupo 3: Política de privacidad y Términos y condiciones', () => {
      const idxAdminPanel = menuSection.indexOf('Panel de administración');
      const idxPrivacidad = menuSection.indexOf('Política de Privacidad');
      const idxTerminos = menuSection.indexOf('Términos y Condiciones');

      expect(idxPrivacidad).toBeGreaterThan(idxAdminPanel);
      expect(idxTerminos).toBeGreaterThan(idxPrivacidad);
    });

    it('orden exacto Grupo 4: Sesión activa con Cerrar sesión bordó al final', () => {
      const idxTerminos = menuSection.indexOf('Términos y Condiciones');
      const idxSession = menuSection.indexOf('mobile-menu-session');
      const idxSignout = menuSection.indexOf('mobile-menu-signout');

      expect(idxSession).toBeGreaterThan(idxTerminos);
      expect(idxSignout).toBeGreaterThan(idxSession);
      expect(stylesCss).toMatch(/\.mobile-menu-signout\s*\{[^}]*background-color:\s*var\(--button-primary-bg,\s*#762936\)/);
    });
  });
});

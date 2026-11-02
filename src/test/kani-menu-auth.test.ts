import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio - Menú y Autenticación', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const siteHeaderPath = path.resolve(__dirname, '../components/kani/site-header.tsx');
  const adminAccessPath = path.resolve(__dirname, '../components/kani/admin-access.tsx');
  const adminMaintenancePath = path.resolve(__dirname, '../components/kani/admin-maintenance.tsx');

  it('1. Botón «Cerrar sesión» tiene fondo bordó institucional y tipografía blanca', () => {
    const css = fs.readFileSync(stylesPath, 'utf-8');

    // Debe contener la clase .mobile-menu-signout
    expect(css).toContain('.mobile-menu-signout');

    // Debe aplicar el fondo bordó institucional
    expect(css).toMatch(/\.mobile-menu-signout\s*\{[^}]*background-color:\s*var\(--button-primary-bg,\s*#762936\)/);

    // Debe utilizar tipografía blanca
    expect(css).toMatch(/\.mobile-menu-signout\s*\{[^}]*color:\s*#FFFFFF\s*!important/);

    // Los iconos svg dentro del botón deben ser blancos
    expect(css).toMatch(/\.mobile-menu-signout svg\s*\{[^}]*color:\s*#FFFFFF\s*!important/);
    expect(css).toMatch(/\.mobile-menu-signout svg\s*\{[^}]*stroke:\s*#FFFFFF\s*!important/);

    // Estados hover, focus y active preservados con estilo coherente
    expect(css).toContain('.mobile-menu-signout:hover');
    expect(css).toContain('.mobile-menu-signout:focus-visible');
    expect(css).toContain('.mobile-menu-signout:active');
  });

  it('2. Menú desplegable define exactamente el orden y permisos requeridos por rol', () => {
    const code = fs.readFileSync(siteHeaderPath, 'utf-8');

    // Grupo 1: Reservar turno y Contacto (apuntando a /contacto)
    expect(code).toContain('Reservar turno');
    expect(code).toMatch(/<Link to=\{path\.includes\('mercadopago'\) \? '\/reservar-turno-mercadopago' : '\/reservar-turno'\}[^>]*>[^<]*<ArrowUpRight \/>\s*Reservar turno\s*<\/Link>/);
    expect(code).toMatch(/<Link to="\/contacto"[^>]*>[^<]*<Building2 \/>\s*Contacto\s*<\/Link>/);

    // Ocultar entradas de Instagram y Ubicación en el menú
    const menuSection = code.substring(code.indexOf('mobileMenu = menuOpen'), code.indexOf('return <>'));
    expect(menuSection).not.toContain('<MapPin />Ubicación');
    expect(menuSection).not.toContain('<Instagram />Instagram');

    // Grupo 2: Panel de administración visible en todos los roles (con o sin sesión)
    expect(menuSection).toMatch(/<Link to="\/panel-administracion"[^>]*>[^<]*<CalendarClock \/>\s*Panel de administración\s*<\/Link>/);

    // Panel de mantenimiento — Solo ADMIN
    expect(menuSection).toMatch(/staff\?\.profile\.role === 'ADMIN' && \(\s*<Link to="\/panel-administracion\/mantenimiento"[^>]*>[^<]*<Wrench \/>\s*Panel de mantenimiento\s*<\/Link>\s*\)/);

    // Opciones operativas (Turnos, Horarios, Pagos, Clientes, Datos) — Solo BARBER
    expect(menuSection).toMatch(/staff\?\.profile\.role === 'BARBER' && \(/);
    expect(menuSection).toContain('to="/panel-administracion/turnos"');
    expect(menuSection).toContain('to="/panel-administracion/horarios"');
    expect(menuSection).toContain('to="/panel-administracion/pagos"');
    expect(menuSection).toContain('to="/panel-administracion/clientes"');
    expect(menuSection).toContain('to="/panel-administracion/datos"');

    // Grupo 3: Legal — Política de privacidad y Términos y condiciones
    expect(menuSection).toContain('to="/politica-de-privacidad"');
    expect(menuSection).toContain('to="/terminos-y-condiciones"');

    // Grupo 4: Sesión iniciada con Cerrar sesión
    expect(menuSection).toMatch(/<LogOut \/>\s*Cerrar sesión\s*<\/button>/);
  });

  it('3. Formulario de acceso al panel muestra el texto «Iniciar sesión» en el botón de submit', () => {
    const code = fs.readFileSync(adminAccessPath, 'utf-8');

    // No debe contener INGRESAR
    expect(code).not.toContain("'INGRESAR'");
    expect(code).not.toContain('"INGRESAR"');

    // Debe contener 'Iniciar sesión'
    expect(code).toContain("{busy ? 'VERIFICANDO…' : 'Iniciar sesión'}");
  });

  it('4. Panel de mantenimiento bloquea el acceso directo a roles no-ADMIN', () => {
    const code = fs.readFileSync(adminMaintenancePath, 'utf-8');

    // Debe consultar el staff autenticado
    expect(code).toContain('const staff = useAdminStaff();');
    expect(code).toContain("const isAdmin = staff.profile.role === 'ADMIN';");

    // Si no es admin, bloquea la vista con mensaje de acceso restringido
    expect(code).toContain('ACCESO RESTRINGIDO');
    expect(code).toContain('Solo administradores');

    // No ejecuta consultas de mantenimiento si no es admin
    expect(code).toContain('if (!isAdmin) return;');
  });
});

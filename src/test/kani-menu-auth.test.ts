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

  it('2. Menú desplegable define exactamente el orden y permisos requeridos', () => {
    const code = fs.readFileSync(siteHeaderPath, 'utf-8');

    // 1. Solicitar turno — Todos
    expect(code).toContain('Solicitar turno');
    expect(code).toMatch(/<Link to=\{path\.includes\('mercadopago'\) \? '\/reservar-turno-mercadopago' : '\/reservar-turno'\}[^>]*>[^<]*<ArrowUpRight \/>\s*Solicitar turno\s*<\/Link>|<Link to="\/reservar"[^>]*>[^<]*<ArrowUpRight \/>\s*Solicitar turno\s*<\/Link>/);

    // 2. Contacto — Todos
    expect(code).toContain('Contacto');
    expect(code).toMatch(/<Link to="\/estudio"[^>]*>[^<]*<Building2 \/>\s*Contacto\s*<\/Link>/);

    // 3. Ubicación — Todos (texto exacto Ubicación)
    expect(code).toMatch(/<MapPin \/>\s*Ubicación\s*<\/a>/);

    // 4. Instagram — Todos
    expect(code).toMatch(/<Instagram \/>\s*Instagram\s*<\/a>/);

    // 5. Panel de administración — ADMIN y Barbero
    expect(code).toMatch(/staff && \(staff\.profile\.role === 'ADMIN' \|\| staff\.profile\.role === 'BARBER'\)/);
    expect(code).toMatch(/<Link to="(\/admin|\/panel-administracion)"[^>]*>[^<]*<CalendarClock \/>\s*Panel de administración\s*<\/Link>/);

    // 6. Panel de mantenimiento — Solo ADMIN
    expect(code).toMatch(/staff\?\.profile\.role === 'ADMIN' && \(\s*<Link to="\/admin\/mantenimiento"[^>]*>[^<]*<Wrench \/>\s*Panel de mantenimiento\s*<\/Link>\s*\)/);

    // 7. Autenticación — Si no hay sesión: "Iniciar sesión". Si hay sesión: usuario + "Cerrar sesión"
    expect(code).toMatch(/<LogIn \/>\s*Iniciar sesión\s*<\/Link>/);
    expect(code).toMatch(/<LogOut \/>\s*Cerrar sesión\s*<\/button>/);
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

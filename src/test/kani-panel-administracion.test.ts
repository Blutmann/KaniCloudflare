import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio — Panel de Administración & Refinamiento de Pagos', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('1. Define la estructura de rutas oficial /panel-administracion', () => {
    const layoutPath = path.join(rootDir, 'routes', 'panel-administracion.tsx');
    const indexPath = path.join(rootDir, 'routes', 'panel-administracion.index.tsx');
    const inicioPath = path.join(rootDir, 'routes', 'panel-administracion.inicio.tsx');
    const turnosPath = path.join(rootDir, 'routes', 'panel-administracion.turnos.tsx');
    const horariosPath = path.join(rootDir, 'routes', 'panel-administracion.horarios.tsx');
    const pagosPath = path.join(rootDir, 'routes', 'panel-administracion.pagos.tsx');
    const clientesPath = path.join(rootDir, 'routes', 'panel-administracion.clientes.tsx');
    const datosPath = path.join(rootDir, 'routes', 'panel-administracion.datos.tsx');

    expect(fs.existsSync(layoutPath)).toBe(true);
    expect(fs.existsSync(indexPath)).toBe(true);
    expect(fs.existsSync(inicioPath)).toBe(true);
    expect(fs.existsSync(turnosPath)).toBe(true);
    expect(fs.existsSync(horariosPath)).toBe(true);
    expect(fs.existsSync(pagosPath)).toBe(true);
    expect(fs.existsSync(clientesPath)).toBe(true);
    expect(fs.existsSync(datosPath)).toBe(true);

    const layoutCode = fs.readFileSync(layoutPath, 'utf8');
    expect(layoutCode).toMatch(/createFileRoute\(['"]\/panel-administracion['"]\)/);
    expect(layoutCode).toContain('V2Layout');

    const indexCode = fs.readFileSync(indexPath, 'utf8');
    expect(indexCode).toMatch(/to:\s*['"]\/panel-administracion\/inicio['"]/);

    const pagosCode = fs.readFileSync(pagosPath, 'utf8');
    expect(pagosCode).toMatch(/createFileRoute\(['"]\/panel-administracion\/pagos['"]\)/);
    expect(pagosCode).toContain('V2Payments');
  });

  it('2. Redirige rutas anteriores /admin-v2/* hacia /panel-administracion/* preservando search params', () => {
    const adminV2Index = fs.readFileSync(path.join(rootDir, 'routes', 'admin-v2.index.tsx'), 'utf8');
    const adminV2Pagos = fs.readFileSync(path.join(rootDir, 'routes', 'admin-v2.pagos.tsx'), 'utf8');
    const adminV2Turnos = fs.readFileSync(path.join(rootDir, 'routes', 'admin-v2.turnos.tsx'), 'utf8');
    const adminIndex = fs.readFileSync(path.join(rootDir, 'routes', 'admin.index.tsx'), 'utf8');

    expect(adminV2Index).toMatch(/to:\s*['"]\/panel-administracion(\/inicio)?['"]/);
    expect(adminV2Pagos).toMatch(/to:\s*['"]\/panel-administracion\/pagos['"]/);
    expect(adminV2Pagos).toContain('search');
    expect(adminV2Turnos).toMatch(/to:\s*['"]\/panel-administracion\/turnos['"]/);
    expect(adminIndex).toMatch(/to:\s*['"]\/panel-administracion['"]/);
  });

  it('3. Redirige /reservar hacia /reservar-turno preservando search params', () => {
    const reservarCode = fs.readFileSync(path.join(rootDir, 'routes', 'reservar.tsx'), 'utf8');
    expect(reservarCode).toMatch(/to:\s*['"]\/reservar-turno['"]/);
    expect(reservarCode).toContain('search');
  });

  it('4. SiteHeader integra /panel-administracion, rutas unificadas de reserva y logout contextual', () => {
    const headerCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'site-header.tsx'), 'utf8');

    // Admin detection
    expect(headerCode).toContain("path.startsWith('/panel-administracion')");

    // Solicitar turno link contextual
    expect(headerCode).toContain("path.includes('mercadopago') ? '/reservar-turno-mercadopago' : '/reservar-turno'");

    // Panel de administración link
    expect(headerCode).toContain('to="/panel-administracion"');

    // Iniciar sesión link
    expect(headerCode).toContain('<Link to="/panel-administracion" onClick={closeMenu}><LogIn />Iniciar sesión</Link>');

    // Cerrar sesión con redirección a la ruta de reserva correcta
    expect(headerCode).toContain("const isMp = path.includes('mercadopago');");
    expect(headerCode).toContain("navigate({ to: isMp ? '/reservar-turno-mercadopago' : '/reservar-turno' })");
  });

  it('5. layout.tsx de Admin V2 utiliza enlaces a /panel-administracion/*', () => {
    const layoutCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'v2', 'layout.tsx'), 'utf8');
    expect(layoutCode).toContain('/panel-administracion/inicio');
    expect(layoutCode).toContain('/panel-administracion/turnos');
    expect(layoutCode).toContain('/panel-administracion/horarios');
    expect(layoutCode).toContain('/panel-administracion/pagos');
    expect(layoutCode).toContain('/panel-administracion/clientes');
    expect(layoutCode).toContain('/panel-administracion/datos');
    expect(layoutCode).toContain('href="/panel-administracion"');
  });

  it('6. agenda.tsx de Admin V2 utiliza enlaces a /panel-administracion/*', () => {
    const agendaCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'v2', 'agenda.tsx'), 'utf8');
    expect(agendaCode).toContain('to="/panel-administracion/turnos"');
    expect(agendaCode).toContain('to="/panel-administracion/horarios"');
    expect(agendaCode).toContain('to="/panel-administracion/pagos"');
    expect(agendaCode).not.toContain('to="/admin-v2/turnos"');
    expect(agendaCode).not.toContain('to="/admin-v2/horarios"');
    expect(agendaCode).not.toContain('to="/admin-v2/pagos"');
  });

  it('7. Formulario de Pagos presenta bordes redondeados y layout de 44px con Importe en una sola fila', () => {
    const v2Css = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'v2', 'v2.css'), 'utf8');
    const paymentsCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'v2', 'payments.tsx'), 'utf8');

    // Label Importe:
    expect(paymentsCode).toContain('<span className="v2-total-box-label">Importe:</span>');

    // Radius control
    expect(v2Css).toMatch(/\.v2-payment-toggle-btn\s*\{[^}]*border-radius:\s*var\(--radius-control\);/);
    expect(v2Css).toMatch(/\.v2-payment-appointment-client-badge\s*\{[^}]*border-radius:\s*var\(--radius-control\);/);
    expect(v2Css).toMatch(/\.v2-payment-total-box\s*\{[^}]*border-radius:\s*var\(--radius-control\);/);
    expect(v2Css).toMatch(/\.v2-payment-submit-btn\s*\{[^}]*border-radius:\s*var\(--radius-control\);/);

    // Height 44px on total box
    expect(v2Css).toMatch(/\.v2-payment-total-box\s*\{[^}]*min-height:\s*44px;/);
    expect(v2Css).toMatch(/\.v2-payment-total-box\s*\{[^}]*height:\s*44px;/);

    // Spacing
    expect(v2Css).toMatch(/\.v2-payment-compact-form\s*\{[^}]*margin-top:\s*16px;/);
    expect(v2Css).toMatch(/\.v2-payment-grid\s*\{[^}]*gap:\s*14px;/);
  });

  it('8. Modo oscuro utiliza tipografía regular (font-weight: 400) en CTAs dorados y navegación activa', () => {
    const v2Css = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'v2', 'v2.css'), 'utf8');
    const stylesCss = fs.readFileSync(path.join(rootDir, 'styles.css'), 'utf8');

    // styles.css nav link activa en dark mode: font-weight: 400
    expect(stylesCss).toMatch(/html\[data-theme='dark'\]\s+\.admin-section-nav-link\.is-active[^}]*font-weight:\s*400\s*!important/);

    // v2.css nav link activa en dark mode: font-weight: 400
    expect(v2Css).toMatch(/html\[data-theme="dark"\]\s+\.v2-nav\s+\.admin-section-nav-link\.is-active[^}]*font-weight:\s*400\s*!important/);

    // v2.css CTAs principales en dark mode: font-weight: 400
    expect(v2Css).toMatch(/html\[data-theme="dark"\]\s+[^}]*\.v2-payment-submit-btn:not\(:disabled\)[^}]*font-weight:\s*400\s*!important/);

    // v2.css segmentados y toggles en dark mode: font-weight: 400
    expect(v2Css).toMatch(/html\[data-theme="dark"\]\s+\.v2-segmented\s+button\[aria-pressed="true"\]\s*\{[^}]*font-weight:\s*400\s*!important/);
    expect(v2Css).toMatch(/html\[data-theme="dark"\]\s+\.v2-payment-toggle-btn\.active[^}]*font-weight:\s*400\s*!important/);
  });
});

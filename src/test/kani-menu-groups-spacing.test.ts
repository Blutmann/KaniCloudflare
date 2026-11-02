import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Menú desplegable — Jerarquía y Espaciado de Grupos (8px interno, 40px entre grupos)', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const headerPath = path.resolve(__dirname, '../components/kani/site-header.tsx');
  const css = fs.readFileSync(stylesPath, 'utf-8');
  const headerCode = fs.readFileSync(headerPath, 'utf-8');

  it('1. Grupo usuario agrupa "Reservar turno" y "Contacto" en el mismo contenedor flex', () => {
    // Debe existir un .mobile-menu-group que contenga ambos enlaces
    const userGroupMatch = headerCode.match(/<div className="mobile-menu-group">[\s\S]*?Reservar turno[\s\S]*?Contacto[\s\S]*?<\/div>/);
    expect(userGroupMatch).not.toBeNull();
  });

  it('2. Grupo barbero contiene "Panel de administración" y sus opciones operativas para BARBER', () => {
    expect(headerCode).toMatch(/<div className="mobile-menu-group">[\s\S]*?Panel de administración[\s\S]*?Turnos[\s\S]*?Horarios[\s\S]*?Pagos[\s\S]*?Clientes[\s\S]*?Datos[\s\S]*?<\/div>/);
  });

  it('3. Grupo admin contiene "Panel de mantenimiento" condicionado a ADMIN', () => {
    expect(headerCode).toMatch(/staff\?\.profile\.role === 'ADMIN'[\s\S]*?<div className="mobile-menu-group">[\s\S]*?Panel de mantenimiento[\s\S]*?<\/div>/);
  });

  it('4. Grupo legales agrupa "Política de Privacidad" y "Términos y Condiciones"', () => {
    expect(headerCode).toMatch(/<div className="mobile-menu-group">[\s\S]*?Política de Privacidad[\s\S]*?Términos y Condiciones[\s\S]*?<\/div>/);
  });

  it('5. Regla CSS de 8px dentro de cada grupo (.mobile-menu-group { gap: 8px })', () => {
    expect(css).toMatch(/\.mobile-menu-group\s*\{[^}]*gap:\s*8px/);
  });

  it('6. Regla CSS de 40px entre grupos sucesivos, contemplando adyacencia y selectores hermanos', () => {
    expect(css).toMatch(/\.mobile-menu-group:not\(:empty\)\s*~\s*\.mobile-menu-group:not\(:empty\)[^}]*margin-top:\s*40px\s*!important/);
  });

  it('7. Regla CSS de 40px para la sección de sesión (.mobile-menu-session)', () => {
    expect(css).toMatch(/\.mobile-menu-session\s*\{[^}]*margin-top:\s*40px\s*!important/);
  });

  it('8. Divisores y líneas ocultos sin dejar huecos ni bordes horizontales', () => {
    expect(css).toMatch(/\.mobile-menu-divider\s*\{[^}]*display:\s*none\s*!important/);
    expect(css).toMatch(/\.mobile-menu-group:empty\s*\{[^}]*display:\s*none\s*!important/);
    expect(css).toMatch(/\.mobile-menu a\s*\{[^}]*border-bottom:\s*none\s*!important/);
    expect(css).toMatch(/\.mobile-menu-session\s*\{[^}]*border-top:\s*none\s*!important/);
  });

  it('9. Áreas táctiles mínimas de 44px tanto para enlaces como botón de cerrar sesión', () => {
    expect(css).toMatch(/\.mobile-menu a\s*\{[^}]*min-height:\s*(4[4-9]|5[0-9]|6[0-9])px/);
    expect(css).toMatch(/\.mobile-menu-signout\s*\{[^}]*min-height:\s*44px/);
  });
});

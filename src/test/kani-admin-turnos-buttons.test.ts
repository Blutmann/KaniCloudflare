import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio - Visibilidad de botones en Administración > Turnos', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const appointmentsPath = path.resolve(__dirname, '../components/kani/admin-mobile-appointments.tsx');

  const css = fs.readFileSync(stylesPath, 'utf-8');
  const code = fs.readFileSync(appointmentsPath, 'utf-8');

  it('1. Botón «Confirmar»: fondo verde exacto de la card de confirmados (var(--success)) con texto blanco', () => {
    // Clase action-confirm en styles.css
    expect(css).toMatch(/\.action-confirm\s*\{[^}]*background:\s*var\(--success\)\s*!important/);
    expect(css).toMatch(/\.action-confirm\s*\{[^}]*color:\s*#FFFFFF\s*!important/);

    // Aplicado en admin-mobile-appointments para el botón Confirmar
    expect(code).toContain('className="action-confirm h-9 text-xs px-2 w-full justify-center min-w-0"');
    expect(code).toContain('<span className="truncate">Confirmar</span>');
  });

  it('2. Botón «Rechazar»: fondo bordó institucional (#702B3A) con texto blanco', () => {
    // Clase action-reject en styles.css
    expect(css).toMatch(/\.action-reject\s*\{[^}]*background:\s*#702B3A\s*!important/);
    expect(css).toMatch(/\.action-reject\s*\{[^}]*color:\s*#FFFFFF\s*!important/);

    // Aplicado en admin-mobile-appointments para el botón Rechazar
    expect(code).toContain('className="action-reject h-9 text-xs px-2 w-full justify-center min-w-0"');
    expect(code).toContain('<span className="truncate">Rechazar</span>');
  });

  it('3. Botón «Enviar correo»: fondo blanco (#FFFFFF) con texto negro (#000000)', () => {
    // Clase action-mail en styles.css
    expect(css).toMatch(/\.action-mail\s*\{[^}]*background:\s*#FFFFFF\s*!important/);
    expect(css).toMatch(/\.action-mail\s*\{[^}]*color:\s*#000000\s*!important/);

    // Aplicado en admin-mobile-appointments para el botón Enviar correo
    expect(code).toContain('className="action-mail h-9 text-xs px-2 w-full justify-center min-w-0"');
    expect(code).toContain('<span className="truncate md:hidden">Enviar mail</span>');
    expect(code).toContain('<span className="truncate hidden md:inline">Enviar correo</span>');
  });

  it('4. Conserva dimensiones, iconos, distribución en grid y lógica de los botones', () => {
    // Grid de 3 columnas para turnos pendientes
    expect(code).toContain('<div className="grid grid-cols-3 gap-2 w-full">');

    // Iconos preservados
    expect(code).toContain('<Check size={14} className="mr-1 shrink-0" />');
    expect(code).toContain('<X size={14} className="mr-1 shrink-0" />');
    expect(code).toContain('<Mail size={14} className="mr-1 shrink-0" />');

    // Acciones preservadas
    expect(code).toContain("void changeStatus(appointment, 'CONFIRMED')");
    expect(code).toContain('setCancelTarget(appointment)');
    expect(code).toContain('void retryNotification(appointment)');
  });
});

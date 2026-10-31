import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Admin — Pagos — Cabecera de tabla en modo oscuro y consistencia visual de reservas', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('1. Modo oscuro aplica fondo dorado institucional (var(--gold)) a la cabecera de la tabla', () => {
    const v2Css = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'v2', 'v2.css'), 'utf8');
    expect(v2Css).toMatch(
      /html\[data-theme="dark"\]\s+\.v2-payments-table\s+th\s*\{[^}]*background:\s*var\(--gold\)\s*!important/
    );
  });

  it('2. Modo oscuro aplica texto oscuro (#121212) y tipografía regular (font-weight: 400) a los encabezados', () => {
    const v2Css = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'v2', 'v2.css'), 'utf8');
    expect(v2Css).toMatch(
      /html\[data-theme="dark"\]\s+\.v2-payments-table\s+th\s*\{[^}]*color:\s*#121212\s*!important/
    );
    expect(v2Css).toMatch(
      /html\[data-theme="dark"\]\s+\.v2-payments-table\s+th\s*\{[^}]*font-weight:\s*400\s*!important/
    );
  });

  it('3. Previene desbordamiento en las esquinas superiores del contenedor de la tabla', () => {
    const v2Css = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'v2', 'v2.css'), 'utf8');
    expect(v2Css).toMatch(
      /html\[data-theme="dark"\]\s+\.v2-payments-table\s+thead\s+tr\s+th:first-child\s*\{[^}]*border-top-left-radius/
    );
    expect(v2Css).toMatch(
      /html\[data-theme="dark"\]\s+\.v2-payments-table\s+thead\s+tr\s+th:last-child\s*\{[^}]*border-top-right-radius/
    );
  });

  it('4. Modo claro conserva su estilo original sin modificaciones', () => {
    const v2Css = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'v2', 'v2.css'), 'utf8');
    expect(v2Css).toMatch(
      /\.v2-payments-table\s+th\s*\{[^}]*color:\s*var\(--muted-foreground\)/
    );
    expect(v2Css).toMatch(
      /\.v2-payments-table\s+th\s*\{[^}]*background:\s*color-mix/
    );
  });

  it('5. Conserva las 6 columnas en el orden requerido y la alineación a la derecha de Importe y Acciones', () => {
    const paymentsCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'v2', 'payments.tsx'), 'utf8');
    const v2Css = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'v2', 'v2.css'), 'utf8');

    expect(paymentsCode).toContain('<th className="col-datetime">Fecha y hora</th>');
    expect(paymentsCode).toContain('<th className="col-service">Servicio</th>');
    expect(paymentsCode).toContain('<th className="col-client">Cliente</th>');
    expect(paymentsCode).toContain('<th className="col-method">Método</th>');
    expect(paymentsCode).toContain('<th className="col-amount">Importe</th>');
    expect(paymentsCode).toContain('<th className="col-actions">Acciones</th>');

    expect(v2Css).toMatch(/\.v2-payments-table\s+th\.col-amount\s*\{[^}]*text-align:\s*right/);
    expect(v2Css).toMatch(/\.v2-payments-table\s+th\.col-actions\s*\{[^}]*text-align:\s*right/);
  });

  it('6. Compatibilidad y consistencia: /reservar-mercadopago redirige a /reservar-turno-mercadopago', () => {
    const mpRouteCode = fs.readFileSync(path.join(rootDir, 'routes', 'reservar-mercadopago.tsx'), 'utf8');
    expect(mpRouteCode).toContain("createFileRoute('/reservar-mercadopago')");
    expect(mpRouteCode).toContain("to: '/reservar-turno-mercadopago'");
    expect(mpRouteCode).toContain('search');
  });

  it('7. Ambas rutas de reserva comparten el mismo sistema de hojas de estilo Reserva V4', () => {
    const paywayRoute = fs.readFileSync(path.join(rootDir, 'routes', 'reservar-turno.tsx'), 'utf8');
    const mpRoute = fs.readFileSync(path.join(rootDir, 'routes', 'reservar-turno-mercadopago.tsx'), 'utf8');

    expect(paywayRoute).toContain("@/components/kani/experimental/reserva-v4.css");
    expect(mpRoute).toContain("@/components/kani/experimental/reserva-v4.css");
  });
});

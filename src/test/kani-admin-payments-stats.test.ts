import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio — Panel de Administración -> Pagos (Tabla y Estadísticas)', () => {
  const paymentsComponentPath = path.resolve(__dirname, '../components/kani/admin-payments.tsx');
  const code = fs.readFileSync(paymentsComponentPath, 'utf-8');

  it('1. La tabla Desktop cuenta exactamente con las 6 columnas requeridas con alineaciones independientes', () => {
    // 6 columnas en thead
    expect(code).toMatch(/<th[^>]*>Hora<\/th>/);
    expect(code).toMatch(/<th[^>]*>Servicio<\/th>/);
    expect(code).toMatch(/<th[^>]*>Barbero<\/th>/);
    expect(code).toMatch(/<th[^>]*>Cliente<\/th>/);
    expect(code).toMatch(/<th[^>]*text-right[^>]*>Importe<\/th>/);
    expect(code).toMatch(/<th[^>]*>Método de pago<\/th>/);

    // Importe y Método de pago están en <td> completamente independientes
    expect(code).toMatch(/<td[^>]*text-right font-bold text-foreground whitespace-nowrap[^>]*>\s*\{money\(payment\.finalAmountArs\)\}\s*<\/td>/);
    expect(code).toMatch(/<td[^>]*text-left whitespace-nowrap[^>]*>[\s\S]*?\{payment\.paymentMethod\}[\s\S]*?<\/td>/);
  });

  it('2. Total cobrado se calcula sobre el conjunto de pagos filtrados y se muestra destacado', () => {
    // Cálculo mediante suma de finalAmountArs sobre los payments activos
    expect(code).toContain('payments.reduce((sum, p) => sum + (p.finalAmountArs || 0), 0)');

    // Sección de Total cobrado destacada debajo de Servicios registrados
    expect(code).toContain('Total cobrado');
    expect(code).toContain('{money(paymentStats.totalCollected)}');
  });

  it('3. Estadísticas visuales calculan Resumen (Total, Cantidad de servicios, Ticket promedio)', () => {
    expect(code).toContain('servicesCount = payments.length');
    expect(code).toContain('averageTicket = servicesCount > 0 ? Math.round(totalCollected / servicesCount) : 0');
    expect(code).toContain('{money(paymentStats.averageTicket)}');
    expect(code).toContain('Cantidad de servicios');
    expect(code).toContain('{paymentStats.servicesCount}');
  });

  it('4. Gráfico de Cobros por método de pago contempla Efectivo, Transferencia y soporte para otros métodos', () => {
    expect(code).toContain('Cobros por método de pago');
    expect(code).toContain('byMethodMap.set("Efectivo"');
    expect(code).toContain('byMethodMap.set("Transferencia"');
    expect(code).toContain('item.method === "Efectivo" ? "var(--gold)" : "var(--primary)"');
  });

  it('5. Gráficos de Cobros por servicio y Cobros por barbero reflejan datos dinámicos acumulados', () => {
    expect(code).toContain('Cobros por servicio');
    expect(code).toContain('byServiceMap.set(sName');
    expect(code).toContain('Cobros por barbero');
    expect(code).toContain('byBarberMap.set(bName');
  });

  it('6. Estado sin datos limpio cuando no hay servicios registrados para los filtros', () => {
    expect(code).toContain('No hay servicios registrados para calcular gráficos con los filtros seleccionados.');
  });
});

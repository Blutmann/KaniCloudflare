import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio — Panel de Administración -> Pagos (Tabla, Permisos, Edición y Estadísticas)', () => {
  const paymentsComponentPath = path.resolve(__dirname, '../components/kani/admin-payments.tsx');
  const paymentsLibPath = path.resolve(__dirname, '../lib/kani-payments.ts');
  const migrationPath = path.resolve(__dirname, '../../supabase/migrations/20261021000100_kani_service_payments_rls_update_delete.sql');

  const componentCode = fs.readFileSync(paymentsComponentPath, 'utf-8');
  const libCode = fs.readFileSync(paymentsLibPath, 'utf-8');
  const migrationCode = fs.readFileSync(migrationPath, 'utf-8');

  it('1. La tabla Desktop cuenta exactamente con las 6 columnas en el nuevo orden con Importe al final', () => {
    // 6 columnas en thead en el orden exacto: Hora | Servicio | Barbero | Cliente | Método de pago | Importe
    const theadMatch = componentCode.match(/<thead[^>]*>[\s\S]*?<\/thead>/);
    expect(theadMatch).not.toBeNull();
    const thead = theadMatch ? theadMatch[0] : '';

    const horaIdx = thead.indexOf('>Hora<');
    const servicioIdx = thead.indexOf('>Servicio<');
    const barberoIdx = thead.indexOf('>Barbero<');
    const clienteIdx = thead.indexOf('>Cliente<');
    const metodoIdx = thead.indexOf('>Método de pago<');
    const importeIdx = thead.indexOf('>Importe<');

    expect(horaIdx).toBeGreaterThan(0);
    expect(servicioIdx).toBeGreaterThan(horaIdx);
    expect(barberoIdx).toBeGreaterThan(servicioIdx);
    expect(clienteIdx).toBeGreaterThan(barberoIdx);
    expect(metodoIdx).toBeGreaterThan(clienteIdx);
    expect(importeIdx).toBeGreaterThan(metodoIdx); // Importe es siempre la última columna

    // Importe alineado a la derecha
    expect(thead).toMatch(/<th[^>]*text-right[^>]*>Importe<\/th>/);
  });

  it('2. Total de la tabla en tfoot adaptado al nuevo orden de columnas', () => {
    const tfootMatch = componentCode.match(/<tfoot[^>]*>[\s\S]*?<\/tfoot>/);
    expect(tfootMatch).not.toBeNull();
    const tfoot = tfootMatch ? tfootMatch[0] : '';

    expect(tfoot).toContain('Total cobrado');
    expect(tfoot).toContain('{money(paymentStats.totalCollected)}');
    expect(tfoot).toContain('colSpan={4}');
  });

  it('3. Elimina completamente la card duplicada e independiente de Total cobrado', () => {
    expect(componentCode).not.toContain('Resumen de Total cobrado');
    expect(componentCode).not.toContain('Suma exacta de los registros en service_payments');
  });

  it('4. Elimina encabezados innecesarios de estadísticas (comienza directamente con métricas)', () => {
    expect(componentCode).not.toContain('Estadísticas de cobros');
    expect(componentCode).not.toContain('Métricas calculadas exclusivamente sobre los cobros registrados');
    expect(componentCode).toContain('{money(paymentStats.totalCollected)}');
    expect(componentCode).toContain('{money(paymentStats.averageTicket)}');
  });

  it('5. Labels de formulario simplificados y campos numéricos alineados a la derecha', () => {
    expect(componentCode).toContain('Contacto (opcional)');
    expect(componentCode).not.toContain('Contacto del cliente (opcional)');
    expect(componentCode).toContain('Cliente (opcional)');
    expect(componentCode).toContain('Descuento (opcional)');
    expect(componentCode).not.toContain('Descuento ($ ARS opcional)');

    // Inputs de importe y descuento alineados a la derecha
    expect(componentCode).toContain('id="form-price"');
    expect(componentCode).toContain('id="form-discount"');
    expect(componentCode).toMatch(/id="form-price"[\s\S]*?text-right/);
    expect(componentCode).toMatch(/id="form-discount"[\s\S]*?text-right/);
  });

  it('6. Card de cálculo simplificada y de baja altura', () => {
    expect(componentCode).toContain('Servicio:');
    expect(componentCode).toContain('Total:');
    expect(componentCode).toContain('{money(balanceToCollectAtShop)}');
  });

  it('7. Gestión de cobros: Edición con estado explícito y Guardar cambios / Cancelar', () => {
    expect(componentCode).toContain('editingPayment');
    expect(componentCode).toContain('Editando cobro');
    expect(componentCode).toContain('Guardar cambios');
    expect(componentCode).toContain('Cancelar edición');
    expect(libCode).toContain('export async function updateServicePayment');
  });

  it('8. Gestión de cobros: Eliminación con confirmación explícita (diálogo)', () => {
    expect(componentCode).toContain('¿Eliminar este cobro?');
    expect(componentCode).toContain('Esta acción no se puede deshacer.');
    expect(componentCode).toContain('Eliminar definitivamente');
    expect(libCode).toContain('export async function deleteServicePayment');
  });

  it('9. Políticas RLS en migración SQL: Admin UPDATE/DELETE total, Barbero UPDATE propio sin cambio de barber_id, sin DELETE', () => {
    expect(migrationCode).toContain('grant delete on table public.service_payments to authenticated;');
    expect(migrationCode).toContain('create policy service_payments_delete');
    expect(migrationCode).toMatch(/using\s*\(\s*public\.is_admin\(\)\s*\)/);

    expect(migrationCode).toContain('create policy service_payments_update');
    expect(migrationCode).toContain('with check (\n    public.is_admin()\n    or barber_id = public.current_staff_barber_id()\n  )');
  });
});

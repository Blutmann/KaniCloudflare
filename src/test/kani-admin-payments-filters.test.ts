import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  computePeriodMonthRangeLabel,
  computePeriodStartMonth,
  dateRangeForStatisticsPreset,
  getStatisticsPresetLabels,
  statisticsPresets,
  type StatisticsDatePreset,
} from '../lib/kani-statistics';

describe('Kani Barber Studio - Panel de administración: Pagos y etiquetas dinámicas de Período', () => {
  const paymentsPath = path.resolve(__dirname, '../components/kani/admin-payments.tsx');
  const statisticsPath = path.resolve(__dirname, '../components/kani/admin-statistics.tsx');
  const paymentsLibPath = path.resolve(__dirname, '../lib/kani-payments.ts');

  const paymentsCode = fs.readFileSync(paymentsPath, 'utf-8');
  const statisticsCode = fs.readFileSync(statisticsPath, 'utf-8');
  const paymentsLibCode = fs.readFileSync(paymentsLibPath, 'utf-8');

  it('1. Pagos elimina completamente encabezados «Registrar nuevo cobro» y «Filtros de búsqueda» e iconos asociados', () => {
    // Encabezado "Registrar nuevo cobro" e icono Sparkles
    expect(paymentsCode).not.toContain('Registrar nuevo cobro');
    expect(paymentsCode).not.toContain('<Sparkles');
    expect(paymentsCode).not.toMatch(/import\s*\{[^}]*Sparkles[^}]*\}\s*from\s*["']lucide-react["']/);

    // Encabezado "Filtros de búsqueda" e icono Filter
    expect(paymentsCode).not.toContain('Filtros de búsqueda');
    expect(paymentsCode).not.toContain('<Filter');
    expect(paymentsCode).not.toMatch(/import\s*\{[^}]*Filter[^}]*\}\s*from\s*["']lucide-react["']/);
  });

  it('2. Los filtros de Pagos siguen estrictamente el orden Período | Fecha específica | Barbero | Servicio', () => {
    const periodIdx = paymentsCode.indexOf('htmlFor="filter-period"');
    const dateIdx = paymentsCode.indexOf('htmlFor="filter-date"');
    const barberIdx = paymentsCode.indexOf('htmlFor="filter-barber"');
    const serviceIdx = paymentsCode.indexOf('htmlFor="filter-service"');

    expect(periodIdx).toBeGreaterThan(0);
    expect(dateIdx).toBeGreaterThan(periodIdx);
    expect(barberIdx).toBeGreaterThan(dateIdx);
    expect(serviceIdx).toBeGreaterThan(barberIdx);
  });

  it('3. Genera dinámicamente etiquetas con mes y año actual sin hardcodear', () => {
    const labelsOct2026 = getStatisticsPresetLabels('2026-10-21');
    expect(labelsOct2026.TODAY).toBe('Hoy');
    expect(labelsOct2026.YESTERDAY).toBe('Ayer');
    expect(labelsOct2026.THIS_WEEK).toBe('Esta semana');
    expect(labelsOct2026.THIS_MONTH).toBe('Octubre 2026');
    expect(labelsOct2026.THIS_YEAR).toBe('2026');
    expect(labelsOct2026.PREVIOUS_MONTH).toBe('Septiembre 2026');
    expect(labelsOct2026.PREVIOUS_YEAR).toBe('2025');
    expect(labelsOct2026.LAST_7_DAYS).toBe('Últimos 7 días');
    expect(labelsOct2026.LAST_14_DAYS).toBe('Últimos 14 días');
    expect(labelsOct2026.LAST_90_DAYS).toBe('Ago - Oct 2026');
    expect(labelsOct2026.LAST_180_DAYS).toBe('May - Oct 2026');
  });

  it('4. Soporta correctamente rangos que atraviesan años en trimestre y semestre', () => {
    // Caso Febrero 2026: trimestre abarca Diciembre 2025 a Febrero 2026
    const labelsFeb2026 = getStatisticsPresetLabels('2026-02-15');
    expect(labelsFeb2026.LAST_90_DAYS).toBe('Dic 2025 - Feb 2026');
    expect(labelsFeb2026.LAST_180_DAYS).toBe('Sep 2025 - Feb 2026');

    // Rango de fechas para Febrero 2026
    const rangeQuarterFeb = dateRangeForStatisticsPreset('LAST_90_DAYS', '2026-02-15');
    expect(rangeQuarterFeb?.start).toBe('2025-12-01');
    expect(rangeQuarterFeb?.end).toBe('2026-02-15');

    const rangeSemesterFeb = dateRangeForStatisticsPreset('LAST_180_DAYS', '2026-02-15');
    expect(rangeSemesterFeb?.start).toBe('2025-09-01');
    expect(rangeSemesterFeb?.end).toBe('2026-02-15');

    // Caso Abril 2026: semestre abarca Noviembre 2025 a Abril 2026
    const labelsAbr2026 = getStatisticsPresetLabels('2026-04-10');
    expect(labelsAbr2026.LAST_180_DAYS).toBe('Nov 2025 - Abr 2026');

    // Caso Enero 2026: mes anterior es Diciembre 2025
    const labelsEne2026 = getStatisticsPresetLabels('2026-01-10');
    expect(labelsEne2026.PREVIOUS_MONTH).toBe('Diciembre 2025');
    expect(labelsEne2026.LAST_90_DAYS).toBe('Nov 2025 - Ene 2026');
    expect(labelsEne2026.LAST_180_DAYS).toBe('Ago 2025 - Ene 2026');
  });

  it('5. Rangos exactos de cada opción de Período para la fecha de ejemplo (21 de octubre de 2026)', () => {
    const today = '2026-10-21';

    // Hoy -> 21/10/2026
    const rHoy = dateRangeForStatisticsPreset('TODAY', today);
    expect(rHoy?.start).toBe('2026-10-21');
    expect(rHoy?.end).toBe('2026-10-21');

    // Ayer -> 20/10/2026
    const rAyer = dateRangeForStatisticsPreset('YESTERDAY', today);
    expect(rAyer?.start).toBe('2026-10-20');
    expect(rAyer?.end).toBe('2026-10-20');

    // Esta semana -> 19/10/2026 al 21/10/2026 (lunes de la semana actual hasta el momento actual)
    const rSemana = dateRangeForStatisticsPreset('THIS_WEEK', today);
    expect(rSemana?.start).toBe('2026-10-19');
    expect(rSemana?.end).toBe('2026-10-21');

    // Octubre 2026 -> 01/10/2026 al 21/10/2026 (día 1 del mes actual hasta el momento actual)
    const rMes = dateRangeForStatisticsPreset('THIS_MONTH', today);
    expect(rMes?.start).toBe('2026-10-01');
    expect(rMes?.end).toBe('2026-10-21');

    // 2026 -> 01/01/2026 al 21/10/2026 (1 de enero del año actual hasta el momento actual)
    const rAnio = dateRangeForStatisticsPreset('THIS_YEAR', today);
    expect(rAnio?.start).toBe('2026-01-01');
    expect(rAnio?.end).toBe('2026-10-21');

    // Septiembre 2026 -> 01/09/2026 al 30/09/2026 (mes calendario anterior completo)
    const rMesAnt = dateRangeForStatisticsPreset('PREVIOUS_MONTH', today);
    expect(rMesAnt?.start).toBe('2026-09-01');
    expect(rMesAnt?.end).toBe('2026-09-30');

    // 2025 -> 01/01/2025 al 31/12/2025 (año calendario anterior completo)
    const rAnioAnt = dateRangeForStatisticsPreset('PREVIOUS_YEAR', today);
    expect(rAnioAnt?.start).toBe('2025-01-01');
    expect(rAnioAnt?.end).toBe('2025-12-31');

    // Últimos 7 días -> 15/10/2026 al 21/10/2026 (hoy + 6 días calendario anteriores)
    const r7 = dateRangeForStatisticsPreset('LAST_7_DAYS', today);
    expect(r7?.start).toBe('2026-10-15');
    expect(r7?.end).toBe('2026-10-21');

    // Últimos 14 días -> 08/10/2026 al 21/10/2026 (hoy + 13 días calendario anteriores)
    const r14 = dateRangeForStatisticsPreset('LAST_14_DAYS', today);
    expect(r14?.start).toBe('2026-10-08');
    expect(r14?.end).toBe('2026-10-21');

    // Ago - Oct 2026 -> 01/08/2026 al 21/10/2026 (mes actual + 2 meses anteriores hasta hoy)
    const rTri = dateRangeForStatisticsPreset('LAST_90_DAYS', today);
    expect(rTri?.start).toBe('2026-08-01');
    expect(rTri?.end).toBe('2026-10-21');

    // May - Oct 2026 -> 01/05/2026 al 21/10/2026 (mes actual + 5 meses anteriores hasta hoy)
    const rSem = dateRangeForStatisticsPreset('LAST_180_DAYS', today);
    expect(rSem?.start).toBe('2026-05-01');
    expect(rSem?.end).toBe('2026-10-21');
  });

  it('6. Datos (Estadísticas) y Pagos comparten la misma fuente de etiquetas y presets', () => {
    expect(statisticsCode).toContain('getStatisticsPresetLabels(businessToday)');
    expect(paymentsCode).toContain('getStatisticsPresetLabels(todayStr)');
    expect(statisticsCode).toContain('presetLabels[preset]');
    expect(paymentsCode).toContain('presetLabels[preset]');
  });

  it('7. Pagos filtra registros reales por rango en base de datos mediante fetchServicePayments', () => {
    expect(paymentsLibCode).toMatch(/startDate\?:\s*string/);
    expect(paymentsLibCode).toMatch(/endDate\?:\s*string/);
    expect(paymentsLibCode).toContain("query.gte('payment_date', filters.startDate)");
    expect(paymentsLibCode).toContain("query.lte('payment_date', filters.endDate)");
    expect(paymentsCode).toContain('dateRangeForStatisticsPreset(filterPeriod, todayStr, filterDate)');
  });

  it('8. Distribución responsive limpia para los 4 filtros en mobile y desktop', () => {
    expect(paymentsCode).toMatch(/grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3/);
  });
});

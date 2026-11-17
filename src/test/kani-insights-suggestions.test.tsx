import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildInsightSuggestions, formatCountEs } from '@/lib/kani-statistics';

describe('Kani — Optimización UX/UI de sugerencias en Datos', () => {
  it('pluralizes Spanish nouns accurately via formatCountEs', () => {
    expect(formatCountEs(0, 'servicio', 'servicios')).toBe('0 servicios');
    expect(formatCountEs(1, 'servicio', 'servicios')).toBe('1 servicio');
    expect(formatCountEs(2, 'servicio', 'servicios')).toBe('2 servicios');
    expect(formatCountEs(1, 'turno', 'turnos')).toBe('1 turno');
    expect(formatCountEs(3, 'turno', 'turnos')).toBe('3 turnos');
    expect(formatCountEs(1, 'cancelación', 'cancelaciones')).toBe('1 cancelación');
    expect(formatCountEs(4, 'cancelación', 'cancelaciones')).toBe('4 cancelaciones');
  });

  it('handles 0 records without inventing trends', () => {
    const [activity, opportunity] = buildInsightSuggestions({
      currentServicesCount: 0,
      previousServicesCount: 0,
      servicesChangePercent: null,
      revenueChangePercent: null,
      previousLabel: 'los 7 días anteriores',
      cancelledCount: 0,
      pendingCount: 0,
      totalAppointmentsCount: 0,
    });

    expect(activity.title).toBe('Sin actividad registrada');
    expect(activity.description).toContain('Todavía no hay servicios cobrados');
    expect(opportunity.title).toBe('Disponibilidad abierta');
  });

  it('handles 1 service vs 1 previous service with exact grammar', () => {
    const [activity] = buildInsightSuggestions({
      currentServicesCount: 1,
      previousServicesCount: 1,
      servicesChangePercent: 0,
      revenueChangePercent: 0,
      previousLabel: 'los 7 días anteriores',
      cancelledCount: 0,
      pendingCount: 0,
      totalAppointmentsCount: 1,
    });

    expect(activity.description).toBe(
      'Registraste 1 servicio, frente a 1 en los 7 días anteriores.',
    );
    expect(activity.description).not.toContain('1 servicios');
  });

  it('handles insufficient comparative data (previous = 0, current > 0)', () => {
    const [activity] = buildInsightSuggestions({
      currentServicesCount: 3,
      previousServicesCount: 0,
      servicesChangePercent: null,
      revenueChangePercent: null,
      previousLabel: 'el mes anterior',
      cancelledCount: 0,
      pendingCount: 0,
      totalAppointmentsCount: 3,
    });

    expect(activity.title).toBe('Base inicial en construcción');
    expect(activity.description).toContain('Registraste 3 servicios');
    expect(activity.description).toContain('No hay registros en el mes anterior');
  });

  it('handles positive and negative variations with revenue context and singular/plural cancellations', () => {
    const [posActivity, posOpportunity] = buildInsightSuggestions({
      currentServicesCount: 6,
      previousServicesCount: 4,
      servicesChangePercent: 50,
      revenueChangePercent: 35,
      previousLabel: 'los 7 días anteriores',
      cancelledCount: 1,
      pendingCount: 0,
      totalAppointmentsCount: 7,
    });

    expect(posActivity.title).toBe('Actividad en alza (+50%)');
    expect(posActivity.description).toContain('Registraste 6 servicios, frente a 4');
    expect(posActivity.description).toContain('(+35% en ingresos)');
    expect(posOpportunity.title).toBe('1 cancelación en el período');
    expect(posOpportunity.description).toContain('De 7 turnos registrados, 1 se canceló');

    const [negActivity, negOpportunity] = buildInsightSuggestions({
      currentServicesCount: 2,
      previousServicesCount: 5,
      servicesChangePercent: -60,
      revenueChangePercent: -50,
      previousLabel: 'la semana anterior',
      cancelledCount: 4,
      pendingCount: 0,
      totalAppointmentsCount: 6,
    });

    expect(negActivity.title).toBe('Actividad por debajo del período anterior (-60%)');
    expect(negActivity.description).toContain('Registraste 2 servicios, frente a 5');
    expect(negOpportunity.title).toBe('4 cancelaciones en el período');
    expect(negOpportunity.description).toContain('De 6 turnos registrados, 4 se cancelaron');
  });

  it('uses a single Liquid Glass container without nested sub-cards in liquid-glass-admin.css', () => {
    const lgAdminCss = fs.readFileSync(
      path.resolve(__dirname, '../components/kani/experimental/liquid-glass-admin.css'),
      'utf-8',
    );
    expect(lgAdminCss).toContain('.v2-insights .v2-insight-item');
    expect(lgAdminCss).toContain('background: transparent !important;');
    expect(lgAdminCss).toContain('border-left: 1px solid var(--lga-border) !important;');
    expect(lgAdminCss).toContain('border-top: 1px solid var(--lga-border) !important;');
  });
});

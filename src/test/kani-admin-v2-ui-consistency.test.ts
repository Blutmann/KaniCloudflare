import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Admin V2 — UI and Visual Consistency Audit (Structural Unification)', () => {
  const panelPath = path.resolve(__dirname, '../components/kani/v2/admin-filter-panel.tsx');
  const sharedPath = path.resolve(__dirname, '../components/kani/v2/shared.tsx');
  const schedulePath = path.resolve(__dirname, '../components/kani/admin-schedule-manager.tsx');
  const agendaPath = path.resolve(__dirname, '../components/kani/v2/agenda.tsx');
  const insightsPath = path.resolve(__dirname, '../components/kani/v2/insights.tsx');
  const cssPath = path.resolve(__dirname, '../components/kani/v2/v2.css');

  const panelCode = fs.readFileSync(panelPath, 'utf8');
  const sharedCode = fs.readFileSync(sharedPath, 'utf8');
  const scheduleCode = fs.readFileSync(schedulePath, 'utf8');
  const agendaCode = fs.readFileSync(agendaPath, 'utf8');
  const insightsCode = fs.readFileSync(insightsPath, 'utf8');
  const cssCode = fs.readFileSync(cssPath, 'utf8');

  describe('1. Componente Compartido Unificado (AdminFilterPanel)', () => {
    it('existe el componente AdminFilterPanel con AdminFilterCell, AdminFilterLabel y AdminFilterControl', () => {
      expect(panelCode).toContain('export function AdminFilterPanel');
      expect(panelCode).toContain('export function AdminFilterCell');
      expect(panelCode).toContain('export function AdminFilterLabel');
      expect(panelCode).toContain('export function AdminFilterControl');
    });

    it('shared.tsx re-exporta AdminFilterPanel y AdminFilterCell', () => {
      expect(sharedCode).toContain('AdminFilterPanel');
      expect(sharedCode).toContain('AdminFilterCell');
    });

    it('Turnos, Horarios y Datos utilizan todos AdminFilterPanel y AdminFilterCell', () => {
      expect(agendaCode).toContain('<AdminFilterPanel');
      expect(agendaCode).toContain('<AdminFilterCell');

      expect(scheduleCode).toContain('<AdminFilterPanel');
      expect(scheduleCode).toContain('<AdminFilterCell');

      expect(insightsCode).toContain('<AdminFilterPanel');
      expect(insightsCode).toContain('<AdminFilterCell');
    });
  });

  describe('2. Turnos y Horarios — Estructura exacta de 4 columnas', () => {
    it('Turnos renderiza las 4 celdas en el mismo orden: Período, Fecha, Barbero y Estado', () => {
      expect(agendaCode).toMatch(/<AdminFilterCell[^>]*label="Período"/);
      expect(agendaCode).toMatch(/<AdminFilterCell[^>]*label="Fecha"/);
      expect(agendaCode).toMatch(/<AdminFilterCell[^>]*label="Barbero"/);
      expect(agendaCode).toMatch(/<AdminFilterCell[^>]*label="Estado"/);
    });

    it('Horarios renderiza las 4 celdas en el mismo orden: Período, Fecha, Barbero y Estado', () => {
      expect(scheduleCode).toMatch(/<AdminFilterCell[^>]*label="Período"/);
      expect(scheduleCode).toMatch(/<AdminFilterCell[^>]*label="Fecha"/);
      expect(scheduleCode).toMatch(/<AdminFilterCell[^>]*label="Barbero"/);
      expect(scheduleCode).toMatch(/<AdminFilterCell[^>]*label="Estado"/);
    });

    it('Horarios elimina la card duplicada de la grilla y conserva solo la toolbar', () => {
      expect(scheduleCode).not.toMatch(/<button[^>]*className="[^"]*border-dashed[^"]*"[^>]*onClick=\{[^}]*openManualDialog/i);
      expect(scheduleCode).toContain('<AdminV2SectionToolbar');
      expect(scheduleCode).toContain('actionLabel="+ Agregar horario"');
    });
  });

  describe('3. Datos — Grilla de 4 columnas con huecos intencionales y Fecha específica', () => {
    it('en período normal, conserva los huecos en Columna 2 y Columna 4 con AdminFilterCell empty', () => {
      // Col 1: Período
      expect(insightsCode).toMatch(/<AdminFilterCell[^>]*label="Período"/);
      // Col 2: Fecha desde si CUSTOM, sino empty
      expect(insightsCode).toContain('{period === "CUSTOM" ? (');
      expect(insightsCode).toMatch(/<AdminFilterCell[^>]*empty/);
      // Col 3: Barbero
      expect(insightsCode).toMatch(/<AdminFilterCell[^>]*label="Barbero"/);
      // Col 4: Fecha hasta si CUSTOM, sino empty
    });

    it('al seleccionar Fecha específica (CUSTOM), las columnas 2 y 4 se llenan con Fecha desde y Fecha hasta', () => {
      expect(insightsCode).toMatch(/<AdminFilterCell[^>]*label="Fecha desde"/);
      expect(insightsCode).toMatch(/<AdminFilterCell[^>]*label="Fecha hasta"/);
    });

    it('valida desde <= hasta y muestra alerta cuando el rango es inválido', () => {
      expect(insightsCode).toContain('const isInvalidRange = period === "CUSTOM" && customStartDate > customEndDate;');
      expect(insightsCode).toContain('Rango no válido: Fecha desde debe ser menor o igual a Fecha hasta.');
    });

    it('no contiene ningún texto técnico con zona horaria o rango ISO', () => {
      expect(insightsCode).not.toContain('Métricas consolidadas en tiempo real');
      expect(insightsCode).not.toMatch(/\{start\}\s*al\s*\{end\}\s*·/);
    });
  });

  describe('4. CSS & Surface Unificada — Token --v2-surface translúcido', () => {
    it('v2.css aplica la misma superficie translúcida var(--v2-surface) y backdrop blur', () => {
      expect(cssCode).toMatch(/\.v2-admin-filter-panel[^\{]*\{[^}]*background:\s*var\(--v2-surface\)\s*!important/);
      expect(cssCode).toMatch(/\.v2-admin-filter-panel[^\{]*\{[^}]*backdrop-filter:\s*blur\(12px\)\s*!important/);
      expect(cssCode).toMatch(/\.v2-admin-filter-panel[^\{]*\{[^}]*border:\s*1px solid var\(--border\)\s*!important/);
      expect(cssCode).toMatch(/\.v2-admin-filter-panel[^\{]*\{[^}]*border-radius:\s*var\(--radius-card\)\s*!important/);
    });

    it('v2.css define exactamente 4 columnas fijas en Desktop y 2 columnas en Mobile sin redistribución', () => {
      expect(cssCode).toMatch(/\.v2-admin-filter-grid[^\{]*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)\s*!important/);
      expect(cssCode).toMatch(/@media\s*\(max-width:\s*767px\)\s*\{[^}]*\.v2-admin-filter-grid[^\{]*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*!important/);
    });

    it('v2.css define la celda vacía para mantener la altura base de la fila', () => {
      expect(cssCode).toMatch(/\.v2-admin-filter-cell-empty\s*\{[^}]*min-height:\s*59px\s*!important/);
      expect(cssCode).toMatch(/\.v2-admin-filter-cell-empty\s*\{[^}]*visibility:\s*hidden\s*!important/);
    });

    it('v2.css unifica dimensiones de control a 38px en Desktop y 36px en Mobile', () => {
      expect(cssCode).toMatch(/\.v2-admin-filter-panel\s*:is\(input,\s*select,\s*output\)[^\{]*\{[^}]*height:\s*38px\s*!important/);
      expect(cssCode).toMatch(/\.v2-admin-filter-panel\s*:is\(input,\s*select,\s*output\)[^\{]*\{[^}]*border-radius:\s*var\(--radius-control\)\s*!important/);
    });

    it('v2.css unifica labels a 11px font-size y 500 font-weight con color muted', () => {
      expect(cssCode).toMatch(/\.v2-admin-filter-label[^\{]*\{[^}]*font-size:\s*11px\s*!important/);
      expect(cssCode).toMatch(/\.v2-admin-filter-label[^\{]*\{[^}]*font-weight:\s*500\s*!important/);
    });
  });
});

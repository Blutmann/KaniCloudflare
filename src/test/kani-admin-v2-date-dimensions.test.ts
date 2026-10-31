import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('KANI — Dimensiones de campos Fecha en Admin V2 (Turnos, Horarios, Datos)', () => {
  const root = path.resolve(__dirname, '..');
  const v2Css = fs.readFileSync(path.join(root, 'components/kani/v2/v2.css'), 'utf-8');
  const agendaTsx = fs.readFileSync(path.join(root, 'components/kani/v2/agenda.tsx'), 'utf-8');
  const scheduleTsx = fs.readFileSync(path.join(root, 'components/kani/admin-schedule-manager.tsx'), 'utf-8');
  const insightsTsx = fs.readFileSync(path.join(root, 'components/kani/v2/insights.tsx'), 'utf-8');

  describe('1. Presencia de controles Fecha en Turnos, Horarios y Datos', () => {
    it('Turnos tiene control Período (select) y Fecha (input[type="date"]) en la misma fila', () => {
      expect(agendaTsx).toContain('<AdminFilterCell label="Período" htmlFor="v2-appointments-period">');
      expect(agendaTsx).toContain('<AdminFilterCell label="Fecha" htmlFor="v2-appointments-date">');
      expect(agendaTsx).toContain('id="v2-appointments-date"');
      expect(agendaTsx).toContain('type="date"');
    });

    it('Horarios tiene control Período (select) y Fecha (input[type="date"]) en la misma fila', () => {
      expect(scheduleTsx).toContain('<AdminFilterCell label="Período" htmlFor="schedule-date-preset">');
      expect(scheduleTsx).toContain('<AdminFilterCell label="Fecha" htmlFor="schedule-specific-date">');
      expect(scheduleTsx).toContain('id="schedule-specific-date"');
      expect(scheduleTsx).toContain('type="date"');
    });

    it('Datos tiene controles Fecha desde y Fecha hasta (ambos input[type="date"]) para rango personalizado', () => {
      expect(insightsTsx).toContain('<AdminFilterCell label="Fecha desde" htmlFor="v2-insights-custom-start">');
      expect(insightsTsx).toContain('<AdminFilterCell label="Fecha hasta" htmlFor="v2-insights-custom-end">');
      expect(insightsTsx).toContain('id="v2-insights-custom-start"');
      expect(insightsTsx).toContain('id="v2-insights-custom-end"');
    });
  });

  describe('2. Unificación visual a 44px de altura en Mobile', () => {
    it('unifica la altura a exactamente 44px (height, min-height, max-height) en mobile para todos los controles de filtros', () => {
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.v2-admin-filter-panel :is\(input, select, output\)[\s\S]*?height:\s*44px\s*!important/);
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.v2-admin-filter-panel :is\(input, select, output\)[\s\S]*?min-height:\s*44px\s*!important/);
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.v2-admin-filter-panel :is\(input, select, output\)[\s\S]*?max-height:\s*44px\s*!important/);
    });

    it('aplica altura de 44px específicamente a input[type="date"] en mobile', () => {
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?input\[type="date"\]\s*\{[^}]*height:\s*44px\s*!important/);
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?input\[type="date"\]\s*\{[^}]*min-height:\s*44px\s*!important/);
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?input\[type="date"\]\s*\{[^}]*max-height:\s*44px\s*!important/);
    });

    it('unifica el padding horizontal y vertical con box-sizing: border-box', () => {
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?input\[type="date"\]\s*\{[^}]*padding:\s*0 10px\s*!important/);
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?input\[type="date"\]\s*\{[^}]*box-sizing:\s*border-box\s*!important/);
    });

    it('utiliza font-size de 16px en mobile para prevenir el auto-zoom de iOS Safari al enfocar', () => {
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?input\[type="date"\]\s*\{[^}]*font-size:\s*16px\s*!important/);
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.v2-admin-filter-panel :is\(input, select, output\)[\s\S]*?font-size:\s*16px\s*!important/);
    });
  });

  describe('3. Normalización WebKit/iOS Safari y Chromium', () => {
    it('elimina la apariencia nativa con -webkit-appearance: none y appearance: none', () => {
      expect(v2Css).toMatch(/input\[type="date"\]\s*\{[^}]*-webkit-appearance:\s*none\s*!important/);
      expect(v2Css).toMatch(/input\[type="date"\]\s*\{[^}]*appearance:\s*none\s*!important/);
    });

    it('centra verticalmente el texto de la fecha en WebKit/iOS Safari via ::-webkit-date-and-time-value', () => {
      expect(v2Css).toMatch(/input\[type="date"\]::-webkit-date-and-time-value\s*\{[^}]*text-align:\s*left\s*!important/);
      expect(v2Css).toMatch(/input\[type="date"\]::-webkit-date-and-time-value\s*\{[^}]*display:\s*flex\s*!important/);
      expect(v2Css).toMatch(/input\[type="date"\]::-webkit-date-and-time-value\s*\{[^}]*align-items:\s*center\s*!important/);
      expect(v2Css).toMatch(/input\[type="date"\]::-webkit-date-and-time-value\s*\{[^}]*margin:\s*0\s*!important/);
    });

    it('centra el contenedor interno de edición de Chromium via ::-webkit-datetime-edit', () => {
      expect(v2Css).toMatch(/input\[type="date"\]::-webkit-datetime-edit[^\{]*\{[^}]*display:\s*inline-flex\s*!important/);
      expect(v2Css).toMatch(/input\[type="date"\]::-webkit-datetime-edit[^\{]*\{[^}]*align-items:\s*center\s*!important/);
    });

    it('alinea y centra el ícono de calendario (picker indicator) en Chromium y WebKit', () => {
      expect(v2Css).toMatch(/input\[type="date"\]::-webkit-calendar-picker-indicator\s*\{[^}]*cursor:\s*pointer\s*!important/);
      expect(v2Css).toMatch(/input\[type="date"\]::-webkit-calendar-picker-indicator\s*\{[^}]*align-self:\s*center\s*!important/);
      expect(v2Css).toMatch(/input\[type="date"\]::-webkit-calendar-picker-indicator\s*\{[^}]*margin-left:\s*auto\s*!important/);
    });
  });

  describe('4. Alineación horizontal de etiquetas y altura idéntica entre columnas de la fila', () => {
    it('aplica align-items: stretch al grid de filtros en mobile para evitar saltos entre columnas', () => {
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.v2-admin-filter-grid[\s\S]*?align-items:\s*stretch\s*!important/);
    });

    it('fija la altura de las etiquetas v2-admin-filter-label a 16px para alinear perfectamente los títulos de campo', () => {
      expect(v2Css).toMatch(/\.v2-admin-filter-label[^\{]*\{[^}]*height:\s*16px\s*!important/);
      expect(v2Css).toMatch(/\.v2-admin-filter-label[^\{]*\{[^}]*min-height:\s*16px\s*!important/);
      expect(v2Css).toMatch(/\.v2-admin-filter-label[^\{]*\{[^}]*max-height:\s*16px\s*!important/);
    });

    it('iguala la celda vacía v2-admin-filter-cell-empty en mobile a 63px (16px label + 3px gap + 44px control)', () => {
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.v2-admin-filter-cell-empty\s*\{[^}]*min-height:\s*63px\s*!important/);
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.v2-admin-filter-cell-empty\s*\{[^}]*height:\s*63px\s*!important/);
    });
  });
});

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('KANI — Dimensiones de filtros en Admin V2 Mobile (Referencia Clientes: Ordenar por)', () => {
  const root = path.resolve(__dirname, '..');
  const v2Css = fs.readFileSync(path.join(root, 'components/kani/v2/v2.css'), 'utf-8');
  const agendaTsx = fs.readFileSync(path.join(root, 'components/kani/v2/agenda.tsx'), 'utf-8');
  const scheduleTsx = fs.readFileSync(path.join(root, 'components/kani/admin-schedule-manager.tsx'), 'utf-8');
  const insightsTsx = fs.readFileSync(path.join(root, 'components/kani/v2/insights.tsx'), 'utf-8');
  const clientsTsx = fs.readFileSync(path.join(root, 'components/kani/v2/clients.tsx'), 'utf-8');

  describe('1. Presencia de controles en Turnos, Horarios, Datos y Clientes', () => {
    it('Clientes define selector "Ordenar por" en v2-client-order', () => {
      expect(clientsTsx).toContain('<span className="v2-field-label">Ordenar por</span>');
      expect(clientsTsx).toContain('<label className="v2-field v2-client-order">');
    });

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

  describe('2. Dimensiones y escala visual unificadas con Clientes (44px altura, 12px tipografía)', () => {
    it('unifica la altura a 44px (height, min-height, max-height) en mobile para todos los filtros igualando a Clientes', () => {
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.v2-admin-filter-panel :is\(input, select, output\)[\s\S]*?height:\s*44px\s*!important/);
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.v2-admin-filter-panel :is\(input, select, output\)[\s\S]*?min-height:\s*44px\s*!important/);
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.v2-admin-filter-panel :is\(input, select, output\)[\s\S]*?max-height:\s*44px\s*!important/);
    });

    it('iguala la tipografía a 12px y peso regular 400 igual que en Clientes (v2-field select)', () => {
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.v2-admin-filter-panel :is\(input, select, output\)[\s\S]*?font-size:\s*12px\s*!important/);
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.v2-admin-filter-panel :is\(input, select, output\)[\s\S]*?font-weight:\s*400\s*!important/);
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.v2-admin-filter-panel :is\(input, select, output\)[\s\S]*?line-height:\s*1\.5\s*!important/);
    });

    it('iguala el padding interno a 9px 11px igual que en Clientes', () => {
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.v2-admin-filter-panel :is\(input, select, output\)[\s\S]*?padding:\s*9px 11px\s*!important/);
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.v2-admin-filter-panel :is\(input, select, output\)[\s\S]*?box-sizing:\s*border-box\s*!important/);
    });

    it('aplica las mismas dimensiones y tipografía de 12px regular a input[type="date"] en mobile', () => {
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?input\[type="date"\]\s*\{[^}]*height:\s*44px\s*!important/);
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?input\[type="date"\]\s*\{[^}]*padding:\s*9px 11px\s*!important/);
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?input\[type="date"\]\s*\{[^}]*font-size:\s*12px\s*!important/);
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?input\[type="date"\]\s*\{[^}]*font-weight:\s*400\s*!important/);
    });
  });

  describe('3. Normalización WebKit/iOS Safari y Chromium para controles Fecha', () => {
    it('elimina la apariencia nativa con -webkit-appearance: none y appearance: none', () => {
      expect(v2Css).toMatch(/input\[type="date"\]\s*\{[^}]*-webkit-appearance:\s*none\s*!important/);
      expect(v2Css).toMatch(/input\[type="date"\]\s*\{[^}]*appearance:\s*none\s*!important/);
    });

    it('alinea verticalmente el texto de fecha en iOS Safari via ::-webkit-date-and-time-value con font-size 12px y peso 400', () => {
      expect(v2Css).toMatch(/input\[type="date"\]::-webkit-date-and-time-value\s*\{[^}]*text-align:\s*left\s*!important/);
      expect(v2Css).toMatch(/input\[type="date"\]::-webkit-date-and-time-value\s*\{[^}]*display:\s*flex\s*!important/);
      expect(v2Css).toMatch(/input\[type="date"\]::-webkit-date-and-time-value\s*\{[^}]*align-items:\s*center\s*!important/);
      expect(v2Css).toMatch(/input\[type="date"\]::-webkit-date-and-time-value\s*\{[^}]*font-size:\s*12px\s*!important/);
      expect(v2Css).toMatch(/input\[type="date"\]::-webkit-date-and-time-value\s*\{[^}]*font-weight:\s*400\s*!important/);
    });

    it('centra el contenedor de edición de Chromium via ::-webkit-datetime-edit', () => {
      expect(v2Css).toMatch(/input\[type="date"\]::-webkit-datetime-edit[^\{]*\{[^}]*display:\s*inline-flex\s*!important/);
      expect(v2Css).toMatch(/input\[type="date"\]::-webkit-datetime-edit[^\{]*\{[^}]*align-items:\s*center\s*!important/);
    });

    it('alinea y centra el ícono de calendario (picker indicator) sin forzar dimensiones desmedidas', () => {
      expect(v2Css).toMatch(/input\[type="date"\]::-webkit-calendar-picker-indicator\s*\{[^}]*cursor:\s*pointer\s*!important/);
      expect(v2Css).toMatch(/input\[type="date"\]::-webkit-calendar-picker-indicator\s*\{[^}]*align-self:\s*center\s*!important/);
      expect(v2Css).toMatch(/input\[type="date"\]::-webkit-calendar-picker-indicator\s*\{[^}]*height:\s*16px\s*!important/);
      expect(v2Css).toMatch(/input\[type="date"\]::-webkit-calendar-picker-indicator\s*\{[^}]*width:\s*16px\s*!important/);
    });
  });

  describe('4. Grid y alineación consistente sin alturas rígidas innecesarias', () => {
    it('aplica align-items: stretch al grid de filtros en mobile para garantizar alturas idénticas entre columnas', () => {
      expect(v2Css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.v2-admin-filter-grid[\s\S]*?align-items:\s*stretch\s*!important/);
    });

    it('las etiquetas conservan la tipografía 11px font-size y 500 font-weight compartida con Clientes (v2-field-label)', () => {
      expect(v2Css).toMatch(/\.v2-admin-filter-label[^\{]*\{[^}]*font-size:\s*11px\s*!important/);
      expect(v2Css).toMatch(/\.v2-admin-filter-label[^\{]*\{[^}]*font-weight:\s*500\s*!important/);
    });
  });
});

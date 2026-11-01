import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Admin V2 — Unificación de Espaciados Verticales (CSS & Layout Audit)', () => {
  const cssPath = path.resolve(__dirname, '../components/kani/v2/v2.css');
  const cssCode = fs.readFileSync(cssPath, 'utf8');

  describe('1. HORARIOS — Espaciado debajo de «Agregar horario» y separación entre bloques', () => {
    it('toolbar de sección define margen inferior normalizado de 16px en desktop y 14px en mobile', () => {
      // Desktop
      expect(cssCode).toMatch(
        /\.v2-section-toolbar,\s*\.v2-appointments-header\s*\{[^}]*margin:\s*0\s+0\s+16px\s+0\s*!important/
      );
      // Mobile
      expect(cssCode).toMatch(
        /@media\s*\(max-width:\s*767px\)\s*\{[^}]*\.v2-section-toolbar,\s*\.v2-appointments-header\s*\{[^}]*margin:\s*0\s+0\s+14px\s+0\s*!important/
      );
    });

    it('toolbar separa fecha y botón «Agregar horario» con gap de 14px desktop y 12px mobile', () => {
      expect(cssCode).toMatch(
        /\.v2-section-toolbar,\s*\.v2-appointments-header\s*\{[^}]*gap:\s*14px\s*!important/
      );
      expect(cssCode).toMatch(
        /@media\s*\(max-width:\s*767px\)\s*\{[^}]*\.v2-section-toolbar,\s*\.v2-appointments-header\s*\{[^}]*gap:\s*12px\s*!important/
      );
    });

    it('grilla de horarios anula margin-top redundante para que el margen de la toolbar gobierne exactamente 16px/14px', () => {
      expect(cssCode).toContain(
        '.v2-schedule .admin-schedule-date-group > .v2-section-toolbar + div'
      );
      expect(cssCode).toMatch(
        /\.v2-schedule\s+\.admin-schedule-date-group\s*>\s*\.v2-section-toolbar\s*\+\s*div\s*\{[^}]*margin-top:\s*0\s*!important/
      );
    });

    it('grupos de fecha consecutivos en Horarios mantienen separación de sección independiente (20px desktop, 18px mobile)', () => {
      expect(cssCode).toMatch(
        /\.v2-schedule\s+\.admin-schedule-date-group\s*\+\s*\.admin-schedule-date-group\s*\{[^}]*margin-top:\s*20px\s*!important/
      );
      expect(cssCode).toMatch(
        /@media\s*\(max-width:\s*767px\)\s*\{[^}]*\.v2-schedule\s+\.admin-schedule-date-group\s*\+\s*\.admin-schedule-date-group\s*\{[^}]*margin-top:\s*18px\s*!important/
      );
    });
  });

  describe('2. DATOS — Separación unificada entre bloques, métricas y gráficos', () => {
    it('.v2-insights-page utiliza flex column con gap de 16px desktop y 14px mobile evitando colisiones de márgenes', () => {
      expect(cssCode).toMatch(
        /\.v2-insights-page\s*\{[^}]*display:\s*flex\s*!important;[^}]*flex-direction:\s*column\s*!important;[^}]*gap:\s*16px\s*!important/
      );
      expect(cssCode).toMatch(
        /@media\s*\(max-width:\s*767px\)\s*\{[^}]*\.v2-insights-page\s*\{[^}]*gap:\s*14px\s*!important/
      );
    });

    it('en Datos, el panel de filtros y las métricas tienen margin-bottom: 0 para que el gap flex controle uniformemente la distancia', () => {
      expect(cssCode).toMatch(
        /\.v2-insights-page\s+\.v2-admin-filter-panel\s*\{[^}]*margin-bottom:\s*0\s*!important/
      );
      expect(cssCode).toMatch(
        /\.v2-insights-page\s+\.v2-metrics-four\s*\{[^}]*margin-bottom:\s*0\s*!important/
      );
    });

    it('grillas de gráficos (.v2-chart-grid) mantienen columnas responsive con gap 16px desktop y 14px mobile', () => {
      expect(cssCode).toMatch(
        /\.v2-chart-grid\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*gap:\s*16px/
      );
      expect(cssCode).toMatch(
        /\.v2-chart-grid,\s*\.v2-payment-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*gap:\s*14px/
      );
    });

    it('encabezados directos dentro de .v2-panel tienen margen normalizado de 12px hacia su contenido', () => {
      expect(cssCode).toMatch(
        /\.v2-panel\s*>\s*h2\s*\{[^}]*margin:\s*0\s+0\s+12px\s+0/
      );
    });
  });

  describe('3. SISTEMA GLOBAL — Filtros compartidos y cápsula de navegación', () => {
    it('.v2-page normaliza la separación superior respecto a la cápsula de navegación (20px desktop, 16px mobile)', () => {
      expect(cssCode).toMatch(
        /\.v2-page\s*\{[^}]*padding:\s*20px\s+0\s+0;/
      );
      expect(cssCode).toMatch(
        /\.v2-page\s*\{[^}]*padding-top:\s*16px;\s*gap:\s*14px;/
      );
    });

    it('panel de filtros compartido unifica margin-bottom a 16px desktop y 14px mobile', () => {
      expect(cssCode).toMatch(
        /\.v2-admin-filter-panel,\s*\.v2-admin-filter-card\s*\{[^}]*margin:\s*0\s+0\s+16px\s+0\s*!important/
      );
      expect(cssCode).toMatch(
        /@media\s*\(max-width:\s*767px\)\s*\{[^}]*\.v2-admin-filter-panel,\s*\.v2-admin-filter-card\s*\{[^}]*margin:\s*0\s+0\s+14px\s+0\s*!important/
      );
    });
  });
});

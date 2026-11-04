import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Admin V2 — UI and Visual Consistency Audit (Structural Unification)', () => {
  const panelPath = path.resolve(__dirname, '../components/kani/v2/admin-filter-panel.tsx');
  const sharedPath = path.resolve(__dirname, '../components/kani/v2/shared.tsx');
  const schedulePath = path.resolve(__dirname, '../components/kani/admin-schedule-manager.tsx');
  const agendaPath = path.resolve(__dirname, '../components/kani/v2/agenda.tsx');
  const horariosRoutePath = path.resolve(__dirname, '../routes/panel-administracion.horarios.tsx');
  const insightsPath = path.resolve(__dirname, '../components/kani/v2/insights.tsx');
  const cssPath = path.resolve(__dirname, '../components/kani/v2/v2.css');
  const stylesPath = path.resolve(__dirname, '../styles.css');

  const panelCode = fs.readFileSync(panelPath, 'utf8');
  const sharedCode = fs.readFileSync(sharedPath, 'utf8');
  const scheduleCode = fs.readFileSync(schedulePath, 'utf8');
  const agendaCode = fs.readFileSync(agendaPath, 'utf8');
  const horariosRouteCode = fs.readFileSync(horariosRoutePath, 'utf8');
  const insightsCode = fs.readFileSync(insightsPath, 'utf8');
  const cssCode = fs.readFileSync(cssPath, 'utf8');
  const stylesCode = fs.readFileSync(stylesPath, 'utf8');

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

  describe('3. Datos — Reorganización de filtros (Fila 1: Período y Barbero; Fila 2: Fechas en CUSTOM sin huecos vacíos)', () => {
    it('en período normal, muestra Período y Barbero en la primera fila sin celdas vacías', () => {
      // Fila 1: Período y Barbero
      expect(insightsCode).toMatch(/<AdminFilterCell[^>]*label="Período"/);
      expect(insightsCode).toMatch(/<AdminFilterCell[^>]*label="Barbero"/);
      // Sin huecos vacíos que desperdicien espacio
      expect(insightsCode).not.toContain('<AdminFilterCell empty');
    });

    it('al seleccionar Fecha específica (CUSTOM), se agregan Fecha desde y Fecha hasta en la segunda fila', () => {
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

  describe('5. Fondos sólidos opacos y eliminación de avisos en Horarios y Turnos', () => {
    it('Header: los 4 botones tienen fondo blanco sólido #FFFFFF en modo claro y oscuro sólido #1C1C1C sin transparencia en modo oscuro', () => {
      expect(stylesCode).toContain('.header-control-button.notification-trigger');
      expect(stylesCode).toContain('.header-control-button.header-whatsapp-button');
      expect(stylesCode).toContain('.header-control-button.theme-toggle');
      expect(stylesCode).toContain('.header-control-button.mobile-menu-trigger');
      expect(stylesCode).toContain('.header-control-button.admin-menu-trigger');
      expect(stylesCode).toMatch(/html\[data-theme="light"\]\s*:is\([\s\S]*?\.header-control-button\.admin-menu-trigger[\s\S]*?\)\s*\{[\s\S]*?background-color:\s*#FFFFFF\s*!important;[\s\S]*?backdrop-filter:\s*none\s*!important;/);
      expect(stylesCode).toMatch(/html\[data-theme="dark"\]\s*:is\([\s\S]*?\.header-control-button\.admin-menu-trigger[\s\S]*?\)\s*\{[\s\S]*?background-color:\s*#1C1C1C\s*!important;[\s\S]*?backdrop-filter:\s*none\s*!important;/);
    });

    it('Navegación administrativa, Próximo turno, contenedor de tarjetas horarias y fila de filtros tienen fondos sólidos (#FFFFFF en modo claro, #1C1C1C en modo oscuro)', () => {
      expect(cssCode).toMatch(/html\[data-theme="light"\]\s*:is\([\s\S]*?\.v2-nav\.admin-section-nav,[\s\S]*?\.v2-next,[\s\S]*?\.v2-admin-filter-panel,[\s\S]*?\.v2-schedule-cards-container[\s\S]*?\)\s*\{[\s\S]*?background-color:\s*#FFFFFF\s*!important;[\s\S]*?backdrop-filter:\s*none\s*!important;/);
      expect(cssCode).toMatch(/html\[data-theme="dark"\]\s*:is\([\s\S]*?\.v2-nav\.admin-section-nav,[\s\S]*?\.v2-next,[\s\S]*?\.v2-admin-filter-panel,[\s\S]*?\.v2-schedule-cards-container[\s\S]*?\)\s*\{[\s\S]*?background-color:\s*#1C1C1C\s*!important;[\s\S]*?backdrop-filter:\s*none\s*!important;/);
    });

    it('Horarios: la grilla de tarjetas horarias está en su propio contenedor independiente del bloque de filtros, conservando la barra de fecha y botón Agregar horario en medio', () => {
      expect(scheduleCode).toContain('<AdminFilterPanel ariaLabel="Filtros de horarios">');
      expect(scheduleCode).toContain('className="v2-schedule-cards-container admin-schedule-cards-container"');
      expect(scheduleCode).toContain('className="v2-schedule-cards-grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3"');
      expect(cssCode).toMatch(/\.v2-schedule-cards-container,\s*\.admin-schedule-cards-container\s*\{[\s\S]*?border:\s*1px solid var\(--border\)\s*!important;[\s\S]*?border-radius:\s*var\(--radius-card\)\s*!important;[\s\S]*?box-shadow:\s*var\(--v2-shadow\)\s*!important;/);
    });

    it('Fondos interiores de los filtros en Datos, Turnos y Horarios: #FBFAF9 en modo claro y #F9F9F9 en modo oscuro con texto e íconos oscuros legibles', () => {
      expect(cssCode).toMatch(/html\[data-theme="light"\]\s*:is\([\s\S]*?\.v2-admin-filter-panel\s*:is\(input,\s*select,\s*output\)[\s\S]*?\)\s*\{[\s\S]*?background-color:\s*#FBFAF9\s*!important;/);
      expect(cssCode).toMatch(/html\[data-theme="dark"\]\s*:is\([\s\S]*?\.v2-admin-filter-panel\s*:is\(input,\s*select,\s*output\)[\s\S]*?\)\s*\{[\s\S]*?color-scheme:\s*light\s*!important;[\s\S]*?background-color:\s*#F9F9F9\s*!important;[\s\S]*?color:\s*#191919\s*!important;/);
    });

    it('elimina por completo los avisos inferiores (.v2-footnote) en Horarios y Turnos sin contenedores vacíos', () => {
      expect(horariosRouteCode).not.toContain('Se reutiliza la gestión autorizada de disponibilidad');
      expect(horariosRouteCode).not.toContain('v2-footnote');
      expect(agendaCode).not.toContain('Los turnos pendientes se confirman al acreditarse la seña. Cancelar un turno no devuelve automáticamente la seña.');
      expect(agendaCode).not.toContain('v2-footnote');
    });
  });
});

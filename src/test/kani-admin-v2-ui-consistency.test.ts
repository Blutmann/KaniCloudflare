import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Admin V2 — UI and Visual Consistency Audit', () => {
  const schedulePath = path.resolve(__dirname, '../components/kani/admin-schedule-manager.tsx');
  const agendaPath = path.resolve(__dirname, '../components/kani/v2/agenda.tsx');
  const insightsPath = path.resolve(__dirname, '../components/kani/v2/insights.tsx');
  const paymentsPath = path.resolve(__dirname, '../components/kani/v2/payments.tsx');
  const cssPath = path.resolve(__dirname, '../components/kani/v2/v2.css');

  const scheduleCode = fs.readFileSync(schedulePath, 'utf8');
  const agendaCode = fs.readFileSync(agendaPath, 'utf8');
  const insightsCode = fs.readFileSync(insightsPath, 'utf8');
  const paymentsCode = fs.readFileSync(paymentsPath, 'utf8');
  const cssCode = fs.readFileSync(cssPath, 'utf8');

  describe('1. Horarios — Card duplicada "Agregar horario" eliminada', () => {
    it('no contiene ningún botón de card o celda "Agregar horario" dentro de la grilla de disponibilidad', () => {
      // No debe existir el botón tipo card con border-dashed o dentro del grid
      expect(scheduleCode).not.toMatch(
        /<button[^>]*className="[^"]*border-dashed[^"]*"[^>]*onClick=\{[^}]*openManualDialog/i,
      );
      expect(scheduleCode).not.toMatch(
        /<span[^>]*font-semibold[^>]*>\s*Agregar horario\s*<\/span>/i,
      );
    });

    it('conserva exclusivamente el botón bordó superior en AdminV2SectionToolbar', () => {
      expect(scheduleCode).toContain('<AdminV2SectionToolbar');
      expect(scheduleCode).toContain('actionLabel="+ Agregar horario"');
    });
  });

  describe('2. Turnos + Horarios — Filtros superiores unificados', () => {
    it('ambos módulos utilizan AdminV2FiltersPanel y AdminV2FilterField', () => {
      expect(scheduleCode).toContain('<AdminV2FiltersPanel ariaLabel="Filtros de horarios"');
      expect(agendaCode).toContain('<AdminV2FiltersPanel');
      expect(scheduleCode).toContain('<AdminV2FilterField');
      expect(agendaCode).toContain('<AdminV2FilterField');
    });

    it('ambos módulos definen exactamente los 4 filtros: Período, Fecha, Barbero y Estado', () => {
      // Horarios
      expect(scheduleCode).toMatch(/<AdminV2FilterField[^>]*label="Período"/);
      expect(scheduleCode).toMatch(/<AdminV2FilterField[^>]*label="Fecha"/);
      expect(scheduleCode).toMatch(/<AdminV2FilterField[^>]*label="Barbero"/);
      expect(scheduleCode).toMatch(/<AdminV2FilterField[^>]*label="Estado"/);

      // Turnos
      expect(agendaCode).toMatch(/<AdminV2FilterField[^>]*label="Período"/);
      expect(agendaCode).toMatch(/<AdminV2FilterField[^>]*label="Fecha"/);
      expect(agendaCode).toMatch(/<AdminV2FilterField[^>]*label="Barbero"/);
      expect(agendaCode).toMatch(/<AdminV2FilterField[^>]*label="Estado"/);
    });

    it('v2.css define la grilla compartida de 4 columnas en Desktop y 2x2 en Mobile', () => {
      expect(cssCode).toMatch(/\.v2-filters-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
      expect(cssCode).toMatch(/@media\s*\(max-width:\s*767px\)\s*\{[^}]*\.v2-filters-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    });

    it('v2.css unifica dimensiones de control: 38px en Desktop, 36px en Mobile', () => {
      expect(cssCode).toMatch(/\.v2-admin-filter-card\s*:is\(input,\s*select,\s*output\)\s*\{[^}]*height:\s*38px/);
      expect(cssCode).toMatch(/\.v2-admin-filter-card\s*\{[^}]*padding:\s*10px\s+14px/);
    });
  });

  describe('3. Fecha + CTA en Turnos y Horarios — Barra unificada', () => {
    it('ambos módulos renderizan AdminV2SectionToolbar con botón de acción', () => {
      expect(agendaCode).toMatch(/<AdminV2SectionToolbar\s+dateLabel=\{headerLabel\}\s+actionLabel="\+\s*Agregar turno"/);
      expect(scheduleCode).toMatch(/<AdminV2SectionToolbar\s+dateLabel=\{formatAdminV2Date\(date\)\}\s+actionLabel="\+\s*Agregar horario"/);
    });

    it('v2.css aplica misma alineación vertical, altura y tipografía al toolbar', () => {
      expect(cssCode).toMatch(/\.v2-section-toolbar[^\{]*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*space-between/);
      expect(cssCode).toMatch(/\.v2-toolbar-action[^\{]*\{[^}]*min-height:\s*34px/);
    });
  });

  describe('4. Pagos — Escala visual reducida y normalizada', () => {
    it('v2.css reduce la escala de .v2-segmented a 34px (32px en mobile) y elimina sobredimensión', () => {
      expect(cssCode).toMatch(/\.v2-segmented\s*button\s*\{[^}]*min-height:\s*34px/);
      expect(cssCode).toMatch(/\.v2-segmented\s*button\s*\{[^}]*height:\s*34px/);
      expect(cssCode).toContain('.v2-segmented button');
      expect(cssCode).toMatch(/\.v2-segmented\s*button\s*\{[^}]*min-height:\s*32px/);
    });

    it('v2.css ajusta .v2-payment-form con gaps y altura de controles de 38px / 36px', () => {
      expect(cssCode).toMatch(/\.v2-payment-form\s*:is\(input,\s*select\)\s*\{[^}]*height:\s*38px/);
      expect(cssCode).toMatch(/\.v2-payment-form\s*fieldset\s*\{[^}]*gap:\s*10px/);
    });
  });

  describe('5 & 6. Datos — Normalización y Fecha específica funcional', () => {
    it('Datos utiliza AdminV2FiltersPanel y AdminV2FilterField con clase de página unificada', () => {
      expect(insightsCode).toContain('<AdminV2FiltersPanel ariaLabel="Filtros de datos">');
      expect(insightsCode).toContain('<AdminV2FilterField label="Período"');
      expect(insightsCode).toContain('<AdminV2FilterField label="Barbero"');
      expect(insightsCode).toContain('className="v2-page v2-insights-page"');
    });

    it('selector de período incluye la opción "Fecha específica" (CUSTOM)', () => {
      expect(insightsCode).toMatch(/<option\s+value="CUSTOM">\s*Fecha específica\s*<\/option>/);
    });

    it('renderiza "Fecha desde" y "Fecha hasta" cuando period es CUSTOM', () => {
      expect(insightsCode).toContain('period === "CUSTOM"');
      expect(insightsCode).toMatch(/<AdminV2FilterField\s+label="Fecha desde"/);
      expect(insightsCode).toMatch(/<AdminV2FilterField\s+label="Fecha hasta"/);
    });

    it('valida desde <= hasta y muestra alerta cuando el rango es inválido', () => {
      expect(insightsCode).toContain('const isInvalidRange = period === "CUSTOM" && customStartDate > customEndDate;');
      expect(insightsCode).toContain('Rango no válido: Fecha desde debe ser menor o igual a Fecha hasta.');
    });

    it('aplica la zona horaria America/Argentina/Buenos_Aires mediante businessDateToday()', () => {
      expect(insightsCode).toContain('const today = businessDateToday();');
    });
  });

  describe('7. Datos — Eliminación del texto técnico', () => {
    it('no contiene ningún texto técnico con zona horaria o rango ISO en el pie de filtros', () => {
      expect(insightsCode).not.toContain('Métricas consolidadas en tiempo real');
      expect(insightsCode).not.toMatch(/\{start\}\s*al\s*\{end\}\s*·/);
    });
  });
});

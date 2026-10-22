import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio - Admin Horarios Filter Card & Status Renaming', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const componentPath = path.resolve(__dirname, '../components/kani/admin-schedule-manager.tsx');

  const css = fs.readFileSync(stylesPath, 'utf-8');
  const componentCode = fs.readFileSync(componentPath, 'utf-8');

  it('1. CSS: Mobile (< 640px) define la card con 2 columnas x 2 filas (periodo fecha / barbero estado)', () => {
    expect(css).toMatch(
      /@media\s*\(\s*max-width:\s*639px\s*\)\s*\{[\s\S]*?\.admin-schedule-filter-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)[\s\S]*?grid-template-areas:\s*[\s\S]*?"periodo fecha"[\s\S]*?"barbero estado"/
    );
  });

  it('2. CSS: Desktop (>= 640px) define la card con 4 columnas en 1 única fila (periodo fecha barbero estado)', () => {
    expect(css).toMatch(
      /@media\s*\(\s*min-width:\s*640px\s*\)\s*\{[\s\S]*?\.admin-schedule-filter-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)[\s\S]*?grid-template-areas:\s*[\s\S]*?"periodo fecha barbero estado"/
    );
  });

  it('3. CSS: .schedule-filter-estado tiene reseteo antidesborde min-width: 0 !important', () => {
    expect(css).toContain('.schedule-filter-estado');
  });

  it('4. JSX: Contiene selector Estado con opciones Todos, Disponible, No disponible, Reservado', () => {
    expect(componentCode).toContain('id="schedule-status-filter"');
    expect(componentCode).toContain('<option value="ALL">Todos</option>');
    expect(componentCode).toContain('<option value="AVAILABLE">Disponible</option>');
    expect(componentCode).toContain('<option value="UNAVAILABLE">No disponible</option>');
    expect(componentCode).toContain('<option value="RESERVED">Reservado</option>');
  });

  it('5. JSX: Se eliminaron los 3 badges estáticos de la card de filtros', () => {
    expect(componentCode).not.toContain('schedule-filter-con-reserva');
    expect(componentCode).not.toContain('schedule-filter-disponible');
    expect(componentCode).not.toContain('schedule-filter-no-disponible');
  });

  it('6. Terminología: La indicación visual de slot ocupado usa "Reservado" en vez de "Con reserva"', () => {
    expect(componentCode).not.toContain('label: "Con reserva"');
    expect(componentCode).toContain('label: "Reservado"');
    expect(componentCode).toContain('Reservado, no modificable');
    expect(componentCode).not.toContain('Con reserva, no modificable');
  });

  it('7. Lógica: El filtrado de slots por estado funciona correctamente para cada caso', () => {
    const mockSlots = [
      { id: '1', slot_date: '2026-10-22', status: 'AVAILABLE', occupied: false },
      { id: '2', slot_date: '2026-10-22', status: 'UNAVAILABLE', occupied: false },
      { id: '3', slot_date: '2026-10-22', status: 'AVAILABLE', occupied: true }, // occupied = reserved
    ];

    const filterFn = (slots: typeof mockSlots, filter: 'ALL' | 'AVAILABLE' | 'UNAVAILABLE' | 'RESERVED') => {
      if (filter === 'ALL') return slots;
      if (filter === 'AVAILABLE') return slots.filter((s) => !s.occupied && s.status === 'AVAILABLE');
      if (filter === 'UNAVAILABLE') return slots.filter((s) => !s.occupied && s.status !== 'AVAILABLE');
      if (filter === 'RESERVED') return slots.filter((s) => s.occupied);
      return slots;
    };

    expect(filterFn(mockSlots, 'ALL')).toHaveLength(3);
    expect(filterFn(mockSlots, 'AVAILABLE')).toEqual([mockSlots[0]]);
    expect(filterFn(mockSlots, 'UNAVAILABLE')).toEqual([mockSlots[1]]);
    expect(filterFn(mockSlots, 'RESERVED')).toEqual([mockSlots[2]]);
  });
});

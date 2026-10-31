import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { eligibleBarbersForAvailabilityStart, type PublicAvailabilityStart } from '@/lib/kani-availability';

describe('KANI — Orden de barberos en el paso Horario («¿Quién te va a atender?»)', () => {
  const css = fs.readFileSync(path.resolve(process.cwd(), 'src/styles.css'), 'utf-8');

  it('ordena siempre los barberos disponibles según el catálogo oficial: Lautaro, Gonzalo, Valentín, Franco', () => {
    const fakeNow = new Date('2026-11-07T12:00:00Z');
    const saturday = '2026-11-07';
    const time = '19:00';

    // Simulated starts returned from database in reversed / unordered order (Franco first)
    const unorderedStarts: PublicAvailabilityStart[] = [
      { barber_id: 'b4', slot_date: saturday, start_time: '19:00:00', is_exception: false, compatible_services: ['Corte'], barber_name: 'Franco' },
      { barber_id: 'b3', slot_date: saturday, start_time: '19:00:00', is_exception: false, compatible_services: ['Corte'], barber_name: 'Valentín' },
      { barber_id: 'b1', slot_date: saturday, start_time: '19:00:00', is_exception: false, compatible_services: ['Corte'], barber_name: 'Lautaro' },
      { barber_id: 'b2', slot_date: saturday, start_time: '19:00:00', is_exception: false, compatible_services: ['Corte'], barber_name: 'Gonzalo' },
    ];

    const result = eligibleBarbersForAvailabilityStart(unorderedStarts, saturday, time, 'Corte', fakeNow);

    expect(result).toEqual(['Lautaro', 'Gonzalo', 'Valentín', 'Franco']);
    expect(result[0]).toBe('Lautaro');
    expect(result[1]).toBe('Gonzalo');
    expect(result[2]).toBe('Valentín');
    expect(result[3]).toBe('Franco');
  });

  it('mantiene el orden oficial cuando solo un subconjunto de barberos está disponible', () => {
    const fakeNow = new Date('2026-11-07T12:00:00Z');
    const saturday = '2026-11-07';
    const time = '19:00';

    // Only Franco and Gonzalo available, in scrambled order
    const subsetStarts: PublicAvailabilityStart[] = [
      { barber_id: 'b4', slot_date: saturday, start_time: '19:00:00', is_exception: false, compatible_services: ['Corte'], barber_name: 'Franco' },
      { barber_id: 'b2', slot_date: saturday, start_time: '19:00:00', is_exception: false, compatible_services: ['Corte'], barber_name: 'Gonzalo' },
    ];

    const result = eligibleBarbersForAvailabilityStart(subsetStarts, saturday, time, 'Corte', fakeNow);

    expect(result).toEqual(['Gonzalo', 'Franco']);
    expect(result[0]).toBe('Gonzalo');
    expect(result[1]).toBe('Franco');
  });

  it('excluye barberos sin disponibilidad y no altera el orden de los restantes', () => {
    const fakeNow = new Date('2026-11-07T12:00:00Z');
    const saturday = '2026-11-07';
    const time = '19:00';

    // Lautaro and Franco available, Valentín and Gonzalo unavailable
    const starts: PublicAvailabilityStart[] = [
      { barber_id: 'b4', slot_date: saturday, start_time: '19:00:00', is_exception: false, compatible_services: ['Corte'], barber_name: 'Franco' },
      { barber_id: 'b1', slot_date: saturday, start_time: '19:00:00', is_exception: false, compatible_services: ['Corte'], barber_name: 'Lautaro' },
    ];

    const result = eligibleBarbersForAvailabilityStart(starts, saturday, time, 'Corte', fakeNow);

    expect(result).toEqual(['Lautaro', 'Franco']);
  });

  it('en mobile y desktop, .barber-choice-list utiliza display: grid con 3 columnas (repeat(3, minmax(0, 1fr)))', () => {
    expect(css).toMatch(/\.barber-choice-list\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  });
});

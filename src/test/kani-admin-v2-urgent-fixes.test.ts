import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { defaultSlotEndTime } from '../components/kani/admin-schedule-manager';
import { validateAvailabilityRange } from '../lib/kani-availability';

describe('1. Turnos manuales — Resolución de ambigüedad SQL', () => {
  it('la migración califica unívocamente las columnas en create_manual_appointment y update_manual_appointment', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../../supabase/migrations/20261029070000_kani_admin_v2_turnos_horarios_fixes.sql',
    );
    expect(fs.existsSync(migrationPath)).toBe(true);

    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    // Verifica que RETURNING esté calificado con el alias de tabla y use variables locales
    expect(migrationSql).toMatch(
      /RETURNING a\.id, a\.status, a\.booking_date, a\.start_time, a\.end_time, a\.request_number\s+INTO v_res_apt_id, v_res_status, v_res_booking_date, v_res_start_time, v_res_end_time, v_res_req_num/i,
    );

    // Verifica que RETURN QUERY SELECT use las variables locales v_res_*
    expect(migrationSql).toMatch(
      /RETURN QUERY SELECT\s+v_res_apt_id,\s+v_res_status,\s+v_res_booking_date,\s+v_res_start_time,\s+v_res_end_time,\s+v_res_req_num/i,
    );
  });
});

describe('2. Horarios — Modelo real de 45 minutos y persistencia', () => {
  it('defaultSlotEndTime calcula exactamente 45 minutos de duración operativa', () => {
    expect(defaultSlotEndTime('13:15')).toBe('14:00');
    expect(defaultSlotEndTime('13:30')).toBe('14:15');
    expect(defaultSlotEndTime('18:30')).toBe('19:15');
    expect(defaultSlotEndTime('10:00')).toBe('10:45');
    expect(defaultSlotEndTime('10:45')).toBe('11:30');
  });

  it('defaultSlotEndTime calcula correctamente el cruce de medianoche para 23:15 -> 00:00 (NUNCA 23:59)', () => {
    expect(defaultSlotEndTime('23:15')).toBe('00:00');
    expect(defaultSlotEndTime('23:15')).not.toBe('23:59');
    expect(defaultSlotEndTime('23:30')).toBe('00:15');
    expect(defaultSlotEndTime('23:45')).toBe('00:30');
  });

  it('validateAvailabilityRange valida correctamente el cruce de medianoche 23:15 -> 00:00', () => {
    const result = validateAvailabilityRange('23:15', '00:00');
    expect(result).toEqual({
      normalizedStart: '23:15:00',
      normalizedEnd: '00:00:00',
    });
  });

  it('validateAvailabilityRange rechaza horas de fin inválidas o iguales', () => {
    expect(() => validateAvailabilityRange('15:00', '15:00')).toThrow(
      'La hora de fin debe ser posterior a la hora de inicio.',
    );
    expect(() => validateAvailabilityRange('00:00', '00:00')).toThrow(
      'La hora de fin debe ser posterior a la hora de inicio.',
    );
    expect(() => validateAvailabilityRange('16:00', '15:00')).toThrow(
      'La hora de fin debe ser posterior a la hora de inicio.',
    );
  });

  it('las constraints de base de datos aceptan medianoche 00:00:00 sin errores de granularidad ni intervalo', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../../supabase/migrations/20261029070000_kani_admin_v2_turnos_horarios_fixes.sql',
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain("CHECK (end_time > start_time OR end_time = time '00:00:00')");
    expect(sql).toContain(
      "CHECK ((end_time > start_time AND end_time - start_time >= interval '5 minutes') OR (end_time = time '00:00:00' AND start_time <= time '23:55:00'))",
    );
    expect(sql).toContain(
      "CHECK (extract(second from end_time) = 0 AND (extract(minute from end_time)::int % 5 = 0 OR end_time = time '00:00:00'))",
    );
  });

  it('create_availability_slots persiste franjas de 45 min sin fusionar inicios adyacentes', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../../supabase/migrations/20261029070000_kani_admin_v2_turnos_horarios_fixes.sql',
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Usa 45 minutos por defecto
    expect(sql).toContain("(p_start_time + interval '45 minutes')::time");
    // No contiene la cláusula de fusión least/greatest con rangos adyacentes
    expect(sql).not.toContain('start_time = least(v_existing.start_time, p_start_time)');
    // Valida colisión con tsrange para soportar cruce de medianoche
    expect(sql).toContain('tsrange(');
  });
});

describe('3. Datos — Filtro Fecha específica en /admin-v2/datos', () => {
  it('el componente V2Insights soporta CUSTOM ("Fecha específica") con validación desde <= hasta', () => {
    const insightsPath = path.resolve(__dirname, '../components/kani/v2/insights.tsx');
    const code = fs.readFileSync(insightsPath, 'utf8');

    expect(code).toContain('"CUSTOM"');
    expect(code).toContain('Fecha específica');
    expect(code).toContain('Fecha desde');
    expect(code).toContain('Fecha hasta');
    expect(code).toContain('customStartDate > customEndDate');
    expect(code).toContain('Rango no válido: Fecha desde debe ser menor o igual a Fecha hasta.');
  });
});

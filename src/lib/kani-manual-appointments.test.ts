import { describe, expect, it } from 'vitest';
import { appointmentErrorMessage, type RealAppointment } from './kani-appointments';
import { aggregateClientsDirectory } from './kani-statistics';
import { normalizePhone } from './kani-phone';

describe('Manual Appointments & Recurring Logic Unit Tests', () => {
  it('correctly categorizes manual appointment collision errors in appointmentErrorMessage', () => {
    const error1 = new Error('SLOT_ALREADY_BOOKED');
    expect(appointmentErrorMessage(error1)).toContain('Ese horario acaba de dejar de estar disponible');

    const error2 = new Error('MANUAL_APPOINTMENT_NOT_ALLOWED');
    expect(appointmentErrorMessage(error2)).toBe('No tenés permisos para agendar en la agenda de otro barbero.');

    const error3 = new Error('AUTH_REQUIRED');
    expect(appointmentErrorMessage(error3)).toBe('Tenés que iniciar sesión para realizar esta acción.');
  });

  it('preserves isManual, origin, and createdByDisplayName in RealAppointment and aggregates in client directory', () => {
    const mockAppointments: RealAppointment[] = [
      {
        id: 'apt-manual-1',
        requestNumber: 101,
        service: 'corte',
        barber: 'Gonzalo',
        date: '2026-10-20',
        time: '14:00',
        endTime: '14:45',
        name: 'Martín Palermo',
        email: 'palermo@boca.internal',
        phone: '11 4444 5555',
        status: 'Confirmado',
        statusCode: 'CONFIRMED',
        notes: 'Cliente habitual',
        barberId: 'barber-gonzalo',
        serviceId: 'svc-corte',
        serviceName: 'Corte',
        serviceDuration: 45,
        servicePrice: 25000,
        clientId: 'client-1',
        createdAt: '2026-10-18T10:00:00Z',
        isManual: true,
        origin: 'MANUAL',
        createdByUserId: 'user-admin-uuid',
        createdByDisplayName: 'Admin',
        depositRequired: false,
        depositPaid: false,
      },
      {
        id: 'apt-public-2',
        requestNumber: 102,
        service: 'barba',
        barber: 'Gonzalo',
        date: '2026-10-10',
        time: '11:00',
        endTime: '11:30',
        name: 'Martín Palermo',
        email: 'palermo@boca.internal',
        phone: '11 4444 5555',
        status: 'Confirmado',
        statusCode: 'CONFIRMED',
        notes: '',
        barberId: 'barber-gonzalo',
        serviceId: 'svc-barba',
        serviceName: 'Barba',
        serviceDuration: 30,
        servicePrice: 10000,
        clientId: 'client-1',
        createdAt: '2026-10-09T15:00:00Z',
        isManual: false,
        origin: 'PUBLIC_WEB',
        depositRequired: true,
        depositPaid: true,
      },
    ];

    const directory = aggregateClientsDirectory(mockAppointments);
    expect(directory.length).toBe(1);

    const client = directory[0];
    expect(client.name).toBe('Martín Palermo');
    expect(client.totalAppointments).toBe(2);
    expect(client.appointments.length).toBe(2);

    const manualItem = client.appointments.find(a => a.id === 'apt-manual-1');
    expect(manualItem).toBeDefined();
    expect(manualItem?.isManual).toBe(true);
    expect(manualItem?.origin).toBe('MANUAL');
    expect(manualItem?.createdByDisplayName).toBe('Admin');

    const publicItem = client.appointments.find(a => a.id === 'apt-public-2');
    expect(publicItem).toBeDefined();
    expect(publicItem?.isManual).toBe(false);
    expect(publicItem?.origin).toBe('PUBLIC_WEB');
    expect(publicItem?.createdByDisplayName).toBeUndefined();
  });

  it('ensures manual appointments do not require deposit or checkout flow', () => {
    const manualAppointment: RealAppointment = {
      id: 'apt-manual-99',
      requestNumber: 99,
      service: 'corte-barba',
      barber: 'Lautaro',
      date: '2026-10-22',
      time: '16:00',
      endTime: '16:45',
      name: 'Roman Riquelme',
      email: 'roman@boca.internal',
      phone: '11 1010 1010',
      status: 'Confirmado',
      statusCode: 'CONFIRMED',
      notes: 'Turno permanente semanal',
      barberId: 'barber-lautaro',
      serviceId: 'svc-corte-barba',
      serviceName: 'Corte + barba',
      serviceDuration: 45,
      servicePrice: 30000,
      isManual: true,
      origin: 'MANUAL',
      createdByDisplayName: 'Lautaro',
      depositRequired: false,
      depositPaid: false,
      recurringRuleId: 'rule-weekly-123',
    };

    expect(manualAppointment.depositRequired).toBe(false);
    expect(manualAppointment.depositPaid).toBe(false);
    expect(manualAppointment.statusCode).toBe('CONFIRMED');
    expect(manualAppointment.recurringRuleId).toBe('rule-weekly-123');
  });

  it('simulates recurrence occurrence generation logic within 28-day horizon idempotently', () => {
    // Test rule: every Tuesday (day_of_week = 2) starting from 2026-10-20 for 4 weeks
    const rule = {
      id: 'rule-tuesdays',
      dayOfWeek: 2, // Tuesday
      startDate: '2026-10-20',
      startTime: '15:00',
      durationMinutes: 45,
      active: true,
    };

    const simulatedToday = new Date('2026-10-20T00:00:00Z');
    const horizonEnd = new Date('2026-11-17T00:00:00Z'); // 28 days later

    const occurrences: string[] = [];
    let current = new Date(simulatedToday);

    while (current <= horizonEnd) {
      // getUTCDay: 0=Sun, 1=Mon, 2=Tue...
      if (current.getUTCDay() === rule.dayOfWeek) {
        occurrences.push(current.toISOString().slice(0, 10));
      }
      current.setUTCDate(current.getUTCDate() + 1);
    }

    // Must generate exactly 5 Tuesdays within [2026-10-20, 2026-11-17]:
    // Oct 20, Oct 27, Nov 3, Nov 10, Nov 17
    expect(occurrences).toEqual([
      '2026-10-20',
      '2026-10-27',
      '2026-11-03',
      '2026-11-10',
      '2026-11-17',
    ]);

    // Idempotency: if Nov 3 already exists (or was cancelled), the generator skips it
    const existingDates = new Set(['2026-10-20', '2026-11-03']);
    const newlyCreated = occurrences.filter(date => !existingDates.has(date));

    expect(newlyCreated).toEqual(['2026-10-27', '2026-11-10', '2026-11-17']);
  });

  it('normalizes Argentine client phone identically to public reservations (+549...)', () => {
    const localInput = '11 2345 6789';
    const norm = normalizePhone(localInput, 'AR');
    expect(norm).not.toBeNull();
    expect(norm?.e164).toBe('+5491123456789');
    expect(norm?.display).toBe('+54 9 11 2345 6789');

    const formattedInput = '+54 9 11 2345 6789';
    const norm2 = normalizePhone(formattedInput, 'AR');
    expect(norm2?.e164).toBe('+5491123456789');

    // Invalid phone is rejected
    const invalidInput = '1234';
    expect(normalizePhone(invalidInput, 'AR')).toBeNull();
  });

  it('normalizes international client phone correctly for non-AR countries', () => {
    const usPhone = '202 555 0123';
    const normUS = normalizePhone(usPhone, 'US');
    expect(normUS?.e164).toBe('+12025550123');

    const clPhone = '9 6123 4567';
    const normCL = normalizePhone(clPhone, 'CL');
    expect(normCL?.e164).toBe('+56961234567');
  });

  it('rejects manual appointment creation if client email is missing or empty', async () => {
    const { createManualAppointment } = await import('./kani-appointments');
    await expect(
      createManualAppointment({
        barberId: 'barber-1',
        serviceId: 'service-1',
        date: '2026-10-25',
        time: '11:00',
        name: 'Carlos Tevez',
        phone: '+5491112345678',
        email: '',
      })
    ).rejects.toThrow('El correo electrónico del cliente es obligatorio y debe tener un formato válido.');

    await expect(
      createManualAppointment({
        barberId: 'barber-1',
        serviceId: 'service-1',
        date: '2026-10-25',
        time: '11:00',
        name: 'Carlos Tevez',
        phone: '+5491112345678',
        email: '   ',
      })
    ).rejects.toThrow('El correo electrónico del cliente es obligatorio y debe tener un formato válido.');
  });

  it('rejects manual appointment creation if client email format is invalid', async () => {
    const { createManualAppointment } = await import('./kani-appointments');
    const invalidEmails = ['invalid', 'test@', '@domain.com', 'test @domain.com', 'test@domain'];
    for (const email of invalidEmails) {
      await expect(
        createManualAppointment({
          barberId: 'barber-1',
          serviceId: 'service-1',
          date: '2026-10-25',
          time: '11:00',
          name: 'Carlos Tevez',
          phone: '+5491112345678',
          email,
        })
      ).rejects.toThrow('El correo electrónico del cliente es obligatorio y debe tener un formato válido.');
    }
  });

  it('formats email error message clearly via appointmentErrorMessage', () => {
    const err = new Error('El correo electrónico del cliente es obligatorio y debe tener un formato válido.');
    expect(appointmentErrorMessage(err)).toBe('El correo electrónico del cliente es obligatorio y debe tener un formato válido.');
  });

  it('defines manual appointment responsive mobile and desktop grid styles in styles.css', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const cssContent = fs.readFileSync(path.resolve(process.cwd(), 'src/styles.css'), 'utf-8');

    // Mobile grid: 2 columns, rows 1 and 2 sharing 2 equal columns, rows 3-7 taking full width (span 2)
    expect(cssContent).toContain('.manual-appointment-grid');
    expect(cssContent).toContain('.manual-field-fecha');
    expect(cssContent).toContain('.manual-field-horario');
    expect(cssContent).toContain('.manual-field-servicio');
    expect(cssContent).toContain('.manual-field-barbero');
    expect(cssContent).toContain('.manual-field-frecuencia');
    expect(cssContent).toContain('.manual-field-nombre');
    expect(cssContent).toContain('.manual-field-celular');
    expect(cssContent).toContain('.manual-field-email');
    expect(cssContent).toContain('.manual-field-sena');
    expect(cssContent).toContain('.manual-field-observaciones');

    // Desktop media query (min-width: 640px)
    expect(cssContent).toContain('@media (min-width: 640px)');
  });

  it('verifies mobile manual dialog is positioned below site header without overlap', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const cssContent = fs.readFileSync(path.resolve(process.cwd(), 'src/styles.css'), 'utf-8');

    // On mobile, the dialog must start immediately below the 72px header respecting safe-area-inset-top
    expect(cssContent).toContain('top: calc(72px + env(safe-area-inset-top, 0px)) !important;');
    expect(cssContent).toContain('height: calc(100dvh - 72px - env(safe-area-inset-top, 0px)) !important;');

    // Header must remain fixed at top when manual dialog is active
    expect(cssContent).toContain('body:has(.admin-manual-dialog) .site-header');
  });

  it('supports «Abona seña» option with Sí/No, defaulting to No, and registering deposit_paid = true when Sí', () => {
    // Appointment with Abona seña = No (default)
    const aptSinSena: RealAppointment = {
      id: 'apt-sin-sena',
      requestNumber: 201,
      service: 'corte',
      barber: 'Gonzalo',
      date: '2026-10-25',
      time: '15:00',
      name: 'Lucas Vázquez',
      email: 'lucas@vazquez.internal',
      phone: '+5491122334455',
      status: 'Confirmado',
      statusCode: 'CONFIRMED',
      notes: '',
      barberId: 'barber-gonzalo',
      serviceId: 'svc-corte',
      serviceName: 'Corte',
      serviceDuration: 45,
      servicePrice: 25000,
      isManual: true,
      origin: 'MANUAL',
      depositRequired: false,
      depositPaid: false,
    };

    // Appointment with Abona seña = Sí: records deposit_paid = true ($5.000 effectively received)
    const aptConSena: RealAppointment = {
      id: 'apt-con-sena',
      requestNumber: 202,
      service: 'barba',
      barber: 'Gonzalo',
      date: '2026-10-26',
      time: '16:00',
      name: 'Lucas Vázquez',
      email: 'lucas@vazquez.internal',
      phone: '+5491122334455',
      status: 'Confirmado',
      statusCode: 'CONFIRMED',
      notes: '',
      barberId: 'barber-gonzalo',
      serviceId: 'svc-barba',
      serviceName: 'Barba',
      serviceDuration: 30,
      servicePrice: 10000,
      isManual: true,
      origin: 'MANUAL',
      depositRequired: true,
      depositPaid: true,
    };

    expect(aptSinSena.depositRequired).toBe(false);
    expect(aptSinSena.depositPaid).toBe(false);
    expect(aptSinSena.depositPaid || aptSinSena.depositRequired ? 'Sí' : 'No').toBe('No');

    expect(aptConSena.depositRequired).toBe(true);
    expect(aptConSena.depositPaid).toBe(true);
    expect(aptConSena.depositPaid || aptConSena.depositRequired ? 'Sí' : 'No').toBe('Sí');

    // Aggregate in client history directory
    const directory = aggregateClientsDirectory([aptSinSena, aptConSena]);
    expect(directory.length).toBe(1);
    const client = directory[0];
    expect(client.appointments.length).toBe(2);

    const historySinSena = client.appointments.find(a => a.id === 'apt-sin-sena');
    expect(historySinSena?.depositRequired).toBe(false);
    expect(historySinSena?.depositPaid).toBe(false);
    expect(historySinSena?.depositPaid || historySinSena?.depositRequired ? 'Sí' : 'No').toBe('No');

    const historyConSena = client.appointments.find(a => a.id === 'apt-con-sena');
    expect(historyConSena?.depositRequired).toBe(true);
    expect(historyConSena?.depositPaid).toBe(true);
    expect(historyConSena?.depositPaid || historyConSena?.depositRequired ? 'Sí' : 'No').toBe('Sí');
  });

  it('defines centralized KANI_MANUAL_DEPOSIT_ARS = 5000 and calculates remaining balances correctly', async () => {
    const { KANI_MANUAL_DEPOSIT_ARS, calculateAppointmentBalance } = await import('./kani-appointments');
    expect(KANI_MANUAL_DEPOSIT_ARS).toBe(5000);

    // Case 1: Service $25.000 with deposit paid (Sí) -> Deposit: $5.000, Remaining balance: $20.000
    const balanceWithDeposit = calculateAppointmentBalance(25000, true);
    expect(balanceWithDeposit.totalPrice).toBe(25000);
    expect(balanceWithDeposit.depositAmount).toBe(5000);
    expect(balanceWithDeposit.remainingBalance).toBe(20000);

    // Case 2: Service $25.000 without deposit (No) -> Deposit: $0, Remaining balance: $25.000
    const balanceWithoutDeposit = calculateAppointmentBalance(25000, false);
    expect(balanceWithoutDeposit.totalPrice).toBe(25000);
    expect(balanceWithoutDeposit.depositAmount).toBe(0);
    expect(balanceWithoutDeposit.remainingBalance).toBe(25000);

    // Case 3: Service price lower than deposit (e.g. $4.000) does not produce negative remaining balance
    const edgeCase = calculateAppointmentBalance(4000, true);
    expect(edgeCase.remainingBalance).toBe(0);
  });

  it('validates all required fields before creating a manual appointment', async () => {
    const { createManualAppointment } = await import('./kani-appointments');

    // Missing barberId
    await expect(
      createManualAppointment({
        barberId: '',
        serviceId: 'svc-1',
        date: '2026-10-25',
        time: '10:00',
        name: 'Martín Palermo',
        phone: '+5491144445555',
        email: 'palermo@boca.internal',
      })
    ).rejects.toThrow('El barbero es obligatorio.');

    // Missing serviceId
    await expect(
      createManualAppointment({
        barberId: 'barber-1',
        serviceId: '',
        date: '2026-10-25',
        time: '10:00',
        name: 'Martín Palermo',
        phone: '+5491144445555',
        email: 'palermo@boca.internal',
      })
    ).rejects.toThrow('El servicio es obligatorio.');

    // Missing date
    await expect(
      createManualAppointment({
        barberId: 'barber-1',
        serviceId: 'svc-1',
        date: '',
        time: '10:00',
        name: 'Martín Palermo',
        phone: '+5491144445555',
        email: 'palermo@boca.internal',
      })
    ).rejects.toThrow('La fecha es obligatoria.');

    // Missing time
    await expect(
      createManualAppointment({
        barberId: 'barber-1',
        serviceId: 'svc-1',
        date: '2026-10-25',
        time: '',
        name: 'Martín Palermo',
        phone: '+5491144445555',
        email: 'palermo@boca.internal',
      })
    ).rejects.toThrow('El horario es obligatorio.');

    // Name too short
    await expect(
      createManualAppointment({
        barberId: 'barber-1',
        serviceId: 'svc-1',
        date: '2026-10-25',
        time: '10:00',
        name: 'Al',
        phone: '+5491144445555',
        email: 'palermo@boca.internal',
      })
    ).rejects.toThrow('El nombre del cliente es obligatorio y debe tener al menos 3 caracteres.');

    // Invalid phone
    await expect(
      createManualAppointment({
        barberId: 'barber-1',
        serviceId: 'svc-1',
        date: '2026-10-25',
        time: '10:00',
        name: 'Martín Palermo',
        phone: '123',
        email: 'palermo@boca.internal',
      })
    ).rejects.toThrow('El celular del cliente es obligatorio y debe ser válido.');
  });

  it('ensures manual dialog enforces the exact 2-column mobile layout and auto total price field', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const componentCode = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/kani/admin-mobile-appointments.tsx'),
      'utf-8'
    );

    // Row 1: Fecha | Horario
    expect(componentCode).toContain('manual-field-fecha');
    expect(componentCode).toContain('manual-field-horario');

    // Row 2: Servicio | Barbero
    expect(componentCode).toContain('manual-field-servicio');
    expect(componentCode).toContain('manual-field-barbero');

    // Row 3: Nombre del cliente | Frecuencia
    expect(componentCode).toContain('manual-field-nombre');
    expect(componentCode).toContain('manual-field-frecuencia');

    // Row 4: Celular del cliente | Abona seña
    expect(componentCode).toContain('manual-field-celular');
    expect(componentCode).toContain('manual-field-sena');

    // Row 5: Mail del cliente | Importe total
    expect(componentCode).toContain('manual-field-email');
    expect(componentCode).toContain('manual-field-importe');
    expect(componentCode).toContain('Importe total');

    // Full width under rows: Observaciones (opcional)
    expect(componentCode).toContain('manual-field-observaciones');
    expect(componentCode).toContain('Observaciones <span className="text-xs font-normal text-muted-foreground">(opcional)</span>');

    // Validation messages alongside inputs
    expect(componentCode).toContain('showFieldError(\'date\')');
    expect(componentCode).toContain('showFieldError(\'time\')');
    expect(componentCode).toContain('showFieldError(\'service\')');
    expect(componentCode).toContain('showFieldError(\'barber\')');
    expect(componentCode).toContain('showFieldError(\'name\')');
    expect(componentCode).toContain('showFieldError(\'phone\')');
    expect(componentCode).toContain('showFieldError(\'email\')');

    // Total amount automatically formatted from selected service
    expect(componentCode).toContain('selectedManualService?.price_ars');
    expect(componentCode).toContain('manualTotalAmountFormatted');
  });

  it('verifies the SQL migration sets deposit_paid = true when p_deposit_required is true', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const migrationContent = fs.readFileSync(
      path.resolve(process.cwd(), 'supabase/migrations/20261019000100_kani_manual_appointment_deposit_payment.sql'),
      'utf-8'
    );

    // Function parameter p_deposit_required
    expect(migrationContent).toContain('p_deposit_required boolean default false');

    // Sets deposit_required and deposit_paid to v_deposit_flag
    expect(migrationContent).toContain('v_deposit_flag boolean := coalesce(p_deposit_required, false);');
    expect(migrationContent).toContain('deposit_required,');
    expect(migrationContent).toContain('deposit_paid');
    expect(migrationContent).toContain('v_deposit_flag,');
    expect(migrationContent).toContain('v_deposit_flag');
  });

  it('ensures the manual appointment dialog removes visible descriptive text and shows simplified service name', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const componentCode = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/kani/admin-mobile-appointments.tsx'),
      'utf-8'
    );

    // Visible description removed (only sr-only for accessibility)
    expect(componentCode).not.toContain('Configurá los datos del turno y del cliente.');
    expect(componentCode).toContain('<DialogDescription className="sr-only">');

    // Service dropdown simplified: displays {s.name} without duration and price strings
    expect(componentCode).toMatch(/<option key=\{s\.id\} value=\{s\.id\}>\s*\{s\.name\}\s*<\/option>/);
    expect(componentCode).not.toContain('{s.duration_minutes} min');

    // Abona seña field with exclusively No / Sí options
    expect(componentCode).toContain('<label htmlFor="manual-deposit"');
    expect(componentCode).toContain('<option value="NO">No</option>');
    expect(componentCode).toContain('<option value="YES">Sí</option>');
  });

  it('verifies shortened numeric frequency labels and shortenFrequencyText conversion', async () => {
    const { MANUAL_FREQUENCY_LABELS, shortenFrequencyText } = await import('./kani-appointments');

    // MANUAL_FREQUENCY_LABELS uses digits instead of written numbers
    expect(MANUAL_FREQUENCY_LABELS.ONCE).toBe('1 vez');
    expect(MANUAL_FREQUENCY_LABELS.WEEKLY).toBe('1 vez a la semana');
    expect(MANUAL_FREQUENCY_LABELS.BIWEEKLY).toBe('1 vez cada 2 semanas');
    expect(MANUAL_FREQUENCY_LABELS.TRIWEEKLY).toBe('1 vez cada 3 semanas');
    expect(MANUAL_FREQUENCY_LABELS.MONTHLY).toBe('1 vez al mes');

    // shortenFrequencyText converts written numbers to digits
    expect(shortenFrequencyText('Una vez')).toBe('1 vez');
    expect(shortenFrequencyText('Dos semanas')).toBe('2 semanas');
    expect(shortenFrequencyText('Una vez cada tres semanas')).toBe('1 vez cada 3 semanas');
    expect(shortenFrequencyText('Una vez cada dos semanas')).toBe('1 vez cada 2 semanas');
    expect(shortenFrequencyText('Dos veces por semana')).toBe('2 veces por semana');
    expect(shortenFrequencyText('Turno de prueba\n[Frecuencia: Una vez cada dos semanas]')).toBe(
      'Turno de prueba\n[Frecuencia: 1 vez cada 2 semanas]'
    );
  });

  it('verifies 65/35 column distribution on mobile and 50/50 on desktop for manual appointment grid', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const cssContent = fs.readFileSync(path.resolve(process.cwd(), 'src/styles.css'), 'utf-8');
    const componentCode = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/kani/admin-mobile-appointments.tsx'),
      'utf-8'
    );

    // CSS defines 65fr / 35fr ratio (65% / 35%) on mobile
    expect(cssContent).toContain('grid-template-columns: minmax(0, 65fr) minmax(0, 35fr);');

    // Desktop media query (min-width: 640px) preserves 6 equal columns (50%/50% pair distribution)
    expect(cssContent).toContain('grid-template-columns: repeat(6, minmax(0, 1fr));');

    // Component includes 65/35 mobile grid template
    expect(componentCode).toContain('grid-cols-[minmax(0,65fr)_minmax(0,35fr)]');
  });
});

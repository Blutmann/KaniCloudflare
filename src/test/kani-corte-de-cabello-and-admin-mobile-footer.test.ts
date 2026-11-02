import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  services,
  formatServiceName,
  formatServiceNameForEmail,
  formatServiceNameForChannel,
  getEffectiveServicePrice,
  FRANCO_SPECIAL_PRICES,
} from '@/lib/kani-model';
import {
  STANDARD_SERVICE_PRICES,
  filterServicePayments,
  type ServicePayment,
} from '@/lib/kani-payments';
import {
  buildConfirmedEmail,
  buildCancelledEmail,
  buildNewRequestEmail,
} from '@/lib/kani-notifications.functions';

describe('1. Nombre del servicio por canal: "Corte" en web/admin y "Corte de cabello" en correos', () => {
  it('catálogo services contiene "Corte" para web/admin manteniendo id "corte", precio $25.000 y duración 45 min', () => {
    const corte = services.find((s) => s.id === 'corte');
    expect(corte).toBeDefined();
    expect(corte?.name).toBe('Corte');
    expect(corte?.price).toBe(25000);
    expect(corte?.duration).toBe(45);

    // No modifica "Corte y barba" ni "Barba"
    const corteBarba = services.find((s) => s.id === 'corte-barba');
    expect(corteBarba?.name).toBe('Corte y barba');
    expect(corteBarba?.price).toBe(30000);
    expect(corteBarba?.duration).toBe(60);

    const barba = services.find((s) => s.id === 'barba');
    expect(barba?.name).toBe('Barba');
    expect(barba?.price).toBe(15000);
    expect(barba?.duration).toBe(30);
  });

  it('formatServiceName (canal web y panel admin) normaliza "Corte de cabello" y "corte" a "Corte", conservando intactos los demás servicios', () => {
    expect(formatServiceName('Corte')).toBe('Corte');
    expect(formatServiceName('corte')).toBe('Corte');
    expect(formatServiceName(' Corte ')).toBe('Corte');
    expect(formatServiceName('Corte de cabello')).toBe('Corte');
    expect(formatServiceName('corte de cabello')).toBe('Corte');
    expect(formatServiceName('Corte y barba')).toBe('Corte y barba');
    expect(formatServiceName('Corte + barba')).toBe('Corte y barba');
    expect(formatServiceName('Barba')).toBe('Barba');
    expect(formatServiceName('Perfilado')).toBe('Perfilado');
    expect(formatServiceName('')).toBe('');
    expect(formatServiceName(null)).toBe('');
    expect(formatServiceName(undefined)).toBe('');
  });

  it('formatServiceNameForEmail (canal correos) mantiene "Corte de cabello" tanto para reservas nuevas ("Corte") como históricas ("Corte de cabello")', () => {
    expect(formatServiceNameForEmail('Corte')).toBe('Corte de cabello');
    expect(formatServiceNameForEmail('corte')).toBe('Corte de cabello');
    expect(formatServiceNameForEmail(' Corte ')).toBe('Corte de cabello');
    expect(formatServiceNameForEmail('Corte de cabello')).toBe('Corte de cabello');
    expect(formatServiceNameForEmail('corte de cabello')).toBe('Corte de cabello');
    expect(formatServiceNameForEmail('Corte y barba')).toBe('Corte y barba');
    expect(formatServiceNameForEmail('Corte + barba')).toBe('Corte y barba');
    expect(formatServiceNameForEmail('Barba')).toBe('Barba');
    expect(formatServiceNameForEmail('')).toBe('');
  });

  it('formatServiceNameForChannel preserva nombres de canal en WhatsApp y Calendar', () => {
    expect(formatServiceNameForChannel('corte', 'whatsapp')).toBe('Corte de cabello');
    expect(formatServiceNameForChannel('Corte', 'whatsapp')).toBe('Corte de cabello');
    expect(formatServiceNameForChannel('Corte y barba', 'whatsapp')).toBe('Corte y barba');

    expect(formatServiceNameForChannel('corte', 'calendar')).toBe('Corte de cabello');
    expect(formatServiceNameForChannel('Corte', 'calendar')).toBe('Corte de cabello');
    expect(formatServiceNameForChannel('Corte y barba', 'calendar')).toBe('Corte y barba');
  });

  it('getEffectiveServicePrice resuelve precios estándar y promocionales de Franco para "Corte de cabello" y "Corte"', () => {
    expect(getEffectiveServicePrice('corte', 'Lautaro')).toBe(25000);
    expect(getEffectiveServicePrice('Corte', 'Lautaro')).toBe(25000);
    expect(getEffectiveServicePrice('Corte de cabello', 'Lautaro')).toBe(25000);
    expect(getEffectiveServicePrice('Corte de cabello', 'Franco')).toBe(15000);
    expect(getEffectiveServicePrice('Corte', 'Franco')).toBe(15000);
    expect(getEffectiveServicePrice('corte', 'Franco')).toBe(15000);

    // Corte y barba no se modifica
    expect(getEffectiveServicePrice('corte-barba', 'Franco')).toBe(20000);
    expect(getEffectiveServicePrice('Corte y barba', 'Franco')).toBe(20000);
    expect(getEffectiveServicePrice('corte-barba', 'Lautaro')).toBe(30000);
  });

  it('STANDARD_SERVICE_PRICES incluye "Corte" y "Corte de cabello" con valor 25000', () => {
    expect(STANDARD_SERVICE_PRICES['Corte']).toBe(25000);
    expect(STANDARD_SERVICE_PRICES['Corte de cabello']).toBe(25000);
    expect(STANDARD_SERVICE_PRICES['Corte y barba']).toBe(30000);
    expect(STANDARD_SERVICE_PRICES['Barba']).toBe(15000);
  });

  it('filterServicePayments filtra correctamente por "Corte" y tolera cobros históricos con "Corte de cabello"', () => {
    const mockPayments: ServicePayment[] = [
      {
        id: 'p1',
        barberId: 'b1',
        barberName: 'Lautaro',
        serviceId: 's1',
        serviceName: 'Corte',
        serviceOtherDetail: null,
        servicePriceArs: 25000,
        discountArs: 0,
        finalAmountArs: 25000,
        paymentDate: '2026-11-02',
        paymentTime: '16:00',
        paymentMethod: 'Efectivo',
        onlineDepositPaid: false,
        onlineDepositAmountArs: 0,
        collectedAmountArs: 25000,
        clientName: 'Juan',
        clientContact: null,
        appointmentId: null,
        serviceOrigin: 'walk_in',
        createdByUserId: null,
      },
      {
        id: 'p2',
        barberId: 'b1',
        barberName: 'Lautaro',
        serviceId: 's1',
        serviceName: 'Corte de cabello' as any,
        serviceOtherDetail: null,
        servicePriceArs: 25000,
        discountArs: 0,
        finalAmountArs: 25000,
        paymentDate: '2026-11-02',
        paymentTime: '17:00',
        paymentMethod: 'Efectivo',
        onlineDepositPaid: false,
        onlineDepositAmountArs: 0,
        collectedAmountArs: 25000,
        clientName: 'Pedro',
        clientContact: null,
        appointmentId: null,
        serviceOrigin: 'walk_in',
        createdByUserId: null,
      },
      {
        id: 'p3',
        barberId: 'b1',
        barberName: 'Lautaro',
        serviceId: 's2',
        serviceName: 'Corte y barba',
        serviceOtherDetail: null,
        servicePriceArs: 30000,
        discountArs: 0,
        finalAmountArs: 30000,
        paymentDate: '2026-11-02',
        paymentTime: '18:00',
        paymentMethod: 'Efectivo',
        onlineDepositPaid: false,
        onlineDepositAmountArs: 0,
        collectedAmountArs: 30000,
        clientName: 'Carlos',
        clientContact: null,
        appointmentId: null,
        serviceOrigin: 'walk_in',
        createdByUserId: null,
      },
    ];

    const filtered = filterServicePayments(mockPayments, {
      serviceFilter: 'Corte',
      permittedBarberIds: new Set(['b1']),
      role: 'ADMIN',
    });
    expect(filtered.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('plantillas de correo de confirmación, cancelación y nueva solicitud muestran "Corte de cabello" en HTML y texto plano (para reservas nuevas "Corte" e históricas)', () => {
    // 1. Correo de confirmación con nueva reserva 'Corte'
    const confirmed = buildConfirmedEmail({
      notificationId: 'notif-1',
      notificationType: 'CONFIRMED',
      recipientEmail: 'cliente@test.com',
      clientName: 'Martín Gómez',
      barberName: 'Franco',
      serviceName: 'Corte', // Nueva reserva con "Corte"
      bookingDate: '2026-11-05',
      startTime: '16:00:00',
      servicePriceArs: 15000,
      downPaymentArs: 5000,
    });
    expect(confirmed.html).toContain('Corte de cabello');
    expect(confirmed.html).not.toMatch(/>\s*Corte\s*</);
    expect(confirmed.text).toContain('Servicio: Corte de cabello');
    expect(confirmed.text).toContain('para un servicio de Corte de cabello con Franco');

    // 1b. Correo de confirmación con reserva histórica 'Corte de cabello'
    const confirmedHist = buildConfirmedEmail({
      notificationId: 'notif-1b',
      notificationType: 'CONFIRMED',
      recipientEmail: 'cliente@test.com',
      clientName: 'Martín Gómez',
      barberName: 'Lautaro',
      serviceName: 'Corte de cabello', // Histórica con "Corte de cabello"
      bookingDate: '2026-11-05',
      startTime: '16:00:00',
      servicePriceArs: 25000,
      downPaymentArs: 5000,
    });
    expect(confirmedHist.html).toContain('Corte de cabello');
    expect(confirmedHist.text).toContain('Servicio: Corte de cabello');

    // 2. Correo de cancelación con nueva reserva 'Corte'
    const cancelled = buildCancelledEmail({
      notificationId: 'notif-2',
      notificationType: 'CANCELLED',
      recipientEmail: 'cliente@test.com',
      clientName: 'Martín Gómez',
      barberName: 'Lautaro',
      serviceName: 'Corte', // Nueva reserva 'Corte'
      bookingDate: '2026-11-05',
      startTime: '16:00:00',
      downPaymentArs: 5000,
    });
    expect(cancelled.html).toContain('Corte de cabello');
    expect(cancelled.text).toContain('Servicio: Corte de cabello');

    // 2b. Correo de cancelación con reserva histórica 'Corte de cabello'
    const cancelledHist = buildCancelledEmail({
      notificationId: 'notif-2b',
      notificationType: 'CANCELLED',
      recipientEmail: 'cliente@test.com',
      clientName: 'Martín Gómez',
      barberName: 'Lautaro',
      serviceName: 'Corte de cabello', // Histórico
      bookingDate: '2026-11-05',
      startTime: '16:00:00',
      downPaymentArs: 5000,
    });
    expect(cancelledHist.html).toContain('Corte de cabello');
    expect(cancelledHist.text).toContain('Servicio: Corte de cabello');

    // 3. Correo de solicitud con transferencia
    const newReq = buildNewRequestEmail(
      {
        notificationId: 'notif-3',
        notificationType: 'NEW_REQUEST',
        recipientEmail: 'cliente@test.com',
        clientName: 'Martín Gómez',
        barberName: 'Lautaro',
        serviceName: 'Corte',
        servicePriceArs: 25000,
        serviceDurationMinutes: 45,
        downPaymentArs: 5000,
        transferAlias: 'KANI.ESTUDIO',
        transferCuit: '20-12345678-9',
        transferHolderName: 'Kani Studio',
      },
      'jueves 5 de noviembre de 2026',
      '16:00 hs'
    );
    expect(newReq.html).toContain('Corte de cabello');
    expect(newReq.text).toContain('Servicio: Corte de cabello · 45 min');
  });
});

describe('2. Footer administrativo en móvil', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const stylesCss = fs.readFileSync(stylesPath, 'utf-8');

  it('define selector acotado a pantallas internas del panel administrativo en móvil', () => {
    expect(stylesCss).toContain(
      ":is(\n    .site-shell:has(.v2-shell),\n    .site-shell:has(.v2-page),\n    body[data-admin-internal='true'] .site-shell\n  ) .site-footer"
    );
  });

  it('oculta dirección y horarios (.site-footer-study) en pantallas internas del admin en móvil', () => {
    expect(stylesCss).toContain('.site-footer-study {\n    display: none !important;\n  }');
  });

  it('oculta enlaces (.site-footer-link-row) en pantallas internas del admin en móvil', () => {
    expect(stylesCss).toContain('.site-footer-link-row {\n    display: none !important;\n  }');
  });

  it('muestra únicamente el copyright "© 2026 Kani Barber Studio" sin espacios vacíos ni márgenes sobrantes', () => {
    expect(stylesCss).toContain('.site-footer-copyright {\n    display: block !important;');
    expect(stylesCss).toContain('font-size: 11px !important;');
    expect(stylesCss).toContain('padding-block: 14px !important;');
    expect(stylesCss).toContain('gap: 0 !important;');
  });

  it('conserva el inicio de sesión administrativo móvil completamente sin footer', () => {
    expect(stylesCss).toContain(
      "body[data-admin-login='true'] .site-footer {\n    display: none !important;\n  }"
    );
  });

  it('conserva el footer público completo en móvil', () => {
    // La regla general de móvil incluye .site-footer-study y .site-footer-link-row con display flex / grid
    expect(stylesCss).toContain('.site-footer-study {');
    expect(stylesCss).toContain('.site-footer-link-row {');
  });

  it('conserva el footer de escritorio completo con dirección, horarios y enlaces', () => {
    // El ajuste de footer reducido para el admin está estrictamente dentro de @media (max-width: 767px)
    const mobileIndex = stylesCss.indexOf('@media (max-width: 767px)');
    const adminFooterIndex = stylesCss.indexOf('Pantallas internas del panel administrativo en móvil:');
    expect(adminFooterIndex).toBeGreaterThan(mobileIndex);
  });
});

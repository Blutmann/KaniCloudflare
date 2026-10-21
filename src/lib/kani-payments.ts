import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import type { AuthenticatedStaff } from '@/lib/kani-auth';
import type { RealAppointment } from '@/lib/kani-appointments';
import { businessDateToday, BUSINESS_TIME_ZONE } from '@/lib/kani-mobile-appointments';
import { services as defaultCatalogServices, minutes, money } from '@/lib/kani-model';

export type PaymentMethod = 'Efectivo' | 'Transferencia';
export type ServicePaymentType = 'Corte' | 'Corte y barba' | 'Barba' | 'Otros';

export type ServicePayment = {
  id: string;
  barberId: string;
  barberName: string;
  serviceId: string | null;
  serviceName: ServicePaymentType;
  serviceOtherDetail: string | null;
  servicePriceArs: number;
  discountArs: number;
  finalAmountArs: number;
  paymentDate: string; // YYYY-MM-DD
  paymentTime: string; // HH:mm
  paymentMethod: PaymentMethod;
  onlineDepositPaid: boolean;
  onlineDepositAmountArs: number;
  collectedAmountArs: number;
  clientName: string | null;
  clientContact: string | null;
  appointmentId: string | null;
  appointmentRequestNumber?: number | null;
  createdByUserId: string | null;
  createdByDisplayName: string;
  createdAt: string;
  updatedAt?: string;
};

export type RecordServicePaymentInput = {
  barberId: string;
  serviceName: ServicePaymentType;
  serviceOtherDetail?: string;
  servicePriceArs: number;
  discountArs?: number;
  paymentDate?: string;
  paymentTime?: string;
  paymentMethod: PaymentMethod;
  onlineDepositPaid?: boolean;
  clientName?: string;
  clientContact?: string;
  appointmentId?: string;
};

export type ServicePaymentFilters = {
  date?: string; // YYYY-MM-DD or empty for all
  startDate?: string;
  endDate?: string;
  barberId?: string; // 'ALL' or specific barber id
  serviceName?: 'ALL' | ServicePaymentType;
  otherDetail?: string;
};

export type CandidateAppointmentMatch = {
  appointment: RealAppointment;
  score: number;
  matchReasons: string[];
};

export const STANDARD_SERVICE_PRICES: Record<Exclude<ServicePaymentType, 'Otros'>, number> = {
  Corte: 25000,
  'Corte y barba': 30000,
  Barba: 15000,
};

/** Obtiene la hora actual en la zona horaria oficial del estudio (HH:mm) */
export function businessTimeNow(now = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return formatter.format(now);
}

/** Normaliza cadenas para comparación aproximada (sin tildes, minúsculas, espacios colapsados) */
export function normalizeClientString(str: string): string {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Comprueba coincidencias de nombre tolerando diferencias menores */
export function clientNamesMatch(query: string, candidate: string): { match: boolean; score: number; reason: string } {
  const q = normalizeClientString(query);
  const c = normalizeClientString(candidate);
  if (!q || !c) return { match: false, score: 0, reason: '' };
  if (q === c) return { match: true, score: 60, reason: 'Nombre idéntico' };
  if (c.includes(q) || q.includes(c)) return { match: true, score: 45, reason: 'Coincidencia de nombre' };

  const qTokens = q.split(' ').filter((t) => t.length >= 2);
  const cTokens = c.split(' ').filter((t) => t.length >= 2);
  const common = qTokens.filter((t) =>
    cTokens.some((ct) => ct === t || (t.length >= 3 && (ct.startsWith(t) || t.startsWith(ct)))),
  );

  if (common.length > 0) {
    return { match: true, score: 35, reason: 'Coincidencia aproximada' };
  }
  return { match: false, score: 0, reason: '' };
}

/** Valida los campos del formulario de registro de pago */
export function validatePaymentInput(
  input: RecordServicePaymentInput,
  options?: { appointment?: RealAppointment | null },
): { valid: boolean; error?: string } {
  if (!input.barberId) {
    return { valid: false, error: 'El barbero es obligatorio.' };
  }
  if (!input.serviceName) {
    return { valid: false, error: 'El servicio es obligatorio.' };
  }

  if (input.serviceName === 'Otros') {
    if (!input.serviceOtherDetail || input.serviceOtherDetail.trim().length === 0) {
      return { valid: false, error: 'El detalle del servicio es obligatorio para la opción «Otros».' };
    }
    if (typeof input.servicePriceArs !== 'number' || isNaN(input.servicePriceArs) || input.servicePriceArs <= 0) {
      return { valid: false, error: 'El importe del servicio debe ser un número mayor a cero.' };
    }
  } else {
    if (typeof input.servicePriceArs !== 'number' || isNaN(input.servicePriceArs) || input.servicePriceArs <= 0) {
      return { valid: false, error: 'El importe del servicio no es válido.' };
    }
  }

  const discount = input.discountArs ?? 0;
  if (typeof discount !== 'number' || isNaN(discount) || discount < 0) {
    return { valid: false, error: 'El descuento no puede ser un importe negativo.' };
  }
  if (discount > input.servicePriceArs) {
    return { valid: false, error: 'El descuento no puede ser superior al importe del servicio.' };
  }

  if (input.onlineDepositPaid) {
    if (!input.appointmentId || !options?.appointment) {
      return {
        valid: false,
        error: 'No podés marcar seña abonada online sin vincular un turno con pago validado.',
      };
    }
    if (!options.appointment.depositPaid) {
      return {
        valid: false,
        error: 'El turno seleccionado no registra una seña abonada online en el sistema.',
      };
    }
  }

  if (!input.paymentMethod || !['Efectivo', 'Transferencia'].includes(input.paymentMethod)) {
    return { valid: false, error: 'Seleccioná un método de pago válido (Efectivo o Transferencia).' };
  }

  return { valid: true };
}

/** Busca turnos candidatos para vincular */
export function findCandidateAppointments(
  query: {
    date?: string;
    time?: string;
    clientName?: string;
    barberId?: string;
  },
  appointments: RealAppointment[],
  alreadyPaidAppointmentIds: Set<string> = new Set(),
): CandidateAppointmentMatch[] {
  const matches: CandidateAppointmentMatch[] = [];

  for (const apt of appointments) {
    // Excluir cancelados o ya pagados
    if (apt.statusCode === 'CANCELLED' || alreadyPaidAppointmentIds.has(apt.id)) {
      continue;
    }

    // Si se especifica barberId, respetar alcance
    if (query.barberId && apt.barberId !== query.barberId) {
      continue;
    }

    let score = 0;
    const reasons: string[] = [];

    // 1. Misma fecha
    if (query.date && apt.date === query.date) {
      score += 40;
      reasons.push('Misma fecha');
    }

    // 2. Mismo horario o horario cercano
    if (query.time && apt.time) {
      if (apt.time === query.time) {
        score += 40;
        reasons.push('Mismo horario');
      } else {
        const diff = Math.abs(minutes(apt.time) - minutes(query.time));
        if (diff <= 30) {
          score += 20;
          reasons.push('Horario cercano');
        }
      }
    }

    // 3. Coincidencia aproximada de nombre
    if (query.clientName && query.clientName.trim()) {
      const nameCheck = clientNamesMatch(query.clientName, apt.name);
      if (nameCheck.match) {
        score += nameCheck.score;
        reasons.push(nameCheck.reason);
      }
    }

    if (score >= 40) {
      matches.push({
        appointment: apt,
        score,
        matchReasons: reasons,
      });
    }
  }

  // Ordenar por relevancia descendente
  return matches.sort((a, b) => b.score - a.score);
}

/** Carga los registros de pagos desde Supabase con filtros a nivel persistido */
export async function fetchServicePayments(
  filters: ServicePaymentFilters,
  staff: AuthenticatedStaff,
): Promise<ServicePayment[]> {
  let query = supabase
    .from('service_payments')
    .select('*')
    .order('payment_date', { ascending: false })
    .order('payment_time', { ascending: false })
    .order('created_at', { ascending: false });

  // Filtro por barbero: los barberos solo leen sus registros; ADMIN puede filtrar o ver todos
  if (staff.profile.role === 'BARBER') {
    if (staff.profile.barber_id) {
      query = query.eq('barber_id', staff.profile.barber_id);
    }
  } else if (filters.barberId && filters.barberId !== 'ALL') {
    query = query.eq('barber_id', filters.barberId);
  }

  // Filtro por fecha persistida o rango de fechas
  if (filters.date) {
    query = query.eq('payment_date', filters.date);
  } else if (filters.startDate && filters.endDate) {
    if (filters.startDate === filters.endDate) {
      query = query.eq('payment_date', filters.startDate);
    } else {
      query = query.gte('payment_date', filters.startDate).lte('payment_date', filters.endDate);
    }
  } else if (filters.startDate) {
    query = query.gte('payment_date', filters.startDate);
  } else if (filters.endDate) {
    query = query.lte('payment_date', filters.endDate);
  } 

  // Filtro por servicio persistido
  if (filters.serviceName && filters.serviceName !== 'ALL') {
    if (filters.serviceName === 'Corte y barba') {
      query = query.in('service_name', ['Corte y barba', 'Corte + barba']);
    } else {
      query = query.eq('service_name', filters.serviceName);
    }

    // Si es Otros y se ingresó un detalle
    if (filters.serviceName === 'Otros' && filters.otherDetail?.trim()) {
      query = query.ilike('service_other_detail', `%${filters.otherDetail.trim()}%`);
    }
  }

  const { data, error } = await query;

  if (error) {
    console.error('[KANI payments] Error al leer service_payments de la base de datos:', error);
    throw error;
  }

  // Mapear filas agregando nombre del barbero
  const barberMap = new Map(staff.barbers.map((b) => [b.id, b.name]));

  return (data || []).map((row: any) => ({
    id: row.id,
    barberId: row.barber_id,
    barberName: barberMap.get(row.barber_id) || 'Barbero',
    serviceId: row.service_id,
    serviceName: row.service_name === 'Corte + barba' ? 'Corte y barba' : (row.service_name as ServicePaymentType),
    serviceOtherDetail: row.service_other_detail,
    servicePriceArs: row.service_price_ars,
    discountArs: row.discount_ars,
    finalAmountArs: row.final_amount_ars,
    paymentDate: row.payment_date,
    paymentTime: (row.payment_time || '').slice(0, 5),
    paymentMethod: row.payment_method as PaymentMethod,
    onlineDepositPaid: row.online_deposit_paid,
    onlineDepositAmountArs: row.online_deposit_amount_ars,
    collectedAmountArs: row.collected_amount_ars,
    clientName: row.client_name,
    clientContact: row.client_contact,
    appointmentId: row.appointment_id,
    createdByUserId: row.created_by_user_id,
    createdByDisplayName: row.created_by_display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/** Registra un nuevo servicio y cobro garantizando persistencia real en base de datos y permisos */
export async function recordServicePayment(
  input: RecordServicePaymentInput,
  staff: AuthenticatedStaff,
  appointment?: RealAppointment | null,
): Promise<ServicePayment> {
  const validation = validatePaymentInput(input, { appointment });
  if (!validation.valid) {
    throw new Error(validation.error || 'Datos de pago inválidos.');
  }

  // Seguridad de asignación de barbero
  if (staff.profile.role === 'BARBER') {
    if (input.barberId !== staff.profile.barber_id) {
      throw new Error('No tenés permisos para registrar cobros para otro barbero.');
    }
  }

  const barber = staff.barbers.find((b) => b.id === input.barberId);
  const barberName = barber ? barber.name : (staff.profile.role === 'ADMIN' ? 'Barbero' : staff.profile.display_name);

  const paymentDate = input.paymentDate || businessDateToday();
  const paymentTime = input.paymentTime || businessTimeNow();
  const formattedTime = paymentTime.length === 5 ? `${paymentTime}:00` : paymentTime;
  const discountArs = input.discountArs || 0;
  const finalAmountArs = input.servicePriceArs - discountArs;

  let onlineDepositPaid = false;
  let onlineDepositAmountArs = 0;
  if (input.appointmentId && appointment) {
    if (appointment.depositPaid) {
      onlineDepositPaid = true;
      onlineDepositAmountArs = appointment.depositAmountArs || 5000;
    }
  }

  const collectedAmountArs = Math.max(0, finalAmountArs - (onlineDepositPaid ? onlineDepositAmountArs : 0));

  let persistedRecord: ServicePayment | null = null;
  let rpcFailed = false;
  let rpcError: any = null;

  // 1. Intentar registrar vía RPC transaccional segura si está disponible
  try {
    const { data, error } = await (supabase.rpc as any)('record_service_payment', {
      p_barber_id: input.barberId,
      p_service_name: input.serviceName === 'Corte y barba' ? 'Corte y barba' : input.serviceName,
      p_service_other_detail: input.serviceName === 'Otros' ? input.serviceOtherDetail?.trim() || null : null,
      p_service_price_ars: input.servicePriceArs,
      p_discount_ars: discountArs,
      p_payment_date: paymentDate,
      p_payment_time: formattedTime,
      p_payment_method: input.paymentMethod,
      p_online_deposit_paid: onlineDepositPaid,
      p_client_name: input.clientName?.trim() || null,
      p_client_contact: input.clientContact?.trim() || null,
      p_appointment_id: input.appointmentId ? input.appointmentId : null,
    });

    if (!error && data) {
      const row = Array.isArray(data) ? data[0] : data;
      persistedRecord = {
        id: row?.payment_id || row?.id || crypto.randomUUID(),
        barberId: input.barberId,
        barberName,
        serviceId: null,
        serviceName: input.serviceName,
        serviceOtherDetail: input.serviceName === 'Otros' ? input.serviceOtherDetail || null : null,
        servicePriceArs: input.servicePriceArs,
        discountArs,
        finalAmountArs,
        paymentDate,
        paymentTime: (paymentTime || '').slice(0, 5),
        paymentMethod: input.paymentMethod,
        onlineDepositPaid,
        onlineDepositAmountArs,
        collectedAmountArs,
        clientName: input.clientName || null,
        clientContact: input.clientContact || null,
        appointmentId: input.appointmentId || null,
        appointmentRequestNumber: appointment?.requestNumber,
        createdByUserId: staff.user.id,
        createdByDisplayName: staff.profile.display_name,
        createdAt: new Date().toISOString(),
      };
    } else {
      rpcFailed = true;
      rpcError = error;
    }
  } catch (err) {
    rpcFailed = true;
    rpcError = err;
  }

  // 2. Persistencia directa en tabla service_payments (si la RPC falló o no está en caché de esquema)
  if (rpcFailed || !persistedRecord) {
    let resolvedServiceId: string | null = null;
    if (input.serviceName !== 'Otros') {
      try {
        const { data: srvData } = await supabase
          .from('services')
          .select('id')
          .in('name', [input.serviceName, 'Corte y barba', 'Corte + barba'])
          .limit(1)
          .maybeSingle();
        if (srvData?.id) resolvedServiceId = srvData.id;
      } catch {}
    }

    const insertPayload: any = {
      barber_id: input.barberId,
      service_id: resolvedServiceId,
      service_name: input.serviceName === 'Corte y barba' ? 'Corte y barba' : input.serviceName,
      service_other_detail: input.serviceName === 'Otros' ? (input.serviceOtherDetail?.trim() || null) : null,
      service_price_ars: input.servicePriceArs,
      discount_ars: discountArs,
      final_amount_ars: finalAmountArs,
      payment_date: paymentDate,
      payment_time: formattedTime,
      payment_method: input.paymentMethod,
      online_deposit_paid: onlineDepositPaid,
      online_deposit_amount_ars: onlineDepositAmountArs,
      collected_amount_ars: collectedAmountArs,
      client_name: input.clientName?.trim() || null,
      client_contact: input.clientContact?.trim() || null,
      appointment_id: input.appointmentId ? input.appointmentId : null,
      created_by_user_id: staff.user.id,
      created_by_display_name: staff.profile.display_name,
    };

    const { data: insertedRow, error: insertError } = await supabase
      .from('service_payments')
      .insert(insertPayload)
      .select()
      .single();

    if (insertError) {
      console.error('[KANI payments] Error al persistir cobro en base de datos:', insertError);
      throw new Error(
        insertError.message || rpcError?.message || 'No se pudo guardar el registro de cobro en la base de datos.'
      );
    }

    // Si hay un turno vinculado, actualizar su estado en appointments
    if (input.appointmentId) {
      try {
        await supabase
          .from('appointments')
          .update({
            balance_paid: true,
            status: (appointment?.statusCode === 'CONFIRMED' || appointment?.statusCode === 'PENDING') ? 'COMPLETED' : appointment?.statusCode,
            updated_at: new Date().toISOString(),
          })
          .eq('id', input.appointmentId);
      } catch (e) {
        console.warn('[KANI payments] No se pudo actualizar balance_paid en appointments:', e);
      }
    }

    persistedRecord = {
      id: insertedRow.id,
      barberId: insertedRow.barber_id,
      barberName,
      serviceId: insertedRow.service_id,
      serviceName: insertedRow.service_name === 'Corte + barba' ? 'Corte y barba' : (insertedRow.service_name as ServicePaymentType),
      serviceOtherDetail: insertedRow.service_other_detail,
      servicePriceArs: insertedRow.service_price_ars,
      discountArs: insertedRow.discount_ars,
      finalAmountArs: insertedRow.final_amount_ars,
      paymentDate: insertedRow.payment_date,
      paymentTime: (insertedRow.payment_time || '').slice(0, 5),
      paymentMethod: insertedRow.payment_method as PaymentMethod,
      onlineDepositPaid: insertedRow.online_deposit_paid,
      onlineDepositAmountArs: insertedRow.online_deposit_amount_ars,
      collectedAmountArs: insertedRow.collected_amount_ars,
      clientName: insertedRow.client_name,
      clientContact: insertedRow.client_contact,
      appointmentId: insertedRow.appointment_id,
      appointmentRequestNumber: appointment?.requestNumber,
      createdByUserId: insertedRow.created_by_user_id,
      createdByDisplayName: insertedRow.created_by_display_name,
      createdAt: insertedRow.created_at,
      updatedAt: insertedRow.updated_at,
    };
  }

  return persistedRecord;
}

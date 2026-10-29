import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import type { AuthenticatedStaff } from '@/lib/kani-auth';
import type { RealAppointment } from '@/lib/kani-appointments';
import { businessDateToday, addCalendarDays, startOfBusinessWeek, BUSINESS_TIME_ZONE } from '@/lib/kani-mobile-appointments';
import { services as defaultCatalogServices, minutes, money } from '@/lib/kani-model';

export type PaymentMethod =
  | 'Efectivo'
  | 'Transferencia'
  | 'Tarjeta — Payway'
  | 'Tarjeta de crédito'
  | 'Tarjeta de débito'
  | 'Payway'
  | 'Mercado Pago';
export type ServicePaymentType = 'Corte' | 'Corte y barba' | 'Barba' | 'Otros';
export type ServicePaymentOrigin = 'appointment' | 'walk_in' | 'legacy' | 'online_deposit';

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
  serviceOrigin: ServicePaymentOrigin;
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
  serviceOrigin?: ServicePaymentOrigin;
};

export type UpdateServicePaymentInput = {
  barberId?: string;
  serviceName: ServicePaymentType;
  serviceOtherDetail?: string;
  servicePriceArs: number;
  discountArs?: number;
  paymentDate?: string;
  paymentTime?: string;
  paymentMethod: PaymentMethod;
  clientName?: string;
  clientContact?: string;
  appointmentId?: string | null;
  serviceOrigin?: ServicePaymentOrigin;
};

export type ServicePaymentFilters = {
  date?: string | undefined; // YYYY-MM-DD or empty for all
  startDate?: string | undefined;
  endDate?: string | undefined;
  barberId?: string | undefined; // 'ALL' or specific barber id
  serviceName?: ('ALL' | ServicePaymentType) | undefined;
  otherDetail?: string | undefined;
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


export type PaymentPeriodPreset =
  | 'TODAY'
  | 'YESTERDAY'
  | 'THIS_WEEK'
  | 'THIS_MONTH'
  | 'THIS_YEAR'
  | 'LAST_7_DAYS'
  | 'LAST_14_DAYS'
  | 'LAST_30_DAYS'
  | 'PREVIOUS_MONTH'
  | 'PREVIOUS_YEAR'
  | 'CUSTOM';

export type PaymentPeriodFilter = PaymentPeriodPreset;

export const MONTHS_SPANISH = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

export function timestampToBusinessDateTime(isoString: string): { date: string; time: string } {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) {
      const today = businessDateToday();
      return { date: today, time: '12:00' };
    }
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(d);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return {
      date: `${map.year}-${map.month}-${map.day}`,
      time: `${map.hour}:${map.minute}`,
    };
  } catch {
    const today = businessDateToday();
    return { date: today, time: '12:00' };
  }
}

export function getPaymentPeriodDynamicLabels(today: string): Record<string, string> {
  const [yStr, mStr] = today.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;

  return {
    TODAY: 'Hoy',
    YESTERDAY: 'Ayer',
    THIS_WEEK: 'Esta semana',
    THIS_MONTH: `${MONTHS_SPANISH[m - 1]} ${y}`,
    THIS_YEAR: String(y),
    LAST_7_DAYS: 'Últimos 7 días',
    LAST_14_DAYS: 'Últimos 14 días',
    LAST_30_DAYS: 'Últimos 30 días',
    PREVIOUS_MONTH: `${MONTHS_SPANISH[prevM - 1]} ${prevY}`,
    PREVIOUS_YEAR: String(y - 1),
    CUSTOM: 'Fecha específica',
  };
}

export function calculatePaymentPeriodRange(
  preset: PaymentPeriodFilter,
  today: string,
  customStart?: string,
  customEnd?: string,
): { start: string; end: string; label: string; isInvalid?: boolean } {
  const [yStr, mStr] = today.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const labels = getPaymentPeriodDynamicLabels(today);

  switch (preset) {
    case 'TODAY':
      return { start: today, end: today, label: labels.TODAY };
    case 'YESTERDAY': {
      const yest = addCalendarDays(today, -1);
      return { start: yest, end: yest, label: labels.YESTERDAY };
    }
    case 'THIS_WEEK': {
      const ws = startOfBusinessWeek(today);
      return { start: ws, end: addCalendarDays(ws, 6), label: labels.THIS_WEEK };
    }
    case 'THIS_MONTH': {
      const start = `${y}-${String(m).padStart(2, '0')}-01`;
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return { start, end, label: labels.THIS_MONTH };
    }
    case 'THIS_YEAR':
      return { start: `${y}-01-01`, end: `${y}-12-31`, label: labels.THIS_YEAR };
    case 'LAST_7_DAYS':
      return { start: addCalendarDays(today, -6), end: today, label: labels.LAST_7_DAYS };
    case 'LAST_14_DAYS':
      return { start: addCalendarDays(today, -13), end: today, label: labels.LAST_14_DAYS };
    case 'LAST_30_DAYS':
      return { start: addCalendarDays(today, -29), end: today, label: labels.LAST_30_DAYS };
    case 'PREVIOUS_MONTH': {
      const prevM = m === 1 ? 12 : m - 1;
      const prevY = m === 1 ? y - 1 : y;
      const start = `${prevY}-${String(prevM).padStart(2, '0')}-01`;
      const lastDay = new Date(Date.UTC(prevY, prevM, 0)).getUTCDate();
      const end = `${prevY}-${String(prevM).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return { start, end, label: labels.PREVIOUS_MONTH };
    }
    case 'PREVIOUS_YEAR': {
      const prevY = y - 1;
      return { start: `${prevY}-01-01`, end: `${prevY}-12-31`, label: labels.PREVIOUS_YEAR };
    }
    case 'CUSTOM': {
      const start = customStart || today;
      const end = customEnd || today;
      const isInvalid = start > end;
      return { start, end, label: labels.CUSTOM, isInvalid };
    }
  }
}

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

  // Validación de origen del servicio (Con turno / Sin turno)
  if (input.serviceOrigin === 'appointment' && !input.appointmentId) {
    return { valid: false, error: 'Debés seleccionar un turno para registrar un servicio con turno.' };
  }
  if (input.serviceOrigin === 'walk_in') {
    if (input.appointmentId) {
      return { valid: false, error: 'Un servicio sin turno no puede tener un turno asociado.' };
    }
    if (input.onlineDepositPaid) {
      return { valid: false, error: 'Un servicio sin turno no puede incluir seña abonada online.' };
    }
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
    .is('deleted_at', null)
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

  const inShopPayments: ServicePayment[] = (data || []).map((row: any) => ({
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
    serviceOrigin: (row.service_origin as ServicePaymentOrigin) || (row.appointment_id ? 'appointment' : 'walk_in'),
    createdByUserId: row.created_by_user_id,
    createdByDisplayName: row.created_by_display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  // Consultar señas online (Payway / Mercado Pago) autorizadas
  let onlineDeposits: ServicePayment[] = [];
  try {
    if (typeof window !== 'undefined' && typeof (globalThis as any).vi === 'undefined' && Boolean(window.location?.origin) && typeof window.fetch === 'function') {
      try {
        const params = new URLSearchParams();
        if (filters.barberId) params.set('barberId', filters.barberId);
        if (filters.date) params.set('date', filters.date);
        if (filters.startDate) params.set('startDate', filters.startDate);
        if (filters.endDate) params.set('endDate', filters.endDate);
        if (filters.serviceName) params.set('serviceName', filters.serviceName);

        const res = await fetch(`${window.location.origin}/api/admin/online-deposits?${params.toString()}`);
        if (res.ok) {
          const serverDeposits = await res.json();
          if (Array.isArray(serverDeposits)) {
            onlineDeposits = serverDeposits;
          }
        }
      } catch (err) {
        console.warn('[KANI payments] Error fetching /api/admin/online-deposits, falling back:', err);
      }
    }

    if (onlineDeposits.length === 0) {
      const targetBarber = staff.profile.role === 'BARBER'
        ? staff.profile.barber_id
        : (filters.barberId && filters.barberId !== 'ALL' ? filters.barberId : null);

      const rpcRes = await (supabase as any)?.rpc?.('get_online_deposit_movements', {
        p_barber_id: targetBarber,
        p_start_date: filters.date || filters.startDate || null,
        p_end_date: filters.date || filters.endDate || null,
      });
      const depositRows = rpcRes?.data;
      const depositError = rpcRes?.error;

      if (!depositError && depositRows && Array.isArray(depositRows)) {
        onlineDeposits = depositRows.map((r: any) => ({
          id: r.movement_id || `deposit-${r.appointment_id}`,
          barberId: r.barber_id,
          barberName: r.barber_name || barberMap.get(r.barber_id) || 'Barbero',
          serviceId: null,
          serviceName: r.service_name || 'Seña — Servicio',
          serviceOtherDetail: null,
          servicePriceArs: Number(r.amount_ars),
          discountArs: 0,
          finalAmountArs: Number(r.amount_ars),
          paymentDate: r.payment_date,
          paymentTime: (r.payment_time || '').slice(0, 5),
          paymentMethod: (r.provider === 'PAYWAY' ? 'Tarjeta — Payway' : (r.provider === 'MERCADO_PAGO' ? 'Mercado Pago' : r.provider)) as PaymentMethod,
          onlineDepositPaid: true,
          onlineDepositAmountArs: Number(r.amount_ars),
          collectedAmountArs: Number(r.amount_ars),
          clientName: r.client_name || null,
          clientContact: r.client_contact || null,
          appointmentId: r.appointment_id,
          appointmentDate: r.appointment_date || null,
          appointmentTime: r.appointment_time || null,
          serviceOrigin: 'online_deposit' as ServicePaymentOrigin,
          createdByUserId: null,
          createdByDisplayName: r.provider || 'Payway',
          createdAt: r.payment_timestamp || r.payment_date,
          isDepositMovement: true,
        }));
      } else {
        // Fallback si la RPC get_online_deposit_movements no está disponible
        const baseAptQuery = (supabase as any)?.from?.('appointments')?.select?.('id, barber_id, service_id, custom_service_name, deposit_paid, deposit_amount_ars, booking_date, start_time, created_at, client_id');
        let aptQuery = typeof baseAptQuery?.eq === 'function' ? baseAptQuery.eq('deposit_paid', true) : baseAptQuery;

        if (staff.profile.role === 'BARBER' && staff.profile.barber_id) {
          aptQuery = aptQuery.eq('barber_id', staff.profile.barber_id);
        } else if (filters.barberId && filters.barberId !== 'ALL') {
          aptQuery = aptQuery.eq('barber_id', filters.barberId);
        }

        const aptRes = await aptQuery;
        const apts = aptRes?.data;
        const aptError = aptRes?.error;
        if (!aptError && apts && apts.length > 0) {
          let attemptsByApt = new Map<string, any>();
          try {
            const { data: attempts } = await supabase
              .from('payment_attempts')
              .select('id, appointment_id, provider, amount_ars, state, created_at')
              .eq('state', 'APPROVED')
              .in('appointment_id', apts.map((a: any) => a.id));
            if (attempts) {
              attempts.forEach((att: any) => attemptsByApt.set(att.appointment_id, att));
            }
          } catch {
            // Ignorar fallo de payment_attempts
          }

          const clientIds = [...new Set(apts.map((a: any) => a.client_id).filter(Boolean))];
          const serviceIds = [...new Set(apts.map((a: any) => a.service_id).filter(Boolean))];
          const [cRes, sRes] = await Promise.all([
            clientIds.length ? supabase.from('clients').select('id, name, phone').in('id', clientIds) : { data: [] },
            serviceIds.length ? supabase.from('services').select('id, name').in('id', serviceIds) : { data: [] },
          ]);
          const cData = Array.isArray((cRes as any)?.data) ? (cRes as any).data : [];
          const sData = Array.isArray((sRes as any)?.data) ? (sRes as any).data : [];
          const clientMap = new Map(cData.map((c: any) => [c.id, c]));
          const srvMap = new Map(sData.map((s: any) => [s.id, s.name]));

          onlineDeposits = apts.map((apt: any) => {
            const attempt = attemptsByApt.get(apt.id);
            const rawTimestamp = attempt?.created_at || apt.created_at;
            const { date: payDate, time: payTime } = timestampToBusinessDateTime(rawTimestamp);
            const client = clientMap.get(apt.client_id) as any;
            const sName = apt.custom_service_name || srvMap.get(apt.service_id) || 'Servicio';
            const depositArs = Number(attempt?.amount_ars ?? apt.deposit_amount_ars ?? 5000);
            const prov: PaymentMethod = (attempt?.provider === 'PAYWAY' ? 'Tarjeta — Payway' : (attempt?.provider === 'MERCADO_PAGO' ? 'Mercado Pago' : 'Tarjeta — Payway'));

            return {
              id: `deposit-${attempt?.id || apt.id}`,
              barberId: apt.barber_id,
              barberName: barberMap.get(apt.barber_id) || 'Barbero',
              serviceId: apt.service_id || null,
              serviceName: `Seña — ${sName === 'Corte + barba' ? 'Corte y barba' : sName}` as any,
              serviceOtherDetail: null,
              servicePriceArs: depositArs,
              discountArs: 0,
              finalAmountArs: depositArs,
              paymentDate: payDate,
              paymentTime: payTime,
              paymentMethod: prov,
              onlineDepositPaid: true,
              onlineDepositAmountArs: depositArs,
              collectedAmountArs: depositArs,
              clientName: client?.name || null,
              clientContact: client?.phone || null,
              appointmentId: apt.id,
              appointmentDate: apt.booking_date,
              appointmentTime: (apt.start_time || '').slice(0, 5),
              serviceOrigin: 'online_deposit' as ServicePaymentOrigin,
              createdByUserId: null,
              createdByDisplayName: attempt?.provider || 'Payway',
              createdAt: rawTimestamp,
              isDepositMovement: true,
            };
          }).filter((d: any) => {
            if (filters.date && d.paymentDate !== filters.date) return false;
            if (filters.startDate && d.paymentDate < filters.startDate) return false;
            if (filters.endDate && d.paymentDate > filters.endDate) return false;
            return true;
          });
        }
      }
    }
  } catch (err) {
    console.warn('[KANI payments] Error al cargar señas online para La cobranza:', err);
  }

  const allMovements = [...inShopPayments, ...onlineDeposits];
  allMovements.sort((a, b) => {
    const cmpDate = b.paymentDate.localeCompare(a.paymentDate);
    if (cmpDate !== 0) return cmpDate;
    const cmpTime = (b.paymentTime || '').localeCompare(a.paymentTime || '');
    if (cmpTime !== 0) return cmpTime;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  return allMovements;
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
  const serviceOrigin: ServicePaymentOrigin =
    input.serviceOrigin || (input.appointmentId ? 'appointment' : 'walk_in');

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
      p_service_origin: serviceOrigin,
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
        serviceOrigin,
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
      service_origin: serviceOrigin,
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
      serviceOrigin: (insertedRow.service_origin as ServicePaymentOrigin) || serviceOrigin,
      createdByUserId: insertedRow.created_by_user_id,
      createdByDisplayName: insertedRow.created_by_display_name,
      createdAt: insertedRow.created_at,
      updatedAt: insertedRow.updated_at,
    };
  }

  return persistedRecord;
}

/** Actualiza un cobro existente garantizando autorización por rol y recálculo de montos */
export async function updateServicePayment(
  paymentId: string,
  input: UpdateServicePaymentInput,
  staff: AuthenticatedStaff,
  currentRecord?: ServicePayment,
): Promise<ServicePayment> {
  if (!paymentId) throw new Error('ID de cobro requerido para actualizar.');

  // Verificación de permisos de barbero
  if (staff.profile.role === 'BARBER') {
    if (currentRecord && currentRecord.barberId !== staff.profile.barber_id) {
      throw new Error('No tenés permisos para editar los cobros de otro barbero.');
    }
    if (input.barberId && input.barberId !== staff.profile.barber_id) {
      throw new Error('No tenés permisos para cambiar el barbero asignado al cobro.');
    }
  }

  // Validaciones de negocio
  if (input.serviceName === 'Otros' && (!input.serviceOtherDetail || !input.serviceOtherDetail.trim())) {
    throw new Error('Para el servicio "Otros", debés especificar el detalle.');
  }
  if (!input.servicePriceArs || input.servicePriceArs <= 0) {
    throw new Error('El precio del servicio debe ser mayor a 0.');
  }
  const discountArs = input.discountArs || 0;
  if (discountArs < 0 || discountArs > input.servicePriceArs) {
    throw new Error('El descuento no puede ser negativo ni superar el precio del servicio.');
  }

  const finalAmountArs = input.servicePriceArs - discountArs;
  const depositDeduction = (currentRecord?.onlineDepositPaid && currentRecord?.onlineDepositAmountArs)
    ? currentRecord.onlineDepositAmountArs
    : 0;
  const collectedAmountArs = Math.max(0, finalAmountArs - depositDeduction);

  const formattedTime = input.paymentTime && input.paymentTime.length === 5
    ? `${input.paymentTime}:00`
    : input.paymentTime;

  const updatePayload: any = {
    service_name: input.serviceName === 'Corte y barba' ? 'Corte y barba' : input.serviceName,
    service_other_detail: input.serviceName === 'Otros' ? (input.serviceOtherDetail?.trim() || null) : null,
    service_price_ars: input.servicePriceArs,
    discount_ars: discountArs,
    final_amount_ars: finalAmountArs,
    collected_amount_ars: collectedAmountArs,
    payment_method: input.paymentMethod,
    client_name: input.clientName?.trim() || null,
    client_contact: input.clientContact?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  if (input.paymentDate) updatePayload.payment_date = input.paymentDate;
  if (formattedTime) updatePayload.payment_time = formattedTime;

  // Actualizar origen y relación con turno si se especifica
  if (input.serviceOrigin) {
    updatePayload.service_origin = input.serviceOrigin;
  }
  if (input.appointmentId !== undefined) {
    updatePayload.appointment_id = input.appointmentId;
    if (!input.serviceOrigin) {
      updatePayload.service_origin = input.appointmentId ? 'appointment' : 'walk_in';
    }
  }

  // Solo administradores pueden reasignar el barbero
  if (staff.profile.role === 'ADMIN' && input.barberId) {
    updatePayload.barber_id = input.barberId;
  }

  const { data: updatedRow, error: updateError } = await supabase
    .from('service_payments')
    .update(updatePayload)
    .eq('id', paymentId)
    .select()
    .single();

  if (updateError) {
    console.error('[KANI payments] Error al actualizar cobro en base de datos:', updateError);
    throw new Error(updateError.message || 'No se pudo actualizar el cobro en la base de datos.');
  }

  const barber = staff.barbers.find((b) => b.id === updatedRow.barber_id);
  const barberName = barber ? barber.name : (currentRecord?.barberName || 'Barbero');

  return {
    id: updatedRow.id,
    barberId: updatedRow.barber_id,
    barberName,
    serviceId: updatedRow.service_id,
    serviceName: updatedRow.service_name === 'Corte + barba' ? 'Corte y barba' : (updatedRow.service_name as ServicePaymentType),
    serviceOtherDetail: updatedRow.service_other_detail,
    servicePriceArs: updatedRow.service_price_ars,
    discountArs: updatedRow.discount_ars,
    finalAmountArs: updatedRow.final_amount_ars,
    paymentDate: updatedRow.payment_date,
    paymentTime: (updatedRow.payment_time || '').slice(0, 5),
    paymentMethod: updatedRow.payment_method as PaymentMethod,
    onlineDepositPaid: updatedRow.online_deposit_paid,
    onlineDepositAmountArs: updatedRow.online_deposit_amount_ars,
    collectedAmountArs: updatedRow.collected_amount_ars,
    clientName: updatedRow.client_name,
    clientContact: updatedRow.client_contact,
    appointmentId: updatedRow.appointment_id,
    appointmentRequestNumber: currentRecord?.appointmentRequestNumber,
    serviceOrigin: (updatedRow.service_origin as ServicePaymentOrigin) || (updatedRow.appointment_id ? 'appointment' : 'walk_in'),
    createdByUserId: updatedRow.created_by_user_id,
    createdByDisplayName: updatedRow.created_by_display_name,
    createdAt: updatedRow.created_at,
    updatedAt: updatedRow.updated_at,
  };
}


export async function updateServicePaymentClient(
  paymentId: string,
  clientName: string,
  clientContact: string,
): Promise<void> {
  const { error } = await supabase.rpc('update_service_payment_client', {
    p_payment_id: paymentId,
    p_client_name: clientName.trim(),
    p_client_contact: clientContact.trim(),
  });
  if (error) {
    const { error: directError } = await supabase
      .from('service_payments')
      .update({
        client_name: clientName.trim() || null,
        client_contact: clientContact.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', paymentId);
    if (directError) throw directError;
  }
}

/** Elimina un cobro registrado (exclusivo para Administradores) */
export async function deleteServicePayment(
  paymentId: string,
  staff: AuthenticatedStaff,
): Promise<void> {
  if (!paymentId) throw new Error('ID de cobro requerido para eliminar.');

  if (staff.profile.role !== 'ADMIN') {
    throw new Error('Solo los administradores tienen permiso para eliminar registros de cobro.');
  }

  const { error: rpcError } = await supabase.rpc('soft_delete_service_payment', {
    p_payment_id: paymentId,
  });

  if (rpcError) {
    const { error: updateError } = await supabase
      .from('service_payments')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by_user_id: staff.user?.id || null,
        deleted_by_display_name: staff.profile?.name || 'Admin',
      })
      .eq('id', paymentId);

    if (updateError) {
      console.error('[KANI payments] Error al eliminar cobro en base de datos:', updateError);
      throw new Error(updateError.message || 'No se pudo eliminar el cobro en la base de datos.');
    }
  }

}

/**
 * Clasifica el horario de un cobro según las 3 franjas horarias oficiales de Kani
 */
export function classifyPaymentTime(timeStr: string): 'MORNING' | 'AFTERNOON' | 'NIGHT' | 'OUTSIDE' {
  if (!timeStr) return 'OUTSIDE';
  const parts = timeStr.trim().split(':');
  if (parts.length < 2) return 'OUTSIDE';
  const hour = parseInt(parts[0], 10);
  const minute = parseInt(parts[1], 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return 'OUTSIDE';

  const totalMinutes = hour * 60 + minute;
  const morningStart = 10 * 60; // 10:00
  const afternoonStart = 12 * 60; // 12:00
  const nightStart = 18 * 60; // 18:00
  const nightEnd = 20 * 60; // 20:00

  if (totalMinutes >= morningStart && totalMinutes < afternoonStart) return 'MORNING';
  if (totalMinutes >= afternoonStart && totalMinutes < nightStart) return 'AFTERNOON';
  if (totalMinutes >= nightStart && totalMinutes < nightEnd) return 'NIGHT';
  return 'OUTSIDE';
}

export type ServicePaymentFilterOptions = {
  dateRange: { start: string; end: string } | null;
  timeSlotFilter?: 'ALL' | 'MORNING' | 'AFTERNOON' | 'NIGHT';
  barberFilter?: string;
  serviceFilter?: string;
  role: 'ADMIN' | 'BARBER';
  profileBarberId: string | null;
  permittedBarberIds: ReadonlySet<string>;
};

/**
 * Filtra la colección de servicios cobrados según los filtros reactivos compartidos
 */
export function filterServicePayments(
  payments: ServicePayment[],
  options: ServicePaymentFilterOptions,
): ServicePayment[] {
  return payments.filter((payment) => {
    // 1. Permisos y alcance por barbero
    if (!options.permittedBarberIds.has(payment.barberId)) return false;
    if (options.role === 'BARBER') {
      if (payment.barberId !== options.profileBarberId) return false;
    } else if (options.barberFilter && options.barberFilter !== 'Todos' && payment.barberName !== options.barberFilter) {
      return false;
    }

    // 2. Rango de fechas
    if (options.dateRange) {
      if (payment.paymentDate < options.dateRange.start || payment.paymentDate > options.dateRange.end) {
        return false;
      }
    }

    // 3. Franja horaria
    if (options.timeSlotFilter && options.timeSlotFilter !== 'ALL') {
      const slot = classifyPaymentTime(payment.paymentTime);
      if (slot !== options.timeSlotFilter) return false;
    }

    // 4. Servicio
    if (options.serviceFilter && options.serviceFilter !== 'Todos') {
      if (options.serviceFilter === 'Corte y barba') {
        if (payment.serviceName !== 'Corte y barba' && (payment.serviceName as string) !== 'Corte + barba') {
          return false;
        }
      } else {
        if (payment.serviceName !== options.serviceFilter) {
          return false;
        }
      }
    }

    return true;
  });
}

export type OperationalStatsSummary = {
  totalServices: number;
  withAppointment: number;
  walkIn: number;
  withAppointmentPercentage: number;
  walkInPercentage: number;
  byBarber: Array<{
    barberId: string;
    barberName: string;
    count: number;
    withAppointmentCount: number;
    walkInCount: number;
    percentage: number;
  }>;
  byService: Array<{
    serviceName: string;
    count: number;
    withAppointmentCount: number;
    walkInCount: number;
    percentage: number;
  }>;
};

/**
 * Calcula las métricas operativas de servicios efectivamente realizados
 */
export function computeServicePaymentsOperationalStats(
  payments: ServicePayment[],
): OperationalStatsSummary {
  const totalServices = payments.length;
  let withAppointment = 0;
  let walkIn = 0;

  const barberMap = new Map<string, {
    barberId: string;
    barberName: string;
    count: number;
    withAppointmentCount: number;
    walkInCount: number;
  }>();

  const serviceMap = new Map<string, {
    serviceName: string;
    count: number;
    withAppointmentCount: number;
    walkInCount: number;
  }>();

  for (const p of payments) {
    const isWithAppointment = p.serviceOrigin === 'appointment' || (p.serviceOrigin !== 'walk_in' && Boolean(p.appointmentId));
    if (isWithAppointment) {
      withAppointment += 1;
    } else {
      walkIn += 1;
    }

    // Por barbero
    const bName = p.barberName || 'Barbero';
    const bEntry = barberMap.get(p.barberId) || {
      barberId: p.barberId,
      barberName: bName,
      count: 0,
      withAppointmentCount: 0,
      walkInCount: 0,
    };
    bEntry.count += 1;
    if (isWithAppointment) bEntry.withAppointmentCount += 1;
    else bEntry.walkInCount += 1;
    barberMap.set(p.barberId, bEntry);

    // Por tipo de servicio
    const sName = p.serviceName === 'Otros' && p.serviceOtherDetail
      ? `${p.serviceOtherDetail} (Otros)`
      : p.serviceName;
    const sEntry = serviceMap.get(sName) || {
      serviceName: sName,
      count: 0,
      withAppointmentCount: 0,
      walkInCount: 0,
    };
    sEntry.count += 1;
    if (isWithAppointment) sEntry.withAppointmentCount += 1;
    else sEntry.walkInCount += 1;
    serviceMap.set(sName, sEntry);
  }

  const withAppointmentPercentage = totalServices > 0 ? Math.round((withAppointment / totalServices) * 100) : 0;
  const walkInPercentage = totalServices > 0 ? 100 - withAppointmentPercentage : 0;

  const byBarber = Array.from(barberMap.values())
    .map((b) => ({
      ...b,
      percentage: totalServices > 0 ? (b.count / totalServices) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const byService = Array.from(serviceMap.values())
    .map((s) => ({
      ...s,
      percentage: totalServices > 0 ? (s.count / totalServices) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totalServices,
    withAppointment,
    walkIn,
    withAppointmentPercentage,
    walkInPercentage,
    byBarber,
    byService,
  };
}

export type FinancialStatsSummary = {
  totalCollected: number;
  averageTicket: number;
  totalDiscount: number;
  servicesCount: number;
  depositsPrepaid: number;
  collectedAtShop: number;
  byMethod: Array<{
    method: string;
    total: number;
    count: number;
    percentage: number;
  }>;
  byBarber: Array<{
    barberId: string;
    barberName: string;
    total: number;
    count: number;
    percentage: number;
  }>;
  byService: Array<{
    serviceName: string;
    total: number;
    count: number;
    percentage: number;
  }>;
};

/**
 * Calcula las métricas financieras garantizando que señas y saldos no se dupliquen
 */
export function computeServicePaymentsFinancialStats(
  payments: ServicePayment[],
): FinancialStatsSummary {
  const totalCollected = payments.reduce((sum, p) => sum + (p.finalAmountArs || 0), 0);
  const totalDiscount = payments.reduce((sum, p) => sum + (p.discountArs || 0), 0);
  const depositsPrepaid = payments.reduce((sum, p) => sum + (p.onlineDepositPaid ? (p.onlineDepositAmountArs || 0) : 0), 0);
  const collectedAtShop = payments.reduce((sum, p) => sum + (p.collectedAmountArs || 0), 0);
  const servicesCount = payments.length;
  const averageTicket = servicesCount > 0 ? Math.round(totalCollected / servicesCount) : 0;

  // 1. Por método de pago
  const methodMap = new Map<string, { total: number; count: number }>();
  methodMap.set('Efectivo', { total: 0, count: 0 });
  methodMap.set('Transferencia', { total: 0, count: 0 });

  for (const p of payments) {
    const m = p.paymentMethod || 'Otros';
    const entry = methodMap.get(m) || { total: 0, count: 0 };
    // Lo cobrado en el local con ese método
    entry.total += (p.collectedAmountArs ?? p.finalAmountArs ?? 0);
    entry.count += 1;
    methodMap.set(m, entry);
  }

  // Si hubo señas abonadas online (ej. Mercado Pago), sumarlas como un método legítimo separado para reflejar el total
  if (depositsPrepaid > 0) {
    const depositsCount = payments.filter((p) => p.onlineDepositPaid && p.onlineDepositAmountArs > 0).length;
    methodMap.set('Seña online (Mercado Pago)', { total: depositsPrepaid, count: depositsCount });
  }

  const byMethod = Array.from(methodMap.entries())
    .filter(([_, data]) => data.count > 0 || data.total > 0 || servicesCount === 0)
    .map(([method, data]) => ({
      method,
      total: data.total,
      count: data.count,
      percentage: totalCollected > 0 ? (data.total / totalCollected) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // 2. Por barbero
  const barberMap = new Map<string, { barberId: string; barberName: string; total: number; count: number }>();
  for (const p of payments) {
    const bName = p.barberName || 'Barbero';
    const entry = barberMap.get(p.barberId) || { barberId: p.barberId, barberName: bName, total: 0, count: 0 };
    entry.total += (p.finalAmountArs || 0);
    entry.count += 1;
    barberMap.set(p.barberId, entry);
  }

  const byBarber = Array.from(barberMap.values())
    .map((b) => ({
      ...b,
      percentage: totalCollected > 0 ? (b.total / totalCollected) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // 3. Por servicio
  const serviceMap = new Map<string, { serviceName: string; total: number; count: number }>();
  for (const p of payments) {
    const sName = p.serviceName === 'Otros' && p.serviceOtherDetail
      ? `${p.serviceOtherDetail} (Otros)`
      : p.serviceName;
    const entry = serviceMap.get(sName) || { serviceName: sName, total: 0, count: 0 };
    entry.total += (p.finalAmountArs || 0);
    entry.count += 1;
    serviceMap.set(sName, entry);
  }

  const byService = Array.from(serviceMap.values())
    .map((s) => ({
      ...s,
      percentage: totalCollected > 0 ? (s.total / totalCollected) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    totalCollected,
    averageTicket,
    totalDiscount,
    servicesCount,
    depositsPrepaid,
    collectedAtShop,
    byMethod,
    byBarber,
    byService,
  };
}

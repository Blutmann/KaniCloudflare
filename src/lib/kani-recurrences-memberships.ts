import { supabase } from "@/integrations/supabase/client";
import type { AuthenticatedStaff } from "@/lib/kani-auth";
import { addCalendarDays, businessDateToday } from "@/lib/kani-mobile-appointments";
import { isStaffOperator } from "@/lib/kani-permissions";
import { notifyActivityChanged } from "@/lib/kani-admin-activity";

export type RecurrenceFrequencyType = "ONCE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";
export type RecurrenceEndType = "NEVER" | "UNTIL_DATE" | "AFTER_COUNT";
export type RecurrenceScopeType = "SINGLE" | "THIS_AND_FOLLOWING" | "ALL_FUTURE";
export type RecurringPricingMode = "CURRENT_RATE" | "FIXED_PRICE";

export const RECURRENCE_FREQUENCY_OPTIONS: Array<{ value: RecurrenceFrequencyType; label: string }> = [
  { value: "ONCE", label: "Por única vez" },
  { value: "DAILY", label: "Todos los días" },
  { value: "WEEKLY", label: "Todas las semanas" },
  { value: "BIWEEKLY", label: "Cada dos semanas" },
  { value: "MONTHLY", label: "Todos los meses" },
];

export const RECURRENCE_END_OPTIONS: Array<{ value: RecurrenceEndType; label: string }> = [
  { value: "NEVER", label: "Hasta cancelar" },
  { value: "UNTIL_DATE", label: "Hasta una fecha determinada" },
  { value: "AFTER_COUNT", label: "Después de una cantidad de repeticiones" },
];

export const RECURRENCE_SCOPE_OPTIONS: Array<{ value: RecurrenceScopeType; label: string; description: string }> = [
  {
    value: "SINGLE",
    label: "Solo esta fecha",
    description: "Modifica o cancela únicamente esta ocurrencia sin afectar el resto de la serie.",
  },
  {
    value: "THIS_AND_FOLLOWING",
    label: "Esta fecha y las siguientes",
    description: "Aplica el cambio desde esta ocurrencia en adelante, preservando los turnos anteriores.",
  },
  {
    value: "ALL_FUTURE",
    label: "Toda la serie futura",
    description: "Aplica el cambio a todas las ocurrencias futuras y finaliza la regla recurrente.",
  },
];

// ==============================================================================
// 1. EVALUACIÓN DINÁMICA DE FECHAS RECURRENTES (CON REGLA DEL DÍA 31)
// ==============================================================================

export interface GenerateRecurrenceDatesInput {
  startDate: string; // YYYY-MM-DD
  frequencyType: RecurrenceFrequencyType;
  endType?: RecurrenceEndType;
  endDate?: string | null;
  maxOccurrences?: number | null;
  windowFrom?: string;
  windowTo?: string;
  excludedDates?: string[];
}

function getDaysInMonthUTC(year: number, month1Based: number): number {
  return new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
}

function parseYmd(dateStr: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateStr || "").trim());
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function formatYmd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Genera de forma determinista las fechas de una regla recurrente dentro de una ventana dada.
 * Cumple la regla estricta de FASE 4:
 * Si una recurrencia mensual se configura el día 31 (o 29/30 en febrero), en los meses con menos días
 * se omite ese mes y NO se traslada automáticamente al último día del mes.
 */
export function generateRecurrenceDates(input: GenerateRecurrenceDatesInput): string[] {
  const startParsed = parseYmd(input.startDate);
  if (!startParsed) return [];

  const freq = input.frequencyType || "ONCE";
  const endType = input.endType || "NEVER";
  const windowFrom = input.windowFrom || input.startDate;
  const windowTo = input.windowTo || addCalendarDays(input.startDate, 90);
  const excludedSet = new Set((input.excludedDates ?? []).filter(Boolean));

  if (windowTo < input.startDate || windowFrom > windowTo) {
    return [];
  }

  let effectiveWindowTo = windowTo;
  if (endType === "UNTIL_DATE" && input.endDate && input.endDate < effectiveWindowTo) {
    effectiveWindowTo = input.endDate;
  }

  if (freq === "ONCE") {
    if (
      input.startDate >= windowFrom &&
      input.startDate <= effectiveWindowTo &&
      !excludedSet.has(input.startDate)
    ) {
      return [input.startDate];
    }
    return [];
  }

  const results: string[] = [];
  let occurrenceCount = 0;
  let step = 0;

  while (step < 2000) {
    let candidateDate: string;

    if (freq === "DAILY") {
      candidateDate = addCalendarDays(input.startDate, step);
    } else if (freq === "WEEKLY") {
      candidateDate = addCalendarDays(input.startDate, step * 7);
    } else if (freq === "BIWEEKLY") {
      candidateDate = addCalendarDays(input.startDate, step * 14);
    } else if (freq === "MONTHLY") {
      const totalMonths = (startParsed.year * 12 + (startParsed.month - 1)) + step;
      const targetYear = Math.floor(totalMonths / 12);
      const targetMonth = (totalMonths % 12) + 1;
      const daysInTargetMonth = getDaysInMonthUTC(targetYear, targetMonth);

      if (startParsed.day > daysInTargetMonth) {
        // Mes sin ese día (ej. 31 en abril/junio/septiembre/noviembre/febrero): omitir ese mes
        step++;
        const firstOfTargetMonth = formatYmd(targetYear, targetMonth, 1);
        if (firstOfTargetMonth > effectiveWindowTo) break;
        continue;
      }
      candidateDate = formatYmd(targetYear, targetMonth, startParsed.day);
    } else {
      break;
    }

    step++;

    if (candidateDate > effectiveWindowTo) {
      break;
    }

    if (endType === "UNTIL_DATE" && input.endDate && candidateDate > input.endDate) {
      break;
    }

    occurrenceCount++;
    if (
      endType === "AFTER_COUNT" &&
      typeof input.maxOccurrences === "number" &&
      input.maxOccurrences > 0 &&
      occurrenceCount > input.maxOccurrences
    ) {
      break;
    }

    if (candidateDate >= windowFrom && !excludedSet.has(candidateDate)) {
      results.push(candidateDate);
    }
  }

  return results;
}

// ==============================================================================
// 2. CÁLCULO ECONÓMICO EXACTO DE MEMBRESÍAS (4 Y 10 SERVICIOS)
// ==============================================================================

export type MembershipPackageSize = 4 | 10;
export type MembershipAllowedServiceName = "Corte" | "Barba" | "Corte y barba";
export type MembershipStatus = "PENDING_PAYMENT" | "ACTIVE" | "EXHAUSTED" | "EXPIRED" | "CANCELLED";
export type MembershipConsumptionType = "SERVICE_COMPLETED" | "NO_SHOW_DEDUCTION";
export type KaniMembershipPaymentMethod =
  | "Efectivo"
  | "Transferencia"
  | "Tarjeta — Payway"
  | "Tarjeta de crédito"
  | "Tarjeta de débito"
  | "Payway"
  | "Mercado Pago";

export const KANI_MEMBERSHIP_PAYMENT_METHODS: KaniMembershipPaymentMethod[] = [
  "Efectivo",
  "Transferencia",
  "Tarjeta — Payway",
  "Tarjeta de crédito",
  "Tarjeta de débito",
  "Payway",
  "Mercado Pago",
];

export interface MembershipCompositionItemInput {
  serviceId?: string | null;
  serviceName: MembershipAllowedServiceName;
  quantity: number;
  unitPriceArs: number;
}

export interface MembershipPriceCalculation {
  packageSize: MembershipPackageSize;
  planName: string;
  discountPercent: 10 | 15;
  totalQuantity: number;
  isValidComposition: boolean;
  validationError?: string;
  subtotalArs: number;
  discountAmountArs: number;
  totalPriceArs: number;
  items: Array<{
    serviceId?: string | null;
    serviceName: MembershipAllowedServiceName;
    quantity: number;
    unitPriceArs: number;
    lineSubtotalArs: number;
  }>;
}

export const MEMBERSHIP_ALLOWED_SERVICES: MembershipAllowedServiceName[] = [
  "Corte",
  "Barba",
  "Corte y barba",
];

export const MEMBERSHIP_STATUS_LABELS: Record<MembershipStatus, string> = {
  PENDING_PAYMENT: "Pendiente de pago",
  ACTIVE: "Activa",
  EXHAUSTED: "Agotada",
  EXPIRED: "Vencida",
  CANCELLED: "Cancelada",
};

export function normalizeMembershipServiceName(name: string): MembershipAllowedServiceName | null {
  const clean = (name || "").trim();
  if (clean === "Corte" || clean === "Corte de cabello") return "Corte";
  if (clean === "Barba") return "Barba";
  if (clean === "Corte y barba" || clean === "Corte + barba" || clean === "Corte + Barba") {
    return "Corte y barba";
  }
  return null;
}

/**
 * Calcula con precisión entera en ARS el subtotal, descuento porcentual (10% o 15%),
 * importe descontado y total final de una membresía prepagada.
 */
export function calculateMembershipPricing(
  packageSize: MembershipPackageSize,
  rawItems: MembershipCompositionItemInput[],
): MembershipPriceCalculation {
  if (packageSize !== 4 && packageSize !== 10) {
    throw new Error("El paquete de membresía debe ser de 4 o 10 servicios.");
  }

  const discountPercent: 10 | 15 = packageSize === 4 ? 10 : 15;
  const planName = packageSize === 4 ? "Membresía 4 servicios" : "Membresía 10 servicios";

  let totalQuantity = 0;
  let subtotalArs = 0;
  const normalizedItems: MembershipPriceCalculation["items"] = [];

  for (const item of rawItems) {
    const canonical = normalizeMembershipServiceName(item.serviceName);
    if (!canonical) {
      return {
        packageSize,
        planName,
        discountPercent,
        totalQuantity: 0,
        isValidComposition: false,
        validationError: `El servicio «${item.serviceName}» no está habilitado para membresías.`,
        subtotalArs: 0,
        discountAmountArs: 0,
        totalPriceArs: 0,
        items: [],
      };
    }

    const qty = Math.max(0, Math.trunc(Number(item.quantity) || 0));
    const unitPrice = Math.max(0, Math.round(Number(item.unitPriceArs) || 0));

    if (qty > 0) {
      const lineSubtotalArs = qty * unitPrice;
      totalQuantity += qty;
      subtotalArs += lineSubtotalArs;
      normalizedItems.push({
        serviceId: item.serviceId ?? null,
        serviceName: canonical,
        quantity: qty,
        unitPriceArs: unitPrice,
        lineSubtotalArs,
      });
    }
  }

  const isValidComposition = totalQuantity === packageSize;
  const validationError = isValidComposition
    ? undefined
    : `La suma de servicios (${totalQuantity}) debe coincidir exactamente con el tamaño del paquete (${packageSize}).`;

  const discountAmountArs = Math.round((subtotalArs * discountPercent) / 100);
  const totalPriceArs = Math.max(0, subtotalArs - discountAmountArs);

  return {
    packageSize,
    planName,
    discountPercent,
    totalQuantity,
    isValidComposition,
    validationError,
    subtotalArs,
    discountAmountArs,
    totalPriceArs,
    items: normalizedItems,
  };
}

// ==============================================================================
// 3. TIPOS Y OPERACIONES DE MEMBRESÍAS
// ==============================================================================

export interface ClientMembershipItemRecord {
  id: string;
  membershipId: string;
  serviceId: string | null;
  serviceName: MembershipAllowedServiceName;
  unitPriceSnapshotArs: number;
  totalQuantity: number;
  consumedQuantity: number;
  remainingQuantity: number;
}

export interface ClientMembershipConsumptionRecord {
  id: string;
  membershipId: string;
  itemId: string;
  clientId: string;
  appointmentId: string | null;
  barberId: string | null;
  barberName?: string;
  serviceId: string | null;
  serviceName: string;
  consumptionType: MembershipConsumptionType;
  status: "CONSUMED" | "REFUNDED";
  consumedAt: string;
  consumedByUserId: string | null;
  consumedByDisplayName: string | null;
  refundedAt: string | null;
  refundedByUserId: string | null;
  refundedByDisplayName: string | null;
  refundReason: string | null;
  notes: string | null;
}

export interface ClientMembershipEventRecord {
  id: string;
  membershipId: string;
  eventType: string;
  description: string;
  metadata: Record<string, any>;
  actorUserId: string | null;
  actorDisplayName: string | null;
  createdAt: string;
}

export interface ClientMembershipRecord {
  id: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  barberId: string | null;
  barberName: string;
  planName: string;
  packageSize: MembershipPackageSize;
  discountPercent: 10 | 15;
  subtotalArs: number;
  discountAmountArs: number;
  totalPriceArs: number;
  totalSessions: number;
  consumedSessions: number;
  remainingSessions: number;
  status: MembershipStatus;
  paymentMethod: string | null;
  paymentId: string | null;
  paidAt: string | null;
  expiresAt: string | null;
  expiresUpdatedBy: string | null;
  expiresUpdatedAt: string | null;
  notes: string | null;
  createdByUserId: string | null;
  createdByDisplayName: string | null;
  createdAt: string;
  updatedAt: string;
  items: ClientMembershipItemRecord[];
  consumptions: ClientMembershipConsumptionRecord[];
  events: ClientMembershipEventRecord[];
}

export interface CreateClientMembershipInput {
  clientId: string;
  barberId: string | null;
  packageSize: MembershipPackageSize;
  items: MembershipCompositionItemInput[];
  paymentNow: boolean;
  paymentMethod?: string;
  expiresAt?: string | null;
  notes?: string | null;
}

// Almacenamiento en memoria de respaldo para pruebas aisladas o si la migración aún no fue aplicada en producción
const MEMBERSHIPS_FALLBACK_KEY = "kani_client_memberships_fallback_v1";
const fallbackMembershipsStore = new Map<string, ClientMembershipRecord>();
const fallbackRecurringAvailabilityStore = new Map<string, RecurringAvailabilityRuleRecord>();
const fallbackRecurringAppointmentRulesStore = new Map<string, RecurringAppointmentRuleRecord>();

function loadFallbackMembershipsFromStorage(): void {
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(MEMBERSHIPS_FALLBACK_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item?.id) fallbackMembershipsStore.set(item.id, item);
          }
        }
      }
    } catch {}
  }
}

function persistFallbackMembershipsToStorage(): void {
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const serialized = JSON.stringify([...fallbackMembershipsStore.values()]);
      window.localStorage.setItem(MEMBERSHIPS_FALLBACK_KEY, serialized);
    } catch {}
  }
}

loadFallbackMembershipsFromStorage();

export function resetFallbackStoresForTesting() {
  fallbackMembershipsStore.clear();
  fallbackRecurringAvailabilityStore.clear();
  fallbackRecurringAppointmentRulesStore.clear();
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.removeItem(MEMBERSHIPS_FALLBACK_KEY);
    } catch {}
  }
}

export function computeEffectiveMembershipStatus(
  rawStatus: MembershipStatus,
  consumedSessions: number,
  totalSessions: number,
  expiresAt: string | null,
  today = businessDateToday(),
): MembershipStatus {
  if (rawStatus === "CANCELLED") return "CANCELLED";
  if (consumedSessions >= totalSessions) return "EXHAUSTED";
  if (expiresAt && expiresAt < today && rawStatus !== "EXHAUSTED") return "EXPIRED";
  return rawStatus;
}

export async function fetchClientMemberships(
  staff: AuthenticatedStaff,
  options?: { clientId?: string; barberId?: string },
): Promise<ClientMembershipRecord[]> {
  const today = businessDateToday();
  const isOp = isStaffOperator(staff.profile.role);
  const staffBarberId = staff.profile.barber_id;

  if (!isOp && (staff.profile.role !== "BARBER" || !staffBarberId)) {
    throw new Error("ACCESS_DENIED: No tenés permisos para consultar membresías.");
  }

  try {
    let query = (supabase as any)
      .from("client_memberships")
      .select("*")
      .order("created_at", { ascending: false });

    if (options?.clientId) {
      query = query.eq("client_id", options.clientId);
    }
    if (!isOp && staffBarberId) {
      query = query.eq("barber_id", staffBarberId);
    } else if (options?.barberId && options.barberId !== "ALL") {
      query = query.eq("barber_id", options.barberId);
    }

    const { data: rows, error } = await query;
    if (error) throw error;

    const membershipRows = (rows ?? []) as any[];
    if (!membershipRows.length) {
      loadFallbackMembershipsFromStorage();
      if (fallbackMembershipsStore.size > 0) {
        return filterFallbackMemberships(staff, options);
      }
      return [];
    }

    const membershipIds = membershipRows.map((r) => r.id);
    const clientIds = [...new Set(membershipRows.map((r) => r.client_id).filter(Boolean))];

    const [itemsRes, consumptionsRes, eventsRes, clientsRes] = await Promise.all([
      (supabase as any).from("client_membership_items").select("*").in("membership_id", membershipIds),
      (supabase as any)
        .from("client_membership_consumptions")
        .select("*")
        .in("membership_id", membershipIds)
        .order("consumed_at", { ascending: false }),
      (supabase as any)
        .from("client_membership_events")
        .select("*")
        .in("membership_id", membershipIds)
        .order("created_at", { ascending: false }),
      clientIds.length
        ? supabase.from("clients").select("id, name, phone, email").in("id", clientIds)
        : Promise.resolve({ data: [] }),
    ]);

    const barberById = new Map(staff.barbers.map((b) => [b.id, b.name]));
    const clientById = new Map(((clientsRes as any)?.data ?? []).map((c: any) => [c.id, c]));

    const itemsByMembership = new Map<string, ClientMembershipItemRecord[]>();
    for (const row of (itemsRes?.data ?? []) as any[]) {
      const list = itemsByMembership.get(row.membership_id) ?? [];
      list.push({
        id: row.id,
        membershipId: row.membership_id,
        serviceId: row.service_id ?? null,
        serviceName: (normalizeMembershipServiceName(row.service_name) ?? "Corte"),
        unitPriceSnapshotArs: Number(row.unit_price_snapshot_ars ?? 0),
        totalQuantity: Number(row.total_quantity ?? 0),
        consumedQuantity: Number(row.consumed_quantity ?? 0),
        remainingQuantity: Math.max(0, Number(row.total_quantity ?? 0) - Number(row.consumed_quantity ?? 0)),
      });
      itemsByMembership.set(row.membership_id, list);
    }

    const consumptionsByMembership = new Map<string, ClientMembershipConsumptionRecord[]>();
    for (const row of (consumptionsRes?.data ?? []) as any[]) {
      const list = consumptionsByMembership.get(row.membership_id) ?? [];
      list.push({
        id: row.id,
        membershipId: row.membership_id,
        itemId: row.item_id,
        clientId: row.client_id,
        appointmentId: row.appointment_id ?? null,
        barberId: row.barber_id ?? null,
        barberName: row.barber_id ? barberById.get(row.barber_id) || "Barbero" : "Todo Kani",
        serviceId: row.service_id ?? null,
        serviceName: row.service_name,
        consumptionType: row.consumption_type,
        status: row.status,
        consumedAt: row.consumed_at,
        consumedByUserId: row.consumed_by_user_id ?? null,
        consumedByDisplayName: row.consumed_by_display_name ?? null,
        refundedAt: row.refunded_at ?? null,
        refundedByUserId: row.refunded_by_user_id ?? null,
        refundedByDisplayName: row.refunded_by_display_name ?? null,
        refundReason: row.refund_reason ?? null,
        notes: row.notes ?? null,
      });
      consumptionsByMembership.set(row.membership_id, list);
    }

    const eventsByMembership = new Map<string, ClientMembershipEventRecord[]>();
    for (const row of (eventsRes?.data ?? []) as any[]) {
      const list = eventsByMembership.get(row.membership_id) ?? [];
      list.push({
        id: row.id,
        membershipId: row.membership_id,
        eventType: row.event_type,
        description: row.description,
        metadata: row.metadata ?? {},
        actorUserId: row.actor_user_id ?? null,
        actorDisplayName: row.actor_display_name ?? null,
        createdAt: row.created_at,
      });
      eventsByMembership.set(row.membership_id, list);
    }

    return membershipRows.map((r) => {
      const client = clientById.get(r.client_id) as any;
      const totalSessions = Number(r.total_sessions ?? r.package_size ?? 4);
      const consumedSessions = Number(r.consumed_sessions ?? 0);
      const effectiveStatus = computeEffectiveMembershipStatus(
        r.status as MembershipStatus,
        consumedSessions,
        totalSessions,
        r.expires_at ?? null,
        today,
      );

      return {
        id: r.id,
        clientId: r.client_id,
        clientName: client?.name || (r as any).client_name || "Cliente",
        clientPhone: client?.phone || "",
        clientEmail: client?.email || "",
        barberId: r.barber_id ?? null,
        barberName: r.barber_id ? barberById.get(r.barber_id) || "Barbero" : "Todo Kani",
        planName: r.plan_name,
        packageSize: (Number(r.package_size) === 10 ? 10 : 4) as MembershipPackageSize,
        discountPercent: (Number(r.discount_percent) === 15 ? 15 : 10) as 10 | 15,
        subtotalArs: Number(r.subtotal_ars ?? 0),
        discountAmountArs: Number(r.discount_amount_ars ?? 0),
        totalPriceArs: Number(r.total_price_ars ?? 0),
        totalSessions,
        consumedSessions,
        remainingSessions: Math.max(0, totalSessions - consumedSessions),
        status: effectiveStatus,
        paymentMethod: r.payment_method ?? null,
        paymentId: r.payment_id ?? null,
        paidAt: r.paid_at ?? null,
        expiresAt: r.expires_at ?? null,
        expiresUpdatedBy: r.expires_updated_by ?? null,
        expiresUpdatedAt: r.expires_updated_at ?? null,
        notes: r.notes ?? null,
        createdByUserId: r.created_by_user_id ?? null,
        createdByDisplayName: r.created_by_display_name ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        items: itemsByMembership.get(r.id) ?? [],
        consumptions: consumptionsByMembership.get(r.id) ?? [],
        events: eventsByMembership.get(r.id) ?? [],
      } satisfies ClientMembershipRecord;
    });
  } catch {
    return filterFallbackMemberships(staff, options);
  }
}

function filterFallbackMemberships(
  staff: AuthenticatedStaff,
  options?: { clientId?: string; barberId?: string },
): ClientMembershipRecord[] {
  loadFallbackMembershipsFromStorage();
  const isOp = isStaffOperator(staff.profile.role);
  const staffBarberId = staff.profile.barber_id;
  const today = businessDateToday();

  return Array.from(fallbackMembershipsStore.values())
    .map((m) => ({
      ...m,
      status: computeEffectiveMembershipStatus(
        m.status,
        m.consumedSessions,
        m.totalSessions,
        m.expiresAt,
        today,
      ),
    }))
    .filter((m) => {
      if (options?.clientId && m.clientId !== options.clientId) return false;
      if (!isOp && staffBarberId && m.barberId && m.barberId !== staffBarberId) return false;
      if (isOp && options?.barberId && options.barberId !== "ALL" && m.barberId !== options.barberId) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createClientMembership(
  input: CreateClientMembershipInput,
  staff: AuthenticatedStaff,
  clientInfo?: { name: string; phone?: string; email?: string | null },
): Promise<ClientMembershipRecord> {
  const isOp = isStaffOperator(staff.profile.role);
  const staffBarberId = staff.profile.barber_id;

  if (!isOp && (staff.profile.role !== "BARBER" || !staffBarberId)) {
    throw new Error("No tenés permisos para crear membresías.");
  }

  const targetBarberId = isOp ? (input.barberId || staffBarberId || staff.barbers[0]?.id || null) : staffBarberId;
  if (!isOp && input.barberId && input.barberId !== staffBarberId) {
    throw new Error("No podés crear membresías asignadas a otro barbero.");
  }

  if (!input.clientId) {
    throw new Error("Debés seleccionar un cliente titular para la membresía.");
  }

  const calc = calculateMembershipPricing(input.packageSize, input.items);
  if (!calc.isValidComposition) {
    throw new Error(calc.validationError || "La composición de servicios de la membresía no es válida.");
  }

  try {
    const { data, error } = await (supabase.rpc as any)("create_client_membership", {
      p_client_id: input.clientId,
      p_barber_id: targetBarberId,
      p_package_size: input.packageSize,
      p_items: calc.items.map((i) => ({
        service_name: i.serviceName,
        quantity: i.quantity,
        unit_price_ars: i.unitPriceArs,
      })),
      p_payment_now: input.paymentNow,
      p_payment_method: input.paymentMethod || "Efectivo",
      p_expires_at: input.expiresAt || null,
      p_notes: input.notes?.trim() || null,
    });

    if (error) throw error;
    notifyActivityChanged();
    const list = await fetchClientMemberships(staff, { clientId: input.clientId });
    const created = list.find((m) => m.id === (data as any)?.id) ?? list[0];
    if (created) return created;
  } catch (err: any) {
    const msg = String(err?.message || err || "");
    if (
      !msg.includes("create_client_membership") &&
      !msg.includes("PGRST202") &&
      !msg.includes("relation") &&
      !msg.includes("schema cache")
    ) {
      throw err;
    }
  }

  // Fallback local determinista
  const nowIso = new Date().toISOString();
  const id = crypto.randomUUID();
  const barberName = targetBarberId
    ? staff.barbers.find((b) => b.id === targetBarberId)?.name || "Barbero"
    : "Todo Kani";

  const items: ClientMembershipItemRecord[] = calc.items.map((item) => ({
    id: crypto.randomUUID(),
    membershipId: id,
    serviceId: item.serviceId ?? null,
    serviceName: item.serviceName,
    unitPriceSnapshotArs: item.unitPriceArs,
    totalQuantity: item.quantity,
    consumedQuantity: 0,
    remainingQuantity: item.quantity,
  }));

  const record: ClientMembershipRecord = {
    id,
    clientId: input.clientId,
    clientName: clientInfo?.name || "Cliente",
    clientPhone: clientInfo?.phone || "",
    clientEmail: clientInfo?.email || "",
    barberId: targetBarberId,
    barberName,
    planName: calc.planName,
    packageSize: calc.packageSize,
    discountPercent: calc.discountPercent,
    subtotalArs: calc.subtotalArs,
    discountAmountArs: calc.discountAmountArs,
    totalPriceArs: calc.totalPriceArs,
    totalSessions: calc.packageSize,
    consumedSessions: 0,
    remainingSessions: calc.packageSize,
    status: input.paymentNow ? "ACTIVE" : "PENDING_PAYMENT",
    paymentMethod: input.paymentNow ? (input.paymentMethod || "Efectivo") : null,
    paymentId: input.paymentNow ? crypto.randomUUID() : null,
    paidAt: input.paymentNow ? nowIso : null,
    expiresAt: input.expiresAt || null,
    expiresUpdatedBy: input.expiresAt ? staff.user.id : null,
    expiresUpdatedAt: input.expiresAt ? nowIso : null,
    notes: input.notes?.trim() || null,
    createdByUserId: staff.user.id,
    createdByDisplayName: staff.profile.display_name,
    createdAt: nowIso,
    updatedAt: nowIso,
    items,
    consumptions: [],
    events: [
      {
        id: crypto.randomUUID(),
        membershipId: id,
        eventType: "CREATED",
        description: input.paymentNow
          ? `${calc.planName} creada y activada (${input.paymentMethod || "Efectivo"}).`
          : `${calc.planName} creada en estado Pendiente de pago.`,
        metadata: {
          package_size: calc.packageSize,
          subtotal_ars: calc.subtotalArs,
          discount_amount_ars: calc.discountAmountArs,
          total_price_ars: calc.totalPriceArs,
        },
        actorUserId: staff.user.id,
        actorDisplayName: staff.profile.display_name,
        createdAt: nowIso,
      },
    ],
  };

  fallbackMembershipsStore.set(id, record);
  persistFallbackMembershipsToStorage();
  notifyActivityChanged();
  return record;
}

export async function registerMembershipPayment(
  membershipId: string,
  paymentMethod: string,
  staff: AuthenticatedStaff,
): Promise<ClientMembershipRecord> {
  const isOp = isStaffOperator(staff.profile.role);
  const staffBarberId = staff.profile.barber_id;

  try {
    const { error } = await (supabase.rpc as any)("register_membership_payment", {
      p_membership_id: membershipId,
      p_payment_method: paymentMethod || "Efectivo",
      p_barber_id: staffBarberId || null,
    });
    if (error) throw error;
    notifyActivityChanged();
    const all = await fetchClientMemberships(staff);
    const updated = all.find((m) => m.id === membershipId);
    if (updated) return updated;
  } catch (err: any) {
    const msg = String(err?.message || err || "");
    if (!fallbackMembershipsStore.has(membershipId) && !msg.includes("register_membership_payment") && !msg.includes("PGRST202")) {
      throw err;
    }
  }

  const existing = fallbackMembershipsStore.get(membershipId);
  if (!existing) throw new Error("Membresía no encontrada.");
  if (!isOp && existing.barberId && existing.barberId !== staffBarberId) {
    throw new Error("No tenés permisos para gestionar esta membresía.");
  }
  if (existing.status !== "PENDING_PAYMENT") {
    throw new Error("La membresía ya registra pago o no se encuentra pendiente.");
  }

  const nowIso = new Date().toISOString();
  existing.status = existing.consumedSessions >= existing.totalSessions ? "EXHAUSTED" : "ACTIVE";
  existing.paymentMethod = paymentMethod || "Efectivo";
  existing.paymentId = crypto.randomUUID();
  existing.paidAt = nowIso;
  existing.updatedAt = nowIso;
  existing.events.unshift({
    id: crypto.randomUUID(),
    membershipId,
    eventType: "PAYMENT_REGISTERED",
    description: `Pago total registrado (${existing.paymentMethod}). Membresía activada.`,
    metadata: { amount_ars: existing.totalPriceArs },
    actorUserId: staff.user.id,
    actorDisplayName: staff.profile.display_name,
    createdAt: nowIso,
  });

  fallbackMembershipsStore.set(membershipId, { ...existing });
  persistFallbackMembershipsToStorage();
  notifyActivityChanged();
  return existing;
}

export async function consumeMembershipSession(
  input: {
    membershipId: string;
    serviceName?: string;
    appointmentId?: string | null;
    consumptionType?: MembershipConsumptionType;
    barberId?: string | null;
    notes?: string | null;
    clientId?: string | null;
  },
  staff: AuthenticatedStaff,
): Promise<{
  membership: ClientMembershipRecord;
  consumption: ClientMembershipConsumptionRecord;
  remainingSessions: number;
  isExhausted: boolean;
}> {
  const isOp = isStaffOperator(staff.profile.role);
  const staffBarberId = staff.profile.barber_id;
  const consumptionType = input.consumptionType || "SERVICE_COMPLETED";

  try {
    const { data, error } = await (supabase.rpc as any)("consume_membership_session", {
      p_membership_id: input.membershipId,
      p_service_name: input.serviceName || null,
      p_appointment_id: input.appointmentId || null,
      p_consumption_type: consumptionType,
      p_barber_id: input.barberId || staffBarberId || null,
      p_notes: input.notes?.trim() || null,
    });
    if (error) throw error;
    notifyActivityChanged();
    const all = await fetchClientMemberships(staff);
    const updated = all.find((m) => m.id === input.membershipId);
    if (updated) {
      const latestConsumption = updated.consumptions[0]!;
      return {
        membership: updated,
        consumption: latestConsumption,
        remainingSessions: updated.remainingSessions,
        isExhausted: updated.status === "EXHAUSTED",
      };
    }
    if (data) return data as any;
  } catch (err: any) {
    const msg = String(err?.message || err || "");
    if (
      !fallbackMembershipsStore.has(input.membershipId) &&
      !msg.includes("consume_membership_session") &&
      !msg.includes("PGRST202")
    ) {
      throw err;
    }
  }

  const existing = fallbackMembershipsStore.get(input.membershipId);
  if (!existing) throw new Error("Membresía no encontrada.");
  if (!isOp && existing.barberId && existing.barberId !== staffBarberId) {
    throw new Error("No tenés permisos para descontar sesiones de otro barbero.");
  }
  if (input.clientId && input.clientId !== existing.clientId) {
    throw new Error("La membresía es personal e intransferible: no pertenece a este cliente.");
  }

  const today = businessDateToday();
  const effectiveStatus = computeEffectiveMembershipStatus(
    existing.status,
    existing.consumedSessions,
    existing.totalSessions,
    existing.expiresAt,
    today,
  );

  if (effectiveStatus === "PENDING_PAYMENT") {
    throw new Error("No se pueden consumir sesiones de una membresía pendiente de pago.");
  }
  if (effectiveStatus === "EXPIRED") {
    existing.status = "EXPIRED";
    throw new Error("No se pueden consumir sesiones de una membresía vencida.");
  }
  if (effectiveStatus === "CANCELLED") {
    throw new Error("No se pueden consumir sesiones de una membresía cancelada.");
  }
  if (effectiveStatus === "EXHAUSTED" || existing.consumedSessions >= existing.totalSessions) {
    throw new Error("La membresía ya tiene todas sus sesiones agotadas.");
  }

  if (
    input.appointmentId &&
    existing.consumptions.some((c) => c.appointmentId === input.appointmentId && c.status === "CONSUMED")
  ) {
    throw new Error("Este turno ya consumió una sesión activa de la membresía.");
  }

  const canonicalRequested = input.serviceName ? normalizeMembershipServiceName(input.serviceName) : null;
  const targetItem = canonicalRequested
    ? existing.items.find((i) => i.serviceName === canonicalRequested && i.remainingQuantity > 0)
    : existing.items.find((i) => i.remainingQuantity > 0);
  if (!targetItem) {
    throw new Error("No quedan sesiones disponibles para ese servicio en la membresía.");
  }

  targetItem.consumedQuantity += 1;
  targetItem.remainingQuantity = Math.max(0, targetItem.totalQuantity - targetItem.consumedQuantity);
  existing.consumedSessions += 1;
  existing.remainingSessions = Math.max(0, existing.totalSessions - existing.consumedSessions);
  if (existing.consumedSessions >= existing.totalSessions) {
    existing.status = "EXHAUSTED";
  }

  const nowIso = new Date().toISOString();
  const barberId = input.barberId || existing.barberId || staffBarberId || null;
  const barberName = barberId
    ? staff.barbers.find((b) => b.id === barberId)?.name || "Barbero"
    : "Todo Kani";

  const consumption: ClientMembershipConsumptionRecord = {
    id: crypto.randomUUID(),
    membershipId: existing.id,
    itemId: targetItem.id,
    clientId: existing.clientId,
    appointmentId: input.appointmentId ?? null,
    barberId,
    barberName,
    serviceId: targetItem.serviceId,
    serviceName: targetItem.serviceName,
    consumptionType,
    status: "CONSUMED",
    consumedAt: nowIso,
    consumedByUserId: staff.user.id,
    consumedByDisplayName: staff.profile.display_name,
    refundedAt: null,
    refundedByUserId: null,
    refundedByDisplayName: null,
    refundReason: null,
    notes: input.notes?.trim() || null,
  };

  existing.consumptions.unshift(consumption);
  existing.events.unshift({
    id: crypto.randomUUID(),
    membershipId: existing.id,
    eventType: "SESSION_CONSUMED",
    description: `Sesión consumida (${targetItem.serviceName} — ${
      consumptionType === "NO_SHOW_DEDUCTION" ? "Inasistencia descontada" : "Servicio realizado"
    }). Restantes: ${existing.remainingSessions} de ${existing.totalSessions}.`,
    metadata: {
      consumption_id: consumption.id,
      appointment_id: input.appointmentId ?? null,
      service_name: targetItem.serviceName,
      consumption_type: consumptionType,
      remaining_sessions: existing.remainingSessions,
    },
    actorUserId: staff.user.id,
    actorDisplayName: staff.profile.display_name,
    createdAt: nowIso,
  });
  existing.updatedAt = nowIso;

  fallbackMembershipsStore.set(existing.id, { ...existing });
  persistFallbackMembershipsToStorage();
  notifyActivityChanged();

  return {
    membership: existing,
    consumption,
    remainingSessions: existing.remainingSessions,
    isExhausted: existing.status === "EXHAUSTED",
  };
}

export async function refundMembershipSession(
  input: {
    consumptionId?: string | null;
    appointmentId?: string | null;
    membershipId?: string | null;
    reason?: string | null;
  },
  staff: AuthenticatedStaff,
): Promise<{
  membership: ClientMembershipRecord;
  consumption: ClientMembershipConsumptionRecord;
  remainingSessions: number;
}> {
  const isOp = isStaffOperator(staff.profile.role);
  const staffBarberId = staff.profile.barber_id;

  try {
    const { error } = await (supabase.rpc as any)("refund_membership_session", {
      p_consumption_id: input.consumptionId || null,
      p_appointment_id: input.appointmentId || null,
      p_reason: input.reason?.trim() || null,
    });
    if (error) throw error;
    notifyActivityChanged();
    const all = await fetchClientMemberships(staff);
    const updated = all.find(
      (m) =>
        m.id === input.membershipId ||
        m.consumptions.some((c) => c.id === input.consumptionId || (input.appointmentId && c.appointmentId === input.appointmentId)),
    );
    if (updated) {
      const refunded = updated.consumptions.find(
        (c) => c.id === input.consumptionId || (input.appointmentId && c.appointmentId === input.appointmentId),
      )!;
      return {
        membership: updated,
        consumption: refunded,
        remainingSessions: updated.remainingSessions,
      };
    }
  } catch (err: any) {
    const msg = String(err?.message || err || "");
    if (
      fallbackMembershipsStore.size === 0 &&
      !msg.includes("refund_membership_session") &&
      !msg.includes("PGRST202")
    ) {
      throw err;
    }
  }

  let targetMembership: ClientMembershipRecord | undefined;
  let targetConsumption: ClientMembershipConsumptionRecord | undefined;

  for (const m of fallbackMembershipsStore.values()) {
    const found = m.consumptions.find(
      (c) =>
        (input.consumptionId && c.id === input.consumptionId) ||
        (input.appointmentId && c.appointmentId === input.appointmentId && c.status === "CONSUMED"),
    );
    if (found) {
      targetMembership = m;
      targetConsumption = found;
      break;
    }
  }

  if (!targetMembership || !targetConsumption) {
    throw new Error("No se encontró el consumo de sesión a reintegrar.");
  }
  if (!isOp && targetMembership.barberId && targetMembership.barberId !== staffBarberId) {
    throw new Error("No tenés permisos para reintegrar sesiones de otro barbero.");
  }
  if (targetConsumption.status === "REFUNDED") {
    throw new Error("Esta sesión ya fue reintegrada previamente.");
  }

  const nowIso = new Date().toISOString();
  const today = businessDateToday();
  targetConsumption.status = "REFUNDED";
  targetConsumption.refundedAt = nowIso;
  targetConsumption.refundedByUserId = staff.user.id;
  targetConsumption.refundedByDisplayName = staff.profile.display_name;
  targetConsumption.refundReason = input.reason?.trim() || "Reintegro por cancelación o corrección";

  const item = targetMembership.items.find((i) => i.id === targetConsumption!.itemId);
  if (item) {
    item.consumedQuantity = Math.max(0, item.consumedQuantity - 1);
    item.remainingQuantity = Math.max(0, item.totalQuantity - item.consumedQuantity);
  }

  targetMembership.consumedSessions = Math.max(0, targetMembership.consumedSessions - 1);
  targetMembership.remainingSessions = Math.max(
    0,
    targetMembership.totalSessions - targetMembership.consumedSessions,
  );
  if (
    targetMembership.status === "EXHAUSTED" &&
    (!targetMembership.expiresAt || targetMembership.expiresAt >= today)
  ) {
    targetMembership.status = "ACTIVE";
  }

  targetMembership.events.unshift({
    id: crypto.randomUUID(),
    membershipId: targetMembership.id,
    eventType: "SESSION_REFUNDED",
    description: `Sesión reintegrada (${targetConsumption.serviceName}). Sesiones disponibles: ${targetMembership.remainingSessions} de ${targetMembership.totalSessions}.`,
    metadata: {
      consumption_id: targetConsumption.id,
      appointment_id: targetConsumption.appointmentId,
      reason: targetConsumption.refundReason,
      remaining_sessions: targetMembership.remainingSessions,
    },
    actorUserId: staff.user.id,
    actorDisplayName: staff.profile.display_name,
    createdAt: nowIso,
  });
  targetMembership.updatedAt = nowIso;

  fallbackMembershipsStore.set(targetMembership.id, { ...targetMembership });
  persistFallbackMembershipsToStorage();
  notifyActivityChanged();

  return {
    membership: targetMembership,
    consumption: targetConsumption,
    remainingSessions: targetMembership.remainingSessions,
  };
}

export async function updateClientMembershipDetails(
  input: {
    membershipId: string;
    expiresAt?: string | null;
    clearExpiration?: boolean;
    status?: MembershipStatus;
    notes?: string | null;
  },
  staff: AuthenticatedStaff,
): Promise<ClientMembershipRecord> {
  const isOp = isStaffOperator(staff.profile.role);
  const staffBarberId = staff.profile.barber_id;

  try {
    const { error } = await (supabase.rpc as any)("update_client_membership", {
      p_membership_id: input.membershipId,
      p_expires_at: input.expiresAt || null,
      p_clear_expiration: Boolean(input.clearExpiration),
      p_status: input.status || null,
      p_notes: input.notes ?? null,
    });
    if (error) throw error;
    notifyActivityChanged();
    const all = await fetchClientMemberships(staff);
    const updated = all.find((m) => m.id === input.membershipId);
    if (updated) return updated;
  } catch (err: any) {
    const msg = String(err?.message || err || "");
    if (
      !fallbackMembershipsStore.has(input.membershipId) &&
      !msg.includes("update_client_membership") &&
      !msg.includes("PGRST202")
    ) {
      throw err;
    }
  }

  const existing = fallbackMembershipsStore.get(input.membershipId);
  if (!existing) throw new Error("Membresía no encontrada.");
  if (!isOp && existing.barberId && existing.barberId !== staffBarberId) {
    throw new Error("No tenés permisos para modificar esta membresía.");
  }

  const nowIso = new Date().toISOString();
  const nextExpires = input.clearExpiration
    ? null
    : input.expiresAt !== undefined
      ? input.expiresAt
      : existing.expiresAt;

  if (nextExpires !== existing.expiresAt) {
    existing.expiresAt = nextExpires;
    existing.expiresUpdatedBy = staff.user.id;
    existing.expiresUpdatedAt = nowIso;
  }
  if (input.status) {
    existing.status = input.status;
  }
  if (input.notes !== undefined) {
    existing.notes = input.notes;
  }
  existing.updatedAt = nowIso;

  existing.events.unshift({
    id: crypto.randomUUID(),
    membershipId: existing.id,
    eventType: "UPDATED",
    description: `Membresía actualizada por ${staff.profile.display_name}. Vencimiento: ${
      existing.expiresAt || "Sin vencimiento"
    }. Estado: ${MEMBERSHIP_STATUS_LABELS[existing.status]}.`,
    metadata: {
      expires_at: existing.expiresAt,
      status: existing.status,
    },
    actorUserId: staff.user.id,
    actorDisplayName: staff.profile.display_name,
    createdAt: nowIso,
  });

  fallbackMembershipsStore.set(existing.id, { ...existing });
  persistFallbackMembershipsToStorage();
  notifyActivityChanged();
  return existing;
}

// ==============================================================================
// 4. DISPONIBILIDADES RECURRENTES Y CONFLICTOS DE BLOQUEO (FASE 3 Y 6)
// ==============================================================================

export interface RecurringAvailabilityRuleRecord {
  id: string;
  barberId: string;
  barberName?: string;
  startDate: string;
  startTime: string;
  endTime: string;
  frequencyType: Exclude<RecurrenceFrequencyType, "ONCE">;
  endType: RecurrenceEndType;
  endDate: string | null;
  maxOccurrences: number | null;
  excludedDates: string[];
  active: boolean;
  internalNote: string | null;
  createdByUserId: string | null;
  createdByDisplayName: string | null;
  createdAt: string;
}

export interface AffectedAppointmentOnBlock {
  appointmentId: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  clientName: string;
  serviceName: string;
  barberName: string;
  status: string;
}

export async function fetchRecurringAvailabilityRules(
  staff: AuthenticatedStaff,
  barberId?: string,
): Promise<RecurringAvailabilityRuleRecord[]> {
  const isOp = isStaffOperator(staff.profile.role);
  const staffBarberId = staff.profile.barber_id;
  const barberById = new Map(staff.barbers.map((b) => [b.id, b.name]));

  try {
    let query = (supabase as any)
      .from("recurring_availability_rules")
      .select("*")
      .order("start_date", { ascending: true });

    if (!isOp && staffBarberId) {
      query = query.eq("barber_id", staffBarberId);
    } else if (barberId && barberId !== "ALL") {
      query = query.eq("barber_id", barberId);
    }

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as any[];
    if (!rows.length && fallbackRecurringAvailabilityStore.size > 0) {
      return Array.from(fallbackRecurringAvailabilityStore.values()).filter(
        (r) => !barberId || barberId === "ALL" || r.barberId === barberId,
      );
    }
    return rows.map((r) => ({
      id: r.id,
      barberId: r.barber_id,
      barberName: barberById.get(r.barber_id) || "Barbero",
      startDate: r.start_date,
      startTime: (r.start_time || "").slice(0, 5),
      endTime: (r.end_time || "").slice(0, 5),
      frequencyType: r.frequency_type,
      endType: r.end_type || "NEVER",
      endDate: r.end_date ?? null,
      maxOccurrences: r.max_occurrences ?? null,
      excludedDates: r.excluded_dates ?? [],
      active: Boolean(r.active),
      internalNote: r.internal_note ?? null,
      createdByUserId: r.created_by_user_id ?? null,
      createdByDisplayName: r.created_by_display_name ?? null,
      createdAt: r.created_at,
    }));
  } catch {
    return Array.from(fallbackRecurringAvailabilityStore.values()).filter((r) => {
      if (!isOp && staffBarberId && r.barberId !== staffBarberId) return false;
      if (barberId && barberId !== "ALL" && r.barberId !== barberId) return false;
      return true;
    });
  }
}

export async function createRecurringAvailabilityRule(
  input: {
    barberId: string;
    startDate: string;
    startTime: string;
    endTime?: string | null;
    frequencyType: Exclude<RecurrenceFrequencyType, "ONCE">;
    endType: RecurrenceEndType;
    endDate?: string | null;
    maxOccurrences?: number | null;
    internalNote?: string | null;
  },
  staff: AuthenticatedStaff,
): Promise<RecurringAvailabilityRuleRecord> {
  const isOp = isStaffOperator(staff.profile.role);
  const staffBarberId = staff.profile.barber_id;
  if (!isOp && (staff.profile.role !== "BARBER" || staffBarberId !== input.barberId)) {
    throw new Error("No tenés permisos para configurar disponibilidad recurrente de otro barbero.");
  }

  const startTimeFormatted = input.startTime.length === 5 ? `${input.startTime}:00` : input.startTime;
  const endTimeFormatted = input.endTime
    ? input.endTime.length === 5
      ? `${input.endTime}:00`
      : input.endTime
    : null;

  try {
    const { data, error } = await (supabase.rpc as any)("create_recurring_availability_rule", {
      p_barber_id: input.barberId,
      p_start_date: input.startDate,
      p_start_time: startTimeFormatted,
      p_end_time: endTimeFormatted,
      p_frequency_type: input.frequencyType,
      p_end_type: input.endType,
      p_end_date: input.endType === "UNTIL_DATE" ? input.endDate || null : null,
      p_max_occurrences: input.endType === "AFTER_COUNT" ? input.maxOccurrences || null : null,
      p_internal_note: input.internalNote?.trim() || null,
    });
    if (error) throw error;
    if (data) {
      return {
        id: data.id,
        barberId: data.barber_id,
        barberName: staff.barbers.find((b) => b.id === data.barber_id)?.name || "Barbero",
        startDate: data.start_date,
        startTime: (data.start_time || input.startTime).slice(0, 5),
        endTime: (data.end_time || input.endTime || "10:45").slice(0, 5),
        frequencyType: data.frequency_type,
        endType: data.end_type,
        endDate: data.end_date ?? null,
        maxOccurrences: data.max_occurrences ?? null,
        excludedDates: data.excluded_dates ?? [],
        active: Boolean(data.active),
        internalNote: data.internal_note ?? null,
        createdByUserId: data.created_by_user_id ?? staff.user.id,
        createdByDisplayName: data.created_by_display_name ?? staff.profile.display_name,
        createdAt: data.created_at ?? new Date().toISOString(),
      };
    }
  } catch (err: any) {
    const msg = String(err?.message || err || "");
    if (!msg.includes("create_recurring_availability_rule") && !msg.includes("PGRST202")) {
      throw err;
    }
  }

  const id = crypto.randomUUID();
  const [h = 10, m = 0] = input.startTime.split(":").map(Number);
  const endMinutes = Math.min(23 * 60 + 55, h * 60 + m + 45);
  const computedEnd =
    input.endTime ||
    `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;

  const rule: RecurringAvailabilityRuleRecord = {
    id,
    barberId: input.barberId,
    barberName: staff.barbers.find((b) => b.id === input.barberId)?.name || "Barbero",
    startDate: input.startDate,
    startTime: input.startTime.slice(0, 5),
    endTime: computedEnd.slice(0, 5),
    frequencyType: input.frequencyType,
    endType: input.endType,
    endDate: input.endType === "UNTIL_DATE" ? input.endDate || null : null,
    maxOccurrences: input.endType === "AFTER_COUNT" ? input.maxOccurrences || null : null,
    excludedDates: [],
    active: true,
    internalNote: input.internalNote?.trim() || null,
    createdByUserId: staff.user.id,
    createdByDisplayName: staff.profile.display_name,
    createdAt: new Date().toISOString(),
  };

  fallbackRecurringAvailabilityStore.set(id, rule);
  return rule;
}

export async function modifyRecurringAvailabilityRule(
  input: {
    ruleId: string;
    scope: RecurrenceScopeType;
    targetDate: string;
    action: "BLOCK" | "MODIFY" | "DEACTIVATE";
    newStartTime?: string | null;
    newEndTime?: string | null;
    reason?: string | null;
  },
  staff: AuthenticatedStaff,
): Promise<{ ruleId: string; scope: RecurrenceScopeType; action: string }> {
  const isOp = isStaffOperator(staff.profile.role);
  const staffBarberId = staff.profile.barber_id;

  try {
    const { data, error } = await (supabase.rpc as any)("modify_recurring_availability_rule", {
      p_rule_id: input.ruleId,
      p_scope: input.scope,
      p_target_date: input.targetDate,
      p_action: input.action,
      p_new_start_time: input.newStartTime ? `${input.newStartTime.slice(0, 5)}:00` : null,
      p_new_end_time: input.newEndTime ? `${input.newEndTime.slice(0, 5)}:00` : null,
      p_reason: input.reason?.trim() || null,
    });
    if (error) throw error;
    if (data) {
      return {
        ruleId: data.rule_id || input.ruleId,
        scope: input.scope,
        action: input.action,
      };
    }
  } catch (err: any) {
    const msg = String(err?.message || err || "");
    if (
      !fallbackRecurringAvailabilityStore.has(input.ruleId) &&
      !msg.includes("modify_recurring_availability_rule") &&
      !msg.includes("PGRST202")
    ) {
      throw err;
    }
  }

  const rule = fallbackRecurringAvailabilityStore.get(input.ruleId);
  if (!rule) throw new Error("Regla de disponibilidad no encontrada.");
  if (!isOp && rule.barberId !== staffBarberId) {
    throw new Error("No tenés permisos para modificar esta regla de disponibilidad.");
  }

  if (input.scope === "SINGLE") {
    if (!rule.excludedDates.includes(input.targetDate)) {
      rule.excludedDates.push(input.targetDate);
    }
  } else if (input.scope === "THIS_AND_FOLLOWING") {
    const prevDate = addCalendarDays(input.targetDate, -1);
    rule.endType = "UNTIL_DATE";
    rule.endDate = prevDate;
    if (prevDate < rule.startDate) rule.active = false;
  } else if (input.scope === "ALL_FUTURE") {
    rule.active = false;
    rule.endType = "UNTIL_DATE";
    rule.endDate = addCalendarDays(businessDateToday(), -1);
  }

  fallbackRecurringAvailabilityStore.set(rule.id, { ...rule });
  return { ruleId: rule.id, scope: input.scope, action: input.action };
}

// ==============================================================================
// 5. SERIES DE TURNOS MANUALES RECURRENTES Y CONFLICTOS (FASE 4, 5, 11, 12)
// ==============================================================================

export interface RecurringAppointmentConflictDetail {
  targetDate: string;
  startTime: string;
  conflictReason: string;
  conflictingAppointmentId: string | null;
  conflictingClientName: string | null;
}

export interface CreateRecurringManualSeriesResult {
  ruleId: string;
  createdCount: number;
  omittedCount: number;
  createdAppointments: Array<{
    id: string;
    bookingDate: string;
    startTime: string;
    endTime: string;
    servicePriceArs: number;
  }>;
  omittedConflicts: RecurringAppointmentConflictDetail[];
}

export interface RecurringAppointmentRuleRecord {
  id: string;
  clientId: string;
  barberId: string;
  serviceId: string | null;
  customServiceName: string | null;
  startTime: string;
  durationMinutes: number;
  startDate: string;
  endDate: string | null;
  frequencyType: Exclude<RecurrenceFrequencyType, "ONCE">;
  endType: RecurrenceEndType;
  maxOccurrences: number | null;
  pricingMode: RecurringPricingMode;
  fixedPriceArs: number | null;
  membershipId: string | null;
  excludedDates: string[];
  active: boolean;
  notes: string | null;
}

export async function createRecurringManualSeries(
  input: {
    barberId: string;
    serviceId?: string | null;
    customServiceName?: string | null;
    servicePriceArs?: number | null;
    startDate: string;
    startTime: string;
    durationMinutes?: number | null;
    clientName: string;
    clientPhone: string;
    clientEmail?: string | null;
    clientId?: string | null;
    notes?: string | null;
    frequencyType: Exclude<RecurrenceFrequencyType, "ONCE">;
    endType: RecurrenceEndType;
    endDate?: string | null;
    maxOccurrences?: number | null;
    pricingMode?: RecurringPricingMode;
    membershipId?: string | null;
    horizonDays?: number;
  },
  staff: AuthenticatedStaff,
  existingAppointmentsForFallback: Array<{
    id: string;
    barberId: string;
    date: string;
    time: string;
    endTime?: string;
    statusCode: string;
    name?: string;
  }> = [],
): Promise<CreateRecurringManualSeriesResult> {
  const isOp = isStaffOperator(staff.profile.role);
  const staffBarberId = staff.profile.barber_id;
  if (!isOp && (staff.profile.role !== "BARBER" || staffBarberId !== input.barberId)) {
    throw new Error("No tenés permisos para agendar recurrencias en la agenda de otro barbero.");
  }

  const horizonDays = input.horizonDays ?? 90;
  const formattedStart = input.startTime.length === 5 ? `${input.startTime}:00` : input.startTime;

  try {
    const { data, error } = await (supabase.rpc as any)("create_recurring_manual_series", {
      p_barber_id: input.barberId,
      p_service_id: input.serviceId || null,
      p_custom_service_name: input.customServiceName?.trim() || null,
      p_service_price_ars: input.servicePriceArs ?? null,
      p_start_date: input.startDate,
      p_start_time: formattedStart,
      p_duration_minutes: input.durationMinutes ?? 45,
      p_client_name: input.clientName.trim(),
      p_client_phone: input.clientPhone.trim(),
      p_client_email: input.clientEmail?.trim() || null,
      p_client_id: input.clientId || null,
      p_notes: input.notes?.trim() || null,
      p_frequency_type: input.frequencyType,
      p_end_type: input.endType,
      p_end_date: input.endType === "UNTIL_DATE" ? input.endDate || null : null,
      p_max_occurrences: input.endType === "AFTER_COUNT" ? input.maxOccurrences || null : null,
      p_pricing_mode: input.pricingMode || "CURRENT_RATE",
      p_membership_id: input.membershipId || null,
      p_horizon_days: horizonDays,
    });

    if (error) throw error;
    if (data) {
      notifyActivityChanged();
      return {
        ruleId: data.rule_id,
        createdCount: Number(data.created_count ?? 0),
        omittedCount: Number(data.omitted_count ?? 0),
        createdAppointments: ((data.created_appointments ?? []) as any[]).map((a) => ({
          id: a.id,
          bookingDate: a.booking_date,
          startTime: (a.start_time || "").slice(0, 5),
          endTime: (a.end_time || "").slice(0, 5),
          servicePriceArs: Number(a.service_price_ars ?? 0),
        })),
        omittedConflicts: ((data.omitted_conflicts ?? []) as any[]).map((c) => ({
          targetDate: c.target_date,
          startTime: (c.start_time || input.startTime).slice(0, 5),
          conflictReason: c.conflict_reason || "EXISTING_APPOINTMENT_OVERLAP",
          conflictingAppointmentId: c.conflicting_appointment_id ?? null,
          conflictingClientName:
            isOp || input.barberId === staffBarberId ? c.conflicting_client_name ?? null : null,
        })),
      };
    }
  } catch (err: any) {
    const msg = String(err?.message || err || "");
    if (!msg.includes("create_recurring_manual_series") && !msg.includes("PGRST202")) {
      throw err;
    }
  }

  // Fallback local determinista con evaluación de ventana móvil de 90 días y detección de conflictos
  const today = businessDateToday();
  const windowTo = addCalendarDays(today, horizonDays);
  const candidateDates = generateRecurrenceDates({
    startDate: input.startDate,
    frequencyType: input.frequencyType,
    endType: input.endType,
    endDate: input.endDate,
    maxOccurrences: input.maxOccurrences,
    windowFrom: input.startDate >= today ? input.startDate : today,
    windowTo,
  });

  const durationMin = input.durationMinutes ?? 45;
  const [sh = 10, sm = 0] = input.startTime.slice(0, 5).split(":").map(Number);
  const startTotalMin = sh * 60 + sm;
  const endTotalMin = startTotalMin + durationMin;
  const endTimeStr = `${String(Math.floor((endTotalMin % 1440) / 60)).padStart(2, "0")}:${String(
    endTotalMin % 60,
  ).padStart(2, "0")}`;

  const createdAppointments: CreateRecurringManualSeriesResult["createdAppointments"] = [];
  const omittedConflicts: RecurringAppointmentConflictDetail[] = [];
  const excludedDates: string[] = [];

  for (const date of candidateDates) {
    const conflict = existingAppointmentsForFallback.find((apt) => {
      if (apt.barberId !== input.barberId || apt.date !== date || apt.statusCode === "CANCELLED") {
        return false;
      }
      const [ah = 10, am = 0] = apt.time.slice(0, 5).split(":").map(Number);
      const aStart = ah * 60 + am;
      let aEnd = aStart + 45;
      if (apt.endTime) {
        const [eh = 10, em = 45] = apt.endTime.slice(0, 5).split(":").map(Number);
        aEnd = eh * 60 + em;
      }
      return startTotalMin < aEnd && endTotalMin > aStart;
    });

    if (conflict) {
      excludedDates.push(date);
      omittedConflicts.push({
        targetDate: date,
        startTime: input.startTime.slice(0, 5),
        conflictReason: "EXISTING_APPOINTMENT_OVERLAP",
        conflictingAppointmentId: conflict.id,
        conflictingClientName:
          isOp || conflict.barberId === staffBarberId ? conflict.name || "Turno reservado" : null,
      });
    } else {
      createdAppointments.push({
        id: crypto.randomUUID(),
        bookingDate: date,
        startTime: input.startTime.slice(0, 5),
        endTime: endTimeStr,
        servicePriceArs: input.membershipId ? 0 : (input.servicePriceArs ?? 25000),
      });
    }
  }

  const ruleId = crypto.randomUUID();
  fallbackRecurringAppointmentRulesStore.set(ruleId, {
    id: ruleId,
    clientId: input.clientId || crypto.randomUUID(),
    barberId: input.barberId,
    serviceId: input.serviceId ?? null,
    customServiceName: input.customServiceName ?? null,
    startTime: input.startTime.slice(0, 5),
    durationMinutes: durationMin,
    startDate: input.startDate,
    endDate: input.endType === "UNTIL_DATE" ? input.endDate || null : null,
    frequencyType: input.frequencyType,
    endType: input.endType,
    maxOccurrences: input.endType === "AFTER_COUNT" ? input.maxOccurrences || null : null,
    pricingMode: input.pricingMode || "CURRENT_RATE",
    fixedPriceArs: input.servicePriceArs ?? null,
    membershipId: input.membershipId ?? null,
    excludedDates,
    active: true,
    notes: input.notes ?? null,
  });

  notifyActivityChanged();
  return {
    ruleId,
    createdCount: createdAppointments.length,
    omittedCount: omittedConflicts.length,
    createdAppointments,
    omittedConflicts,
  };
}

export async function modifyRecurringAppointmentSeries(
  input: {
    appointmentId: string;
    scope: RecurrenceScopeType;
    action: "CANCEL" | "UPDATE";
    newStartTime?: string | null;
    newServiceId?: string | null;
    newPriceArs?: number | null;
    newPricingMode?: RecurringPricingMode | null;
    notes?: string | null;
  },
  staff: AuthenticatedStaff,
): Promise<{
  ruleId: string | null;
  scope: RecurrenceScopeType;
  action: "CANCEL" | "UPDATE";
  affectedCount: number;
  affectedAppointmentIds: string[];
  affectedDates: string[];
}> {
  try {
    const { data, error } = await (supabase.rpc as any)("modify_recurring_appointment_series", {
      p_appointment_id: input.appointmentId,
      p_scope: input.scope,
      p_action: input.action,
      p_new_start_time: input.newStartTime ? `${input.newStartTime.slice(0, 5)}:00` : null,
      p_new_service_id: input.newServiceId || null,
      p_new_price_ars: input.newPriceArs ?? null,
      p_new_pricing_mode: input.newPricingMode || null,
      p_notes: input.notes ?? null,
    });
    if (error) throw error;
    if (data) {
      notifyActivityChanged();
      return {
        ruleId: data.rule_id ?? null,
        scope: input.scope,
        action: input.action,
        affectedCount: Number(data.affected_count ?? 1),
        affectedAppointmentIds: data.affected_appointment_ids ?? [input.appointmentId],
        affectedDates: data.affected_dates ?? [],
      };
    }
  } catch (err: any) {
    const msg = String(err?.message || err || "");
    if (!msg.includes("modify_recurring_appointment_series") && !msg.includes("PGRST202")) {
      throw err;
    }
  }

  notifyActivityChanged();
  return {
    ruleId: null,
    scope: input.scope,
    action: input.action,
    affectedCount: 1,
    affectedAppointmentIds: [input.appointmentId],
    affectedDates: [],
  };
}

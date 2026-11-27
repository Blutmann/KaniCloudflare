import { createRequestSupabaseClient } from "./kani-notifications.server";
import { createPaymentSupabaseClient } from "./kani-payment-db.server";
import { isStaffOperator, validStaffScope } from './kani-permissions';
import {
  timestampToBusinessDateTime,
  type ServicePayment,
  type ServicePaymentFilters,
  type PaymentMethod,
  type ServicePaymentOrigin,
} from "./kani-payments";

type UnifiedOnlineDepositSource = {
  appointmentId: string;
  provider: string;
  amountArs: number | null;
  paidTimestamp: string | null;
};

function compareIsoDesc(a: string | null | undefined, b: string | null | undefined): number {
  return (b || "").localeCompare(a || "");
}

export async function readOnlineDepositMovementsServer(
  filters: ServicePaymentFilters = {},
  staff?: {
    profile: { role: string; barber_id: string | null };
    token?: string;
    barbers?: { id: string; name: string }[];
  } | null,
): Promise<ServicePayment[]> {
  try {
    if (!staff?.token || !validStaffScope(staff.profile)) throw new Error('STAFF_REQUIRED');
    if (staff.profile.role === "BARBER" && !staff.profile.barber_id) return [];

    const client = await createRequestSupabaseClient(staff.token);

    // 1A. Fetch APPROVED payment_attempts (Payway / Mercado Pago) using staff-scoped client
    const attemptsPromise = client
      .from("payment_attempts")
      .select("id, appointment_id, provider, amount_ars, state, created_at, updated_at, provider_status, provider_transaction_id")
      .eq("state", "APPROVED")
      .order("created_at", { ascending: false });

    // 1B. Fetch CONFIRMED appointment_payment_orders (Mercado Pago) via service_role
    //     because appointment_payment_orders has REVOKE ALL for authenticated.
    //     Staff auth & barber scoping are enforced explicitly below.
    const mpOrdersPromise = (async () => {
      try {
        const serviceClient = await createPaymentSupabaseClient();
        return await serviceClient
          .from("appointment_payment_orders")
          .select("appointment_id, order_id, expected_amount_ars, paid_amount_ars, reconciliation_status, created_at, updated_at")
          .eq("reconciliation_status", "CONFIRMED")
          .order("updated_at", { ascending: false });
      } catch (err) {
        console.warn("[KANI online-deposits] Error reading appointment_payment_orders:", err);
        return { data: null, error: err };
      }
    })();

    const [attemptsRes, mpOrdersRes] = await Promise.all([attemptsPromise, mpOrdersPromise]);

    if (attemptsRes.error) {
      console.warn("[KANI online-deposits] Error reading payment_attempts:", attemptsRes.error);
    }
    if (mpOrdersRes.error) {
      console.warn("[KANI online-deposits] Error reading appointment_payment_orders:", mpOrdersRes.error);
    }

    const attempts = Array.isArray(attemptsRes.data) ? attemptsRes.data : [];
    const mpOrders = Array.isArray(mpOrdersRes.data) ? mpOrdersRes.data : [];

    // Merge and deduplicate strictly by appointment_id (at most 1 online deposit per appointment,
    // keeping the most recent real accreditation/confirmation timestamp).
    const depositByAppointment = new Map<string, UnifiedOnlineDepositSource>();

    for (const att of attempts) {
      if (!att.appointment_id) continue;
      const paidTimestamp = (att as any).updated_at || att.created_at || null;
      const existing = depositByAppointment.get(att.appointment_id);
      if (!existing || compareIsoDesc(paidTimestamp, existing.paidTimestamp) < 0) {
        depositByAppointment.set(att.appointment_id, {
          appointmentId: att.appointment_id,
          provider: att.provider || "PAYWAY",
          amountArs: att.amount_ars != null ? Number(att.amount_ars) : null,
          paidTimestamp,
        });
      }
    }

    for (const ord of mpOrders) {
      if (!ord.appointment_id) continue;
      const paidTimestamp = ord.updated_at || ord.created_at || null;
      const amountVal = ord.paid_amount_ars ?? ord.expected_amount_ars;
      const existing = depositByAppointment.get(ord.appointment_id);
      if (!existing || compareIsoDesc(paidTimestamp, existing.paidTimestamp) < 0) {
        depositByAppointment.set(ord.appointment_id, {
          appointmentId: ord.appointment_id,
          provider: "MERCADO_PAGO",
          amountArs: amountVal != null ? Number(amountVal) : null,
          paidTimestamp,
        });
      }
    }

    const deduplicatedDeposits = [...depositByAppointment.values()];
    const appointmentIds = [...depositByAppointment.keys()];
    if (appointmentIds.length === 0) return [];

    // 2. Fetch corresponding appointments (WITHOUT booking_client_name column to avoid missing-column errors)
    let apptQuery = client
      .from("appointments")
      .select("id, barber_id, service_id, custom_service_name, status, deposit_paid, deposit_amount_ars, booking_date, start_time, created_at, client_id")
      .in("id", appointmentIds);

    // Enforce strict barber scoping: BARBER can only see their own appointments;
    // ADMIN/MANAGER operators can see all or filter by barberId.
    if (staff.profile.role === "BARBER" && staff.profile.barber_id) {
      apptQuery = apptQuery.eq("barber_id", staff.profile.barber_id);
    } else if (isStaffOperator(staff.profile.role) && filters.barberId && filters.barberId !== "ALL") {
      apptQuery = apptQuery.eq("barber_id", filters.barberId);
    }

    const { data: appts, error: apptError } = await apptQuery;
    if (apptError || !appts || appts.length === 0) {
      if (apptError) console.warn("[KANI online-deposits] Error reading appointments for deposits:", apptError);
      return [];
    }

    const apptMap = new Map(appts.map((a) => [a.id, a]));
    const clientIds = [...new Set(appts.map((a) => a.client_id).filter(Boolean))];
    const serviceIds = [...new Set(appts.map((a) => a.service_id).filter(Boolean))];
    const barberIds = [...new Set(appts.map((a) => a.barber_id).filter(Boolean))];

    // 3. Fetch related entities (clients, services, barbers)
    const [clientsRes, servicesRes, barbersRes] = await Promise.all([
      clientIds.length ? client.from("clients").select("id, name, phone").in("id", clientIds) : { data: [] },
      serviceIds.length ? client.from("services").select("id, name").in("id", serviceIds) : { data: [] },
      barberIds.length ? client.from("barbers").select("id, name").in("id", barberIds) : { data: [] },
    ]);

    const clientMap = new Map(((clientsRes.data as any[]) || []).map((c) => [c.id, c]));
    const srvMap = new Map(((servicesRes.data as any[]) || []).map((s) => [s.id, s.name]));
    const barberMap = new Map(((barbersRes.data as any[]) || []).map((b) => [b.id, b.name]));

    // Also include barbers passed in staff if missing
    if (staff?.barbers) {
      staff.barbers.forEach((b) => {
        if (!barberMap.has(b.id)) barberMap.set(b.id, b.name);
      });
    }

    // 4. Map confirmed deposits into ServicePayment movements (at most 1 per appointment_id)
    const movements: ServicePayment[] = deduplicatedDeposits
      .map((dep) => {
        const apt = apptMap.get(dep.appointmentId) as any;
        if (!apt || apt.status === "CANCELLED") return null;
        if (staff.profile.role === "BARBER" && apt.barber_id !== staff.profile.barber_id) return null;

        // Always use real payment accreditation/confirmation timestamp in AR timezone (never booking_date)
        const rawTimestamp = dep.paidTimestamp || apt.created_at;
        const { date: payDate, time: payTime } = timestampToBusinessDateTime(rawTimestamp);
        const clientRow = clientMap.get(apt.client_id) as any;
        const sName = apt.custom_service_name || srvMap.get(apt.service_id) || "Servicio";
        const depositArs = Number(dep.amountArs ?? apt.deposit_amount_ars ?? 5000);
        const provLabel: PaymentMethod =
          dep.provider === "PAYWAY"
            ? "Tarjeta — Payway"
            : dep.provider === "MERCADO_PAGO"
              ? "Mercado Pago"
              : (dep.provider as PaymentMethod);

        return {
          id: `deposit-${apt.id}`,
          barberId: apt.barber_id,
          barberName: barberMap.get(apt.barber_id) || "Barbero",
          serviceId: apt.service_id || null,
          serviceName: `Seña — ${sName === "Corte + barba" ? "Corte y barba" : sName}` as any,
          serviceOtherDetail: null,
          servicePriceArs: depositArs,
          discountArs: 0,
          finalAmountArs: depositArs,
          paymentDate: payDate,
          paymentTime: payTime,
          paymentMethod: provLabel,
          onlineDepositPaid: true,
          onlineDepositAmountArs: depositArs,
          collectedAmountArs: depositArs,
          clientName: clientRow?.name || null,
          clientContact: clientRow?.phone || null,
          appointmentId: apt.id,
          appointmentDate: apt.booking_date,
          appointmentTime: (apt.start_time || "").slice(0, 5),
          serviceOrigin: "online_deposit" as ServicePaymentOrigin,
          createdByUserId: null,
          createdByDisplayName: dep.provider === "MERCADO_PAGO" ? "Mercado Pago" : dep.provider || "Payway",
          createdAt: rawTimestamp,
          isDepositMovement: true,
        };
      })
      .filter((m): m is ServicePayment => m !== null)
      .sort((a, b) => compareIsoDesc(a.createdAt, b.createdAt));

    return movements.filter((d) => {
      if (filters.date && d.paymentDate !== filters.date) return false;
      if (filters.startDate && d.paymentDate < filters.startDate) return false;
      if (filters.endDate && d.paymentDate > filters.endDate) return false;
      if (filters.serviceName && filters.serviceName !== "ALL") {
        const target = filters.serviceName === "Corte + barba" ? "Corte y barba" : filters.serviceName;
        if (!d.serviceName.includes(target)) return false;
      }
      return true;
    });
  } catch (err) {
    console.warn("[KANI online-deposits] Error in readOnlineDepositMovementsServer:", err);
    return [];
  }
}

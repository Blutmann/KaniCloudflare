import { createPaymentSupabaseClient } from "./kani-payment-db.server";
import {
  timestampToBusinessDateTime,
  type ServicePayment,
  type ServicePaymentFilters,
  type PaymentMethod,
  type ServicePaymentOrigin,
} from "./kani-payments";

export async function readOnlineDepositMovementsServer(
  filters: ServicePaymentFilters = {},
  staff?: {
    profile: { role: string; barber_id: string | null };
    barbers?: { id: string; name: string }[];
  } | null,
): Promise<ServicePayment[]> {
  try {
    const client = await createPaymentSupabaseClient();

    // 1. Fetch APPROVED payment_attempts (Payway / Mercado Pago)
    const { data: attempts, error: attError } = await client
      .from("payment_attempts")
      .select("id, appointment_id, provider, amount_ars, state, created_at, provider_status, provider_transaction_id")
      .eq("state", "APPROVED")
      .order("created_at", { ascending: false });

    if (attError || !attempts || attempts.length === 0) {
      if (attError) console.warn("[KANI online-deposits] Error reading payment_attempts:", attError);
      return [];
    }

    const appointmentIds = [...new Set(attempts.map((a) => a.appointment_id).filter(Boolean))];
    if (appointmentIds.length === 0) return [];

    // 2. Fetch corresponding appointments (WITHOUT booking_client_name column to avoid missing-column errors)
    let apptQuery = client
      .from("appointments")
      .select("id, barber_id, service_id, custom_service_name, deposit_paid, deposit_amount_ars, booking_date, start_time, created_at, client_id")
      .in("id", appointmentIds);

    // Apply barber scoping if role is BARBER or filter specifies a barber
    if (staff?.profile?.role === "BARBER" && staff.profile.barber_id) {
      apptQuery = apptQuery.eq("barber_id", staff.profile.barber_id);
    } else if (filters.barberId && filters.barberId !== "ALL") {
      apptQuery = apptQuery.eq("barber_id", filters.barberId);
    }

    const { data: appts, error: apptError } = await apptQuery;
    if (apptError || !appts || appts.length === 0) {
      if (apptError) console.warn("[KANI online-deposits] Error reading appointments for attempts:", apptError);
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

    // 4. Map approved attempts into ServicePayment movements
    const movements: ServicePayment[] = attempts
      .map((att) => {
        const apt = apptMap.get(att.appointment_id);
        if (!apt) return null;

        const rawTimestamp = att.created_at || apt.created_at;
        const { date: payDate, time: payTime } = timestampToBusinessDateTime(rawTimestamp);
        const client = clientMap.get(apt.client_id) as any;
        const sName = apt.custom_service_name || srvMap.get(apt.service_id) || "Servicio";
        const depositArs = Number(att.amount_ars ?? apt.deposit_amount_ars ?? 5000);
        const provLabel: PaymentMethod =
          att.provider === "PAYWAY"
            ? "Tarjeta — Payway"
            : att.provider === "MERCADO_PAGO"
              ? "Mercado Pago"
              : (att.provider as PaymentMethod);

        return {
          id: `deposit-${att.id}`,
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
          clientName: client?.name || null,
          clientContact: client?.phone || null,
          appointmentId: apt.id,
          appointmentDate: apt.booking_date,
          appointmentTime: (apt.start_time || "").slice(0, 5),
          serviceOrigin: "online_deposit" as ServicePaymentOrigin,
          createdByUserId: null,
          createdByDisplayName: att.provider || "Payway",
          createdAt: rawTimestamp,
          isDepositMovement: true,
        };
      })
      .filter((m): m is ServicePayment => m !== null);

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

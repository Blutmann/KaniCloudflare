import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { readStaffAppointments, type RealAppointment } from "@/lib/kani-appointments";
import { fetchServicePayments, type ServicePayment } from "@/lib/kani-payments";
import {
  readConfiguredServices,
  readAvailabilityStartsForRange,
  type ConfiguredService,
} from "@/lib/kani-availability";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { addCalendarDays, businessDateToday } from "@/lib/kani-mobile-appointments";
import { scopeV2 } from "@/lib/kani-v2";

export type V2Client = Tables<"clients"> & { draft?: boolean; archived?: boolean };
type Data = {
  appointments: RealAppointment[];
  payments: ServicePayment[];
  starts: Awaited<ReturnType<typeof readAvailabilityStartsForRange>>;
  services: ConfiguredService[];
  clients: V2Client[];
  depositSupported: boolean;
};
const empty: Data = {
  appointments: [],
  payments: [],
  starts: [],
  services: [],
  clients: [],
  depositSupported: false,
};
type Value = Data & {
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  setClients: React.Dispatch<React.SetStateAction<V2Client[]>>;
  barberId: string;
  setBarberId: (id: string) => void;
};
const Context = createContext<Value | null>(null);
export function V2DataProvider({ children }: { children: ReactNode }) {
  const { staff } = useAdminStaff();
  const [data, setData] = useState<Data>(empty);
  const [clients, setClients] = useState<V2Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [barberId, setBarberId] = useState("ALL");
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (
        staff.profile.role !== "ADMIN" &&
        (staff.profile.role !== "BARBER" || !staff.profile.barber_id)
      ) {
        throw new Error("No pudimos determinar el barbero asociado a tu usuario.");
      }
      const today = businessDateToday();
      const barbers = staff.barbers.filter(
        (barber) => staff.profile.role === "ADMIN" || barber.id === staff.profile.barber_id,
      );
      let capabilityQuery = supabase
        .from("appointments")
        .select("deposit_paid, deposit_amount_ars")
        .limit(1);
      if (staff.profile.role === "BARBER")
        capabilityQuery = capabilityQuery.eq("barber_id", staff.profile.barber_id!);
      const [appointments, payments, starts, services, clientResult, capability] =
        await Promise.all([
          readStaffAppointments(staff),
          fetchServicePayments({}, staff),
          Promise.all(
            barbers.map((b) =>
              readAvailabilityStartsForRange(b.id, {
                start: today,
                end: addCalendarDays(today, 7),
              }),
            ),
          ).then((rows) => rows.flat()),
          readConfiguredServices(),
          supabase.from("clients").select("*").order("name"),
          capabilityQuery,
        ]);
      if (clientResult.error) throw clientResult.error;
      setData({
        appointments: scopeV2(appointments, staff.profile.role, staff.profile.barber_id),
        payments: scopeV2(payments, staff.profile.role, staff.profile.barber_id),
        starts,
        services,
        clients: [],
        depositSupported: !capability.error,
      });
      setClients(clientResult.data ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos cargar los datos. Reintentá.");
    } finally {
      setLoading(false);
    }
  }, [staff]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <Context.Provider
      value={{ ...data, clients, setClients, loading, error, refresh, barberId, setBarberId }}
    >
      {children}
    </Context.Provider>
  );
}
export function useV2() {
  const value = useContext(Context);
  if (!value) throw new Error("Falta el contexto V2");
  return value;
}

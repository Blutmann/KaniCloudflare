import { useEffect, useRef, useState } from "react";
import type { AuthenticatedStaff } from "@/lib/kani-auth";
import { AdminStaffProvider } from "@/lib/kani-admin-context";
import {
  extractErrorMessage,
  readNotificationAppointment,
  type NotificationAppointment,
} from "@/lib/kani-admin-activity";
import { V2DataProvider, useV2 } from "./v2/data";
import { V2Appointments } from "./v2/agenda";
import "./v2/v2.css";

type Props = {
  staff: AuthenticatedStaff;
  notificationId: string;
  onOpened: () => void;
  onChanged: () => void;
  onNavigate: () => void;
};
export default function NotificationAppointmentDetail(props: Props) {
  return (
    <AdminStaffProvider staff={props.staff}>
      <V2DataProvider>
        <CurrentDetail {...props} />
      </V2DataProvider>
    </AdminStaffProvider>
  );
}
function CurrentDetail({ notificationId, onOpened, onChanged, onNavigate }: Props) {
  const data = useV2();
  const [detail, setDetail] = useState<NotificationAppointment | null>(null);
  const [error, setError] = useState("");
  const didOpen = useRef(false),
    callbacks = useRef({ onOpened, onChanged });
  callbacks.current = { onOpened, onChanged };
  useEffect(() => {
    if (data.loading) return;
    let cancelled = false;
    void readNotificationAppointment(notificationId)
      .then((current) => {
        if (cancelled) return;
        if (!data.appointments.some((a) => a.id === current.appointment_id)) {
          setDetail(null);
          setError("El turno ya no está disponible para esta cuenta.");
          return;
        }
        setDetail(current);
        setError("");
        if (!didOpen.current) {
          didOpen.current = true;
          callbacks.current.onOpened();
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setDetail(null);
          setError(extractErrorMessage(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [notificationId, data.appointments, data.loading]);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) void data.refresh();
    };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [data.refresh]);
  if (error || data.error) return <p role="alert">{error || data.error}</p>;
  if (!detail) return <p role="status">Consultando turno…</p>;
  return (
    <V2Appointments
      notificationDetail={detail}
      onNotificationChanged={() => callbacks.current.onChanged()}
      onNotificationNavigate={onNavigate}
    />
  );
}

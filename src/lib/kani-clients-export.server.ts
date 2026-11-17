import { businessDateToday } from './kani-mobile-appointments';
import { createPaymentSupabaseClient } from './kani-payment-db.server';
import { assertStaffReadSession } from './kani-benefit-codes.server';

export type ClientExportRow = {
  clienteDesde: string;
  nombre: string;
  mail: string;
  celular: string;
  barbero: string;
  ultimaAtencion: string;
  serviciosRealizados: number;
  proximaReserva: string;
  observaciones: string;
  idInterno: string;
};

export function formatExportDate(value: string | null | undefined): string {
  if (!value) return '';
  const ymd = String(value).slice(0, 10);
  const [year, month, day] = ymd.split('-');
  return day && month && year && /^\d{4}$/.test(year) ? `${day}/${month}/${year}` : '';
}

function isCancelledStatus(status: string | null | undefined): boolean {
  const normalized = String(status ?? '').toUpperCase();
  return normalized === 'CANCELLED' || normalized === 'REJECTED' || normalized === 'NO_SHOW';
}

export function buildClientExportRows(input: {
  clients: Array<Record<string, any>>;
  appointments: Array<Record<string, any>>;
  servicePayments: Array<Record<string, any>>;
  barbers: Array<Record<string, any>>;
  today?: string;
}): ClientExportRow[] {
  const today = input.today ?? businessDateToday();

  const barberNameById = new Map<string, string>();
  for (const b of input.barbers) {
    if (b?.id && b?.name) {
      barberNameById.set(String(b.id), String(b.name).trim());
    }
  }

  const paidAppointmentIds = new Set<string>();
  for (const p of input.servicePayments) {
    if (!p?.appointment_id) continue;
    if (String(p.service_name ?? '').trim() === 'Anulado') continue;
    paidAppointmentIds.add(String(p.appointment_id));
  }

  const apptsByClientId = new Map<string, Array<Record<string, any>>>();
  for (const appt of input.appointments) {
    const cid = appt?.client_id ? String(appt.client_id) : '';
    if (!cid) continue;
    const list = apptsByClientId.get(cid) ?? [];
    list.push(appt);
    apptsByClientId.set(cid, list);
  }

  const seenClientIds = new Set<string>();
  const rows: ClientExportRow[] = [];

  for (const client of input.clients) {
    const id = client?.id ? String(client.id) : '';
    if (!id || seenClientIds.has(id)) continue;
    if (client.archived || client.deleted_at) continue;
    seenClientIds.add(id);

    const clientAppts = apptsByClientId.get(id) ?? [];

    const attended = clientAppts
      .filter((a) => {
        if (isCancelledStatus(a.status)) return false;
        const date = String(a.booking_date ?? '').slice(0, 10);
        if (!date || date > today) return false;
        const status = String(a.status ?? '').toUpperCase();
        return status === 'COMPLETED' || paidAppointmentIds.has(String(a.id));
      })
      .sort((a, b) => {
        const da = `${a.booking_date ?? ''}|${a.start_time ?? ''}|${a.created_at ?? ''}`;
        const db = `${b.booking_date ?? ''}|${b.start_time ?? ''}|${b.created_at ?? ''}`;
        return da.localeCompare(db);
      });

    const orderedBarbers: string[] = [];
    const seenBarbers = new Set<string>();
    for (const a of attended) {
      const bId = a.barber_id ? String(a.barber_id) : '';
      const bName = bId ? barberNameById.get(bId) : undefined;
      if (bName && !seenBarbers.has(bName)) {
        seenBarbers.add(bName);
        orderedBarbers.push(bName);
      }
    }

    const upcoming = clientAppts
      .filter((a) => {
        const status = String(a.status ?? '').toUpperCase();
        if (status !== 'PENDING' && status !== 'CONFIRMED') return false;
        const date = String(a.booking_date ?? '').slice(0, 10);
        return Boolean(date && date >= today);
      })
      .sort((a, b) =>
        `${a.booking_date ?? ''}|${a.start_time ?? ''}`.localeCompare(
          `${b.booking_date ?? ''}|${b.start_time ?? ''}`,
        ),
      );

    const lastAttended = attended.at(-1);
    const nextUpcoming = upcoming[0];

    rows.push({
      clienteDesde: formatExportDate(client.created_at),
      nombre: String(client.name ?? '').trim(),
      mail: String(client.email ?? '').trim(),
      celular: String(client.phone ?? '').trim(),
      barbero: orderedBarbers.length > 0 ? orderedBarbers.join(' | ') : 'Sin atenciones',
      ultimaAtencion: lastAttended ? formatExportDate(lastAttended.booking_date) : '',
      serviciosRealizados: attended.length,
      proximaReserva: nextUpcoming ? formatExportDate(nextUpcoming.booking_date) : '',
      observaciones: String(client.notes ?? '').trim(),
      idInterno: id,
    });
  }

  return rows;
}

async function fetchAllPaginated(
  fetchPage: (from: number, to: number) => Promise<{ data: any[] | null; error: any }>,
  pageSize = 1000,
): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await fetchPage(offset, offset + pageSize - 1);
    if (error) throw error;
    const batch = Array.isArray(data) ? data : [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

export async function staffExportClients(authToken?: string): Promise<ClientExportRow[]> {
  await assertStaffReadSession(authToken);
  const db = await createPaymentSupabaseClient();

  const [clients, barbersRes, appointments, servicePayments] = await Promise.all([
    fetchAllPaginated((from, to) =>
      db.from('clients').select('*').order('created_at', { ascending: false }).range(from, to),
    ),
    db.from('barbers').select('id, name'),
    fetchAllPaginated((from, to) =>
      db
        .from('appointments')
        .select('id, client_id, barber_id, booking_date, start_time, status, created_at')
        .order('booking_date', { ascending: true })
        .range(from, to),
    ),
    fetchAllPaginated((from, to) =>
      db
        .from('service_payments')
        .select('id, appointment_id, service_name')
        .not('appointment_id', 'is', null)
        .range(from, to),
    ),
  ]);

  if (barbersRes.error) throw barbersRes.error;

  return buildClientExportRows({
    clients,
    appointments,
    servicePayments,
    barbers: Array.isArray(barbersRes.data) ? barbersRes.data : [],
  });
}

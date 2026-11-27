import type { ClientMembershipRecord } from './kani-recurrences-memberships';
import { formatBuenosAiresDate } from './kani-benefit-codes';
import {
  buildKaniWorkbookBuffer,
  downloadWorkbookBytes,
  getExcelTodayBuenosAiresYmd,
  type KaniExcelColumn,
} from './kani-excel';

export interface MembershipExportRow {
  cliente: string;
  barbero: string;
  plan: string;
  estado: string;
  sesionesUsadas: string;
  vigencia: string;
  creadaEl: string;
}

function formatMembershipStatus(status: ClientMembershipRecord['status']): string {
  switch (status) {
    case 'ACTIVE':
      return 'Activa';
    case 'PENDING_PAYMENT':
      return 'Pago pendiente';
    case 'EXHAUSTED':
      return 'Agotada';
    case 'EXPIRED':
      return 'Vencida';
    case 'CANCELLED':
      return 'Cancelada';
    default:
      return String(status);
  }
}

export function buildMembershipsExportFilename(todayYmd?: string): string {
  const dateStr =
    todayYmd && /^\d{4}-\d{2}-\d{2}$/.test(todayYmd)
      ? todayYmd
      : getExcelTodayBuenosAiresYmd();
  return `kani-membresias-${dateStr}.xlsx`;
}

export function mapMembershipsToExportRows(
  memberships: ClientMembershipRecord[],
  resolveClientName: (m: ClientMembershipRecord) => string,
  resolveBarberName: (m: ClientMembershipRecord) => string,
): MembershipExportRow[] {
  return memberships.map((m) => ({
    cliente: resolveClientName(m),
    barbero: resolveBarberName(m),
    plan: m.planName || 'Black Card',
    estado: formatMembershipStatus(m.status),
    sesionesUsadas: `${m.usedSessions}/${m.totalSessions}`,
    vigencia: m.expiresAt ? `Hasta ${formatBuenosAiresDate(`${m.expiresAt}T00:00:00-03:00`)}` : 'Sin vencimiento',
    creadaEl: m.createdAt ? formatBuenosAiresDate(m.createdAt) : 'Sin registro',
  }));
}

export async function generateMembershipsWorkbookBuffer(
  rows: MembershipExportRow[],
  options?: { filterSummary?: string; generatedAt?: Date },
): Promise<Uint8Array> {
  const columns: KaniExcelColumn<MembershipExportRow>[] = [
    { header: 'Cliente', key: 'cliente', width: 26 },
    { header: 'Barbero', key: 'barbero', width: 18 },
    { header: 'Plan', key: 'plan', width: 22 },
    { header: 'Estado', key: 'estado', width: 16 },
    { header: 'Sesiones usadas', key: 'sesionesUsadas', width: 16, align: 'center', numFmt: '@' },
    { header: 'Vigencia', key: 'vigencia', width: 22, numFmt: '@' },
    { header: 'Creada el', key: 'creadaEl', width: 16, numFmt: '@' },
  ];

  const defaultSummary =
    options?.filterSummary ??
    (rows.length === 1 ? '1 membresía' : `${rows.length} membresías`);

  return buildKaniWorkbookBuffer({
    reportName: 'Membresías',
    sheetName: 'Membresías',
    columns,
    rows: rows as unknown as Array<Record<string, string | number | null | undefined>>,
    filterSummary: defaultSummary,
    generatedAt: options?.generatedAt,
  });
}

export async function downloadMembershipsXlsx(
  rows: MembershipExportRow[],
  options?: { todayYmd?: string; filterSummary?: string; generatedAt?: Date },
): Promise<string> {
  const bytes = await generateMembershipsWorkbookBuffer(rows, options);
  const filename = buildMembershipsExportFilename(options?.todayYmd);
  return downloadWorkbookBytes(bytes, filename);
}

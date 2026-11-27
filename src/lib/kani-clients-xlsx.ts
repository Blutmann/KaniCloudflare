import type { ClientExportRow } from './kani-clients-export.server';
import {
  buildKaniWorkbookBuffer,
  downloadWorkbookBytes,
  sanitizeExcelCell,
  type KaniExcelColumn,
} from './kani-excel';

export const sanitizeFormulaText = sanitizeExcelCell;

export function buildClientExportFilename(todayYmd: string): string {
  const clean = /^\d{4}-\d{2}-\d{2}$/.test(todayYmd)
    ? todayYmd
    : new Date().toISOString().slice(0, 10);
  return `KANI_Clientes_${clean}.xlsx`;
}

export async function generateClientsWorkbookBuffer(
  rows: ClientExportRow[],
  options?: { filterSummary?: string; generatedAt?: Date },
): Promise<Uint8Array> {
  const columns: KaniExcelColumn<ClientExportRow>[] = [
    { header: 'Cliente desde', key: 'clienteDesde', width: 15, numFmt: '@' },
    { header: 'Nombre', key: 'nombre', width: 28 },
    { header: 'Mail', key: 'mail', width: 32, numFmt: '@' },
    { header: 'Celular', key: 'celular', width: 20, numFmt: '@' },
    { header: 'Barbero', key: 'barbero', width: 28 },
    { header: 'Última atención', key: 'ultimaAtencion', width: 17, numFmt: '@' },
    { header: 'Servicios realizados', key: 'serviciosRealizados', width: 20, align: 'right' },
    { header: 'Próxima reserva', key: 'proximaReserva', width: 17, numFmt: '@' },
    { header: 'Observaciones', key: 'observaciones', width: 34 },
    { header: 'ID interno', key: 'idInterno', width: 38 },
  ];

  const defaultSummary =
    options?.filterSummary ??
    (rows.length === 1 ? '1 cliente' : `${rows.length} clientes`);

  return buildKaniWorkbookBuffer({
    reportName: 'Clientes',
    sheetName: 'Clientes',
    columns,
    rows: rows as unknown as Array<Record<string, string | number | null | undefined>>,
    filterSummary: defaultSummary,
    generatedAt: options?.generatedAt,
  });
}

export async function downloadClientsXlsx(
  rows: ClientExportRow[],
  todayYmd: string,
  options?: { filterSummary?: string; generatedAt?: Date },
): Promise<string> {
  const bytes = await generateClientsWorkbookBuffer(rows, options);
  const filename = buildClientExportFilename(todayYmd);
  return downloadWorkbookBytes(bytes, filename);
}

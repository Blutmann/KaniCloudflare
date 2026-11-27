import {
  buildKaniWorkbookBuffer,
  downloadWorkbookBytes,
  getExcelTodayBuenosAiresYmd,
  type KaniExcelColumn,
} from './kani-excel';

export interface PaymentExportRow {
  fecha: string;
  hora: string;
  servicio: string;
  barbero: string;
  cliente: string;
  metodo: string;
  importeArs: number;
  tipo: string;
}

export function buildPaymentsExportFilename(todayYmd?: string): string {
  const dateStr =
    todayYmd && /^\d{4}-\d{2}-\d{2}$/.test(todayYmd)
      ? todayYmd
      : getExcelTodayBuenosAiresYmd();
  return `kani-cobros-registrados-${dateStr}.xlsx`;
}

export async function generatePaymentsWorkbookBuffer(
  rows: PaymentExportRow[],
  options?: { filterSummary?: string; generatedAt?: Date },
): Promise<Uint8Array> {
  const columns: KaniExcelColumn<PaymentExportRow>[] = [
    { header: 'Fecha', key: 'fecha', width: 14, numFmt: '@' },
    { header: 'Hora', key: 'hora', width: 10, align: 'center', numFmt: '@' },
    { header: 'Servicio', key: 'servicio', width: 26 },
    { header: 'Barbero', key: 'barbero', width: 18 },
    { header: 'Cliente', key: 'cliente', width: 26 },
    { header: 'Método de pago', key: 'metodo', width: 18 },
    { header: 'Importe (ARS)', key: 'importeArs', width: 16, align: 'right', numFmt: '$#,##0' },
    { header: 'Tipo', key: 'tipo', width: 18 },
  ];

  const defaultSummary =
    options?.filterSummary ??
    (rows.length === 1 ? '1 cobro registrado' : `${rows.length} cobros registrados`);

  return buildKaniWorkbookBuffer({
    reportName: 'Cobros registrados',
    sheetName: 'Cobros registrados',
    columns,
    rows: rows as unknown as Array<Record<string, string | number | null | undefined>>,
    filterSummary: defaultSummary,
    generatedAt: options?.generatedAt,
  });
}

export async function downloadPaymentsXlsx(
  rows: PaymentExportRow[],
  options?: { todayYmd?: string; filterSummary?: string; generatedAt?: Date },
): Promise<string> {
  const bytes = await generatePaymentsWorkbookBuffer(rows, options);
  const filename = buildPaymentsExportFilename(options?.todayYmd);
  return downloadWorkbookBytes(bytes, filename);
}

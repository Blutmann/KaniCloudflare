import {
  BENEFIT_TYPE_DEFINITIONS,
  BENEFIT_USAGE_MODE_DEFINITIONS,
  DEFAULT_LIMITED_USE_MAX_USES,
  formatBuenosAiresDate,
  formatBuenosAiresDateTime,
  getBuenosAiresTodayDateString,
  type BenefitCodeItem,
  type BenefitCodeStatus,
  type BenefitCodeType,
} from './kani-benefit-codes';
import {
  buildKaniWorkbookBuffer,
  downloadWorkbookBytes,
  type KaniExcelColumn,
} from './kani-excel';

export interface BenefitCodeExportRow {
  codigo: string;
  estado: string;
  cantidadDeUsos: string;
  usos: string;
  beneficio: string;
  vigencia: string;
  fechaDeCreacion: string;
}

function formatStatusLabel(status: BenefitCodeStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'Habilitado';
    case 'SCHEDULED':
      return 'Programado';
    case 'DISABLED':
      return 'Deshabilitado';
    case 'EXPIRED':
      return 'Vencido';
    case 'CONSUMED':
      return 'Consumido';
    case 'DELETED':
      return 'Eliminado';
    default:
      return 'Inactivo';
  }
}

function formatBenefitLabel(type: BenefitCodeType): string {
  switch (type) {
    case 'PERCENT_10':
      return '10% de descuento';
    case 'PERCENT_50':
      return '50% de descuento';
    case 'FREE_SERVICE':
      return 'Servicio gratuito';
    case 'NO_DEPOSIT':
      return 'Reserva sin seña';
    default:
      return BENEFIT_TYPE_DEFINITIONS[type]?.label ?? type;
  }
}

function formatValidityLabel(item: BenefitCodeItem): string {
  if (item.status === 'SCHEDULED' && item.validFrom) {
    return item.validUntil
      ? `Desde ${formatBuenosAiresDate(item.validFrom)} · Hasta ${formatBuenosAiresDate(item.validUntil)}`
      : `Desde ${formatBuenosAiresDate(item.validFrom)}`;
  }
  if (item.validityType === 'NO_EXPIRATION' || !item.validUntil) {
    return 'Sin vencimiento';
  }
  return `Hasta ${formatBuenosAiresDate(item.validUntil)}`;
}

export function buildBenefitCodesExportFilename(todayYmd?: string): string {
  const dateStr =
    todayYmd && /^\d{4}-\d{2}-\d{2}$/.test(todayYmd)
      ? todayYmd
      : getBuenosAiresTodayDateString();
  return `kani-codigos-descuento-${dateStr}.xlsx`;
}

export function mapBenefitCodesToExportRows(items: BenefitCodeItem[]): BenefitCodeExportRow[] {
  return items.map((item) => {
    const usageMode = item.usageMode || 'SINGLE_USE';
    const usageDef = BENEFIT_USAGE_MODE_DEFINITIONS[usageMode];
    const usageCount = item.timesUsed ?? item.usages?.length ?? 0;
    const maxUses =
      usageMode === 'LIMITED_USE'
        ? (typeof item.maxUses === 'number' && item.maxUses > 0 ? item.maxUses : DEFAULT_LIMITED_USE_MAX_USES)
        : null;

    return {
      codigo: item.code,
      estado: formatStatusLabel(item.status),
      cantidadDeUsos: usageDef?.label ?? usageMode,
      usos: maxUses !== null ? `${usageCount}/${maxUses}` : String(usageCount),
      beneficio: formatBenefitLabel(item.type),
      vigencia: formatValidityLabel(item),
      fechaDeCreacion: item.createdAt ? formatBuenosAiresDateTime(item.createdAt) : 'Sin registro',
    };
  });
}

export async function generateBenefitCodesWorkbookBuffer(
  items: BenefitCodeItem[],
  options?: { filterSummary?: string; generatedAt?: Date },
): Promise<Uint8Array> {
  const rows = mapBenefitCodesToExportRows(items);
  const columns: KaniExcelColumn<BenefitCodeExportRow>[] = [
    { header: 'Código', key: 'codigo', width: 26, numFmt: '@' },
    { header: 'Estado', key: 'estado', width: 16 },
    { header: 'Cantidad de usos', key: 'cantidadDeUsos', width: 18 },
    { header: 'Usos', key: 'usos', width: 12, align: 'center', numFmt: '@' },
    { header: 'Beneficio', key: 'beneficio', width: 22 },
    { header: 'Vigencia', key: 'vigencia', width: 28 },
    { header: 'Fecha de creación', key: 'fechaDeCreacion', width: 22, numFmt: '@' },
  ];

  const defaultSummary =
    options?.filterSummary ??
    (rows.length === 1 ? '1 código' : `${rows.length} códigos`);

  return buildKaniWorkbookBuffer({
    reportName: 'Códigos de descuento',
    sheetName: 'Códigos de descuento',
    columns,
    rows: rows as unknown as Array<Record<string, string | number | null | undefined>>,
    filterSummary: defaultSummary,
    generatedAt: options?.generatedAt,
  });
}

export async function downloadBenefitCodesXlsx(
  items: BenefitCodeItem[],
  options?: { todayYmd?: string; filterSummary?: string; generatedAt?: Date },
): Promise<string> {
  const bytes = await generateBenefitCodesWorkbookBuffer(items, options);
  const filename = buildBenefitCodesExportFilename(options?.todayYmd);
  return downloadWorkbookBytes(bytes, filename);
}

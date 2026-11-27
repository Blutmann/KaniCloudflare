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

export interface BenefitCodeExportRow {
  codigo: string;
  estado: string;
  cantidadDeUsos: string;
  usos: string;
  beneficio: string;
  vigencia: string;
  fechaDeCreacion: string;
}

function sanitizeCell(value: string): string {
  if (!value) return '';
  if (/^[=@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
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
      codigo: sanitizeCell(item.code),
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
): Promise<Uint8Array> {
  const ExcelJSModule = await import('exceljs');
  const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
  const rows = mapBenefitCodesToExportRows(items);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'KANI Barber Studio';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Códigos de descuento', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const columns: Array<{ header: string; key: keyof BenefitCodeExportRow; width: number }> = [
    { header: 'Código', key: 'codigo', width: 26 },
    { header: 'Estado', key: 'estado', width: 16 },
    { header: 'Cantidad de usos', key: 'cantidadDeUsos', width: 18 },
    { header: 'Usos', key: 'usos', width: 12 },
    { header: 'Beneficio', key: 'beneficio', width: 22 },
    { header: 'Vigencia', key: 'vigencia', width: 28 },
    { header: 'Fecha de creación', key: 'fechaDeCreacion', width: 22 },
  ];

  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  sheet.autoFilter = 'A1:G1';

  const headerRow = sheet.getRow(1);
  headerRow.height = 26;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFF6F2EA' }, size: 11 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1C1A18' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FFC8A253' } },
      right: { style: 'thin', color: { argb: 'FF3A3530' } },
    };
  });

  rows.forEach((row, index) => {
    const added = sheet.addRow(row);
    added.height = 21;
    const isEven = index % 2 === 1;
    added.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (isEven) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFAF8F4' },
        };
      }
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE5DFD3' } },
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: colNumber === 4 ? 'center' : 'left',
      };
      // Force text format so Excel never turns "3/10" into a date (3-Oct)
      if ([1, 4, 7].includes(colNumber)) {
        cell.numFmt = '@';
      }
    });
  });

  columns.forEach((col, idx) => {
    let maxLen = col.header.length + 4;
    for (const r of rows) {
      const val = String(r[col.key] ?? '');
      if (val.length + 3 > maxLen) maxLen = val.length + 3;
    }
    sheet.getColumn(idx + 1).width = Math.min(Math.max(col.width, maxLen), 44);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

export async function downloadBenefitCodesXlsx(
  items: BenefitCodeItem[],
  todayYmd?: string,
): Promise<string> {
  const bytes = await generateBenefitCodesWorkbookBuffer(items);
  const filename = buildBenefitCodesExportFilename(todayYmd);
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

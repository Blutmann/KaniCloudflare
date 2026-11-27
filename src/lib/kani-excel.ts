export interface KaniExcelColumn<T> {
  header: string;
  key: keyof T & string;
  width: number;
  align?: 'left' | 'center' | 'right';
  numFmt?: string;
}

export function sanitizeExcelCell(value: string): string {
  if (!value) return '';
  if (/^[=@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

/**
 * Formats a Date into the mandatory Kani Excel legend in Buenos Aires timezone:
 * "Generado el DD/MM/YYYY a las HH:mm hs"
 */
export function formatExcelGeneratedTimestamp(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';

  const day = get('day');
  const month = get('month');
  const year = get('year');
  const rawHour = get('hour');
  const hour = rawHour === '24' ? '00' : rawHour;
  const minute = get('minute');

  return `Generado el ${day}/${month}/${year} a las ${hour}:${minute} hs`;
}

export function getExcelTodayBuenosAiresYmd(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now);
}

function columnIndexToLetter(index1Based: number): string {
  let n = index1Based;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters || 'A';
}

/**
 * Builds a standardized Kani Barber Studio Excel workbook (.xlsx):
 * - Row 1: "Kani Barber Studio — [reportName]"
 * - Row 2: "Generado el DD/MM/YYYY a las HH:mm hs" (America/Argentina/Buenos_Aires)
 * - Row 3: Optional filter summary
 * - Row 4: Blank visual separator
 * - Row 5: Styled table header (frozen + autoFilter)
 * - Row 6+: Data rows with zebra striping and auto-sized columns
 */
export async function buildKaniWorkbookBuffer<T extends Record<string, string | number | null | undefined>>(options: {
  reportName: string;
  sheetName: string;
  columns: KaniExcelColumn<T>[];
  rows: T[];
  filterSummary?: string;
  generatedAt?: Date;
}): Promise<Uint8Array> {
  const ExcelJSModule = await import('exceljs');
  const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Kani Barber Studio';
  workbook.created = options.generatedAt ?? new Date();

  const sheet = workbook.addWorksheet(options.sheetName, {
    views: [{ state: 'frozen', ySplit: 5 }],
  });

  const lastColLetter = columnIndexToLetter(options.columns.length);

  // Set column keys & base widths without writing headers to row 1
  options.columns.forEach((col, idx) => {
    const sheetCol = sheet.getColumn(idx + 1);
    sheetCol.key = col.key;
    sheetCol.width = col.width;
  });

  // Row 1: Institutional title
  const titleRow = sheet.getRow(1);
  titleRow.height = 24;
  titleRow.getCell(1).value = `Kani Barber Studio — ${options.reportName}`;
  titleRow.getCell(1).font = { bold: true, size: 13, color: { argb: 'FF1C1A18' } };
  titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
  if (options.columns.length > 1) {
    sheet.mergeCells(`A1:${lastColLetter}1`);
  }

  // Row 2: Mandatory generated timestamp legend (Buenos Aires)
  const timestampRow = sheet.getRow(2);
  timestampRow.height = 19;
  timestampRow.getCell(1).value = formatExcelGeneratedTimestamp(options.generatedAt);
  timestampRow.getCell(1).font = { italic: true, size: 10.5, color: { argb: 'FF57534E' } };
  timestampRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
  if (options.columns.length > 1) {
    sheet.mergeCells(`A2:${lastColLetter}2`);
  }

  // Row 3: Optional filter summary
  const summaryRow = sheet.getRow(3);
  summaryRow.height = options.filterSummary?.trim() ? 18 : 8;
  if (options.filterSummary?.trim()) {
    summaryRow.getCell(1).value = sanitizeExcelCell(options.filterSummary.trim());
    summaryRow.getCell(1).font = { size: 10, color: { argb: 'FF78716C' } };
    summaryRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
  }
  if (options.columns.length > 1) {
    sheet.mergeCells(`A3:${lastColLetter}3`);
  }

  // Row 4: Blank separator
  sheet.getRow(4).height = 10;

  // Row 5: Table column headers
  const headerRow = sheet.getRow(5);
  headerRow.height = 26;
  options.columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: 'FFF6F2EA' }, size: 11 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1C1A18' },
    };
    cell.alignment = { vertical: 'middle', horizontal: col.align ?? 'left' };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FFC8A253' } },
      right: { style: 'thin', color: { argb: 'FF3A3530' } },
    };
  });

  sheet.autoFilter = `A5:${lastColLetter}5`;

  // Row 6+: Data rows
  options.rows.forEach((rowData, rowIndex) => {
    const excelRow = sheet.getRow(6 + rowIndex);
    excelRow.height = 21;
    const isEven = rowIndex % 2 === 1;

    options.columns.forEach((col, colIdx) => {
      const cell = excelRow.getCell(colIdx + 1);
      const rawVal = rowData[col.key];
      cell.value =
        typeof rawVal === 'string'
          ? sanitizeExcelCell(rawVal)
          : rawVal ?? '';

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
        horizontal: col.align ?? 'left',
      };
      if (col.numFmt) {
        cell.numFmt = col.numFmt;
      }
    });
  });

  // Auto-adjust column widths based on content length
  options.columns.forEach((col, idx) => {
    let maxLen = col.header.length + 4;
    for (const r of options.rows) {
      const val = String(r[col.key] ?? '');
      if (val.length + 3 > maxLen) maxLen = val.length + 3;
    }
    sheet.getColumn(idx + 1).width = Math.min(Math.max(col.width, maxLen), 48);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

export function downloadWorkbookBytes(bytes: Uint8Array, filename: string): string {
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
